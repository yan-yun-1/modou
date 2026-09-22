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

/** 单条消息渲染（Static 模式与列表模式共用） */
export function MessageItem({ item }: { item: DisplayItem }) {
  return (
    <Text color={COLORS[item.kind]} dimColor={item.kind === "tool"}>
      {ICONS[item.kind]}
      {item.text}
    </Text>
  );
}

export function MessageList({ items }: { items: DisplayItem[] }) {
  return (
    <Box flexDirection="column">
      {items.map((item, index) => (
        <MessageItem key={index} item={item} />
      ))}
    </Box>
  );
}
