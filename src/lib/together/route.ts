import { ApiError, withUser } from "@/lib/api";
import { getDict } from "@/lib/i18n/server";
import { TogetherError } from "@/lib/together/access";

/**
 * Every signed-in Together route runs through this: the account comes from the
 * session (`withUser`) and nowhere else, and a refusal from the Together layer
 * is translated into the reader's language here, at the edge, so the database
 * code never needs the dictionaries.
 */
export function togetherRoute(fn: (userId: string) => Promise<unknown>) {
  return withUser(async (userId) => {
    try {
      return await fn(userId);
    } catch (e) {
      if (e instanceof TogetherError) {
        throw new ApiError(getDict().together.errors[e.code], e.status);
      }
      throw e;
    }
  });
}
