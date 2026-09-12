import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_INTENTION_HABITS, MAX_NOTE, MAX_VISION_TEXT, MAX_WANT, MAX_WHY, MAX_WHY_TEXT, STEP_COUNT,
  VISION_PROMPTS,
  advance, blankIntention, canAddHabit, canContinue, canGoDeeper, canRevealVision, deepestWhy,
  finish, goDeeper, isBlank, linkedHabits, linkedPriority, resumeStep, revealVision, setVision,
  setWhy, trimIntention, visionPromptAt, whyDepth,
} from "../src/lib/intention";
import { parseIntention } from "../src/lib/validate";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";
import type { Intention } from "../src/lib/types";

const ID = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const make = (over: Partial<Intention> = {}): Intention =>
  ({ ...blankIntention(), id: ID, ...over });

describe("a new intention", () => {
  it("opens with one empty rung and one empty vision prompt", () => {
    const i = blankIntention();
    expect(i.whyChain).toEqual([""]);
    expect(i.vision).toEqual([""]);
    expect(i.step).toBe(1);
    expect(i.complete).toBe(false);
    expect(i.ownership).toBeNull();
  });

  /* Nothing written means nothing worth a row — see `update` in the screen. */
  it("is blank until something is written", () => {
    expect(isBlank(blankIntention())).toBe(true);
    expect(isBlank(make({ want: "  " }))).toBe(true);
    expect(isBlank(make({ want: "Run a half marathon" }))).toBe(false);
    expect(isBlank(make({ ownership: "unsure" }))).toBe(false);
    expect(isBlank(make({ habitIds: [OTHER] }))).toBe(false);
  });
});

describe("the why ladder", () => {
  it("will not open a rung until the one above is answered", () => {
    const i = make();
    expect(canGoDeeper(i)).toBe(false);
    expect(goDeeper(i).whyChain).toHaveLength(1);

    const answered = setWhy(i, 0, "Because I want to feel strong");
    expect(canGoDeeper(answered)).toBe(true);
    expect(goDeeper(answered).whyChain).toEqual(["Because I want to feel strong", ""]);
  });

  it("stops at three rungs", () => {
    let i = make();
    for (let at = 0; at < MAX_WHY; at += 1) {
      i = setWhy(i, at, `reason ${at}`);
      i = goDeeper(i);
    }
    expect(i.whyChain).toHaveLength(MAX_WHY);
    expect(canGoDeeper(i)).toBe(false);
  });

  it("writes one rung without disturbing the others", () => {
    const i = make({ whyChain: ["one", "two", "three"] });
    expect(setWhy(i, 1, "TWO").whyChain).toEqual(["one", "TWO", "three"]);
    // An index that is not there changes nothing rather than growing the list.
    expect(setWhy(i, 9, "nine").whyChain).toEqual(["one", "two", "three"]);
  });

  /*
   * The card shows the deepest thing they said, not the deepest rung. Opening a
   * level and leaving it blank must not empty the card.
   */
  it("reads the deepest answer, skipping a rung left blank", () => {
    expect(deepestWhy(make({ whyChain: ["surface", "deeper", ""] }))).toBe("deeper");
    expect(deepestWhy(make({ whyChain: ["surface", "  ", ""] }))).toBe("surface");
    expect(deepestWhy(make())).toBe("");
    expect(whyDepth(make({ whyChain: ["a", "", "c"] }))).toBe(2);
  });
});

describe("the vision prompts", () => {
  it("reveals them one at a time, in order, and stops at the last", () => {
    let i = make();
    expect(canRevealVision(i)).toBe(false);

    for (let at = 0; at < VISION_PROMPTS.length; at += 1) {
      expect(visionPromptAt(at)).toBe(VISION_PROMPTS[at]);
      i = setVision(i, at, `answer ${at}`);
      i = revealVision(i);
    }
    expect(i.vision).toHaveLength(VISION_PROMPTS.length);
    expect(canRevealVision(i)).toBe(false);
  });

  it("has a translated prompt for every one, in both languages", () => {
    for (const prompt of VISION_PROMPTS) {
      expect(en.intention.vision.prompts[prompt]).toBeTruthy();
      expect(zh.intention.vision.prompts[prompt]).toMatch(/[一-鿿]/);
    }
  });
});

describe("moving through the session", () => {
  /*
   * Generous on purpose. Only the two steps the rest of the session is built
   * from are required; Vision is optional because somebody who cannot picture
   * it yet is exactly who that step is for.
   */
  it("requires a want, a first reason, and an ownership answer", () => {
    expect(canContinue(make(), 1)).toBe(false);
    expect(canContinue(make({ want: "Learn to cook properly" }), 1)).toBe(true);

    expect(canContinue(make(), 2)).toBe(false);
    expect(canContinue(make({ whyChain: ["It is how I look after people"] }), 2)).toBe(true);

    expect(canContinue(make(), 3)).toBe(false);
    expect(canContinue(make({ ownership: "unsure" }), 3)).toBe(true);
  });

  it("asks nothing of Vision or Action", () => {
    expect(canContinue(make(), 4)).toBe(true);
    expect(canContinue(make(), 5)).toBe(true);
  });

  it("remembers the furthest step, not the last one looked at", () => {
    const deep = advance(make(), 4);
    expect(deep.step).toBe(4);
    expect(advance(deep, 2).step).toBe(4);
    expect(advance(deep, 9).step).toBe(STEP_COUNT);
  });

  it("resumes where the session got to", () => {
    const i = make({
      want: "Run a half marathon", whyChain: ["To prove I can"], ownership: "mine", step: 4,
    });
    expect(resumeStep(i)).toBe(4);
  });

  /*
   * The pull-back. Somebody who reached Vision and then cleared what they
   * wanted cannot be shown Vision: the session would be about an intention
   * that is no longer there.
   */
  it("pulls back to the first step that is no longer satisfied", () => {
    const i = make({ want: "", whyChain: ["To prove I can"], ownership: "mine", step: 4 });
    expect(resumeStep(i)).toBe(1);

    const noReason = make({ want: "Run", whyChain: [""], ownership: "mine", step: 5 });
    expect(resumeStep(noReason)).toBe(2);
  });

  it("clamps a step out of range rather than trusting it", () => {
    expect(resumeStep(make({ step: 0 }))).toBe(1);
    expect(resumeStep(make({ want: "a", whyChain: ["b"], ownership: "mine", step: 99 })))
      .toBe(STEP_COUNT);
  });

  it("finishing records completion and nothing else", () => {
    const i = make({ want: "Write more", whyChain: ["It clears my head"], ownership: "mine" });
    const done = finish(i);
    expect(done.complete).toBe(true);
    expect(done.step).toBe(STEP_COUNT);
    // Not one word of what they wrote is touched by finishing.
    expect(done.want).toBe(i.want);
    expect(done.whyChain).toEqual(i.whyChain);
    expect(done.ownership).toBe(i.ownership);
  });
});

describe("what gets written", () => {
  it("drops rungs and prompts nobody answered, keeping the first", () => {
    const i = make({ whyChain: ["a", "b", ""], vision: ["", "", ""] });
    const trimmed = trimIntention(i);
    expect(trimmed.whyChain).toEqual(["a", "b"]);
    expect(trimmed.vision).toEqual([""]);
  });

  it("never rewrites what is in the middle", () => {
    const i = make({ whyChain: ["a", "", "c"] });
    expect(trimIntention(i).whyChain).toEqual(["a", "", "c"]);
  });
});

describe("the records an intention started", () => {
  const habits = [
    { id: "h1", name: "Morning run" },
    { id: "h2", name: "Cook at home" },
  ];

  it("resolves them in the order the intention recorded", () => {
    const i = make({ habitIds: ["h2", "h1"] });
    expect(linkedHabits(i, habits).map((h) => h.name)).toEqual(["Cook at home", "Morning run"]);
  });

  /*
   * The ids are references, never a claim that the record still exists. A habit
   * the user has since deleted simply drops off the card — and deleting it can
   * never reach back into the intention row, because there is no key between
   * them.
   */
  it("silently omits a habit that no longer exists", () => {
    const i = make({ habitIds: ["h1", "gone", "h2"] });
    expect(linkedHabits(i, habits).map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(linkedHabits(make({ habitIds: ["gone"] }), habits)).toEqual([]);
  });

  it("does the same for the priority", () => {
    const priorities = [{ id: "p1", text: "Book the clinic" }];
    expect(linkedPriority(make({ priorityId: "p1" }), priorities)?.text).toBe("Book the clinic");
    expect(linkedPriority(make({ priorityId: "gone" }), priorities)).toBeNull();
    expect(linkedPriority(make(), priorities)).toBeNull();
  });

  it("starts at most three habits", () => {
    expect(canAddHabit(make())).toBe(true);
    expect(canAddHabit(make({ habitIds: ["a", "b"] }))).toBe(true);
    expect(canAddHabit(make({ habitIds: ["a", "b", "c"] }))).toBe(false);
    expect(MAX_INTENTION_HABITS).toBe(3);
  });
});

describe("parsing a request", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    id: ID,
    want: "Run a half marathon",
    whyChain: ["To prove I can"],
    ownership: "mine",
    ownershipNote: "",
    vision: [""],
    habitIds: [],
    priorityId: null,
    step: 2,
    complete: false,
    ...over,
  });

  it("keeps the text exactly as it arrived", () => {
    const messy = "  I want to\n\nwrite every morning  ";
    expect(parseIntention(body({ want: messy })).want).toBe(messy);
    expect(parseIntention(body({ whyChain: [messy] })).whyChain).toEqual([messy]);
  });

  it("treats a missing ownership answer as unanswered, not as a default", () => {
    expect(parseIntention(body({ ownership: null })).ownership).toBeNull();
    expect(parseIntention(body({ ownership: "" })).ownership).toBeNull();
    expect(parseIntention(body({ ownership: "mine" })).ownership).toBe("mine");
    expect(() => parseIntention(body({ ownership: "definitely" }))).toThrow();
  });

  it("always leaves at least one rung and one prompt", () => {
    const parsed = parseIntention(body({ whyChain: [], vision: [] }));
    expect(parsed.whyChain).toEqual([""]);
    expect(parsed.vision).toEqual([""]);
  });

  it("refuses a ladder longer than the screen can reveal", () => {
    expect(() => parseIntention(body({ whyChain: ["a", "b", "c", "d"] }))).toThrow();
    expect(() => parseIntention(body({ vision: ["a", "b", "c", "d", "e"] }))).toThrow();
  });

  it("refuses more habits than an intention may start", () => {
    expect(() => parseIntention(body({ habitIds: [ID, OTHER, ID, OTHER] }))).toThrow();
  });

  it("refuses a step out of range and a malformed id", () => {
    expect(() => parseIntention(body({ step: 0 }))).toThrow();
    expect(() => parseIntention(body({ step: 6 }))).toThrow();
    expect(() => parseIntention(body({ step: 2.5 }))).toThrow();
    expect(() => parseIntention(body({ id: "not-a-uuid" }))).toThrow();
    expect(() => parseIntention(body({ habitIds: ["nope"] }))).toThrow();
  });

  it("drops a priority id it cannot use rather than failing the save", () => {
    // A version skew should not cost somebody the reflection they just wrote.
    expect(parseIntention(body({ priorityId: "nonsense" })).priorityId).toBeNull();
  });

  it("refuses text beyond the column's ceiling", () => {
    expect(() => parseIntention(body({ want: "x".repeat(2001) }))).toThrow();
    expect(() => parseIntention(body({ whyChain: ["x".repeat(2001)] }))).toThrow();
    expect(() => parseIntention(body({ ownershipNote: "x".repeat(2001) }))).toThrow();
  });

  it("only completes when the client says so explicitly", () => {
    expect(parseIntention(body({ complete: true })).complete).toBe(true);
    expect(parseIntention(body({ complete: "yes" })).complete).toBe(false);
    expect(parseIntention(body({ complete: undefined })).complete).toBe(false);
  });
});

describe("the wording", () => {
  it("asks every step in both languages", () => {
    const steps = ["what", "why", "truth", "vision", "action"] as const;
    for (const step of steps) {
      expect(en.intention.steps[step]).toBeTruthy();
      expect(zh.intention.steps[step]).toMatch(/[一-鿿]/);
    }
    expect(en.intention.what.question).toContain("want");
    expect(zh.intention.what.question).toMatch(/[一-鿿]/);
  });

  it("offers a choice and a follow-up for each ownership answer", () => {
    for (const choice of ["mine", "outside", "unsure"] as const) {
      expect(en.intention.truth.choices[choice]).toBeTruthy();
      expect(en.intention.truth.prompts[choice]).toContain("?");
      expect(zh.intention.truth.choices[choice]).toMatch(/[一-鿿]/);
      expect(zh.intention.truth.prompts[choice]).toMatch(/[一-鿿]/);
    }
  });

  /*
   * The step names have to stay short: five of them sit in a row under a
   * heading, and in bilingual mode each is rendered as both at once.
   */
  it("keeps the step names short enough for the progress line", () => {
    for (const name of Object.values(zh.intention.steps)) {
      expect(name.length).toBeLessThanOrEqual(3);
    }
    for (const name of Object.values(en.intention.steps)) {
      expect(name.length).toBeLessThanOrEqual(8);
    }
  });
});

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
/** Comments removed, so prose about what code does not do cannot satisfy or trip a check. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
/** Whitespace collapsed: the schema and the migration indent the same DDL differently. */
const flat = (text: string) => text.replace(/\s+/g, " ");

/*
 * Every limit is written three times — the validator, db/schema.sql and the
 * migration — and the database is only a backstop if all three agree. If the
 * app allowed more than the database, a long reflection would fail to save; if
 * the database allowed more, the backstop would not be one.
 */
describe("the schema, the migration and the validator agree on every limit", () => {
  const limits = [
    `check (length(want) <= ${MAX_WANT})`,
    `check (length(ownership_note) <= ${MAX_NOTE})`,
    `check (text_array_within(why_chain, ${MAX_WHY}, ${MAX_WHY_TEXT}))`,
    `check (text_array_within(vision, ${VISION_PROMPTS.length}, ${MAX_VISION_TEXT}))`,
    `check (cardinality(habit_ids) <= ${MAX_INTENTION_HABITS})`,
  ];

  it("in db/schema.sql", () => {
    const schema = flat(source("db/schema.sql"));
    for (const limit of limits) expect(schema, limit).toContain(limit);
  });

  it("in the migration", () => {
    const migrate = flat(source("scripts/migrate.mjs"));
    for (const limit of limits) expect(migrate, limit).toContain(limit);
  });

  it("defines the helper before the table that uses it", () => {
    const schema = source("db/schema.sql");
    const helper = schema.indexOf("function text_array_within");
    expect(helper).toBeGreaterThan(-1);
    expect(helper).toBeLessThan(schema.indexOf("create table intentions"));
  });
});

describe("the intention migration step", () => {
  const migrate = source("scripts/migrate.mjs");
  const step = code(migrate.slice(
    migrate.indexOf("---- 4d. intentions"),
    migrate.indexOf("---- 5. admin account management"),
  ));

  it("is where it should be", () => {
    expect(step).toContain("create table intentions");
  });

  it("only creates: no drop, alter, update, delete, insert or truncate", () => {
    expect(step).not.toMatch(
      /\bdrop\b|\btruncate\b|\balter\s+table\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b|\binsert\s+into\b/i);
  });

  it("guards each thing it creates, so running it again changes nothing", () => {
    expect(step).toContain('tableExists("intentions")');
    expect(step).toContain("proname = 'text_array_within'");
  });
});

/*
 * What the route may say about a reflection, anywhere outside the database:
 * nothing. Checked against the source, because an analytics property or a log
 * line added in a hurry is exactly the kind of change a review can miss.
 */
describe("the intention route keeps reflections private", () => {
  const route = code(source("src/app/api/intention/route.ts"));
  const fields = ["want", "whyChain", "ownership", "ownershipNote", "vision"];

  it("records its two events with no properties and no reflection field", () => {
    const calls = route.match(/trackEvent\(\{[\s\S]*?\}\)/g) ?? [];
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).not.toMatch(/properties/);
      for (const field of fields) expect(call).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it("never logs the request, the error object, or a reflection field", () => {
    const logs = route.match(/console\.\w+\([\s\S]*?\);/g) ?? [];
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toMatch(/\bintention\b|\bbody\b|\brequest\b|,\s*e\s*\)|\(\s*e\s*\)/);
      for (const field of fields) expect(line).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });
});
