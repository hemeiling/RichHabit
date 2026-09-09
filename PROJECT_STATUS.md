# RichHabit — Project Status

> Last updated: 2026-09-09
> Status: local verification complete; no production deploy was performed in this session.

## 1. Current Work

### Today priorities / Eisenhower matrix
- [x] Redesigned the priority panel into a 2x2 matrix with an Unsorted bucket.
- [x] New priorities default to the unsorted quadrant until the user explicitly classifies them.
- [x] Existing priorities remain backward compatible and default to unsorted when they lack category metadata.
- [x] Drag-and-drop ordering is persisted per quadrant while preserving original user sequence when sort order is equal.
- [x] Original rollover behavior remains intact: same record ID, original creation date, same category, manual ordering within that category.
- [x] Added the safe additive schema path for category/sort metadata without breaking older records.

Relevant files:
- [src/components/Priorities.tsx](src/components/Priorities.tsx)
- [src/lib/priorities.ts](src/lib/priorities.ts)
- [src/lib/types.ts](src/lib/types.ts)
- [src/lib/db/queries.ts](src/lib/db/queries.ts)
- [db/schema.sql](db/schema.sql)
- [scripts/migrate.mjs](scripts/migrate.mjs)

## 2. Verification

Fresh proof run:
- `npm run typecheck && npm test -- --run tests/priorities.test.ts`
- Result: 34/34 tests passed.

Additional checks:
- `npm run lint` → passed
- `npm run build` → passed

Notes:
- The build shows warnings about `maxDuration` config in the coach/recommendation routes, but Next.js still completed the production build successfully. These warnings are not blocking the priority fix.

## 3. Risk / Deployment Notes

- The migration path is additive and non-destructive.
- Legacy rows are treated as unsorted rather than filtered out or reset.
- No production deployment or database write was performed in this session.

## 4. Recommended Next Step

1. Review the matrix in a real browser session and smoke-test the drag/drop flow with a signed-in account.
2. If the product owner approves release, deploy with the existing additive migration and confirm the Today page still loads for older rows without masquerading as an empty account.
3. After deployment, verify a legacy user account still shows their existing priorities and preserved ordering without data loss.
