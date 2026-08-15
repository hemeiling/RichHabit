/**
 * What you may type into the first box on the login form.
 *
 * One field, two kinds of account. Which one you meant is decided here rather
 * than by asking, and it is decided the same way on the sign-in route, on the
 * admin create form and in validation — one set of rules, so the thing that
 * lets you in and the thing that let you register cannot disagree about what
 * your name is.
 *
 * Pure, and free of `pg` and React, so it can be unit-tested and used on both
 * sides of the wire.
 */

/** An identifier is an email if it has an `@` in it. Usernames may not. */
export const looksLikeEmail = (value: string) => value.includes("@");

export const MIN_USERNAME = 3;
export const MAX_USERNAME = 30;

/**
 * Username normalisation.
 *
 * Lowercased, because "Emma" and "emma" are the same person and being told
 * otherwise at a login box is maddening. Trimmed, because a trailing space
 * survives a copy-paste and is invisible. Nothing else is rewritten: silently
 * turning "e.mma" into "emma" would mean the name someone was given is not the
 * name that works.
 */
export const normaliseUsername = (value: string) => value.trim().toLowerCase();

/** Emails are compared case-insensitively too; the local part is not, strictly, but nobody relies on that. */
export const normaliseEmail = (value: string) => value.trim().toLowerCase();

/** Trim first: whichever kind it is, the leading and trailing space is noise. */
export const normaliseIdentifier = (value: string) => {
  const trimmed = value.trim();
  return looksLikeEmail(trimmed) ? normaliseEmail(trimmed) : normaliseUsername(trimmed);
};

/**
 * Letters, digits, and single interior dots, hyphens or underscores.
 *
 * No `@`, or a username could be mistaken for an email and resolve against the
 * wrong column. No leading or trailing punctuation, and no run of it, because
 * "emma..jones" and "emma.jones" are impossible to tell apart when read aloud
 * — which is how a managed account's name usually travels.
 */
const USERNAME = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

export interface UsernameProblem {
  reason: "too_short" | "too_long" | "shape";
}

/** Null when the username is fine. */
export function checkUsername(raw: string): UsernameProblem | null {
  const value = normaliseUsername(raw);
  if (value.length < MIN_USERNAME) return { reason: "too_short" };
  if (value.length > MAX_USERNAME) return { reason: "too_long" };
  if (!USERNAME.test(value)) return { reason: "shape" };
  return null;
}

/** A deliberately loose check — the authority on an address is whether mail arrives. */
export function isPlausibleEmail(raw: string): boolean {
  const value = normaliseEmail(raw);
  if (value.length > 254) return false;
  const at = value.indexOf("@");
  return at > 0 && at === value.lastIndexOf("@") && at < value.length - 1
    && !value.includes(" ");
}
