import { requireAdminPage } from "@/lib/admin";
import { featureAdoption } from "@/lib/analytics/queries";
import { Card, Table, pct } from "../ui";

export const dynamic = "force-dynamic";

export default async function Features() {
  await requireAdminPage();
  const rows = await featureAdoption();
  const max = Math.max(1, ...rows.map((r) => r.users));

  return (
    <Card title="Feature adoption" hint="Adoption is the share of all registered users who have produced at least one event for that feature.">
      <Table
        head={["Feature", "Active users", "Events", "Adoption", ""]}
        rows={rows.map((r) => [
          r.label, r.users, r.events.toLocaleString(), pct(r.adoption),
          <div key={r.key} style={{
            width: 90, height: 6, background: "var(--line-soft)", borderRadius: 4, marginLeft: "auto",
          }}>
            <div style={{
              width: `${(r.users / max) * 100}%`, height: "100%",
              background: "var(--accent)", borderRadius: 4,
            }} />
          </div>,
        ])}
      />
    </Card>
  );
}
