import { body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { saveJournal } from "@/lib/db/queries";
import { parseJournal } from "@/lib/validate";

/**
 * The day's gratitude journal. Private user content: what is written here is
 * never read by an admin screen and never leaves the account.
 */
export async function POST(request: Request) {
  return withUser(async (userId) => {
    const { date, gratitude, reflection } = parseJournal(await body(request));
    await saveJournal(userId, date, gratitude, reflection);
    /*
     * That someone journalled, and how many entries — never a word of what they
     * wrote. The count is what makes adoption measurable without reading
     * anybody's journal.
     */
    await trackEvent({
      userId, event: "gratitude_recorded", page: "/today",
      properties: { entries: gratitude.length, hasReflection: reflection.trim().length > 0 },
    });
  });
}
