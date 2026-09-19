import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../src/diff.js";

describe("unifiedDiff", () => {
  it("returns empty string for identical content", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n")).toBe("");
  });

  it("marks pure additions with + and hunk headers", () => {
    const diff = unifiedDiff("a\n", "a\nb\n");
    expect(diff).toContain("+b");
    expect(diff).not.toContain("-a");
    expect(diff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it("marks removals with - and keeps context lines", () => {
    const diff = unifiedDiff("one\ntwo\nthree\n", "one\nTWO\nthree\n");
    expect(diff).toContain(" one");
    expect(diff).toContain("-two");
    expect(diff).toContain("+TWO");
    expect(diff).toContain(" three");
  });

  it("shows all additions for a new file", () => {
    const diff = unifiedDiff("", "line1\nline2\n");
    expect(diff).toContain("+line1");
    expect(diff).toContain("+line2");
  });

  it("collapses distant changes into separate hunks", () => {
    const before = Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l1", "CHANGED1").replace("l35", "CHANGED35");
    const diff = unifiedDiff(before, after);
    expect(diff.match(/^@@/gm)?.length).toBe(2);
  });

  it("omits the body for very large files", () => {
    const big = Array.from({ length: 6000 }, (_, i) => `l${i}`).join("\n");
    expect(unifiedDiff(big, `${big}\nnew`)).toContain("过大");
  });
});
