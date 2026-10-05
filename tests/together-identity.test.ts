import { describe, expect, it } from "vitest";
import { BOARD_COLORS, MIN_CONTRAST, boardColor, boardInitial, contrast, markColors } from "../src/lib/together/identity";

/** A board's derived identity: stable, shared by every member, and always legible. */
describe("board identity", () => {
  it("gives a board the same colour every time, from the shared palette", () => {
    const id = "6f1c2a3b-0000-4000-8000-0000000000aa";
    expect(boardColor(id)).toBe(boardColor(id));
    expect(BOARD_COLORS.map((c) => c.hex)).toContain(boardColor(id));
  });

  it("spreads boards across the palette", () => {
    const used = new Set<string>();
    for (let i = 0; i < 200; i++) used.add(boardColor(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`));
    expect(used.size).toBe(BOARD_COLORS.length);
  });

  it("takes the first character as people see it", () => {
    expect(boardInitial("headband")).toBe("H");
    expect(boardInitial("  home projects")).toBe("H");
    expect(boardInitial("头绳生意")).toBe("头");
    expect(boardInitial("👩‍👩‍👧 Family")).toBe("👩‍👩‍👧");   // one grapheme, not a broken surrogate
    expect(boardInitial("éclair")).toBe("É");
    expect(boardInitial("")).toBe("·");
  });

  it("keeps every initial readable (at least 4.6:1, above WCAG AA) on its fill, in light and in dark", () => {
    expect(MIN_CONTRAST).toBeGreaterThanOrEqual(4.5);
    for (const { key, hex } of BOARD_COLORS) {
      const m = markColors(hex);
      for (const theme of ["light", "dark"] as const) {
        expect(contrast(m[theme].ink, m[theme].fill), `${key} ${theme}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    }
  });

  it("keeps the fill a quiet tint — never a loud block of colour", () => {
    for (const { hex } of BOARD_COLORS) {
      expect(contrast(markColors(hex).light.fill, "#FFFFFF")).toBeLessThan(1.35);
      expect(contrast(markColors(hex).dark.fill, "#17191C")).toBeLessThan(1.8);
    }
  });
});
