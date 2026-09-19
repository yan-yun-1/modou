import { describe, expect, it } from "vitest";
import { settingsSchema } from "../src/settings.js";

describe("mcpServers setting", () => {
  it("accepts stdio and http server configs", () => {
    const parsed = settingsSchema.parse({
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      permissionMode: "default",
      mcpServers: {
        fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
        remote: { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
      },
    });
    expect(parsed.mcpServers?.fs).toMatchObject({ command: "npx" });
    expect(parsed.mcpServers?.remote).toMatchObject({ url: "https://example.com/mcp" });
  });

  it("rejects entries without command or url", () => {
    expect(() =>
      settingsSchema.parse({
        provider: "anthropic",
        modelId: "x",
        permissionMode: "default",
        mcpServers: { bad: {} },
      }),
    ).toThrow();
  });
});
