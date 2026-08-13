import type { Block, Event, Parser, SessionIR } from "../ir";
import { contentToText, piUsage } from "./helpers";

/**
 * Pi Coding Agent sessions (`~/.pi/agent/sessions/<encoded-cwd>/<ts>_<uuid>.jsonl`).
 *
 * First line is a `type: "session"` header (`{version, id, timestamp, cwd}`),
 * followed by `type: "message"` entries whose `message` carries the actual
 * role (`user` / `assistant` / `toolResult` / `bashExecution` / …). Content is
 * a string or an array of `{type: text|thinking|toolCall|image}` blocks.
 * Entries form a tree via `id` / `parentId`.
 */

export function parsePi(lines: string[]): SessionIR {
  const events: Event[] = [];
  const ir: SessionIR = { format: "pi", events };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const type = obj.type;
    const ts = typeof obj.timestamp === "string" ? obj.timestamp : undefined;

    if (type === "session") {
      const sessionId = str(obj.id);
      const cwd = str(obj.cwd);
      if (sessionId) ir.sessionId ??= sessionId;
      if (cwd) ir.cwd ??= cwd;
      ir.startedAt ??= ts;
      continue;
    }

    if (type === "session_info") {
      ir.title ??= str(obj.name) || undefined;
      continue;
    }

    if (type === "message") {
      const message = obj.message as Record<string, unknown> | undefined;
      if (!message) continue;
      const role = message.role;

      if (role === "user") {
        const text = contentToText(message.content).trim();
        if (text) events.push({ kind: "user", text, ts });
        continue;
      }

      if (role === "assistant") {
        const model = str(message.model);
        if (model) ir.model ??= model;
        const blocks: Block[] = [];
        for (const part of asArray(message.content)) {
          if (!part || typeof part !== "object") continue;
          const p = part as Record<string, unknown>;
          if (p.type === "text" && typeof p.text === "string" && p.text) {
            blocks.push({ kind: "text", text: p.text });
          } else if (p.type === "thinking" && typeof p.thinking === "string" && p.thinking) {
            blocks.push({ kind: "thinking", text: p.thinking });
          } else if (p.type === "toolCall") {
            blocks.push({
              kind: "toolUse",
              id: str(p.id),
              name: str(p.name) || "tool",
              input: p.arguments,
            });
          }
        }
        if (blocks.length) {
          events.push({
            kind: "assistant",
            blocks,
            model,
            ts,
            usage: piUsage(message.usage),
          });
        }
        continue;
      }

      if (role === "toolResult") {
        events.push({
          kind: "toolResult",
          toolUseId: str(message.toolCallId),
          name: str(message.toolName),
          content: contentToText(message.content),
          isError: message.isError === true,
          ts,
        });
        continue;
      }

      if (role === "bashExecution") {
        const command = str(message.command);
        const output = str(message.output);
        const exit = message.exitCode;
        const title = `$ ${command}${typeof exit === "number" ? `  (exit ${exit})` : ""}`;
        events.push({
          kind: "output",
          title,
          body: output,
          isError: typeof exit === "number" && exit !== 0,
          ts,
        });
        continue;
      }

      if (role === "custom") {
        const text = contentToText(message.content).trim();
        if (text) events.push({ kind: "note", text, icon: "◆", ts });
        continue;
      }
      continue;
    }

    if (type === "compaction") {
      const summary = str(obj.summary);
      events.push({
        kind: "note",
        text: summary ? `Context compacted — ${summary}` : "Context compacted",
        icon: "↻",
        ts,
      });
      continue;
    }

    if (type === "branch_summary") {
      events.push({
        kind: "note",
        text: str(obj.summary) || "Branch summary",
        icon: "⑂",
        ts,
      });
      continue;
    }

    if (type === "model_change") {
      events.push({
        kind: "note",
        text: `Model changed to ${str(obj.modelId)}`,
        icon: "⚙",
        ts,
      });
      continue;
    }

    // thinking_level_change, label, custom, … are non-conversational.
  }

  return ir;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export const piParser: Parser = {
  id: "pi",
  label: "Pi",
  sniff(obj) {
    let s = 0;
    const t = obj.type;
    if (t === "session") s += 10;
    if (t === "message" && obj.message && typeof obj.message === "object") {
      const m = obj.message as Record<string, unknown>;
      if (typeof m.role === "string") s += 6;
    }
    if (
      t === "compaction" ||
      t === "branch_summary" ||
      t === "model_change" ||
      t === "session_info" ||
      t === "thinking_level_change" ||
      t === "label" ||
      t === "custom" ||
      t === "custom_message"
    ) {
      s += 4;
    }
    return s;
  },
  parse: parsePi,
};
