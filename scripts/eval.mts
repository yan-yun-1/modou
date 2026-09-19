/**
 * M1 迷你 eval harness：pnpm eval（需 LUBAN_EVAL=1）
 * 默认读 ~/.luban/settings.json 的模型（当前 GLM glm-4.5-air）；
 * 每个用例在一次性沙箱中运行，断言"关键工具被调用 + 文件结果正确"，而非仅"有输出"。
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { runPrintMode } from "../packages/cli/src/print-mode.js";
import {
  loadModelOverrides,
  loadSettings,
  type ProviderName,
  type Settings,
} from "../packages/cli/src/settings.js";

if (!process.env.LUBAN_EVAL) {
  console.log("跳过 eval（设置 LUBAN_EVAL=1 启用）");
  process.exit(0);
}

const userSettings = await loadSettings(homedir());
if (!userSettings) {
  console.error("[eval] 未找到 ~/.luban/settings.json，无法运行 eval");
  process.exit(1);
}
const settings: Settings = { ...userSettings, apiKey: userSettings.apiKey };
const modelOverrides = await loadModelOverrides(homedir());
const providerLabel: ProviderName = settings.provider;

interface EvalCase {
  name: string;
  prompt: string;
  mode?: "default" | "yolo";
  /** 返回 null 表示通过，否则为失败原因 */
  check: (ctx: { output: string; toolCalls: string[]; sandbox: string }) => Promise<string | null>;
}

const cases: EvalCase[] = [
  {
    name: "read-summarize",
    prompt: "读取 math.js 并用一句话说明 add 函数的作用。",
    check: async ({ output, toolCalls }) => {
      if (!toolCalls.includes("read")) return "没有调用 read 工具";
      return output.includes("相加") ||
        output.includes("求和") ||
        output.toLowerCase().includes("add")
        ? null
        : `输出未提到 add 的语义：${output.slice(0, 80)}`;
    },
  },
  {
    name: "grep-locate",
    prompt: "用 grep 工具搜索 multiply 被定义在哪个文件，回答中必须给出完整的文件名（含扩展名）。",
    check: async ({ output, toolCalls }) => {
      if (!toolCalls.includes("grep")) return "没有调用 grep 工具";
      return output.includes("math.js") ? null : `输出未指出 math.js：${output.slice(0, 80)}`;
    },
  },
  {
    name: "glob-list",
    prompt: "列出仓库里所有 .md 文件的文件名。",
    check: async ({ toolCalls, output }) => {
      if (!toolCalls.includes("glob") && !toolCalls.includes("read")) return "没有使用 glob/read";
      return output.includes(".md") ? null : "输出未包含 .md 文件名";
    },
  },
  {
    name: "json-answer",
    prompt: "读取 config.json，告诉我 env 字段的值是什么。",
    check: async ({ output, toolCalls }) => {
      if (!toolCalls.includes("read")) return "没有调用 read 工具";
      return output.toLowerCase().includes("test") ? null : "输出未包含 test";
    },
  },
  {
    name: "write-create",
    mode: "yolo",
    prompt: "创建 greeting.txt，内容恰好为：hello eval",
    check: async ({ sandbox }) => {
      const content = await readFile(join(sandbox, "greeting.txt"), "utf8").catch(() => null);
      if (content === null) return "greeting.txt 未创建";
      return content.toLowerCase().includes("hello eval") ? null : `内容不符：${content}`;
    },
  },
  {
    name: "edit-replace",
    mode: "yolo",
    prompt: "把 notes.md 里的 blue 全部改成 green。",
    check: async ({ sandbox }) => {
      const content = await readFile(join(sandbox, "notes.md"), "utf8");
      return content.includes("green") && !content.includes("blue") ? null : `内容不符：${content}`;
    },
  },
  {
    name: "edit-append-function",
    mode: "yolo",
    prompt: "使用 edit 或 write 工具直接修改 math.js 文件：在文件末尾新增函数 sub(a, b)，返回 a - b。不要只在回复中给出代码。",
    check: async ({ sandbox, toolCalls }) => {
      if (!toolCalls.includes("edit") && !toolCalls.includes("write")) {
        return "没有调用 edit/write 工具";
      }
      const content = await readFile(join(sandbox, "math.js"), "utf8");
      return content.includes("sub") ? null : "math.js 中没有 sub 函数";
    },
  },
  {
    name: "edit-fix-typo",
    mode: "yolo",
    prompt: "使用 edit 工具直接修改 math.js 文件：把拼写错误的函数名 mull 改成 mul，函数体保持不变。不要只在回复中给出代码。",
    check: async ({ sandbox }) => {
      const content = await readFile(join(sandbox, "math.js"), "utf8");
      return content.includes("function mul(") && !content.includes("function mull(")
        ? null
        : `拼写未修复：${content.slice(0, 60)}`;
    },
  },
  {
    name: "bash-calc",
    mode: "yolo",
    prompt: "运行命令 node calc.js 并告诉我输出。",
    check: async ({ output, toolCalls }) => {
      if (!toolCalls.includes("bash")) return "没有调用 bash 工具";
      return output.includes("42") ? null : "输出未包含 42";
    },
  },
  {
    name: "multi-step-fix-test",
    mode: "yolo",
    prompt:
      "运行命令 node run-tests.js，如果测试失败就修复 buggy.js 里的错误再重跑，直到测试通过。",
    check: async ({ output, toolCalls }) => {
      if (!toolCalls.includes("bash")) return "没有调用 bash 工具";
      if (!toolCalls.includes("edit") && !toolCalls.includes("write")) return "没有修改代码";
      return output.toLowerCase().includes("pass") || output.includes("通过")
        ? null
        : "输出未表明测试通过";
    },
  },
];

async function makeSandbox(kind: "plain" | "tests"): Promise<string> {
  const sandbox = await mkdtemp(join(tmpdir(), "luban-eval-"));
  await mkdir(join(sandbox, "src"), { recursive: true });
  await writeFile(
    join(sandbox, "math.js"),
    "function add(a, b) {\n  return a + b;\n}\n\nfunction multiply(a, b) {\n  return a * b;\n}\n\nfunction mull(a, b) {\n  return a * b;\n}\n",
    "utf8",
  );
  await writeFile(join(sandbox, "notes.md"), "favorite color is blue\n", "utf8");
  await writeFile(join(sandbox, "config.json"), '{ "env": "test", "debug": true }\n', "utf8");
  if (kind === "tests") {
    await writeFile(
      join(sandbox, "buggy.js"),
      // 故意缺少 toLowerCase：slug('Hello World') 会得到 'Hello-World'，测试失败，要求模型修复
      "function slug(s) {\n  return s.trim().replace(/ +/g, '-');\n}\n\nmodule.exports = { slug };\n",
      "utf8",
    );
    await writeFile(
      join(sandbox, "run-tests.js"),
      "const { slug } = require('./buggy.js');\nconst pass = slug('Hello World') === 'hello-world';\nconsole.log(pass ? 'ALL TESTS PASS' : 'TEST FAILED');\nprocess.exit(pass ? 0 : 1);\n",
      "utf8",
    );
    await writeFile(join(sandbox, "calc.js"), "console.log(7 * 6);\n", "utf8");
  } else {
    await writeFile(join(sandbox, "calc.js"), "console.log(42);\n", "utf8");
    await writeFile(join(sandbox, "run-tests.js"), "console.log('ALL TESTS PASS');\n", "utf8");
  }
  return sandbox;
}

function gitInit(dir: string): void {
  try {
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "e@e.io"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "e"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
  } catch {
    // 无 git 也可运行，只是没有回滚点
  }
}

console.log(`[eval] provider=${providerLabel} model=${settings.modelId}`);
let passed = 0;
const failures: string[] = [];

for (let i = 0; i < cases.length; i++) {
  const testCase = cases[i]!;
  const sandbox = await makeSandbox(i === cases.length - 1 ? "tests" : "plain");
  if (testCase.mode === "yolo") {
    gitInit(sandbox);
  }
  const evalSettings: Settings = { ...settings, permissionMode: testCase.mode ?? "default" };
  const toolCalls: string[] = [];
  const started = Date.now();
  try {
    const result = await runPrintMode({
      settings: evalSettings,
      modelOverrides,
      cwd: sandbox,
      prompt: testCase.prompt,
      onEvent: (event) => {
        if (event.type === "tool_call") {
          toolCalls.push(event.name);
        }
      },
    });
    const detail = await testCase.check({ output: result.output, toolCalls, sandbox });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (detail === null && result.exitCode === 0) {
      passed++;
      console.log(`  ✓ ${testCase.name}（${seconds}s，$${result.costUsd.toFixed(6)}）`);
    } else {
      failures.push(`${testCase.name}: ${detail ?? `exitCode=${result.exitCode}`}`);
      console.log(
        `  ✗ ${testCase.name}（${seconds}s）→ ${detail ?? `exitCode=${result.exitCode}`}`,
      );
    }
  } catch (error) {
    failures.push(`${testCase.name}: ${(error as Error).message}`);
    console.log(`  ✗ ${testCase.name} → 异常：${(error as Error).message}`);
  } finally {
    await rm(sandbox, { recursive: true, force: true }).catch(() => {});
  }
}

console.log(`\n[eval] 通过 ${passed}/${cases.length}`);
if (passed < 7) {
  console.error("[eval] 通过率低于基线（7/10），M1 出口条件未满足");
  process.exit(1);
}
console.log("[eval] 达到基线");
