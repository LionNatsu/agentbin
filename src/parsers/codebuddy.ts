import type { Block, Event, Parser, SessionIR, Usage } from "../ir";
import { codebuddyUsage } from "./helpers";

/**
 * CodeBuddy Code transcripts (`~/.codebuddy/projects/<hash>/<sid>.jsonl`).
 *
 * Unlike Claude Code, events are *flat* and OpenAI-Responses-shaped:
 *   type: "message" | "reasoning" | "function_call" | "function_call_result"
 *         | "topic" | "file-history-snapshot"
 * with a top-level `role` on messages, `content[].type` of input_text /
 * output_text / image_blob_ref, and a `providerData` envelope carrying the
 * model + per-turn `messageId` (used to group one assistant turn together).
 */

interface Turn {
  messageId?: string;
  model?: string;
  ts?: string;
  usage?: Usage;
  blocks: Block[];
}

const SYSTEM_TAG_RE = /^\s*<(system-reminder|local-command-caveat|local-command-stdout|command-message|command-name|command-args|task-notification|user-prompt-submit-hook)[\s>]/;

export function parseCodeBuddy(lines: string[]): SessionIR {
  const events: Event[] = [];
  const ir: SessionIR = { format: "codebuddy", events };

  const resultsByCallId = new Map<string, Record<string, unknown>>();
  const parsedLines: Record<string, unknown>[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    parsedLines.push(obj);
    if (obj.type === "function_call_result" && typeof obj.callId === "string") {
      resultsByCallId.set(obj.callId, obj);
    }
  }

  let current: Turn | null = null;
  const flush = () => {
    if (current && current.blocks.length) {
      events.push({
        kind: "assistant",
        blocks: current.blocks,
        model: current.model,
        ts: current.ts,
        usage: current.usage,
      });
    }
    current = null;
  };

  for (const obj of parsedLines) {
    const type = obj.type;
    const ts = msToIsoStr(obj.timestamp);
    const sessionId = str(obj.sessionId);
    const cwd = str(obj.cwd);
    if (sessionId) ir.sessionId ??= sessionId;
    if (cwd) ir.cwd ??= cwd;
    ir.startedAt ??= ts;

    const pd = (obj.providerData ?? {}) as Record<string, unknown>;
    const model = str(pd.model);
    if (model) ir.model ??= model;

    if (type === "topic") {
      ir.title ??= str(obj.topic) || undefined;
      continue;
    }
    if (type === "file-history-snapshot") continue;

    if (type === "message") {
      const role = str(obj.role);
      if (role === "user") {
        flush();
        const text = contentText(obj.content);
        if (SYSTEM_TAG_RE.test(text)) continue; // CLI command echo / reminder
        if (text.trim()) events.push({ kind: "user", text, ts });
        continue;
      }
      if (role === "assistant") {
        const key = str(pd.messageId) || str(obj.id);
        if (!current || (key && current.messageId && key !== current.messageId)) {
          flush();
          current = { messageId: key, model, ts, blocks: [] };
        }
        current = current ?? { messageId: key, model, ts, blocks: [] };
        current.model ??= model;
        current.ts ??= ts;
        for (const part of asArray(obj.content)) {
          const p = part as Record<string, unknown>;
          if ((p.type === "output_text" || p.type === "text") && typeof p.text === "string" && p.text) {
            current.blocks.push({ kind: "text", text: p.text });
          }
        }
        current.usage = codebuddyUsage(pd.rawUsage) ?? current.usage;
        continue;
      }
      continue;
    }

    if (type === "reasoning") {
      const key = str(pd.messageId) || str(obj.id);
      if (!current || (key && current.messageId && key !== current.messageId)) {
        flush();
        current = { messageId: key, model, ts, blocks: [] };
      }
      current = current ?? { messageId: key, model, ts, blocks: [] };
      for (const part of asArray(obj.rawContent)) {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string" && p.text) {
          current.blocks.push({ kind: "thinking", text: p.text });
        }
      }
      continue;
    }

    if (type === "function_call") {
      const key = str(pd.messageId) || str(obj.id);
      if (!current || (key && current.messageId && key !== current.messageId)) {
        flush();
        current = { messageId: key, model, ts, blocks: [] };
      }
      current = current ?? { messageId: key, model, ts, blocks: [] };
      current.blocks.push({
        kind: "toolUse",
        id: str(obj.callId),
        name: str(obj.name) || "tool",
        input: parseArgs(obj.arguments),
      });
      continue;
    }

    if (type === "function_call_result") {
      // Emitted as a toolResult; `pairToolResults` attaches it to its call.
      const output = obj.output;
      const text =
        typeof output === "object" && output !== null
          ? (output as Record<string, unknown>).text ?? ""
          : output != null
            ? String(output)
            : "";
      events.push({
        kind: "toolResult",
        toolUseId: str(obj.callId),
        name: str(obj.name),
        content: typeof text === "string" ? text : String(text),
        isError: typeof obj.status === "string" && obj.status !== "completed",
        ts,
      });
      continue;
    }
  }

  flush();
  return ir;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object") {
      const p = part as Record<string, unknown>;
      if ((p.type === "input_text" || p.type === "output_text" || p.type === "text") && typeof p.text === "string") {
        parts.push(p.text);
      }
    }
  }
  return parts.join("\n");
}

function parseArgs(arguments_: unknown): unknown {
  if (typeof arguments_ !== "string") return arguments_;
  try {
    return JSON.parse(arguments_);
  } catch {
    return arguments_;
  }
}

function msToIsoStr(v: unknown): string | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export const codebuddyParser: Parser = {
  id: "codebuddy",
  label: "CodeBuddy Code",
  sniff(obj) {
    let s = 0;
    if ("providerData" in obj) s += 10;
    const t = obj.type;
    if (t === "reasoning" || t === "function_call" || t === "function_call_result") s += 9;
    if (t === "topic" || t === "file-history-snapshot") s += 4;
    if (t === "message" && typeof obj.role === "string") s += 5;
    if (typeof obj.timestamp === "number") s += 1;
    return s;
  },
  parse: parseCodeBuddy,
};
