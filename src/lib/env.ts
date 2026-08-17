/**
 * Every environment variable the application reads, in one place.
 *
 * **Server-only.** Nothing here may be imported from a client component: it
 * exposes the database URL and the OpenAI key. There is deliberately not a
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

/** Required. Throws where it is used, not where it is imported. */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and point it at your Postgres.",
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

export const coach = {
  /** Absent, the coach route answers 501 and nothing else is affected. */
  apiKey: process.env.OPENAI_API_KEY?.trim() || null,
  model: str("OPENAI_MODEL", "gpt-5.6-terra"),
  maxQuestionLength: num("COACH_MAX_QUESTION_LENGTH", 500),
  /** Serverless timeout for the route; reasoning models outlast the default. */
  timeoutSeconds: num("COACH_TIMEOUT_SECONDS", 60),
};

/**
 * Set on the throwaway stack (`npm run dev:test`). Accounts created against it
 * are stamped as test accounts at the moment they are made, which is the only
 * reliable way to know — an email pattern is a guess, and guessing is not a
 * good enough reason to offer someone a delete button.
 */
export const isTestInstance = process.env.RH_TEST_INSTANCE === "true";

// ────────────────────────── early access capacity ────────────────────────────

export const capacity = {
  /**
   * How many active non-admin accounts may exist. Configuration rather than a
   * literal, so lifting or removing the cap when RichHabit stops being free is
   * an environment change and not a code change. `0` means unlimited.
   */
  limit: num("EARLY_ACCESS_USER_LIMIT", 50),
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
