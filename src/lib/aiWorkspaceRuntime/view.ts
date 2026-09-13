import { canContinue, canRetry, visibleChain } from "@/lib/aiWorkspace/lifecycle";
import * as ai from "@/lib/aiWorkspace/queries";
import type { AiMessage } from "@/lib/aiWorkspace/types";
import { isReplyRunning } from "./limits";

/**
 * A conversation as the browser shows it.
 *
 * Which answer is visible, and whether Continue or Retry apply, are decided here
 * with the Phase 1 lifecycle rules, so the browser renders decisions rather than
 * re-deriving them.
 */

export interface Exchange {
  userMessageId: string;
  /** The visible answer, head first. */
  chain: string[];
  retryTargetId: string | null;
  continueTargetId: string | null;
}

export function buildExchanges(messages: readonly AiMessage[]): Exchange[] {
  return messages.filter((m) => m.role === "user").map((user) => {
    const chain = visibleChain(messages.filter((m) => m.role === "assistant" && m.replyToMessageId === user.id));
    const head = chain[0];
    const tail = chain[chain.length - 1];
    return {
      userMessageId: user.id,
      chain: chain.map((m) => m.id),
      retryTargetId: head && canRetry(head, chain) ? head.id : null,
      continueTargetId: tail && canContinue(tail, chain) ? tail.id : null,
    };
  });
}

const PAGE = 100;
/** Long enough for a reply that has only just started to be claimed by its request. */
const ORPHAN_AFTER_MS = 20_000;

export async function conversationView(userId: string, conversationId: string, before: string | null = null) {
  const conversation = await ai.getConversation(userId, conversationId);
  if (!conversation) return null;
  const load = async () => (await ai.listMessages(userId, conversationId, { before, limit: PAGE })) ?? [];
  let messages = await load();

  /*
   * A reply marked streaming that no request in this process is writing was
   * left behind by a restart. The data layer recovers those after 15 minutes;
   * RichHabit runs as one instance, so here it can be recovered at once, and
   * the admin sees "interrupted" with Retry instead of a reply that never ends.
   */
  const orphaned = messages.filter((m) => m.role === "assistant" && m.status === "streaming"
    && !isReplyRunning(userId, m.id) && Date.now() - Date.parse(m.createdAt) > ORPHAN_AFTER_MS);
  if (orphaned.length > 0) {
    for (const m of orphaned) {
      await ai.finishReply(userId, m.id, { status: "failed", content: m.content, errorCode: "interrupted" });
    }
    messages = await load();
  }

  return {
    conversation,
    messages,
    exchanges: buildExchanges(messages),
    hasEarlier: messages.length === PAGE,
    files: await ai.listFiles(userId, { conversationId }),
  };
}
