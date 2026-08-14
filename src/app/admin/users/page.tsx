import Link from "next/link";
import { requireAdminPage } from "@/lib/admin";
import { adminUsers, type UserSort } from "@/lib/analytics/queries";
import { Card, Table, date } from "../ui";

export const dynamic = "force-dynamic";

const SORTS: [UserSort, string][] = [
  ["active", "Most active"], ["least_active", "Least active"],
  ["newest", "Newest"], ["oldest", "Oldest"], ["last_active", "Last active"],
];

const STATUS_COLOUR: Record<string, string> = {
  new: "var(--accent)", highly_engaged: "var(--accent)", active: "var(--ink)",
  at_risk: "var(--warn)", dormant: "var(--faint)",
};

export default async function Users(
  { searchParams }: { searchParams: { q?: string; sort?: string } },
) {
  await requireAdminPage();
  const search = (searchParams.q ?? "").slice(0, 100);
  const sort = (SORTS.find(([s]) => s === searchParams.sort)?.[0] ?? "active") as UserSort;
  const rows = await adminUsers({ search, sort });

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        {/* A GET form: the query lives in the URL, so a view can be shared or
            bookmarked, and no client JavaScript is needed for search. */}
        <form method="get" className="flex gap-2">
          <input className="input" type="search" name="q" defaultValue={search}
            placeholder="Search by email" />
          <input type="hidden" name="sort" value={sort} />
          <button className="btn btn-primary" style={{ flex: "none" }}>Search</button>
        </form>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {SORTS.map(([value, label]) => (
            <a key={value} className="chip" data-on={value === sort}
              href={`?sort=${value}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
              style={{ textDecoration: "none" }}>{label}</a>
          ))}
        </div>
      </section>

      <Card
        title={`Users · ${rows.length}`}
        hint="Counts and dates only. Habit names, notes, metrics and goal text are never selected here."
      >
        <Table
          head={["Email", "Status", "Joined", "Last active", "Active days", "Sessions",
                 "Habits", "Completions", "Goals", "Reviews"]}
          rows={rows.map((u) => [
            <Link key={u.id} href={`/admin/users/${u.id}`} style={{ textDecoration: "underline" }}>
              {u.email}{u.role === "admin" ? " ·admin" : ""}
            </Link>,
            <span key="s" style={{ color: STATUS_COLOUR[u.status] }}>{u.status.replace("_", " ")}</span>,
            date(u.createdAt), date(u.lastActive), u.activeDays, u.sessions,
            u.habits, u.completions, u.goals, u.reviews,
          ])}
        />
      </Card>
    </div>
  );
}
