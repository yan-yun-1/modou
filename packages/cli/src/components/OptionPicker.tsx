import { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface PickerOption {
  value: string;
  label: string;
}

export interface OptionPickerProps {
  title: string;
  options: PickerOption[];
  /** 初始选中项索引（用于回显当前值）；默认 0 */
  initialIndex?: number;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/**
 * 通用选择器（/thinking、/permission 共用）：
 * ↑↓ 循环移动、回车确认、esc 取消。挂载期间替代输入框（避免按键竞争）。
 */
export function OptionPicker({ title, options, initialIndex = 0, onConfirm, onCancel }: OptionPickerProps) {
  const [index, setIndex] = useState(initialIndex);
  useInput((_input, key) => {
    if (key.upArrow) {
      setIndex((i) => (i + options.length - 1) % options.length);
    } else if (key.downArrow) {
      setIndex((i) => (i + 1) % options.length);
    } else if (key.return) {
      const picked = options[index];
      if (picked) {
        onConfirm(picked.value);
      }
    } else if (key.escape) {
      onCancel();
    }
  });
  return (
    <Box flexDirection="column">
      <Text>{title}（↑/↓ 移动，回车确认，esc 取消）：</Text>
      {options.map((o, i) => (
        <Text key={o.value} color={i === index ? "green" : undefined}>
          {i === index ? "❯ " : "  "}
          {o.label}
        </Text>
      ))}
    </Box>
  );
}
