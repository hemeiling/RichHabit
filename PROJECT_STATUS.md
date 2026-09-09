# RichHabit — Project Status

> Last updated: 2026-09-09
> Status: read-only inspection helper fixed and verified locally; no production inspection or deployment was performed because no valid rotated read-only production credential is available in this shell.

## Before
- Production priority count: not established yet.
- Production unfinished count: not established yet.
- Production schema status: not established yet.
- Production credential status: no valid rotated `RH_PROD_READONLY_URL` currently available in this session.

## Changes
- [scripts/inspect-prod-readonly.mjs](scripts/inspect-prod-readonly.mjs): fixed the fail-closed privilege validation to use PostgreSQL-valid checks only; removed the invalid table-level `ALTER` privilege check.
- [tests/inspect-prod-readonly.test.ts](tests/inspect-prod-readonly.test.ts): verified the helper accepts a safe read-only fixture, rejects a write-capable fixture, and never prints credentials.
- [package.json](package.json): added the explicit `inspect:prod` command.
- Local app DB config remained unchanged. No production DB or app config was switched.

## Verification
Fresh proof command:
- `npm test -- --run tests/inspect-prod-readonly.test.ts`
- Result: 1 file passed, 3/3 tests passed.

Additional note:
- The helper is intentionally fail-closed and will not run without a valid, non-local `RH_PROD_READONLY_URL`.
- No production inspection query was executed because the required credential is not presently available.

## After
- Production priority count: not yet inspected.
- Four-quadrant status: implemented locally, not yet deployed.
- Previous-data status: not yet established in production.
- Deployment status: not deployed.
- Production verification status: not run.

## State progression
- Implemented locally: yes
- Committed: not yet
- Pushed: not yet
- Migration applied: not yet
- Deployed: no
- Production verified: no

## Safety gate
If a valid rotated production read-only credential becomes available, the next step is to run `npm run inspect:prod` only with that credential present. No production database write or migration will be run until the baseline is established and the data-preservation conditions are confirmed.
