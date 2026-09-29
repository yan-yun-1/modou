import { PassThrough } from "node:stream";
import type { ReactElement } from "react";
import { render } from "ink";
import { resetTerminalStyleCache } from "../src/terminal-capability.js";

/**
 * 测试钉住终端能力：组件渲染走的 terminalStyle() 探测的是宿主 shell 的
 * TERM / WT_SESSION / TERM_PROGRAM 等信号（带缓存单例）——同一套字形断言
 * （如 BusyLine 的重音符 spinner /✻✽✜…/）在带 TERM 的终端通过、在无 TERM 的
 * CI 或 cmd 直启下退到 plain 表（|/-\）而失败。夹具统一钉为 rich 档并重置
 * 单例缓存，保证渲染类测试与宿主环境无关；detectColorLevel 的纯函数分支
 * 仍由 terminal-capability.test.ts 用显式 env 对象覆盖，不受此影响。
 */
function pinRichTerminal(): void {
  process.env.TERM = "xterm-256color";
  delete process.env.NO_COLOR;
  resetTerminalStyleCache();
}

export interface InkHarness {
  /** 全部帧拼接并清除 ANSI 转义码（断言用 contains 即可） */
  text: string;
  /** 最近一帧原始输出 */
  frame: string;
  frames: string[];
  stdin: PassThrough;
  unmount: () => void;
  cleanExit: Promise<void>;
}

/**
 * ink 5 的轻量测试夹具：capture stdout、可写 stdin。
 * 替代 ink-testing-library（它是 CJS，无法在 Node 原生 require(esm) 下加载 ESM-only 的 ink 5）。
 */
export function renderInk(element: ReactElement): InkHarness {
  pinRichTerminal();
  const frames: string[] = [];
  const stdout = new PassThrough();
  (stdout as PassThrough & { isTTY?: boolean; columns?: number }).isTTY = true;
  (stdout as PassThrough & { isTTY?: boolean; columns?: number }).columns = 100;
  stdout.on("data", (chunk: Buffer) => {
    frames.push(chunk.toString("utf8"));
  });

  const stdin = new PassThrough();
  const stdinStub = stdin as PassThrough & {
    isTTY?: boolean;
    setRawMode?: () => void;
    ref?: () => void;
    unref?: () => void;
  };
  stdinStub.isTTY = true;
  stdinStub.setRawMode = () => stdin;
  // ink 的 useInput 会调用 stdin.ref()/unref() 管理事件循环引用
  stdinStub.ref = () => {};
  stdinStub.unref = () => {};

  const instance = render(element, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  return {
    get frame() {
      return frames.at(-1) ?? "";
    },
    get text() {
      // eslint-disable-next-line no-control-regex -- 目的就是剥离 ANSI 转义码
      return frames.join("").replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "");
    },
    frames,
    stdin,
    unmount: () => instance.unmount(),
    cleanExit: instance.waitUntilExit(),
  };
}

export async function settle(ms = 50): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
