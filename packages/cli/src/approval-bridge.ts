import type { ApprovalAnswer, ApprovalRequest } from "@luban/core";

type Subscriber = (req: ApprovalRequest | null) => void;

/**
 * 审批桥：连接 AgentLoop 内部的审批请求与 UI 层。
 * loop 侧调 request() 挂起等待；UI 侧订阅展示、调 answer() 交还决定。
 */
export class ApprovalBridge {
  #pending: { req: ApprovalRequest; resolve: (a: ApprovalAnswer) => void } | null = null;
  #subscribers = new Set<Subscriber>();

  request(req: ApprovalRequest): Promise<ApprovalAnswer> {
    if (this.#pending) {
      // 已有待审批请求时，后到的直接拒绝，避免排队堆积
      return Promise.resolve({ granted: false, remembered: false });
    }
    return new Promise((resolve) => {
      this.#pending = { req, resolve };
      this.#notify();
    });
  }

  subscribe(fn: Subscriber): () => void {
    this.#subscribers.add(fn);
    fn(this.#pending?.req ?? null);
    return () => this.#subscribers.delete(fn);
  }

  answer(answer: ApprovalAnswer): void {
    const pending = this.#pending;
    this.#pending = null;
    this.#notify();
    pending?.resolve(answer);
  }

  #notify(): void {
    for (const fn of this.#subscribers) {
      fn(this.#pending?.req ?? null);
    }
  }
}
