import { describe, expect, it } from "vitest";
import type { UsageTotals } from "@luban/core";
import { parseCommand } from "../src/commands.js";

const usage: UsageTotals = {
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 20,
  cacheWriteTokens: 0,
  costUsd: 0.000315,
};

describe("parseCommand", () => {
  it("passes plain input through to the model", () => {
    expect(parseCommand("修复登录 bug", usage)).toEqual({ action: "none" });
  });

  it("shows cost detail for /cost", () => {
    const result = parseCommand("/cost", usage);
    expect(result).toMatchObject({ action: "message" });
    expect((result as { text: string }).text).toContain("100");
    expect((result as { text: string }).text).toContain("0.000315");
  });

  it("exits on /exit and /quit", () => {
    expect(parseCommand("/exit", usage)).toEqual({ action: "exit" });
    expect(parseCommand("/quit", usage)).toEqual({ action: "exit" });
  });

  it("lists available commands for /help and unknown commands", () => {
    expect(parseCommand("/help", usage)).toMatchObject({ action: "message" });
    const unknown = parseCommand("/whatever", usage);
    expect(unknown).toMatchObject({ action: "message" });
    expect((unknown as { text: string }).text).toContain("/cost");
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(parseCommand("  /EXIT  ", usage)).toEqual({ action: "exit" });
  });

  it("parses /checkpoints", () => {
    expect(parseCommand("/checkpoints", usage)).toEqual({ action: "checkpoints" });
  });

  it("parses /rollback with a number", () => {
    expect(parseCommand("/rollback 2", usage)).toEqual({ action: "rollback", n: 2 });
  });

  it("rejects /rollback without a valid number", () => {
    const result = parseCommand("/rollback", usage);
    expect(result).toMatchObject({ action: "message" });
    expect((result as { text: string }).text).toContain("用法");
    expect(parseCommand("/rollback abc", usage)).toMatchObject({ action: "message" });
  });

  it("parses /sessions, /resume <id> and /model", () => {
    expect(parseCommand("/sessions", usage)).toEqual({ action: "sessions" });
    expect(parseCommand("/resume s-abc", usage)).toEqual({ action: "resume", id: "s-abc" });
    expect(parseCommand("/model", usage)).toEqual({ action: "model" });
  });

  it("rejects /resume without an id", () => {
    const result = parseCommand("/resume", usage);
    expect(result).toMatchObject({ action: "message" });
    expect((result as { text: string }).text).toContain("用法");
  });
});

describe("/mcp", () => {
  it("parses", () => {
    expect(parseCommand("/mcp", usage)).toEqual({ action: "mcp" });
  });
});
