import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/program.js";
import { VERSION } from "@modou/core";

describe("modou CLI", () => {
  it("reports the core version via --version", () => {
    expect(buildProgram().version()).toBe(VERSION);
  });

  it("registers the `model` subcommand for re-selection", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toContain("model");
  });

  it("registers the `init` subcommand (A1)", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toContain("init");
  });

  it("registers the -p headless option (E3)", () => {
    const opts = buildProgram().options.map((o) => o.short);
    expect(opts).toContain("-p");
  });
});
