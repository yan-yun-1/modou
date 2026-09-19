import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Tool, ToolContext } from "../src/tools/types.js";
import { ToolRegistry } from "../src/tools/registry.js";

function makeTool(name: string, result = "ok"): Tool<{ x: number }> {
  return {
    name,
    description: `${name} 工具`,
    kind: "read",
    schema: z.object({ x: z.number() }),
    async run(args) {
      return { output: `${result}:${args.x}` };
    },
  };
}

const ctx: ToolContext = { cwd: process.cwd(), signal: new AbortController().signal };

describe("ToolRegistry", () => {
  it("registers, lists and retrieves tools", () => {
    const registry = new ToolRegistry();
    const a = makeTool("a");
    const b = makeTool("b");
    registry.register(a);
    registry.register(b);
    expect(registry.get("a")).toBe(a);
    expect(registry.list()).toEqual([a, b]);
  });

  it("rejects duplicate tool names", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("dup"));
    expect(() => registry.register(makeTool("dup"))).toThrow(/dup/);
  });

  it("rejects unknown tools with a listing of available names", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("known"));
    await expect(registry.validateAndRun("unknown", {}, ctx)).rejects.toThrow(/known/);
  });

  it("rejects arguments that fail the tool schema, with a readable message", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("strict"));
    await expect(registry.validateAndRun("strict", { x: "not-a-number" }, ctx)).rejects.toThrow(
      /strict/,
    );
  });

  it("runs a tool with validated args", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("calc", "result"));
    const result = await registry.validateAndRun("calc", { x: 42 }, ctx);
    expect(result).toEqual({ output: "result:42" });
  });
});
