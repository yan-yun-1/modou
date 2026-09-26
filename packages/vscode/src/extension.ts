import type { ExtensionContext } from "vscode";
import * as vscode from "vscode";
import { ModouClient } from "./client.js";
import { ModouPanelProvider } from "./panel.js";
import { ModouServerProcess } from "./server.js";

/**
 * M5 D1（PRD F20）：墨斗 VS Code 插件入口（alpha）。
 * 激活 → 确认 modou serve 可达（探测/拉起）→ 注册侧边栏 webview。
 */
export function activate(context: ExtensionContext): void {
  const serverProcess = new ModouServerProcess(context);
  const client = new ModouClient(() => serverProcess.ensureRunning());
  const provider = new ModouPanelProvider(context, client);

  context.subscriptions.push(
    serverProcess,
    vscode.window.registerWebviewViewProvider("modou.panel", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("modou.focus", async () => {
      await vscode.commands.executeCommand("modou.panel.focus");
    }),
  );
}

export function deactivate(): void {}
