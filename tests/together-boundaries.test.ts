import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loginReturnPath } from "../src/lib/loginMode";

/**
 * Together's boundaries, read from the source: every API route goes through the
 * one wrapper that checks the session, the preview and the error language — the
 * signed-out invitation preview is the only exception, and it writes nothing;
 * the preview allow-list stays on the server; and the sign-in return path
 * cannot be steered anywhere but the fixed list.
 */

const ROOT = path.resolve(__dirname, "..");
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

describe("Together API routes", () => {
  const routes = walk(path.join(ROOT, "src/app/api/together")).filter((f) => f.endsWith("route.ts"));

  it("all go through togetherRoute, except the signed-out preview", () => {
    expect(routes.length).toBeGreaterThanOrEqual(10);
    const unwrapped: string[] = [];
    for (const f of routes) {
      const src = fs.readFileSync(f, "utf8");
      const handlers = [...src.matchAll(/export (?:const|async function) (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1]);
      // Each handler's whole body is `return togetherRoute(...)`.
      expect(handlers.length, rel(f)).toBeGreaterThan(0);
      const wrapped = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\(.*\) \{\n\s*return togetherRoute\(/g)].length;
      if (wrapped !== handlers.length) unwrapped.push(rel(f));
    }
    expect(unwrapped).toEqual(["src/app/api/together/invitations/preview/route.ts"]);
  });

  it("the preview only reads, and is never cached", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/app/api/together/invitations/preview/route.ts"), "utf8");
    expect(src).toContain("previewInvitation(");
    expect(src).toContain('"Cache-Control": "no-store"');
    const lib = fs.readFileSync(path.join(ROOT, "src/lib/together/invitations.ts"), "utf8");
    const fn = lib.slice(lib.indexOf("export async function previewInvitation"), lib.indexOf("export async function acceptInvitation"));
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).not.toMatch(/\b(insert|update|delete)\b/i);
  });
});

describe("the preview allow-list", () => {
  it("is read only by server code", () => {
    const users = walk(path.join(ROOT, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /previewUserIds|TOGETHER_PREVIEW_USER_IDS/.test(fs.readFileSync(f, "utf8")))
      .map(rel).sort();
    expect(users).toEqual(["src/lib/env.ts", "src/lib/together/access.ts"]);
    for (const f of users) expect(fs.readFileSync(path.join(ROOT, f), "utf8")).not.toMatch(/^["']use client["']/m);
    expect(fs.readFileSync(path.join(ROOT, "src/lib/env.ts"), "utf8")).not.toMatch(/NEXT_PUBLIC_TOGETHER/);
  });

  it("reaches the client only as a yes/no for the signed-in account", () => {
    const layout = fs.readFileSync(path.join(ROOT, "src/app/(app)/layout.tsx"), "utf8");
    expect(layout).toMatch(/together=\{togetherEnabledFor\(user\.id\)\}/);
  });
});

describe("the sign-in return path", () => {
  it("goes only to the fixed list", () => {
    expect(loginReturnPath("together-invite")).toBe("/together/invite");
    expect(loginReturnPath(["together-invite", "x"])).toBe("/together/invite");
    for (const v of [undefined, null, "", "https://evil.example", "//evil.example", "/admin",
      "constructor", "__proto__", "toString", "hasOwnProperty", ["//evil.example"]]) {
      expect(loginReturnPath(v as any), String(v)).toBeUndefined();
    }
  });
});

describe("Together copy", () => {
  it("states an invitation's expiry once per language in bilingual mode", async () => {
    const { dict } = await import("../src/lib/i18n");
    const iso = "2026-10-17T12:00:00.000Z";
    expect(dict("en").together.expires(iso)).toBe("Expires October 17, 2026");
    expect(dict("zh").together.expires(iso)).toBe("2026年10月17日 过期");
    const both = dict("both").together.expires(iso);
    expect(both.match(/October 17, 2026/g)).toHaveLength(1);
    expect(both.match(/2026年10月17日/g)).toHaveLength(1);
  });
});
