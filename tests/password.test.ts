import { describe, expect, it } from "vitest";
import {
  MAX_LENGTH, MIN_LENGTH, passwordProblems, passwordStrength,
} from "../src/lib/password";

describe("what is allowed", () => {
  it("accepts an ordinary password", () => {
    expect(passwordProblems("a good long password")).toEqual([]);
    expect(passwordProblems("Tr0ubad0ur&3")).toEqual([]);
  });

  it("requires a minimum length", () => {
    expect(passwordProblems("short")).toContain("too_short");
    expect(passwordProblems("a".repeat(MIN_LENGTH - 1))).toContain("too_short");
    // Exactly the minimum is allowed — but "aaaaaaaa" is still refused below.
    expect(passwordProblems("abcdefgh".slice(0, MIN_LENGTH)).includes("too_short")).toBe(false);
  });

  it("refuses an absurdly long one", () => {
    expect(passwordProblems("a".repeat(MAX_LENGTH + 1))).toContain("too_long");
  });

  it("refuses the passwords that top every breach list", () => {
    for (const bad of ["password", "PASSWORD", "12345678", "qwerty123", "letmein1"]) {
      expect(passwordProblems(bad), bad).toContain("too_simple");
    }
  });

  it("refuses one repeated character and plain runs", () => {
    expect(passwordProblems("aaaaaaaa")).toContain("too_simple");
    expect(passwordProblems("abcdefgh")).toContain("too_simple");
    expect(passwordProblems("87654321")).toContain("too_simple");
  });

  it("does not refuse a long passphrase that happens to contain a run", () => {
    expect(passwordProblems("my abc kitchen table")).toEqual([]);
  });
});

describe("strength, as advice", () => {
  it("scores nothing for an empty or trivial password", () => {
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("password").score).toBe(0);
  });

  it("rewards length more than punctuation", () => {
    const longWords = passwordStrength("correct horse battery staple");
    const shortNoise = passwordStrength("Aa1!Aa1!");
    expect(longWords.score).toBeGreaterThan(shortNoise.score);
  });

  it("climbs with length", () => {
    const eight = passwordStrength("kitchen1").score;
    const twelve = passwordStrength("kitchen table").score;
    const sixteen = passwordStrength("kitchen table lamp").score;
    expect(eight).toBeLessThanOrEqual(twelve);
    expect(twelve).toBeLessThanOrEqual(sixteen);
  });

  it("stays inside 0–4 and always has a label", () => {
    for (const p of ["", "a", "abcdefgh", "a good long password", "x".repeat(300)]) {
      const s = passwordStrength(p);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(4);
      expect(s.label).toBeTruthy();
    }
  });
});
