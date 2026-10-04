# Together — architecture and invariants

Together is RichHabit's shared-work area: small boards that a few people work on
together. It is deliberately separate from each person's private RichHabit data —
habits, priorities, intention, journal and Important Dates are never read or
shown by anything in Together.

Phases: **V1A** (this foundation) · V1B groups, items, assignees · V1C notes and a
board calendar derived from tasks · V1D calendar pins, a CalendarItem adapter,
public launch. Eight tables in total by the end of V1.

## Rollout and access

`TOGETHER_PREVIEW_USER_IDS` (server only) lists the user UUIDs in the preview.
It is read only in `src/lib/together/access.ts`. An empty list switches Together
off for everyone, invitations included. Otherwise each account has one of:

| Access | Who | May |
| --- | --- | --- |
| **full** | on the list | everything: create boards, invite (People or email) |
| **invited** | not on the list, but a member of a board or holding an open in-platform invitation | see its own boards and invitations, accept/decline, act as a member (and as owner if ownership passes to it), leave — **not** create boards or invite |
| none | everyone else | nothing: no nav item, pages render not-found, APIs answer 404 |

Accepting an **emailed** invitation needs no access level at all: the token, the
matching address and the invitation's validity decide. That is the narrow door
by which a new or non-preview account reaches the one board it was invited to.
Holding an unaccepted email invitation grants nothing. New access therefore
always originates from someone on the list.

The client receives only a boolean and a waiting-invitation count for the
signed-in account (the nav item and its quiet dot) — never the list.

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
6. **Nobody becomes a member without accepting.** The creator becomes owner;
   everyone else joins only by accepting an invitation. **People are derived**
   (everyone you share a board with, no contact table) and are whom you can
   invite *in-platform*, never whom you can enroll.
7. **Removal is effective until a new invitation is accepted.** Removing or
   leaving withdraws every open invitation *for* that person on that board (and
   every one *they* sent), so only an invitation created afterwards, explicitly
   accepted, restores access. Any member with full access may re-invite.
8. **Analytics carry counts, booleans and a channel name only** — never names, addresses or
   board content.

## Invitations

One table, two kinds, both pending until answered:

- **In-platform** (`invitee_id`): to someone in the inviter's People, chosen
  when creating a board or from the board's "Invite from People". No email. It
  waits in the invitee's Together home (Invitations · 邀请) with Accept and
  Decline, and the navigation (and, on a phone, the menu button) shows a quiet
  dot. Members, people this inviter already invited, and people who declined
  this inviter's invitation in the last 7 days are skipped; 50 per inviter a day.
- **Email** (`email_normalized` + `token_hash`): to any typed address — always
  email, even if the address belongs to someone in the inviter's People, so the
  inviter learns nothing about who has an account. Visible in-platform to nobody.

Invitations are **per inviter**: at most one open per board, invitee and inviter.
A retry replaces the inviter's own and never touches — or reveals — another
member's. Accepting any one closes every other open invitation for that person
on that board; declining declines every in-platform one, and the invitee sees
one card per board.

Answers: `accepted_at` / `declined_at` / `revoked_at` (at most one, by CHECK).
Everything that changes a board's membership or invitations locks the board row
first, so remove, leave, invite and accept are serialized in one order.
Pending entries on a board are shown only to the owner and the sender — an
address for email, a display name for in-platform.

### Email — the failure boundary

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
writes nothing to the account itself; normal sign-up verification applies.

When creating a board, typed addresses are sent one by one after the board
commits; each has its own failure boundary, and any that failed are named back
to the creator ("the board was created, but…") to retry from the board.

### New accounts and verification

Sign up from the invitation → verify the address (required when
`REQUIRE_EMAIL_VERIFICATION` is on) → accept. The token lives in the original
tab's session storage, so either: return to that tab, choose **Back to sign in**
and sign in — the invitation continues; or, if verifying in another tab, sign in
there and **open the invitation link again**. Automatic continuation across tabs
is not built (V1 limitation; both paths are tested).

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
in-platform invitations *to* the deleted account cascade away, and invitations
sent by it cascade away — accepted ones included,
so the record of who invited whom goes with the inviter's account.

**V1B and later:** any new table that references a user must decide its
deletion behaviour explicitly (cascade, or set null to keep shared work), and
tests must cover bulk deletion. Assignees should reference
`together_members (board_id, user_id)` with a composite foreign key so that
leaving or removal clears assignments.

## Known behaviour outside Together

Pages under the `(app)` route group that call `notFound()` render the
not-found page with HTTP 200, because that layout streams; `/admin` pages and
unknown routes return a real 404. Together's APIs are unaffected: they answer
404 for no access and for a board that is missing or not yours, identically.
