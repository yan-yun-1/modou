/**
 * M5 B2（PRD 6.5）：OS 级沙箱适配层。
 * 三平台评估结论见 docs/sandbox-eval.md：macOS Seatbelt 落地，Windows/Linux 不落地。
 * 沙箱是纵深防御与免审批的前提，不是权限审批的替代。
 */

export interface SandboxSpawnContext {
  /** 会话工作目录：沙箱写白名单的依据 */
  cwd: string;
}

export interface SandboxAdapter {
  readonly name: string;
  /** 包装一次子进程 spawn；实现必须保持参数语义（内层命令原样透传） */
  wrapExec(
    cmd: string,
    args: string[],
    ctx: SandboxSpawnContext,
  ): { cmd: string; args: string[] };
}
