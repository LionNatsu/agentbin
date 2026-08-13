/**
 * Normalized intermediate representation (IR).
 *
 * Every parser (Claude Code / CodeBuddy Code / Pi / ...) reduces its native
 * JSONL dialect into this single, renderer-friendly shape. Adding a new agent
 * is just: write a `Parser`, register it in `parsers/index.ts`, done.
 */

export interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface ToolUseBlock {
  kind: "toolUse";
  /** Format-native call id used to pair the result onto this block. */
  id: string;
  name: string;
  input: unknown;
  /** Filled in by `pairToolResults` when a matching tool result is found. */
  result?: ToolResult;
}

export type Block =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | ToolUseBlock;

export type Event =
  | { kind: "user"; text: string; ts?: string }
  | { kind: "assistant"; blocks: Block[]; model?: string; ts?: string; usage?: Usage }
  | {
      kind: "toolResult";
      toolUseId?: string;
      name?: string;
      content: string;
      isError?: boolean;
      ts?: string;
    }
  | { kind: "output"; title: string; body: string; isError?: boolean; ts?: string }
  | { kind: "system"; text: string; ts?: string; level?: "info" | "warn" | "error" }
  | { kind: "note"; text: string; ts?: string; icon?: string };

export interface SessionIR {
  /** Detected format id, e.g. "claude-code" | "codebuddy" | "pi". */
  format: string;
  title?: string;
  cwd?: string;
  gitBranch?: string;
  model?: string;
  sessionId?: string;
  startedAt?: string;
  events: Event[];
}

export interface Parser {
  /** Stable id, stored in the DB. */
  id: string;
  /** Human-facing label, shown on the page badge. */
  label: string;
  /**
   * How strongly one parsed JSON line looks like this format. Scores are
   * summed across a sample of lines and the highest wins detection.
   */
  sniff(line: Record<string, unknown>): number;
  parse(lines: string[]): SessionIR;
}

/**
 * Merge standalone `toolResult` events into the `toolUse` block they belong to
 * (matched by id). Leftover results become standalone `output` cards.
 * Mutates and returns `ir` for convenience.
 */
export function pairToolResults(ir: SessionIR): SessionIR {
  const byId = new Map<string, ToolUseBlock>();
  for (const ev of ir.events) {
    if (ev.kind !== "assistant") continue;
    for (const b of ev.blocks) {
      if (b.kind === "toolUse" && b.id) byId.set(b.id, b);
    }
  }

  const out: Event[] = [];
  for (const ev of ir.events) {
    if (ev.kind !== "toolResult") {
      out.push(ev);
      continue;
    }
    const target = ev.toolUseId ? byId.get(ev.toolUseId) : undefined;
    if (target && !target.result) {
      target.result = { content: ev.content, isError: ev.isError };
      continue;
    }
    // Orphaned result (no matching call) — still worth showing.
    out.push({
      kind: "output",
      title: ev.name ? `${ev.name} · result` : "result",
      body: ev.content,
      isError: ev.isError,
      ts: ev.ts,
    });
  }
  ir.events = out;
  return ir;
}
