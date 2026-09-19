import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { loadState } from "@/lib/db/queries";
import { coach } from "@/lib/coach";
import { getDict, getLocale } from "@/lib/i18n/server";
import { trackEvent } from "@/lib/analytics/track";
import { coach as coachEnv } from "@/lib/env";
import { takeCoachRequest, type CoachAllowance } from "@/lib/ai/coachLimit";
import { AiFailed, coachProvider } from "@/lib/ai/provider";

/**
 * The AI coach. The client sends a question and nothing else; this route reads
 * the account, builds the JSON picture with `coach.buildContext`, and answers
 * from it. Returns { answer }.
 *
 * Claude answers, through the consumer provider seam in `@/lib/ai/provider` —
 * the same seam and the same server-only credential as intention suggestions.
 * Without a credential the route refuses with a 501 rather than pretending, so
 * nothing in the app quietly comes to depend on a model being reachable:
 * `coach.suggestions` is still what the Insights screen renders on its own.
 *
 * No provider SDK is imported here, and no provider message ever reaches the
 * caller: the browser puts `error.message` straight on screen, so every failure
 * answers with the app's own wording.
 */

// A reasoning model is slow enough to outlast the default serverless timeout.
export const maxDuration = coachEnv.timeoutSeconds;

const INSTRUCTIONS = `You are the coach inside a habit-tracking app called RichHabit.

You are given a JSON snapshot of one person's habit data: per-habit completion
stats over a window, averages by category, goals and the habits supporting them,
health metrics, and recent weekly reviews. Categories are windows of the day.

Ground every claim in that snapshot:
- Quote the actual numbers — completion percentages, counts, streaks, the score.
- Say what the numbers have in common across habits, not one habit at a time.
- Tie what you recommend back to the goal the habit supports, where there is one.
- Separate what the data supports from what it only hints at. Say which you mean.
- Never call something a trend on a handful of observations. If there are two
  days of sleep data, say two days is not enough to establish a trend, and stop
  there rather than reaching for the pattern anyway.
- If the snapshot cannot answer the question, say so instead of inventing.

Recommend one small change the person can act on tomorrow, not a new routine.
Be brief: a few sentences, or a short list when the answer really has parts. No
preamble, no restating the question back.`;

/**
 * The reply has to come back in the language the person is reading the app in.
 * Habit names in the data may be in either language — someone can rename a
 * habit in English while using the Chinese interface — so the instruction is
 * about the prose, and names are quoted as they were written.
 */
const LANGUAGE: Record<string, string> = {
  en: "Answer in English.",
  zh: "用简体中文回答。习惯和目标的名称按用户记录时的原文引用，不要翻译。语气自然、直接，不要书面公文腔。",
  // Two people may be reading the same screen, so the answer carries both.
  both: `Answer twice: first the full answer in English, then a blank line, then
the same answer in Simplified Chinese. Do not summarise the second one — it is
for a different reader, not a translation note. Quote habit and goal names
exactly as they are stored in both versions; do not translate them.`,
};

export async function POST(request: Request) {
  const msg = getDict().errors;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: msg.notSignedIn }, { status: 401 });

  const locale = getLocale();

  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "No question" }, { status: 400 });
  if (question.length > coachEnv.maxQuestionLength) {
    return NextResponse.json({ error: msg.questionTooLong }, { status: 400 });
  }

  /* Asked before the limit is charged: a coach that is not configured cannot
     cost anything, so it must not cost allowance either. */
  const provider = await coachProvider();
  if (!provider) {
    return NextResponse.json(
      { error: msg.coachUnavailable },
      { status: 501 },
    );
  }

  /**
   * The safety limit, charged *before* the provider call: a request that times
   * out, errors or is abandoned still costs money, so it still costs allowance.
   * Durable and shared between instances, which the in-memory limiter used for
   * intention suggestions is not.
   *
   * This is a platform cost guard, not a plan entitlement — Pro accounts and
   * admins are limited too. Any Free/Pro AI allowance will sit in front of it.
   */
  let allowance: CoachAllowance;
  try {
    allowance = await takeCoachRequest(user.id);
  } catch {
    // Unable to count means unable to guarantee the guard. Fail closed rather
    // than calling a paid provider without a limit behind it.
    return NextResponse.json({ error: msg.coachLimitUnavailable }, { status: 503 });
  }
  if (!allowance.ok) {
    return NextResponse.json(
      { error: allowance.reason === "hour" ? msg.coachHourlyLimit : msg.coachDailyLimit },
      // A hint, not a promise: the exact moment depends on when the oldest
      // request in the window falls out of it.
      { status: 429, headers: { "retry-after": allowance.reason === "hour" ? "600" : "3600" } },
    );
  }

  try {
    // Read the account here rather than trusting a context from the browser —
    // row-level security scopes this to the signed-in user either way.
    const state = await loadState(user.id);
    const context = coach.buildContext(state, getDict());

    let answer: string;
    try {
      answer = await provider.generateText({
        system: `${INSTRUCTIONS}\n\n${LANGUAGE[locale] ?? LANGUAGE.en}`,
        prompt: [
          `Their data:\n${JSON.stringify(context)}`,
          `Their question:\n${question}`,
        ].join("\n\n"),
        maxTokens: coachEnv.maxOutputTokens,
        timeoutMs: coachEnv.timeoutSeconds * 1000,
      });
    } catch (error) {
      // A status code, never the provider's words: this message is rendered.
      const status = error instanceof AiFailed ? error.status : null;
      console.error(`[api] coach failed (${status ?? "no status"})`);
      // A refused key or configuration will not fix itself; anything else might.
      if (error instanceof AiFailed && error.rejected) {
        return NextResponse.json({ error: msg.coachUnavailable }, { status: 503 });
      }
      return NextResponse.json({ error: msg.coachFailed }, { status: 502 });
    }

    await trackEvent({
      userId: user.id, event: "coach_question_asked", page: "/insights",
      // Length and language help judge usage; the question itself is not stored.
      properties: { locale, questionLength: question.length },
    });

    if (!answer) {
      return NextResponse.json({ error: msg.coachEmpty }, { status: 502 });
    }
    return NextResponse.json({ answer });
  } catch (error) {
    // A bug or a database failure. Logged in full; the caller is told nothing,
    // because a raw error can name columns, constraints and sometimes values.
    console.error("[api] coach", error);
    return NextResponse.json({ error: msg.coachFailed }, { status: 500 });
  }
}
