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
