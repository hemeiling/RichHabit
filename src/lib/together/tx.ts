import { transaction } from "@/lib/db/pool";
import { TogetherError } from "@/lib/together/access";

/**
 * Together's transactions: `transaction()` from the pool, plus what a shared
 * space needs when several people — or an administrator deleting an account —
 * act on the same board at the same moment.
 *
 *   40P01 deadlock / 40001 serialization failure
 *       PostgreSQL aborted this attempt, which changed nothing. Retried a couple
 *       of times; if it keeps losing, the person is asked to try again.
 *   23503 foreign-key violation
 *       an account or board this action refers to was deleted meanwhile — the
 *       person is asked to try again (the retry will see it gone).
 *
 * Never a raw 500 for an expected race; anything else is a real bug and is left
 * to surface. Every attempt is a whole transaction from the start, so a retry
 * repeats nothing that committed.
 */
const RETRYABLE = new Set(["40P01", "40001"]);
export const MAX_ATTEMPTS = 3;

type Run = <T>(fn: Parameters<typeof transaction<T>>[0]) => Promise<T>;

export async function togetherTransaction<T>(
  fn: Parameters<typeof transaction<T>>[0], run: Run = transaction,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run(fn);
    } catch (e) {
      if (e instanceof TogetherError) throw e;
      const code = (e as { code?: unknown })?.code;
      if (typeof code === "string" && RETRYABLE.has(code)) {
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 15 * attempt + Math.random() * 25));
          continue;
        }
        throw new TogetherError("conflict", 409);
      }
      if (code === "23503") {
        // Expected when an account or board is deleted mid-action; logged so a
        // real bug cannot hide behind "please try again".
        console.warn("[together] foreign-key conflict:", (e as { constraint?: string }).constraint ?? "unknown");
        throw new TogetherError("conflict", 409);
      }
      throw e;
    }
  }
}
