import { body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { saveFeedback } from "@/lib/db/queries";
import { ApiError, check } from "@/lib/http";
import {
  FEEDBACK_TYPES, MAX_BODY, MAX_SCREENSHOT_BYTES, SCREENSHOT_TYPES, pagePath,
} from "@/lib/feedback";
import { appVersion } from "@/lib/env";

/**
 * Submitting feedback about Rich Habits.
 *
 * Write-only, on purpose. There is no GET here and no user-facing read
 * anywhere: a user submits and that is the end of their side of it. That is
 * what makes the admin's private note structurally unreachable rather than
 * merely filtered — there is no response it could be left out of.
 *
 * The user id comes from the session. Only the page path, the build and the
 * language travel with it: no habit, goal, note, metric or amount is read here
 * or anywhere in this path.
 */
export async function POST(request: Request) {
  return withUser(async (userId) => {
    const b: any = await body(request);

    const text = check.text(b?.body, "body", MAX_BODY).trim();
    if (!text) throw new ApiError("Write something first");

    const rating = b?.rating == null || b?.rating === "" ? null : Number(b.rating);
    if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
      throw new ApiError("rating must be between 1 and 5");
    }

    /*
     * The screenshot arrives as a base64 data URL, already downscaled by the
     * browser. It is decoded and size-checked here as well: a client that
     * skipped the downscale must not be able to write a megabyte past the cap.
     */
    let screenshot: Buffer | null = null;
    let screenshotType: string | null = null;
    if (typeof b?.screenshot === "string" && b.screenshot.startsWith("data:")) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(b.screenshot);
      if (!match) throw new ApiError("That image could not be read");
      const [, mime, data] = match;
      if (!SCREENSHOT_TYPES.includes(mime as any)) {
        throw new ApiError("A screenshot must be a JPEG, PNG or WebP");
      }
      screenshot = Buffer.from(data, "base64");
      if (screenshot.length > MAX_SCREENSHOT_BYTES) {
        throw new ApiError("That screenshot is too large");
      }
      screenshotType = mime;
    }

    await saveFeedback(userId, {
      type: check.oneOf(b?.type ?? "general", FEEDBACK_TYPES, "type"),
      body: text,
      rating,
      screenshot,
      screenshotType,
      // The path only — a query string can carry ids and search terms.
      page: pagePath(typeof b?.page === "string" ? b.page : ""),
      appVersion,
      locale: typeof b?.locale === "string" ? b.locale.slice(0, 8) : "",
    });

    /*
     * That feedback was submitted is a product signal. What it said is not:
     * no text, no rating, no page, no screenshot goes into analytics.
     */
    await trackEvent({ userId, event: "feedback_submitted", page: "/feedback" });
  });
}
