# @modou-dev/sdk

墨斗 Modou SDK——可编程嵌入的 Agent 装配层（PRD F17）。

```js
import { createLoopFromSettings, loadSettings, ApprovalBridge } from "@modou-dev/sdk";

const settings = await loadSettings(); // ~/.modou/settings.json
const bundle = await createLoopFromSettings({ settings, cwd: process.cwd() });
for await (const event of bundle.loop.run("你好", bundle.sessionId)) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
}
await bundle.closeMcp();
```

详见 README（根目录）与 docs/plan-m4.md。
