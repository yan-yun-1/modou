import { useEffect, useMemo, useRef, useState } from "react";
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
/** 描述列固定宽度：所有行（选中/非选中）统一 pad+截断，行宽恒定（conhost 清行依赖） */
const HINT_COL_WIDTH = 26;
/** 上下键导航时面板最多可见行数 */
const MAX_VISIBLE_ROWS = 6;

/** 命令选择态强调色（浅蓝）：面板边框、选中行、输入卡边框（选择时）统一用它 */
const PANEL_ACCENT = "blueBright";

/** 按显示宽度右补空格（string-width：CJK/全角按 2 列，emoji 等宽符号也正确计宽） */
function padByWidth(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - stringWidth(s)));
}

/** 固定显示宽度的单元格：不足补空格、超出按显示宽度截断（行宽恒定的关键） */
function fixedWidthCell(s: string, width: number): string {
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = ch.charCodeAt(0) > 0xff ? 2 : 1;
    if (w + cw > width) {
      break;
    }
    out += ch;
    w += cw;
  }
  return out + " ".repeat(width - w);
}

/**
 * 输入卡 + 斜杠命令补全面板。
 * 面板行为："/" 展示全部命令，↑↓ 循环选择，**Enter 直接执行选中命令**，Tab 补全到输入框。
 * 选中行整行亮青（命令+描述统一色），非选中行白色命令名 + 灰色描述。
 * 面板两侧竖线边框（图 2 风格），底部计数 (n/N)。
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

  // 值变化后清空选中索引（由 value 派生列表，索引需要归零避免越界）
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      setSelectedIndex(0);
    }
  }, [value]);

  // 面板活跃时接管回车/上下键；命令执行走 onSubmit（与手输命令同一链路）
  useInput(
    (_input, key) => {
      // ↑↓ 循环导航：首尾环绕（第一项往上到最后一项，最后一项往下回第一项）
      if (key.upArrow) {
        setSelectedIndex((i) =>
          suggestions.length === 0 ? 0 : (i - 1 + suggestions.length) % suggestions.length,
        );
      } else if (key.downArrow) {
        setSelectedIndex((i) => (suggestions.length === 0 ? 0 : (i + 1) % suggestions.length));
      } else if (key.return && selected) {
        // Enter = 直接执行选中命令（不做二次确认）
        const commandText = selected.name;
        setValue("");
        setSelectedIndex(0);
        onSubmit(commandText);
      } else if (key.tab && selected) {
        // Tab = 仅补全到输入框，继续编辑
        setValue(`${selected.name} `);
      } else if (key.escape) {
        // esc = 不选了：清空输入收起面板
        setValue("");
        setSelectedIndex(0);
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

  return (
    <Box flexDirection="column" gap={0}>
      {/* 输入卡：空闲灰色，命令选择时浅蓝（与面板边框同色，标识选择态） */}
      <Box
        borderStyle="round"
        borderColor={disabled ? "gray" : showSuggestions ? PANEL_ACCENT : "gray"}
        paddingX={1}
      >
        <Text color={disabled ? "gray" : style.user}>❯ </Text>
        <TextInput
          value={value}
          placeholder={placeholder ?? ""}
          onChange={setValue}
          onSubmit={(v) => {
            if (disabled || v.trim() === "") {
              return;
            }
            // 面板活跃（有匹配命令）时回车由面板接管（直接执行选中项），
            // 这里拦截避免双重提交；无匹配的斜杠输入（如 /resume xxx）正常提交
            if (v.trim().startsWith("/") && showSuggestions) {
              setValue("");
              setSelectedIndex(0);
              return;
            }
            setValue("");
            setSelectedIndex(0);
            onSubmit(v);
          }}
        />
      </Box>
      {showSuggestions ? (
        // 面板容器：左右竖线边框（borderStyle="round" 只留左右边）+ 内边距
        <Box
          flexDirection="column"
          borderStyle="round"
          borderTop={false}
          borderBottom={false}
          borderColor={disabled ? "gray" : PANEL_ACCENT}
          paddingX={1}
        >
          {visible.map((c) => {
            const absoluteIndex = suggestions.indexOf(c);
            const isSelected = absoluteIndex === clampedIndex;
            // conhost 对背景色重绘有残影（SGR 40 行尾清行不净），
            // 选中态用「❯ 指示符 + 整行亮青」表达——纯前景色，无背景重绘。
            // 标记必须选「全链路单列」字符：❯ (U+276F) 在 string-width、
            // is-fullwidth-code-point、终端 wcwidth 下都计 1 列；
            // ▶ (U+25B6) 是 emoji-presentation，string-width 计 2、渲染层计 1，宽度分歧会挤乱行宽。
            const marker = isSelected ? "❯ " : "  ";
            return (
              <Text key={c.name}>
                {isSelected ? (
                  // 选中行：整行亮青加粗（命令 + 描述统一色）
                  // 分段结构与非选中行完全一致——保证尾空格裁剪行为相同（行宽恒定）
                  <>
                    <Text color={PANEL_ACCENT} bold>
                      {marker}
                      {padByWidth(c.name, NAME_COL_WIDTH)}
                    </Text>
                    <Text color={PANEL_ACCENT} bold>
                      {fixedWidthCell(c.hint, HINT_COL_WIDTH)}
                    </Text>
                  </>
                ) : (
                  // 非选中行：白色命令名 + 灰色描述（同宽）
                  <Text>
                    <Text color={style.dim}>{marker}</Text>
                    <Text color="white">{padByWidth(c.name, NAME_COL_WIDTH)}</Text>
                    <Text color="gray">{fixedWidthCell(c.hint, HINT_COL_WIDTH)}</Text>
                  </Text>
                )}
              </Text>
            );
          })}
          {/* 命令计数（图 2 风格）：面板底部固定显示 */}
          <Text color="gray">
            {"  "}({clampedIndex + 1}/{suggestions.length})
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
