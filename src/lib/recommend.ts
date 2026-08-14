import OpenAI from "openai";
import { coach as coachEnv } from "@/lib/env";
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
 * rest of the app knowing.
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

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proposals"],
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        // Strict mode requires every property to be listed. Optional values are
        // expressed as a nullable type instead — `target: null` means "no
        // number helps here", which is the common case.
        required: ["behaviourId", "name", "category", "weight", "target", "unit", "rationale"],
        properties: {
          behaviourId: { type: "string" },
          name: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          weight: { type: "integer", minimum: 1, maximum: 3 },
          target: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          rationale: { type: "string" },
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
  if (!coachEnv.apiKey) throw new RecommendationsUnavailable();

  const client = new OpenAI({ apiKey: coachEnv.apiKey });

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

  const response = await client.responses.create({
    model: coachEnv.model,
    reasoning: { effort: "medium" },
    instructions: `${INSTRUCTIONS}\n\n${LANGUAGE[locale] ?? LANGUAGE.en}`,
    input,
    text: {
      format: { type: "json_schema", name: "proposals", schema: SCHEMA, strict: true },
    },
  });

  const raw = response.output_text?.trim();
  if (!raw) return [];

  let parsed: { proposals?: unknown[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const byId = new Map(behaviours.map((h) => [h.id, h]));
  const out: Proposal[] = [];

  for (const item of parsed.proposals ?? []) {
    const p = item as Record<string, unknown>;
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
