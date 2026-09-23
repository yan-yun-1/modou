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

/** 提示行最多渲染的命令名数量（80 列内一行放下） */
const MAX_SUGGESTIONS = 6;

/** 把列表按 n 个一组切分（全量命令网格用） */
function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) {
    out.push(list.slice(i, i + n));
  }
  return out;
}

/**
 * 输入卡（T3 + C3 降噪）：round 边框 + placeholder。
 * 斜杠提示分两层：第一行只有命令名（cyan，一行放下）；第二行只显示首项的说明。
 * "/" 单字符、无匹配时不显示任何提示。
 */
export function InputBox({ busy, onSubmit, placeholder, disabled = false }: InputBoxProps) {
  const { style } = terminalStyle();
  const [value, setValue] = useState("");

  const suggestions = useMemo(
    () => (value.startsWith("/") ? matchSlashCommands(value) : []),
    [value],
  );
  // 输入 "/" 即展示全部命令（继续输入按前缀收窄）
  const showSuggestions = suggestions.length > 0;

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
      {showSuggestions ? (
        value.trim() === "/" ? (
          // 全量视图：两列网格（命令名 + hint），12 条放下且不折行
          <Box flexDirection="column">
            {chunk(suggestions, 2).map((pair, i) => (
              <Text key={i}>{pair.map((c) => `${c.name.padEnd(14)}${c.hint}`).join("  ")}</Text>
            ))}
            <Text color={style.dim}> (Tab 补全 · 继续输入筛选)</Text>
          </Box>
        ) : (
          <>
            <Text>
              <Text color={style.user}>
                {suggestions
                  .slice(0, MAX_SUGGESTIONS)
                  .map((c) => c.name)
                  .join("  ")}
              </Text>
              <Text color={style.dim}>
                {suggestions.length > MAX_SUGGESTIONS ? "  …" : ""}
                {suggestions.length > 1 ? "  (Tab 补全)" : ""}
              </Text>
            </Text>
            <Text color={style.dim}>{suggestions[0]!.hint}</Text>
          </>
        )
      ) : null}
    </Box>
  );
}
