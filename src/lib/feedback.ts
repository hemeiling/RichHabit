/**
 * Feedback: from a user of Rich Habits to whoever runs it, about Rich Habits.
 *
 * Not habit tracking, not coaching, not reflection. Nothing here is ever shown
 * back to the person as part of their own record, and nothing of theirs — no
 * habit, goal, note, metric or amount — is attached to it. What travels with a
 * submission is the page they were on, the build they were running, the
 * language they were reading, and what they chose to write.
 *
 * Pure: the shapes and the vocabulary, with no `pg` and no React, so the form,
 * the route and the admin screens all agree about what a submission is.
 */

export const FEEDBACK_TYPES = ["bug", "feature", "suggestion", "general"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_STATUSES = ["new", "reviewing", "planned", "resolved"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/**
 * Which part of the product a piece of feedback is about. The admin assigns it;
 * the user is not asked, because they should not have to know how the app is
 * divided up to report that something is broken.
 */
export const FEEDBACK_AREAS = [
  "today", "habits", "week", "insights", "coach", "account", "admin", "mobile", "other",
] as const;
export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];

/** English labels for the admin screens, which are not translated. */
export const AREA_LABELS: Record<FeedbackArea, string> = {
  today: "Today", habits: "Habits", week: "Week", insights: "Insights",
  coach: "AI Coach", account: "Account/Login", admin: "Admin",
  mobile: "Mobile/UI", other: "Other",
};
export const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "Bug", feature: "Feature request", suggestion: "Suggestion",
  general: "General feedback",
};
export const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New", reviewing: "Reviewing", planned: "Planned", resolved: "Resolved",
};

export const MAX_BODY = 4000;
/** A megabyte, matching the column's check. Downscaled in the browser first. */
export const MAX_SCREENSHOT_BYTES = 1_048_576;
export const SCREENSHOT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * The technical context gathered automatically.
 *
 * Listed explicitly, as a closed shape, so that "what do we collect" has an
 * answer that can be read in one place rather than inferred from call sites —
 * and so adding anything to it is a visible change.
 */
export interface FeedbackContext {
  /** The route the user was on, e.g. "/more/spending". Never query strings. */
  page: string;
  appVersion: string;
  locale: string;
}

/** Query strings can carry ids and search terms; the path alone is the context. */
export function pagePath(href: string): string {
  try {
    return new URL(href, "http://x").pathname.slice(0, 120);
  } catch {
    return "";
  }
}
