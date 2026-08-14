import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { getSessionUser } from "@/lib/auth";
import { loadState, saveHabit } from "@/lib/db/queries";
import { getDict, getLocale } from "@/lib/i18n/server";
import { blankHabit } from "@/lib/habits";
import { RecommendationsUnavailable, generate } from "@/lib/recommend";
import { coach as coachEnv } from "@/lib/env";

/**
 * Proposes a replacement habit for each behaviour the user has named (§8–10).
 *
 * Everything it writes lands as `recommended`: visible in the backlog, absent
 * from Today and from the score, and requiring an explicit tap to adopt.
 * Nothing here can change a habit the user already has.
 *
 * Reasoning models are slow enough to outlast the default serverless timeout.
 */
export const maxDuration = coachEnv.timeoutSeconds;

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: getDict().errors.notSignedIn }, { status: 401 });

  const locale = getLocale();
  const t = getDict();

  return withUser(async (userId) => {
    const state = await loadState(userId);

    // Only behaviours still awaiting a decision, and only those without a
    // proposal already attached — asking twice should not produce duplicates.
    const proposedFor = new Set(
      state.habits.filter((h) => h.replacesHabitId).map((h) => h.replacesHabitId),
    );
    const behaviours = state.habits.filter(
      (h) => h.status === "candidate" && !proposedFor.has(h.id),
    );

    if (behaviours.length === 0) return { proposals: 0, reason: "nothing_to_propose" };

    let proposals;
    try {
      proposals = await generate(behaviours, state, t, locale);
    } catch (e) {
      if (e instanceof RecommendationsUnavailable) {
        return NextResponse.json({ error: t.errors.coachUnavailable }, { status: 501 });
      }
      throw e;
    }

    for (const p of proposals) {
      await saveHabit(userId, {
        ...blankHabit(),
        name: p.name,
        templateKey: null,        // generated text, not a template
        category: p.category,
        type: p.kind,
        weight: p.weight,
        target: p.target,
        unit: p.unit ?? "",
        status: "recommended",    // never active without approval
        active: false,
        replacesHabitId: p.replacesHabitId,
        rationale: p.rationale,
      });
    }

    await trackEvent({
      userId, event: "recommendations_generated", page: "/more/refine",
      // Counts only: neither the behaviours nor the proposals are recorded.
      properties: { behaviours: behaviours.length, proposals: proposals.length, locale },
    });

    return { proposals: proposals.length };
  });
}
