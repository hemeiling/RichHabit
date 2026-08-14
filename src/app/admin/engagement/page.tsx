import { requireAdminPage } from "@/lib/admin";
import { activeOverTime, overview, sessionStats, signupsOverTime } from "@/lib/analytics/queries";
import { Card, Stat, Table } from "../ui";

export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90, 365];

export default async function Engagement(
  { searchParams }: { searchParams: { days?: string } },
) {
  await requireAdminPage();
  const days = RANGES.includes(Number(searchParams.days)) ? Number(searchParams.days) : 30;
  const [o, s, active, signups] = await Promise.all([
    overview(), sessionStats(), activeOverTime(days), signupsOverTime(days),
  ]);
  const max = Math.max(1, ...active.map((d) => d.dau));

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="eyebrow mb-3">Active users</div>
        <div className="grid grid-cols-2 min-[560px]:grid-cols-4 gap-3">
          <Stat label="DAU" value={o.dau} />
          <Stat label="WAU" value={o.wau} />
          <Stat label="MAU" value={o.mau} />
          <Stat label="Sessions today" value={s.sessionsToday} />
        </div>
        <div className="flex flex-wrap gap-1.5 mt-4">
          {RANGES.map((r) => (
            <a key={r} href={`?days=${r}`} className="chip" data-on={r === days}
              style={{ textDecoration: "none" }}>
              {r === 365 ? "12 months" : `${r} days`}
            </a>
          ))}
        </div>
      </section>

      <Card title={`Daily active users · last ${days} days`}>
        <div className="flex items-end gap-0.5" style={{ height: 120 }}>
          {active.map((d) => (
            <div key={d.day} title={`${d.day}: ${d.dau}`} style={{
              flex: 1, minWidth: 2, height: `${(d.dau / max) * 100}%`,
              background: "var(--accent)", borderRadius: 2,
            }} />
          ))}
        </div>
        <div className="flex justify-between faint mt-1.5" style={{ fontSize: 11 }}>
          <span>{active[0]?.day}</span><span>peak {max}</span><span>{active.at(-1)?.day}</span>
        </div>
      </Card>

      <Card title={`Signups · last ${days} days`}>
        <Table
          head={["Day", "New users", "Total"]}
          rows={signups.filter((r) => r.signups > 0).reverse()
            .map((r) => [r.day, r.signups, r.cumulative])}
        />
      </Card>
    </div>
  );
}
