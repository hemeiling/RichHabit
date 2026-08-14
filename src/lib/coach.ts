import { rangeBack, todayISO } from "./dates";
import { CATEGORIES, catLabel, habitStats, rangeScore } from "./habits";
import type { AppState } from "./types";

/**
 * The seam for the AI coach. Nothing in the app depends on a model:
 * `suggestions` is computed from the data, and `buildContext` is what `ask`
 * POSTs to /api/coach when you want a real answer.
 */
export const coach = {
  buildContext(state: AppState, days = 90) {
    const end = todayISO();
    const dates = rangeBack(end, days);
    return {
      generatedAt: new Date().toISOString(),
      window: { from: dates[0], to: end, days },
      score: rangeScore(state, dates),
      byCategory: CATEGORIES.map((c) => {
        const habits = state.habits.filter((h) => h.category === c.id && h.active);
        const stats = habits.map((h) => ({ name: h.name, ...habitStats(state, h, days) }));
        const withPct = stats.filter((s) => s.pct != null);
        return {
          category: c.id,
          avgCompletion: withPct.length
            ? Math.round(withPct.reduce((a, b) => a + (b.pct ?? 0), 0) / withPct.length)
            : null,
          habits: stats,
        };
      }),
      goals: state.goals.map((g) => ({
        name: g.name,
        habits: state.habits.filter((h) => h.goalId === g.id).map((h) => h.name),
      })),
      metrics: Object.entries(state.metrics).slice(-days),
      recentReviews: state.reviews.slice(-4),
    };
  },

  suggestions(state: AppState): string[] {
    const out: string[] = [];
    const active = state.habits.filter((h) => h.active);
    const stats = active
      .map((h) => ({ h, s: habitStats(state, h, 14) }))
      .filter((x) => x.s.scheduled >= 3 && x.s.pct != null);
    if (!stats.length) return ["Give it a few days of tracking — patterns need data before they mean anything."];

    const sorted = [...stats].sort((a, b) => (a.s.pct ?? 100) - (b.s.pct ?? 100));
    const worst = sorted[0], best = sorted[sorted.length - 1];
    if ((worst.s.pct ?? 100) < 60)
      out.push(`"${worst.h.name}" is landing ${worst.s.pct}% of the time. Consider shrinking it or moving it earlier in the day.`);
    if ((best.s.pct ?? 0) >= 85)
      out.push(`"${best.h.name}" is solid at ${best.s.pct}%. It's a good anchor to stack a newer habit onto.`);

    const catAvg = CATEGORIES.map((c) => {
      const xs = stats.filter((x) => x.h.category === c.id);
      return { c, avg: xs.length ? xs.reduce((a, b) => a + (b.s.pct ?? 0), 0) / xs.length : null };
    }).filter((x): x is { c: (typeof CATEGORIES)[number]; avg: number } => x.avg != null)
      .sort((a, b) => a.avg - b.avg);
    if (catAvg.length > 1 && catAvg[0].avg < catAvg[catAvg.length - 1].avg - 15)
      out.push(`${catLabel(catAvg[0].c.id)} is your weakest window (${Math.round(catAvg[0].avg)}%). One habit there will move the score more than three anywhere else.`);

    if (active.length > 12)
      out.push("You're tracking a lot at once. The phased approach works better: pick one window and let it settle.");

    return out.length ? out : ["Nothing looks off. Keep the current set steady for another week."];
  },

  /**
   * Only the question crosses the wire. The route re-reads the account with the
   * server's client and calls `buildContext` there, so the answer is grounded in
   * stored data rather than whatever the browser happened to be holding.
   */
  async ask(question: string, signal?: AbortSignal): Promise<string> {
    const res = await fetch("/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
      signal,
    });
    const data = await res.json().catch(() => null) as { answer?: string; error?: string } | null;
    if (!res.ok) throw new Error(data?.error || `Coach request failed (${res.status}).`);
    if (!data?.answer) throw new Error("The coach returned an empty answer.");
    return data.answer;
  },
};
