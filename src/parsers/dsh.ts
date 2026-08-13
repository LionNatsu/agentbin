import type { Block, Event, Parser, SessionIR } from "../ir";
import { msToIso } from "../util";
import { contentToText } from "./helpers";

/**
 * DeepSeek Harness (DSH) sessions — `~/.dsh/sessions/<cwd>/<sid>/session.jsonl(.zstd)`.
 *
 * Line types are namespaced with `/` and carry `{ seq, time(ms), data }`:
 *   session            header (version, id, createdAt, cwd, delegationDepth)
 *   session/title      display title
 *   request/header     model config (data.header.config.model)
 *   user/message       user turn (data.content[].text)
 *   assistant/message  assembled assistant turn (content[]: reasoning | text)
 *   tool/call          { callId, name, arguments(JSON string) }
 *   tool/result        result matched to tool/call by callId
 * plus streaming chunk + boundary/approval/command events we ignore.
 *
 * The on-disk artifact is zstd-compressed concatenated frames; decompression is
 * handled at the HTTP layer (`src/zstd.ts`), so this parser only sees JSONL.
 */

export function parseDsh(lines: string[]): SessionIR {
  const events: Event[] = [];
  const ir: SessionIR = { format: "dsh", events };
  let lastModel: string | undefined;

  let currentKey: string | null = null;
  let currentBlocks: Block[] | null = null;
  let currentModel: string | undefined;
  let currentTs: string | undefined;

  const flush = () => {
    if (currentBlocks && currentBlocks.length) {
      events.push({
        kind: "assistant",
        blocks: currentBlocks,
        model: currentModel,
        ts: currentTs,
      });
    }
    currentBlocks = null;
    currentKey = null;
    currentModel = undefined;
    currentTs = undefined;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const type = typeof o.type === "string" ? o.type : "";
    if (!type) continue;

    const data = (o.data ?? {}) as Record<string, unknown>;
    const ts = msToIso(o.time);

    if (type === "session") {
      const sessionId = str(o.id);
      const cwd = str(o.cwd);
      if (sessionId) ir.sessionId ??= sessionId;
      if (cwd) ir.cwd ??= cwd;
      if (typeof o.createdAt === "number") {
        ir.startedAt ??= new Date(o.createdAt).toISOString();
      }
      continue;
    }

    if (type === "session/title") {
      const title = str(data.title);
      if (title) ir.title ??= title;
      continue;
    }

    if (type === "request/header") {
      const header = (data.header ?? {}) as Record<string, unknown>;
      const config = (header.config ?? {}) as Record<string, unknown>;
      const model = str(config.model);
      if (model) {
        lastModel = model;
        ir.model ??= model;
      }
      continue;
    }

    if (type === "user/message") {
      flush();
      const text = contentToText(data.content).trim();
      if (text) events.push({ kind: "user", text, ts });
      continue;
    }

    if (type === "assistant/message") {
      const key = keyOf(data);
      if (key !== currentKey) {
        flush();
        currentKey = key;
        currentBlocks = [];
        currentModel = lastModel;
        currentTs = ts;
      }
      const message = (data.message ?? {}) as Record<string, unknown>;
      for (const part of asArray(message.content)) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        if (p.type === "text" && typeof p.text === "string" && p.text) {
          currentBlocks!.push({ kind: "text", text: p.text });
        } else if (p.type === "reasoning" && typeof p.text === "string" && p.text) {
          currentBlocks!.push({ kind: "thinking", text: p.text });
        }
      }
      continue;
    }

    if (type === "tool/call") {
      const key = keyOf(data);
      if (key !== currentKey) {
        flush();
        currentKey = key;
        currentBlocks = [];
        currentModel = lastModel;
        currentTs = ts;
      }
      currentBlocks!.push({
        kind: "toolUse",
        id: str(data.callId),
        name: str(data.name) || "tool",
        input: parseArgs(data.arguments),
      });
      continue;
    }

    if (type === "tool/result") {
      const message = (data.message ?? {}) as Record<string, unknown>;
      const source = (message.source ?? {}) as Record<string, unknown>;
      const callId = str(source.callId);
      let text = "";
      let isError = false;
      for (const part of asArray(message.content)) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        if (p.type !== "tool-result") continue;
        isError = p.isError === true;
        text = contentToText(p.content);
        break;
      }
      events.push({ kind: "toolResult", toolUseId: callId, content: text, isError, ts });
      continue;
    }

    // turn/start, step/start, reasoning-chunks, text-chunks, assistant/chunk,
    // tool-call-chunks, todo/write, approval/*, command/*, permission/preset,
    // sandbox/mode, … are non-conversational or redundant with the above.
  }

  flush();
  return ir;
}

function keyOf(data: Record<string, unknown>): string {
  return `${data.turn ?? "?"}:${data.step ?? "?"}`;
}

function parseArgs(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export const dshParser: Parser = {
  id: "dsh",
  label: "DeepSeek Harness",
  sniff(obj) {
    const t = obj.type;
    if (typeof t !== "string") return 0;
    let s = 0;
    if (t === "session" && typeof obj.createdAt === "number" && "delegationDepth" in obj) s += 10;
    if (t.includes("/")) s += 6;
    if ("seq" in obj && typeof obj.time === "number") s += 2;
    if ("data" in obj && typeof obj.data === "object" && obj.data !== null) s += 1;
    return s;
  },
  parse: parseDsh,
};
