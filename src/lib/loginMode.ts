export type LoginMode = "signin" | "signup";

/**
 * Which state the sign-in screen opens in, from `?mode=`.
 *
 * The front page's two buttons are the only thing that sets it. Anything other
 * than the one recognised value opens the returning-visitor form, so a
 * hand-edited or stale URL can never land somebody in a half-configured state —
 * and nothing about authentication itself is decided here.
 */
export const initialLoginMode = (value?: string | string[] | null): LoginMode =>
  (Array.isArray(value) ? value[0] : value) === "signup" ? "signup" : "signin";

/**
 * Where to go after signing in, from `?then=`. A fixed allow-list of internal
 * paths chosen by a keyword — never a URL taken from the query — so this cannot
 * become an open redirect. Today the only one is a Together invitation, which
 * keeps its token in the browser's session storage rather than in any URL.
 */
const RETURNS: Readonly<Record<string, string>> = { "together-invite": "/together/invite" };
export const loginReturnPath = (value?: string | string[] | null): string | undefined => {
  const key = Array.isArray(value) ? value[0] : value;
  return key && Object.hasOwn(RETURNS, key) ? RETURNS[key] : undefined;
};
