import { query } from "@/lib/db/pool";
import { ApiError } from "@/lib/http";
import {
  FEEDBACK_AREAS, FEEDBACK_STATUSES, type FeedbackArea, type FeedbackStatus,
} from "@/lib/feedback";

/**
 * The admin's side of feedback: reading it, triaging it, and keeping a private
 * note against it.
 *
 * There is deliberately no user-facing read endpoint anywhere in the app —
 * users submit and that is all — so `admin_note` cannot leak to the person who
 * wrote the feedback. It is not filtered out of a shared response; there is no
 * shared response.
 */

export interface FeedbackRow {
  id: string;
  /** Null once the account is deleted: the row survives, the identity does not. */
  email: string | null;
  type: string;
  body: string;
  rating: number | null;
  hasScreenshot: boolean;
  page: string | null;
  appVersion: string | null;
  locale: string | null;
  status: FeedbackStatus;
  area: FeedbackArea | null;
  adminNote: string | null;
  createdAt: string;
}

const SELECT = `
  select f.id, coalesce(u.email, u.username) as email, f.type, f.body, f.rating,
         (f.screenshot is not null) as has_screenshot,
         f.page, f.app_version, f.locale, f.status, f.area, f.admin_note, f.created_at
    from feedback f left join users u on u.id = f.user_id`;

const map = (r: any): FeedbackRow => ({
  id: r.id, email: r.email ?? null, type: r.type, body: r.body,
  rating: r.rating == null ? null : Number(r.rating),
  hasScreenshot: r.has_screenshot === true,
  page: r.page, appVersion: r.app_version, locale: r.locale,
  status: r.status, area: r.area, adminNote: r.admin_note,
  createdAt: new Date(r.created_at).toISOString(),
});

export async function listFeedback(status?: FeedbackStatus | "all"): Promise<FeedbackRow[]> {
  const rows = status && status !== "all"
    ? await query<any>(`${SELECT} where f.status = $1 order by f.created_at desc limit 200`, [status])
    : await query<any>(`${SELECT} order by f.created_at desc limit 200`);
  return rows.map(map);
}

export async function feedbackById(id: string): Promise<FeedbackRow | null> {
  const rows = await query<any>(`${SELECT} where f.id = $1`, [id]);
  return rows[0] ? map(rows[0]) : null;
}

/** Counts per status, for the tabs. */
export async function feedbackCounts(): Promise<Record<string, number>> {
  const rows = await query<{ status: string; n: string }>(
    "select status, count(*) as n from feedback group by status");
  const counts: Record<string, number> = { all: 0 };
  for (const s of FEEDBACK_STATUSES) counts[s] = 0;
  for (const r of rows) { counts[r.status] = Number(r.n); counts.all += Number(r.n); }
  return counts;
}

export async function updateFeedback(id: string, patch: {
  status?: string; area?: string | null; adminNote?: string;
}) {
  if (patch.status && !FEEDBACK_STATUSES.includes(patch.status as FeedbackStatus)) {
    throw new ApiError("Unknown status");
  }
  if (patch.area && !FEEDBACK_AREAS.includes(patch.area as FeedbackArea)) {
    throw new ApiError("Unknown area");
  }
  const rows = await query<{ id: string }>(
    `update feedback set
       status = coalesce($2, status),
       area = case when $3::boolean then $4 else area end,
       admin_note = case when $5::boolean then $6 else admin_note end,
       updated_at = now()
     where id = $1 returning id`,
    [id, patch.status ?? null, patch.area !== undefined, patch.area || null,
      patch.adminNote !== undefined, patch.adminNote ?? null],
  );
  if (!rows[0]) throw new ApiError("No such feedback", 404);
}

/** The image itself, served only to an admin. */
export async function feedbackScreenshot(id: string) {
  const rows = await query<{ screenshot: Buffer; screenshot_type: string }>(
    "select screenshot, screenshot_type from feedback where id = $1 and screenshot is not null",
    [id]);
  return rows[0] ?? null;
}
