import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/program.js";
import { VERSION } from "@luban/core";

describe("luban CLI", () => {
  it("reports the core version via --version", () => {
    expect(buildProgram().version()).toBe(VERSION);
  });
});
