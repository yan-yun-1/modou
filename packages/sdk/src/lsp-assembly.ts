import { z } from "zod";
import type { LspIntegration, Tool } from "@modou-dev/core";
import { detectDefaultServers, LspHub, type HubServerConfig, type LspServerConfig } from "@modou-dev/lsp";
import type { Settings } from "./settings.js";

/**
 * M5 C3（PRD F16）：LSP 装配——settings.lspServers（或自动探测）→ LspHub →
 * core 的 LspIntegration + definition 工具。core 不感知 settings.json。
 */

/** 解析 LSP server 配置：显式 lspServers 优先；未配置时自动探测 PATH */
export function resolveLspServers(settings: Settings): Record<string, HubServerConfig> | undefined {
  const configured = settings.lspServers;
  if (configured && Object.keys(configured).length > 0) {
    return configured;
  }
  const detected = detectDefaultServers();
  return Object.keys(detected).length > 0 ? detected : undefined;
}

export async function startLspHub(
  settings: Settings,
  cwd: string,
): Promise<LspHub | undefined> {
  const servers = resolveLspServers(settings);
  if (!servers) {
    return undefined;
  }
  try {
    // server 启动失败已在 LspHub 内部容忍（记 stderr 继续用其余的）；这里兜底整体失败
    return await LspHub.start({ cwd, servers });
  } catch {
    return undefined;
  }
}

export function createLspIntegration(hub: LspHub): LspIntegration {
  return {
    diagnosticsAfterWrite: (path, content) => hub.diagnosticsAfterWrite(path, content),
    definition: async (args) => hub.definition(args.file, args.line, args.column ?? 0),
  };
}

const definitionSchema = z.object({
  file: z.string().min(1),
  /** 0 起的行号 */
  line: z.number().int().min(0),
  /** 0 起的列号（缺省 0） */
  column: z.number().int().min(0).optional(),
});

export type DefinitionArgs = z.infer<typeof definitionSchema>;

/** definition 工具（kind read，自动放行）：跳转到符号定义 */
export function createDefinitionTool(hub: LspHub): Tool<DefinitionArgs> {
  return {
    name: "definition",
    description:
      "跳转到某个符号的定义处（基于 language server）。给出文件路径与符号所在的 0 起行号/列号；返回定义位置列表。先用 read 定位符号再调用本工具。",
    kind: "read",
    schema: definitionSchema,
    async run(args) {
      const text = await hub.definition(args.file, args.line, args.column ?? 0);
      return { output: text ?? "未找到该位置符号的定义。" };
    },
  };
}
