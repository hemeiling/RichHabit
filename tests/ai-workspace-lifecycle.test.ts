import { describe, expect, it } from "vitest";
import {
  canContinue, canFinish, canRetry, chainText, includeInHistory, visibleChain, type ChainMessage,
} from "../src/lib/aiWorkspace/lifecycle";

/** The reply lifecycle rules, with no database. */

let clock = 0;
const msg = (over: Partial<ChainMessage> & { id: string }): ChainMessage & { content: string } => ({
  replyKind: "reply", status: "complete", stopReason: "end_turn", continuationOfMessageId: null,
  retryOfMessageId: null, createdAt: new Date(Date.UTC(2026, 8, 13, 9, 0, clock++)).toISOString(), content: over.id,
  ...over,
});

describe("state transitions", () => {
  it("only a streaming reply can finish, and only into a final state", () => {
    expect(canFinish("streaming", "complete")).toBe(true);
    expect(canFinish("streaming", "stopped")).toBe(true);
    expect(canFinish("streaming", "failed")).toBe(true);
    expect(canFinish("streaming", "streaming")).toBe(false);
    for (const from of ["complete", "stopped", "failed"] as const) {
      for (const to of ["complete", "stopped", "failed", "streaming"] as const) expect(canFinish(from, to)).toBe(false);
    }
  });
});

describe("the visible answer", () => {
  it("is the reply alone when nothing else happened", () => {
    const r = msg({ id: "r" });
    expect(visibleChain([r]).map((m) => m.id)).toEqual(["r"]);
  });

  it("follows continuations in order", () => {
    const r = msg({ id: "r", status: "stopped" });
    const k1 = msg({ id: "k1", replyKind: "continuation", continuationOfMessageId: "r", status: "stopped" });
    const k2 = msg({ id: "k2", replyKind: "continuation", continuationOfMessageId: "k1" });
    expect(visibleChain([k2, r, k1]).map((m) => m.id)).toEqual(["r", "k1", "k2"]);
    expect(chainText(visibleChain([k2, r, k1]))).toBe("rk1k2");
  });

  it("switches to a retry, hiding the retried answer and its continuations", () => {
    const r = msg({ id: "r", status: "stopped" });
    const k = msg({ id: "k", replyKind: "continuation", continuationOfMessageId: "r", status: "failed" });
    const t = msg({ id: "t", replyKind: "retry", retryOfMessageId: "r" });
    expect(visibleChain([r, k, t]).map((m) => m.id)).toEqual(["t"]);
  });

  it("follows a retry of a retry to the newest", () => {
    const r = msg({ id: "r", status: "failed" });
    const t1 = msg({ id: "t1", replyKind: "retry", retryOfMessageId: "r", status: "failed" });
    const t2 = msg({ id: "t2", replyKind: "retry", retryOfMessageId: "t1" });
    expect(visibleChain([t2, r, t1]).map((m) => m.id)).toEqual(["t2"]);
  });

  it("is empty when there is no answer yet", () => {
    expect(visibleChain([])).toEqual([]);
  });
});

describe("Continue", () => {
  it("applies to a stopped tail", () => {
    const r = msg({ id: "r", status: "stopped" });
    expect(canContinue(r, [r])).toBe(true);
  });

  it("applies to a complete tail that reached the output limit", () => {
    const r = msg({ id: "r", status: "complete", stopReason: "max_tokens" });
    expect(canContinue(r, [r])).toBe(true);
  });

  it("does not apply to a normal finish, a failure, a streaming reply, or anything but the tail", () => {
    const done = msg({ id: "done" });
    const failed = msg({ id: "failed", status: "failed" });
    const streaming = msg({ id: "s", status: "streaming" });
    expect(canContinue(done, [done])).toBe(false);
    expect(canContinue(failed, [failed])).toBe(false);
    expect(canContinue(streaming, [streaming])).toBe(false);
    const r = msg({ id: "r2", status: "stopped" });
    const k = msg({ id: "k2", replyKind: "continuation", continuationOfMessageId: "r2", status: "stopped" });
    expect(canContinue(r, [r, k])).toBe(false);
    expect(canContinue(k, [r, k])).toBe(true);
  });

  it("does not apply to an answer that has been retried", () => {
    const r = msg({ id: "r3", status: "stopped" });
    const t = msg({ id: "t3", replyKind: "retry", retryOfMessageId: "r3" });
    expect(canContinue(r, visibleChain([r, t]))).toBe(false);
  });
});

describe("Retry", () => {
  it("applies to the head of the visible answer when nothing is streaming", () => {
    for (const status of ["complete", "stopped", "failed"] as const) {
      const r = msg({ id: `r-${status}`, status });
      expect(canRetry(r, [r])).toBe(true);
    }
  });

  it("does not apply to a continuation, a hidden answer, or while streaming", () => {
    const r = msg({ id: "r", status: "stopped" });
    const k = msg({ id: "k", replyKind: "continuation", continuationOfMessageId: "r", status: "streaming" });
    expect(canRetry(k, [r, k])).toBe(false);
    expect(canRetry(r, [r, k])).toBe(false);
    const t = msg({ id: "t", replyKind: "retry", retryOfMessageId: "r" });
    expect(canRetry(r, visibleChain([r, t]))).toBe(false);
    expect(canRetry(t, visibleChain([r, t]))).toBe(true);
  });
});

describe("history sent to the model", () => {
  it("includes a finished answer, including one continued to completion", () => {
    const r = msg({ id: "r", status: "stopped" });
    const k = msg({ id: "k", replyKind: "continuation", continuationOfMessageId: "r" });
    expect(includeInHistory([r, k])).toBe(true);
  });

  it("leaves out a failed or stopped answer, unless this request continues it", () => {
    const failed = msg({ id: "f", status: "failed" });
    const stopped = msg({ id: "s", status: "stopped" });
    expect(includeInHistory([failed])).toBe(false);
    expect(includeInHistory([stopped])).toBe(false);
    expect(includeInHistory([stopped], "s")).toBe(true);
    expect(includeInHistory([failed], "f")).toBe(false);
    expect(includeInHistory([])).toBe(false);
  });
});
