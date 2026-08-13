import type { Usage } from "../ir";

/** Join heterogeneous content (string | block array) into plain text. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") parts.push(p.text);
      } else if (typeof part === "string") {
        parts.push(part);
      }
    }
    return parts.join("\n");
  }
  return "";
}

export function anthropicUsage(u: unknown): Usage | undefined {
  if (!u || typeof u !== "object") return undefined;
  const o = u as Record<string, unknown>;
  const input = num(o.input_tokens);
  const output = num(o.output_tokens);
  const cacheRead = num(o.cache_read_input_tokens);
  const cacheWrite = num(o.cache_creation_input_tokens);
  if (input === undefined && output === undefined) return undefined;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: sum(input, output, cacheRead, cacheWrite),
  };
}

export function piUsage(u: unknown): Usage | undefined {
  if (!u || typeof u !== "object") return undefined;
  const o = u as Record<string, unknown>;
  const total = num(o.totalTokens);
  const input = num(o.input);
  const output = num(o.output);
  if (total === undefined && input === undefined && output === undefined) return undefined;
  return { input, output, total };
}

export function codebuddyUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const input = num(o.prompt_tokens);
  const output = num(o.completion_tokens);
  const cacheRead = num(o.cache_read_input_tokens);
  const cacheWrite = num(o.cache_creation_input_tokens);
  if (input === undefined && output === undefined) return undefined;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: sum(input, output, cacheRead, cacheWrite),
  };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function sum(...vals: (number | undefined)[]): number | undefined {
  let total = 0;
  let any = false;
  for (const v of vals) {
    if (v !== undefined) {
      total += v;
      any = true;
    }
  }
  return any ? total : undefined;
}
