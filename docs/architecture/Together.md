# Together — architecture and invariants

Together is RichHabit's shared-work area: small boards that a few people work on
together. It is deliberately separate from each person's private RichHabit data —
habits, priorities, intention, journal and Important Dates are never read or
shown by anything in Together.

Phases: **V1A** (this foundation) · V1B groups, items, assignees · V1C notes and a
board calendar derived from tasks · V1D calendar pins, a CalendarItem adapter,
public launch. Eight tables in total by the end of V1.

## Rollout

`TOGETHER_PREVIEW_USER_IDS` (server only) lists the user UUIDs allowed in. It is
read in one place, `togetherEnabledFor()` in `src/lib/together/access.ts`. The
client receives only a boolean for the signed-in account (the nav item). Outside
the list: no nav item, pages render not-found, every API answers 404, and an
invitation cannot be accepted.

## Layers

| Layer | Where |
| --- | --- |
| Access, errors, display name | `src/lib/together/access.ts` |
| Boards, membership, People | `src/lib/together/boards.ts` |
| Invitations | `src/lib/together/invitations.ts` |
| Route wrapper (session, gate, translated errors) | `src/lib/together/route.ts` |
| API | `src/app/api/together/**` — every handler is `return togetherRoute(...)`, except the signed-out invitation preview |
| Screens | `src/components/together/*`, `src/app/(app)/together/**`, `src/app/together/invite` |
| Schema | `scripts/migrations/together-v1a.mjs` (runner step 15), mirrored in `db/schema.sql` |

## Invariants every later phase must keep

1. **Every board access goes through `requireBoard(q, userId, boardId, opts)`.**
   A non-member gets the same 404 as a missing board. `owner: true` is for
   administration; `write: true` refuses archived boards (409); `lock: true`
   locks the caller's membership row for the transaction.
2. **Exactly one owner per board**, enforced by a partial unique index. The owner
   cannot leave; ownership changes hands only through the account-deletion
   trigger in V1.
3. **Archived boards are read-only for everyone.** Only the owner restores.
   Membership housekeeping stays open (remove, leave, withdraw an invitation),
   because each only takes access away.
4. **Identity comes from the session**, never from the request body.
5. **Other members see a display name, never an email address.** Pending
   invitation addresses are visible only to the owner and to whoever sent them.
6. **People are derived** (everyone you share a board with); you can add only
   People directly — anyone else needs an invitation.
7. **Analytics carry counts and booleans only** — never names, addresses or
   board content.

## Invitations — the failure boundary

1. In one transaction: revoke any open invitation for the same board and
   address, and insert a new one with `sent_at` null (unusable).
2. Send the email. If sending fails: revoke the row and report failure.
3. Activate (`sent_at = now()`) only if the row is still open; otherwise report
   failure.

Preview and acceptance require `sent_at`. Therefore a reported failure is never
usable, every emailed token has a committed row, and retries leave exactly one
usable invitation. Tokens are 32 random bytes carried in the URL fragment (never
sent to a server by the browser), stored only as SHA-256, valid 14 days, single
use, and accepted only by the signed-in account with that address. Accepting
also marks that account's address verified (`users.email_verified_at`, only if
unset): opening the link proves the inbox.

Invitation creation locks the board row and takes a per-inviter advisory lock,
so two members inviting the same address at once, or one inviter racing the
daily limit, are serialized. Both locks end before the email is sent.

## Account deletion

`together_before_user_delete` (`BEFORE DELETE ON users`, per row) hands each board
the deleted user owns to the longest-standing remaining member, or deletes the
board when nobody remains. "Remaining" joins `users`, which excludes accounts
already deleted earlier in the same statement — this is what makes admin bulk
deletion safe. The heir's membership row is locked (`for update`), so a member
whose account a concurrent transaction is deleting is waited for and skipped;
if a promotion still updates nothing, the next member is tried. Every change
it makes is one the cascades would make anyway.
Memberships cascade; `created_by`, `added_by` and `accepted_by` become null;
invitations sent by the deleted account cascade away — accepted ones included,
so the record of who invited whom goes with the inviter's account.

**V1B and later:** any new table that references a user must decide its
deletion behaviour explicitly (cascade, or set null to keep shared work), and
tests must cover bulk deletion. Assignees should reference
`together_members (board_id, user_id)` with a composite foreign key so that
leaving or removal clears assignments.
