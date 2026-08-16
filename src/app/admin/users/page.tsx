import { requireAdminPage } from "@/lib/admin";
import { currentCapacity } from "@/lib/db/capacity";
import { adminUserIds, adminUsers } from "@/lib/analytics/queries";
import type {
  KindFilter, RoleFilter, SourceFilter, StatusFilter, UserSort,
} from "@/lib/analytics/queries";
import AddAccount from "./AddAccount";
import UsersTable from "./UsersTable";

export const dynamic = "force-dynamic";

/**
 * Filters live in the URL, so a view can be shared, bookmarked and reloaded,
 * and the server does the filtering — the page never ships 10,000 rows to the
 * browser to hide most of them with JavaScript.
 */
const SORTS: [UserSort, string][] = [
  ["active", "Most active"], ["least_active", "Least active"],
  ["newest", "Newest"], ["oldest", "Oldest"], ["last_active", "Last active"],
];
const ROLES: [RoleFilter, string][] = [["all", "All"], ["user", "User"], ["admin", "Admin"]];
const STATUSES: [StatusFilter, string][] =
  [["all", "All"], ["active", "Active"], ["disabled", "Disabled"]];
const KINDS: [KindFilter, string][] =
  [["all", "All"], ["email", "Email"], ["username", "Username"]];
/**
 * Source comes from `users.created_via`, written when the account is made.
 * Rows created before that column existed are "unclassified" rather than
 * guessed at — an address ending in example.com is not evidence.
 */
const SOURCES: [SourceFilter, string][] = [
  ["all", "All"], ["real", "Real users"], ["test", "Test / fixture"],
  ["unclassified", "Unclassified"],
];

const pick = <T extends string>(options: [T, string][], value: string | undefined, fallback: T): T =>
  options.find(([v]) => v === value)?.[0] ?? fallback;

export default async function Users({ searchParams }: {
  searchParams: Record<string, string | undefined>;
}) {
  const admin = await requireAdminPage();

  const search = (searchParams.q ?? "").slice(0, 100);
  const sort = pick(SORTS, searchParams.sort, "active");
  const role = pick(ROLES, searchParams.role, "all");
  const status = pick(STATUSES, searchParams.status, "all");
  const kind = pick(KINDS, searchParams.kind, "all");
  const source = pick(SOURCES, searchParams.source, "all");
  const page = Math.max(1, Number(searchParams.page) || 1);

  const filters = { search, sort, role, status, kind, source };
  const result = await adminUsers({ ...filters, page, pageSize: 50 });
  const allMatchingIds = await adminUserIds(filters);
  const seats = await currentCapacity();

  /** A link that keeps every current filter and changes one thing. */
  const href = (patch: Record<string, string | number>) => {
    const params = new URLSearchParams();
    const current: Record<string, string> = {
      q: search, sort, role, status, kind, source, page: String(page), ...
        Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v)])),
    };
    // Changing a filter goes back to page one; the old page may not exist.
    if (!("page" in patch)) current.page = "1";
    Object.entries(current).forEach(([k, v]) => {
      if (v && v !== "all" && !(k === "page" && v === "1")) params.set(k, v);
    });
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  };

  const Row = ({ label, options, active, param }: {
    label: string; options: [string, string][]; active: string; param: string;
  }) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="eyebrow" style={{ minWidth: 86 }}>{label}</span>
      {options.map(([value, text]) => (
        <a key={value} className="chip" data-on={value === active}
          href={href({ [param]: value })} style={{ textDecoration: "none" }}>{text}</a>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h1 className="display" style={{ fontSize: 22 }}>Users</h1>
          <AddAccount />
        </div>

        {/* The number the owner reads and the number the door enforces come
            from the same function, so they cannot disagree. */}
        <div className="flat p-3.5 mb-3">
          {seats.limit === 0 ? (
            <div style={{ fontSize: 15 }}>
              Users: <b className="num">{seats.used}</b>{" "}
              <span className="faint">· no limit set</span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 15 }}>
                Users: <b className="num">{seats.used} / {seats.limit}</b>
                {seats.full && (
                  <span style={{ color: "var(--warn)" }}> — Early Access Full</span>
                )}
              </div>
              {!seats.full && (
                <div className="faint mt-0.5" style={{ fontSize: 12.5 }}>
                  {seats.remaining} spot{seats.remaining === 1 ? "" : "s"} remaining
                </div>
              )}
              <div className="faint mt-0.5" style={{ fontSize: 12 }}>
                Active non-admin accounts. Admins do not use a spot; a disabled account
                releases one.
              </div>
            </>
          )}
        </div>

        <form method="get" className="flex gap-2">
          <input className="input" type="search" name="q" defaultValue={search}
            placeholder="Search by email, username or name" />
          {/* Searching keeps the filters, and starts again at page one. */}
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="source" value={source} />
          <button className="btn btn-primary" style={{ flex: "none" }}>Search</button>
        </form>

        <div className="flex flex-col gap-2 mt-3">
          <Row label="Role" options={ROLES} active={role} param="role" />
          <Row label="Status" options={STATUSES} active={status} param="status" />
          <Row label="Login" options={KINDS} active={kind} param="kind" />
          <Row label="Source" options={SOURCES} active={source} param="source" />
          <Row label="Sort" options={SORTS} active={sort} param="sort" />
        </div>
      </section>

      <UsersTable
        rows={result.rows} total={result.total} page={result.page} pages={result.pages}
        allMatchingIds={allMatchingIds} currentAdminId={admin.id}
      />

      {result.pages > 1 && (
        <nav className="flex items-center justify-center gap-2" aria-label="Pages">
          <a className="btn" href={href({ page: Math.max(1, page - 1) })}
            aria-disabled={page === 1}
            style={page === 1 ? { opacity: 0.45, pointerEvents: "none" } : undefined}>
            ‹ Previous
          </a>
          <span className="muted" style={{ fontSize: 13.5 }}>
            Page {result.page} of {result.pages}
          </span>
          <a className="btn" href={href({ page: Math.min(result.pages, page + 1) })}
            aria-disabled={page === result.pages}
            style={page === result.pages ? { opacity: 0.45, pointerEvents: "none" } : undefined}>
            Next ›
          </a>
        </nav>
      )}

      <p className="faint text-center" style={{ fontSize: 12, lineHeight: 1.5 }}>
        Counts and dates only. Habit names, notes, metrics and goal text are never selected here.
      </p>
    </div>
  );
}
