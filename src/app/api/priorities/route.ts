import { body, requireId, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import {
  addPriority, deletePriority, reorderPriorities, setPriorityDone,
} from "@/lib/db/queries";
import { parseNewPriority, parsePriorityDone } from "@/lib/validate";

/**
 * The post-it. Private user content: what someone means to do is never read by
 * an admin screen and never leaves this account.
 *
 * A route per record rather than one "save the day" call. That is not a style
 * preference — an open priority belongs to no single day, so a whole-day write
 * would have to send the rolled-over lines back with every keystroke and the
 * server would have to guess which of them were meant to be new.
 */
export async function POST(request: Request) {
  return withUser(async (userId) => {
    const { id, text, date } = parseNewPriority(await body(request));
    await addPriority(userId, id, text, date);
    // That one was written, and on which day. Never a word of what it says.
    await trackEvent({
      userId, event: "priority_added", entityType: "priority", entityId: id, page: "/today",
    });
  });
}

export async function PATCH(request: Request) {
  return withUser(async (userId) => {
    const b: any = await body(request);

    if (Array.isArray(b?.ids)) {
      await reorderPriorities(userId, b.ids.map((v: unknown) => String(v)));
      return;
    }

    const { id, done, date } = parsePriorityDone(b);
    await setPriorityDone(userId, id, done, date);
    await trackEvent({
      userId, event: done ? "priority_completed" : "priority_reopened",
      entityType: "priority", entityId: id, page: "/today",
    });
  });
}

export async function DELETE(request: Request) {
  return withUser(async (userId) => {
    const id = requireId(request);
    await deletePriority(userId, id);
    await trackEvent({
      userId, event: "priority_deleted", entityType: "priority", entityId: id, page: "/today",
    });
  });
}
