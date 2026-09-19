import { describe, expect, it } from "vitest";
import { PermissionEngine, type PermissionSnapshot } from "../src/permissions.js";

const read = { name: "read", kind: "read" as const, args: { path: "a.txt" } };
const grep = { name: "grep", kind: "read" as const, args: { pattern: "x" } };
const bash = (command: string) => ({ name: "bash", kind: "execute" as const, args: { command } });
const write = (path: string) => ({ name: "write", kind: "write" as const, args: { path } });

describe("PermissionEngine.decide", () => {
  it("always allows read tools in every mode", () => {
    for (const mode of ["plan", "default", "yolo"] as const) {
      const engine = new PermissionEngine({ mode });
      expect(engine.decide(read)).toBe("allow");
      expect(engine.decide(grep)).toBe("allow");
    }
  });

  it("plan mode denies every non-read tool regardless of rules", () => {
    const engine = new PermissionEngine({ mode: "plan" });
    engine.remember({ type: "execute-prefix", value: "npm test" });
    expect(engine.decide(bash("npm test"))).toBe("deny");
    expect(engine.decide(write("src/a.ts"))).toBe("deny");
  });

  it("default mode asks for execute and write", () => {
    const engine = new PermissionEngine({ mode: "default" });
    expect(engine.decide(bash("npm test"))).toBe("ask");
    expect(engine.decide(write("src/a.ts"))).toBe("ask");
  });

  it("yolo mode allows non-dangerous execute and write", () => {
    const engine = new PermissionEngine({ mode: "yolo" });
    expect(engine.decide(bash("npm test"))).toBe("allow");
    expect(engine.decide(write("src/a.ts"))).toBe("allow");
  });

  it("dangerous commands require asking even in yolo mode", () => {
    const engine = new PermissionEngine({ mode: "yolo" });
    expect(engine.decide(bash("rm -rf build/"))).toBe("ask");
    expect(engine.decide(bash("rm -fr node_modules"))).toBe("ask");
    expect(engine.decide(bash("git push --force origin main"))).toBe("ask");
    expect(engine.decide(bash("Remove-Item -Recurse -Force dist"))).toBe("ask");
    expect(engine.decide(bash("del /f /s *.log"))).toBe("ask");
  });

  it("execute-prefix rules allow matching commands in default mode", () => {
    const engine = new PermissionEngine({
      mode: "default",
      rules: [{ type: "execute-prefix", value: "npm test" }],
    });
    expect(engine.decide(bash("npm test"))).toBe("allow");
    expect(engine.decide(bash("npm test -- --watch"))).toBe("allow");
    expect(engine.decide(bash("npm run build"))).toBe("ask");
  });

  it("write-path rules allow matching paths in default mode", () => {
    const engine = new PermissionEngine({
      mode: "default",
      rules: [{ type: "write-path", value: "src/generated/" }],
    });
    expect(engine.decide(write("src/generated/api.ts"))).toBe("allow");
    expect(engine.decide(write("docs/api.md"))).toBe("ask");
  });

  it("dangerous commands still ask even when covered by a rule", () => {
    const engine = new PermissionEngine({
      mode: "default",
      rules: [{ type: "execute-prefix", value: "rm -rf" }],
    });
    expect(engine.decide(bash("rm -rf build/"))).toBe("ask");
  });
});

describe("PermissionEngine state", () => {
  it("remember() adds rules that affect decisions", () => {
    const engine = new PermissionEngine({ mode: "default" });
    expect(engine.decide(bash("npm test"))).toBe("ask");
    engine.remember({ type: "execute-prefix", value: "npm test" });
    expect(engine.decide(bash("npm test"))).toBe("allow");
  });

  it("snapshot() round-trips through a new engine", () => {
    const engine = new PermissionEngine({ mode: "default" });
    engine.remember({ type: "execute-prefix", value: "npm test" });
    engine.remember({ type: "write-path", value: "src/generated/" });
    const snapshot: PermissionSnapshot = engine.snapshot();
    const restored = new PermissionEngine(snapshot);
    expect(restored.decide(bash("npm test"))).toBe("allow");
    expect(restored.decide(write("src/generated/api.ts"))).toBe("allow");
    expect(restored.decide(bash("node script.js"))).toBe("ask");
  });

  it("snapshot() returns a copy that does not affect the engine", () => {
    const engine = new PermissionEngine({ mode: "default" });
    engine.remember({ type: "execute-prefix", value: "npm test" });
    const snapshot = engine.snapshot();
    snapshot.rules.push({ type: "execute-prefix", value: "evil" });
    snapshot.mode = "yolo";
    expect(engine.decide(bash("evil command"))).toBe("ask");
    expect(engine.mode).toBe("default");
  });

  it("defaults to default mode with no rules", () => {
    const engine = new PermissionEngine();
    expect(engine.mode).toBe("default");
    expect(engine.snapshot().rules).toEqual([]);
  });
});
