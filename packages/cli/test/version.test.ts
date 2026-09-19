import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/program.js";
import { VERSION } from "@luban/core";

describe("luban CLI", () => {
  it("reports the core version via --version", () => {
    expect(buildProgram().version()).toBe(VERSION);
  });

  it("registers the `model` subcommand for re-selection", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toContain("model");
  });
});
