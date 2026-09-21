import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

describe("@modou/core smoke", () => {
  it("exports a semver VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
