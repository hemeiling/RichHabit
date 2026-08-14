import { requireAdminPage } from "@/lib/admin";
import { funnel } from "@/lib/analytics/queries";
import { Card, pct } from "../ui";

export const dynamic = "force-dynamic";

export default async function Funnel() {
  await requireAdminPage();
  const steps = await funnel();
  const top = steps[0]?.users || 1;

  return (
    <Card title="Activation funnel" hint="Where people stop. Each bar is measured against everyone who registered.">
      <div className="flex flex-col gap-2.5">
        {steps.map((s, i) => {
          const prev = i === 0 ? null : steps[i - 1];
          const dropped = prev ? prev.users - s.users : 0;
          return (
            <div key={s.key}>
              <div className="flex items-baseline justify-between gap-3" style={{ fontSize: 13.5 }}>
                <span>{s.label}</span>
                <span className="num muted">
                  {s.users} · {pct(s.pct)}
                  {prev && dropped > 0 && (
                    <span className="faint"> · −{dropped} here</span>
                  )}
                </span>
              </div>
              <div style={{ height: 10, background: "var(--line-soft)", borderRadius: 5, marginTop: 5 }}>
                <div style={{
                  width: `${(s.users / top) * 100}%`, height: "100%",
                  background: "var(--accent)", borderRadius: 5,
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
