import { requireAdminPage } from "@/lib/admin";
import { cohorts, retention } from "@/lib/analytics/queries";
import { Card, Table, pct } from "../ui";

export const dynamic = "force-dynamic";

export default async function Retention() {
  await requireAdminPage();
  const [points, rows] = await Promise.all([retention(), cohorts(6)]);

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Return rate"
        hint="Of users who have existed long enough to have had the chance, how many came back on that day. Users too new to qualify are excluded rather than counted as failures."
      >
        <Table
          head={["Checkpoint", "Returned", "Eligible", "Rate"]}
          rows={points.map((p) => [`Day ${p.day}`, p.returned, p.eligible, pct(p.pct)])}
        />
      </Card>

      <Card
        title="Weekly cohorts"
        hint="Each row is everyone who signed up that week. A dash means the week has not happened yet — not zero."
      >
        <Table
          head={["Signup week", "Users", "W0", "W1", "W2", "W3", "W4", "W5"]}
          rows={rows.map((c) => [
            c.week, c.users,
            ...c.weeks.map((w) => (w == null ? "—" : `${w}%`)),
          ])}
        />
      </Card>
    </div>
  );
}
