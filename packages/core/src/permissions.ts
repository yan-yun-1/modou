import { z } from "zod";

export type PermissionMode = "plan" | "default" | "yolo";
export type PermissionDecision = "allow" | "deny" | "ask";
export type ToolKind = "read" | "write" | "execute";

export const permissionRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("execute-prefix"), value: z.string().min(1) }),
  z.object({ type: z.literal("write-path"), value: z.string().min(1) }),
]);

export type PermissionRule = z.infer<typeof permissionRuleSchema>;

export const permissionSnapshotSchema = z.object({
  mode: z.enum(["plan", "default", "yolo"]).default("default"),
  rules: z.array(permissionRuleSchema).default([]),
});

export interface PermissionSnapshot {
  mode: PermissionMode;
  rules: PermissionRule[];
}

export interface PermissionInput {
  name: string;
  kind: ToolKind;
  args: unknown;
}

/** 无论什么模式都必须人工确认的命令特征 */
const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+(?:-{1,2}[\w-]+\s+)*-{1,2}\w*r\w*/i, // rm 带递归参数
  /\bgit\s+push\b[^|;&]*\s-(?:f|-force)\b/i, // 强推
  /remove-item\b[^|;&]*-recurse/i, // PS 递归删除
  /\b(rd|rmdir)\s+\/s/i, // cmd 递归删除
  /\bdel\s+\/[fsq]/i, // cmd 强制删除
  /\bmkfs\b|\bshutdown\b|\breboot\b/i,
  /\bdd\s+if=/i,
];

function commandOf(args: unknown): string | null {
  const c = (args as { command?: unknown } | null)?.command;
  return typeof c === "string" ? c : null;
}

function pathOf(args: unknown): string | null {
  const p = (args as { path?: unknown } | null)?.path;
  return typeof p === "string" ? p : null;
}

function isDangerous(command: string): boolean {
  return DANGEROUS_COMMAND_PATTERNS.some((re) => re.test(command));
}

function matchesRule(rule: PermissionRule, input: PermissionInput): boolean {
  if (rule.type === "execute-prefix" && input.kind === "execute") {
    const command = commandOf(input.args);
    return command !== null && command.startsWith(rule.value);
  }
  if (rule.type === "write-path" && input.kind === "write") {
    const path = pathOf(input.args);
    return path !== null && path.startsWith(rule.value);
  }
  return false;
}

/**
 * 权限引擎：模式 × 规则 × 高危拦截 的三维判定。
 * 判定顺序：read 放行 → plan 拒绝 → 高危 ask → always-allow 规则放行 → 模式默认值。
 */
export class PermissionEngine {
  mode: PermissionMode;
  #rules: PermissionRule[];

  constructor(snapshot?: Partial<PermissionSnapshot>) {
    const parsed = permissionSnapshotSchema.parse(snapshot ?? {});
    this.mode = parsed.mode;
    this.#rules = [...parsed.rules];
  }

  decide(input: PermissionInput): PermissionDecision {
    if (input.kind === "read") {
      return "allow";
    }
    if (this.mode === "plan") {
      return "deny";
    }
    if (input.kind === "execute") {
      const command = commandOf(input.args);
      if (command !== null && isDangerous(command)) {
        return "ask";
      }
    }
    if (this.#rules.some((rule) => matchesRule(rule, input))) {
      return "allow";
    }
    return this.mode === "yolo" ? "allow" : "ask";
  }

  remember(rule: PermissionRule): void {
    const parsed = permissionRuleSchema.parse(rule);
    if (!this.#rules.some((r) => r.type === parsed.type && r.value === parsed.value)) {
      this.#rules.push(parsed);
    }
  }

  snapshot(): PermissionSnapshot {
    return { mode: this.mode, rules: [...this.#rules] };
  }
}
