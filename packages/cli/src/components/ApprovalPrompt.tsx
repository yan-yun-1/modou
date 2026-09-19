import { Box, Text, useInput } from "ink";
import type { ApprovalAnswer, ApprovalRequest } from "@luban/core";

export interface ApprovalPromptProps {
  request: ApprovalRequest;
  onAnswer: (answer: ApprovalAnswer) => void;
}

/** 审批卡片：y=允许本次，a=总是允许（写入 always-allow 规则），n=拒绝。 */
export function ApprovalPrompt({ request, onAnswer }: ApprovalPromptProps) {
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === "y") {
      onAnswer({ granted: true, remembered: false });
    } else if (key === "n") {
      onAnswer({ granted: false, remembered: false });
    } else if (key === "a") {
      onAnswer({ granted: true, remembered: true });
    }
  });

  const rawArgs = JSON.stringify(request.args) ?? "";
  const args = rawArgs.length > 200 ? `${rawArgs.slice(0, 200)}…` : rawArgs;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">⚠ 审批请求：{request.name}</Text>
      <Text>{request.reason}</Text>
      {args !== "{}" ? <Text dimColor>{args}</Text> : null}
      <Text>
        [<Text color="green">y</Text>=允许本次] [<Text color="green">a</Text>=总是允许] [
        <Text color="red">n</Text>=拒绝]
      </Text>
    </Box>
  );
}
