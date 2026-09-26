import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// M4 Phase C（PRD F19）：ACP agent stdio JSON-RPC 回环自测。
// 以子进程方式 spawn `node dist/index.js acp`，模拟 ACP 编辑器的完整握手。

let dir: string;
let home: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "acp-"));
  home = await mkdtemp(join(tmpdir(), "acp-home-"));
  await mkdir(join(home, ".modou"), { recursive: true });
  await writeFile(
    join(home, ".modou", "settings.json"),
    JSON.stringify({ provider: "anthropic", modelId: "claude-sonnet-4-5", apiKey: "sk-test", permissionMode: "default" }),
    "utf8",
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

interface JsonRpcMessage {
  id?: number | string;
  method?: string;
  result?: Record<string, unknown>;
  params?: Record<string, unknown>;
  error?: unknown;
}


/** 逐行读 JSON-RPC 消息（nd-json），直到出现匹配的 id */
function readUntil(child: ReturnType<typeof spawn>, buffer: { value: string }, predicate: (m: JsonRpcMessage) => boolean): Promise<JsonRpcMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ACP 回环超时")), 20_000);
    const tryParse = () => {
      let idx: number;
      while ((idx = buffer.value.indexOf("\n")) !== -1) {
        const line = buffer.value.slice(0, idx).trim();
        buffer.value = buffer.value.slice(idx + 1);
        if (line === "") continue;
        try {
          const message = JSON.parse(line) as JsonRpcMessage;
          if (predicate(message)) {
            clearTimeout(timer);
            resolve(message);
            return;
          }
        } catch {
          /* 非完整行 */
        }
      }
    };
    tryParse();
    child.stdout!.on("data", (chunk: Buffer) => {
      buffer.value += chunk.toString("utf8");
      tryParse();
    });
    child.stderr!.on("data", () => {
      // ACP 子进程 stderr（调试日志）忽略
    });
  });
}

function writeMessage(child: ReturnType<typeof spawn>, message: Record<string, unknown>): void {
  child.stdin!.write(JSON.stringify(message) + "\n");
}

describe("modou acp（F19 回环自测）", () => {
  it("initialize → newSession → prompt → agent_message_chunk → end_turn", async () => {
    const child = spawn(process.execPath, [join(__dirname, "..", "dist", "index.js"), "acp"], {
      env: { ...process.env, MODOU_ACP_MODEL_STUB: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const buffer = { value: "" };
    try {
      // 1. initialize
      writeMessage(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } });
      const init = await readUntil(child, buffer, (m) => m.id === 1);
      expect(init.result).toBeTruthy();

      // 2. session/new
      writeMessage(child, { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: dir, mcpServers: [] } });
      const newSession = await readUntil(child, buffer, (m) => m.id === 2);
      const sessionId = (newSession.result!.sessionId as string) ?? "";
      expect(sessionId).toBeTruthy();

      // 3. session/prompt（文本块）
      writeMessage(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text: "打个招呼" }] },
      });

      // 4. 期待 agent_message_chunk 通知 + id=3 的 end_turn 响应
      const chunkUpdate = await readUntil(child, buffer, (m) => {
        if (m.method !== "session/update") return false;
        const update = m.params!.update as Record<string, unknown>;
        return update.sessionUpdate === "agent_message_chunk";
      });
      expect((chunkUpdate.params!.update as Record<string, unknown>).content).toBeTruthy();
      const promptDone = await readUntil(child, buffer, (m) => m.id === 3);
      expect((promptDone.result!.stopReason as string)).toBe("end_turn");
    } finally {
      child.kill();
    }
  }, 30_000);

  it("审批回环：request_permission 立即应答后工具执行且 prompt 正常收尾（answerById 竞态回归）", async () => {
    const child = spawn(process.execPath, [join(__dirname, "..", "dist", "index.js"), "acp"], {
      env: { ...process.env, MODOU_ACP_MODEL_STUB: "1", MODOU_ACP_STUB_TOOL: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const buffer = { value: "" };
    try {
      writeMessage(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } });
      await readUntil(child, buffer, (m) => m.id === 1);
      writeMessage(child, { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: dir, mcpServers: [] } });
      const newSession = await readUntil(child, buffer, (m) => m.id === 2);
      const sessionId = newSession.result!.sessionId as string;
      expect(sessionId).toBeTruthy();

      writeMessage(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text: "创建文件" }] },
      });

      // 权限请求一到立即应答（复刻 Zed 时序）：修复前 approve() 尚未入队，
      // answerById 扑空导致整轮挂起、文件不落盘
      const perm = await readUntil(child, buffer, (m) => m.method === "session/request_permission");
      writeMessage(child, { jsonrpc: "2.0", id: perm.id, result: { outcome: { outcome: "selected", optionId: "allow" } } });

      const toolDone = await readUntil(child, buffer, (m) => {
        if (m.method !== "session/update") return false;
        const update = m.params!.update as Record<string, unknown>;
        return update.sessionUpdate === "tool_call_update" && update.status === "completed";
      });
      expect(toolDone).toBeTruthy();

      const promptDone = await readUntil(child, buffer, (m) => m.id === 3);
      expect(promptDone.result!.stopReason as string).toBe("end_turn");

      expect(await readFile(join(dir, "acp-e2e.txt"), "utf8")).toBe("hi");
    } finally {
      child.kill();
    }
  }, 30_000);
});
