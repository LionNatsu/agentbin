import type { Parser, SessionIR } from "../ir";
import { pairToolResults } from "../ir";
import { claudeParser } from "./claude";
import { codebuddyParser } from "./codebuddy";
import { dshParser } from "./dsh";
import { piParser } from "./pi";

export const PARSERS: Parser[] = [piParser, claudeParser, codebuddyParser, dshParser];

export function labelOf(format: string): string {
  return PARSERS.find((p) => p.id === format)?.label ?? format;
}

export interface ParseOutcome {
  format: string;
  ir: SessionIR;
}

export function detectParser(lines: string[]): Parser | null {
  const scores = new Map<string, number>();
  let parsed = 0;
  const limit = Math.min(lines.length, 60);

  for (let i = 0; i < limit; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
    parsed++;
    for (const p of PARSERS) {
      const s = p.sniff(obj as Record<string, unknown>);
      if (s > 0) scores.set(p.id, (scores.get(p.id) ?? 0) + s);
    }
  }

  if (parsed === 0) return null;

  let best: Parser | null = null;
  let bestScore = 0;
  for (const p of PARSERS) {
    const s = scores.get(p.id) ?? 0;
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return best;
}

export function parseSession(text: string): ParseOutcome {
  const lines = text.split(/\r?\n/);
  const parser = detectParser(lines);
  if (!parser) {
    throw new Error(
      "Could not recognize this as a supported JSONL session (Claude Code, CodeBuddy Code, or Pi).",
    );
  }
  const ir = parser.parse(lines);
  pairToolResults(ir);
  return { format: parser.id, ir };
}
