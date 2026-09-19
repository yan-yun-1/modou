import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCheckpointer } from "../src/checkpoints.js";

let dir: string;
let checkpointer: GitCheckpointer;

function git(args: string, cwd = dir): string {
  return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-ckpt-"));
  git("init");
  git("config user.email t@t.io");
  git("config user.name t");
  await writeFile(join(dir, "tracked.txt"), "v1\n", "utf8");
  git("add -A");
  git("commit -m init");
  checkpointer = new GitCheckpointer(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("GitCheckpointer", () => {
  it("detects an available git repository", () => {
    expect(checkpointer.available).toBe(true);
  });

  it("snapshots the worktree and restores it, removing later additions", async () => {
    const first = await checkpointer.snapshot("s1");
    expect(first).toBe("1");

    // agent 之后改了文件并新建了文件
    await writeFile(join(dir, "tracked.txt"), "v2\n", "utf8");
    await writeFile(join(dir, "created-later.txt"), "later\n", "utf8");
    const second = await checkpointer.snapshot("s1");
    expect(second).toBe("2");

    await checkpointer.restore("s1", 1);
    expect(
      await import("node:fs/promises").then((m) => m.readFile(join(dir, "tracked.txt"), "utf8")),
    ).toBe("v1\n");
    const fsAfter = await import("node:fs/promises");
    await expect(fsAfter.readFile(join(dir, "created-later.txt"), "utf8")).rejects.toThrow();
  });

  it("lists checkpoints with their numbers", async () => {
    await checkpointer.snapshot("s2");
    await checkpointer.snapshot("s2");
    await checkpointer.snapshot("s-other");
    const list = await checkpointer.list("s2");
    expect(list.map((c) => c.n)).toEqual([1, 2]);
  });

  it("does not disturb the user's staged changes when snapshotting/restoring", async () => {
    // 用户暂存了一个改动
    await writeFile(join(dir, "tracked.txt"), "user staged edit\n", "utf8");
    git("add tracked.txt");
    const stagedBefore = git("diff --cached --name-only");

    const n = await checkpointer.snapshot("s3"); // 此时 worktree = staged 版本
    await writeFile(join(dir, "tracked.txt"), "agent messes around\n", "utf8");
    await checkpointer.restore("s3", Number(n));

    // 暂存区里用户的改动仍在
    expect(git("diff --cached --name-only")).toBe(stagedBefore);
    expect(git("diff --cached --name-only")).toContain("tracked.txt");
  });

  it("snapshots the pre-restore state before restoring", async () => {
    const n = await checkpointer.snapshot("s4");
    await writeFile(join(dir, "tracked.txt"), "agent broke it\n", "utf8");
    const result = await checkpointer.restore("s4", Number(n));
    expect(result.ok).toBe(true);
    // 恢复前的（被搞坏的）状态本身也被另存了一份
    const list = await checkpointer.list("s4");
    expect(list.length).toBe(2);
  });

  it("degrades gracefully outside a git repository", async () => {
    const plain = await mkdtemp(join(tmpdir(), "luban-nogit-"));
    const cp = new GitCheckpointer(plain);
    expect(cp.available).toBe(false);
    await expect(cp.snapshot("s")).resolves.toBeNull();
    const restore = await cp.restore("s", 1);
    expect(restore.ok).toBe(false);
    await rm(plain, { recursive: true, force: true });
  });
});
