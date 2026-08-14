import { requireAdminPage } from "@/lib/admin";
import { usageHeatmap } from "@/lib/analytics/queries";
import { Card } from "../ui";

export const dynamic = "force-dynamic";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function UsageTimes() {
  await requireAdminPage();
  const cells = await usageHeatmap();
  const grid = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c]));
  const max = Math.max(1, ...cells.map((c) => c.events));

  const byHour = Array.from({ length: 24 }, (_, h) =>
    cells.filter((c) => c.hour === h).reduce((a, c) => a + c.events, 0));
  const peakHour = byHour.indexOf(Math.max(...byHour));

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="When the app is used"
        hint="Day of week against hour of day, in each event's own local timezone. Timestamps are stored in UTC and converted per row."
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th />
                {Array.from({ length: 24 }, (_, h) => (
                  <th key={h} className="faint" style={{ fontSize: 9, fontWeight: 400, width: 20 }}>
                    {h % 3 === 0 ? h : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((label, dow) => (
                <tr key={label}>
                  <td className="eyebrow" style={{ fontSize: 10, paddingRight: 6, whiteSpace: "nowrap" }}>{label}</td>
                  {Array.from({ length: 24 }, (_, h) => {
                    const cell = grid.get(`${dow}:${h}`);
                    const v = cell?.events ?? 0;
                    return (
                      <td key={h} title={`${label} ${h}:00 — ${v} events, ${cell?.users ?? 0} users`}
                        style={{ padding: 1 }}>
                        <div style={{
                          width: 18, height: 18, borderRadius: 3,
                          background: v === 0 ? "var(--line-soft)"
                            : `color-mix(in srgb, var(--accent) ${Math.round(15 + (v / max) * 85)}%, var(--line-soft))`,
                        }} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="faint mt-3" style={{ fontSize: 12 }}>
          {cells.length === 0
            ? "No events recorded yet."
            : `Busiest hour: ${peakHour}:00 local. Useful later for deciding when a reminder would land.`}
        </p>
      </Card>
    </div>
  );
}
