import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AI_WORKSPACE_STEPS, AI_WORKSPACE_TABLES } from "../scripts/migrations/ai-workspace.mjs";

/**
 * Static boundaries for the AI Workspace. These hold by construction, not by
 * testing behaviour: what the modules may import, what they may never do, and
 * what the migration may never contain.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]))
  .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));

const WORKSPACE = walk("src/lib/aiWorkspace");

describe("the AI Workspace data layer", () => {
  it("exists as the phase-1 modules", () => {
    expect(WORKSPACE.map((f) => path.basename(f)).sort())
      .toEqual(["disclosure.ts", "lifecycle.ts", "queries.ts", "types.ts", "validate.ts"]);
  });

  it("imports only the database pool, env, http helpers, node:crypto and its own modules", () => {
    const allowed = new Set(["@/lib/db/pool", "@/lib/env", "@/lib/http", "node:crypto"]);
    for (const f of WORKSPACE) {
      const specifiers = [...read(f).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const s of specifiers) expect(allowed.has(s) || s.startsWith("./"), `${f} imports ${s}`).toBe(true);
    }
  });

  it("has no path to RichHabit personal data", () => {
    const forbidden = /\b(habits|habit_completions|priorities|day_priorities|intentions|important_dates|day_notes|monthly_reflections|weekly_reviews|goals|profiles|community|spending_records|daily_metrics|habit_awareness_entries)\b/;
    for (const f of WORKSPACE) {
      const sql = [...read(f).matchAll(/`([^`]*)`/g)].map((m) => m[1]).join("\n");
      expect(forbidden.test(sql), `${f} mentions a RichHabit data table in SQL`).toBe(false);
    }
  });

  it("never logs and never sends analytics", () => {
    for (const f of WORKSPACE) {
      const source = read(f);
      expect(/console\.\w+\(/.test(source), `${f} logs`).toBe(false);
      expect(/trackEvent|analytics/.test(source), `${f} touches analytics`).toBe(false);
    }
  });

  it("never reads a credential", () => {
    for (const f of WORKSPACE) expect(/CLAUDE_API_KEY|process\.env/.test(read(f)), f).toBe(false);
  });

  it("is not imported by any client component", () => {
    for (const f of walk("src")) {
      const source = read(f);
      if (!/^\s*["']use client["']/.test(source)) continue;
      expect(/@\/lib\/aiWorkspace/.test(source), f).toBe(false);
    }
  });

  it("is the only module that names the ai_ tables", () => {
    for (const f of walk("src")) {
      if (f.startsWith(path.join("src", "lib", "aiWorkspace"))) continue;
      expect(/\bai_(projects|conversations|messages|files|message_files|file_provider_copies|workspace_settings)\b/.test(read(f)), f).toBe(false);
    }
  });
});

describe("the migration", () => {
  it("creates exactly the seven tables, in dependency order", () => {
    expect(AI_WORKSPACE_TABLES).toEqual([
      "ai_projects", "ai_conversations", "ai_messages", "ai_files",
      "ai_message_files", "ai_file_provider_copies", "ai_workspace_settings",
    ]);
  });

  it("only ever creates, and only ai_ objects", () => {
    for (const { statements } of AI_WORKSPACE_STEPS) {
      for (const statement of statements) {
        // Comments aside, and the foreign-key action "on delete cascade" is a rule, not a data change.
        const sql = statement.replace(/--.*$/gm, "").replace(/\bon delete cascade\b/gi, "");
        expect(sql).toMatch(/^\s*create (table|index|unique index) if not exists ai_\w+/);
        expect(sql).not.toMatch(/\b(drop|truncate|delete|update|alter|insert|rename|grant|revoke)\b/i);
        const onTable = sql.match(/\bon (\w+) \(/);
        if (onTable) expect(onTable[1]).toMatch(/^ai_/);
      }
    }
  });

  it("is called by scripts/migrate.mjs as its last step, before commit", () => {
    const script = read("scripts/migrate.mjs");
    const call = script.indexOf("await migrateAiWorkspace(client, console.log)");
    expect(call).toBeGreaterThan(script.indexOf("await migrateIntentionLinks(client, console.log)"));
    expect(call).toBeLessThan(script.indexOf('await client.query("commit")'));
  });

  it("is mirrored by the last section of db/schema.sql", () => {
    const schema = read("db/schema.sql");
    const marker = schema.indexOf("-- ---- AI workspace, admin only");
    expect(marker).toBeGreaterThan(0);
    const section = schema.slice(marker);
    expect([...section.matchAll(/^create table (\w+)/gm)].map((m) => m[1])).toEqual(AI_WORKSPACE_TABLES);
    expect(schema.slice(0, marker)).not.toMatch(/\bai_\w+/);
  });

  it("documents every limit as configuration in .env.example, with no values set", () => {
    const example = read(".env.example");
    for (const name of ["AI_WORKSPACE_MAX_PDF_MB", "AI_WORKSPACE_MAX_IMAGE_MB", "AI_WORKSPACE_MAX_TEXT_MB",
      "AI_WORKSPACE_STORAGE_QUOTA_MB", "AI_WORKSPACE_HOURLY_LIMIT", "AI_WORKSPACE_DAILY_LIMIT",
      "AI_WORKSPACE_MAX_OUTPUT_TOKENS", "AI_WORKSPACE_CONTEXT_TARGET_TOKENS", "AI_WORKSPACE_CONTEXT_MAX_TOKENS"]) {
      expect(example).toMatch(new RegExp(`^# ${name}=`, "m"));
    }
    expect(example).not.toMatch(/^AI_WORKSPACE_\w+=./m);
  });
});
