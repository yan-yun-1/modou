import { Box, Text, useInput } from "ink";
import type { ApprovalAnswer, ApprovalRequest } from "@luban/core";

export interface ApprovalPromptProps {
  request: ApprovalRequest;
  onAnswer: (answer: ApprovalAnswer) => void;
}

const MAX_DIFF_LINES = 40;

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  const truncated = lines.length > MAX_DIFF_LINES;
  const visible = truncated ? lines.slice(0, MAX_DIFF_LINES) : lines;
  return (
    <Box flexDirection="column">
      {visible.map((line, i) => {
        if (line.startsWith("+")) {
          return (
            <Text key={i} color="green">
              {line}
            </Text>
          );
        }
        if (line.startsWith("-")) {
          return (
            <Text key={i} color="red">
              {line}
            </Text>
          );
        }
        return (
          <Text key={i} dimColor>
            {line}
          </Text>
        );
      })}
      {truncated ? (
        <Text dimColor>…（diff 过长，已截断 {lines.length - MAX_DIFF_LINES} 行）</Text>
      ) : null}
    </Box>
  );
}

/** 审批卡片：y=允许本次，a=总是允许（写入 always-allow 规则），n=拒绝。write/edit 附带 unified diff。 */
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
      {request.diff ? <DiffView diff={request.diff} /> : null}
      {args !== "{}" && !request.diff ? <Text dimColor>{args}</Text> : null}
      <Text>
        [<Text color="green">y</Text>=允许本次] [<Text color="green">a</Text>=总是允许] [
        <Text color="red">n</Text>=拒绝]
      </Text>
    </Box>
  );
}
