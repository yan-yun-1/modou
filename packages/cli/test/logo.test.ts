import { describe, expect, it, vi } from "vitest";
import { printLogo, shouldPrintLogo } from "../src/logo.js";

const ANSI = /\u001B\[/g;

describe("printLogo（L1）", () => {
  it("prints 7 lines with correct ANSI codes and resets", () => {
    const out: string[] = [];
    const write = (s: string) => out.push(s);
    printLogo({ colorLevel: 3, write });

    expect(out).toHaveLength(7);
    // 字母行亮蓝（94）
    expect(out[0]).toContain("\x1b[94m  ███╗   ███╗ ██████╗\x1b[0m");
    expect(out[3]).toContain("\x1b[94m");
    // 底部行亮黄（93），含品牌文字
    expect(out[6]).toContain("\x1b[93m");
    expect(out[6]).toContain("墨斗 · MODOU");
    // 每行行尾复位
    for (const line of out) {
      expect(line.endsWith("\x1b[0m\n")).toBe(true);
    }
    // 分隔线在底部行内（93 与文字同色，符合素材）
    expect(out[6]).toContain("────");
  });

  it("falls back to plain text when colors are unsupported", () => {
    const out: string[] = [];
    const write = (s: string) => out.push(s);
    printLogo({ colorLevel: 0, write });

    expect(out).toHaveLength(7);
    expect(out.join("")).not.toMatch(ANSI);
    expect(out[6]).toContain("墨斗 · MODOU");
  });

  it("writes to stderr by default (keeps stdout pipes clean)", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    printLogo({ colorLevel: 0 });
    expect(stderrSpy).toHaveBeenCalledTimes(7);
    stderrSpy.mockRestore();
  });

  it("writes to a custom stream when provided", () => {
    const out: string[] = [];
    printLogo({ colorLevel: 1, write: (s) => out.push(s) });
    expect(out).toHaveLength(7);
  });
});

describe("shouldPrintLogo（--no-logo）", () => {
  it("prints unless --no-logo is set", () => {
    expect(shouldPrintLogo(undefined)).toBe(true);
    expect(shouldPrintLogo(false)).toBe(true);
    expect(shouldPrintLogo(true)).toBe(false);
  });
});
