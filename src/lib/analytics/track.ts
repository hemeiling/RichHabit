import { headers } from "next/headers";
import { query } from "@/lib/db/pool";
import { APP_VERSION, FEATURE_OF_EVENT, SESSION_IDLE_MINUTES } from "./config";

/**
 * The one place product-usage events are written.
 *
 * Two rules shape this file:
 *
 *   1. **Analytics may never break the app.** Every call is wrapped; a failure
 *      is logged and swallowed. Checking off a habit must succeed even if the
 *      events table is unreachable or full.
 *   2. **Nothing personal goes in.** Callers pass an entity *id*, never a habit
 *      name, note, metric value or goal description. `properties` is for counts
 *      and enums — see `sanitise` below, which drops anything else.
 */

export interface TrackInput {
  userId: string;
  event: string;
  entityType?: string;
  entityId?: string | null;
  page?: string;
  /** Numbers, booleans and short enum-ish strings only. */
  properties?: Record<string, unknown>;
}

/** Device class from the User-Agent — a category, not a fingerprint. */
function deviceType(ua: string | null): string | null {
  if (!ua) return null;
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}

/**
 * Free text is where private information leaks into analytics by accident, so
 * strings are only kept when they are short and look like an enum. Anything
 * longer is dropped rather than truncated — a truncated note is still a note.
 */
function sanitise(props: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && v.length <= 32 && !/\s{2,}/.test(v)) out[k] = v;
  }
  return out;
}

/**
 * The caller's current session, or a new one.
 *
 * A session is a run of activity with no gap longer than SESSION_IDLE_MINUTES.
 * This writes on real interactions only — there is no heartbeat and nothing
 * polls, so a long reading session costs one row, not one row per few seconds.
 */
async function resolveSession(
  userId: string, tz: string | null, device: string | null,
): Promise<string> {
  const open = await query<{ id: string }>(
    `update user_sessions
        set last_activity_at = now(), event_count = event_count + 1
      where id = (
        select id from user_sessions
         where user_id = $1
           and last_activity_at > now() - ($2 || ' minutes')::interval
         order by last_activity_at desc
         limit 1
      )
      returning id`,
    [userId, String(SESSION_IDLE_MINUTES)],
  );
  if (open[0]) return open[0].id;

  const created = await query<{ id: string }>(
    `insert into user_sessions (user_id, device_type, timezone, event_count)
     values ($1, $2, $3, 1) returning id`,
    [userId, device, tz],
  );
  return created[0].id;
}

/**
 * Records one event. Never throws.
 *
 * Awaited by callers so the write lands inside the request — Next may freeze
 * the runtime once a response is returned, and a floating promise would be
 * dropped. It is a single insert on an indexed table, so the cost is small.
 */
export async function trackEvent(input: TrackInput): Promise<void> {
  try {
    const h = headers();
    const tz = h.get("x-rh-timezone");
    const device = deviceType(h.get("user-agent"));
    const sessionId = await resolveSession(input.userId, tz, device);

    await query(
      `insert into analytics_events
         (user_id, session_id, event_name, event_category, feature, page,
          entity_type, entity_id, properties, user_timezone, app_version)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.userId,
        sessionId,
        input.event,
        FEATURE_OF_EVENT[input.event] ? "feature" : "lifecycle",
        FEATURE_OF_EVENT[input.event] ?? null,
        input.page ?? null,
        input.entityType ?? null,
        input.entityId ?? null,
        JSON.stringify(sanitise(input.properties)),
        tz,
        APP_VERSION,
      ],
    );
  } catch (e) {
    // Swallowed on purpose. Losing an event is a reporting gap; failing the
    // request would lose the user's actual work.
    console.error("[analytics] event dropped:", e instanceof Error ? e.message : e);
  }
}
