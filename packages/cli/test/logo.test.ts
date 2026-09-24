import { describe, expect, it, vi } from "vitest";
import { printLogo, shouldPrintLogo } from "../src/logo.js";

// eslint-disable-next-line no-control-regex -- 测试断言 ANSI 转义序列必须写字面控制字符
const ANSI = /\u001B\[/g;

describe("printLogo（L1）", () => {
  it("prints 6 lines (MO only) with correct ANSI codes and resets", () => {
    const out: string[] = [];
    const write = (s: string) => out.push(s);
    printLogo({ colorLevel: 3, write });

    expect(out).toHaveLength(6);
    // 字母行亮蓝（94）
    expect(out[0]).toContain("\x1b[94m  ███╗   ███╗ ██████╗\x1b[0m");
    expect(out[5]).toContain("\x1b[94m");
    // 每行行尾复位
    for (const line of out) {
      expect(line.endsWith("\x1b[0m\n")).toBe(true);
    }
    // 不再包含分隔线/品牌文字行
    expect(out.join("")).not.toContain("墨斗 · MODOU");
    expect(out.join("")).not.toContain("────");
  });

  it("falls back to plain text when colors are unsupported", () => {
    const out: string[] = [];
    const write = (s: string) => out.push(s);
    printLogo({ colorLevel: 0, write });

    expect(out).toHaveLength(6);
    expect(out.join("")).not.toMatch(ANSI);
    expect(out.join("")).not.toContain("墨斗 · MODOU");
  });

  it("writes to stderr by default (keeps stdout pipes clean)", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    printLogo({ colorLevel: 0 });
    expect(stderrSpy).toHaveBeenCalledTimes(6);
    stderrSpy.mockRestore();
  });

  it("writes to a custom stream when provided", () => {
    const out: string[] = [];
    printLogo({ colorLevel: 1, write: (s) => out.push(s) });
    expect(out).toHaveLength(6);
  });
});

describe("shouldPrintLogo（--no-logo）", () => {
  it("prints unless --no-logo is set", () => {
    expect(shouldPrintLogo(undefined)).toBe(true);
    expect(shouldPrintLogo(false)).toBe(true);
    expect(shouldPrintLogo(true)).toBe(false);
  });
});
