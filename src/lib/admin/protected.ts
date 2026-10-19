/**
 * Whose sign-in email an Administrator may NOT change from the app (UM-5).
 *
 * An Admin's email is the way into an Admin account: whoever controls it can
 * reset the password and act as that Admin. Until a change can be approved by
 * a second, independent Admin, the app simply does not offer one — for an Admin,
 * or for anyone who has been one.
 *
 * "Has been one" matters: without it, demote → change the email → confirm →
 * promote again would step straight around the rule. It reads the role-change
 * trail (`user_role_changed` from `admin`), which every demotion inside the app
 * writes in the same request that makes it. Accounts that never held the role
 * are unaffected.
 *
 * Checked twice — when the change is requested and again when the new address
 * is confirmed — so an account promoted in between is protected too.
 *
 * `u` is the alias of the `users` row being judged. Pure SQL, no imports, so
 * the admin service and email verification can share one definition without
 * importing each other.
 */
export const EMAIL_PROTECTED = (u: string) => `(${u}.role = 'admin' or exists (
  select 1 from admin_audit_log was_admin
   where was_admin.target_id = ${u}.id and was_admin.action = 'user_role_changed'
     and was_admin.details->>'from' = 'admin'))`;

export const EMAIL_PROTECTED_MESSAGE =
  "An Administrator's email — or a former Administrator's — can't be changed here. "
  + "This protects Admin accounts until a second Admin can approve such a change.";
