// M4 验收 1：第三方约 10 行嵌入 —— npm install @modou-dev/sdk 后运行本示例
// 前置：已运行 modou 完成配置（~/.modou/settings.json）
import { createSession } from "@modou-dev/sdk";

const session = await createSession();
console.log("会话:", session.sessionId, "| MCP:", session.mcpStatus.map((s) => s.name).join(", ") || "无");

for await (const event of session.run("用一句话介绍你自己")) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
  if (event.type === "assistant_message") console.log("\n[完整回复]");
  if (event.type === "approval_request") {
    // 审批策略按需定制：这里是全部放行并记住
    await session.approvals.answerById(event.id, { granted: true, remembered: true });
  }
  if (event.type === "error") console.error("[错误]", event.message);
}
await session.close();
