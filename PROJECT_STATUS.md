# RichHabit — Project Status

> Last updated: 2026-09-13
>
> **AI WORKSPACE → GENERAL-PURPOSE, MULTI-MODEL, IMAGE GENERATION: RELEASE CANDIDATE ON `feature/ai-workspace-models` · REAL GEMINI IMAGE GENERATION VERIFIED ON A BILLED GOOGLE PROJECT (LIVE 23/23) · INCLUDES `1375082f` BY MERGE · POST-MERGE TESTS PASS · NOT MERGED INTO `main` · NOT DEPLOYED · NO MIGRATION**
> **AI WORKSPACE V1 — IMAGE UNDERSTANDING: VERIFIED · EXISTING CAPABILITY OF `f7499fc` · 30/30 LIVE CLAUDE CHECKS · 46/46 IMAGE-PATH UNIT TESTS · NO CODE, SCHEMA, CONFIG OR PRODUCTION CHANGE · DO NOT REBUILD**
> **AI WORKSPACE CHATBOT (ADMIN ONLY): RELEASE CLOSED · RELEASED IN `f7499fc` · MERGED INTO `main` · PRODUCTION MIGRATION APPLIED AND VERIFIED (24/24, 2026-09-13 15:21 UTC; not re-run) · DEPLOYED TO RENDER · PUBLIC PRODUCTION CHECKS 21/21 · PRODUCT OWNER SIGNED-IN SMOKE TEST PASSED**
> **CLAUDE KEY-ONLY CONFIGURATION + PRIORITY SUGGESTION FIX: RELEASED IN `dd7bec0` · DEPLOYED TO RENDER · PRODUCTION VERIFIED (AUTOMATED + PRODUCT OWNER SIGNED-IN) · NO MIGRATION**
> **INTENTION LINKS + AI SUGGESTIONS: RELEASED IN `e0eb036` · STILL LIVE IN PRODUCTION**
> **COMMUNITY RANKINGS + TWO-SERIES MY PROGRESS: RELEASED IN `026d8be` · STILL LIVE IN PRODUCTION**
> **ACCOMPLISHMENTS: RELEASED IN `d728111` · STILL LIVE IN PRODUCTION**
>
> **Repository:** `origin/main` is `f7499fc`, fast-forwarded from `f0a8e28`.
> Later status-only commits may sit on `feature/ai-workspace` ahead of `main`.
>
> **Production database:** the seven AI Workspace tables exist in production
> (additive, created empty on 2026-09-13). Every pre-existing table, index,
> constraint and row was verified unchanged.
>
> **Deployed application:** `f7499fca52bca2bfebc75faca4b3a505e6a18830` (AI
> Workspace), deployed manually by the Product Owner. Render has not
> auto-deployed recent releases, and it deploys only what is on `main`.
>
> The earlier My Journey and Clarify Your Intention release (`cd3eef4`, with its
> intention migration applied to production on 2026-09-12) was deployed and
> confirmed live by the Product Owner before Accomplishments; production includes it.

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
5. **Remaining:** fast-forward `main` to the release-candidate commit of
   `feature/ai-workspace-models` and deploy it on Render. No database step.
   Then verify in production, signed in: the model selector, a Gemini reply, a
   hippo picture in English and Chinese, and re-accepting the upload notice.

**Known limits and risks**

- A free-tier quota failure reads "The AI service is busy. Try again in a
  minute." — accurate for per-minute limits, misleading for a quota of 0.
- The router recognises explicit requests; loosely phrased ones ("hippo picture
  please") go to the chat model, which is told to suggest "Create an image of …".
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
