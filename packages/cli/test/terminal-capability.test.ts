import { describe, expect, it } from "vitest";
import {
  detectColorLevel,
  resetTerminalStyleCache,
  terminalStyle,
} from "../src/terminal-capability.js";

describe("detectColorLevel（C1 颜色分级）", () => {
  it("NO_COLOR wins over everything", () => {
    expect(detectColorLevel({ NO_COLOR: "1", WT_SESSION: "x" })).toBe(0);
  });

  it("FORCE_COLOR forces truecolor", () => {
    expect(detectColorLevel({ FORCE_COLOR: "3" })).toBe(3);
  });

  it("detects Windows Terminal", () => {
    expect(detectColorLevel({ WT_SESSION: "abc" })).toBe(3);
  });

  it("detects vscode terminal", () => {
    expect(detectColorLevel({ TERM_PROGRAM: "vscode" })).toBe(3);
  });

  it("detects ANSICON / ConEmu as 256-color", () => {
    expect(detectColorLevel({ ANSICON: "1" })).toBe(2);
    expect(detectColorLevel({ ConEmuANSI: "ON" })).toBe(2);
  });

  it("parses TERM", () => {
    expect(detectColorLevel({ TERM: "xterm-256color" })).toBe(3);
    expect(detectColorLevel({ TERM: "xterm" })).toBe(2);
  });

  it("falls back to 16-color for bare conhost (no signals)", () => {
    expect(detectColorLevel({})).toBe(1);
  });
});

describe("terminalStyle（渲染降级表）", () => {
  it("rich env: native dim + cyan border + glyph spinner", () => {
    resetTerminalStyleCache();
    const s = terminalStyle({ WT_SESSION: "1" });
    expect(s.level).toBe(3);
    expect(s.style.dim).toBeUndefined();
    expect(s.style.border).toBe("cyan");
    expect(s.glyphs.spinner).toContain("✻");
    expect(s.glyphs.barEmpty).toBe("░");
  });

  it("bare conhost: gray instead of dim, blue border, plain spinner", () => {
    resetTerminalStyleCache();
    const s = terminalStyle({});
    expect(s.level).toBe(1);
    expect(s.style.dim).toBe("gray");
    expect(s.style.border).toBe("blue");
    expect(s.glyphs.spinner).toEqual(["|", "/", "-", "\\"]);
    expect(s.glyphs.barEmpty).toBe("─");
    expect(s.glyphs.planIcon).toBe("[计划]");
  });

  it("caches the singleton for process.env", () => {
    resetTerminalStyleCache();
    const a = terminalStyle();
    const b = terminalStyle();
    expect(a).toBe(b);
    resetTerminalStyleCache();
  });
});
