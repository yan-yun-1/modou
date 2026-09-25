import type { ApprovalAnswer, ApprovalRequest } from "@modou-dev/core";

type Subscriber = (req: ApprovalRequest | null) => void;

interface PendingEntry {
  req: ApprovalRequest;
  resolve: (a: ApprovalAnswer) => void;
}

/**
 * 审批桥：连接 AgentLoop 内部的审批请求与 UI 层。
 * 多个请求并发到达时按 FIFO 排队逐个展示（plan-m2 Q1），回答完成后自动弹出下一个。
 * M4 A2：新增按 id 寻址的 answerById——server/ACP 远程审批按 approval_request.id
 * 路由，不受队列顺序限制；FIFO 的 answer() 语义保持不变（CLI 兼容）。
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

  /**
   * 按 id 回答指定请求。
   * @returns 是否找到并 resolve 了该请求（找不到返回 false，调用方可 404）
   */
  answerById(id: string, answer: ApprovalAnswer): boolean {
    const index = this.#queue.findIndex((entry) => entry.req.id === id);
    if (index === -1) {
      return false;
    }
    const [entry] = this.#queue.splice(index, 1);
    this.#notify();
    entry?.resolve(answer);
    return true;
  }

  /** 当前所有待审批请求（server SSE 快照/重连场景用） */
  pendingRequests(): ApprovalRequest[] {
    return this.#queue.map((entry) => entry.req);
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
