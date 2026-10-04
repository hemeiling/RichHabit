import { describe, expect, it, vi } from "vitest";

/** The masked address the invitation screen shows. Informational only. */
vi.mock("@/lib/db/pool", () => ({ query: async () => [], transaction: async () => { throw new Error("unused"); } }));
const { maskEmail } = await import("../src/lib/together/invitations");

describe("maskEmail", () => {
  it("keeps the first two and last two characters of a longer local part, and the whole domain", () => {
    expect(maskEmail("hemeiling90@outlook.com")).toBe("he••••90@outlook.com");
    expect(maskEmail("eddie.mixed@example.com")).toBe("ed••••ed@example.com");
    expect(maskEmail("abcdef@x.io")).toBe("ab••••ef@x.io");   // exactly six: two still hidden
  });

  it("shows only the first character of a short local part, and nothing of a single character", () => {
    expect(maskEmail("abcde@x.io")).toBe("a••••@x.io");
    expect(maskEmail("ab@x.io")).toBe("a••••@x.io");
    expect(maskEmail("a@x.io")).toBe("••••@x.io");
  });

  it("never reveals more than four characters of the local part, whatever its length", () => {
    for (const local of ["abcdef", "abcdefghijklmnopqrstuvwxyz", "x".repeat(64)]) {
      const shown = maskEmail(`${local}@example.com`).split("@")[0].replace(/•/g, "");
      expect(shown.length).toBeLessThanOrEqual(4);
      expect(maskEmail(`${local}@example.com`)).not.toContain(local);
    }
  });

  it("counts characters, not bytes, so it never splits one", () => {
    expect(maskEmail("美玲美玲美玲@example.com")).toBe("美玲••••美玲@example.com");
    expect(maskEmail("😀😀@example.com")).toBe("😀••••@example.com");
  });

  it("copes with odd input without throwing or echoing it", () => {
    expect(maskEmail("no-at-sign")).toBe("no••••gn");
    expect(maskEmail("@example.com")).toBe("@e••••om");   // not an address the app accepts; still masked
    expect(maskEmail("")).toBe("••••");
    expect(maskEmail("plus+tag@sub.example.co.uk")).toBe("pl••••ag@sub.example.co.uk");
  });
});
