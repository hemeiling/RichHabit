import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OpenAI is gone, and stays gone.
 *
 * The AI coach and the habit recommendations were written against OpenAI before
 * RichHabit had any provider architecture. Both now go through the consumer seam
 * to Claude, and Gemini serves the AI Workspace. This guard fails if an OpenAI
 * import, credential, model name or dependency comes back — including by
 * copy-and-paste from an old branch, which is how it would actually happen.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]))
  .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));

const SOURCE = walk("src");

describe("no OpenAI runtime dependency", () => {
  it("no source file imports the SDK or constructs a client", () => {
    const importers = SOURCE.filter((f) => /from\s+["']openai["']|require\(["']openai["']\)|new OpenAI\(/.test(read(f)));
    expect(importers).toEqual([]);
  });

  it("no source file reads an OpenAI credential or model setting", () => {
    const readers = SOURCE.filter((f) => /OPENAI_API_KEY|OPENAI_MODEL/.test(read(f)));
    expect(readers).toEqual([]);
  });

  it("is not a dependency of the application", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("openai");
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("openai");
  });

  it("is not configured anywhere an operator would look", () => {
    for (const file of [".env.example", "render.yaml"]) {
      expect(read(file), file).not.toMatch(/OPENAI/);
    }
  });

  it("the blueprint declares the credentials the application actually uses", () => {
    const blueprint = read("render.yaml");
    // Both are dashboard-managed secrets; the blueprint declares them so a new
    // deployment is prompted rather than silently starting without AI.
    for (const key of ["CLAUDE_API_KEY", "GEMINI_API_KEY"]) {
      expect(blueprint, key).toMatch(new RegExp(`key: ${key}`));
    }
    expect(blueprint).toMatch(/sync: false/);
  });

  it("the coach reaches Claude through the consumer seam, not an SDK", () => {
    const route = read("src/app/api/coach/route.ts");
    expect(route).toMatch(/from "@\/lib\/ai\/provider"/);
    expect(route).not.toMatch(/@anthropic-ai\/sdk/);
    const recommend = read("src/lib/recommend.ts");
    expect(recommend).toMatch(/from "@\/lib\/ai\/provider"/);
    expect(recommend).not.toMatch(/@anthropic-ai\/sdk/);
  });

  it("keeps the Anthropic SDK in exactly one file", () => {
    const sdk = SOURCE.filter((f) => /@anthropic-ai\/sdk/.test(read(f)));
    expect(sdk).toEqual([path.join("src", "lib", "ai", "claude.ts")]);
  });

  it("documents Claude and Gemini rather than OpenAI in the README", () => {
    const readme = read("README.md");
    expect(readme).not.toMatch(/OPENAI_API_KEY|OPENAI_MODEL/);
    expect(readme).toMatch(/CLAUDE_API_KEY/);
  });
});
