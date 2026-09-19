import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editTool } from "../src/tools/edit.js";
import type { ToolContext } from "../src/tools/types.js";

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-edit-"));
  ctx = { cwd: dir, signal: new AbortController().signal };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seedFile(name: string, content: string) {
  await writeFile(join(dir, name), content, "utf8");
  return name;
}

describe("edit tool", () => {
  it("replaces a unique match and reports the count", async () => {
    const name = await seedFile("a.ts", "function one() {}\nfunction two() {}\n");
    const result = await editTool.run(
      { path: name, old_text: "function two() {}", new_text: "function twoUpdated() {}" },
      ctx,
    );
    expect(result.output).toContain("1 处");
    expect(await readFile(join(dir, name), "utf8")).toBe(
      "function one() {}\nfunction twoUpdated() {}\n",
    );
  });

  it("rejects ambiguous matches listing every hit line", async () => {
    const name = await seedFile("dup.ts", "let x = 1;\nlet x = 1;\nlet x = 1;\n");
    await expect(
      editTool.run({ path: name, old_text: "let x = 1;", new_text: "let y = 1;" }, ctx),
    ).rejects.toThrow(/第 1、2、3 行/);
    expect(await readFile(join(dir, name), "utf8")).toBe("let x = 1;\nlet x = 1;\nlet x = 1;\n");
  });

  it("replace_all replaces every occurrence", async () => {
    const name = await seedFile("all.ts", "foo();\nfoo();\n");
    const result = await editTool.run(
      { path: name, old_text: "foo()", new_text: "bar()", replace_all: true },
      ctx,
    );
    expect(result.output).toContain("2 处");
    expect(await readFile(join(dir, name), "utf8")).toBe("bar();\nbar();\n");
  });

  it("suggests the closest candidate on zero hits", async () => {
    const name = await seedFile(
      "near.ts",
      "function calculateTotal(price, count) {\n  return price * count;\n}\n",
    );
    await expect(
      editTool.run(
        { path: name, old_text: "function calculateTotl(price, count) {", new_text: "x" },
        ctx,
      ),
    ).rejects.toThrow(/第 1 行/);
  });

  it("tolerates CRLF line endings by normalizing to LF", async () => {
    const name = await seedFile("crlf.ts", "function a() {\r\n  return 1;\r\n}\r\n");
    const result = await editTool.run(
      {
        path: name,
        old_text: "function a() {\n  return 1;\n}",
        new_text: "function a() {\n  return 2;\n}",
      },
      ctx,
    );
    expect(result.output).toContain("LF");
    const updated = await readFile(join(dir, name), "utf8");
    expect(updated).toBe("function a() {\n  return 2;\n}\n".replace(/\n/g, "\n"));
    expect(updated.includes("\r")).toBe(false);
  });

  it("gives a readable error for missing files", async () => {
    await expect(
      editTool.run({ path: "nope.ts", old_text: "a", new_text: "b" }, ctx),
    ).rejects.toThrow(/不存在/);
  });

  it("is registered as kind write so the permission engine gates it", () => {
    expect(editTool.kind).toBe("write");
  });

  it("preview returns the applied diff for a valid unique match", async () => {
    const name = await seedFile("p.ts", "function one() {}\nfunction two() {}\n");
    const preview = await editTool.preview?.(
      { path: name, old_text: "function two() {}", new_text: "function twoV2() {}" },
      ctx,
    );
    expect(preview).toContain("-function two() {}");
    expect(preview).toContain("+function twoV2() {}");
  });

  it("preview returns null when the edit would be rejected (ambiguous match)", async () => {
    const name = await seedFile("amb.ts", "let x = 1;\nlet x = 1;\n");
    const preview = await editTool.preview?.(
      { path: name, old_text: "let x = 1;", new_text: "let y = 1;" },
      ctx,
    );
    expect(preview).toBeNull();
  });
});
