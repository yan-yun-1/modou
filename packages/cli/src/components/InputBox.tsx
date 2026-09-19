import { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export interface InputBoxProps {
  busy: boolean;
  onSubmit: (value: string) => void;
}

export function InputBox({ busy, onSubmit }: InputBoxProps) {
  const [value, setValue] = useState("");

  if (busy) {
    return <Text dimColor>（agent 工作中… Ctrl+C 可退出）</Text>;
  }

  return (
    <Box>
      <Text color="cyan">❯ </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={(v) => {
          setValue("");
          onSubmit(v);
        }}
      />
    </Box>
  );
}
