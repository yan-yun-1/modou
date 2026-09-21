import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LubanEvent } from "../src/events.js";
import { SessionStore } from "../src/session-store.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "luban-sessions-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function ev(at: number, text: string): LubanEvent {
  return { type: "user_message", text, at };
}

describe("SessionStore", () => {
  it("creates a session and reads back an empty event list", async () => {
    const store = new SessionStore(dir);
    const id = await store.create();
    expect(await store.read(id)).toEqual([]);
  });

  it("accepts a caller-provided session id", async () => {
    const store = new SessionStore(dir);
    const id = await store.create("my-session");
    expect(id).toBe("my-session");
  });

  it(
    "round-trips 1000 events in order with args objects preserved",
    { timeout: 30_000 },
    async () => {
      const store = new SessionStore(dir);
      const id = await store.create();
      const events: LubanEvent[] = [];
      for (let i = 0; i < 1000; i++) {
        events.push(
          i % 2 === 0
            ? ev(i, `msg-${i}`)
            : {
                type: "tool_call",
                id: `t${i}`,
                name: "read",
                args: { path: `f${i}.ts`, nested: { deep: [1, 2, i] } },
                at: i,
              },
        );
      }
      for (const event of events) {
        await store.append(id, event);
      }
      expect(await store.read(id)).toEqual(events);
    },
  );

  it("serializes concurrent appends without interleaving", { timeout: 30_000 }, async () => {
    const store = new SessionStore(dir);
    const id = await store.create();
    await Promise.all(Array.from({ length: 200 }, (_, i) => store.append(id, ev(i, `c-${i}`))));
    const read = await store.read(id);
    expect(read).toHaveLength(200);
    expect(read.every((e) => e.type === "user_message")).toBe(true);
  });

  it("throws a descriptive error on a corrupted line, with the line number", async () => {
    const store = new SessionStore(dir);
    const id = await store.create();
    await store.append(id, ev(1, "ok"));
    const file = join(dir, `${id}.jsonl`);
    const existing = await readFile(file, "utf8");
    await writeFile(file, existing + "{not valid json\n", "utf8");
    await expect(store.read(id)).rejects.toThrow(/第 2 行/);
  });

  it("lists session ids in order", async () => {
    const store = new SessionStore(dir);
    await store.create("b-session");
    await store.create("a-session");
    await store.create("c-session");
    expect(await store.list()).toEqual(["a-session", "b-session", "c-session"]);
  });

  it("defaults its base directory to ~/.luban/sessions", () => {
    const store = new SessionStore();
    expect(store.baseDir).toContain(join(".luban", "sessions"));
  });
});
