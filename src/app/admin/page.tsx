import { requireAdminPage } from "@/lib/admin";
import { activationRate, funnel, habitEngagement, overview, sessionStats } from "@/lib/analytics/queries";
import { ACTIVATION } from "@/lib/analytics/config";
import { Card, Stat, Table, pct } from "./ui";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  await requireAdminPage();
  const [o, s, a, f, h] = await Promise.all([
    overview(), sessionStats(), activationRate(), funnel(), habitEngagement(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="eyebrow mb-3">Product health</div>
        <div className="grid grid-cols-2 min-[560px]:grid-cols-4 gap-3">
          <Stat label="Total users" value={o.totalUsers} />
          <Stat label="Active today" value={o.dau} />
          <Stat label="Weekly active" value={o.wau} />
          <Stat label="Monthly active" value={o.mau} />
          <Stat label="DAU / MAU" value={pct(o.dauOverMau)} sub="how often monthly users return" />
          <Stat label="New this week" value={o.newThisWeek} />
          <Stat label="New today" value={o.newToday} />
          <Stat label="Returning" value={o.returningUsers} sub="active, signed up >7d ago" />
        </div>
      </section>

      <Card title="Sessions" hint={`A session ends after 30 minutes without activity.`}>
        <div className="grid grid-cols-2 min-[560px]:grid-cols-5 gap-3">
          <Stat label="Today" value={s.sessionsToday} />
          <Stat label="Per user" value={s.sessionsPerUser ?? "—"} sub="last 30 days" />
          <Stat label="Avg duration" value={s.avgDurationMin == null ? "—" : `${s.avgDurationMin}m`} />
          <Stat label="Median duration" value={s.medianDurationMin == null ? "—" : `${s.medianDurationMin}m`} />
          <Stat label="Events / session" value={s.avgEventsPerSession ?? "—"} />
        </div>
      </Card>

      <Card
        title="Activation"
        hint={`Created a habit and was active on ${ACTIVATION.distinctActiveDays} separate days within ${ACTIVATION.windowDays} of signing up. Only users old enough to qualify are counted.`}
      >
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Activation rate" value={pct(a.pct)} />
          <Stat label="Activated" value={a.activated} />
          <Stat label="Eligible" value={a.eligible} />
        </div>
      </Card>

      <Card title="Activation funnel">
        <Table
          head={["Stage", "Users", "Of registered"]}
          rows={f.map((step) => [step.label, step.users, pct(step.pct)])}
        />
      </Card>

      <Card title="Habit engagement" hint="Aggregates only — no habit names or notes.">
        <Table
          head={["Metric", "Value"]}
          rows={[
            ["Average habits per user", h.avgHabitsPerUser ?? "—"],
            ["Average completions per active day", h.avgCompletionsPerDay ?? "—"],
            ["Created a habit", pct(h.pctCreatedHabit)],
            ["Completed a habit", pct(h.pctCompletedHabit)],
            ["Created a goal", pct(h.pctCreatedGoal)],
            ["Completed a weekly review", pct(h.pctDidReview)],
            ["Used habit stacking", pct(h.pctUsedStacking)],
          ]}
        />
      </Card>
    </div>
  );
}
