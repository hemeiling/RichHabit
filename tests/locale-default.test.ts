import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * English unless the reader has said otherwise.
 *
 * `resolveLocale` is covered in i18n.test.ts; this file pins the request end of
 * it, because that is where the browser's language used to get in. The header
 * is deliberately set to Chinese in every case here: if any of these ever
 * return "zh" without a cookie, inference has come back.
 */

const cookieStore = new Map<string, string>();
const headerStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: () => ({ get: (name: string) => headerStore.get(name.toLowerCase()) ?? null }),
}));

const { getLocale, getDict } = await import("../src/lib/i18n/server");

beforeEach(() => {
  cookieStore.clear();
  headerStore.clear();
  // A Chinese device, every time.
  headerStore.set("accept-language", "zh-CN,zh;q=0.9,en;q=0.8");
});

describe("a first-time visitor", () => {
  it("gets English even on a Chinese device", () => {
    expect(getLocale()).toBe("en");
    expect(getDict().landing.headline[0]).toBe("Turn what matters");
  });

  it("gets English when the device asks for a language nobody speaks here", () => {
    headerStore.set("accept-language", "fr-FR,de;q=0.8");
    expect(getLocale()).toBe("en");
  });

  it("gets English when the device says nothing at all", () => {
    headerStore.delete("accept-language");
    expect(getLocale()).toBe("en");
  });
});

describe("a visitor who has chosen", () => {
  it("is given the language they chose", () => {
    for (const choice of ["zh", "both", "en"] as const) {
      cookieStore.set("rh_locale", choice);
      expect(getLocale(), choice).toBe(choice);
    }
  });

  it("keeps their choice even when the device disagrees", () => {
    cookieStore.set("rh_locale", "en");
    headerStore.set("accept-language", "zh-CN");
    expect(getLocale()).toBe("en");
    expect(getDict().landing.signUp).toBe("Sign Up");

    cookieStore.set("rh_locale", "zh");
    headerStore.set("accept-language", "en-US");
    expect(getLocale()).toBe("zh");
    expect(getDict().landing.signUp).toBe("注册");
  });

  it("falls back to English if the stored value is not a language we have", () => {
    cookieStore.set("rh_locale", "zh-Hant");
    expect(getLocale()).toBe("en");
  });
});
