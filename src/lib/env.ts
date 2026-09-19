/**
 * Every environment variable the application reads, in one place.
 *
 * **Server-only.** Nothing here may be imported from a client component: it
 * exposes the database URL and the provider keys. There is deliberately not a
 * single `NEXT_PUBLIC_*` variable in this project — the browser needs no
 * configuration, because it only ever talks to same-origin `/api` routes.
 *
 * Two rules:
 *
 *   1. **Nothing throws at import.** `next build` imports every route to collect
 *      page data, with no database attached; a module that threw on a missing
 *      variable would break the build. Required values are functions that throw
 *      at the point of use.
 *   2. **Optional values have defaults here, not at the call site.** A default
 *      scattered across three files is three defaults.
 *
 * Product thresholds — engagement bands, the activation rule, retention
 * checkpoints — deliberately stay in `src/lib/analytics/config.ts` rather than
 * moving here. They are product decisions that belong in code review and in git
 * history, not values an operator retunes per deployment.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[env] ${name}="${raw}" is not a positive number; using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

const str = (name: string, fallback: string): string => process.env[name]?.trim() || fallback;

export const isProduction = process.env.NODE_ENV === "production";

// ─────────────────────────────── database ────────────────────────────────────

const LOCAL_DB_HOSTS = ["localhost", "127.0.0.1", "::1", ""];

/**
 * True for a database on this machine. Unparseable counts as NOT local, so a
 * malformed string is refused rather than waved through.
 *
 * IPv6 hosts arrive bracketed — `postgres://u@[::1]:5432/db` — and `URL`
 * reports the hostname with the brackets still on, so they are stripped before
 * comparing. Without that, the one form of localhost a developer is least
 * likely to suspect gets treated as production.
 */
export function isLocalDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return LOCAL_DB_HOSTS.includes(host);
  } catch { return false; }
}

/**
 * Required. Throws where it is used, not where it is imported.
 *
 * ## Why development refuses a remote database
 *
 * `.env.local` is read by `npm run dev` and holds whatever connection string is
 * convenient — which, on a small project, is production's. Nothing then
 * distinguishes "I am building a feature" from "I am editing real people's
 * habits": the same click writes to the same rows, and the only signal is a
 * hostname nobody reads.
 *
 * So in development a non-local database is refused outright. Production is
 * untouched, because the check is skipped when NODE_ENV is production — Render
 * sets that, and the deployed app must obviously reach Neon.
 *
 * `RH_ALLOW_REMOTE=1` overrides it, the same flag the db scripts use, so there
 * is one concept to remember rather than two. Reaching for it is a deliberate
 * act, which is the entire point.
 */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and point it at your Postgres.",
    );
  }
  if (!isProduction && process.env.RH_ALLOW_REMOTE !== "1" && !isLocalDatabase(url)) {
    let host = "unknown";
    try { host = new URL(url).hostname; } catch { /* keep "unknown" */ }
    throw new Error(
      `Refusing to run in development against "${host}", which is not a local database.\n\n` +
      "That is very likely production, and a click in a dev server would edit real\n" +
      "people's data. Start a local Postgres and point at it:\n\n" +
      "  npm run db:dev        # PGlite on 127.0.0.1:5433, no install needed\n" +
      "  npm run db:deploy     # create the schema in it\n\n" +
      "then set DATABASE_URL in .env.local to the local one (line 6 of the file).\n\n" +
      "If you genuinely need dev pointed at a remote database, say so explicitly:\n" +
      "  RH_ALLOW_REMOTE=1 npm run dev\n",
    );
  }
  return url;
}

export const database = {
  /** Override TLS when the hostname heuristic in db/pool.ts guesses wrong. */
  ssl: process.env.DATABASE_SSL?.toLowerCase() || null,
  /** Connections in the pool. Lower it for a small connection allowance. */
  poolMax: num("PG_POOL_MAX", 10),
  /** How long an idle connection is held. Only worth lowering against a
   *  single-connection dev database, where a held connection blocks psql. */
  idleMs: num("PG_IDLE_MS", 30_000),
  connectionTimeoutMs: num("PG_CONNECT_TIMEOUT_MS", 10_000),
};

// ──────────────────────────────── auth ───────────────────────────────────────

export const auth = {
  /** How long a session cookie and its row stay valid. */
  sessionTtlDays: num("SESSION_TTL_DAYS", 30),
  minPassword: num("AUTH_MIN_PASSWORD", 8),
  /** scrypt cost is linear in input length, so this is a DoS bound. */
  maxPassword: num("AUTH_MAX_PASSWORD", 200),
  /** Failed sign-ins allowed per email+IP inside the window below. */
  maxAttempts: num("AUTH_MAX_ATTEMPTS", 10),
  attemptWindowMinutes: num("AUTH_ATTEMPT_WINDOW_MINUTES", 15),
};

// ─────────────────────────────── AI coach ────────────────────────────────────

/**
 * The AI coach, and the habit recommendations that share its configuration.
 *
 * Claude, through the same server-only `CLAUDE_API_KEY` as intention
 * suggestions: one provider architecture and one credential, read lazily here
 * and handed to the provider in src/lib/ai. Absent, `/api/coach` and
 * `/api/recommendations` answer 501 and nothing else is affected.
 *
 * `COACH_MODEL` overrides the model without touching code. It is separate from
 * `INTENTION_AI_MODEL` because the coach reasons over an account's whole history
 * while a suggestion is one short list, so the two may want different models.
 */
export const coach = {
  get apiKey(): string | null { return process.env.CLAUDE_API_KEY?.trim() || null; },
  model: str("COACH_MODEL", "claude-sonnet-5"),
  /** Enough for a few grounded paragraphs, or a short list. Not an essay. */
  maxOutputTokens: num("COACH_MAX_OUTPUT_TOKENS", 1200),
  maxQuestionLength: num("COACH_MAX_QUESTION_LENGTH", 500),
  /** Serverless timeout for the route; reasoning models outlast the default. */
  timeoutSeconds: num("COACH_TIMEOUT_SECONDS", 60),
  /**
   * Per-account safety limit, counted in the database so it survives a deploy
   * and is shared between instances (src/lib/ai/coachLimit.ts).
   *
   * A platform cost guard, not a plan entitlement: it applies to every account,
   * Pro and admin included, because its job is to bound the provider bill. Any
   * Free/Pro AI allowance will sit in front of it rather than replace it.
   *
   * `num` treats 0 as invalid and falls back, so lifting the limit is a code
   * change, not a stray environment value — deliberate for a cost control.
   */
  hourlyLimit: num("COACH_HOURLY_LIMIT", 20),
  dailyLimit: num("COACH_DAILY_LIMIT", 50),
};

// ──────────────────────── Intention suggestions (Claude) ─────────────────────

/**
 * Suggested habits and priorities for Clarify Your Intention.
 *
 * `CLAUDE_API_KEY` is a server-only secret. It is read here, lazily, and handed
 * to the provider in src/lib/ai — it is never logged, returned, or placed in
 * anything the browser receives. Absent, the suggestion route answers 501 and
 * the rest of Clarify Your Intention is unaffected.
 */
export const intentionAi = {
  get apiKey(): string | null { return process.env.CLAUDE_API_KEY?.trim() || null; },
  get model(): string { return str("INTENTION_AI_MODEL", "claude-sonnet-5"); },
  get timeoutSeconds(): number { return num("INTENTION_AI_TIMEOUT_SECONDS", 30); },
  /** Approved V1 limits, per user. */
  get hourlyLimit(): number { return num("INTENTION_AI_HOURLY_LIMIT", 10); },
  get dailyLimit(): number { return num("INTENTION_AI_DAILY_LIMIT", 30); },
};

const megabytes = (name: string, fallback: number): number =>
  Math.max(1, Math.floor(num(name, fallback) * 1024 * 1024));

/**
 * The admin-only AI Workspace. Limits live here rather than in database
 * constraints, so raising any of them is a configuration change, not a
 * migration. The database checks are generous backstops only.
 */
export const aiWorkspace = {
  /**
   * The same server-only `CLAUDE_API_KEY` as intention suggestions: one
   * workspace-scoped key, read lazily and handed straight to the provider.
   * Absent, the workspace stays usable for reading history and says replies are
   * unavailable.
   */
  get apiKey(): string | null { return process.env.CLAUDE_API_KEY?.trim() || null; },
  get model(): string { return str("AI_WORKSPACE_MODEL", "claude-sonnet-5"); },
  get maxOutputTokens(): number { return num("AI_WORKSPACE_MAX_OUTPUT_TOKENS", 8000); },
  get contextTargetTokens(): number { return num("AI_WORKSPACE_CONTEXT_TARGET_TOKENS", 150000); },
  get contextMaxTokens(): number { return num("AI_WORKSPACE_CONTEXT_MAX_TOKENS", 200000); },
  /** Per admin. The daily count is read from the database, so a restart does not reset it. */
  get hourlyLimit(): number { return num("AI_WORKSPACE_HOURLY_LIMIT", 20); },
  get dailyLimit(): number { return num("AI_WORKSPACE_DAILY_LIMIT", 100); },
  get maxPdfBytes(): number { return megabytes("AI_WORKSPACE_MAX_PDF_MB", 10); },
  get maxImageBytes(): number { return megabytes("AI_WORKSPACE_MAX_IMAGE_MB", 5); },
  get maxTextBytes(): number { return megabytes("AI_WORKSPACE_MAX_TEXT_MB", 2); },
  /** Total live file bytes per admin, across projects and conversations. */
  get storageQuotaBytes(): number { return megabytes("AI_WORKSPACE_STORAGE_QUOTA_MB", 100); },
  /**
   * Google's server-only `GEMINI_API_KEY`, read lazily and handed straight to
   * the Gemini adapter. When set, Gemini joins the model selector and image
   * generation is turned on. Absent, the workspace runs on Claude alone.
   */
  get geminiApiKey(): string | null { return process.env.GEMINI_API_KEY?.trim() || null; },
  /** Gemini's conversational model: a current stable Flash model. */
  get geminiModel(): string { return str("AI_WORKSPACE_GEMINI_MODEL", "gemini-3.8-flash"); },
  /** The image-generation model: Nano Banana 2, Google's recommended default. */
  get imageModel(): string { return str("AI_WORKSPACE_IMAGE_MODEL", "gemini-3.1-flash-image"); },
  /** Generated image resolution. 1K keeps each stored image to about a megabyte. */
  get imageSize(): string { return str("AI_WORKSPACE_IMAGE_SIZE", "1K"); },
};

/**
 * Set on the throwaway stack (`npm run dev:test`). Accounts created against it
 * are stamped as test accounts at the moment they are made, which is the only
 * reliable way to know — an email pattern is a guess, and guessing is not a
 * good enough reason to offer someone a delete button.
 */
export const isTestInstance = process.env.RH_TEST_INSTANCE === "true";

// ────────────────────────── early access capacity ────────────────────────────

/**
 * The early-access cap: the one number in this file where `0` is a real
 * setting rather than a mistake, so it needs its own parser.
 *
 * `num` above rejects anything `<= 0` and falls back, which is right for every
 * other value it reads — a pool of 0 connections, a 0-character minimum
 * password, a 0-request AI allowance are all either nonsense or a footgun, and
 * the fallback is the safety net. Applying that rule here made
 * `EARLY_ACCESS_USER_LIMIT=0` mean *fifty*: the cap could not be turned off by
 * configuration at all, which is the bug this replaces. `num` is deliberately
 * left exactly as it was.
 *
 * - unset, or empty        → 0, unlimited. This is the shipped default.
 * - `0`                    → unlimited; enforcement is skipped entirely.
 * - a positive whole number → enforced at that number.
 * - negative, fractional, or not a number → unlimited, with one warning.
 *
 * That last case fails **open**, and deliberately: a cap is a restriction, and
 * a typo in configuration should not close the door on everyone who wants to
 * sign up. The warning names the value so it can be found and fixed.
 */
let capacityWarned = false;
function capacityLimit(): number {
  const raw = process.env.EARLY_ACCESS_USER_LIMIT?.trim();
  if (raw == null || raw === "") return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    if (!capacityWarned) {
      capacityWarned = true;
      console.warn(
        `[env] EARLY_ACCESS_USER_LIMIT="${raw}" is not 0 or a positive whole number; `
        + "leaving the account cap unlimited.",
      );
    }
    return 0;
  }
  return parsed;
}

export const capacity = {
  /**
   * How many active non-admin accounts may exist, or 0 for no limit.
   *
   * A getter, so the value is read when it is used rather than frozen at
   * import: one fewer way for a process to disagree with its own configuration.
   * The cap machinery — the predicates, the advisory lock, the refusal paths —
   * stays in place whatever this returns, so a limit can be reintroduced by
   * setting this variable and nothing else.
   */
  get limit(): number { return capacityLimit(); },
  /**
   * Whether a **newly registered** account must prove its address before it
   * becomes active and takes a place.
   *
   * This is read at sign-up only, and stamped onto the account as
   * `users.verification_required`. It is deliberately not consulted when
   * counting or when signing in: the account carries its own answer, so
   * existing accounts are unaffected by this flag and turning it off and on
   * again cannot retroactively lock anyone out.
   */
  requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
  /** How long a verification link stays usable. */
  verifyTtlHours: num("VERIFY_LINK_TTL_HOURS", 24),
  /** The shortest gap between two verification emails to the same account. */
  resendGapSeconds: num("VERIFY_RESEND_GAP_SECONDS", 60),
};

/**
 * Forgotten-password links.
 *
 * Shorter-lived than a confirmation link by design: a reset token is a way into
 * an account that already exists, where a confirmation token only proves an
 * address. Thirty minutes is long enough for a slow inbox and short enough that
 * a message left open on a shared screen stops mattering quickly.
 */
export const passwordReset = {
  ttlMinutes: num("PASSWORD_RESET_TTL_MINUTES", 30),
  /** The shortest gap between two reset emails to the same account. */
  gapSeconds: num("PASSWORD_RESET_GAP_SECONDS", 60),
  /**
   * How many reset emails one account may be sent in a day. Database-backed
   * rather than in memory, so a restart cannot reset somebody's allowance.
   */
  maxPerDay: num("PASSWORD_RESET_MAX_PER_DAY", 5),
};

// ──────────────────────────────── outgoing mail ──────────────────────────────

/**
 * Where a link in an email has to point. There is no request to infer it from
 * when mail is sent from a background path, and inferring it from the `Host`
 * header would let a forged header rewrite the link in someone else's email —
 * so it is configuration, and verification refuses to send without it.
 */
export function appUrl(): string {
  const raw = str("APP_URL", "") || str("RENDER_EXTERNAL_URL", "");
  if (!raw) {
    throw new Error(
      "APP_URL is not set. It is the public origin of this deployment, " +
      "e.g. https://richhabit.onrender.com — verification links are built from it.",
    );
  }
  return raw.replace(/\/+$/, "");
}

export const mail = {
  /**
   * Absent means no provider is configured. Nothing throws for it: the
   * application runs perfectly well with mail switched off, and every path
   * that needs mail says so at the point of use.
   */
  resendApiKey: process.env.RESEND_API_KEY?.trim() || null,
  /** The From header, e.g. `RichHabit <info@rosalytics.com>`. */
  from: str("MAIL_FROM", ""),
  /** Optional; where a reply goes if it differs from the sender. */
  replyTo: str("MAIL_REPLY_TO", "") || null,
  /**
   * Development and tests write messages here as JSON instead of sending them,
   * which is what makes the whole flow testable without a provider — and means
   * a misconfigured production cannot silently fall back to sending nothing.
   */
  outboxDir: str("MAIL_OUTBOX_DIR", "") || null,
};

// ─────────────────────────────── analytics ───────────────────────────────────

export const analytics = {
  /** A gap longer than this starts a new session. */
  sessionIdleMinutes: num("ANALYTICS_SESSION_IDLE_MINUTES", 30),
};

/**
 * Stamped onto every event. `npm_package_version` only exists when the process
 * was started by npm, which is not true of most production runtimes, so it is
 * a fallback rather than the source.
 */
export const appVersion = str("APP_VERSION", process.env.npm_package_version || "0.1.0");
