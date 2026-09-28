import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEvent, type ModouEvent } from "./events.js";

/**
 * 会话以 JSONL（每行一个 JSON 事件）落盘，天然支持追加、回放与多端同步。
 * 并发 append 通过内部 promise 链串行化，保证行不交错。
 */
export class SessionStore {
  readonly baseDir: string;

  #queues = new Map<string, Promise<void>>();

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), ".modou", "sessions");
  }

  async create(id?: string): Promise<string> {
    const sessionId = id ?? newSessionId();
    await mkdir(this.baseDir, { recursive: true });
    // 空会话也真实存在：创建即落空文件，保证 list/resume 可见
    await writeFile(this.sessionFile(sessionId), "", { flag: "a", encoding: "utf8" });
    return sessionId;
  }

  async append(sessionId: string, event: ModouEvent): Promise<void> {
    const line = JSON.stringify(event) + "\n";
    const previous = this.#queues.get(sessionId) ?? Promise.resolve();
    const next = previous.then(() => appendFile(this.sessionFile(sessionId), line, "utf8"));
    this.#queues.set(
      sessionId,
      next.catch(() => {}),
    );
    return next;
  }

  async read(sessionId: string): Promise<ModouEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.sessionFile(sessionId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    return raw
      .split("\n")
      .map((line, index) => {
        if (line.trim() === "") {
          return null;
        }
        try {
          return parseEvent(JSON.parse(line));
        } catch (error) {
          throw new Error(
            `会话记录损坏：${this.sessionFile(sessionId)} 第 ${index + 1} 行无法解析（${(error as Error).message}）`,
            { cause: error },
          );
        }
      })
      .filter((event): event is ModouEvent => event !== null);
  }

  /**
   * 会话 id 列表，按文件修改时间倒序（最新在前）。
   * plan-web 修复：字典序会让子代理（sub-）与无头（print-）历史会话在
   * slice 窗口里刷屏，把用户近期会话挤出"最近 50"。
   */
  async list(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.baseDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const names = entries.filter((name) => name.endsWith(".jsonl"));
    const stats = await Promise.all(
      names.map(async (name) => ({
        id: name.slice(0, -".jsonl".length),
        mtimeMs: (await stat(join(this.baseDir, name))).mtimeMs,
      })),
    );
    return stats.sort((a, b) => b.mtimeMs - a.mtimeMs).map((s) => s.id);
  }

  /** plan-web：删除会话文件（历史会话清理）。文件不存在视为已删除 */
  async delete(sessionId: string): Promise<void> {
    try {
      await (await import("node:fs/promises")).rm(this.sessionFile(sessionId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private sessionFile(sessionId: string): string {
    return join(this.baseDir, `${sessionId}.jsonl`);
  }
}

function newSessionId(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}
