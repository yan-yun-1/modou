import { generateText, type LanguageModel, type ModelMessage } from "ai";

/** 触发压缩的窗口占用阈值 */
const COMPACTION_THRESHOLD = 0.8;
/** 压缩时原样保留的最近消息条数 */
const KEEP_LAST = 6;

/** 粗估 token 数：按 4 字符/token 对整段消息做保守估算 */
export function estimateTokens(messages: ModelMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

export function needsCompaction(
  messages: ModelMessage[],
  contextWindow: number,
  threshold = COMPACTION_THRESHOLD,
): boolean {
  return estimateTokens(messages) > contextWindow * threshold;
}

const SUMMARY_SYSTEM = "你是会话压缩器。把对话历史压缩成简明摘要，供后续工作继续使用。";

function serialize(messages: ModelMessage[]): string {
  return messages
    .map((message) => {
      const text =
        typeof message.content === "string" ? message.content : JSON.stringify(message.content);
      return `[${message.role}] ${text}`;
    })
    .join("\n");
}

/**
 * 压缩历史：老消息交给同一模型生成摘要，新历史 = [摘要（user 消息）] + 最近消息。
 * 摘要调用失败向上抛出，由主循环降级处理。
 * 注意：单条超长消息也压缩（保留原文会继续撑爆窗口），此时历史替换为纯摘要。
 */
export async function compactMessages(options: {
  messages: ModelMessage[];
  model: LanguageModel;
  keepLast?: number;
}): Promise<{ messages: ModelMessage[]; summary: string; originalCount: number }> {
  const { messages, model } = options;
  const keepLast = options.keepLast ?? KEEP_LAST;
  const keepCount = Math.min(keepLast, Math.max(0, messages.length - 1));
  if (messages.length === 0) {
    return { messages, summary: "", originalCount: 0 };
  }

  const older = messages.slice(0, messages.length - keepCount);
  const recent = messages.slice(messages.length - keepCount);

  const { text } = await generateText({
    model,
    maxRetries: 0,
    // v7：system 指令走 instructions 选项（messages 中的 system 角色会被拒绝）
    instructions: SUMMARY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `请把以下对话历史压缩为摘要，必须保留：当前任务目标、已做出的关键决策、涉及过的文件路径、尚未完成的事项。\n\n对话历史：\n${serialize(older)}`,
      },
    ],
  });

  const summary = text.trim();
  const compacted: ModelMessage[] = [
    { role: "user", content: `[会话摘要——此前对话的压缩记录]\n${summary}` },
    ...recent,
  ];
  return { messages: compacted, summary, originalCount: messages.length };
}
