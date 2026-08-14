import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin";
import { userProfile } from "@/lib/analytics/queries";
import { Card, Stat, Table, date } from "../../ui";

export const dynamic = "force-dynamic";

/**
 * A usage profile, not a window into someone's life. Everything here is a count
 * or a date; the person's habit names, notes, metrics and goal descriptions are
 * never read. Seeing those would need a separate, explicitly authorised and
 * audited tool.
 */
export default async function UserProfile({ params }: { params: { id: string } }) {
  await requireAdminPage();
  const u = await userProfile(params.id);
  if (!u) notFound();

  const max = Math.max(1, ...u.recent.map((d) => d.events));

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="eyebrow">Usage profile</div>
        <h1 className="display mt-1" style={{ fontSize: 24 }}>{u.email}</h1>
        <div className="faint mt-1" style={{ fontSize: 12 }}>
          {u.status.replace("_", " ")} · {u.role}
        </div>
        <div className="grid grid-cols-2 min-[560px]:grid-cols-4 gap-3 mt-4">
          <Stat label="Joined" value={date(u.createdAt)} />
          <Stat label="First active" value={date(u.firstActive)} />
          <Stat label="Last active" value={date(u.lastActive)} />
          <Stat label="Active days" value={u.activeDays} />
          <Stat label="Sessions" value={u.sessions} />
          <Stat label="Habit completions" value={u.completions} />
          <Stat label="Goals created" value={u.goals} />
          <Stat label="Weekly reviews" value={u.reviews} />
        </div>
      </section>

      <Card title="Activity · last 30 days">
        {u.recent.length === 0 ? (
          <p className="muted" style={{ fontSize: 14 }}>No events in the last 30 days.</p>
        ) : (
          <div className="flex items-end gap-1" style={{ height: 90 }}>
            {u.recent.map((d) => (
              <div key={d.day} title={`${d.day}: ${d.events} events`} style={{
                flex: 1, minWidth: 3, height: `${(d.events / max) * 100}%`,
                background: "var(--accent)", borderRadius: 2,
              }} />
            ))}
          </div>
        )}
      </Card>

      <Card title="Features used" hint="Which parts of the product this account touches.">
        <Table head={["Feature", "Events"]} rows={u.features.map((f) => [f.feature, f.events])} />
      </Card>
    </div>
  );
}
