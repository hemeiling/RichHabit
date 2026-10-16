import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePriorityText } from "../src/lib/validate";
import { accomplishedInMonth } from "../src/lib/accomplishments";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";
import { both } from "../src/lib/i18n/both";
import type { Priority } from "../src/lib/types";
import { NO_PRIORITY_DETAILS } from "../src/lib/types";

/**
 * Rewording a priority changes its words and nothing else. These tests pin the
 * server's accepted shape, the one column the update may touch, what analytics
 * may hear about it, and the card behaviours a browser test also exercises.
 */

const ID = "11111111-1111-4111-8111-111111111111";
const read = (f: string) => fs.readFileSync(f, "utf8");
const between = (src: string, start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));

describe("what the server accepts", () => {
  it("keeps the words exactly, trimming only the ends", () => {
    expect(parsePriorityText({ id: ID, text: "  回复 Anna — re: Q3 😀  " })).toEqual({ id: ID, text: "回复 Anna — re: Q3 😀" });
  });

  it("refuses blank wording", () => {
    expect(() => parsePriorityText({ id: ID, text: "" })).toThrow();
    expect(() => parsePriorityText({ id: ID, text: "   " })).toThrow();
  });

  it("uses the same length limit as a new line", () => {
    expect(() => parsePriorityText({ id: ID, text: "x".repeat(201) })).toThrow();
    expect(parsePriorityText({ id: ID, text: "x".repeat(200) }).text).toHaveLength(200);
  });

  it("insists on a real id", () => {
    expect(() => parsePriorityText({ id: "not-an-id", text: "Fine" })).toThrow();
  });
});

describe("the update touches the words and nothing else", () => {
  const fn = between(read("src/lib/db/queries.ts"), "export async function setPriorityText", "\n}\n");

  it("updates body on the same row, scoped to the owner", () => {
    expect(fn).toMatch(/update priorities set body = \$3, updated_at = now\(\)\s+where id = \$1 and user_id = \$2/);
    expect(fn).toMatch(/assertRef\(query, "priorities", id, userId\)/);
  });

  it("never names the id, dates, quadrant, order or plan as something to write", () => {
    const set = fn.slice(fn.indexOf("set "), fn.indexOf("where"));
    for (const column of ["id =", "created_on", "completed_on", "category", "sort_order", "planned_on", "user_id"]) {
      expect(set).not.toContain(column);
    }
    expect(fn).not.toMatch(/insert|delete/i);
  });

  it("leaves the accomplishment count where it was", () => {
    const row: Priority = { id: "p1", text: "Book the clinc", createdOn: "2026-09-09", completedOn: "2026-09-12",
      category: "important_not_urgent", plannedOn: null, sortOrder: 2, ...NO_PRIORITY_DETAILS };
    const reworded = { ...row, text: "Book the clinic" };
    expect(accomplishedInMonth([reworded], "2026-09", "2026-09-12")).toHaveLength(accomplishedInMonth([row], "2026-09", "2026-09-12").length);
  });
});

describe("the route", () => {
  const route = read("src/app/api/priorities/route.ts");
  const branch = between(route, 'if (typeof b?.text === "string")', "return;");

  it("handles wording before a completion, so text is never read as a tick", () => {
    expect(route.indexOf('typeof b?.text === "string"')).toBeLessThan(route.indexOf("parsePriorityDone(b)"));
    expect(branch).toMatch(/setPriorityText\(userId, id, text\)/);
  });

  it("tells analytics which row was edited, never the words", () => {
    const event = between(branch, "trackEvent({", "});");
    expect(event).toMatch(/event: "priority_edited"/);
    expect(event).not.toMatch(/\btext\b|body|properties/);
    expect(branch).not.toMatch(/console\./);
  });
});

describe("the store", () => {
  const store = read("src/components/store.tsx");
  const action = between(store, "    setPriorityText: (id, text) => {", "    setPriorityDone:");

  it("changes only the text optimistically and rolls back only the text", () => {
    expect(action).toMatch(/return \{ \.\.\.p, text \};/);
    expect(action).toMatch(/\{ \.\.\.p, text: before \}/);
    expect(action).not.toMatch(/completedOn|category|sortOrder|plannedOn|createdOn/);
  });

  it("hands the failure back so the card can keep the draft", () => {
    expect(action).toMatch(/throw e;/);
  });
});

describe("the card", () => {
  const card = read("src/components/Priorities.tsx");
  const panel = read("src/components/PriorityDetails.tsx");

  it("opens the details from the words — a stretched button, not an inline editor", () => {
    expect(card).toMatch(/className="pcard-text pcard-title pcard-open"[\s\S]{0,260}onClick=\{onOpen\}/);
    // The old inline editor is gone for good; editing lives in the panel.
    expect(card).not.toMatch(/setEditing|onRename|pcard-field/);
  });

  it("is draggable as a whole, except from a control", () => {
    expect(card).toMatch(/pressedControl\.current = !!\(e\.target as Element\)\.closest\("\[data-no-drag\]"\)/);
    expect(card).toMatch(/if \(pressedControl\.current\) \{ e\.preventDefault\(\); return; \}/);
    // Every control is flagged so a press on it can never carry the card…
    expect(card).toContain('className="tick" data-no-drag');
    expect(card).toContain('className="qpill" data-no-drag');
    expect(card).toContain('className="pcard-x" data-no-drag');
    // …and the words deliberately are not: a drag from the title is a drag.
    expect(card).not.toMatch(/pcard-open"[^>]*data-no-drag="?true/);
  });

  it("renames through the panel, which refuses emptiness and keeps the last words", () => {
    expect(panel).toMatch(/setTitleEmpty\(!oneLine\.trim\(\)\)/);
    expect(panel).toMatch(/if \(oneLine\.trim\(\)\) \{/);               // only non-empty pauses save
    expect(panel).toMatch(/titleEmpty && <p[^>]*role="alert"/);           // and the refusal is said
    expect(panel).toMatch(/actions\.setPriorityText\(item\.id, oneLine\.trim\(\)\)/);
  });

  it("keeps Chinese composition out of the composer's Enter handling", () => {
    expect(card).toMatch(/isComposing \|\| e\.keyCode === 229\) return;/);
  });
});

describe("wording", () => {
  it("has every edit string in both languages, and bilingual carries both", () => {
    for (const k of ["editField", "editEmpty", "editFailed"] as const) {
      expect(zh.priorities[k]).toBeTruthy();
      expect(both.priorities[k]).toContain(en.priorities[k]);
      expect(both.priorities[k]).toContain(zh.priorities[k]);
    }
  });

  it("puts the user's words into the label untouched", () => {
    const words = "给妈妈打电话 😀";
    expect(en.priorities.editTitle(words)).toContain(words);
    expect(zh.priorities.editTitle(words)).toContain(words);
  });
});
