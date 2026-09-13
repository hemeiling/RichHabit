import { body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { SUGGESTION_KINDS } from "@/lib/ai/intentionSuggestions";
import { check } from "@/lib/http";

/**
 * Records that a suggestion was accepted, or accepted after being edited.
 *
 * Generic events only: the kind of list, and never the suggestion, the edited
 * text or the intention. The record itself is created through the ordinary
 * habit and priority routes, exactly as if the person had typed it.
 */
const EVENTS = {
  accepted: "intention_ai_suggestion_accepted",
  edited: "intention_ai_suggestion_edited",
} as const;

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const b = await body<{ event?: unknown; kind?: unknown }>(request);
    const event = check.oneOf(b.event, ["accepted", "edited"] as const, "event");
    const kind = check.oneOf(b.kind, SUGGESTION_KINDS, "kind");
    await trackEvent({ userId, event: EVENTS[event], page: "/intention", properties: { kind } });
  });
}
