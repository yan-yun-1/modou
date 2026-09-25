import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

describe("@modou/core smoke", () => {
  it("exports a semver VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[a-z]+)?$/); // 0.5.0-alpha 起 release 用预发布后缀
  });
});
