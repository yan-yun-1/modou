import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CheckpointInfo {
  n: number;
  ref: string;
  time: string;
}

export interface RestoreResult {
  ok: boolean;
  message: string;
}

/**
 * git 影子引用回滚点（backlog #4 / plan-m1 J1）：
 * - 快照用「临时 index + write-tree + commit-tree + update-ref refs/luban/<session>/<n>」，
 *   全程不触碰用户的真实 index 与分支历史。
 * - 恢复 = 先给当前状态自动留档，再按快照重建工作区（含删除快照后新增的文件）。
 * - 非 git 目录自动降级为 no-op。
 */
export class GitCheckpointer {
  readonly root: string;
  readonly available: boolean;

  constructor(root: string) {
    this.root = root;
    this.available = existsSync(join(root, ".git"));
  }

  private async git(args: string[], env?: Record<string, string>): Promise<string> {
    const { stdout } = await execFileAsync(
      "git",
      // 字节级精确：禁用 autocrlf，避免 Windows 上 checkout 把 LF 转成 CRLF
      ["-c", "core.autocrlf=false", ...args],
      {
        cwd: this.root,
        env: env ? { ...process.env, ...env } : process.env,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return stdout.toString();
  }

  private refFor(sessionId: string, n: number): string {
    return `refs/luban/${sessionId}/${n}`;
  }

  async snapshot(sessionId: string): Promise<string | null> {
    if (!this.available) {
      return null;
    }
    const tmpIndex = join(tmpdir(), `luban-index-${randomUUID()}`);
    const indexEnv = { GIT_INDEX_FILE: tmpIndex };
    try {
      // 用临时 index 把当前工作区（含未跟踪、不含被忽略文件）固化成一棵树
      await this.git(["add", "-A", "--"], indexEnv);
      const tree = (await this.git(["write-tree"], indexEnv)).trim();
      if (!tree) {
        return null;
      }
      let head: string | null = null;
      try {
        head = (await this.git(["rev-parse", "--verify", "HEAD"])).trim();
      } catch {
        head = null;
      }
      const next = await this.#nextN(sessionId);
      const message = `luban checkpoint ${sessionId} #${next}`;
      const commitArgs = ["commit-tree", tree, "-m", message];
      if (head) {
        commitArgs.push("-p", head);
      }
      const commit = (await this.git(commitArgs)).trim();
      await this.git(["update-ref", this.refFor(sessionId, next), commit]);
      return String(next);
    } catch {
      return null;
    } finally {
      await rm(tmpIndex, { force: true }).catch(() => {});
    }
  }

  async list(sessionId: string): Promise<CheckpointInfo[]> {
    if (!this.available) {
      return [];
    }
    try {
      const out = await this.git([
        "for-each-ref",
        `refs/luban/${sessionId}/`,
        "--format=%(refname)%09%(creatordate:iso-strict)",
        "--sort=version:refname",
      ]);
      return out
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
          const [refname, time = ""] = line.split("\t");
          const n = Number(refname!.split("/").at(-1));
          return { n, ref: refname!, time };
        });
    } catch {
      return [];
    }
  }

  async restore(sessionId: string, n: number): Promise<RestoreResult> {
    if (!this.available) {
      return { ok: false, message: "当前目录不是 git 仓库，无法使用回滚点" };
    }
    const ref = this.refFor(sessionId, n);
    try {
      await this.git(["rev-parse", "--verify", ref]);
    } catch {
      return { ok: false, message: `回滚点 #${n} 不存在` };
    }

    // 恢复前先给当前状态留档（恢复动作本身可撤销）
    const preRestore = await this.snapshot(sessionId);

    const tmpSnapIndex = join(tmpdir(), `luban-restore-snap-${randomUUID()}`);
    const tmpNowIndex = join(tmpdir(), `luban-restore-now-${randomUUID()}`);
    const snapEnv = { GIT_INDEX_FILE: tmpSnapIndex };
    const nowEnv = { GIT_INDEX_FILE: tmpNowIndex };
    try {
      await this.git(["read-tree", ref], snapEnv);
      const snapshotFiles = (await this.git(["ls-files", "--format=%(path)"], snapEnv))
        .split("\n")
        .filter((f) => f.trim() !== "");

      await this.git(["add", "-A", "--"], nowEnv);
      const currentFiles = new Set(
        (await this.git(["ls-files", "--format=%(path)"], nowEnv))
          .split("\n")
          .filter((f) => f.trim() !== ""),
      );

      // 快照里没有、现在有的文件 = 快照之后新增的 → 删除
      for (const file of currentFiles) {
        if (!snapshotFiles.includes(file)) {
          const abs = join(this.root, file);
          if (existsSync(abs)) {
            await rm(abs, { force: true });
          }
        }
      }

      // 把快照内容写回工作区（临时 index 的 checkout-index 不碰真实 index）
      await this.git(["checkout-index", "--all", "--force"], snapEnv);
      return {
        ok: true,
        message: preRestore
          ? `已恢复到快照 #${n}（恢复前状态已另存为快照 #${preRestore}）`
          : `已恢复到快照 #${n}`,
      };
    } catch (error) {
      return { ok: false, message: `恢复失败：${(error as Error).message}` };
    } finally {
      await rm(tmpSnapIndex, { force: true }).catch(() => {});
      await rm(tmpNowIndex, { force: true }).catch(() => {});
    }
  }

  async #nextN(sessionId: string): Promise<number> {
    const existing = await this.list(sessionId);
    return existing.length === 0 ? 1 : existing.at(-1)!.n + 1;
  }
}
