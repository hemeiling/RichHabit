import type { AiMessage, MessageStatus } from "./types";

/**
 * Reply lifecycle rules, pure and database-free.
 *
 * The four states are streaming, complete, stopped and failed. Only a streaming
 * reply changes state, and only into one of the other three.
 *
 * A "chain" is one answer to a user message: a head (a reply, or a retry of an
 * earlier head) followed by any continuations. Lineage comes from the explicit
 * link columns, never from text or timing guesses.
 */

/** A reply still streaming after this long is treated as interrupted. */
export const STALE_STREAMING_MINUTES = 15;

/** Stop reasons meaning the reply ended at the output limit. Normalised by providers. */
export const LENGTH_LIMIT_STOP_REASONS = ["max_tokens"] as const;

export type ChainMessage = Pick<AiMessage,
  "id" | "replyKind" | "status" | "stopReason" | "continuationOfMessageId" | "retryOfMessageId" | "createdAt">;

export function canFinish(from: MessageStatus, to: MessageStatus): boolean {
  return from === "streaming" && to !== "streaming";
}

const reachedLengthLimit = (m: ChainMessage) =>
  m.status === "complete" && (LENGTH_LIMIT_STOP_REASONS as readonly string[]).includes(m.stopReason ?? "");

/**
 * The answer currently shown for a user message, given every assistant message
 * that answers it: the newest head that nobody has retried, then its
 * continuations in order.
 */
export function visibleChain<T extends ChainMessage>(answers: readonly T[]): T[] {
  const retried = new Set(answers.map((m) => m.retryOfMessageId).filter(Boolean));
  const heads = answers
    .filter((m) => (m.replyKind === "reply" || m.replyKind === "retry") && !retried.has(m.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  if (heads.length === 0) return [];

  const continuationOf = new Map(
    answers.filter((m) => m.continuationOfMessageId).map((m) => [m.continuationOfMessageId as string, m]));
  const chain: T[] = [heads[0]];
  for (let next = continuationOf.get(heads[0].id); next; next = continuationOf.get(next.id)) chain.push(next);
  return chain;
}

/** Continue applies to the last part of the visible answer, if it stopped or hit the length limit. */
export function canContinue(target: ChainMessage, chain: readonly ChainMessage[]): boolean {
  const tail = chain[chain.length - 1];
  return Boolean(tail) && tail.id === target.id && (target.status === "stopped" || reachedLengthLimit(target));
}

/** Retry replaces the whole visible answer, once nothing in it is still streaming. */
export function canRetry(target: ChainMessage, chain: readonly ChainMessage[]): boolean {
  return chain.length > 0 && chain[0].id === target.id
    && (target.replyKind === "reply" || target.replyKind === "retry")
    && chain.every((m) => m.status !== "streaming");
}

/**
 * Whether an answer goes back to the model as history. A finished answer does.
 * An unfinished one does only when this very request is continuing it; a
 * failed one never does.
 */
export function includeInHistory(chain: readonly ChainMessage[], continuingMessageId?: string | null): boolean {
  const tail = chain[chain.length - 1];
  if (!tail) return false;
  // Complete includes an answer that ended at the output limit: what it says is final.
  if (tail.status === "complete") return true;
  return tail.status === "stopped" && tail.id === continuingMessageId;
}

/** The text of an answer as one string, parts joined in order. */
export function chainText(chain: readonly Pick<AiMessage, "content">[]): string {
  return chain.map((m) => m.content).join("");
}
