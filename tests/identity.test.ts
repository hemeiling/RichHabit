import { describe, expect, it } from "vitest";
import {
  MAX_USERNAME, MIN_USERNAME, checkUsername, isPlausibleEmail, looksLikeEmail,
  normaliseIdentifier, normaliseUsername,
} from "../src/lib/identity";

describe("which kind of identifier this is", () => {
  it("treats anything with an @ as an email", () => {
    expect(looksLikeEmail("me@example.com")).toBe(true);
    expect(looksLikeEmail("emma")).toBe(false);
    expect(looksLikeEmail("emma.jones")).toBe(false);
  });

  /** The two must never be confusable, or one could be used to probe the other. */
  it("never lets a username contain an @", () => {
    expect(checkUsername("emma@example.com")).not.toBeNull();
  });
});

describe("normalisation", () => {
  it("trims whitespace on either kind", () => {
    expect(normaliseIdentifier("  emma  ")).toBe("emma");
    expect(normaliseIdentifier("  me@example.com ")).toBe("me@example.com");
  });

  it("lowercases, so Emma and emma are the same person", () => {
    expect(normaliseIdentifier("Emma")).toBe("emma");
    expect(normaliseIdentifier("EMMA")).toBe("emma");
    expect(normaliseIdentifier("Me@Example.COM")).toBe("me@example.com");
  });

  it("rewrites nothing else — the name you were given is the name that works", () => {
    expect(normaliseUsername("e.mma_jones-1")).toBe("e.mma_jones-1");
  });

  it("handles an empty value without throwing", () => {
    expect(normaliseIdentifier("")).toBe("");
    expect(normaliseIdentifier("   ")).toBe("");
  });
});

describe("username shape", () => {
  it("accepts ordinary names", () => {
    for (const ok of ["emma", "emma.jones", "emma_jones", "emma-jones", "e2e", "a1b2c3"]) {
      expect(checkUsername(ok), ok).toBeNull();
    }
  });

  it("accepts a name typed with capitals or spaces around it", () => {
    expect(checkUsername("  Emma  ")).toBeNull();
  });

  it("rejects names that are too short or too long", () => {
    expect(checkUsername("em")?.reason).toBe("too_short");
    expect(checkUsername("a".repeat(MAX_USERNAME + 1))?.reason).toBe("too_long");
    expect(checkUsername("a".repeat(MIN_USERNAME))).toBeNull();
    expect(checkUsername("a".repeat(MAX_USERNAME))).toBeNull();
  });

  it("rejects leading, trailing or doubled punctuation", () => {
    for (const bad of [".emma", "emma.", "-emma", "emma-", "_emma", "emma_", "emma..jones"]) {
      expect(checkUsername(bad)?.reason, bad).toBe("shape");
    }
  });

  it("rejects spaces and anything exotic", () => {
    for (const bad of ["emma jones", "emma!", "emma/jones", "エマエマエマ"]) {
      expect(checkUsername(bad)?.reason, bad).toBe("shape");
    }
  });

  it("rejects a short non-Latin name too, whichever rule catches it first", () => {
    // "エマ" is two characters, so length rejects it before shape does. Both
    // are refusals; the test only cares that it does not get through.
    expect(checkUsername("エマ")).not.toBeNull();
  });
});

describe("email plausibility", () => {
  it("accepts ordinary addresses", () => {
    expect(isPlausibleEmail("me@example.com")).toBe(true);
    expect(isPlausibleEmail(" Me@Example.com ")).toBe(true);
  });

  it("rejects what cannot be an address", () => {
    for (const bad of ["emma", "@example.com", "me@", "me@@example.com", "me you@example.com"]) {
      expect(isPlausibleEmail(bad), bad).toBe(false);
    }
  });

  it("rejects an absurdly long one", () => {
    expect(isPlausibleEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});
