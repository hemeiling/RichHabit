import { coach as coachEnv } from "@/lib/env";
import { coachProvider } from "@/lib/ai/provider";
import { habitName } from "@/lib/templates";
import type { Dict } from "@/lib/i18n";
import type { AppState, Category, Habit, HabitKind } from "@/lib/types";

/**
 * Turning behaviours the user named into habits they might adopt (§8–10, §18).
 *
 * Four constraints from CLAUDE.md shape this file:
 *
 *   - **A recommendation is a proposal, never a change.** Nothing here writes
 *     an active habit. Everything it produces arrives as `recommended` and sits
 *     in the backlog until the user puts it on their sheet.
 *   - **The original behaviour is kept.** §10: the pair — what they do now and
 *     what they mean to do instead — is the useful artefact, so a replacement
 *     links back rather than deleting what it replaces.
 *   - **Explainable.** Every proposal carries a rationale in the user's
 *     language. A recommendation you cannot interrogate is not one you can
 *     meaningfully approve.
 *   - **Never load-bearing.** No API key means no suggestions and nothing else
 *     changes. Tracking does not depend on a model being reachable.
 *
 * The provider lives behind `generate` so the model can be swapped without the
 * rest of the app knowing. Claude answers, through the consumer seam in
 * `@/lib/ai/provider` — the same seam, credential and configuration the coach
 * uses. No provider SDK is imported here.
 *
 * **No rate limit of its own, deliberately, and this is a known gap.** The coach
 * has a durable per-account limit in `coach_requests`; this does not, and it must
 * not borrow that counter — the two are different features and one must not spend
 * the other's allowance. What bounds this today is the work it needs: a request
 * only reaches a model when the person has behaviours awaiting a decision that
 * have no proposal yet, so an idle account cannot spend anything and a busy one
 * spends once per behaviour. That is small but not nothing. Whether
 * recommendations get their own allowance is a Phase 6 AI cost decision, to be
 * taken with the Free/Pro AI allowances rather than bolted on here.
 */

export interface Proposal {
  /** The behaviour it replaces, from the caller's candidate list. */
  replacesHabitId: string;
  name: string;
  category: Category;
  kind: HabitKind;
  weight: 1 | 2 | 3;
  target: number | null;
  unit: string | null;
  rationale: string;
}

export class RecommendationsUnavailable extends Error {}

const CATEGORIES: Category[] = ["morning", "daytime", "nighttime"];

const INSTRUCTIONS = `You help someone turn behaviours they want to change into
specific habits they could track in a habit app.

For each behaviour you are given, propose exactly one replacement habit.

Rules:
- Make it small enough to do on a bad day. "Stand up every hour" beats "restructure
  my working day". The point is something they will actually do.
- Make it observable. A person must be able to say yes or no at the end of the day.
- Never propose the same behaviour back, negated. "Sit less" is not a habit;
  "stand and move for two minutes every hour" is.
- Set a target only when a number genuinely helps. Most habits need none.
- Explain in one short sentence why this replacement suits that behaviour. Address
  the person directly. Do not promise outcomes, do not cite research, and do not
  claim a habit forms in any particular number of days.
- Keep the category the person chose unless the behaviour clearly belongs to a
  different time of day.`;

/**
 * The shape asked of the model. Every property is described, and only the ones
 * that must always be present are required: a habit usually needs no number, so
 * `target` and `unit` are simply left out rather than sent as null. `parse`
 * below still treats anything missing or malformed as absent — a schema the
 * model was asked to follow is not a guarantee that it did.
 */
const SCHEMA = {
  type: "object",
  required: ["proposals"],
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        required: ["behaviourId", "name", "category", "weight", "rationale"],
        properties: {
          behaviourId: { type: "string", description: "The id of the behaviour this replaces, exactly as given." },
          name: { type: "string", description: "The replacement habit, in the person's language." },
          category: { type: "string", enum: CATEGORIES },
          weight: { type: "integer", minimum: 1, maximum: 3 },
          target: { type: "number", description: "Only when a number genuinely helps. Omit otherwise." },
          unit: { type: "string", description: "The unit for target, e.g. minutes. Omit when there is no target." },
          rationale: { type: "string", description: "One short sentence, addressed to the person." },
        },
      },
    },
  },
} as const;

const LANGUAGE: Record<string, string> = {
  en: "Write the habit names and rationales in English.",
  zh: "习惯名称和理由都用简体中文书写，语气自然、直接。",
  both: "Write each habit name and rationale in English, then a space, then Simplified Chinese.",
};

/**
 * Asks for one replacement per behaviour. Returns [] rather than throwing when
 * there is nothing to work with, so callers do not need a special case.
 */
export async function generate(
  behaviours: Habit[], state: AppState, t: Dict, locale: string,
): Promise<Proposal[]> {
  if (behaviours.length === 0) return [];

  const provider = await coachProvider();
  if (!provider) throw new RecommendationsUnavailable();

  // Only what is needed to judge: the behaviour, and what they already track so
  // the model does not propose something they are doing.
  const input = JSON.stringify({
    behaviours: behaviours.map((h) => ({
      id: h.id,
      behaviour: habitName(h, t),
      kind: h.type === "avoid" ? "does too much" : "wants to start",
      timeOfDay: h.category,
      importance: h.weight,
    })),
    alreadyTracking: state.habits
      .filter((h) => h.status === "active")
      .map((h) => habitName(h, t)),
    goals: state.goals.map((g) => g.name),
  });

  /*
   * One forced tool call, the same mechanism intention suggestions use: the
   * model is given a tool whose input schema is the shape we want. What comes
   * back is already an object, so there is no JSON string to parse and no
   * malformed-text branch — anything that is not the expected shape falls
   * through the validation below and is dropped.
   */
  const raw = await provider.generateStructured({
    system: `${INSTRUCTIONS}\n\n${LANGUAGE[locale] ?? LANGUAGE.en}`,
    prompt: input,
    toolName: "propose_habits",
    toolDescription: "Return one replacement habit for each behaviour, for the person to review.",
    schema: SCHEMA as unknown as Record<string, unknown>,
    maxTokens: coachEnv.maxOutputTokens,
    timeoutMs: coachEnv.timeoutSeconds * 1000,
  });

  const list = (raw as { proposals?: unknown } | null)?.proposals;
  // No tool call, or a shape we cannot read: no proposals, and nothing written.
  if (!Array.isArray(list)) return [];

  const byId = new Map(behaviours.map((h) => [h.id, h]));
  const out: Proposal[] = [];

  for (const item of list) {
    const p = (item ?? {}) as Record<string, unknown>;
    const source = byId.get(String(p.behaviourId));
    // A proposal that does not correspond to a behaviour the caller sent is
    // discarded rather than guessed at: it would otherwise attach itself to
    // the wrong row.
    if (!source) continue;

    const name = String(p.name ?? "").trim().slice(0, 200);
    const rationale = String(p.rationale ?? "").trim().slice(0, 600);
    if (!name) continue;

    const weight = Number(p.weight);
    const target = p.target == null ? null : Number(p.target);

    out.push({
      replacesHabitId: source.id,
      name,
      category: CATEGORIES.includes(p.category as Category)
        ? (p.category as Category) : source.category,
      // A replacement is something to build, whatever it replaces.
      kind: "good",
      weight: ([1, 2, 3].includes(weight) ? weight : source.weight) as 1 | 2 | 3,
      target: Number.isFinite(target) && target! > 0 ? target : null,
      unit: typeof p.unit === "string" && p.unit.trim() ? p.unit.trim().slice(0, 40) : null,
      rationale,
    });
  }

  return out;
}
