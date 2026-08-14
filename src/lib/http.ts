/**
 * Request-shape primitives. Deliberately dependency-free — no Next, no pg — so
 * the validation layer can be imported and tested on its own, and so nothing
 * here can accidentally pull a database connection into a client bundle.
 */

/** An error whose message is safe to show the user, with the status to send. */
export class ApiError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ApiError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Shape checks for anything that reaches SQL. Without these a malformed body
 * becomes a Postgres error — a 500 where a 400 belongs, and a leaked constraint
 * name in the message.
 */
export const check = {
  uuid(v: unknown, field: string): string {
    if (!isUuid(v)) throw new ApiError(`${field} must be a uuid`);
    return v;
  },
  date(v: unknown, field: string): string {
    if (typeof v !== "string" || !ISO_DATE.test(v) || Number.isNaN(Date.parse(v))) {
      throw new ApiError(`${field} must be a YYYY-MM-DD date`);
    }
    return v;
  },
  text(v: unknown, field: string, max = 2000): string {
    const s = typeof v === "string" ? v : "";
    if (s.length > max) throw new ApiError(`${field} is too long`);
    return s;
  },
  oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
    if (typeof v !== "string" || !allowed.includes(v as T)) {
      throw new ApiError(`${field} must be one of ${allowed.join(", ")}`);
    }
    return v as T;
  },
  /** Numeric or null. Rejects NaN/Infinity, which reach Postgres as errors. */
  numberOrNull(v: unknown, field: string): number | null {
    if (v === "" || v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new ApiError(`${field} must be a number`);
    return n;
  },
};
