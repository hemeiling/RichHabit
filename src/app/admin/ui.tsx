/** Small presentational pieces shared by the admin pages. */
export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flat p-3.5">
      <div className="eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div className="display num mt-1" style={{ fontSize: 26 }}>{value}</div>
      {sub && <div className="faint mt-0.5" style={{ fontSize: 11.5 }}>{sub}</div>}
    </div>
  );
}

export function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="eyebrow">{title}</div>
      {hint && <p className="faint mt-1" style={{ fontSize: 12 }}>{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
        <thead>
          <tr>{head.map((h, i) => (
            <th key={h} className="eyebrow" style={{
              textAlign: i === 0 ? "left" : "right", padding: "0 8px 8px 0", whiteSpace: "nowrap",
            }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={head.length} className="muted" style={{ padding: "14px 0" }}>No data yet.</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} style={{
                  textAlign: j === 0 ? "left" : "right", padding: "8px 8px 8px 0",
                  borderTop: "1px solid var(--line-soft)", whiteSpace: "nowrap",
                }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
export const date = (v: string | Date | null) =>
  v == null ? "—" : new Date(v).toISOString().slice(0, 10);
