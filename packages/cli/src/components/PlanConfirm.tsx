import { Box, Text, useInput } from "ink";
import { terminalStyle } from "../terminal-capability.js";

export interface PlanConfirmProps {
  task: string;
  plan: string;
  onApprove: () => void;
  onReject: () => void;
}

/** 计划确认卡片：y=按计划执行，n=放弃。 */
export function PlanConfirm({ task, plan, onApprove, onReject }: PlanConfirmProps) {
  const { glyphs, style } = terminalStyle();
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === "y") {
      onApprove();
    } else if (key === "n") {
      onReject();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={style.border} paddingX={1}>
      <Text color="cyan" bold>
        ⎘ 实施计划（任务：{task}）
      </Text>
      <Text>{plan}</Text>
      <Text>
        [<Text color="green">y</Text>=按计划执行] [<Text color="red">n</Text>=放弃]
      </Text>
    </Box>
  );
}
