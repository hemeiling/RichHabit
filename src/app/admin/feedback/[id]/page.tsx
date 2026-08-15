import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdminPage } from "@/lib/admin";
import { feedbackById } from "@/lib/admin/feedback";
import { AREA_LABELS, TYPE_LABELS } from "@/lib/feedback";
import { Stat, date } from "../../ui";
import Triage from "./Triage";

export const dynamic = "force-dynamic";

export default async function FeedbackDetail({ params }: { params: { id: string } }) {
  await requireAdminPage();
  const f = await feedbackById(params.id);
  if (!f) notFound();

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <Link href="/admin/feedback" className="eyebrow" style={{ textDecoration: "none" }}>
          ← Feedback
        </Link>
        <h1 className="display mt-1" style={{ fontSize: 22 }}>
          {TYPE_LABELS[f.type as keyof typeof TYPE_LABELS] ?? f.type}
        </h1>
        <p className="mt-3" style={{ fontSize: 15, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {f.body}
        </p>

        <div className="grid grid-cols-2 min-[560px]:grid-cols-4 gap-3 mt-4">
          <Stat label="From" value={f.email ?? "(deleted account)"} />
          <Stat label="Rating" value={f.rating ?? "—"} />
          <Stat label="Page" value={f.page ?? "—"} />
          <Stat label="Submitted" value={date(f.createdAt)} />
          <Stat label="App version" value={f.appVersion ?? "—"} />
          <Stat label="Language" value={f.locale ?? "—"} />
          <Stat label="Area" value={f.area ? AREA_LABELS[f.area] : "unassigned"} />
          <Stat label="Status" value={f.status} />
        </div>
      </section>

      {f.hasScreenshot && (
        <section className="card p-5">
          <div className="eyebrow mb-2">Screenshot</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/admin/feedback/${f.id}/screenshot`} alt="Submitted screenshot"
            style={{ maxWidth: "100%", borderRadius: 12, border: "1px solid var(--line)" }} />
        </section>
      )}

      <Triage id={f.id} status={f.status} area={f.area} adminNote={f.adminNote ?? ""} />
    </div>
  );
}
