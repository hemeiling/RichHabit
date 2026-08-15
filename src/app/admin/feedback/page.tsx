import Link from "next/link";
import { requireAdminPage } from "@/lib/admin";
import { feedbackCounts, listFeedback } from "@/lib/admin/feedback";
import { FEEDBACK_STATUSES, STATUS_LABELS, TYPE_LABELS, AREA_LABELS } from "@/lib/feedback";
import type { FeedbackStatus } from "@/lib/feedback";
import { Card, Table, date } from "../ui";

export const dynamic = "force-dynamic";

/**
 * Where feedback about the product is reviewed. Its whole reason for existing
 * is the loop: someone hits a problem → says so → this is read → it gets
 * prioritised → it is marked resolved.
 */
export default async function FeedbackPage(
  { searchParams }: { searchParams: { status?: string } },
) {
  await requireAdminPage();
  const status = (FEEDBACK_STATUSES as readonly string[]).includes(searchParams.status ?? "")
    ? (searchParams.status as FeedbackStatus) : "all";
  const [rows, counts] = await Promise.all([listFeedback(status), feedbackCounts()]);

  const tabs: [string, string][] = [
    ["all", "All"], ...FEEDBACK_STATUSES.map((s) => [s, STATUS_LABELS[s]] as [string, string]),
  ];

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <h1 className="display" style={{ fontSize: 22 }}>Feedback</h1>
        <p className="muted mt-1" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          What users have said about Rich Habits. Nothing from their habits, goals, notes
          or spending is attached — only what they wrote and where they were.
        </p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {tabs.map(([value, label]) => (
            <a key={value} className="chip" data-on={value === status}
              href={value === "all" ? "?" : `?status=${value}`}
              style={{ textDecoration: "none" }}>
              {label} · {counts[value] ?? 0}
            </a>
          ))}
        </div>
      </section>

      <Card title={`${rows.length} shown`}>
        {rows.length === 0 ? (
          <p className="muted" style={{ fontSize: 14 }}>Nothing here yet.</p>
        ) : (
          <Table
            head={["User", "Type", "Feedback", "Rating", "Page", "Area", "Submitted", "Status"]}
            rows={rows.map((f) => [
              <span key="u" className="muted">{f.email ?? "(deleted account)"}</span>,
              TYPE_LABELS[f.type as keyof typeof TYPE_LABELS] ?? f.type,
              <Link key="b" href={`/admin/feedback/${f.id}`} style={{ textDecoration: "underline" }}>
                {f.body.length > 80 ? `${f.body.slice(0, 80)}…` : f.body}
                {f.hasScreenshot && <span className="faint"> · screenshot</span>}
              </Link>,
              f.rating ?? "—",
              <span key="p" className="muted">{f.page ?? "—"}</span>,
              f.area ? AREA_LABELS[f.area] : "—",
              date(f.createdAt),
              STATUS_LABELS[f.status],
            ])}
          />
        )}
      </Card>
    </div>
  );
}
