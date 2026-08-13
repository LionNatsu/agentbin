import type { Block, Event, Parser, SessionIR, Usage } from "../ir";
import { anthropicUsage, contentToText } from "./helpers";

/**
 * Claude Code transcripts (`~/.claude/projects/<encoded-cwd>/<sid>.jsonl`).
 *
 * Top-level line types: `summary`, `user`, `assistant`, `system` (+ subtypes),
 * `attachment`, `mode`, `permission-mode`, `ai-title`, `last-prompt`,
 * `queue-operation`, `file-history-snapshot`. Tool results ride on a `user`
 * line as `content[].type === "tool_result"`.
 */

function usageOf(u: unknown): Usage | undefined {
  return anthropicUsage(u);
}

export function parseClaude(lines: string[]): SessionIR {
  const events: Event[] = [];
  const ir: SessionIR = { format: "claude-code", events };
  let startedAt: string | undefined;

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

    const sessionId = str(obj.sessionId);
    const cwd = str(obj.cwd);
    const gitBranch = str(obj.gitBranch);
    if (sessionId) ir.sessionId ??= sessionId;
    if (cwd) ir.cwd ??= cwd;
    if (gitBranch) ir.gitBranch ??= gitBranch;
    startedAt ??= ts;

    if (type === "summary") {
      ir.title ??= str(obj.summary) || undefined;
      continue;
    }

    if (type === "user") {
      const message = obj.message as Record<string, unknown> | undefined;
      const content = message?.content;
      const isCompactSummary = obj.isCompactSummary === true;

      if (typeof content === "string") {
        if (content.trim()) {
          if (isCompactSummary) events.push(note(`Context summarized`, "↻", ts));
          else events.push({ kind: "user", text: content, ts });
        }
        continue;
      }

      if (Array.isArray(content)) {
        const textParts: string[] = [];
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type === "tool_result") {
            events.push({
              kind: "toolResult",
              toolUseId: str(b.tool_use_id),
              content: toolResultText(b.content),
              isError: b.is_error === true,
              ts,
            });
          } else if (b.type === "text" && typeof b.text === "string") {
            textParts.push(b.text);
          }
        }
        const text = textParts.join("\n").trim();
        if (text) {
          if (isCompactSummary) events.push(note("Context summarized", "↻", ts));
          else events.push({ kind: "user", text, ts });
        }
      }
      continue;
    }

    if (type === "assistant") {
      const message = obj.message as Record<string, unknown> | undefined;
      const content = message?.content;
      const model = str(message?.model);
      if (model) ir.model ??= model;

      const blocks: Block[] = [];
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string" && b.text) {
            blocks.push({ kind: "text", text: b.text });
          } else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking) {
            blocks.push({ kind: "thinking", text: b.thinking });
          } else if (b.type === "redacted_thinking") {
            blocks.push({ kind: "thinking", text: "[redacted thinking]" });
          } else if (b.type === "tool_use") {
            blocks.push({
              kind: "toolUse",
              id: str(b.id),
              name: str(b.name) || "tool",
              input: b.input,
            });
          }
        }
      } else if (typeof content === "string" && content.trim()) {
        blocks.push({ kind: "text", text: content });
      }

      if (blocks.length) {
        events.push({
          kind: "assistant",
          blocks,
          model,
          ts,
          usage: usageOf(message?.usage),
        });
      }
      continue;
    }

    if (type === "system") {
      const subtype = str(obj.subtype);
      if (subtype === "compact_boundary") {
        events.push(note("Context compacted", "↻", ts));
        continue;
      }
      const text = systemText(obj);
      if (text) {
        events.push({
          kind: "system",
          text,
          ts,
          level: obj.level === "error" ? "error" : "info",
        });
      }
      continue;
    }

    // `attachment`, `mode`, `permission-mode`, `ai-title`, `last-prompt`,
    // `queue-operation`, `file-history-snapshot` are non-conversational.
  }

  ir.startedAt = startedAt;
  return ir;
}

/** Extract readable text from a `system` record (slash commands, errors, …). */
function systemText(obj: Record<string, unknown>): string {
  const subtype = str(obj.subtype);
  const content = obj.content;
  if (typeof content !== "string") return "";

  if (subtype === "local_command") {
    const cmd = /<command-name>(.*?)<\/command-name>/s.exec(content)?.[1]?.trim();
    if (cmd) return `⌘ ${cmd}`;
  }
  if (subtype === "api_error") {
    return content.trim();
  }
  const stripped = content
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return contentToText(content);
  return contentToText(content);
}

function note(text: string, icon: string, ts?: string): Event {
  return { kind: "note", text, icon, ts };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export const claudeParser: Parser = {
  id: "claude-code",
  label: "Claude Code",
  sniff(obj) {
    let s = 0;
    const t = obj.type;
    if (t === "summary") s += 8;
    if (t === "user" || t === "assistant") s += 5;
    if (
      t === "system" ||
      t === "attachment" ||
      t === "mode" ||
      t === "permission-mode" ||
      t === "ai-title" ||
      t === "last-prompt" ||
      t === "queue-operation"
    ) {
      s += 2;
    }
    if (typeof obj.uuid === "string" && "parentUuid" in obj) s += 2;
    if (obj.message && typeof obj.message === "object") {
      const m = obj.message as Record<string, unknown>;
      if (typeof m.role === "string") s += 1;
    }
    return s;
  },
  parse: parseClaude,
};
