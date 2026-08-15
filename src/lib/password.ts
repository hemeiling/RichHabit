/**
 * What makes a password acceptable, and how strong it looks.
 *
 * Pure and free of React and `pg`, so the meter the admin sees and the rule the
 * server enforces are the same code. A form that accepts what the server then
 * rejects is worse than no meter at all.
 *
 * The strength score is advice; `problems` is the rule. Only `problems` decides
 * whether an account can be created, and the server checks it again regardless
 * of what any client believed.
 */

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 200;

export type PasswordProblem = "too_short" | "too_long" | "too_simple";

/**
 * Rejected outright: everything one character, an obvious sequence, or one of
 * the handful of passwords that turn up at the top of every breach list. This
 * is not a dictionary check — it is a floor, so "12345678" cannot be set on an
 * account someone else has to live with.
 */
const BANNED = new Set([
  "password", "password1", "passw0rd", "12345678", "123456789", "1234567890",
  "qwertyui", "qwerty123", "letmein1", "iloveyou", "admin123", "welcome1",
  "abc12345", "11111111", "00000000", "richhabits",
]);

const isRun = (value: string) => {
  if (value.length < 4) return false;
  const codes = [...value].map((c) => c.charCodeAt(0));
  const step = codes[1] - codes[0];
  return (step === 1 || step === -1) && codes.every((c, i) => i === 0 || c - codes[i - 1] === step);
};

/** Empty when the password may be used. */
export function passwordProblems(raw: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (raw.length < MIN_LENGTH) problems.push("too_short");
  if (raw.length > MAX_LENGTH) problems.push("too_long");

  const lower = raw.toLowerCase();
  const oneCharacter = raw.length > 0 && new Set(raw).size === 1;
  if (BANNED.has(lower) || oneCharacter || isRun(lower)) problems.push("too_simple");

  return problems;
}

export interface Strength {
  /** 0–4. Advice for the person choosing, never a gate. */
  score: 0 | 1 | 2 | 3 | 4;
  label: "very weak" | "weak" | "fair" | "good" | "strong";
}

/**
 * Length first, variety second — which is the right way round. A long
 * passphrase of ordinary words beats eight characters of punctuation, and a
 * meter that says otherwise teaches people to choose worse passwords.
 */
export function passwordStrength(raw: string): Strength {
  if (!raw) return { score: 0, label: "very weak" };
  if (passwordProblems(raw).includes("too_simple")) return { score: 0, label: "very weak" };

  let score = 0;
  if (raw.length >= MIN_LENGTH) score += 1;
  if (raw.length >= 12) score += 1;
  if (raw.length >= 16) score += 1;

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(raw)).length;
  if (classes >= 3) score += 1;

  const bounded = Math.max(0, Math.min(4, score)) as Strength["score"];
  return {
    score: bounded,
    label: (["very weak", "weak", "fair", "good", "strong"] as const)[bounded],
  };
}
