import { Box, Text, useInput } from "ink";
import { SLASH_COMMANDS } from "../commands.js";

/** 命令选择面板同款强调色（浅蓝） */
const PANEL_ACCENT = "blueBright";

export interface HelpPanelProps {
  onClose: () => void;
}

/**
 * 帮助面板（/help）：临时浮层，不进会话历史。
 * 清单直接取自 SLASH_COMMANDS（与补全面板同源，自动同步）。
 * esc / 回车 关闭。
 */
export function HelpPanel({ onClose }: HelpPanelProps) {
  useInput((_input, key) => {
    if (key.escape || key.return) {
      onClose();
    }
  });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={PANEL_ACCENT} paddingX={1}>
      <Text>可用命令（esc 关闭）：</Text>
      {SLASH_COMMANDS.map((c) => (
        <Text key={c.name}>
          {"  "}
          <Text color="white">{c.name}</Text>
          {" — "}
          <Text color="gray">{c.hint}</Text>
        </Text>
      ))}
    </Box>
  );
}
