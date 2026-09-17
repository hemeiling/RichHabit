import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";
import { initialLoginMode } from "../src/lib/loginMode";
import { both } from "../src/lib/i18n/both";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";

const HAS_CJK = /[一-鿿]/;
/** The written lines rejoined: a space between Latin lines, none after CJK punctuation. */
const sentence = (lines: readonly string[]) => lines.join(" ").replace(/([，。]) /g, "$1");

describe("the front page's words", () => {
  it("carries one statement, in both languages", () => {
    expect(sentence(en.landing.headline)).toBe("Turn what matters into what you do.");
    expect(sentence(zh.landing.headline)).toBe("把真正重要的事，变成每天的行动。");
  });

  it("supports it with one short sentence, in both languages", () => {
    expect(sentence(en.landing.support))
      .toBe("Build habits. Choose what matters. See the life you're creating.");
    expect(sentence(zh.landing.support))
      .toBe("培养习惯，专注重要的事，看见自己一点点成为想成为的人。");
  });

  /**
   * The line breaks are copy, not layout: at this size the break is the design,
   * and leaving it to the browser gave three lopsided lines in English and four
   * in Chinese. Two lines each, in both languages, and the Chinese breaks at
   * its comma.
   */
  it("is written as two deliberate lines, in both languages", () => {
    for (const dict of [en, zh]) {
      expect(dict.landing.headline).toHaveLength(2);
      expect(dict.landing.support).toHaveLength(2);
    }
    expect(en.landing.headline[0]).toBe("Turn what matters");
    expect(zh.landing.headline[0].endsWith("，")).toBe(true);
  });

  it("names exactly two actions, in both languages", () => {
    expect([en.landing.signUp, en.landing.logIn]).toEqual(["Sign Up", "Log In"]);
    expect([zh.landing.signUp, zh.landing.logIn]).toEqual(["注册", "登录"]);
  });

  it("translates every front-page string", () => {
    for (const [key, value] of Object.entries(zh.landing)) {
      for (const line of Array.isArray(value) ? value : [value]) {
        expect(line, `zh.landing.${key}`).toMatch(HAS_CJK);
      }
    }
  });

  /**
   * Bilingual mode joins the two buttons, which is what a bilingual reader
   * wants on a button — and the component deliberately does NOT use the joined
   * headline, which would read as a paragraph at 68px. Both facts are asserted
   * here so a later "simplification" to `t.landing.headline` fails.
   */
  it("joins the buttons but leaves the statement to be typeset", () => {
    expect(both.landing.signUp).toBe("Sign Up · 注册");
    expect(both.landing.logIn).toBe("Log In · 登录");
    expect(both.landing.headline[0]).toContain(en.landing.headline[0]);
    expect(both.landing.headline[0]).toContain(zh.landing.headline[0]);
  });

  it("says nothing else — the page has no second slogan to maintain", () => {
    expect(Object.keys(en.landing).sort()).toEqual(["headline", "logIn", "signUp", "support"]);
  });
});

describe("which form the sign-in screen opens in", () => {
  it("opens registration only for the front page's Sign Up link", () => {
    expect(initialLoginMode("signup")).toBe("signup");
    expect(initialLoginMode(["signup"])).toBe("signup");
  });

  it("opens the returning-visitor form for anything else", () => {
    for (const value of [undefined, null, "", "signin", "SIGNUP", "register", "../signup"]) {
      expect(initialLoginMode(value), String(value)).toBe("signin");
    }
  });
});

const request = (path: string, cookie?: string) =>
  new NextRequest(`https://richhabit.onrender.com${path}`,
    { headers: cookie ? { cookie } : undefined });
const location = (res: Response) => res.headers.get("location");

describe("reaching the front page", () => {
  it("lets a signed-out visitor see it", () => {
    const res = middleware(request("/"));
    expect(location(res)).toBeNull();
    expect(res.status).toBe(200);
  });

  it("still sends a signed-out visitor away from the app itself", () => {
    for (const path of ["/habits", "/priorities", "/insights", "/admin", "/more/goals"]) {
      expect(location(middleware(request(path))), path).toMatch(/\/login$/);
    }
  });

  /**
   * "/" is matched exactly rather than added to the prefix list: every path
   * starts with "/", so a prefix entry would make the whole application public.
   */
  it("does not make every route public", () => {
    expect(location(middleware(request("/week")))).toMatch(/\/login$/);
    expect(location(middleware(request("/anything-else")))).toMatch(/\/login$/);
  });

  it("leaves a visitor who has a session to the page itself", () => {
    // The page checks the session against the database and sends them to the
    // app; middleware only ever sees that a cookie exists.
    const res = middleware(request("/", "rh_session=whatever"));
    expect(location(res)).toBeNull();
  });

  it("keeps the sign-in screen and the terms public", () => {
    expect(location(middleware(request("/login")))).toBeNull();
    expect(location(middleware(request("/login?mode=signup")))).toBeNull();
    expect(location(middleware(request("/terms")))).toBeNull();
  });
});
