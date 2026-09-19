import { PassThrough } from "node:stream";
import type { ReactElement } from "react";
import { render } from "ink";

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
