import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { needsCompaction } from "../src/context/compaction.js";
import { SessionStore } from "../src/session-store.js";
import type { ModouEvent } from "../src/events.js";

// M4 E2：backlog-m3 #12 与 #8 清偿

describe("backlog #12：session-store append 异常分支", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "store-err-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("append rejects when the target path is a directory, and the queue survives for later appends", async () => {
    const store = new SessionStore(dir);
    const sessionId = "broken-session";
    await store.create(sessionId);
    // 把会话文件替换成目录：appendFile 会 ENOTDIR/EISDIR 失败
    const { unlink } = await import("node:fs/promises");
    await unlink(join(dir, `${sessionId}.jsonl`));
    await mkdir(join(dir, `${sessionId}.jsonl`));

    await expect(
      store.append(sessionId, { type: "user_message", text: "x", at: 1 }),
    ).rejects.toThrow();
    // 失败后队列被清干净：修复文件后同会话可继续 append（不因坏 promise 卡死）
    const { rmdir } = await import("node:fs/promises");
    await rmdir(join(dir, `${sessionId}.jsonl`));
    await store.append(sessionId, { type: "user_message", text: "恢复", at: 2 });
    const events = await store.read(sessionId);
    expect(events.some((e) => e.type === "user_message" && (e as { text: string }).text === "恢复")).toBe(true);
  });

  it("read returns [] for missing files and throws for corrupted lines", async () => {
    const store = new SessionStore(dir);
    expect(await store.read("nope")).toEqual([]);
    const corrupted = "corrupt-session";
    await store.create(corrupted);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, `${corrupted}.jsonl`), "{not json}\n", "utf8");
    await expect(store.read(corrupted)).rejects.toThrow("会话记录损坏");
  });
});

describe("backlog #8：/plan 计划文本与 compaction 交互验证", () => {
  it("a huge plan message triggers needsCompaction at 80% of the window", () => {
    // /plan 产出的计划是 assistant_message 进入主历史。验证：
    // 计划文本足够长时，下一轮 run 开始处会命中 compaction 阈值。
    const planEvent = { type: "assistant_message", text: "计划正文。".repeat(3000), at: 1 } as unknown as ModouEvent;
    const messages = [{ role: "assistant", content: planEvent.type === "assistant_message" ? planEvent.text : "" }];
    // contextWindow 4000：估算 15000 字符 ≈ 3750 tokens > 80% 阈值 3200
    expect(needsCompaction(messages as never, 4000)).toBe(true);
    // 窗口足够大时不触发
    expect(needsCompaction(messages as never, 1_000_000)).toBe(false);
  });
});
