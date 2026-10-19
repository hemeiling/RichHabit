/**
 * Accounts another Administrator may not take over from the app (UM-5): any
 * Admin, and anyone who has been one.
 *
 * Three in-app actions hand the acting Admin a way into someone else's account
 * — changing its sign-in email, issuing a temporary password, reissuing a setup
 * link. For an Admin account, none of them is offered: whoever controls an
 * Admin's sign-in acts as that Admin. Recovery stays possible without them —
 * the Admin's own "Change password" while signed in, "Forgot password" for a
 * verified address, and for emergencies the owner's command-line procedure
 * (`npm run admin:password`, see README), which needs the database credentials.
 *
 * "Has been one" matters: without it, demote → act → promote again would step
 * straight around the rule. It reads the role-change trail (`user_role_changed`
 * from `admin`), which every demotion — in the app or by `npm run admin:grant`
 * — writes in the same transaction that makes it.
 *
 * `u` is the alias of the `users` row being judged. Pure SQL, no imports, so
 * the admin service and email verification can share one definition without
 * importing each other.
 */
export const ADMIN_PROTECTED = (u: string) => `(${u}.role = 'admin' or exists (
  select 1 from admin_audit_log was_admin
   where was_admin.target_id = ${u}.id and was_admin.action = 'user_role_changed'
     and was_admin.details->>'from' = 'admin'))`;

const WHY = "This protects Admin accounts: an Admin recovers through their own Change password, "
  + "Forgot password, or the owner's command-line procedure.";

export const ADMIN_PROTECTED_MESSAGE = {
  email: `An Administrator's email — or a former Administrator's — can't be changed here. ${WHY}`,
  reset: `An Administrator's password — or a former Administrator's — can't be reset here. ${WHY}`,
  setup: `An Administrator's setup link — or a former Administrator's — can't be reissued here. ${WHY}`,
} as const;
