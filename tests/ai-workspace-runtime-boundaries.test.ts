import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static boundaries for the AI Workspace beyond its data layer: the runtime,
 * the API routes and the browser components. These hold by construction —
 * what each part may import, what it may never do, and what can reach the
 * model or the browser.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]))
  .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));
const specifiers = (source: string) =>
  [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1]);

const RUNTIME = walk("src/lib/aiWorkspaceRuntime");
const ROUTES = walk("src/app/api/admin/ai/workspace");
const COMPONENTS = walk("src/components/aiWorkspace");
const SERVER = [...RUNTIME, ...ROUTES];

const PERSONAL_DATA = /@\/lib\/(db\/queries|habits|priorities|intention|importantDates|community|accomplishments|spending|coach|recommend|feedback|seed|templates|library|correlate|progressSeries|trend)\b|@\/components\/store/;

describe("the runtime and routes", () => {
  it("have no path to RichHabit personal data", () => {
    for (const f of SERVER) {
      for (const s of specifiers(read(f))) expect(PERSONAL_DATA.test(s), `${f} imports ${s}`).toBe(false);
    }
  });

  it("send nothing to analytics, anywhere in the workspace", () => {
    for (const f of [...SERVER, ...COMPONENTS]) {
      expect(/trackEvent|@\/lib\/analytics/.test(read(f)), f).toBe(false);
    }
  });

  it("import only the data layer, configuration, admin checks, i18n and their own modules", () => {
    const allowed = [/^@\/lib\/aiWorkspace\//, /^@\/lib\/aiWorkspaceRuntime\//, /^@\/lib\/env$/, /^@\/lib\/http$/,
      /^@\/lib\/admin$/, /^@\/lib\/i18n(\/server)?$/, /^next\/server$/, /^\.\//, /^@\/lib\/ai\/claude$/];
    for (const f of SERVER) {
      for (const s of specifiers(read(f))) expect(allowed.some((r) => r.test(s)), `${f} imports ${s}`).toBe(true);
    }
  });

  it("reach Claude only through the provider seam, and the scripted provider only through its guard", () => {
    const claude = SERVER.filter((f) => /@\/lib\/ai\/claude/.test(read(f)));
    expect(claude).toEqual([path.join("src", "lib", "aiWorkspaceRuntime", "provider.ts")]);
    const scripted = [...SERVER, ...COMPONENTS].filter((f) => /["']\.\/scriptedProvider["']|aiWorkspaceRuntime\/scriptedProvider/.test(read(f)));
    expect(scripted).toEqual([path.join("src", "lib", "aiWorkspaceRuntime", "provider.ts")]);
    expect(read("src/lib/aiWorkspaceRuntime/provider.ts")).toMatch(/if \(scriptedProviderAllowed\(\)\)/);
  });

  it("build the model's context from conversation data alone", () => {
    expect(specifiers(read("src/lib/aiWorkspaceRuntime/context.ts")).sort())
      .toEqual(["@/lib/aiWorkspace/lifecycle", "@/lib/aiWorkspace/types"]);
  });

  it("never read a credential", () => {
    for (const f of [...SERVER, ...COMPONENTS]) {
      expect(/CLAUDE_API_KEY|ANTHROPIC_API_KEY|NEXT_PUBLIC_/.test(read(f)), f).toBe(false);
      if (!f.endsWith(path.join("aiWorkspaceRuntime", "provider.ts"))) expect(/process\.env/.test(read(f)), f).toBe(false);
    }
  });

  it("log codes and statuses only, never words, files or raw errors", () => {
    const content = /\b(content|text|delta|prompt|instructions|bytes|body|title|filename|originalFilename|turns|system|request|message|b\.|e\b|error\b)\b/;
    for (const f of SERVER) {
      for (const call of read(f).match(/console\.\w+\([\s\S]*?\);/g) ?? []) {
        const args = call.replace(/^console\.\w+\(/, "").replace(/\);$/, "");
        expect(args.trim().startsWith("`"), `${f}: ${call}`).toBe(true);
        const interpolated = [...args.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]).join(" ");
        expect(content.test(interpolated), `${f}: ${call}`).toBe(false);
      }
    }
  });

  it("check for an admin at the start of every handler, and never use the ordinary user guard", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(12);
    for (const f of ROUTES) {
      const source = read(f);
      expect(/withUser|@\/lib\/auth/.test(source), f).toBe(false);
      const handlers = [...source.matchAll(/export async function (GET|POST|PATCH|DELETE)\([^)]*\)[^{]*\{\s*([^\n]*)/g)];
      expect(handlers.length, f).toBeGreaterThan(0);
      for (const [, method, first] of handlers) {
        expect(/^return (workspaceJson|replyResponse)\(|^const admin = await workspaceAdmin\(\);/.test(first.trim()), `${f} ${method}`).toBe(true);
      }
    }
  });

  it("never hand a provider's file reference to the browser", () => {
    for (const f of ROUTES) {
      expect(/providerCopies\s*[,}]|providerFileId/.test(read(f).replace(/result\.providerCopies/g, "")), f).toBe(false);
    }
  });
});

describe("the browser components", () => {
  it("import no server code, credential or SDK", () => {
    const allowed = [/^react$/, /^next\/dynamic$/, /^react-markdown$/, /^remark-gfm$/, /^highlight\.js\/lib\//,
      // lib/i18n is the locale module shared by server and browser; it holds no server code.
      /^@\/lib\/i18n\/context$/, /^@\/lib\/i18n$/, /^@\/components\/store$/, /^\.\//];
    for (const f of COMPONENTS.filter((file) => /^\s*["']use client["']/.test(read(file)))) {
      for (const s of specifiers(read(f))) expect(allowed.some((r) => r.test(s)), `${f} imports ${s}`).toBe(true);
    }
  });

  it("take only types from the server modules", () => {
    for (const f of COMPONENTS) {
      const source = read(f);
      const serverImports = [...source.matchAll(/import\s+(type\s+)?[^;]*?from\s+["'](@\/lib\/[^"']+)["']/g)]
        .filter((m) => m[2] !== "@/lib/i18n/context" && m[2] !== "@/lib/i18n");
      for (const m of serverImports) expect(Boolean(m[1]), `${f} imports ${m[2]} for more than types`).toBe(true);
    }
  });

  it("read only the theme from the app's store", () => {
    const readers = COMPONENTS.filter((f) => /@\/components\/store/.test(read(f)));
    expect(readers).toEqual([path.join("src", "components", "aiWorkspace", "AiLauncher.tsx")]);
    const launcher = read("src/components/aiWorkspace/AiLauncher.tsx");
    expect((launcher.match(/state\.\w+(\.\w+)*/g) ?? []).every((use) => use === "state.prefs.theme")).toBe(true);
  });

  it("render replies without raw HTML or remote images", () => {
    const markdown = read("src/components/aiWorkspace/Markdown.tsx");
    expect(markdown).not.toMatch(/rehype-raw|allowDangerousHtml|skipHtml=\{false\}/);
    expect(markdown).toMatch(/img\(\{ src, alt \}\)/);
    expect(markdown.match(/dangerouslySetInnerHTML/g)).toHaveLength(1);
    expect(markdown).toMatch(/hljs\.highlight\(code/);
  });
});
