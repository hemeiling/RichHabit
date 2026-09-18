/**
 * The reset link's lifetime, for the screens that quote it.
 *
 * Its own module because the pages are client components and `lib/env` reaches
 * for `process.env` — the number is configuration, and the interface should not
 * state one lifetime while the server enforces another.
 */
export const RESET_TTL_MINUTES = Number(
  process.env.NEXT_PUBLIC_PASSWORD_RESET_TTL_MINUTES || 30,
);
