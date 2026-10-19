import { describe, expect, it } from "vitest";
import { readVerifyFragment } from "../src/lib/email/fragment";

describe("reading a confirmation link's fragment", () => {
  it("reads an ordinary link and a change link", () => {
    expect(readVerifyFragment("#token=abc_DEF-123")).toEqual({ token: "abc_DEF-123", change: false });
    expect(readVerifyFragment("#token=abc_DEF-123&for=change")).toEqual({ token: "abc_DEF-123", change: true });
  });

  it("survives a mail link-rewriter that percent-encodes the separators", () => {
    expect(readVerifyFragment("#token%3Dabc_DEF-123%26for%3Dchange")).toEqual({ token: "abc_DEF-123", change: true });
    expect(readVerifyFragment("#token=abc_DEF-123%26for%3Dchange")).toEqual({ token: "abc_DEF-123", change: true });
  });

  it("finds nothing in an empty or unrelated fragment", () => {
    expect(readVerifyFragment("")).toEqual({ token: "", change: false });
    expect(readVerifyFragment("#section-2")).toEqual({ token: "", change: false });
    expect(readVerifyFragment("#token=%E0%A4%A")).toEqual({ token: expect.any(String), change: false });
  });
});
