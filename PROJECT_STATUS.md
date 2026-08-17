# RichHabit — project status

**Persistent handoff checkpoint.** Read this first when resuming; it is kept
current at each milestone. Last updated at commit `0487b54`.

---

## ⛔ PAUSED HERE — Step 2: Configure the Resend DNS records in GoDaddy

The owner has **intentionally decided not to continue DNS/email configuration
right now** and will return to it later.

**On resume, continue from Step 2. Do not redesign or rebuild the
email-verification implementation — it is finished, tested and merged.**

---

## Do not change these

| Rule | Why |
|---|---|
| **DO NOT enable email verification until a real verification email has successfully arrived.** | With `REQUIRE_EMAIL_VERIFICATION=true` and no working transport, every new registration sits pending forever and the only symptom is sign-ups that never complete. |
| **DO NOT delete or reset existing users or their data.** | 9 active non-admin accounts + 1 admin exist in production with real history. |
| **DO NOT automatically delete pending/unverified accounts.** | Explicit owner decision — this stays manual. No sweeper, cron or scheduled job exists; keep it that way unless the owner asks. |
| **DO NOT commit API keys, passwords or other secrets.** | `.env*` is gitignored except `.env.example`, which carries names only. `.mail-outbox/` is gitignored because it contains live confirmation links. |
| **DO NOT force existing users through verification.** | They are grandfathered by column default — see below. |
| **`REQUIRE_EMAIL_VERIFICATION` must remain OFF.** | Verified set nowhere: absent from `render.yaml`, commented out in `.env.example`. |

---

## Current state

**Commit `0487b54`** — "Add email verification for new registrations only".
Pushed to `origin/main`. Working tree clean. Preceded by `432c673` (the 50-user
cap) and `28a1ec2` (RichHabit rebrand).

### 50-user early-access cap — implemented and tested

- `EARLY_ACCESS_USER_LIMIT`, default **50**, `0` = unlimited.
- Applies to **active, non-admin** accounts. **Admins are exempt.**
- One definition of "occupies a place" — `OCCUPIES_A_SLOT` in
  `src/lib/db/capacity.ts` — shared by sign-up, verification, re-enable and the
  admin dashboard, so the number displayed and the number enforced cannot drift.
- Enforced in the database: count and write happen in one transaction holding
  `pg_advisory_xact_lock` (transaction-scoped, so it survives a pooler in
  transaction mode — production connects through one).
- Disabling or deleting an account releases its place immediately.

### Registration and sign-in

- New sign-up collects **first name, last name, username, email, password,
  confirm password, and required acceptance of the Free Early Access
  disclaimer**. Username and email are each unique.
- **Sign in with either username or email**; the type is decided server-side
  from the value, and the failure message is generic so it cannot enumerate
  accounts.
- Accounts predating these fields keep their nulls and are never locked out.

### Email verification — implemented, switched OFF

- **`users.verification_required` decides per account**, stamped once at
  creation from `REQUIRE_EMAIL_VERIFICATION` and **never re-read from the
  environment**.
- **Existing accounts have `verification_required = false`** — this is the
  column default, which *is* the grandfathering rule. The migration
  deliberately backfills nothing; setting `email_verified_at = now()` on
  existing rows would record a verification that never happened.
- Admin-created accounts also get `false` — the admin is the vouching party.
- **A pending/unverified account consumes no slot.** It reserves its email and
  username only. Confirming the link is what activates it and takes one of
  the 50.
- **Concurrency-safe.** Redemption runs inside `withCapacityLock` — the same
  advisory lock, predicate and transaction as sign-up — and answers 409 rather
  than letting the platform exceed the limit. The refused token is left
  **unconsumed**, so the same link works once a place frees up.
- The link is redeemed by **POST from a button**, not GET, because mail filters
  and link-preview bots fetch every URL in a message and a GET would be spent
  by a scanner before the recipient ever clicked.
- Only the **SHA-256 of the token** is stored (`email_verifications` table).
- Resend endpoint answers identically whether or not the account exists, and
  only ever mails the address already on the account.
- `MAIL_OUTBOX_DIR` writes the real composed message to a file instead of
  sending — how the flow is tested with no provider. **Never set in production.**

### What was verified

- **76 browser checks** over the whole flow (`scratchpad/verifyflow.mjs`),
  against real Postgres and real Chrome — including a grandfathered account
  signing in by email *and* by username while verification was on.
- **44 checks** on the race (`scratchpad/verifyrace.mjs`): 6 simultaneous
  confirmations against 1 free place, 4 rounds — **exactly one winner each
  round, five 409s, count never above the limit.**
- **251 unit tests**, typecheck, lint, production build — all green.
- **Migration rehearsal** from the previously committed schema with planted
  pre-existing accounts: additive, idempotent, existing rows untouched.
- The 21 pre-existing browser suites still pass.

### Architectural decisions worth not re-litigating

1. **Grandfathering by column, not by backfill.** The predicate reads
   `verification_required`, never the env var, so it is a constant string.
   Turning the flag off and on cannot retroactively lock anyone out.
   *(This also fixed a latent fault: the earlier inert design interpolated the
   flag into the SQL, so enabling verification would have stopped counting all
   9 existing users and freed 9 places that were not free.)*
2. **Pending accounts hold no slot**, so the slot is taken at verification —
   which is precisely why verification must be capacity-checked and refusable.
3. **No email provider is required for the app to run.** Missing transport
   raises at the point of sending; it never silently sends nothing, and
   Admin → Users warns on screen if verification is on without one.

---

## External configuration still required

| Item | Value |
|---|---|
| Domain | `rosalytics.com` |
| DNS management | **GoDaddy** |
| Planned sender | `info@rosalytics.com` |
| Planned provider | **Resend** (free tier: 3,000/month) |

### Remaining sequence

- **Step 2 — Configure Resend DNS records in GoDaddy.** ← **RESUME HERE**
  Three records: DKIM `TXT resend._domainkey`, SPF `TXT send`, and
  `MX send` → `feedback-smtp.<region>.amazonses.com` priority 10.
  **GoDaddy appends the domain to the Name field** — enter `send`, not
  `send.rosalytics.com`. The MX goes on the `send` subdomain, **never the
  root**, so the existing `info@rosalytics.com` mailbox is unaffected; do not
  edit or replace any root MX record.
- **Step 3** — Verify `rosalytics.com` in Resend and configure
  `info@rosalytics.com` as the sender.
- **Step 4** — Securely configure `RESEND_API_KEY`, `MAIL_FROM` and `APP_URL`
  in the **Render dashboard** (never in a file, never in chat). `APP_URL` is the
  public origin; confirmation links are built from it and it is deliberately not
  inferred from the `Host` header.
- **Step 5** — Test a real verification email **while
  `REQUIRE_EMAIL_VERIFICATION` remains OFF**, so a broken send cannot block
  real sign-ups.
- **Step 6** — Only after a real email has successfully arrived, enable
  `REQUIRE_EMAIL_VERIFICATION=true`.

While the Resend domain is unverified, Resend delivers only to the address the
Resend account was created with — useful for Step 5.

---

## Pending Neon migration

Checked directly against production on 2026-08-16. Production is at **9 active
non-admin accounts + 1 admin = 10 total**, comfortably under the 50 cap.
Everything earlier (feedback, gratitude, monthly reflections, day priorities,
terms, names, `email_verified_at`) **is already applied**. Only two objects from
commit `0487b54` are missing:

- table `email_verifications`
- column `users.verification_required`

**Before the next production deploy of `0487b54` or later, run against Neon:**

```
DATABASE_URL='<Neon connection string>' npm run db:deploy
```

Both halves (`db:setup && db:migrate`) are idempotent and additive. Nothing is
dropped, backfilled or rewritten; existing rows take
`verification_required = false` from the column default.

> Until this runs, a deployed build will fail on any query touching those
> objects. Running it while verification is OFF is safe and changes no
> behaviour.

---

## Other outstanding items

- **Owner action, security:** rotate the OpenAI key that appeared in an earlier
  screenshot; rotate the Neon password that was pasted into chat; delete
  `ADMIN_PASSWORD` from Render if still present (no env var is a credential
  anywhere in this app).
- Render env: `PG_POOL_MAX` should be `5`; `PG_IDLE_MS` should be unset.
- Free tier: the service sleeps after ~15 min idle and Neon suspends too, so the
  first request after a quiet spell is slow. Expected, not a fault.

---

## Handoff protocol

Update this file at each meaningful milestone, or whenever the owner says work
is stopping — recording: what was completed, relevant commits, what was
verified, architectural decisions, outstanding work, external configuration
still required, the exact next step, and anything that must not be changed.
Verify claims against the repository before writing them.
