import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
    return entries
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => name.slice(0, -".jsonl".length))
      .sort();
  }

  private sessionFile(sessionId: string): string {
    return join(this.baseDir, `${sessionId}.jsonl`);
  }
}

function newSessionId(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}
