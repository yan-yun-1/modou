import { z } from "zod";

/**
 * 会话事件是整个引擎的唯一事实来源（append-only JSONL）。
 * 所有状态（消息历史、用量、审批记录）都从事件流重建，见 session.ts。
 */
const timestamp = z.number().int().nonnegative();

const args = z.unknown().optional();

export const lubanEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session_started"),
    sessionId: z.string().min(1),
    model: z.string().min(1),
    at: timestamp,
  }),
  z.object({ type: z.literal("user_message"), text: z.string(), at: timestamp }),
  z.object({ type: z.literal("assistant_message"), text: z.string(), at: timestamp }),
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
    costUsd: z.number().nonnegative(),
    at: timestamp,
  }),
  z.object({ type: z.literal("error"), message: z.string(), fatal: z.boolean(), at: timestamp }),
]);

export type LubanEvent = z.infer<typeof lubanEventSchema>;

export function parseEvent(value: unknown): LubanEvent {
  return lubanEventSchema.parse(value);
}

export function isLubanEvent(value: unknown): value is LubanEvent {
  return lubanEventSchema.safeParse(value).success;
}
