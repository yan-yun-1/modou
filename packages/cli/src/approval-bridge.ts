import type { ApprovalAnswer, ApprovalRequest } from "@modou-dev/core";

type Subscriber = (req: ApprovalRequest | null) => void;

interface PendingEntry {
  req: ApprovalRequest;
  resolve: (a: ApprovalAnswer) => void;
}

/**
 * 审批桥：连接 AgentLoop 内部的审批请求与 UI 层。
 * 多个请求并发到达时按 FIFO 排队逐个展示（plan-m2 Q1），回答完成后自动弹出下一个。
 */
export class ApprovalBridge {
  #queue: PendingEntry[] = [];
  #subscribers = new Set<Subscriber>();

  request(req: ApprovalRequest): Promise<ApprovalAnswer> {
    return new Promise((resolve) => {
      this.#queue.push({ req, resolve });
      this.#notify();
    });
  }

  /** 队列中等待审批的请求总数（C2：UI 显示"队列中还有 N 个"） */
  get pendingCount(): number {
    return this.#queue.length;
  }

  subscribe(fn: Subscriber): () => void {
    this.#subscribers.add(fn);
    fn(this.#current());
    return () => this.#subscribers.delete(fn);
  }

  /** 回答队首请求；若队列非空自动展示下一个 */
  answer(answer: ApprovalAnswer): void {
    const next = this.#queue.shift();
    this.#notify();
    next?.resolve(answer);
  }

  #current(): ApprovalRequest | null {
    return this.#queue[0]?.req ?? null;
  }

  #notify(): void {
    for (const fn of this.#subscribers) {
      fn(this.#current());
    }
  }
}
