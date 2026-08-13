import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSession } from "../src/parsers";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dir, "..", "fixtures", name), "utf8");
}

describe("format detection", () => {
  test("detects Claude Code", () => {
    expect(parseSession(fixture("claude-code.jsonl")).format).toBe("claude-code");
  });
  test("detects CodeBuddy Code", () => {
    expect(parseSession(fixture("codebuddy.jsonl")).format).toBe("codebuddy");
  });
  test("detects Pi", () => {
    expect(parseSession(fixture("pi.jsonl")).format).toBe("pi");
  });
  test("rejects garbage", () => {
    expect(() => parseSession("hello\nworld\n")).toThrow();
  });
});

describe("claude-code parsing", () => {
  const ir = parseSession(fixture("claude-code.jsonl")).ir;

  test("extracts metadata", () => {
    expect(ir.title).toBe("Fix the login bug");
    expect(ir.cwd).toBe("/Users/ada/app");
    expect(ir.model).toBe("claude-sonnet-4-5");
    expect(ir.gitBranch).toBe("main");
  });

  test("pairs tool result onto the tool_use block", () => {
    const assistant = ir.events.find((e) => e.kind === "assistant");
    expect(assistant).toBeDefined();
    if (assistant?.kind !== "assistant") throw new Error("expected assistant");
    const tool = assistant.blocks.find((b) => b.kind === "toolUse");
    expect(tool?.kind).toBe("toolUse");
    if (tool?.kind !== "toolUse") throw new Error("expected toolUse");
    expect(tool.name).toBe("Bash");
    expect(tool.result?.content).toContain("1 failing");
    // The standalone toolResult event should have been consumed.
    expect(ir.events.some((e) => e.kind === "toolResult")).toBe(false);
  });
});

describe("codebuddy parsing", () => {
  const ir = parseSession(fixture("codebuddy.jsonl")).ir;

  test("groups one assistant turn from message+reasoning+function_call", () => {
    const assistants = ir.events.filter((e) => e.kind === "assistant");
    expect(assistants.length).toBe(1);
    const blocks = (assistants[0] as Extract<typeof assistants[0], { kind: "assistant" }>).blocks;
    expect(blocks.some((b) => b.kind === "text")).toBe(true);
    expect(blocks.some((b) => b.kind === "thinking")).toBe(true);
    const tool = blocks.find((b) => b.kind === "toolUse");
    if (tool?.kind !== "toolUse") throw new Error("expected toolUse");
    expect(tool.name).toBe("Edit");
    expect(tool.result?.content).toBe("Updated src/index.ts");
  });

  test("captures topic as title", () => {
    expect(ir.title).toBe("Add health endpoint");
  });
});

describe("pi parsing", () => {
  const ir = parseSession(fixture("pi.jsonl")).ir;

  test("extracts session metadata and pairs tool result", () => {
    expect(ir.sessionId).toBe("pi-sess-1");
    expect(ir.cwd).toBe("/home/dev/tool");
    const assistant = ir.events.find((e) => e.kind === "assistant");
    if (assistant?.kind !== "assistant") throw new Error("expected assistant");
    const tool = assistant.blocks.find((b) => b.kind === "toolUse");
    if (tool?.kind !== "toolUse") throw new Error("expected toolUse");
    expect(tool.name).toBe("bash");
    expect(tool.result?.content).toContain("total 8");
  });
});
