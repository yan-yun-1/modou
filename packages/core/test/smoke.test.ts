import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

describe("@modou/core smoke", () => {
  it("exports a semver VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[a-z]+(?:\.\d+)?)?$/); // 预发布后缀可带序号（0.6.0-alpha.1）
  });
});
