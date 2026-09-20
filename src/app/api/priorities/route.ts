import { body, requireId, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { markMemberStale, viewerToday } from "@/lib/community";
import {
  addPriority, deletePriority, reorderPriorities, savePriorityLayout, setPriorityDone,
  setPriorityPlannedOn, setPriorityText,
} from "@/lib/db/queries";
import { parseNewPriority, parsePriorityDone, parsePriorityPlan, parsePriorityText } from "@/lib/validate";

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
    const { id, text, date, category } = parseNewPriority(await body(request));
    /*
     * The day the allowance is counted against is the server's answer, from the
     * reader's own time zone — the same `viewerToday` the Community board uses.
     * `date` continues to set `created_on`, because which day a line belongs to
     * is the user's business; how many were created today is not.
     */
    await addPriority(userId, id, text, date, category,
      viewerToday(request.headers.get("x-rh-timezone")));
    // That one was written, and on which day. Never a word of what it says.
    await trackEvent({
      userId, event: "priority_added", entityType: "priority", entityId: id, page: "/priorities",
    });
  });
}

export async function PATCH(request: Request) {
  return withUser(async (userId) => {
    const b: any = await body(request);

    if (Array.isArray(b?.layout)) {
      await savePriorityLayout(userId, b.layout.map((v: any) => ({
        id: String(v?.id),
        category: String(v?.category ?? "unsorted"),
        sortOrder: Number(v?.sortOrder ?? 0),
      })));
      return;
    }

    if ("plannedOn" in (b ?? {})) {
      const { id, plannedOn } = parsePriorityPlan(b);
      await setPriorityPlannedOn(userId, id, plannedOn);
      return;
    }

    if (Array.isArray(b?.ids)) {
      await reorderPriorities(userId, b.ids.map((v: unknown) => String(v)));
      return;
    }

    if (typeof b?.text === "string") {
      const { id, text } = parsePriorityText(b);
      await setPriorityText(userId, id, text);
      // That a line was reworded, and which. Never the words, before or after.
      // No Community refresh: the board shows counts, and a count cannot change.
      await trackEvent({
        userId, event: "priority_edited", entityType: "priority", entityId: id, page: "/priorities",
      });
      return;
    }

    const { id, done, date } = parsePriorityDone(b);
    await setPriorityDone(userId, id, done, date);
    // Completing or reopening moves this member's accomplishment count.
    markMemberStale(userId);
    await trackEvent({
      userId, event: done ? "priority_completed" : "priority_reopened",
      entityType: "priority", entityId: id, page: "/priorities",
    });
  });
}

export async function DELETE(request: Request) {
  return withUser(async (userId) => {
    const id = requireId(request);
    await deletePriority(userId, id);
    // A deleted completed priority leaves the accomplishment count.
    markMemberStale(userId);
    await trackEvent({
      userId, event: "priority_deleted", entityType: "priority", entityId: id, page: "/priorities",
    });
  });
}
