import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProvider, StructuredRequest } from "../src/lib/ai/provider";

/**
 * AI habit recommendations, now answered by Claude through the consumer seam.
 *
 * The product rules matter more than the provider: a recommendation is a
 * proposal, never a change; it arrives as `recommended` and never active; it
 * keeps the behaviour it replaces; and a model that returns nonsense must write
 * nothing at all rather than half a habit.
 */

const state = vi.hoisted(() => ({
  asked: [] as unknown[],
  answer: null as unknown,
  fail: false as number | false,
  configured: true,
  saved: [] as any[],
  tracked: [] as any[],
  user: { id: "11111111-1111-4111-8111-111111111111" },
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined }),
  headers: () => new Map(),
}));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/lib/analytics/track", () => ({ trackEvent: async (e: any) => { state.tracked.push(e); } }));
vi.mock("@/lib/db/queries", () => ({
  loadState: async () => ({
    habits: [
      // Two behaviours awaiting a decision, and one habit already tracked.
      { id: "b1", name: "Sit all afternoon", category: "daytime", status: "candidate", type: "avoid", weight: 2, active: false },
      { id: "b2", name: "Check email in bed", category: "nighttime", status: "candidate", type: "avoid", weight: 3, active: false },
      { id: "h1", name: "Read for learning", category: "morning", status: "active", type: "good", weight: 1, active: true },
    ],
    goals: [{ id: "g1", name: "Finish the course" }],
    metrics: {}, reviews: [],
  }),
  saveHabit: async (_userId: string, habit: any) => { state.saved.push(habit); },
}));
vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/ai/provider")>();
  return {
    ...actual,
    coachProvider: async () => (state.configured ? {
      name: "fake",
      async generateStructured(request: StructuredRequest) {
        state.asked.push(request);
        if (state.fail !== false) throw new actual.AiFailed(state.fail);
        return state.answer;
      },
      async generateText() { throw new Error("recommendations must ask for a shape, not prose"); },
    } satisfies AiProvider : null),
  };
});

process.env.CLAUDE_API_KEY = "placeholder-not-a-key";
const { POST } = await import("../src/app/api/recommendations/route");
const post = () => POST();

const PROPOSALS = {
  proposals: [
    {
      behaviourId: "b1", name: "Stand and move for two minutes every hour",
      category: "daytime", weight: 2, rationale: "It interrupts the sitting without asking for a new routine.",
    },
    {
      behaviourId: "b2", name: "Leave the phone charging outside the bedroom",
      category: "nighttime", weight: 3, target: 1, unit: "night",
      rationale: "It removes the cue rather than relying on willpower at midnight.",
    },
  ],
};

beforeEach(() => {
  state.asked = [];
  state.answer = PROPOSALS;
  state.fail = false;
  state.configured = true;
  state.saved = [];
  state.tracked = [];
});

describe("POST /api/recommendations, answered by Claude", () => {
  it("proposes one replacement per behaviour, always as a proposal", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ proposals: 2 });
    expect(state.saved).toHaveLength(2);
    for (const habit of state.saved) {
      // Never active without approval, and never a template.
      expect(habit.status).toBe("recommended");
      expect(habit.active).toBe(false);
      expect(habit.templateKey).toBeNull();
      // The behaviour it replaces is kept, not deleted.
      expect(["b1", "b2"]).toContain(habit.replacesHabitId);
      expect(habit.rationale.length).toBeGreaterThan(0);
    }
  });

  it("asks for a shape through a forced tool call, not for prose", async () => {
    await post();
    const request = state.asked[0] as StructuredRequest;
    expect(request.toolName).toBe("propose_habits");
    expect(request.schema).toBeTruthy();
    expect(request.maxTokens).toBeGreaterThan(0);
    expect(request.timeoutMs).toBeGreaterThan(0);
  });

  it("sends the behaviours and what is already tracked, and nothing else", async () => {
    await post();
    const { prompt, system } = state.asked[0] as StructuredRequest;
    // What the feature exists to send: the person's own words for the
    // behaviours, what they already track so nothing is proposed twice, and
    // their goals so a replacement can serve one.
    expect(prompt).toContain("Sit all afternoon");
    expect(prompt).toContain("Check email in bed");
    expect(prompt).toContain("Read for learning");
    expect(prompt).toContain("Finish the course");
    // The instructions carry no personal data at all.
    expect(system).not.toContain("Sit all afternoon");

    /* What must never travel. Note this cannot be a blanket search for words
       like "email": a habit the person wrote may legitimately say "Check email
       in bed", and sending that is the whole point. So this checks for account
       data specifically — an address, a credential, a session, an id — none of
       which the caller passes and none of which `generate` reads. */
    const body = JSON.parse(prompt);
    expect(Object.keys(body).sort()).toEqual(["alreadyTracking", "behaviours", "goals"]);
    expect(prompt).not.toMatch(/@example\.com|password|password_hash|session|token|user_id/i);
    // Ids of the person's own rows go no further than the behaviour being
    // replaced, which the model must echo back to be understood at all.
    expect(prompt).not.toContain(state.user.id);
  });

  it("keeps the target only when the model gave one", async () => {
    await post();
    const [first, second] = state.saved;
    expect(first.target).toBeNull();
    expect(first.unit).toBe("");
    expect(second.target).toBe(1);
    expect(second.unit).toBe("night");
  });

  describe("failing safely", () => {
    it("writes nothing when the model returns no tool call", async () => {
      state.answer = null;
      const response = await post();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ proposals: 0 });
      expect(state.saved).toHaveLength(0);
    });

    it("writes nothing when the shape is wrong", async () => {
      for (const malformed of [
        { proposals: "not an array" },
        { proposals: [null, 42, "text"] },
        { nothing: true },
        {},
      ]) {
        state.saved = [];
        state.answer = malformed;
        const response = await post();
        expect(response.status).toBe(200);
        expect(state.saved).toHaveLength(0);
      }
    });

    it("drops a proposal for a behaviour it was never given", async () => {
      state.answer = {
        proposals: [
          { behaviourId: "does-not-exist", name: "Something", category: "daytime", weight: 1, rationale: "x" },
          PROPOSALS.proposals[0],
        ],
      };
      await post();
      expect(state.saved).toHaveLength(1);
      expect(state.saved[0].replacesHabitId).toBe("b1");
    });

    it("drops a proposal with no name rather than writing a blank habit", async () => {
      state.answer = { proposals: [{ behaviourId: "b1", name: "   ", category: "daytime", weight: 1, rationale: "x" }] };
      await post();
      expect(state.saved).toHaveLength(0);
    });

    it("answers 501 when the coach is not configured, and writes nothing", async () => {
      state.configured = false;
      const response = await post();
      expect(response.status).toBe(501);
      expect(state.saved).toHaveLength(0);
      expect(state.asked).toHaveLength(0);
    });
  });

  it("records counts only, never the behaviours or the proposals", async () => {
    await post();
    const [event] = state.tracked;
    expect(event.event).toBe("recommendations_generated");
    expect(event.properties).toEqual({ behaviours: 2, proposals: 2, locale: expect.any(String) });
    expect(JSON.stringify(state.tracked)).not.toMatch(/Sit all afternoon|phone charging/);
  });
});
