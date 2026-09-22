import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { matchSlashCommands } from "../commands.js";
import { terminalStyle } from "../terminal-capability.js";

export interface InputBoxProps {
  busy: boolean;
  onSubmit: (value: string) => void;
  /** 空态提示（placeholder）；装配未完成时传"正在装配上下文…" */
  placeholder?: string;
  /** 提交拦截（装配未完成时 true）：显示提示并忽略输入 */
  disabled?: boolean;
}

/**
 * 输入卡（T3）：round 边框 + placeholder；
 * 输入 `/` 时卡下显示匹配命令提示行，Tab 补全首项（T4）。
 */
export function InputBox({ busy, onSubmit, placeholder, disabled = false }: InputBoxProps) {
  const { style } = terminalStyle();
  const [value, setValue] = useState("");

  const suggestions = useMemo(
    () => (value.startsWith("/") ? matchSlashCommands(value) : []),
    [value],
  );

  useInput(
    (input, key) => {
      if (key.tab && suggestions.length > 0) {
        setValue(`${suggestions[0]!.name} `);
      }
    },
    { isActive: !busy && suggestions.length > 0 },
  );

  if (busy) {
    return null;
  }

  return (
    <Box flexDirection="column" gap={0}>
      <Box borderStyle="round" borderColor={disabled ? "gray" : style.border} paddingX={1}>
        <Text color={disabled ? "gray" : style.user}>❯ </Text>
        <TextInput
          value={value}
          placeholder={placeholder ?? "输入任务，/ 开头为命令…"}
          onChange={setValue}
          onSubmit={(v) => {
            if (disabled || v.trim() === "") {
              return;
            }
            setValue("");
            onSubmit(v);
          }}
        />
      </Box>
      {suggestions.length > 0 ? (
        <Text dimColor>
          {suggestions
            .slice(0, 6)
            .map((c) => `${c.name} ${c.hint}`)
            .join("　")}
          {"　(Tab 补全)"}
        </Text>
      ) : null}
    </Box>
  );
}
