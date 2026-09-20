# RichHabit — Project Status

> Last updated: 2026-09-20
>
> **PHASE 5 — FREE PLAN ENFORCEMENT: IMPLEMENTED → COMMITTED → PUSHED → REHEARSED → PRODUCTION MIGRATION APPLIED → DEPLOYED → PRODUCTION VERIFIED · `2410bd3` ON `main` → MIGRATION APPLIED 2026-09-20, SHORTLY BEFORE THE 04:44 UTC HEALTH CHECK (38 → 39 TABLES) → DEPLOYED TO RENDER (`dep-danmdsmk1f9s73979ceg`) → PRODUCTION VERIFIED 2026-09-20 · **MIGRATION BEFORE DEPLOY**, BECAUSE THE DEPLOYED CODE READS `priority_quota_usage` FOR FREE PRIORITY CREATION · FREE = **15 ACTIVE HABITS** AND **5 NEW PRIORITIES PER SERVER-DERIVED LOCAL DAY** · GRANDFATHERED PRO (8) AND ADMIN (5) UNLIMITED AND WRITE NO QUOTA ROW · ONLY TRANSITIONS *INTO* ACTIVE ARE GATED; AN ACCOUNT OVER THE LIMIT KEEPS EVERYTHING · `priority_quota_usage` CREATED **EMPTY** AND STILL 0 ROWS · NO EXISTING USER DATA MIGRATED, MODIFIED OR DELETED · NO PAYMENT INFRASTRUCTURE · KNOWN **VERIFICATION GAP** (NOT A DEFECT): SIMULTANEOUS MULTI-SESSION LOCK CONTENTION NOT YET EXECUTED**
> **PHASE 4C — GRANDFATHERED PRO GRANTED: EXECUTED AND PRODUCTION VERIFIED 2026-09-20 02:58:15 UTC · FIXED LITERAL CUTOFF `2026-09-20T00:00:00Z` · **8** EXISTING NON-ADMIN ACCOUNTS NOW `plan='pro'`, `source='grandfathered'`, `expires_at=NULL`, `granted_by=NULL`, `note=NULL` · PERMANENT AND $0, NO PAYMENT PROVIDER · TWO TEST ACCOUNTS EXCLUDED BY EXACT UUID CONFIRMED BY THE PRODUCT OWNER AND REMAIN FREE · 5 ADMINS HOLD NO PLAN ROW AND STAY UNLIMITED THROUGH THE CENTRAL BYPASS · FUTURE ACCOUNTS DEFAULT FREE · RUN AS A STANDALONE ONE-OFF OPERATION, **NOT** ADDED TO `scripts/migrate.mjs` · `user_plans` IS THE ONLY TABLE THAT CHANGED · NO PRODUCT/CONTENT ROW CHANGED · NO SCHEMA CHANGE · NO DEPLOY · NO RENDER CHANGE · PHASE 5 ENFORCEMENT SHIPPED SEPARATELY IN `2410bd3`**
> **PHASE 4A/4B — ENTITLEMENT FOUNDATION: IMPLEMENTED → COMMITTED → PUSHED → LOCAL MIGRATION REHEARSAL VERIFIED → PRODUCTION MIGRATION APPLIED → DEPLOYED → PRODUCTION VERIFIED · `37217f4` ON `main` → MIGRATION APPLIED TO PRODUCTION 2026-09-20 ~02:02 UTC (37 → 38 TABLES) → DEPLOYED TO RENDER (`dep-dank5iijnfac738tlc00`) → PRODUCTION VERIFIED 2026-09-20 · `user_plans` CREATED **EMPTY** (0 ROWS THROUGHOUT PHASE 4B; PHASE 4C LATER GRANTED 8) · NO FREE LIMITS ENFORCED · TWO PRE-EXISTING RUNNER BACKFILLS UNEXPECTEDLY BECAME PENDING AND WERE APPLIED AND ACCEPTED (ONE NULL `users.username`, ONE NULL `habits.template_key`) · NO ROW CREATED OR DELETED · EVERY PRODUCT ROW COUNT UNCHANGED · PHASE 5 (ENFORCEMENT) SHIPPED IN `2410bd3`**
> **PHASE 3 — ADMIN → USERS MODERNIZED: IMPLEMENTED → COMMITTED → PUSHED → DEPLOYED → PRODUCTION VERIFIED · `bf2d13c` ON `main` → DEPLOYED TO RENDER → DESKTOP **AND** MOBILE VISUAL QA BY THE PRODUCT OWNER 2026-09-19 · GROUPED TABLE (ACCOUNT · RICH HABITS · PRIORITY COMPASS · COMMUNITY · CLARIFY INTENTION · PLANNING) · GOALS AND REVIEWS REMOVED · ACTIVE HABITS NOW MEANS `status = 'active'` · COMMUNITY RANK/% READ FROM THE EXISTING CACHE AND NEVER COMPUTED · PLAN IS PRESENTATION ONLY (ADMIN / FREE) · NO MIGRATION · NO SCHEMA CHANGE · NO PRODUCTION DATA TOUCHED**
> **PHASE 2 — EARLY-ACCESS ACCOUNT CAP REMOVED: IMPLEMENTED → COMMITTED → PUSHED → DEPLOYED → PRODUCTION VERIFIED · `80da10b` ON `main` → DEPLOYED TO RENDER → `EARLY_ACCESS_USER_LIMIT=0` SET IN RENDER (WHICH TRIGGERED A SECOND DEPLOY) → PRODUCTION VERIFIED 2026-09-19 · SIGN-UP IS OPEN · NO MIGRATION · NO SCHEMA CHANGE · NO USER DATA TOUCHED · THE CAP MACHINERY IS INTACT AND RE-ENABLED BY SETTING A POSITIVE NUMBER**
> **PHASE 1B — CONSUMER AI ON CLAUDE: PRODUCTION DEPLOYED + VERIFIED · `9fa4684` PUSHED TO `main` (fast-forward from `b903dd7`) → DEPLOYED TO RENDER → PRODUCTION VERIFIED 2026-09-19 · AI COACH AND AI HABIT RECOMMENDATIONS MIGRATED OpenAI → CLAUDE (`claude-sonnet-5`) · OPENAI RUNTIME DEPENDENCY REMOVED ENTIRELY · COACH ANSWERED FOR THE FIRST TIME IN PRODUCTION (ENGLISH AND 中文, THROWAWAY ACCOUNT ONLY) · NO MIGRATION · NO RENDER VARIABLE CHANGED**
> **PHASE 1 — AI COACH DURABLE SAFETY LIMIT: PRODUCTION DEPLOYED + MIGRATED + VERIFIED · `ee0761a` PUSHED TO `main` (fast-forward from `d905d4e`) → DEPLOYED TO RENDER → PRODUCTION VERIFIED 2026-09-19 · `coach_requests` MIGRATION APPLIED (36 → 37 TABLES) · 20/HOUR AND 50/DAY PER ACCOUNT · LIMITER CURRENTLY DORMANT IN PRODUCTION: COACH STILL RUNS THE LEGACY OPENAI PATH · PHASE 1B (COACH + HABIT RECOMMENDATIONS → CLAUDE) NOT IMPLEMENTED**
> **PUBLIC FRONT PAGE: PRODUCTION VERIFIED · IMPLEMENTED ON `feature/landing-page` → PUSHED TO `main` (`83e7ebb`, fast-forward from `5eb1a92`) → DEPLOYED TO RENDER → PRODUCTION VERIFIED 2026-09-17 (21/21 SMOKE CHECKS) · NO SCHEMA OR MIGRATION**
> **AI WORKSPACE → GENERAL-PURPOSE, MULTI-MODEL, IMAGE GENERATION: MERGED INTO `main` AND DEPLOYED (`74d2eb3` is an ancestor of the deployed `ee0761a`) · REAL GEMINI IMAGE GENERATION: PASS (FINAL ACCEPTANCE ON `74d2eb3`, ENGLISH AND CHINESE) · REAL GEMINI CHAT PASS · IMPLEMENTATION TESTS PASS · INCLUDES `1375082f` BY MERGE · NO MIGRATION · PRODUCTION EVIDENCE 2026-09-19: `ai_messages` HOLDS 5 CLAUDE AND 3 GEMINI-IMAGE REPLIES, SO BOTH CREDENTIALS WORK IN PRODUCTION** *(corrected 2026-09-19: the earlier "NOT MERGED · NOT DEPLOYED" was stale)*
> **AI WORKSPACE V1 — IMAGE UNDERSTANDING: VERIFIED · EXISTING CAPABILITY OF `f7499fc` · 30/30 LIVE CLAUDE CHECKS · 46/46 IMAGE-PATH UNIT TESTS · NO CODE, SCHEMA, CONFIG OR PRODUCTION CHANGE · DO NOT REBUILD**
> **AI WORKSPACE CHATBOT (ADMIN ONLY): RELEASE CLOSED · RELEASED IN `f7499fc` · MERGED INTO `main` · PRODUCTION MIGRATION APPLIED AND VERIFIED (24/24, 2026-09-13 15:21 UTC; not re-run) · DEPLOYED TO RENDER · PUBLIC PRODUCTION CHECKS 21/21 · PRODUCT OWNER SIGNED-IN SMOKE TEST PASSED**
> **CLAUDE KEY-ONLY CONFIGURATION + PRIORITY SUGGESTION FIX: RELEASED IN `dd7bec0` · DEPLOYED TO RENDER · PRODUCTION VERIFIED (AUTOMATED + PRODUCT OWNER SIGNED-IN) · NO MIGRATION**
> **INTENTION LINKS + AI SUGGESTIONS: RELEASED IN `e0eb036` · STILL LIVE IN PRODUCTION**
> **COMMUNITY RANKINGS + TWO-SERIES MY PROGRESS: RELEASED IN `026d8be` · STILL LIVE IN PRODUCTION**
> **ACCOMPLISHMENTS: RELEASED IN `d728111` · STILL LIVE IN PRODUCTION**
>
> **Repository:** `origin/main` is `2410bd3` (Phase 5), fast-forwarded from
> `84eb5bc`. Its descent since the AI Workspace release: `3037cc5`, `fe06524`,
> `83e7ebb` (front page), `9444828`, `6c49f9e` (email verification for an address
> an account already has), `d905d4e` (password recovery), `ee0761a` (Phase 1),
> `b903dd7` (status), `9fa4684` (Phase 1B), `fd06064` and `1d3997d` (status),
> `80da10b` (Phase 2), `fa8be5f` (status), `bf2d13c` (Phase 3), `f45ab74` and
> `dc168d3` (status), `37217f4` (Phase 4A), `75e8c3a` and `84eb5bc` (status),
> `2410bd3` (Phase 5).
> `f7499fc`, `0f02a6e` and `74d2eb3` are all ancestors of it.
>
> **Production database:** 39 tables. The seven AI Workspace tables (additive,
> created empty 2026-09-13), `password_resets` (the password-recovery release),
> `coach_requests` (2026-09-19), `user_plans` (2026-09-20, Phase 4B) and
> `priority_quota_usage` (2026-09-20, Phase 5) were each added additively and
> created empty; every pre-existing table, index, constraint and row was verified
> unchanged after each. `user_plans` was created empty and stayed empty for all of
> Phase 4B; it holds **8 rows** since the Phase 4C grant of 2026-09-20 02:58:15
> UTC — eight permanent Grandfathered Pro grants, one per eligible account, and
> nothing else has ever been written to it (lifetime `ins/upd/del = 8/0/0`).
> `priority_quota_usage` holds **0 rows** (`0/0/0`): only a Free account creating a
> priority writes there, and the two Free accounts are dormant test accounts.
>
> **Deployed application:** `2410bd314c791d1d9377d414b3f5113e100d2af7` (Phase 5),
> deployed on Render by the Product Owner as `dep-danmdsmk1f9s73979ceg` and
> confirmed live 2026-09-20. Render reported the exact commit, and a
> self-validating served-bundle probe proves it: all six new limit strings
> (English and 中文) were **absent** from the bundle before the deploy and are
> **present** after, with four control strings found in both runs — including
> server-only `errors.*` entries, which is what establishes that the dictionary
> ships to the client wholesale and therefore that this probe can see the new
> copy at all. Phase 4A (`37217f4`, `dep-dank5iijnfac738tlc00`) and Phase 3
> (`bf2d13c`) remain ancestors. Render has not auto-deployed recent releases —
> Phase 1, 1B and 2 were each still serving the previous build minutes after the
> push — and it deploys only what is on `main`.
>
> **Note for future production migrations:** a schema comparison alone is not a
> sufficient preflight. See the Phase 4B section — two long-standing data
> backfills in `scripts/migrate.mjs` were pending in production and invisible to a
> schema diff.
>
> **Production Render configuration:** `EARLY_ACCESS_USER_LIMIT=0`. No other
> environment variable was changed in Phase 2, and no value was read or printed
> by the agent.
>
> The earlier My Journey and Clarify Your Intention release (`cd3eef4`, with its
> intention migration applied to production on 2026-09-12) was deployed and
> confirmed live by the Product Owner before Accomplishments; production includes it.

## Phase 5 — Free plan enforcement (PRODUCTION MIGRATED · DEPLOYED · VERIFIED)

The entitlements defined in Phase 4 are now enforced. Free accounts are held to
**15 active habits** and **5 new priorities per their own local calendar day**;
Grandfathered Pro and Admin are unlimited. Nothing existing was migrated, paused,
retired or deleted to make that true.

| Item | State |
| --- | --- |
| app commit | `2410bd314c791d1d9377d414b3f5113e100d2af7` (`feat: enforce Free plan limits`), fast-forwarded onto `main` from `84eb5bc` |
| release path | IMPLEMENTED → COMMITTED → PUSHED → LOCAL REHEARSAL → **PRODUCTION MIGRATION** → DEPLOYED → **PRODUCTION VERIFIED** (2026-09-20) |
| scope | 18 files, +1320/−46: 5 new (the migration module and its types, three test files) and 13 modified |
| Render deployment | `dep-danmdsmk1f9s73979ceg`, LIVE. **No environment variable, configuration, build or start command changed** |
| **release order** | **MIGRATION BEFORE DEPLOY**, and this one mattered: the deployed code reads `priority_quota_usage` on every Free priority creation, so shipping the code first would have broken priority creation for Free accounts while leaving Pro and Admin working — an easy failure to miss |
| production schema | **39 tables** (38 before). `priority_quota_usage` is the only addition |
| the quota table | `user_id` + `local_day` composite primary key, `created integer not null default 0 check (created >= 0)`, FK to `users` **ON DELETE CASCADE**, no index beyond the primary key, no `updated_at` and therefore no trigger |
| no reset job | the local day is half the primary key, so tomorrow is a different row and yesterday's count simply stops being consulted |
| rows | **0**, lifetime `ins/upd/del = 0/0/0`. Only a Free account creating a priority writes here |
| habit limit | gated **only** on a transition *into* active (`h.status === "active" && !wasActive`). Editing, renaming, rescheduling, completing, pausing, retiring and editing an inactive habit are never refused |
| already over the limit | keeps everything, stays fully editable, may reduce. Nothing is ever auto-paused, auto-retired or deleted — a test seeds an account at **17** active habits and proves every one survives |
| habit concurrency | a per-account `pg_advisory_xact_lock(8_243_122, hashtext(userId))` inside the write's own transaction. Without it two concurrent creations both read 14 and commit 16 |
| priority quota | charged in the same transaction as the insert, by `on conflict (user_id, local_day) do update set created = created + 1 where created < $limit returning created` — the row lock serialises, and zero rows returned *is* the refusal |
| order of operations | duplicate check → insert → charge. That ordering is what makes a retry free; atomicity is unaffected because a refused charge rolls the insert back with it |
| retry safety | the priority id is the client's, so a resent POST returns as a no-op: nothing inserted, **nothing charged**. Another account's id returns the shared non-disclosing 404 |
| never consumes quota | rollover, editing, planning, reordering, quadrant changes, completion, reopening — and **deleting does not refund**, because the day was spent creating the line |
| rollover | unchanged and still a pure client-side derivation in `lib/priorities.ts` (`createdOn <= date && (completedOn === null || completedOn >= date)`). That file contains no SQL and imports no database module at all |
| the local day | derived on the **server** from `x-rh-timezone` through `viewerToday`, never from the `created_on` the browser sends. `created_on` still records which day a line belongs to |
| Pro and Admin | resolve to an unlimited entitlement and return **before** any lock is taken, anything is counted, or any quota row is written — they pay nothing and leave no trace |
| the boundary | enforcement exists in exactly two functions, `saveHabit` and `addPriority`, both asking `limitFor(await getActor(userId, q), …)`. `getActor` gained an optional scoped query so the plan and the count are read in one snapshot |
| API | **409** with `{error: <localized sentence>, code: "plan_limit_reached", feature, limit}`. The machine fields sit *beside* `error` because the browser renders `error` verbatim — a code in that field would have put `plan_limit_reached` on somebody's screen |
| UX | the existing dismissible banner, in both languages, with the number taken from the entitlement. The store does **not** append "that change wasn't saved" to an allowance. No modal, no pricing, no upgrade button, **no payment infrastructure of any kind** |
| existing data | **nothing migrated, modified or deleted.** No backfill; absence of a row means nothing used |
| Phase 4C grants | untouched: still 8 rows, 8 Grandfathered Pro, lifetime `8/0/0` |

**Local verification:** **1172 of 1172** tests across 66 files (48 new: 17 habit
limit, 19 priority quota, 12 quota migration), typecheck and lint clean,
production build **64/64** pages. The Phase 4 guard tests that asserted *nothing*
enforces were **inverted rather than deleted** — what mattered was never "nothing
enforces", it was that enforcement cannot leak out of the entitlement boundary,
and that is still what fails the build.

**Migration rehearsal, disposable database over TCP: 16/16.** Seeded at the
pre-Phase-5 schema with a Free account deliberately holding **17** active habits,
a Pro account with 20, and an admin. The quota table was created empty; no
existing column, index, constraint or trigger changed; every row count stayed
identical; habits were byte-identical with all 17 active preserved; the
Grandfathered Pro grant was untouched; a second run reported `Nothing to do`; and
the migrated table was identical to a fresh install.

**Production migration, 2026-09-20.** Gate 1 re-ran **every** data-writing
predicate in the runner read-only first — username NULL 0, habit template-key
backfills across 15 keys 0, nighttime read mapping 0, unit canonicalization
**evaluated exactly per key** (`min`/`glasses`/`tasks`/`hr` all 0), goal
template-key backfills 0, legacy priority conversion skipped because 86
priorities exist. The runner then reported exactly `created priority_quota_usage`
and **`Done — 1 change(s).`**

*Why the per-key evaluation mattered:* a flattened superset of the unit aliases
matched **68 rows**, which looked like a pending backfill. It was not — all 68
already hold a canonical unit, so the `unit <> $1` half of the real predicate
excludes every one. Reporting "0/skipped" off a matched superset would have
repeated the Phase 4B mistake precisely.

**Production verification after deployment, read-only.** 39 tables ·
`priority_quota_usage` present with the approved key, CHECK and cascade, **0
rows**, `0/0/0` · `user_plans` still 8/8 at `8/0/0` · accounts 15 / 5 admin / 10
non-admin / 0 disabled · every product row count identical to pre-migration ·
`/` 200 and `/api/health` 200 with `db: up`, protected routes redirecting,
unauthenticated writes refused · no `priority_quota_usage`, `user_plans`,
`pg_advisory_xact_lock`, credential or host string anywhere in the served bundle.
Entitlement resolution computed by query without mutating anything: **Admin 5 +
Pro · Grandfathered 8 + Free 2 = 15**, no quota row for any admin or Pro account,
and neither Free account near its habit limit (20 active between them, 10 each).
**No production content was created to verify any of this.**

**Known verification gap — not a defect.** Real **simultaneous** multi-session
PostgreSQL lock contention has not been executed. It is a gap in *verification*
coverage, not a known bug and not a failed mechanism: the implementation uses
ordinary PostgreSQL transactional locking, and it is covered by sequential and
invariant tests, by source-level assertions on the ordering of lock/count and
insert/charge, and by the migration rehearsal. It could not be run because no
isolated multi-connection PostgreSQL environment was available — both pre-existing
Neon rehearsal branches reject authentication, there is no Neon API key, and
Docker, Homebrew and a local `postgres` binary are all absent, while PGlite serves
a single connection even over TCP. **Do not run this experiment against
production.** Carry it out when an isolated environment exists; the worst case it
would catch is a benign overshoot (16 active habits rather than 15, or 6
priorities in a day rather than 5) with no data loss, self-correcting on the next
attempt.

**Blast radius today: two accounts.** With 5 Admin and 8 Pro unlimited, only
`rhsmoke64t0ru` and `meimei` can meet a limit, and each holds 10 active habits
and 0 priorities. Neither was deleted.

### FORMAL PAUSE POINT — before the payment/monetization method is decided

This is the agreed stopping place. Everything below is written so a future
session can resume from this file alone, without any conversation history.

**Nothing is pending in production.** Phases 1, 1B, 2, 3, 4A/4B, 4C and 5 are all
migrated where applicable, deployed and verified. No database action, Render
change or deployment is outstanding, and the working tree is clean with no test
artefacts or processes left behind.

The state to resume from, in one place:

| | |
| --- | --- |
| deployed application commit | `2410bd314c791d1d9377d414b3f5113e100d2af7` (Phase 5) |
| Render deployment | `dep-danmdsmk1f9s73979ceg`, LIVE |
| `origin/main` | documentation commits sit on top of that application commit; it is the deployed SHA above, not the newest commit, that Render serves |
| production schema | **39 tables**; `priority_quota_usage` holds 0 rows, `user_plans` holds 8 |
| accounts | **15 total — 5 Admin, 8 Pro · Grandfathered, 2 Free** |
| Free allowance | 15 active habits · 5 new priorities per server-derived local day |
| Grandfathered Pro | permanent Pro entitlement, **$0, no expiration** (`expires_at = NULL`), no payment provider involved |
| Admin | unlimited through the **centralized bypass** in `entitlements()`, with no plan row |
| payment integration | **none, and none chosen** |

#### The payment posture, which is a decision and not an oversight

- **Stripe, and payment integration generally, is NOT implemented.** It is
  deliberately deferred, not forgotten or half-built. Nothing in the codebase
  imports a payment SDK, reads a payment credential, or references a customer,
  subscription, invoice, checkout or price identifier.
- **No payment provider should be selected or assumed yet.** Stripe is named
  throughout this file only because it is the option that was discussed and
  deferred — that is not a decision. The provider is an open business question,
  and no code, schema or configuration should presuppose an answer.
- **No prices belong in entitlement logic.** `src/lib/entitlements/` answers
  "what is this account entitled to" and must never learn what anything costs. A
  limit is a number of habits or priorities; a price is a billing concern that
  lives on the other side of that boundary. The user-facing limit copy takes its
  number from the entitlement and names no amount.
- **Billing and entitlement stay separate concepts.** `user_plans.source` records
  provenance — `grandfathered`, `gifted`, `trial`, `support`, and eventually
  `purchased` — and `purchased` is already a valid value with no payment
  implementation behind it. A feature asks what an account is entitled to, never
  whether it paid.
- **Future billing must never overwrite, expire, downgrade or revoke
  Grandfathered Pro.** Those 8 rows hold `expires_at = NULL` and are permanent at
  no charge. This is enforced by the write boundary and its tests, deliberately
  **not** by a database trigger (Phase 4 decision). Any billing system that
  reconciles plans must treat a `grandfathered` row as untouchable.

#### Pending phases

- **Phase 6 — AI allowance review: PENDING.** Covers Free vs Pro AI allowances and
  cost, including the deliberately unresolved question recorded in
  `src/lib/recommend.ts`: habit recommendations have no limiter of their own and
  must not borrow `coach_requests`, because one feature must not spend another's
  allowance.
- **Phase 7 — monetization and billing: PENDING.** The Pro package, pricing, the
  provider choice and the billing integration. Nothing about it has been designed,
  and it must not begin before the business approach is decided.

#### The one open verification item

The **simultaneous multi-session PostgreSQL contention test** described earlier in
this section remains a **verification gap, not a known defect**. It is blocked on
an environment, not on code.

**It must never be performed against production.** To carry it out, an isolated
multi-connection PostgreSQL environment is needed: an **empty** Neon project or
database (not a branch of production, which would clone real rows into a test
environment), a Neon API key so a disposable empty project can be created and
dropped, or authorization to install Docker or Postgres.app.

`REHEARSAL_DATABASE_URL` and `REHEARSAL_DATABASE_URL_TEST` in `.env.local` both
fail authentication and are therefore **known-stale**. They are to be **left
exactly as they are for now** — do not change, rotate or remove them at this
pause. Restoring a rehearsal environment is step 5 of the resume order below.

#### Recommended resume order

Nothing is required today. When work resumes, in this order:

1. **Decide the business/payment approach.**
2. **Review AI usage and cost**, and Free vs Pro allowances (Phase 6).
3. **Finalize the Pro product/package and pricing.**
4. **Design the billing integration**, keeping billing separate from entitlements.
5. **Restore an isolated rehearsal PostgreSQL environment.**
6. **Implement and test billing in isolation.**
7. **Only then** consider a production billing rollout.

Steps 1–3 are business decisions and need no code. Step 5 is also what unblocks
the outstanding contention test.

#### Safety rules that still apply on resumption

`CLAUDE.md` is authoritative; these are the ones this work depended on most.
Production user data must survive every deployment and migration: never delete,
reset, overwrite, reseed or recreate it, and migrations are non-destructive by
default — `CREATE TABLE`, `ADD COLUMN`, `ADD INDEX`, nullable columns, safe
backfills only, with anything destructive stopping for explicit approval. Two
lessons were learned the hard way here and are recorded in full above: a
**schema-only preflight is insufficient**, because a data-backfill predicate with
rows still pending is indistinguishable from a no-op in a schema diff, so every
such predicate must be counted read-only first and **evaluated exactly, never as a
flattened superset**; and **migration must precede deployment** whenever deployed
code reads a new table. Production access for verification is read-only inside an
explicit read-only transaction, and no production content is created to test
anything.

**Carried, unchanged, none of them blocking:** `feedback_created_idx` remains
known unrelated drift and is intentionally untouched; `rhsmoke64t0ru` is still
live and is now permanently Free; two admin accounts have no email address and so
cannot use password recovery; the sign-in throttle is still in process memory; and
sign-up still reveals whether an address is registered, which was a deliberate
product decision rather than an oversight.

## Phase 4C — Grandfathered Pro granted (EXECUTED · PRODUCTION VERIFIED)

Everyone who was already using RichHabit before it had plans keeps everything,
permanently and at no charge. The grant is a **one-time data operation**, not a
feature and not a payment: eight rows in `user_plans`, and nothing else.

| Item | State |
| --- | --- |
| executed | 2026-09-20 **02:58:15 UTC**, one transaction, committed after every guard passed |
| how | a **standalone one-off script**, deliberately **not** added to `scripts/migrate.mjs` — a grant policy is a one-time business decision, not schema, and must not run on every deploy. No committed code inserts plan rows; a grep for `insert into user_plans` across `src/` and `scripts/` finds nothing |
| fixed cutoff | **`2026-09-20T00:00:00Z`**, a literal in the SQL, never `now()`. Later than every existing account (newest `2026-09-19T17:47:43.951Z`) and already in the past, so it can neither drift forward nor capture a future signup |
| eligibility | `role <> 'admin'` **and** `created_at < cutoff` **and** not one of the two excluded UUIDs. No activity, engagement, verification, email-domain or username criterion was used — the Product Owner explicitly ruled those out |
| granted | **8** accounts: `plan='pro'`, `source='grandfathered'`, `expires_at=NULL`, `granted_by=NULL`, `note=NULL` |
| the 8 | `fc5005dd…bffd5` richhabituser03 · `24f84581…4daa1` richhabituser04 · `aca5eff2…988fcb` richhabituser05 · `222ca61d…09eaf5` richhabituser06 · `a24087f2…8cf051` richhabituser07 · `ee701e47…f8918b` richhabituser08 · `024bc2aa…de70be` richhabituser09 · `9d70963e…524d0b` gazarfar |
| excluded, remain **Free** | `d2aeb944-dacb-4c68-91b8-f2743c7f7718` (rhsmoke64t0ru, the documented release/front-page smoke-test account) and `48b3c3d9-b880-4f82-af6f-07a702168074` (meimei, the 2026-09-19 mandatory-verification throwaway). **Exact UUIDs supplied and confirmed by the Product Owner** — never reconstructed heuristically. Neither account was deleted |
| how Free is represented | **by the absence of a row**, not by a `plan='free'` row. No row means Free, which is why introducing plans changed nobody and why the excluded accounts needed no write at all |
| admins | **no plan row for any of the 5.** They are unlimited through the central bypass in `entitlements()`, not through a Pro grant — giving an admin a Pro row would have duplicated policy in two places |
| future accounts | **Free** by default: they have no row, and the cutoff is in the past |
| permanence | `expires_at = NULL`. No payment provider, no subscription, no billing field. A future billing system must never silently expire, downgrade or revoke these — that is enforced by the write boundary and its tests, deliberately not by a database trigger |
| what changed | **`user_plans` only.** Every other table's row count is byte-identical to the Phase 4B baseline. No `users` row, no content row, no schema object, no deletion, no account cleanup |
| deploy / Render | **neither.** No code shipped and no configuration changed; the grant is data read by the already-deployed `37217f4` |
| Phase 5 | **still not implemented.** No route calls `limitFor`, `entitlements()` or `getActor()`; nothing refuses a request on a plan; `priority_quota_usage` exists neither as a migration nor in `db/schema.sql`. The 8 accounts are Pro, and *nobody* is limited yet |

**Guards enforced inside the transaction, before `commit`.** Any failure would
have rolled the whole thing back: exactly 8 rows inserted · the inserted ids an
exact match for the reviewed 8 · `user_plans` totalling 8 · 8 `pro` · 8
`grandfathered` · 8 with `expires_at IS NULL` · 8 with `granted_by IS NULL` · 8
with `note IS NULL` · 0 rows for either excluded UUID · 0 rows for any admin ·
users still 15 / 5 admin / 10 non-admin / 0 disabled · every product and content
row count identical to the Phase 4B baseline. The statement was
`insert … on conflict (user_id) do nothing` — never `do update`, so a
pre-existing plan row of any kind could not have been modified, and a re-run
inserts 0.

**Post-commit verification, read-only.** `user_plans` = 8 rows, all
Pro · Grandfathered, all `expires_at`/`granted_by`/`note` NULL, all non-admin,
and the set of `user_id`s is exactly the reviewed 8 with no other account
holding a row. 0 rows for the excluded UUIDs, 0 for admins, 0 for any account
created at or after the cutoff. Accounts 15 / 5 / 10 / 0. Schema **38 tables**.
Every product row count identical to the Phase 4B baseline, so `user_plans` is
the only table that changed anywhere in the database.

**Admin → Users now resolves, from the data alone, to Admin × 5 ·
Pro · Grandfathered × 8 · Free × 2 — 15 accounts, every one accounted for.**
Verified by query rather than by creating any test content.

**One policy judgement recorded, because it was deliberate.** Seven of the eight
granted accounts have 0 completions and 0 priorities and hold only the untouched
10 starter habits; the eighth has 22 completions. The Product Owner was shown
this and directed that eligibility must **not** depend on activity or
engagement. The rule as executed is exactly the rule as approved.

## Phase 4A/4B — entitlement foundation (PRODUCTION DEPLOYED · MIGRATED · VERIFIED)

The product had no notion of what an account is *entitled* to. It has one now: a
`user_plans` table and a single module that answers the question. **Nothing is
granted and nothing is enforced** — this phase exists so that Phase 4C can grant
Grandfathered Pro and Phase 5 can enforce Free limits without either of them
inventing its own idea of a plan.

| Item | State |
| --- | --- |
| app commit | `37217f44a5dc25245d3192a62edc1d239de9dc42` (`feat: add entitlement foundation`), fast-forwarded onto `main` from `dc168d3` |
| release path | IMPLEMENTED → COMMITTED → PUSHED → **LOCAL MIGRATION REHEARSAL VERIFIED** → **PRODUCTION MIGRATION APPLIED** → DEPLOYED → **PRODUCTION VERIFIED** (2026-09-20) |
| scope | **13 files** — `src/lib/entitlements/{index,actor}.ts` (new), `src/lib/admin/plan.ts`, `src/lib/analytics/queries.ts`, `src/app/admin/users/UsersTable.tsx`, `src/app/admin/users/[id]/page.tsx`, `scripts/migrations/user-plans.{mjs,d.mts}`, `scripts/migrate.mjs`, `db/schema.sql` and three test files |
| Render deployment | `dep-dank5iijnfac738tlc00`, LIVE. **No environment variable, configuration, build or start command changed** |
| production schema | **38 tables** (37 before). `user_plans` is the only addition anywhere in the public schema |
| columns | exactly eight: `user_id` (uuid, PK), `plan`, `source`, `granted_at`, `expires_at`, `note`, `granted_by`, `updated_at` |
| constraints | `PRIMARY KEY (user_id)` · `user_id → users(id) ON DELETE CASCADE` · `granted_by → users(id) ON DELETE SET NULL` · `CHECK (plan IN ('free','pro'))` · `CHECK (source IS NULL OR source IN ('grandfathered','purchased','gifted','promotional','trial','support'))` · `CHECK (plan <> 'pro' OR source IS NOT NULL)` — a Pro row cannot exist without a provenance |
| index and trigger | `user_plans_plan_idx` btree `(plan)`; `user_plans_touch` before update, reusing the existing `touch_updated_at()` |
| rows | created **empty** and still 0 at the close of Phase 4B — `n_tup_ins`, `n_tup_upd` and `n_tup_del` were all 0, so nothing had ever been inserted, updated or deleted. The Phase 4C grant later inserted 8 rows; see its section |
| the boundary | one module decides: `entitlements(actor)` and `limitFor(actor, feature)`. `effectivePlan` is the single place expiry is applied, so an expired grant cannot read as Pro on one screen and Free to a feature. **No row means Free**, which is why introducing plans changed nobody |
| admin bypass | central, in `entitlements()`. No feature branches on a role |
| unlimited | `null` — never `0` (the Phase 2 cap bug) and never `Infinity` (which JSON cannot carry) |
| Free limits defined | 15 active habits, 5 new priorities per local day. **Defined, not enforced** |
| enforcement | **none.** No route calls `limitFor`, `entitlements()` or `getActor()`; nothing refuses a request on a plan; `priority_quota_usage` does not exist. Verified against the deployed tree, not only by test |
| billing | **absent by construction.** No Stripe, customer, subscription, invoice, checkout or price field anywhere in the entitlement module, the admin badge or the migration. A feature asks what an account is entitled to, never whether it paid |
| privacy | `user_plans.note` is admin prose about a person and is **never selected** by any query. The admin listing selects only `up.plan`, `up.source` and `up.expires_at` |
| Admin → Users | gained a Plan column: `Admin` for administrators, `Free` for everyone else, and `Pro` with its source once grants exist. Presentation only — it reads no database and no environment |
| Phase 4C | **done** (2026-09-20): eight permanent Grandfathered Pro grants, with two test accounts excluded by exact UUID confirmed by the Product Owner. See the Phase 4C section |
| Phase 5 | **done** (2026-09-20), shipped separately in `2410bd3`: `priority_quota_usage`, the server-derived local quota day, the transactional priority insert and Free-limit enforcement with bilingual UX. See the Phase 5 section |
| `feedback_created_idx` | **known unrelated drift, intentionally untouched.** Present in `db/schema.sql`, absent from production, created by no migration step. Out of scope for Phase 4 and deliberately not fixed |

**A real bug the tests found.** `planBadge`'s lapsed-plan branch tested
`account.plan === "pro"`, but callers hand it the *effective* plan, so the branch
was unreachable from the admin listing. It infers from `source` alone now, which
is sound because the table's CHECK means a Free row needs no source at all.

**Local verification before release:** typecheck clean, lint clean, **1119 of
1119** unit tests across 63 files (61 targeted: 23 entitlements, 13 migration, 25
admin), production build compiled with 64/64 pages.

**Local migration rehearsal — PASS, twice.** First against the migration step
directly (22/22), then a final **full-runner rehearsal over TCP** (18/18): a
disposable PGlite database served on `127.0.0.1:5433`, seeded at the pre-Phase-4
schema and migrated by the real `node scripts/migrate.mjs` rather than by calling
the step — because that is the execution path production would use. It verified
that `user_plans` is created empty with exactly the approved shape, that a second
run reports `Nothing to do`, and that every seeded user, habit and priority row
stayed byte-identical. The disposable database was deleted afterwards.

**Two pre-existing runner backfills unexpectedly became pending — applied and
accepted.** The preflight predicted `Done — 2 change(s)`. The runner reported
**4**:

| Change | What it did |
| --- | --- |
| `created user_plans` | expected |
| `created trigger user_plans_touch` | expected |
| `username → richhabituser01` | **unexpected.** One account had no username; a long-standing step filled it. `where username is null` means no chosen username could be overwritten, and `username` was the only column written |
| `habits → exercise: 1` | **unexpected.** One habit named as an "Exercise" starter had no `template_key`; a long-standing step filled it. `template_key` was the only column written — no name, status, category, schedule, goal link or completion history |

Both were reviewed and **accepted by the Product Owner**, who directed that
neither be reverted. Neither created or deleted a row; every product row count is
unchanged. The change budget closes exactly: 4 = table + trigger + username +
`template_key`, which is what proves no other step wrote anything. One
consequence is honest to record: keying a starter habit is what lets its
displayed name follow the reader's locale instead of staying frozen as stored
text, so that single habit's name may now localise — the intended behaviour of
that step.

**The preflight lesson, recorded so it is not repeated.** A schema comparison
alone is **not** a sufficient production preflight. Before running the normal
runner against production, inspect **both** the pending schema operations **and
every data-backfill predicate the runner can execute** — for example
`where username is null` and `where template_key is null and name = any(...)` —
by running each as a read-only `count(*)`. A backfill step with rows still
pending is indistinguishable from a no-op in a schema diff. Never assume an old
step is a no-op merely because the schema object it creates already exists. Note
also that `users` carries **no `updated_at`** column, so timestamp evidence
cannot bound writes to that table; the runner's change-count arithmetic can.

**Production migration, 2026-09-20, read-only preflight then one transaction**

| Check | Result |
| --- | --- |
| target | the production Neon database, identified by host fingerprint without printing any credential, connection string or host |
| preflight gate | table count 37, `user_plans` absent, no colliding relation/trigger/constraint/type, `users` has no `plan` column, accounts 15 / 5 admin / 10 non-admin / 0 disabled, `users.id` a uuid primary key so both foreign keys are supported, `touch_updated_at()` present and already used by 7 triggers, role may `CREATE` in `public` |
| what would change | proved by diffing production against the post-migration rehearsal: the only table production lacked was `user_plans`; no column, no trigger, and no index other than the pre-existing `feedback_created_idx` drift |
| locking | the two foreign keys take a brief `ShareRowExclusiveLock` on `users` — writes to `users` blocked for milliseconds, reads never, and no validation because the new table is empty |
| runner result | exit code **0**, `Done — 4 change(s).` inside the runner's single `begin`/`commit` |

**Production verification after deployment, 2026-09-20, read-only**

| Check | Result |
| --- | --- |
| serving `37217f4` | **yes**, three independent ways: Render reported the exact commit for `dep-dank5iijnfac738tlc00`; the Product Owner confirmed the Plan column renders in Admin → Users, which is impossible on the previous build; and `user_plans` scan counters rose above their pre-deploy baseline, which only this commit's `left join user_plans` can cause |
| Admin → Users | **PASS** (Product Owner): loads, Plan column present, admin accounts read `Admin`, regular accounts read `Free`, 15 users listed. No Pro or Grandfathered badge anywhere, because no grant exists |
| schema | **38 tables**; `user_plans` present; every pre-existing table's columns, indexes and triggers byte-identical to the pre-migration baseline (0 added, 0 lost) |
| `user_plans` | **0 rows**, 0 Pro rows, `n_tup_ins`/`n_tup_upd`/`n_tup_del` all 0, `n_live_tup`/`n_dead_tup` 0/0 |
| accounts | **15**, unchanged — 5 admin, 10 non-admin, 0 disabled, 2 without an email address. 0 created |
| product data | **every row count identical** to the Phase 4B baseline: profiles 15, habits 172, habit_completions 128, priorities 86, day_notes 9, goals 45, weekly_reviews 0, coach_requests 2, day_priorities 2, intentions 2, analytics_events 865, user_sessions 148. 1904 rows in total, unchanged |
| deployment wrote nothing | **0 rows written anywhere in the 15 minutes covering the deploy and verification**, across all 18 tables carrying `updated_at`. The most recent write in the database is the migration's own `template_key` backfill |
| Priority Compass and Rich Habits | **behaviour unchanged, proved by identity rather than by testing**: `src/app/api`, `src/app/(app)` and `src/lib/db/queries.ts` are byte-identical between the previously deployed `dc168d3` and `37217f4`, so `addPriority`, `saveHabit` and the completion routes cannot behave differently |
| no enforcement | no route or page calls `limitFor`, `entitlements()` or `getActor()`; nothing in `src/app/api` refuses a request on a plan; `priority_quota_usage` exists neither as a migration nor in `db/schema.sql` |
| no grant | `user_plans` holds 0 rows of any kind, so **no Grandfathered Pro grant occurred** |
| application health | `/` 200, `/api/health` 200 with `db: up`; `/sign-in`, `/priorities`, `/habits`, `/admin/users` redirect a signed-out visitor; `/api/state` 401. No 5xx |
| bundle privacy | no `user_plans`, `grandfathered`, `plan_source`, `entitlement` or `Pro ·` string in public HTML; plan presentation is imported only by the two admin screens |
| payments | no Stripe, checkout, subscription or price identifier anywhere in `src/` |

## Phase 1 — AI Coach durable safety limit (PRODUCTION DEPLOYED · MIGRATED · VERIFIED)

`/api/coach` had no rate limit of any kind. The limit is now counted in the
database, so a deploy cannot hand everybody a fresh allowance and two instances
cannot disagree about what an account has spent.

| Item | State |
| --- | --- |
| deployed commit | `ee0761aa6c15cd3002e6563d4f32227796b52b9f`, fast-forwarded onto `main` from `d905d4e`, deployed on Render by the Product Owner |
| migration | **applied to production 2026-09-19 19:04 UTC**: one `create table` and one `create index`, inside a single transaction, with guards that roll back if any watched row count or account figure moves |
| production schema | **37 tables** (36 before). `coach_requests` is the only addition anywhere in the public schema |
| columns | exactly three: `id` (bigserial), `user_id` (uuid not null), `occurred_at` (timestamptz not null, default `now()`) |
| index | `coach_requests_user_time_idx` on `(user_id, occurred_at DESC)`, plus the primary key |
| foreign key | `coach_requests_user_id_fkey` → `users(id)` **ON DELETE CASCADE** |
| limits | **20 an hour and 50 a day, per account**, from `COACH_HOURLY_LIMIT` / `COACH_DAILY_LIMIT`; the defaults live in code and nothing was set in Render |
| ordering | the request is charged **before** the provider call, so a timeout, a provider error or an abandoned request still consumes allowance |
| fails closed | a counter that cannot be read answers 503 and does **not** call the provider |
| serialisation | `pg_advisory_xact_lock` per account, so a burst of parallel requests cannot all pass the check together. Transaction-scoped, so it is safe behind a connection pooler |
| privacy | no question, no answer and no tokens are stored — the table records only that a request happened. A test fails if the column list ever stops being exactly `id, occurred_at, user_id` |
| housekeeping | rows older than 30 days are swept for that account on each allowed request |
| applies to | every account, admins included. It is a platform cost guard, **not** a plan entitlement; a future Free/Pro AI allowance sits in front of it rather than replacing it |
| production data | **unchanged**: every pre-existing table has an identical row count, and accounts stayed at 15 (5 admin, 10 non-admin, 0 disabled, 2 verified, 1 requiring verification) before and after |
| Render environment | **no variable changed or added.** No OpenAI credential was added anywhere |
| early-access cap | 50 and active at the time of this release. **Removed later the same day in Phase 2** (`80da10b`) — see the Phase 2 section |
| Phase 1B | **deployed and verified** in `9fa4684` — see the Phase 1B section below |

**Verification**

| Check | Result |
| --- | --- |
| local | typecheck and lint clean; **1001 of 1001** unit tests, 27 of them new (11 limiter, 7 migration, 9 route), all against real Postgres through PGlite; production build compiles |
| migration safety | additive and idempotent — a second run reports 0 changes, the result matches a fresh `db/schema.sql` install, and it is a no-op on a database with no `users` table |
| deployed commit is live | a self-validating probe of the served bundles: a coach string already in production is found, proving the probe can see dictionary text, and all three new Phase 1 strings are present (English hourly, English daily, and 最近一小时你向教练提问较多) |
| application health | no 5xx. `/`, `/login`, `/terms`, `/verify`, `/reset` answer 200; protected routes redirect a signed-out visitor to `/login`; `POST /api/coach` and `POST /api/recommendations` answer 401 *before* the limiter, so an unauthenticated probe consumes no allowance |
| `coach_requests` in production | verified absolutely against the live schema, not only by diff: table present, three columns, both indexes with the reviewed definitions, FK cascade present, 0 rows, 16 kB |
| unrelated production change | none: 21 of 21 structural checks pass against the pre-migration baseline |

**When Phase 1 shipped, the limiter was dormant** — `/api/coach` still ran the
legacy OpenAI path against an unconfigured `OPENAI_API_KEY`, so it answered 501
before the limiter was reached and `coach_requests` stayed empty. Phase 1B ended
that: the limiter is now load-bearing, and the first two rows in the table are its
smoke test. That finding is history; the Phase 1B section below is current.

**Provider architecture**

| Feature | Route | Provider | Model | Credential |
| --- | --- | --- | --- | --- |
| AI Coach | `/api/coach` | **Claude** (since `9fa4684`) | `claude-sonnet-5`, override `COACH_MODEL` | `CLAUDE_API_KEY` |
| AI habit recommendations | `/api/recommendations` | **Claude** (since `9fa4684`) | `claude-sonnet-5`, override `COACH_MODEL` | `CLAUDE_API_KEY` |
| Clarify Intention AI | `/api/intention/suggestions` | Claude | `claude-sonnet-5` | `CLAUDE_API_KEY` |
| AI Workspace chat | workspace message routes | Claude or Gemini | `claude-sonnet-5` / `gemini-3.8-flash` | `CLAUDE_API_KEY` / `GEMINI_API_KEY` |
| AI Workspace image generation | same routes, chosen by capability | Gemini | `gemini-3.1-flash-image` (Nano Banana 2) | `GEMINI_API_KEY` |

- **Claude is the primary text and reasoning provider. Gemini keeps its
  capabilities, including the existing image generation.**
- **OpenAI is gone**, removed in `9fa4684` once both callers above had migrated:
  the SDK dependency, `OPENAI_API_KEY`, `OPENAI_MODEL`, the `.env.example`,
  `render.yaml` and README references, and the mocks that existed only for it.
  `tests/no-openai.test.ts` fails if any of it returns.
- `render.yaml` **was** stale — it declared `OPENAI_API_KEY` and declared neither
  `CLAUDE_API_KEY` nor `GEMINI_API_KEY`, both of which are dashboard-managed.
  Corrected in `9fa4684`: the blueprint now declares the two credentials the
  application actually uses, both `sync: false`. No Render secret was created,
  changed or rotated.
- **Stripe and payment processing are deferred to a separate future project.**
  Entitlements stay billing-independent: a feature asks what an account is
  entitled to, never whether it paid.

**Phase 2 — done** (`80da10b`, deployed and verified; see its own section). It
removed the 50-user platform cap and the "first 50 users" copy, and fixed the
capacity configuration bug described below, so that
`EARLY_ACCESS_USER_LIMIT=0` genuinely means unlimited: today it is read through
the shared `num()` helper, which rejects any value `<= 0`, warns and returns the
default — so setting `0` in Render silently leaves the cap at 50, while
`src/lib/db/capacity.ts` and the comment on `capacity.limit` both treat `0` as
unlimited. Prefer capacity-specific parsing or handling; do **not** change
`num()`'s behaviour globally unless that can be proven safe for every other
caller (pool sizes, TTLs, password bounds, timeouts, AI limits), where `0` is
genuinely invalid and the fallback is the safety net.

## Phase 3 — Admin → Users modernized (PRODUCTION DEPLOYED · VERIFIED)

Admin → Users described the product as it was a month ago: it counted Goals and
Weekly Reviews, and its "Habits" column counted every habit row — candidates,
paused and retired included — so an account with three habits on its sheet could
read as ten. It is now grouped the way the product is, and it shows counts and
statuses only.

| Item | State |
| --- | --- |
| deployed commit | `bf2d13c1927f662906982a22b7f3fb343a0b93b1`, fast-forwarded onto `main` from `fa8be5f` |
| release path | IMPLEMENTED → COMMITTED → PUSHED → DEPLOYED → **PRODUCTION VERIFIED** (Product Owner, 2026-09-19 — desktop and mobile both visually checked in production) |
| mobile / narrow-card QA | **PASS** (Product Owner, 2026-09-19). The card layout below 760px of list width was verified in production and reads well |
| desktop groups | ACCOUNT (user, status, role, plan, joined, verified, last active, active days, sessions) · RICH HABITS (active habits, completions) · PRIORITY COMPASS (priorities, with a muted count of those still open, accomplishments) · COMMUNITY (rank, %) · CLARIFY INTENTION (status) · PLANNING (Important Dates) |
| removed | **Goals and Reviews**, from the row type, the query and both screens |
| Active Habits | now `status = 'active'` — the old column counted every habit row |
| priorities | total, open and accomplishments come from one pass over the table, so they cannot disagree; accomplishments use the same `completed_on` rule Insights and Community count by |
| intention | a status from the `intention_started` / `intention_completed` event names. The `intentions` table, which holds what the person wrote, is not read at all |
| Community rank / % | read from the existing month-to-date board through `communityStandings`, a synchronous accessor that contains no `computeAll`, `refreshStale`, `scoreMember`, `loadState`, `query` or `await`, and mutates nothing — not even other readers' stale marks. A cold or expired cache yields null and every row shows a dash rather than a manufactured rank. Two states only, `ranked` and `none`; an absent member is simply absent, because an opted-out member is dropped before the board exists and calling that "hidden" would assert a private preference from missing data |
| `adminUserIds` | no longer pages the full listing query to collect ids. One extracted filter builder is shared by the listing, the count and the id query, so the three cannot disagree about which accounts a filter matches; parity is asserted across twelve filter combinations and a disabled-account transition |
| Plan | presentation only — `Admin` for administrators, `Free` for everyone else, read from `users.role`. No entitlement store, no database, no environment; a test asserts `plan.ts` references no `user_plans`, `priority_quota_usage`, `ai_usage`, Stripe or subscription, and reads neither database nor environment |
| migration | **none.** No schema change, no data write, no configuration change |

**Local verification before release:** typecheck clean, lint clean, **1079 of
1079** unit tests across 61 files (34 new: 21 admin metrics/privacy, 13 Community
standings), production build compiled with 64/64 pages.

**Privacy is enforced by a recorder, not a promise.** `tests/admin-users.test.ts`
captures every statement these screens run — across all filter permutations and
all nine sorts — and fails if one names a private column, a private table, an
`ai_*` identifier or a star select, now including `analytics_events.properties`
and `day_notes.gratitude`. Text planted in habits, priorities, intentions, goals,
reviews, reflections, day notes and event properties appears in no payload. That
detector caught one of its own false positives during this work — it was reading
prose inside a SQL comment — so it now strips comments and carries negative
controls proving a real leak beside or after a comment is still caught.

**Production verification, 2026-09-19 22:05 UTC, read-only**

| Check | Result |
| --- | --- |
| serving `bf2d13c` | **yes** — all seven Phase 3 CSS classes present in the served stylesheet, including `@container (min-width: 760px)` and the sticky `.au-user`; `.chip` as the control proves the probe reads the CSS |
| desktop visual QA | **PASS** (Product Owner): grouped headers, ACCOUNT / RICH HABITS / PRIORITY COMPASS groups rendering, Plan showing Admin / Free, Active Habits replacing Habits, Completions replacing Done, the muted open-priority count beneath the total, Goals and Reviews gone, aligned numerics, horizontal layout preserved rather than crushed |
| mobile visual QA | **PASS** (Product Owner): the narrow-width card layout was checked in production and reads well |
| accounts | **15**, unchanged — 5 admin, 0 disabled, 2 verified. **0 created** |
| verification stamping | unchanged: 1 requires verification, 14 grandfathered — new-account verification still applies to new accounts only |
| schema | **37 tables**, unchanged; no column added, removed or altered |
| production content data | **not modified by the deployment.** habits 172, habit_completions 128, priorities 86, goals 45, intentions 2, day_notes 9, user_preferences 15, habit_schedules 177, profiles 15, community_month_scores 10, email_verifications 2, password_resets 1, coach_requests 2 — all unchanged |
| Community recomputation | **none.** `community_month_scores` gained 0 rows, so no board was computed or archived by the admin screen |
| auth, verification, recovery | unaffected: 0 password-reset rows, 0 verification rows; `/api/admin/users` and `/api/admin/users/bulk` answer **404** to a signed-out caller (they must not announce themselves), consumer APIs 401, public pages 200 |
| bundle privacy | no `CLAUDE_API_KEY`, `GEMINI_API_KEY`, `sk-ant-`, provider host, connection string, `password_hash`, `ownership_note` or `why_chain` in any served bundle |
| Phase 4 | no `user_plans`, `priority_quota_usage`, `ai_usage`, subscription or Stripe table exists |
| incidental rows | 2 `important_dates`, 3 `important_date_saved` events, 2 `app_opened` events and 1 session — **all belonging to one admin account** (`2b2a9237…`, handle `hippo`) at 21:32 UTC while inspecting production. Ordinary product use, not caused by the deployment |

**Known non-defect.** The Product Owner's screenshot showed through Priority
Compass only; Community, Clarify Intention and Planning were horizontally
off-screen. That is the intended behaviour — the table scrolls rather than
crushing columns.

## Phase 2 — early-access account cap removed (PRODUCTION DEPLOYED · VERIFIED)

Sign-up is open. `EARLY_ACCESS_USER_LIMIT` now defaults to `0`, meaning no limit,
and production has it set to `0` explicitly.

**The cap could not be switched off before.** `capacity.limit` was read through
the shared `num()` helper, which rejects anything `<= 0` and falls back — so
`EARLY_ACCESS_USER_LIMIT=0` quietly meant *fifty*, while `capacity.ts`, its own
comment and all four enforcement sites already treated `0` as unlimited. The
infrastructure was right; the parser and the default were wrong.

| Item | State |
| --- | --- |
| deployed commit | `80da10b0060e9f6f02e434baecf23245cce44cbb`, fast-forwarded onto `main` from `1d3997d` |
| release path | IMPLEMENTED → COMMITTED → PUSHED → DEPLOYED → **PRODUCTION VERIFIED** (2026-09-19) |
| Render configuration | `EARLY_ACCESS_USER_LIMIT=0`, set by the Product Owner; that change triggered a second successful deploy of the same commit. No other variable changed |
| new parsing | its own small parser, not the shared one: unset or empty → 0 · `0` → unlimited · a positive whole number → enforced · negative, fractional or not a number → unlimited with one warning naming the value |
| invalid values | **fail open**, deliberately: a cap is a restriction, and a typo must not close the door on everyone. Falling back to a number is what caused the original bug |
| `num()` | **left exactly as it was.** For all 26 of its other callers — pool sizes, TTLs, timeouts, password bounds, attempt counts, token budgets, AI allowances — `0` is nonsense or a footgun and the fallback is the safety net. A test asserts `num()` still refuses `0` *and* that capacity no longer routes through it |
| `capacity.limit` | now a getter, read where it is used rather than frozen at import. Nothing spreads or destructures the `capacity` object, so all five reads go through it |
| what was **not** deleted | `OCCUPIES_A_SLOT`, `AWAITING_VERIFICATION`, `currentCapacity`, `withCapacityLock`, `withReservedSlot`, `withCapacityFor`, `withRoleLock`, the single `CAPACITY_LOCK` advisory lock, sign-up's `409 {full:true}`, the `"full"` outcome when a verification link is redeemed, all four admin refusals and both last-admin protections. Each short-circuits while the limit is `0`; setting a positive number restores enforcement with no code change |
| migration | **none.** No schema change, no data write, no backfill |
| authentication | untouched. Mandatory verification for new accounts, password recovery and existing-account grandfathering all unchanged — the only change under `src/app/api/auth/` is one comment |

**Copy removed, in both languages.** The early-access notice, the paused-sign-up
message, the terms facts, four admin role dialogs and one admin refusal no longer
claim a 50-account limit; the copy names no number, because the number is
configuration. Negative guards in the tests fail if a "first 50" claim returns.
No paid-plan messaging replaced it. The admin capacity panel needed no change: it
already rendered "no limit set" when the limit is `0`.

**Local verification:** typecheck clean, lint clean, **1045 of 1045** unit tests
across 59 files (28 capacity tests, including unset / `0` / positive / negative /
fractional / non-numeric and the `num()`-unchanged guard, plus seven asserting
the cap machinery survives), production build compiled with 64/64 pages.

**Production verification, 2026-09-19 20:50–20:51 UTC, read-only**

| Check | Result |
| --- | --- |
| serving `80da10b` | **yes** — self-validating bundle probe: all four new strings present (`free while it is in early access`, `Sign-ups are paused`, 早期体验阶段免费开放使用, 注册暂时关闭), the Phase 1B control string present, and **every** old 50-cap claim absent in both languages. No "50" claim remains anywhere in the served copy |
| application health | `/`, `/login`, `/terms`, `/verify`, `/reset` all 200; `/habits`, `/insights`, `/admin` redirect a signed-out visitor; `POST /api/coach` and `/api/recommendations` 401; no 5xx |
| capacity reported as unlimited | the deployed commit defaults to `0`, its parser maps `0` to unlimited (28 tests), and Render holds `EARLY_ACCESS_USER_LIMIT=0`. **Not observable from outside**: at 10 of 50 places used, a capped and an uncapped production behave identically, and the panel that prints "no limit set" is admin-only. Admin → Users should read "Users: 10 · no limit set" |
| accounts | **15**, unchanged — 5 admin, 10 member, 0 disabled, 2 verified. **0 created** during Phase 2 |
| verification stamping | unchanged: **1** account requires verification (stamped at sign-up), **14** grandfathered. Mandatory verification still applies to new accounts only |
| grandfathering, live | the throwaway account — `verification_required=false`, address never verified, created 2026-09-17 — **signed in with 200**, so a pre-verification account still works |
| password recovery | `/api/auth/forgot` answered 200 for a deliberate non-account and wrote **nothing**: `password_resets` still holds exactly 1 row, 0 created during Phase 2, and no mail could be sent to an address that owns no account. `/reset` still served |
| schema | **37 tables**, unchanged; no column added, removed or altered; `coach_requests` still exactly `id, user_id, occurred_at` with its index and cascade |
| existing application data | **nothing created or modified**: habits 172, habit_completions 128, priorities 86, goals 45, intentions 2, important_dates 26, day_notes 9, user_preferences 15, habit_schedules 177, profiles 15, community_month_scores 10, email_verifications 2 |
| `coach_requests` | still the 2 Phase 1B smoke rows, one account |
| rows that did appear | fully accounted for: **1** session (my own sign-in probe at 20:50:29) and **2** `app_opened` events from one admin account browsing. Nothing else |

**Phase 3 — done** (`bf2d13c`, deployed and desktop-verified; see its own
section). Entitlements, Grandfathered Pro, Free-plan enforcement, AI allowances
and Stripe all remain later phases; Stripe stays deferred to a separate future
project.

## Phase 1B — consumer AI on Claude (PRODUCTION DEPLOYED · VERIFIED)

The AI coach and the AI habit recommendations were written against OpenAI in the
app's first commit, a month before RichHabit had a provider architecture, and were
never revisited when Claude arrived. **Neither had ever run in production**: no
`OPENAI_API_KEY` was configured, so both answered 501 from the day they shipped.
Both now reach Claude, and OpenAI is gone from the application entirely.

| Item | State |
| --- | --- |
| deployed commit | `9fa4684e15eb66bf090ca41e07b3b9719f4fd33c`, fast-forwarded onto `main` from `b903dd7`, deployed on Render by the Product Owner |
| AI Coach | **migrated OpenAI → Claude**, `claude-sonnet-5` by default (`COACH_MODEL` overrides) |
| AI habit recommendations | **migrated OpenAI → Claude**, same model and configuration |
| provider seam | the lightweight consumer abstraction `src/lib/ai/provider.ts`, which gained one capability, `generateText`, for prose. Recommendations reuse the existing `generateStructured` through a forced tool call |
| AI Workspace | **untouched** — not in the diff; its runtime and provider boundary are intact, and a guard test still pins the Anthropic SDK to `src/lib/ai/claude.ts` alone |
| OpenAI runtime dependency | **removed entirely**: the SDK dependency, `OPENAI_API_KEY`, `OPENAI_MODEL`, and the `.env.example`, `render.yaml` and README references. 0 lockfile entries, not resolvable from `node_modules`. `tests/no-openai.test.ts` fails if any of it returns |
| `render.yaml` | now declares `CLAUDE_API_KEY` and `GEMINI_API_KEY` (both `sync: false`) instead of `OPENAI_API_KEY` — blueprint only; **no dashboard secret was created, changed, rotated or read** |
| Coach durable safety limit | **unchanged at 20 an hour and 50 a day per account**, still counted in `coach_requests`, still provider-independent, still charged *before* the provider call (route order: resolve credential → charge → call Claude) |
| habit recommendations limit | **none, deliberately.** They must not borrow `coach_requests`: the two are different features and one must not spend the other's allowance. What bounds them today is the work they need — a model is only called when behaviours are awaiting a decision with no proposal yet. Whether they get their own allowance is a **Phase 6** decision, recorded in `src/lib/recommend.ts` |
| migration | **none.** No schema change; `coach_requests` was already in production from Phase 1 |
| Render environment | **no variable changed or added** |
| provider errors | no provider message can reach the browser any more (`AskCoach` renders `error.message` directly, and the old route passed OpenAI's text into it). Every failure answers with the app's own bilingual copy; logs carry a status code only |
| bug fixed | pre-existing: `/api/recommendations` returned its 501 with `NextResponse.json` from inside the `withUser` callback, which `withUser` then serialised into a **200** whose body was a response object. It throws `ApiError` now. The only site with that pattern |

**Local verification before release:** typecheck clean, lint clean (✔ no warnings
or errors), **1032 of 1032** unit tests across 59 files (31 new: 5 for the Claude
text capability, 10 for recommendations, 8 for OpenAI's absence, and the Coach
route suite grown from 9 to 17), production build compiled with 64/64 pages. The
client-bundle scan found no credential name, `sk-ant-`, provider host or
server-only module in any of 56 files.

**Production smoke test, 2026-09-19, throwaway account only.** The Product
Owner's own account was deliberately not used, so provider and context
verification stayed isolated from real personal data.

| Check | Result |
| --- | --- |
| served commit verified before any provider call | self-validating bundle probe: the Phase 1 control string present, and both new Phase 1B strings (English and 中文) present |
| `claude-sonnet-5` against the production credential | **works** — the open question from the design review is now closed |
| one English Coach question | **200 in 7.6s**, 1036 characters, English only |
| grounded in the intended context only | **yes** — quoted that account's real state (0% completion, 10 starter habits marked "new", 3 goals, 3 active days in a 90-day window, "Plan today's priorities" tied to its Career growth goal) and explicitly refused to claim a trend: *"This isn't a trend, it's a startup."* None of the other 14 accounts' names appeared; no address and no key in the answer |
| one 中文 Coach question | **200 in 7.8s**, Chinese (234 CJK characters to 53 Latin, the Latin being field names quoted from the snapshot), grounded in the same account |
| `coach_requests` after both | **exactly 2 rows, both the throwaway account**, 0 for every other account — one distinct user id in the table |
| what the rows hold | only `id`, `user_id`, `occurred_at`; 203 bytes for both rows; no question, answer or provider text |
| analytics | `{"locale":"en","questionLength":33}` and `{"locale":"zh","questionLength":11}` — counts and locale only, no text |
| habit recommendations, live | **deferred.** That account has 10 `active` habits and **0 candidate** behaviours, so the route returns `{proposals: 0, reason: "nothing_to_propose"}` without calling a model. Forcing it would have meant manufacturing production data, which was prohibited. Covered by 10 unit tests instead |
| Clarify Intention AI, live | **deferred** for the same reason: that account has no intention, so the route answers 400 before any model call, and creating one would have written production content. Covered by 29 unit tests; the credential and seam it uses are proven working by the Coach calls |
| AI Workspace (Claude, Gemini, image generation) | **verified by existing means, not re-run live.** The throwaway account is not an admin, so every workspace route answers 404 for it, and the owner's account was off limits. Evidence: those files are absent from the Phase 1B diff; their suites pass within the 1032; and production history already holds 5 `anthropic/claude-sonnet-5` replies and 3 `google/gemini-3.1-flash-image` replies |

**Final read-only production audit, 2026-09-19 19:58 UTC**

| Check | Result |
| --- | --- |
| deployed commit | `9fa4684` confirmed serving |
| application health | `/`, `/login`, `/terms`, `/verify`, `/reset` all 200; `POST /api/coach` and `POST /api/recommendations` answer 401 signed out, *before* the limiter, so an unauthenticated probe consumes no allowance |
| accounts | **15**, unchanged (5 admin, 10 non-admin, 0 disabled, 2 verified, 1 requiring verification); **0 accounts created** during the rollout |
| schema | **37 tables**, unchanged; no column added, removed or altered anywhere |
| existing application data | **nothing created or modified** in habits (172), habit_completions (128), priorities (86), goals (45), intentions (2), important_dates (26), day_notes (9), user_preferences (15), habit_schedules (177), profiles (15), community_month_scores (10), password_resets (1) or email_verifications (2) |
| rows that did appear | fully accounted for: `coach_requests` +2 (the two smoke calls), `sessions` +3 and `user_sessions` +2 and `analytics_events` +6 — of which 2 are the smoke events and the rest is one admin account browsing (`app_opened` only, zero writes, zero coach rows) |
| OpenAI | not required by the deployed application; no trace in any served bundle |
| credentials | no `CLAUDE_API_KEY`, `GEMINI_API_KEY`, `sk-ant-` or provider host in any served bundle; **no key value was ever printed or committed** |
| `EARLY_ACCESS_USER_LIMIT` | unchanged by Phase 1B; the 50-user cap was still active then. Phase 2 set it to `0` |
| entitlements and payments | no `user_plans`, `priority_quota_usage`, `ai_usage`, or any Stripe table exists. No entitlement or payment work occurred |

**Phase 2 — NOT started.** Removing the 50-user platform cap and the "first 50
users" copy, and fixing capacity configuration so `EARLY_ACCESS_USER_LIMIT=0`
genuinely means unlimited (see the Phase 1 section for why it silently does not
today). Stripe and payments remain deferred to a separate future project.

## Public front page

`/` used to redirect to `/habits`, so a visitor without an account bounced
through the app and landed on the sign-in form with nothing explaining what
they had arrived at. It is now a page: one statement, one supporting line, two
buttons.

| Item | State |
| --- | --- |
| branch | `feature/landing-page`, from `main` `5eb1a92`, worktree `~/dev/rich-habits-landing` |
| committed / pushed | `3037cc5` the page, `fe06524` the four marks removed, `83e7ebb` the language default; pushed to `origin/feature/landing-page` |
| schema / migration / env / dependencies | **none**; nothing under `db/`, `scripts/`, `render.yaml`, `package*.json` or `.env.example` changed |
| release state | **IMPLEMENTED** → **PUSHED TO MAIN** (`83e7ebb`, fast-forward, no merge commit, no history rewritten) → **DEPLOYED** (Render, triggered by the Product Owner, live ~5 minutes later) → **PRODUCTION VERIFIED** |
| the page | brand (plus 养成富有的习惯 outside English) and the existing EN/中文/双语 switch; the statement "Turn what matters into what you do."; one supporting line; Sign Up (primary) and Log In; one unlabelled four-mark figure. No feature grid, pricing, testimonials or imagery |
| copy | `en.landing` / `zh.landing`, written as two deliberate lines each — at 68px the line break is the design, and Chinese breaks at its comma |
| bilingual | typeset, not concatenated: English statement at full size, Chinese beneath at .46em and quieter; the two buttons do use the joined labels ("Sign Up · 注册") |
| language | English by default, deterministically: `resolveLocale` reads only the reader's own explicit choice and `getLocale` no longer consults the request's Accept-Language, so nothing is inferred from browser, operating system or region. A choice of EN / 中文 / 双语 is remembered in the `rh_locale` cookie, and for a signed-in account in `user_preferences.locale`, which the app shell adopts on load. One mechanism, unchanged |
| authentication | unchanged. Sign Up → `/login?mode=signup`, Log In → `/login`; `?mode=` only chooses which form the existing screen opens on (`initialLoginMode`), and every account is still created and signed in by the existing routes. A visitor with a valid session at `/` still goes to `/habits`, checked against the session row |
| routing | `/` is public by an exact match in middleware — every path starts with "/", so a prefix entry would have made the whole application public. `/habits` and the rest are still closed to a signed-out visitor |
| verification | typecheck, lint, 927/927 unit tests (20 new), production build, 43/43 local browser checks (desktop 1440 and phone 390 in all three languages, tablet-width reflow, reduced motion, registration and sign-in through both buttons, signed-in redirect, the language default and every saved choice on a Chinese device, no sideways scrolling, no page errors) |
| production verification | 2026-09-17, https://richhabit.onrender.com, 21/21: production assets byte-identical to the local `83e7ebb` build; `/` answers 200 with the landing page instead of redirecting to `/login`; a first-time visitor on a Chinese device gets English; 中文, 双语 and English each switch and persist across a reload; Sign Up registered a real account and signed it in; Log In signed that account in from a fresh browser; an authenticated `/` lands on `/habits`; seven protected routes still redirect a signed-out visitor to `/login`; the phone layout renders with two full-width buttons and no sideways scrolling; no browser errors, no failed requests, server healthy |
| production data | one test account created by the smoke test — `rhsmoke64t0ru` — with the starter set every new account is seeded with (10 habits and their schedules, 3 goals, one preferences row). A read-only check after the test confirms exactly one account created in the previous 30 minutes and none other; no existing row was changed or deleted, and no migration was run |
| next step | delete the `rhsmoke64t0ru` test account from Admin → Users if you would rather not keep it (it occupies one of the fifty early-access places) |

## AI Workspace: general-purpose assistant, multiple models, image generation

A product correction on top of the released chatbot. RichHabit is the host
(sign-in, admin role, hosting, interface, security boundary); the workspace is a
general-purpose assistant, not a habit coach, and still reads no RichHabit
personal data.

| Item | State |
| --- | --- |
| branch | `feature/ai-workspace-models`, from `feature/ai-workspace` (`1e5e04a`), same worktree |
| committed / pushed | feature `0f02a6e`; merge of `feature/ai-workspace` `c6d2c9d` (brings in `1375082f` once, by merge); release-candidate status in the commit that updates this row; all pushed to `origin/feature/ai-workspace-models` |
| schema / migration | **none**: replies already store `provider` and `model`; pictures are `ai_files` rows carried by the reply through `ai_message_files`. No change under `db/`, `scripts/`, `render.yaml` or dependencies between `f7499fc` and the release candidate |
| merged into `main` | **no** (Product Owner action) |
| deployed | **no**; production still runs `f7499fc` (Claude only). Render already has `GEMINI_API_KEY` (added by the Product Owner) |

**What changed**

- System instruction: "a general-purpose AI assistant, available to the admin
  through their private AI Workspace"; hosted in RichHabit but not a habit coach;
  no RichHabit data; told honestly whether image generation is on.
- `models.ts` (models and capabilities: text, documents, image generation;
  image editing, web research, video and tools named as future) and `routing.ts`
  (deterministic capability router: a small English/Chinese grammar for explicit
  picture requests, with guards for questions, prompts, code and diagrams).
- `provider.ts`: chat and image provider seams and a catalogue of configured
  models only. `src/lib/ai/gemini.ts`: the one file that talks to Google; stateless
  `generateContent` (streamed text; Nano Banana with `imageConfig`), files inline,
  nothing stored at Google, errors reduced to codes. Claude unchanged.
- Models, verified against Google's docs and this key's model list on
  2026-09-13: `gemini-3.8-flash` (stable Flash) for conversation,
  `gemini-3.1-flash-image` (Nano Banana 2, Google's recommended default) for
  pictures at 1K; `gemini-3-pro-image` is the configurable higher-quality option.
  Config: `GEMINI_API_KEY` (server only), `AI_WORKSPACE_GEMINI_MODEL`,
  `AI_WORKSPACE_IMAGE_MODEL`, `AI_WORKSPACE_IMAGE_SIZE`.
- Interface: a quiet model selector in the composer (only when more than one
  conversational model is configured), a model tag on each reply, generated
  pictures inline (max 440 px on desktop, full column on phones, open full size),
  "Creating image…", no Continue on a picture (Retry makes a new one), an image
  suggestion in the empty state, English and Chinese.
- Upload notice version 2 names Google as well as Anthropic; every admin accepts
  it again before their next upload.
- A picture is stored like an upload: owner-scoped, counted against the 100 MB
  quota (refused up front when under 2 MB remain), served only to its owner,
  tombstoned when deleted, removed with its conversation, named in later history
  as `[Generated image: …]`. Production database was 10 MB on 2026-09-13.
- Bug fixed (pre-existing): a message and its reply sharing a timestamp could
  list in random order; ties now always put the admin's message first. Found as a
  flaky route test; PGlite's clock is millisecond-precise (170 of 200 ties).

**Verification, 2026-09-13 (local)**

| Check | Result |
| --- | --- |
| typecheck, lint, production build | clean; no key name or Google address in client bundles |
| full unit suite | 838 of 838 (new: routing 51, Gemini adapter 10, models/image routes 11 including the screenshot's prompt in English and Chinese, plus runtime and ordering tests) |
| earlier browser suite, scripted providers | 91 of 91, re-run on the final code |
| models and image browser suite, scripted providers | 54 of 54: selector lists only configured chat models; Gemini/Claude switching with history; model persists after reload; EN and ZH hippo render an actual picture that survives refresh; Creating image…, Stop, Retry, refusal; picture owner-only (other admin, member, signed out 404); upload notice names Google; 1440/390/320 px without overflow; no prompt or image data in the server log; no provider request or key in the browser; no analytics |
| live, real Claude + real Gemini (first run) | 15 of 19. Passed: Gemini streaming with usage, general question, multi-turn without thought signatures, switch to Claude on the same history, model remembered, Stop and Continue on Gemini, no stored Google file copy, routing of both hippo prompts to Nano Banana 2, no keys/prompts/image data in the server log. Failed with `rate_limited`: both real hippo images (Google free tier allows 0 image requests: `generate_content_free_tier_requests, limit: 0` for every Nano Banana model) and, after ~10 rapid calls, a Gemini PDF read and a Chinese reply (free-tier per-minute limit) |
| live, spaced re-run | 4 of 4: Gemini reads an attached PDF inline; a Chinese question gets a Chinese answer; no keys or prompt text in the server log. A further real image attempt still failed `rate_limited` (quota 0) |
| live, after billing reached the key's project (2026-09-13, before an earlier re-run still showed the free-tier quota) | **23 of 23**. `gemini-3.1-flash-image` generated real JPEG pictures for both "Can you generate a cartoon image of a hippopotamus?" (9.7 s) and "帮我生成一张可爱的河马卡通图片" (8.3 s), stored and still present after a reload; no `generate_content_free_tier_requests limit: 0` error; Gemini text, multi-turn, Claude switching, Stop/Continue, inline PDF and Chinese all pass; no key, prompt, reply or image data in the server log |
| post-merge (`c6d2c9d`) | typecheck and lint clean; unit 838 of 838; production build compiles with no key names, keys, provider addresses or database URLs in client bundles; browser suites 91 of 91 and 54 of 54; `1375082f` an ancestor, present once |
| production database, read-only after the merge | seven `ai_` tables present; RichHabit counts unchanged (users 13, habits 149, completions 78, priorities 46, goals 39, intentions 1, dates 7); drift index untouched; migration not re-run |

**Tightening before the final live test: provider errors and natural image requests**

- `providerErrors.ts` normalizes Anthropic and Google errors in one place:
  temporary rate limit, quota or billing unavailable (a quota of 0, billing not
  enabled, no credit), provider outage (5xx), provider configuration (bad key,
  permission, unknown model), timeout, too long, unreadable file, generic
  failure. A safety refusal stays a completed reply with stop reason `refusal`.
  The provider's message is read only to classify and then dropped.
- Stored with no schema change: the error code stays within the existing
  constraint (`provider_error` for quota and configuration) and the detail
  (`quota_unavailable`, `provider_config`) goes in the failed reply's
  `stop_reason`.
- The admin sees plain wording, image-specific for pictures, in English and
  Chinese, e.g. "Image generation isn't available for the current Google AI
  configuration." / "当前 Google AI 配置暂时无法使用图片生成功能。" and "Image
  generation is temporarily rate-limited. Please try again shortly." /
  "图片生成暂时受到频率限制，请稍后再试。" No billing, quota, project or key
  detail is shown.
- Logs: `[ai-workspace] reply failed provider=<id> capability=<text|image_generation> status=<4xx|5xx|none> code=<normalized>`
  and nothing else; never prompts, replies, images or provider words.
- Image-request routing is a compact English/Chinese parser: an image object
  plus a creation verb, a request ("please", 帮我/给我/来一张) or a bare short noun
  phrase ("hippo picture", 河马图片), or a drawing verb with an object ("draw me a
  hippo", 画一只河马); excluded when the message describes, explains or edits an
  image, asks for prompts or wording, code, diagrams or charts, is a question,
  talks about image tools, or refers to an existing image. A bare caption with
  a file attached stays with conversation. Ambiguous messages go to the selected
  conversational model.
- Model selection is unchanged: the selector chooses the conversational model;
  a picture request goes to the image model whichever is selected, and does not
  change the conversation's model.
- Generated-image persistence re-checked by tests: owner-scoped, survives
  refresh, identical pictures stored and counted once, no provider file copies,
  a picture that no longer fits the quota is not kept (the reply says so),
  removed with its conversation and with a permanently deleted project, not
  fetchable by another account, no provider URL or token exposed.

**Evidence, kept separate**

| Area | State |
| --- | --- |
| implementation tests (controlled and scripted providers) | **pass**: typecheck, lint, production build (no secrets in client bundles), unit 907 of 907 (routing 87, provider errors 21, models/image routes 23); browser regression 91 of 91; models and image browser suite 75 of 75 (natural English and Chinese phrasing, Gemini and Claude selection semantics, quota/rate-limit/configuration messages in both languages and after refresh, no provider wording shown, privacy). The extended suite ran with a raised test-only reply limit (`AI_WORKSPACE_HOURLY_LIMIT`), because its first run correctly hit the default 20 replies an hour |
| real Gemini chat | **pass** (live run on `e808b03`; the request path is unchanged by this tightening) |
| real Gemini image generation | **REAL GEMINI IMAGE GENERATION: PASS** — final acceptance on commit `74d2eb3` (2026-09-13), in a real browser against a local instance with the real Google and Anthropic keys, after the Product Owner confirmed Google AI Studio Tier 1 with paid API spend. Details below |

**Final real acceptance, commit `74d2eb3` (2026-09-13): PASS**

| Check | English: "Can you generate a cartoon image of a hippopotamus?" | Chinese: "帮我生成一张可爱的河马卡通图片" |
| --- | --- | --- |
| model that received the request | `gemini-3.1-flash-image` (Google) | `gemini-3.1-flash-image` (Google) |
| Google returned a real image | **pass**: reply complete, no error; 1,471 output tokens; 6.4 s at the model | **pass**: reply complete, no error; 1,497 output tokens; 9.5 s at the model |
| stored picture | 984 KB JPEG, owned by the admin, carried by the reply | 942 KB JPEG, owned by the admin, carried by the reply |
| rendered in the AI Workspace conversation | **pass**, labelled Nano Banana 2, from the owner-only file route | **pass**, same |
| same picture after a page refresh | **pass** | **pass** |
| free-tier `generate_content_free_tier_requests limit: 0` error | gone | gone |
| picture without the admin's session | refused (404) | refused (404) |

Privacy scans passed: the server log, the page DOM, the conversation API, the
scripts the browser loaded and the production build contain no API key or key
name, no prompt text in logs or code, no generated image data, no billing
details, no Google quota internals, no Google project id and no provider URL;
the browser never contacted Google or Anthropic. The automated scan's three
loose flags were traced to exact matches and are not leaks: "suspend"/"spending"
(React and RichHabit's Spending feature), the `quota_unavailable` message key,
the workspace's own `projectId`, and 1-pixel placeholders in the development
framework runtime (absent from the production build).

No code changes, no database or migration changes, no production access, and no
deploy were involved in this acceptance.

**Required before release (Product Owner)**

1. ~~Enable billing on the Google project behind `GEMINI_API_KEY`.~~ **Done**
   (Product Owner, 2026-09-13).
2. ~~Add `GEMINI_API_KEY` to Render's environment.~~ **Done** (Product Owner,
   2026-09-13).
3. ~~Re-run the live check and confirm both hippo prompts store a real image.~~
   **Done**: 23 of 23.
4. ~~Bring in `1375082f61fffff704d8445344860f5c086156fd` from
   `feature/ai-workspace`.~~ **Done** by merge `c6d2c9d` (not cherry-picked);
   `git merge-base --is-ancestor 1375082f HEAD` succeeds and the commit appears
   once.
5. ~~Confirm Google billing and run the two final real acceptance tests.~~
   **Done**: Tier 1 with paid spend confirmed by the Product Owner; both hippo
   prompts PASS on `74d2eb3`.
6. **Remaining (Product Owner):** fast-forward `main` to the final
   release-candidate commit of `feature/ai-workspace-models` and deploy it on
   Render. No database step; `GEMINI_API_KEY` is already set in Render. Then run
   the production smoke test: Claude chat, Gemini chat, the model selector,
   English and Chinese hippo pictures that persist after refresh, an ordinary
   account with no access, and the privacy checks.

**Known limits and risks**

- Picture-request routing is deliberately conservative: phrasing outside its
  rules goes to the conversational model, which is told it can suggest
  "Create an image of …". Mixed-language sentences are judged per clause.
- Image editing of earlier pictures is future; pictures attached to the same
  message are sent as references.
- Google's terms for the unpaid Gemini API tier allow using submitted content to
  improve Google's products; verify the current terms, and prefer a billed
  project before sending private material.
- Earlier limits still apply: one Render instance; no malware scan; Anthropic
  copies not deleted remotely on account deletion.

## AI Workspace V1 — Image Understanding: VERIFIED

An existing, verified capability of the released AI Workspace (`f7499fc`), not
new work. Full reference: `docs/architecture/AI_Workspace_V1_Image_Understanding.md`.
Documentation only: no application code, schema, migration, configuration or
production change, and nothing deployed.

**Supported now:** PNG, JPEG, GIF and WebP; a 5 MB application image limit;
server-side magic-byte type detection; storage in Postgres; SHA-256
de-duplication; one Anthropic Files API upload per image, reused afterwards;
Claude vision through native `image` content blocks; a base64 `image` block
fallback if the provider upload fails; object and scene understanding; reading
text directly from images; upload-disclosure enforcement; admin-only access; no
image, prompt or key contents in application logs.

**Limitations:** BMP is not supported; animated GIFs are understood from the
first frame only; images are not resized before being sent to Claude; the
RichHabit limit is 5 MB although Anthropic accepts more (10 MB); large images
can consume materially more input tokens.

**Evidence, 2026-09-13 (local, real Claude, throwaway database):**

| Check | Result |
| --- | --- |
| live Claude image checks against `f7499fc` | 30 of 30 passed |
| V1 image-path unit tests | 46 of 46 passed |
| PNG and JPEG, end to end | objects described (3/3 each), text read (2/2 each), Files API copy made and reused |
| GIF and WebP | additionally verified: uploaded, typed from bytes, objects described, text read |
| validation | 5.3 MB PNG refused (413); BMP and binary junk refused (415); text renamed `.png` stored as text; upload refused before the notice (409) |
| logs | no key, prompt, reply, image text or image bytes |
| production code | unchanged |

## AI Workspace chatbot (admin only): phases 1 and 2

Approved design: proposal revision 3 (seven tables, explicit reply lineage,
`ai_message_files`, versioned upload disclosure). Phase 2 built the chatbot on
the phase 1 schema and data layer without changing either.

| Item | State |
| --- | --- |
| branch | `feature/ai-workspace`, from `f0a8e28`, in the worktree `~/dev/rich-habits-ai-workspace` outside OneDrive |
| phase 1 commit | `7fcf53a` schema, migration step 8 and data layer (15 files) |
| phase 2 commit | `0236d45ab5bc67f857732bb1abb8de32352a790c` chatbot: routes, provider, interface, tests (44 files); no schema or migration change |
| status commits | `PROJECT_STATUS.md` only, separate from the feature commits |
| pushed | `origin/feature/ai-workspace` at `0236d45` before this status commit |
| production migration | **applied 2026-09-13 15:21 UTC and verified, 24 of 24** (below) |
| merged into `main` | **yes**: `main` fast-forwarded from `f0a8e28` to `f7499fca52bca2bfebc75faca4b3a505e6a18830` on 2026-09-13 (pushed by the Product Owner) |
| deployed | **yes**: `f7499fc` deployed to Render by the Product Owner on 2026-09-13, after two earlier deploys ran before `main` moved and still served `dd7bec0`. Code is identical to the tested branch head `d51f2a1`; only `PROJECT_STATUS.md` differs. |
| production verified (public) | **21 of 21**, below |
| production verified (signed in) | **passed**, Product Owner smoke test on 2026-09-13, below |
| release | **closed** |

**Product Owner signed-in production smoke test on `f7499fc`, 2026-09-13: all passed**

| Check | Result |
| --- | --- |
| admin desktop: launcher opens the workspace | pass |
| streaming reply | pass |
| Stop, Continue, Retry | pass |
| conversation persistence after reload | pass |
| project and project instructions | pass |
| PDF upload: disclosure first, then question answered | pass |
| Chinese question gets a Chinese reply | pass |
| admin phone UX | pass |
| ordinary account has no launcher | pass |

Existing RichHabit user data was verified intact by the read-only check after
deploy. The production migration was not re-run. Known limits are unchanged and
listed below.

**Production verification after deploying `f7499fc`, 2026-09-13: 21 of 21 public checks, plus a read-only database check**

| Check | Result |
| --- | --- |
| build identity | GitHub `main` = `f7499fc`; production serves stylesheets `acf9366ad5034582` and `407913228fec5345` and chunks `3629-a7361e4cb9b8196d` and `3274.db4a19fac5d27f05`, byte-for-byte the names of the local build of the same code; chunk `3274` holds the workspace client. The old `75c048d9e24f72f2` is gone. |
| health | 200, database up; the response carries no connection string |
| 13 workspace routes signed out (workspace, conversations list/create/read/message, stop, continue, retry, projects create/read, files upload/read, disclosure) | each 404 `application/json` `{"error":"Not found"}`, `no-store` |
| forged session cookie | 404 |
| visitor scripts | no `CLAUDE_API_KEY`, `sk-ant-`, `api.anthropic.com`, `postgres://`, `neon.tech`, `*DATABASE_URL`, `OPENAI_API_KEY` or `sk-proj-` |
| database, read-only transaction | seven `ai_` tables present, all empty; users 13, habits 149, completions 78, priorities 46, goals 39, intentions 1, important dates 7, admins 4, identical to before the deploy |
| migration | not re-run |
| schema drift | unchanged: `priorities_user_order` still `(user_id, sort_order, created_on)`; `feedback_created_idx` still absent |

**Release baseline re-verified before merge, 2026-09-13 (branch head `d51f2a1`)**

| Check | Result |
| --- | --- |
| typecheck, lint, production build | clean |
| full unit suite | 763 of 763 |
| browser suite, local test instance, scripted provider | 91 of 91 (the dev server needs `PG_IDLE_MS=1000`: PGlite serves one connection at a time and the suite queries it directly) |
| live check with real Claude, locally | 13 of 13 |
| `npm ls` against the lockfile | consistent |
| read-only production database check | seven `ai_` tables, all empty; users 13, habits 149, completions 78, priorities 46, goals 39, intentions 1, important dates 7 (normal growth since migration); `priorities_user_order` unchanged, `feedback_created_idx` still absent |
| bugs found | none; no code change |

**Phase 2: what exists**

- An admin-only launcher at the bottom right opens a panel that expands to the
  whole window on desktop, and a full-screen workspace on phones that follows
  the on-screen keyboard. It is not a navigation destination.
- Conversations: new, history, automatic and edited titles, archive, restore,
  delete. Replies stream from Claude as NDJSON and are saved while streaming (at
  most a second apart); Stop, Continue and Retry/Regenerate use the phase 1
  lineage. A reply left streaming by a restart shows as interrupted, with Retry.
  Markdown, tables, highlighted code and copy.
- Projects: create, rename, instructions, archive, restore, permanent delete
  after typing the name; a project file library; chats in or out of projects.
- Files: type decided from the bytes (PDF, PNG, JPEG, GIF, WebP, UTF-8 text),
  per-type limits and the 100 MB per-admin quota, de-duplication, up to 20
  ordered attachments, "File removed" for deleted files. PDF and image copies go
  to the Anthropic Files API once, are reused, and are deleted with the file.
  The current upload notice must be accepted first; only files attached to a
  message reach Claude.
- Context: workspace instructions, project instructions, conversation history,
  attached files and the message, within a 150,000-token target (oldest history
  dropped first). No RichHabit personal data, no analytics, and logs carry codes
  only.
- Security: every `/api/admin/ai/workspace` route answers 404 unless
  `users.role` is admin; data access is owner-scoped; hourly (20) and daily
  (100) reply limits are counted from the database; one reply at a time per admin.
- A provider seam (`src/lib/aiWorkspaceRuntime/provider.ts`); Claude lives in
  `src/lib/ai/claude.ts`, still the only file using Anthropic's SDK, with the
  existing workspace-scoped `CLAUDE_API_KEY`. English, Chinese and bilingual chrome.

**Phase 2 verification, 2026-09-13: all passed**

| Check | Result |
| --- | --- |
| typecheck, lint, production build | clean |
| full unit suite | 763 of 763, 59 of them new: runtime rules, the Claude adapter, reply orchestration on PGlite, every API route, privacy and security boundaries |
| browser suite on the local test instance, scripted provider | 91 of 91: 404 for signed-out, ordinary and other-admin access; streaming; persistence after reload; Stop, Continue and Retry with lineage; length limit; rename, archive, delete; upload notice; typing from bytes; oversize refusal; de-duplication; attachment order; provider-copy reuse; project library and "File removed"; project archive and cascade delete; English and Chinese; 1440, 390 and 320 px and bilingual without horizontal overflow; composer above a keyboard-height viewport; no workspace analytics, no prompt text in the server log, no key or Anthropic address in browser scripts |
| live check with real Claude, locally | 13 of 13: streaming, Stop and Continue, a PDF read through the Files API, the stored copy reused and deleted with its file, a Chinese reply, no key or prompt text in the server log |

**Production migration, 2026-09-13: PASS (24 of 24)**

Target: `PRODUCTION_DATABASE_URL` only, direct endpoint. Restore point recorded
immediately before the change: 2026-09-13T15:20:38Z, LSN `0/367C298`, for Neon
point-in-time restore.

| Check | Result |
| --- | --- |
| migration source | `scripts/migrate.mjs`, `scripts/migrations/ai-workspace.mjs` and `db/schema.sql` byte-identical to the rehearsed commit `f09e2af`; 21 statements, all create-if-not-exists on `ai_` objects |
| starting schema | identical to the production-derived rehearsal reference (632 schema lines); no AI tables |
| run 1 | created exactly the seven AI tables; `Done — 7 change(s)`; nothing else reported |
| existing schema and data | every table, column, constraint, index, trigger, comment, function, enum, view, sequence and row digest unchanged; users 12, habits 139, habit completions 75, priorities 41, intentions 1, goals 36, important dates 7 |
| new tables | seven, empty, identical to a fresh `db/schema.sql` install (201 AI schema lines, compared on a throwaway database since removed) |
| run 2 | `Nothing to do; already up to date.`; nothing changed |
| drift indexes | `feedback_created_idx` and `priorities_user_order` untouched |

**Phase 1: what exists**

- Migration step 8 (`scripts/migrations/ai-workspace.mjs`, called last by
  `scripts/migrate.mjs`): creates `ai_projects`, `ai_conversations`,
  `ai_messages`, `ai_files`, `ai_message_files`, `ai_file_provider_copies` and
  `ai_workspace_settings` if absent. Create-only and guarded; the same
  definitions close `db/schema.sql`.
- `src/lib/aiWorkspace`: types, disclosure version, lifecycle rules, validation,
  and `queries.ts`, the only module touching the seven tables. Every function is
  scoped to the admin's user id.
- Limits are configuration in `src/lib/env.ts` (`AI_WORKSPACE_*`, documented in
  `.env.example`): PDF 10 MB, image 5 MB, text 2 MB, 100 MB per admin, 20 and
  100 messages an hour and a day, 8,000 output tokens, 150,000 / 200,000 context.

**Phase 1 local verification, 2026-09-13: all passed**

| Check | Result |
| --- | --- |
| typecheck, lint, production build | clean |
| full unit suite on the branch | 704 of 704 |
| AI Workspace tests (migration, queries, lifecycle, boundaries) | 58 of 58 |
| real `scripts/migrate.mjs` on a local database built from `main`'s schema, twice | run 1 creates the seven tables (main's own 2 changes + 7); run 2 "Nothing to do" |
| same database migrated by `main`'s `migrate.mjs` vs the branch's | 10 of 10 checks; every non-AI table, column, constraint, index, trigger, function and row identical across 28 tables |
| fresh install from the branch's `db/schema.sql` | step 8 creates nothing; identical AI structure to the migrated database |
| change-set scans | no secrets, no mode changes, no control characters, no routes or interface, no network or provider code, no remote database strings |

All databases used were throwaway local PGlite instances.

**Issues found and fixed during phase 1:** a history rule in `lifecycle.ts` that
always returned true; ids compared without normalising case; provider-copy
updates that threw synchronously; two control characters written literally into
source by the editor, now escaped.

**Phase 1 Neon rehearsal, 2026-09-13: PASS.** Approved by the Product Owner;
this closes the phase-1 database-safety gate, including the earlier gap on real
concurrent quota-lock contention.

No Neon API access was available to create a branch, so four isolated databases
were created inside the existing non-production rehearsal branch
(`ep-curly-…`). The branch's production-derived `neondb` was the read-only
reference and was never written. The migration ran through the real path from
the worktree at `14111b3`: `RH_ALLOW_REMOTE=1 DATABASE_URL=<rehearsal database>
node scripts/migrate.mjs`.

| Check | Result |
| --- | --- |
| migration run 1 | the 7 AI Workspace tables created, `Done — 7 change(s)` |
| migration run 2 | idempotent: `Nothing to do; already up to date.` |
| starting point | built from `main`'s schema and migration; after aligning the two drifted indexes below in a throwaway database, identical to the production-derived reference (632 schema lines) |
| existing production-like schema and data | every pre-existing table, column, constraint, index, trigger, comment, function, enum, view, sequence and seeded row unchanged |
| fresh-schema parity | fresh install from `db/schema.sql` identical to the migrated databases (201 AI schema lines, and everything else) |
| integrity suite on Neon, through the real pool | 26 of 26: ownership, attachments, deletion cascades, lineage, stale-stream recovery, disclosure versioning |
| real multi-connection quota contention | 29 of 29, separate Node processes on separate direct Neon connections; activity sampling showed overlapping transactions and simultaneous advisory-lock waits |
| same-admin quota operations | serialize correctly: combined under quota, both stored; each fits but together exceed, exactly one stored and the other refused (6 of 6 natural races, plus lock-held runs) |
| different admins | do not block each other: admin B stored at +759 ms while admin A's lock was held until +3,002 ms |
| refused uploads | leave no partial file, attachment or provider-copy rows; quota never exceeded; deleting a file releases its space |
| code or schema changes required | **none** |
| production migration during the rehearsal | none (applied later, on 2026-09-13; see above) |
| deployment during the rehearsal | none |
| cleanup | the four synthetic rehearsal databases deleted on approval; the rehearsal branch and its `neondb` kept and verified unchanged |

**Pre-existing schema drift — not caused by AI Workspace and not part of the
Phase 1 change.** Found during the rehearsal by comparing `main`'s
`db/schema.sql` with the production-derived reference. Not fixed here; needs a
separate decision.

1. `feedback_created_idx`: present in `db/schema.sql`, absent from production.
2. `priorities_user_order`: `db/schema.sql` includes `category`
   (`user_id, category, sort_order, created_on`); production does not
   (`user_id, sort_order, created_on`).

**Next step (Product Owner):**

None for this release; it is closed. Status-only commits on
`feature/ai-workspace` after `f7499fc` are not on `main` yet. Merge them with the
next release; they need no deploy. Candidates for later decisions: the known
limits below, and the separate schema-drift decision.

**Known limits of this release:** one reply at a time and orphan recovery rely
on RichHabit running as a single Render instance; Files API copies are not
deleted remotely when a whole account is deleted; remote copy deletion is best
effort; uploads are type-checked but not malware-scanned; Render did not
auto-deploy recent releases. The schema drift above is a separate decision and
is not part of this release.

## Claude key-only configuration and priority-suggestion fix (released, verified in production)

| Item | State |
| --- | --- |
| feature commit | `dd7bec0142f9497849697960d09bd7795e0ad935` (8 files) on `feature/claude-key-only` |
| release commit on `main` | `dd7bec0`, fast-forwarded from `534d4c7` and pushed at 03:18 UTC on 2026-09-13 |
| migration | none |
| deployed | on Render, manually by the Product Owner after auto-deploy did not start; live by 03:50 UTC |
| production verification | automated, read-only database, and Product Owner signed-in checks passed on 2026-09-13 |

**What changed**

- `CLAUDE_API_KEY` is a workspace-scoped key, set locally and on Render.
  `CLAUDE_WORKSPACE_ID` and the `anthropic-workspace-id` header were removed; a
  guard test fails if either returns.
- When Anthropic refuses the key or request (400, 401, 403, 404), suggestions
  answer 503 with "Suggestions aren't available right now." / "暂时无法提供建议。".
  Timeouts, rate limits and outages keep "Suggestions didn't load. Please try
  again in a moment."
- Priority suggestions were always empty in `e0eb036`: with items shaped
  `{ text }`, Claude returned the list as one JSON-encoded string (0 of 5 live
  trials usable). Priorities are now requested as a list of strings (5 of 5 in
  English and 5 of 5 in Chinese).

**Verification**

| Check | Result |
| --- | --- |
| local live Claude through the app, English 1440 and Chinese 390 mobile | 46 of 46 |
| local server log and analytics | no key, workspace value, intention text or suggestion text |
| typecheck, lint, build; browser bundles | clean; no key, workspace setting, Anthropic host or SDK |
| unit tests | 647 of 648; the failure is the known `inspect-prod-readonly` baseline in uncommitted, unreleased files |
| production, signed out (04:26 UTC) | health ok; routes and auth unchanged; public pages without errors or overflow; stylesheet unchanged, as expected for a server-only change; no secrets in served bundles |
| production, read-only database | 03:50–03:58 UTC: one habit and one priority request; 4 habit and 4 priority suggestions accepted (the earlier code could never return priorities); new linked priorities all have a quadrant and linked habits a time of day; links unique; no duplicate priorities; `priority_id` equals the first `priority_ids` entry; the previously deleted linked priority is still skipped; AI analytics carry only the list kind; no intention text in analytics |
| production, signed in by the Product Owner | priority suggestions returned; dismissing a suggestion created nothing; Important and Urgent asked before creating a priority; Chinese on a phone correct with no sideways scrolling; no page errors |

Housekeeping: the Neon rehearsal branch (`ep-curly-…`) holds the migrated
intention-links state and can be deleted or reset. The production restore-point
branch can be kept or deleted at the Product Owner's discretion.

**Next step:** AI Workspace phase 1 (schema, migration and data layer; local
databases only) on `feature/ai-workspace`, in a separate worktree outside
OneDrive, per the approved proposal revision 3. No production action is pending
for this release.

## Clarify Your Intention: any number of habits and priorities, and AI suggestions (released, verified in production)

Design approved by the Product Owner on 2026-09-13.

| Item | State |
| --- | --- |
| feature commit | `e0eb036bda05d013584ac3c7cac63946b8d3f40f` (31 files), on `feature/intention-links`, pushed |
| release commit on `main` | `e0eb036`, fast-forwarded from `5245c87` and pushed |
| migration | rehearsed on a reset Neon branch (59 of 59), then applied to production (66 of 66) |
| deployed | on Render, manually; live between 02:48:08 and 02:48:43 UTC on 2026-09-13 |
| production verification | automated and read-only checks passed; the Product Owner's signed-in checks passed |
| not in the release | the unrelated `inspect-prod-readonly` script and test edits, two untracked docs |

**What changed**

- An intention links any number of ordinary habits and priorities. People can
  create new ones, link existing ones, and remove a link without deleting the
  record. Nothing is copied.
- The completed page is five cards: My Intention, Why It Matters, Habits I'm
  Building, My Priorities, and Important Dates. Important Dates are derived from
  linked priorities with a planned day. Lists show 5, then "Show all (n)". The
  final wizard step uses the same Habits and Priorities cards.
- "✨ Suggest with AI" returns temporary drafts with Edit, Add and ×. Nothing is
  created until the person presses Add, which uses the normal habit and priority
  actions; the edited version is what gets created. For a priority, the person
  answers Important? and Urgent? first. Drafts vanish on reload.
- Claude Sonnet runs behind a server-side provider seam (`src/lib/ai`) using
  Anthropic's official SDK. The model receives only the intention, why, vision,
  titles already linked to this intention, on-screen drafts, and the language.
  It never receives the ownership answer or note, other habits or priorities,
  the journal, Community data, account details or email.
- Limits: 10 suggestion requests an hour and 30 a day per user, and one request
  in flight at a time. They are in memory per instance.
- Analytics: `intention_ai_suggestions_requested`, `…_accepted` and `…_edited`,
  each with the kind only. No text is logged or tracked.
- The disclosure appears in the suggestion tray and in the Terms facts, in
  English and Chinese.

**Final migration (step 4e, `scripts/migrations/intention-links.mjs`)**

```sql
alter table intentions drop constraint if exists intentions_habit_ids_check;
alter table intentions add column if not exists priority_ids uuid[] not null default '{}';
update intentions set priority_ids = array[priority_id]
 where priority_id is not null and cardinality(priority_ids) = 0;
comment on column intentions.habit_ids    is 'Every habit linked to this intention, in the order linked. No count limit.';
comment on column intentions.priority_ids is 'Canonical. Every priority linked to this intention, in the order linked. The application reads and writes this list.';
comment on column intentions.priority_id  is 'Legacy compatibility only. Written as priority_ids[1], or null, so the pre-multi-link application still works after a rollback. Not a source of truth. To be removed by a later cleanup migration once no deployed code reads it.';
```

It adds no count constraint and is guarded, so a second run changes nothing.
`priority_ids` is canonical. New saves write `priority_id` as its first entry, or
null. The loader brings a rollback-era legacy link into the list once.
`priority_id` stays until a later cleanup migration.

**Configuration**

`CLAUDE_API_KEY` is set locally and on Render. The current key is not scoped
to an Anthropic workspace, so Anthropic rejects every request (HTTP 400). The
released code can send an optional `anthropic-workspace-id` header from
`CLAUDE_WORKSPACE_ID`, which is not set anywhere. Suggestions therefore fail
gracefully today; everything else works.

Anthropic's current documentation (Authentication and Workspaces pages, and the
TypeScript SDK page) confirms the header name, that it applies to Messages API
requests, and that the SDK's `defaultHeaders` option is the documented way to
send it. It is required only for personal or service account keys that are not
scoped to one workspace. The documented simpler alternative is a key created
for a single workspace, which needs no header and no `CLAUDE_WORKSPACE_ID`.
Whether to replace the key or set the workspace id is the Product Owner's call;
the existing key has not been changed.

**Verification, 2026-09-13**

| Check | Result |
| --- | --- |
| typecheck, lint, production build | clean |
| unit tests | 641 of 642; the one failure is the known `inspect-prod-readonly` baseline |
| migration against a real Postgres copy of the production table (PGlite): data preserved, idempotent, no limits, previous release's save still works | 12 of 12 |
| suggestion rules, limits, routes with a fake provider, privacy source checks | 25 of 25 |
| Claude provider with the SDK mocked | 4 of 4 |
| browser: links, Show all, add, link existing, unlink, editor, suggestion review, errors; 1440, 430, 390, 375 and 320px; English, Chinese, bilingual; dark | 78 of 80; the 2 failures are the live Claude request, blocked by the workspace setting |
| browser bundles: `CLAUDE_API_KEY`, `CLAUDE_WORKSPACE_ID`, `sk-ant-`, the SDK or the API host | none present |
| app server log: intention text, ownership note, suggestion text, key strings | none present |
| analytics rows | kind only; no user text |

**Neon rehearsal, 2026-09-13: passed, 59 of 59, from a clean reset**

The Product Owner reset the branch behind `REHEARSAL_DATABASE_URL` from its
production parent. Confirmed read-only before any write: new Neon timeline,
compute restarted, newer data than before. The branch is a Neon endpoint other
than production's, Postgres 18, writable primary, 28 tables. Production was
never connected to. Migration code was the uncommitted working tree
(`migrate.mjs` 76ca2069, `intention-links.mjs` 8ebadacc, `lib.mjs` 1a467533,
sha256 prefixes). An earlier attempt on the unreset branch was discarded.

| Step | Result |
| --- | --- |
| clean-branch pre-flight | `intentions_habit_ids_check` present; `priority_ids` absent; no migration comments; printed BRANCH IS CLEAN |
| before-state captured | row count and content fingerprint for 27 other tables; schema fingerprint for all 28; whole-schema hash; intentions' 14 columns, 19 constraints, 2 indexes, 0 triggers, comments; original-column fingerprint of every intention row |
| real intention rows | **1** (active, 3 linked habits, 1 linked priority) |
| first run | exit 0: removed the three-habit limit, added `priority_ids`, carried **1** priority link, documented 3 columns; `Done — 6 change(s)` |
| intended changes only | limit removed; `priority_ids uuid[] not null default '{}'` added with its NOT NULL; comments exact; all other intentions columns, constraints, indexes unchanged; the row's 14 original columns identical (text, `habit_ids`, `priority_id`, state, timestamps); `priority_ids = [priority_id]` |
| unrelated tables vs PRE-migration | 27 of 27 identical in row count, content and schema |
| second run | `Nothing to do`; whole-database fingerprint identical to after run 1 |
| previous release's save, rolled back | insert and update work; 4 habits accepted; 1000 + 1000 links accepted; second active intention refused (23505); cross-account save changed nothing |
| after rollback | no test rows; database identical to after run 2; 27 tables and the intention row still identical to PRE-migration |

The branch now holds the migrated state and can be deleted or reset in Neon.

**Claude credential decision, 2026-09-13.** The Product Owner chose a
workspace-scoped key under `CLAUDE_API_KEY` only. Once that key is in place,
remove `CLAUDE_WORKSPACE_ID` and the `anthropic-workspace-id` header support
(`src/lib/env.ts`, `src/lib/ai/claude.ts`, `src/lib/ai/provider.ts`, the provider
test, `.env.example`), and show "Suggestions aren't available right now" when
the provider rejects the key. The current key is not changed by the agent. Live
Claude checks stay pending until then and do not block the migration.

**Production restore point (step 2): created by the Product Owner in Neon** on
2026-09-13, before any production migration.

**Production migration (step 3): run and verified, 2026-09-13, 66 of 66 checks.**
Approved by the Product Owner. Target `PRODUCTION_DATABASE_URL`, endpoint
`ep-jolly-****`, Postgres 18.6, 28 tables, 12 users; not the rehearsal or any
other branch. Migration files byte-identical to `e0eb036`. No test writes.

| Step | Result |
| --- | --- |
| read-only pre-flight | `intentions_habit_ids_check` present, `priority_ids` absent, no migration comments; one-active index, 19 constraints, no triggers as rehearsed |
| before-state | row count, content and schema fingerprints for all tables; intentions structure; original-column fingerprints of the 1 real intention |
| first run | exit 0: removed the three-habit limit, added `priority_ids`, carried **1** priority link, documented 3 columns; `Done — 6 change(s)` |
| intentions | 1 row, unchanged in all 14 original columns (`habit_ids`, `priority_id`, text, state, timestamps); `priority_ids = [priority_id]`; only the limit removed and the `priority_ids` NOT NULL added; text constraints and one-active index intact; comments exact |
| unrelated tables vs PRE-migration | 27 of 27 identical in rows, content and schema; functions and enum types identical; no live activity during the run |
| second run | `Nothing to do; already up to date.`; everything identical to after run 1 |

Production now has the schema the new code needs. The deployed app (`026d8be`)
keeps working on it: the rehearsal proved the previous release's save still
works after the migration.

**Release, 2026-09-13.** `feature/intention-links` pushed at `e0eb036`; `main`
fast-forwarded `5245c87..e0eb036` and pushed. Render did not auto-deploy within
about five minutes; the Product Owner deployed `e0eb036` manually and it went
live between 02:48:08 and 02:48:43 UTC. Render has no pre-deploy command, so the
migration was not rerun.

**Production verification, automated and read-only (no production writes)**

| Check | Result |
| --- | --- |
| release live | stylesheet `75c048d9e24f72f2.css` byte-identical to a clean build of `e0eb036`; the previous stylesheet now 404; suggestion routes answer 401 signed out instead of 404; new intention strings present in served bundles. JavaScript chunk names differ between Render's build and the local build, so chunks were not compared byte for byte |
| health | ok, database up |
| routes and auth | `/login`, `/terms`, `/verify` 200; `/`, `/habits`, `/priorities`, `/insights`, `/community`, `/intention` redirect to login; `/today` 308; `/api/state`, `/api/community`, `POST /api/intention`, both suggestion routes 401 signed out |
| public pages in a browser | login at 1440 and 390, terms, verify: no page errors, no failed requests, no horizontal overflow |
| secrets in browser bundles | none in the 11 chunks production serves signed out, nor in all 52 chunks of the clean `e0eb036` build: no Claude, OpenAI, Resend or database variable names, no `sk-ant-`, workspace id, Anthropic host or SDK, Neon host or endpoint, connection string or `password_hash`; no `NEXT_PUBLIC_` variables |
| existing intention (read-only DB) | 1 active completed intention; 3 of 3 linked habits resolve; `priority_ids` equals `priority_id`; the linked priority was deleted by its owner at 21:27 UTC on 2026-09-12, before the migration, and is skipped by design. Not repaired, per the Product Owner |
| analytics privacy (read-only DB) | no AI events yet; intention events carry no properties; none of the intention's text fragments, nor any reflection text, appear anywhere in analytics |
| Claude with the current key | verified on a local copy of `e0eb036` with the same key, in English at 1440 and Chinese at 390 (15 of 15): Anthropic rejects the request, the route answers 502, and the tray shows "Suggestions didn't load. Please try again in a moment." / "建议没有加载出来，请稍后再试。"; no drafts, no provider detail, habit links unchanged, Link existing still works, no page errors. The server log records only `intention suggestions failed (400)`; no key, workspace or intention text |
| production server logs | not inspected: no Render log access. The code logs a status code only, and static tests enforce it |

**Production verification, signed in, by the Product Owner on `e0eb036`**

| Check | Result |
| --- | --- |
| add a habit from the intention | pass |
| link an existing habit | pass |
| remove a habit link without deleting the habit | pass |
| add a priority | pass |
| link an existing priority | pass |
| remove a priority link without deleting the priority | pass |
| Show all / Show fewer | pass |
| desktop and mobile; English, Chinese and bilingual | pass |

No production data loss was observed, and unlinked records remained intact.

The Claude follow-up was released in `dd7bec0`; see the section above.

## Community rankings and two-series My Progress (released, verified in production)

Requested and approved by the Product Owner on 2026-09-12, including the product
choices listed here. Merged, deployed and verified.

| | |
| --- | --- |
| branch | `feature/community-rankings`, pushed; fast-forwarded into `main` |
| feature commit | `026d8be4905f214f0ac8762f52853dacbd44b3f9` (13 files), rebased from `97e0c1c` onto `8f5170c` |
| release commit on `main` | `026d8be4905f214f0ac8762f52853dacbd44b3f9` |
| database migration | none required; no new table |
| deployed | on Render, live at 00:59 UTC on 2026-09-13 |
| production verification | passed on 2026-09-13; no production issues found |

**Community: two independent rankings.**

- *Habit Ranking* is unchanged: month-to-date unweighted completion, members with
  something scheduled, ties by account age.
- *Accomplishment Ranking* counts priorities with `completed_on` in the reader's
  calendar month to date. Every quadrant counts one. A visible, enabled member with
  at least one accomplishment is eligible, with or without habits. Equal counts
  share a rank, listed by account age.
- Opt-out removes a member from both; disabled accounts are excluded from both
  through `RANKS_ON_LEADERBOARD`; admins who take part are included.
- No combined or overall score exists anywhere.
- `/api/community` keeps the habit fields and adds `accomplishments: {members, top,
  me, mine}`. Rows carry rank, name, count and isMe only; the per-row
  accomplishment figure on habit rows was removed. `mine` is the reader's own count.
- Full page: tabs "Habit Ranking" / "Accomplishment Ranking". Rail: a small
  "Habits" / "Accomplishments" switch inside the Community tab, one list at a time.
- The archived month table still stores habit ranks only.

**My Progress chart.** One chart, two forms on separate scales: habit completion as
the thin line on 0–100%, accomplishments as soft columns scaled to the month's
busiest day in the lower band. The legend is also the reading for the chosen day
(today by default; hover, tap or arrow keys pick another). Drawn at its real width.
Summary reads "66% habits" and "7 accomplishments". Counting logic is unchanged;
`src/lib/progressSeries.ts` holds the pure series and geometry.

**Bilingual labels** use the app's existing separator: "Habit Ranking · 习惯排名".

**Verification, 2026-09-12**

| Check | Result |
| --- | --- |
| typecheck, lint, production build | clean |
| unit tests | 586 of 587; the one failure is the known `inspect-prod-readonly` baseline |
| browser: rankings and chart at 1440, 430, 390, 375, 320; English, Chinese, bilingual; dark | 214 of 214 |
| browser: Accomplishments regression, updated for the new Community design | 102 of 102 |
| browser: inline editing regression | 26 of 26 |

**Production verification, 2026-09-13.** Signed out and read-only; no production
data was created, changed or deleted, and no test accounts were made.

- The served stylesheet is byte-identical to a clean build of `026d8be`
  (`3e2271478d183782.css`, sha256 `eb694a4b…`); the previous release's stylesheet
  now answers 404. The served dictionary script matches that build once module ids
  are masked.
- New text is live: "Habit Ranking", "Accomplishment Ranking", 习惯排名, 成果排名,
  the chart legend, and the notes that each ranking stands on its own and that only
  the number is shared. The chart's focus style is in the stylesheet.
- The Accomplishments release is still present ("Delete this accomplishment?",
  "accomplished this month", "Priority wording"), and the wording Community
  Rankings replaced (the strip legend, the per-row "habits" suffix) is gone.
- `/api/health` is ok with the database up. `/login`, `/terms` and `/verify` load
  with no page errors or failed requests at 1440px and 390px. Protected pages
  redirect to login, `/today` still answers 308, and signed-out API calls answer
  401.
- No production issues were found. Signed-in smoke tests are the Product Owner's,
  on their existing account.

**Next step:** none pending for this release beyond the Product Owner's signed-in
smoke tests. No database action is needed.

## Accomplishments and a forward-looking Priority Compass (released, verified in production)

Accomplishments, the Priority Compass simplification and inline priority editing,
approved by the Product Owner on 2026-09-12, are merged, deployed and verified.

| | |
| --- | --- |
| branch | `feature/accomplishments`, from `67105c6`; fast-forwarded into `main` |
| feature commit | `17e5ce24e33215cc8415a6096dd67e9a3e611c2a` (23 files) |
| release commit on `main` | `d7281117b68c4fcbe69069b0c79d4be745ca604c` (the feature plus a status commit) |
| database migration | none required; no new table |
| deployed | manually on Render with "Deploy latest commit" |
| production verification | passed on 2026-09-13; no production issues found |

The unrelated `inspect-prod-readonly` script and test edits and the two untracked
documents in `docs/` remain excluded and uncommitted. The one known unit-test
failure comes from those excluded edits and is documented below.

**Rule.** An accomplishment is a priority whose `completed_on` is set, counted on
that date. One rule in `src/lib/accomplishments.ts` serves Insights, My Progress
and Community. Reopen clears the date; completing again counts once on the new
day; delete removes the row and the count.

**What changed**

- **Insights:** a new Accomplishments card after the score card. Month view has
  total, "Today n", daily bars and the list grouped by completion day with exact
  titles and "from <date>". Year view has total and 12 month columns; a past month
  opens that month; future months are quiet and not openable.
- **My Progress:** habits % and accomplishments count side by side, never
  combined; a small per-day strip under the habit line; the rail's Community tab
  shows only the reader's own count.
- **Community:** each visible member shows a quiet "n accomplished" under the
  habit %. Ranking is unchanged and uses habits only. Only rank, name, pct,
  accomplishments and isMe leave the server. A pre-existing leak of each member's
  account creation time in the payload was removed.
- **Community month uses the reader's calendar.** `/api/community` reads the
  `x-rh-timezone` header (sent by the new `fetchCommunity`) and measures habit %
  and accomplishments over the reader's month to date. Invalid or missing zone
  falls back to the server date. The cache is keyed by reader date. The archive
  of finished months still triggers on the server's month, so archived results
  are unchanged. Priority complete, reopen and delete now mark the member stale.
- **Completed-priority delete asks first** ("Delete this accomplishment?"). Open
  priorities still delete in one click. Deletion semantics unchanged.
- **Priority Compass** always shows today: previous-day navigation and the large
  date heading are removed, and the matrix and Important Dates are top-aligned
  peers. `prioritiesOn` and all rows are untouched; `useToday` moved to
  `src/components/useToday.ts` and is shared.
- **Inline priority rewording** (requested by the Product Owner, missing from the
  first report, added 2026-09-12). Tapping a card's words turns them into a field
  in place; Enter or Save saves, Escape or Cancel cancels. Blank wording is
  refused on the client and the server. A failed save reopens the field with the
  typed words. `PATCH /api/priorities {id, text}` updates only `body` on the same
  row, so id, created, completed, quadrant, order, plan and accomplishment counts
  cannot change; completed priorities can be reworded without reopening. Drag is
  off for the card being edited. Analytics records `priority_edited` with the row
  id only; no words reach analytics or logs.

**Verification, 2026-09-12**

| Check | Result |
| --- | --- |
| typecheck, lint, production build | clean |
| unit tests | 561 of 562; the one failure is the known `inspect-prod-readonly` baseline |
| new unit tests (rule, lifecycle, US zone month boundary, rank unaffected, privacy) | 35 of 35 |
| new unit tests for inline rewording | 19 of 19 |
| browser suite on the local test instance | 102 of 102 |
| browser suite for inline rewording, desktop, phone, Chinese, dark | 26 of 26 |
| analytics rows and server log after rewording, checked in the database | no priority words anywhere |

The browser suite covered: Compass today and the next day; top alignment and
phone order; Insights month and year, the year total against its month columns,
opening a month and the previous year; My Progress and Community matching
Insights through reopen, re-complete and delete; the confirmation's cancel and
confirm; Los Angeles, Chicago and New York either side of local midnight on
September 30; English, Chinese and bilingual; dark mode; 390px width with no
horizontal scroll; no page errors.

**Known limits.** A member with nothing scheduled this month is still left off
the board even with accomplishments; that rule is unchanged. Month labels use the
existing short form ("Sep 2026").

**Design review refinements, 2026-09-12** (checked at 1440, 430, 390, 375 and
320px):

- Large counts use a new `.count` style, the body sans at regular weight,
  because the display serif renders 11 as "ll". It applies to the Insights
  total, both My Progress figures, the Community summary and the rail's ranking.
- My Progress drops "today n" beside accomplished; it wrapped the rail.
- Priority Compass shows today's date as one quiet line under the heading, with
  the tally beside it; the heading no longer wraps on phones.
- Community summary figures sit on one baseline when a label wraps.
- Inline editing: the field opens with no text shift, the field no longer
  clips its last line, the × is hidden while editing, desktop Save is a quiet
  tint and touch Save stays filled, the hover wash is lighter, and the editor
  scrolls above a phone keyboard.

**Product decisions approved 2026-09-12:** removing account creation time from
the Community payload; keeping members with no scheduled habits off the board;
the responsive Chinese rank layout; the revised My Progress legend; the short
month label; the narrow time-zone fix for both current-month figures.

**Production verification, 2026-09-13.** Signed out and read-only; no production
data was created, changed or deleted.

- The served stylesheet is byte-identical to a clean build of `d728111`
  (`98a1a3e0ce91e64e.css`, sha256 `1c65a130…`). The served dictionary script
  matches that build once module ids are masked, and contains release-only text
  such as "Delete this accomplishment?".
- No Community Rankings code is live: its stylesheet and dictionary script return
  404, and its text ("Habit Ranking", "Accomplishment Ranking") is absent.
- `/api/health` is ok with the database up. `/login`, `/terms` and `/verify` load
  with no page errors or failed requests at 1440px and 390px. Protected pages
  redirect to login, `/today` still answers 308, and signed-out API calls answer
  401.
- No production issues were found. Signed-in smoke tests are the Product Owner's,
  on their existing account.

**Next step:** Community Rankings waits for the Product Owner's approval before it
is pushed, merged and deployed. No database action is needed.

## Production, verified 2026-09-12

| | Commit |
| --- | --- |
| production (Render, `https://richhabit.onrender.com`) | `109d295` |
| GitHub `main` (read-only `ls-remote`) | `109d295` |
| local `main` | `109d295`, plus the uncommitted release below |

Verified from production's public login page, without credentials: its only
stylesheet is byte-identical to a local build of `109d295` (sha256 `1ffcb6dd…`),
its dictionary chunk is identical to that build once numeric module ids are
masked, and it contains every string and CSS class `109d295` introduced and none
from this release. There is no Render CLI or API key here, and `/api/health`
reports no version, so this asset comparison is the verification method.

Production is neither ahead of nor behind `main`. No commit lies between
production and the release; the release is one new commit on top of `109d295`.
`109d295` changed neither the migration nor the schema, so production's
migration level is that of `a59b118`, whose `planned_on` migration was applied
on 2026-09-09.

## The release

### Contents

My Journey navigation, the decomposition of Today into Rich Habits and Priority
Compass, Clarify Your Intention with its migration, backward-compatible routing,
and two narrow bug fixes. All approved by the Product Owner.

```
My Journey                        foldable group; no page, no route
    Clarify Your Intention        /intention
    Rich Habits                   /habits      day header, habits, journal, My Progress
    Priority Compass              /priorities  matrix, Important Dates, past days
Week · Insights · Community · More (My Habit Sheet at /more/habits)
```

| Request | Answer |
| --- | --- |
| `/today` | 308 to `/habits`, query kept, `Cache-Control: no-store, must-revalidate` |
| `/habits?edit=` or `?from=` | 307 to `/more/habits`, query kept, same cache header |

### The exact commit set

47 paths: 45 added or modified files and one rename. It contains no file-mode
changes, no executable new files, no environment files, logs, screenshots,
build output or scratch files. Stage with `git -c core.fileMode=false` so the
166 mode-only paths in this OneDrive checkout stay out.

- **A. My Journey navigation:** `src/components/Sidebar.tsx`,
  `src/components/AppShell.tsx`, `tests/navigation.test.ts`,
  `tests/i18n.test.ts`; nav hunks of `src/app/globals.css` and both dictionaries.
- **B. Rich Habits and Priority Compass:** `src/components/screens/Today.tsx` →
  `RichHabits.tsx` (rename), `src/components/screens/PriorityCompass.tsx`,
  `src/app/(app)/habits/page.tsx`, `src/app/(app)/priorities/page.tsx`,
  `src/app/(app)/more/habits/page.tsx`, `src/components/screens/More.tsx`, and
  the page labels in `src/app/api/{completions,habits,habits/reorder,important-dates,notes,priorities}/route.ts`.
- **C. Clarify Your Intention:** `src/app/(app)/intention/page.tsx`,
  `src/app/api/intention/route.ts`, `src/components/screens/Intention.tsx`,
  `src/lib/intention.ts`, `src/lib/types.ts`, `src/lib/validate.ts`,
  `src/lib/db/queries.ts`, `src/lib/db/index.ts`, `src/lib/db/diagnose.ts`,
  `src/lib/analytics/config.ts`, `src/components/ui.tsx`,
  `tests/intention.test.ts`, `tests/branding.test.ts`; intention hunks of
  `src/components/store.tsx`, `src/app/globals.css` and both dictionaries.
- **D. Intention migration and schema:** `db/schema.sql`, `scripts/migrate.mjs`
  — each differs from `HEAD` by exactly one added block.
- **E. Backward-compatible routing:** `src/middleware.ts`,
  `src/app/(app)/today/page.tsx`, `src/app/page.tsx`, `src/app/login/page.tsx`,
  `src/app/login/LoginForm.tsx`, `src/app/setup/[token]/SetupForm.tsx`,
  `src/app/change-password/ChangePasswordForm.tsx`,
  `src/components/AdminShell.tsx`, `src/components/screens/Goals.tsx`,
  `src/components/screens/Awareness.tsx`.
- **F. Narrow bug fixes:** dark mode (the `[data-theme]` rule in
  `src/app/globals.css`); the Saving indicator (`runDebounced` in
  `src/components/store.tsx`).
- **G. Documentation:** `PROJECT_STATUS.md`.

Content changes deliberately left OUT, all outside these categories and all
predating this work:

- `scripts/inspect-prod-readonly.mjs` and `tests/inspect-prod-readonly.test.ts`:
  uncommitted edits that break that test. They are the known baseline failure.
- `docs/RichHabit_Solution_Architecture.md` and `docs/RichHabit_User_Manual.md`:
  untracked documents not written in this work.

### The schema change

```sql
create or replace function text_array_within(items text[], max_items int, max_chars int)
returns boolean language sql immutable parallel safe as $$
  select coalesce(cardinality(items), 0) <= max_items
     and not exists (select 1 from unnest(items) as item where length(item) > max_chars)
$$;

create table intentions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users on delete cascade,
  want          text not null default '' check (length(want) <= 2000),
  why_chain     text[] not null default '{}'
                constraint intentions_why_chain_check
                check (text_array_within(why_chain, 3, 2000)),
  ownership     text check (ownership in ('mine','outside','unsure')),
  ownership_note text not null default '' check (length(ownership_note) <= 2000),
  vision        text[] not null default '{}'
                constraint intentions_vision_check
                check (text_array_within(vision, 4, 2000)),
  habit_ids     uuid[] not null default '{}'
                constraint intentions_habit_ids_check
                check (cardinality(habit_ids) <= 3),
  priority_id   uuid,
  step          smallint not null default 1 check (step between 1 and 5),
  completed_at  timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index intentions_one_active on intentions (user_id)
  where archived_at is null;
```

Approved by the Product Owner, including `habit_ids <= 3`. Purely additive,
created only if missing, run inside the migration's single transaction.

## Verification of the exact release tree

The release set was exported from a temporary index into a clean tree with no
environment file, and every check ran against that tree rather than the working
directory.

| Check | Result |
| --- | --- |
| typecheck, lint, production build | clean |
| unit tests | 506 of 506 |
| migration rehearsal on a production-like copy | 22 of 22 |
| navigation and page composition | 56 of 56 |
| Priority Compass width parity and past days | 13 of 13 |
| data safety fingerprint while using every moved feature | 14 of 14 |
| ownership, limits and log privacy | 24 of 24 |
| autosave, resume, journal regression | 9 of 9 |
| mobile drawer and bilingual sidebar | 14 of 14 |
| intention walks in English, Chinese, bilingual, dark | 121 of 121 |
| new code against a database without the new table | 11 of 11 |

In the working directory the unit suite reports 507 of 508, because it includes
the excluded `inspect-prod-readonly` edits. The release tree carries `HEAD`'s
versions of those files and passes.

The rehearsal copy held app-created users, habits, completions, priorities,
journal entries and important dates across 27 tables, brought to production's
migration level first. The first run made exactly two changes; every existing
table's rows and structure were byte-identical afterwards; a second run changed
nothing; direct inserts over every limit were refused by the named constraint.

Expected stylesheet once the release is serving, for verifying the deploy:
`00a67853ba1e8d0b.css (sha256 488ebf311ed45b28…)`.

## Environment clean-up, 2026-09-12

- The pasted production credential was removed from `.env.local`, which now
  holds only local settings. The file is gitignored and never committed, and the
  endpoint appears in no history, project file or document. The Product Owner is
  rotating the credential.
- Two stale `npm start` servers on ports 3004 and 3007, started 2026-08-15 from a
  RichHabit copy in `~/.Trash`, were stopped with approval. Both ports are free.
  The graceful SIGTERM did not run because of a scripting error; they were
  stopped with SIGKILL after each PID was re-checked as a RichHabit server
  working in that copy. Neither held a database connection.
- Whether that Trash copy contains a production credential is **unknown**: macOS
  does not let this session read `~/.Trash`, and the path no longer resolves.
  Nothing there was deleted.

## Release progress, 2026-09-12

| Step | State |
| --- | --- |
| pre-flight: production healthy and still `109d295` | done, 19:57 UTC |
| clean commit | `cd3eef49368b43766acbec33e24942c9169e798e` |
| commit tree equals the verified tree | yes, `4ebb312611fbf846a79fef5a3f4b35f665788d6b` |
| mode changes in the commit | 0 |
| release branch pushed | `release/my-journey-intention` |
| GitHub `main` | still `109d295` |
| Render auto-deploy setting | not verifiable from this session |
| credential rotated and Render `DATABASE_URL` updated | done by the Product Owner |
| production healthy after rotation, still `109d295` | yes, 20:10 UTC: health ok, database up, stylesheet byte-identical |
| migration target identified, read-only | the Neon endpoint production used before rotation; database `neondb`; 27 tables; schema at the `a59b118` level; no intentions objects yet |
| Neon rehearsal branch | `rehearsal-intentions-2026-09-12`, created by the Product Owner from `production`; same Neon project, different branch timeline; byte-identical to production across 27 tables before migrating |
| migration rehearsal on the Neon branch | passed 56 of 56: the two expected changes, a no-op second run, 13 schema checks, 26 constraint tests rolled back, all 27 existing tables byte-identical |
| production migration | applied 20:25 UTC: `created text_array_within()`, `created intentions`, `Done — 2 change(s).` |
| idempotency run on production | `Nothing to do; already up to date.` |
| production verification | 38 of 38: new objects, constraints and index present; `intentions` empty; all 27 existing tables and 1,181 rows byte-identical before and after |
| temporary database credentials in `.env.local` | removed; local development URL restored |
| application release | approved by the Product Owner; `main` fast-forwarded to the release; deployed and confirmed live by the Product Owner |

**Migration notes.** Both databases were reached through pooled connections.
The rehearsal URL was pooled rather than direct as described; that is a
connection type, not an identity, and does not affect this single-transaction
migration. The pg driver printed its standard notice that `sslmode=require` is
treated as `verify-full`; it comes from the driver and changed nothing. No test
intention was created in production. The rehearsal branch can be deleted in Neon
once the deploy is verified.

The working tree on the release branch still holds the four excluded content
changes. It now shows 212 mode-only paths rather than 166, because the 46
committed files are stored as 644 while this OneDrive checkout marks them
executable.

## Release sequence

Steps 0 to 3 are complete. The Product Owner approved step 4 on 2026-09-12.

The migration is additive and the new code is safe before it, but order still
matters: migrating first means the intention page works from the first request,
a migration failure stops the release before users see new code, and a later
code rollback never needs the database touched.

**0. Before the release**

1. Rotate the production database credential. Update `DATABASE_URL` on Render.
   Render restarts the current deploy; confirm production is still healthy and
   still serving stylesheet `5ec78f0f7d7b0bdd.css`.
2. Confirm in the Render dashboard whether auto-deploy is on for `main`.
   `render.yaml` does not say.
3. Create a Neon branch of production. It is the restore point and the final
   rehearsal target.

**1. Clean commit** on a release branch from `109d295`: stage exactly the 47
paths above with `git -c core.fileMode=false`, confirm no mode changes and that
the staged tree matches the verified set, and commit.

**2. Push the release branch.** Pushing a branch other than `main` deploys
nothing.

**3. Production migration**

1. From the release commit, run the migration against the Neon branch. Expect
   exactly `created text_array_within()`, `created intentions`, `Done — 2
   change(s).`, then `Nothing to do` on a second run.
2. Run it against production:
   `RH_ALLOW_REMOTE=1 DATABASE_URL='<rotated production URL>' npm run db:migrate`.
   Check the target line says the production host with `** REMOTE **`. Expect the
   same two changes, then `Nothing to do` on a second run.
3. If the output shows anything else, stop. Do not deploy.

**4. Application deployment:** fast-forward `main` to the release commit and
push. Render builds with `npm ci && npm run build`. Confirm the login page serves
the expected release stylesheet above and contains "My Journey".

**5. Production smoke tests**

- Read-only, no credentials: health `ok`; `/today` answers 308 to `/habits`;
  `/habits?edit=x` answers 307 to `/more/habits`; `/intention` signed out
  redirects to login; `POST /api/intention` signed out answers 401.
- Signed in by the Product Owner: My Journey tree; Rich Habits shows existing
  habits and history; Priority Compass shows existing priorities, past days and
  Important Dates; My Habit Sheet opens; an intention autosaves, survives a
  reload and resumes; a habit and a priority created from step five appear on
  their pages; dark mode and bilingual mode read correctly.
- Existing habits, priorities, completions and journal entries are all present.

**6. Failure and rollback**

- **Migration fails:** it runs in one transaction and rolls back; production is
  unchanged. Do not deploy. Investigate against the Neon branch.
- **Build fails:** Render keeps serving `109d295`. The new table is unused by
  that code and harmless. Fix forward.
- **Smoke tests fail:** roll back in the Render dashboard to the `109d295`
  deploy, or revert the commit on `main`. Leave the `intentions` table and its
  rows in place: `109d295` ignores them, and any reflection a user saved survives
  for the fix. Never drop or truncate it as a rollback step.
- After a rollback, the redirects were sent with `no-store`, so browsers should
  not reuse them; at worst a user reaches `/habits`, which in `109d295` is the
  working habit sheet.
- Restoring production from the Neon branch would discard every write since the
  migration, so it is reserved for data corruption and needs the Product Owner.

## Open, not fixed

- **Header title truncation at phone width**, deferred by the Product Owner.
- **The matrix card says "Today's priorities" on past days** in the deployed
  release. The local Accomplishments branch removes past days, which resolves it.
- **Rich Habits leaves an empty rail column below My Progress** on tall desktop
  pages.
- **`db/schema.sql` lacks the legacy `day_priorities` table** that an earlier
  migration step creates. Production has it. Pre-existing.
- **The `inspect-prod-readonly` baseline failure** in the working directory, from
  pre-existing edits excluded from the release.

## Notes

- `.env.local` points `npm run dev` at the local database; start it with
  `npm run db:dev` first.
- PGlite serves one connection at a time. Do not run builds or test suites while
  a browser suite is using it.
- In zsh, never name a shell variable `path`: it is tied to `PATH`.
- The headless browser used for verification is outside the project; no
  dependency was added.
