import { z } from "zod";

/**
 * 会话事件是整个引擎的唯一事实来源（append-only JSONL）。
 * 所有状态（消息历史、用量、审批记录）都从事件流重建，见 session.ts。
 */
const timestamp = z.number().int().nonnegative();

const args = z.unknown().optional();

export const modouEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session_started"),
    sessionId: z.string().min(1),
    model: z.string().min(1),
    at: timestamp,
  }),
  z.object({ type: z.literal("user_message"), text: z.string(), at: timestamp }),
  z.object({ type: z.literal("assistant_message"), text: z.string(), at: timestamp }),
  // 流式增量：仅用于 UI 实时显示，主循环不持久化（完整文本以 assistant_message 落盘）
  z.object({ type: z.literal("text_delta"), delta: z.string(), at: timestamp }),
  z.object({
    type: z.literal("tool_call"),
    id: z.string().min(1),
    name: z.string().min(1),
    args,
    at: timestamp,
  }),
  z.object({
    type: z.literal("tool_result"),
    id: z.string().min(1),
    output: z.string(),
    truncated: z.boolean(),
    at: timestamp,
  }),
  z.object({
    type: z.literal("approval_request"),
    id: z.string().min(1),
    name: z.string().min(1),
    args,
    reason: z.string(),
    // write/edit 的审批附带 unified diff（契约增补：plan-m1 I3）
    diff: z.string().optional(),
    at: timestamp,
  }),
  z.object({
    type: z.literal("approval_result"),
    id: z.string().min(1),
    granted: z.boolean(),
    remembered: z.boolean(),
    at: timestamp,
  }),
  z.object({
    type: z.literal("usage"),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    at: timestamp,
  }),
  z.object({ type: z.literal("error"), message: z.string(), fatal: z.boolean(), at: timestamp }),
  // 上下文压缩记录（契约增补：plan-m1 K2）
  z.object({
    type: z.literal("compaction"),
    summary: z.string(),
    originalMessageCount: z.number().int().nonnegative(),
    at: timestamp,
  }),
  // 子代理摘要记录（契约增补：plan-m2 P1/P2）
  z.object({
    type: z.literal("subagent"),
    name: z.string().min(1),
    summary: z.string(),
    at: timestamp,
  }),
]);

export type ModouEvent = z.infer<typeof modouEventSchema>;

export function parseEvent(value: unknown): ModouEvent {
  return modouEventSchema.parse(value);
}

export function isModouEvent(value: unknown): value is ModouEvent {
  return modouEventSchema.safeParse(value).success;
}
