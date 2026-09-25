/**
 * 终端能力探测与渲染降级表（conhost 兼容层）。
 *
 * Windows 原生 cmd（conhost）的问题：
 * - SGR 2（dimColor）把前景调暗 → 黑底上 `░` 糊成实心块
 * - 颜色只有 16 色安全集（30-37/90-97），cyan 刺眼
 * - 重音符 spinner（✻✽✜）部分字体缺字形
 *
 * 所有组件的视觉样式只从 `terminalStyle()` 取，不直接写死。
 */

export type ColorLevel = 0 | 1 | 2 | 3; // 0=无色 1=16色 2=256色 3=truecolor

/** 颜色能力探测（零依赖，纯 env 信号） */
export function detectColorLevel(
  env: Record<string, string | undefined> = process.env,
): ColorLevel {
  if (env.NO_COLOR) {
    return 0;
  }
  const forced = Number(env.FORCE_COLOR ?? 0);
  if (forced >= 3) {
    return 3;
  }
  if (env.WT_SESSION) {
    return 3; // Windows Terminal
  }
  if (env.TERM_PROGRAM === "vscode" || env.TERM_PROGRAM === "iTerm.app") {
    return 3;
  }
  if (env.ANSICON || env.ConEmuANSI === "ON") {
    return 2;
  }
  if (env.COLORFGBG) {
    return 2; // 类 Unix 图形终端
  }
  if (/xterm-256|alacritty|kitty|wezterm/.test(env.TERM ?? "")) {
    return 3;
  }
  if (/xterm|screen|vt100/.test(env.TERM ?? "")) {
    return 2;
  }
  return 1; // 兜底：Windows conhost / 老终端按 16 色处理
}

/** 与颜色无关的降级：字符表（spinner/进度条空格/图标） */
export interface GlyphTable {
  spinner: string[];
  barEmpty: string;
  planIcon: string;
}

const GLYPHS_RICH: GlyphTable = {
  spinner: ["✻", "✽", "✜", "✢", "✣", "✲", "✳"],
  barEmpty: "░",
  planIcon: "⎘",
};

const GLYPHS_PLAIN: GlyphTable = {
  spinner: ["|", "/", "-", "\\"],
  barEmpty: "─",
  planIcon: "[计划]",
};

/** 状态栏/文字降级色（Ink color 名） */
export interface StyleTable {
  /** 代替 dimColor 的暗淡文字色 */
  dim: string | undefined;
  /** 输入框边框色 */
  border: string;
  /** 状态栏模型名 */
  model: string;
  /** 状态栏权限模式（与模型名区分的强调色） */
  permission: string;
  /** 成本 */
  cost: string;
  /** 用户消息前缀 */
  user: string;
  /** 计划确认卡标题色 */
  plan: string;
}

const STYLE_RICH: StyleTable = {
  dim: undefined, // 用原生 dimColor
  border: "cyan",
  model: "cyan",
  permission: "yellowBright",
  cost: "green",
  user: "cyan",
  plan: "cyan",
};

const STYLE_PLAIN: StyleTable = {
  dim: "gray", // ANSI 90 亮黑，conhost 下可读不糊块
  border: "blue",
  model: "blue",
  permission: "yellow", // conhost 安全色
  cost: "green",
  user: "cyan",
  plan: "blue",
};

export interface TerminalStyle {
  level: ColorLevel;
  glyphs: GlyphTable;
  style: StyleTable;
}

let cached: TerminalStyle | null = null;

/** 全局单例（CLI 启动时探测一次）；测试可 invalidate */
export function terminalStyle(
  env: Record<string, string | undefined> = process.env,
): TerminalStyle {
  if (cached && env === process.env) {
    return cached;
  }
  const level = detectColorLevel(env);
  const result: TerminalStyle =
    level >= 2
      ? { level, glyphs: GLYPHS_RICH, style: STYLE_RICH }
      : { level, glyphs: GLYPHS_PLAIN, style: STYLE_PLAIN };
  if (env === process.env) {
    cached = result;
  }
  return result;
}

/** 测试用：清除单例缓存 */
export function resetTerminalStyleCache(): void {
  cached = null;
}
