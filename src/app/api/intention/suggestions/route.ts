import { ApiError, body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { finishAiRequest, takeAiRequest } from "@/lib/ai/limits";
import { AiFailed, intentionAiProvider } from "@/lib/ai/provider";
import {
  buildSuggestionContext, parseSuggestionRequest, parseSuggestions, suggestionPrompt,
} from "@/lib/ai/intentionSuggestions";
import { isSchemaBehind } from "@/lib/db/diagnose";
import { intentionSuggestionSource } from "@/lib/db/queries";
import { intentionAi } from "@/lib/env";
import { getDict, getLocale } from "@/lib/i18n/server";
import { habitName } from "@/lib/templates";
import type { Habit } from "@/lib/types";

/**
 * Suggested habits or priorities for the signed-in person's intention.
 *
 * Claude recommends; the person decides. This route reads, asks and answers —
 * it never writes a habit, a priority, an intention or anything else. The drafts
 * it returns exist only on screen until the person explicitly adds one through
 * the ordinary habit and priority actions.
 *
 * What the browser sends is only which list and the drafts already on screen.
 * The intention itself is read here from the database, so the model receives
 * exactly the fields lib/ai/intentionSuggestions allows and nothing the browser
 * happened to hold.
 *
 * Nothing the person wrote, and nothing the model wrote, is logged or placed in
 * analytics. A provider failure is logged as a status code only.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const t = getDict();
    const { kind, exclude } = parseSuggestionRequest(await body(request));

    const provider = await intentionAiProvider();
    if (!provider) throw new ApiError(t.intention.ai.unavailable, 501);

    let source;
    try {
      source = await intentionSuggestionSource(userId);
    } catch (e) {
      if (isSchemaBehind(e)) throw new ApiError(t.intention.unavailableBody, 503);
      throw e;
    }
    if (!source || !source.want.trim()) throw new ApiError(t.intention.ai.needsIntention, 400);

    const slot = takeAiRequest(userId, { hourly: intentionAi.hourlyLimit, daily: intentionAi.dailyLimit });
    if (!slot.ok) throw new ApiError(slot.reason === "busy" ? t.intention.ai.busy : t.intention.ai.limited, 429);

    try {
      // Titles of records already linked to this intention, and only those.
      const linked = kind === "habits"
        ? source.habits.map((h) => habitName(h as Habit, t))
        : source.priorities;
      const context = buildSuggestionContext(source, linked, getLocale());
      const prompt = suggestionPrompt(kind, context, exclude);

      let raw: unknown;
      try {
        raw = await provider.generateStructured({ ...prompt, timeoutMs: intentionAi.timeoutSeconds * 1000 });
      } catch (e) {
        const status = e instanceof AiFailed ? e.status : null;
        console.error(`[api] intention suggestions failed (${status ?? "no status"})`);
        // A refused key or configuration will not fix itself; anything else might.
        if (e instanceof AiFailed && e.rejected) throw new ApiError(t.intention.ai.unavailable, 503);
        throw new ApiError(t.intention.ai.failed, 502);
      }

      const suggestions = parseSuggestions(raw, kind, linked, exclude);
      // Which list was asked for, and nothing else.
      await trackEvent({
        userId, event: "intention_ai_suggestions_requested", page: "/intention",
        properties: { kind },
      });
      return { suggestions };
    } finally {
      finishAiRequest(userId);
    }
  });
}
