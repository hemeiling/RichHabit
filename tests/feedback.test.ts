import { describe, expect, it } from "vitest";
import {
  AREA_LABELS, FEEDBACK_AREAS, FEEDBACK_STATUSES, FEEDBACK_TYPES,
  MAX_SCREENSHOT_BYTES, STATUS_LABELS, TYPE_LABELS, pagePath,
} from "../src/lib/feedback";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";
import { both } from "../src/lib/i18n/both";

describe("the vocabulary the product asked for", () => {
  it("has the four types", () => {
    expect([...FEEDBACK_TYPES]).toEqual(["bug", "feature", "suggestion", "general"]);
  });

  it("has the four statuses, in workflow order", () => {
    expect([...FEEDBACK_STATUSES]).toEqual(["new", "reviewing", "planned", "resolved"]);
  });

  it("covers every area named in the brief", () => {
    const labels = FEEDBACK_AREAS.map((a) => AREA_LABELS[a]);
    for (const area of ["Today", "Habits", "Week", "Insights", "AI Coach",
      "Account/Login", "Admin", "Mobile/UI", "Other"]) {
      expect(labels, area).toContain(area);
    }
  });

  it("labels every value, so no screen can render a bare key", () => {
    for (const t of FEEDBACK_TYPES) expect(TYPE_LABELS[t]).toBeTruthy();
    for (const s of FEEDBACK_STATUSES) expect(STATUS_LABELS[s]).toBeTruthy();
    for (const a of FEEDBACK_AREAS) expect(AREA_LABELS[a]).toBeTruthy();
  });
});

/** A query string can carry an id, a search term, or someone's email. */
describe("the page context is a path, not a URL", () => {
  it("keeps the path", () => {
    expect(pagePath("/more/spending")).toBe("/more/spending");
  });

  it("drops the query string", () => {
    expect(pagePath("/admin/users?q=someone@example.com&sort=newest")).toBe("/admin/users");
    expect(pagePath("/habits?edit=8f14e45f-ceea-467a-9f8a-1a2b3c4d5e6f")).toBe("/habits");
  });

  it("drops the fragment and the origin", () => {
    expect(pagePath("https://richhabit.onrender.com/insights#chart")).toBe("/insights");
  });

  it("survives nonsense without throwing", () => {
    expect(() => pagePath("")).not.toThrow();
    expect(() => pagePath("::::")).not.toThrow();
  });

  it("is bounded, so it cannot be used to smuggle a payload", () => {
    expect(pagePath(`/${"a".repeat(500)}`).length).toBeLessThanOrEqual(120);
  });
});

describe("the screenshot cap matches the column", () => {
  it("is one megabyte", () => {
    expect(MAX_SCREENSHOT_BYTES).toBe(1_048_576);
  });
});

describe("bilingual, and honest about what it sends", () => {
  it("is translated throughout", () => {
    const keys = ["open", "title", "intro", "typeLabel", "bodyLabel", "bodyPlaceholder",
      "ratingLabel", "screenshotLabel", "send", "sending", "thanks", "failed"] as const;
    for (const k of keys) {
      expect(en.feedback[k], `en.${k}`).toBeTruthy();
      expect(zh.feedback[k], `zh.${k}`).toBeTruthy();
      expect(en.feedback[k]).not.toBe(zh.feedback[k]);
    }
    for (const t of FEEDBACK_TYPES) {
      expect(en.feedback.types[t]).toBeTruthy();
      expect(zh.feedback.types[t]).toBeTruthy();
    }
  });

  it("uses 反馈 for the sidebar entry", () => {
    expect(zh.feedback.open).toBe("反馈");
    expect(en.feedback.open).toBe("Feedback");
  });

  it("says the exact thank-you the product asked for, under the current name", () => {
    // The sentence was specified as "…the Rich Habits team"; the product was
    // then renamed to RichHabit, and the brand sweep is meant to reach every
    // user-facing mention, this one included.
    expect(en.feedback.thanks)
      .toBe("Thank you. Your feedback has been sent to the RichHabit team.");
    expect(zh.feedback.thanks).toBe("谢谢。你的反馈已发送给 RichHabit 团队。");
  });

  it("tells the user, in both languages, that their own content is not attached", () => {
    for (const [name, dict] of [["en", en], ["zh", zh]] as const) {
      const intro = dict.feedback.intro;
      // Named individually rather than by a vague "your data".
      for (const word of name === "en"
        ? ["habits", "goals", "notes", "spending"]
        : ["习惯", "目标", "笔记", "消费"]) {
        expect(intro, `${name}: ${word}`).toContain(word);
      }
    }
  });

  it("carries both languages in bilingual mode", () => {
    expect(both.feedback.open).toContain("Feedback");
    expect(both.feedback.open).toContain("反馈");
  });
});
