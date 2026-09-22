import { detectColorLevel, type ColorLevel } from "./terminal-capability.js";

/** ASCII Logo（墨斗 MODOU），逐行带色：字母 94 / 分隔线 90 / 文字 93，行尾 \x1b[0m 复位 */
const LOGO_LINES: { text: string; code: string }[] = [
  { text: "  ███╗   ███╗ ██████╗", code: "94" },
  { text: "  ████╗ ████║██╔═══██╗", code: "94" },
  { text: "  ██╔████╔██║██║   ██║", code: "94" },
  { text: "  ██║╚██╔╝██║██║   ██║", code: "94" },
  { text: "  ██║ ╚═╝ ██║╚██████╔╝", code: "94" },
  { text: "  ╚═╝     ╚═╝ ╚═════╝", code: "94" },
  { text: "  ──────────────────────────────── 墨斗 · MODOU", code: "93" },
];

export interface LogoOptions {
  /** 颜色能力；缺省自动探测 */
  colorLevel?: ColorLevel;
  /** 输出流；默认 stderr（不污染 -p 的 stdout 管道） */
  write?: (s: string) => void;
}

/** 单行着色：`\x1b[<code>m` + 文本 + `\x1b[0m`；level<1 时纯文本 */
function colorize(line: { text: string; code: string }, level: ColorLevel): string {
  if (level < 1) {
    return line.text;
  }
  return `\x1b[${line.code}m${line.text}\x1b[0m`;
}

/**
 * 打印 ASCII Logo（L1）：字母亮蓝（94）、分隔线+文字亮黄（93，按素材"墨斗 · MODOU"行整体 93）。
 * 颜色不支持时回退纯文本。写入 stderr（交互模式 Ink 接管 stdout，stderr 不干扰 TUI；无头模式不污染管道输出）。
 */
export function printLogo(options: LogoOptions = {}): void {
  const level = options.colorLevel ?? detectColorLevel();
  const write = options.write ?? ((s: string) => process.stderr.write(s));
  for (const line of LOGO_LINES) {
    write(`${colorize(line, level)}\n`);
  }
}

/** --no-logo 是否生效：显式 true 跳过 */
export function shouldPrintLogo(noLogo: boolean | undefined): boolean {
  return !noLogo;
}
