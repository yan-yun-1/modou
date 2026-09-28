import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { saveToken } from "./client.js";

/** plan-web §2.9：令牌门——服务开启鉴权后，401 触发一次输入并持久化。 */
export function TokenGate({ onSaved }: { onSaved: () => void }): JSX.Element {
  const [value, setValue] = useState("");
  const submit = () => {
    if (value.trim()) {
      saveToken(value.trim());
      onSaved();
    }
  };
  return (
    <div class="token-gate">
      <h2>⌘ 需要访问令牌</h2>
      <p>此服务开启了 Bearer 鉴权。输入 modou serve 启动时打印的 token：</p>
      <input
        type="password"
        placeholder="token"
        value={value}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button class="btn primary" onClick={submit}>
        保存并继续
      </button>
    </div>
  );
}
