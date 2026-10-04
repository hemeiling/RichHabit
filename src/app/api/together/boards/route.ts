import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { getLocale } from "@/lib/i18n/server";
import { createBoard } from "@/lib/together/boards";
import { togetherRoute } from "@/lib/together/route";

/**
 * A new board, owned by the caller. Selected People are invited in-platform and
 * typed addresses by email; nobody joins until they accept. Addresses whose
 * email could not be sent come back so the creator can retry from the board.
 */
export async function POST(request: Request) {
  return togetherRoute(async (userId) => {
    const b = await body<{ name?: unknown; people?: unknown; emails?: unknown }>(request);
    const { id, invited, emailed, failedEmails } = await createBoard(userId, b.name, b.people, b.emails, getLocale());
    // Counts, never a name: board names are the members' own words.
    await trackEvent({ userId, event: "together_board_created", page: "/together",
      properties: { people: invited, emails: emailed } });
    return { id, failedEmails };
  });
}
