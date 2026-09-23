import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import stringWidth from "string-width";
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

/** 补全面板单列布局的固定宽度（命令名列宽；CJK 按 2 列计） */
const NAME_COL_WIDTH = 14;
/** 描述列固定宽度（保证两列对齐不随内容漂移） */
const HINT_COL_WIDTH = 26;
/** 上下键导航时面板最多可见行数 */
const MAX_VISIBLE_ROWS = 6;

/** 按显示宽度右补空格（string-width：CJK/全角按 2 列，emoji 等宽符号也正确计宽） */
function padByWidth(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - stringWidth(s)));
}

/**
 * 输入卡（T3 + C3 降噪 + S 补全面板）：round 边框 + placeholder。
 * 补全面板：单列列表 + 上下键选中（反色高亮）、亮青命令名/灰色描述、固定宽度对齐。
 * 输入 "/" 即展示全部命令，继续输入按前缀收窄；Tab/回车 补全选中项。
 */
export function InputBox({ busy, onSubmit, placeholder, disabled = false }: InputBoxProps) {
  const { style } = terminalStyle();
  const [value, setValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const suggestions = useMemo(
    () => (value.startsWith("/") ? matchSlashCommands(value) : []),
    [value],
  );
  const showSuggestions = suggestions.length > 0;
  // value 变化时重置选中项（收窄后旧索引可能越界）
  const clampedIndex = Math.min(selectedIndex, Math.max(0, suggestions.length - 1));
  const selected = suggestions[clampedIndex];

  // 上下键导航：在可见窗口内滚动
  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, Math.min(i, suggestions.length - 1) - 1));
      } else if (key.downArrow) {
        setSelectedIndex((i) => Math.min(suggestions.length - 1, i + 1));
      } else if (key.tab || key.return) {
        if (selected) {
          setValue(`${selected.name} `);
          setSelectedIndex(0);
        }
      }
    },
    { isActive: !busy && showSuggestions },
  );

  if (busy) {
    return null;
  }

  // 可见窗口：保持选中项可见（列表长于 MAX_VISIBLE_ROWS 时滚动）
  const windowStart = Math.max(
    0,
    Math.min(
      clampedIndex - Math.floor(MAX_VISIBLE_ROWS / 2),
      suggestions.length - MAX_VISIBLE_ROWS,
    ),
  );
  const visible = suggestions.slice(windowStart, windowStart + MAX_VISIBLE_ROWS);
  const manyRows = suggestions.length > 1;

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
            setSelectedIndex(0);
            onSubmit(v);
          }}
        />
      </Box>
      {showSuggestions ? (
        <Box flexDirection="column">
          {visible.map((c, i) => {
            const absoluteIndex = windowStart + i;
            const isSelected = absoluteIndex === clampedIndex;
            // conhost 对背景色重绘有残影（SGR 40 行尾清行不净），
            // 选中态用「▶ 指示符 + 前景色加粗」表达——纯前景色，无背景重绘
            const marker = isSelected ? "▶ " : "  ";
            const nameColor = isSelected ? "cyanBright" : "cyan";
            return (
              <Text key={c.name}>
                <Text color={isSelected ? "cyanBright" : style.dim}>{marker}</Text>
                <Text color={nameColor} bold={isSelected}>
                  {padByWidth(c.name, NAME_COL_WIDTH)}
                </Text>
                <Text color="gray">{padByWidth(c.hint, HINT_COL_WIDTH)}</Text>
              </Text>
            );
          })}
          <Text color={style.dim}>
            {"  (Tab/回车 补全 · 继续输入筛选"}
            {manyRows ? " · ↑↓ 选择" : ""}
            {")"}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
