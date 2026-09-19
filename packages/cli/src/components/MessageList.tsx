import { Box, Text } from "ink";

export type DisplayItemKind = "user" | "assistant" | "tool" | "approval" | "error";

export interface DisplayItem {
  kind: DisplayItemKind;
  text: string;
}

const ICONS: Record<DisplayItemKind, string> = {
  user: "❯ ",
  assistant: "",
  tool: "  ⚙ ",
  approval: "  ⚠ ",
  error: "  ✗ ",
};

const COLORS: Partial<Record<DisplayItemKind, string>> = {
  user: "cyan",
  tool: "gray",
  approval: "yellow",
  error: "red",
};

export function MessageList({ items }: { items: DisplayItem[] }) {
  return (
    <Box flexDirection="column">
      {items.map((item, index) => (
        <Text key={index} color={COLORS[item.kind]} dimColor={item.kind === "tool"}>
          {ICONS[item.kind]}
          {item.text}
        </Text>
      ))}
    </Box>
  );
}
