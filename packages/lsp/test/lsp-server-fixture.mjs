/**
 * M5 C1 测试夹具：最小 LSP server（stdio，vscode-jsonrpc 实现）。
 * - initialize → textDocumentSync=1（全量）
 * - didOpen/didChange → 内容含 ERROR_MARKER 时发布诊断，否则发布空诊断
 * - textDocument/definition → 位置 0:0 返回 rootUri 下的 target.ts:2:4，其余返回 null
 */
import { spawn } from "node:child_process";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node";
import {
  DefinitionRequest,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  ExitNotification,
  InitializeRequest,
  InitializedNotification,
  PublishDiagnosticsNotification,
  ShutdownRequest,
} from "vscode-languageserver-protocol";

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);
let rootUri = "";

connection.onRequest(InitializeRequest.type, (params) => {
  rootUri = params.rootUri ?? "";
  return { capabilities: { textDocumentSync: 1, definitionProvider: true } };
});
connection.onNotification(InitializedNotification.type, () => {});
connection.onNotification(DidOpenTextDocumentNotification.type, (params) => {
  publish(params.textDocument.uri, params.textDocument.text);
});
connection.onNotification(DidChangeTextDocumentNotification.type, (params) => {
  publish(params.textDocument.uri, params.contentChanges.at(-1)?.text ?? "");
});
connection.onRequest(DefinitionRequest.type, (params) => {
  if (params.position.line === 0 && params.position.character === 0 && rootUri) {
    return {
      uri: `${rootUri}/target.ts`,
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 10 } },
    };
  }
  return null;
});
connection.onRequest(ShutdownRequest.type, () => null);
connection.onNotification(ExitNotification.type, () => process.exit(0));

function publish(uri, text) {
  const diagnostics =
    typeof text === "string" && text.includes("ERROR_MARKER")
      ? [
          {
            range: { start: { line: 0, character: 10 }, end: { line: 0, character: 22 } },
            message: "mock: type error",
            severity: 1,
            source: "mock-lsp",
          },
        ]
      : [];
  connection.sendNotification(PublishDiagnosticsNotification.type, { uri, diagnostics });
}

connection.listen();
