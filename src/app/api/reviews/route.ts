import { body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { saveReview } from "@/lib/db/queries";
import { parseReview } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const review = parseReview(await body(request));
    await saveReview(userId, review);
    await trackEvent({
      userId, event: "weekly_review_completed", entityType: "review",
      entityId: review.id, page: "/more/review",
    });
  });
}
