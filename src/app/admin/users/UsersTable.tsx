"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminUserRow, UserSort } from "@/lib/analytics/queries";
import type { Standing } from "@/lib/community";
import { planBadge, planText } from "@/lib/admin/plan";

/**
 * The users table, its selection, and the bulk actions that selection enables.
 *
 * Three things this component is careful about.
 *
 * It never decides who may be deleted. The header checkbox selects everything
 * on screen including the caller's own account, because pretending a row is
 * unselectable would teach the wrong lesson about where the rule lives: the
 * server evaluates protections against the whole set and reports back what it
 * skipped and why. What is shown here is the answer, not the rule.
 *
 * It is explicit about what "all" means. "Select all visible" ticks this page.
 * Selecting every account the filters match is a second, separate action with
 * its own count, so nobody can believe they have selected 10,000 rows when they
 * have ticked 50.
 *
 * And it shows counts and statuses only. No habit name, priority line, intention,
 * Important Date title, journal entry or AI content is in the data it receives —
 * see the note under `adminUsers`, and the test that enforces it.
 */

const ROLE_STYLE: Record<string, string> = { admin: "var(--accent)" };
const INTENTION_LABEL = { none: "—", started: "Started", completed: "Complete" } as const;

const date = (v: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : "—");

/**
 * Registered, but the address is unproved and the account is therefore inert.
 * Reads the account's own flag rather than the environment, so accounts from
 * before verification existed never show as pending.
 */
const pendingVerification = (u: AdminUserRow) =>
  u.verificationRequired && !u.emailVerifiedAt;

/**
 * "not asked" is the honest answer for an account that predates verification:
 * nobody ever sent them a link, so "no" would read as a failure on their part
 * rather than on ours.
 */
const verifiedText = (u: AdminUserRow) =>
  u.emailVerifiedAt ? "yes"
    : u.address == null ? "—"
      : u.verificationRequired ? "not yet" : "not asked";

/** First and last name where the sign-up form asked for them; otherwise nothing. */
const fullName = (u: AdminUserRow) =>
  [u.firstName, u.lastName].filter(Boolean).join(" ") || u.displayName || null;

/**
 * One identity in two lines: the best name the account has, then the handle or
 * address behind it — never the same text twice.
 */
function identity(u: AdminUserRow): { primary: string; secondary: string | null } {
  const name = fullName(u);
  if (name) return { primary: name, secondary: u.username ?? u.address };
  if (u.username) return { primary: u.username, secondary: u.address };
  return { primary: u.address ?? u.email, secondary: null };
}

/** A zero is recorded, not missing: shown, but quietly. */
const quiet = (v: number | string) => v === 0 || v === "—" || undefined;

/**
 * The product columns, grouped the way the product is. Each definition doubles
 * as the tooltip, so a header says exactly what its number counts rather than
 * needing a legend somewhere else.
 *
 * `sort` is set only where ordering by the column is actually useful; the rest
 * are read across a row, not ranked down one.
 */
interface Metric {
  group: string;
  label: string;
  /** The lower-case name the mobile card uses. */
  short: string;
  title: string;
  sort?: UserSort;
  /** Numbers are right-aligned and tabular; a status is not. */
  numeric?: boolean;
  render: (u: AdminUserRow, s: Standing | undefined) => React.ReactNode;
  /** For the quiet-zero attribute, which needs the bare value. */
  value?: (u: AdminUserRow) => number | string;
}

const METRICS: Metric[] = [
  {
    group: "Rich Habits", label: "Active Habits", short: "active habits",
    title: "Habits currently on the sheet (status = active). Candidate, paused and retired habits are not counted.",
    sort: "habits", numeric: true,
    render: (u) => u.activeHabits, value: (u) => u.activeHabits,
  },
  {
    group: "Rich Habits", label: "Completions", short: "completions",
    title: "Habit completions, all time — one per habit per day marked done.",
    sort: "completions", numeric: true,
    render: (u) => u.completions, value: (u) => u.completions,
  },
  {
    group: "Priority Compass", label: "Priorities", short: "priorities",
    title: "Priority Compass priorities, open and completed. The second figure is how many are still open.",
    sort: "priorities", numeric: true,
    render: (u) => (
      <>
        <span>{u.priorities}</span>
        {u.openPriorities > 0 && <span className="au-sub">{u.openPriorities} open</span>}
      </>
    ),
    value: (u) => u.priorities,
  },
  {
    group: "Priority Compass", label: "Accomplishments", short: "accomplishments",
    title: "Priorities that have been completed — the same rule Insights and Community count by.",
    sort: "accomplishments", numeric: true,
    render: (u) => u.accomplishments, value: (u) => u.accomplishments,
  },
  {
    group: "Community", label: "Rank", short: "community rank",
    title: "Place in the current Community habit ranking, month to date. Shown only when the Community board has already been computed for someone; this screen never computes it.",
    numeric: true,
    render: (_u, s) => (s?.state === "ranked" ? `#${s.rank}` : "—"),
    value: (_u) => "—",
  },
  {
    group: "Community", label: "%", short: "community %",
    title: "Unweighted month-to-date habit completion, the figure the Community board ranks by.",
    numeric: true,
    render: (_u, s) => (s?.state === "ranked" ? `${s.pct}%` : "—"),
    value: (_u) => "—",
  },
  {
    group: "Clarify Intention", label: "Status", short: "intention",
    title: "Whether Clarify Intention was started or completed, from activity events. Nothing anybody wrote is read.",
    render: (u) => INTENTION_LABEL[u.intention], value: (u) => INTENTION_LABEL[u.intention],
  },
  {
    group: "Planning", label: "Important Dates", short: "important dates",
    title: "How many Important Dates exist. Never their titles, notes or dates.",
    numeric: true,
    render: (u) => u.importantDates, value: (u) => u.importantDates,
  },
];

/** The account columns that sit before the groups, so both layouts agree. */
const GROUPS = METRICS.reduce<{ name: string; span: number }[]>((all, m) => {
  const last = all[all.length - 1];
  if (last?.name === m.group) last.span += 1; else all.push({ name: m.group, span: 1 });
  return all;
}, []);
const startsGroup = (i: number) => i === 0 || METRICS[i - 1].group !== METRICS[i].group;

export default function UsersTable({
  rows, total, page, pages, allMatchingIds, currentAdminId,
  standings, standingsAsOf, sort, sortLinks,
}: {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pages: number;
  /** Every id the current filters match, so "select all matching" needs no round trip. */
  allMatchingIds: string[];
  currentAdminId: string;
  /**
   * Community places, read from the existing month-to-date cache. Empty when the
   * cache is cold — this screen never populates it — and a missing account is
   * shown as a dash rather than guessed at.
   */
  standings: Record<string, Standing>;
  /** "month · time" the standings were computed, for the header tooltip. */
  standingsAsOf: string | null;
  sort: UserSort;
  /** Precomputed hrefs, since a function cannot cross into a client component. */
  sortLinks: Partial<Record<UserSort, string>>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /* The row whose role is being changed, and its own error slot — a failure
     here belongs beside the question that caused it, not in the bulk-action
     banner at the top of the page. */
  const [roleFor, setRoleFor] = useState<AdminUserRow | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<null | {
    requested: number; deleted: number;
    skipped: { id: string; email: string | null; reason: string }[];
    verb: string;
  }>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  /**
   * Promote or demote one account.
   *
   * The same endpoint the detail page uses, so both routes into this action
   * get the same refusals: you cannot demote yourself, you cannot remove the
   * last active admin, and a demotion that would exceed the account cap — when
   * one is set — is declined. Every one of those is decided by the server —
   * this component only asks.
   */
  const changeRole = async (row: AdminUserRow, next: "user" | "admin") => {
    setBusy("role");
    setRoleError(null);
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "role", role: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setRoleFor(null);
      router.refresh();
    } catch (e) {
      setRoleError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected],
  );
  /** Selected on another page: shown by count, since their rows are not here. */
  const offPage = selected.size - selectedRows.length;

  const phrase = `DELETE ${selected.size} ACCOUNT${selected.size === 1 ? "" : "S"}`;

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const run = async (action: "delete" | "disable" | "enable") => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/admin/users/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: [...selected] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setResult({ ...data, verb: action === "delete" ? "deleted" : `${action}d` });
      setSelected(new Set());
      setConfirming(false);
      setTyped("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const REASONS: Record<string, string> = {
    self: "the account you are signed in with",
    last_admin: "the last active admin",
    not_found: "no longer exists",
  };

  /* Pieces both layouts share, so the table and the cards cannot drift apart.
     Plain render functions, not components: a component declared here would be
     a new type on every render and would remount the checkboxes inside it. */
  const who = (u: AdminUserRow) => {
    const { primary, secondary } = identity(u);
    return (
      <div className="au-who">
        <input type="checkbox" checked={selected.has(u.id)}
          aria-label={`Select ${u.email}`}
          onChange={() => toggle(u.id)} />
        <div className="au-who-text">
          <div className="au-primary-line">
            <Link href={`/admin/users/${u.id}`} className="au-primary" title={primary}>{primary}</Link>
            {u.id === currentAdminId && <span className="faint au-you">· you</span>}
            {u.createdVia === "test" && <span className="au-tag">test</span>}
          </div>
          {secondary && <div className="au-secondary" title={secondary}>{secondary}</div>}
        </div>
      </div>
    );
  };

  /*
   * Three states, not two. A pending account is neither active nor disabled:
   * it exists, holds its username, and counts towards no cap until its address
   * is confirmed.
   */
  const status = (u: AdminUserRow) => (
    <span style={{
      color: u.disabledAt ? "var(--warn)" : pendingVerification(u) ? "var(--accent)" : "var(--muted)",
    }}>
      {u.disabledAt ? "disabled" : pendingVerification(u) ? "pending" : "active"}
    </span>
  );

  /*
   * The role reads as text and behaves as a control: a chip you click, rather
   * than a select dropped into every row. Forty rows of dropdowns is a table
   * you can change by mis-scrolling, and this is the one column where a slip
   * hands somebody the ability to delete every account.
   *
   * Your own row stays plain text. The server refuses self-demotion, and a
   * control that always fails is worse than no control at all.
   */
  const role = (u: AdminUserRow) => (
    u.id === currentAdminId ? (
      <span style={{ color: ROLE_STYLE[u.role] }}>{u.role}</span>
    ) : (
      <button className="chip" data-on={u.role === "admin"}
        style={{ padding: "2px 10px", fontSize: 12.5 }}
        disabled={!!busy}
        title={u.role === "admin" ? "Remove admin" : "Make admin"}
        onClick={() => { setRoleFor(u); setRoleError(null); }}>
        {u.role}
      </button>
    )
  );

  /** The plan word. Today it reads off the role; the shape is ready for more. */
  const plan = (u: AdminUserRow) => {
    const badge = planBadge(u);
    return (
      <span className="au-plan" title={badge.title}
        data-admin={badge.label === "Admin" || undefined}>
        {planText(badge)}
      </span>
    );
  };

  /** A sortable header: a link when sorting by it helps, plain text otherwise. */
  const sortable = (label: string, key: UserSort | undefined, title: string, extra = "") => {
    const href = key && sortLinks[key];
    const on = key && sort === key;
    return href ? (
      <a href={href} className={`au-sort${on ? " au-on" : ""} ${extra}`} title={`${title}\n\nSort by this column`}>
        {label}{on && <span aria-hidden="true"> ↓</span>}
      </a>
    ) : (
      <span className={extra} title={title}>{label}</span>
    );
  };

  return (
    <>
      {selected.size > 0 && (
        <div className="card p-4" style={{
          position: "sticky", top: 8, zIndex: 10, borderColor: "var(--accent)",
        }}>
          <div className="flex flex-wrap items-center gap-3">
            <b style={{ fontSize: 15 }}>{selected.size} selected</b>
            {offPage > 0 && (
              <span className="faint" style={{ fontSize: 12.5 }}>
                {selectedRows.length} on this page, {offPage} on other pages
              </span>
            )}
            <div className="flex flex-wrap gap-2" style={{ marginLeft: "auto" }}>
              <button className="btn" disabled={!!busy} onClick={() => run("disable")}>
                {busy === "disable" ? "Working…" : "Disable"}
              </button>
              <button className="btn" disabled={!!busy} onClick={() => run("enable")}>
                {busy === "enable" ? "Working…" : "Enable"}
              </button>
              <button className="btn btn-danger" disabled={!!busy}
                onClick={() => { setConfirming(true); setTyped(""); }}>
                Delete
              </button>
              <button className="btn btn-quiet" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          </div>
          {error && (
            <p className="mt-2" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>
              {error}
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="card p-4" style={{ borderColor: "var(--accent)" }}>
          <div className="flex items-center justify-between gap-3">
            <span style={{ fontSize: 14.5 }}>
              Requested {result.requested} · {result.verb} {result.deleted}
              {result.skipped.length > 0 && ` · skipped ${result.skipped.length}`}
            </span>
            <button className="btn btn-quiet" onClick={() => setResult(null)}>Dismiss</button>
          </div>
          {result.skipped.length > 0 && (
            <ul className="mt-2" style={{ fontSize: 13, lineHeight: 1.6 }}>
              {result.skipped.map((s) => (
                <li key={s.id} className="muted">
                  {s.email ?? s.id} — {REASONS[s.reason] ?? s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div className="eyebrow">
            {total} user{total === 1 ? "" : "s"} · page {page} of {pages}
          </div>
          <div className="flex flex-wrap gap-2" style={{ fontSize: 13 }}>
            <button className="btn btn-quiet" style={{ padding: "3px 10px" }}
              onClick={() => setSelected(new Set(visibleIds))}
              disabled={allVisibleSelected}>
              Select all visible ({visibleIds.length})
            </button>
            {/* Deliberately separate, and labelled with the real number. */}
            <button className="btn btn-quiet" style={{ padding: "3px 10px" }}
              onClick={() => setSelected(new Set(allMatchingIds))}
              disabled={allMatchingIds.length === 0 || selected.size === allMatchingIds.length}>
              Select all {allMatchingIds.length} matching
            </button>
          </div>
        </div>

        <div className="au-list">
          <div className="au-table-wrap" data-testid="users-table">
            <table className="au-table">
              <thead>
                <tr>
                  <th colSpan={9} className="au-g au-gs">Account</th>
                  {GROUPS.map((g) => (
                    <th key={g.name} colSpan={g.span} className="au-g au-gs">{g.name}</th>
                  ))}
                </tr>
                <tr>
                  <th className="au-user">
                    <div className="au-who">
                      <input type="checkbox" checked={allVisibleSelected}
                        aria-label="Select all visible"
                        onChange={(e) => setSelected((prev) => {
                          const next = new Set(prev);
                          visibleIds.forEach((id) => e.target.checked ? next.add(id) : next.delete(id));
                          return next;
                        })} />
                      <span>User</span>
                    </div>
                  </th>
                  <th>Status</th>
                  <th>Role</th>
                  <th title="Today this reads from the account's role: administrators bypass consumer limits, everyone else is Free. Paid and granted plans arrive with the entitlement layer.">Plan</th>
                  <th className="au-n">{sortable("Joined", "newest", "When the account was created")}</th>
                  <th title="Whether the email address has been confirmed. “not asked” means the account predates verification.">Verified</th>
                  <th className="au-n">{sortable("Last Active", "last_active", "Most recent tracked action")}</th>
                  <th className="au-n au-wrap">
                    {sortable("Active Days", "active", "Days with at least one tracked action (UTC days, all time)")}
                  </th>
                  <th className="au-n">{sortable("Sessions", "sessions", "Recorded app sessions")}</th>
                  {METRICS.map((m, i) => (
                    <th key={m.label}
                      className={`${m.numeric ? "au-n " : ""}${startsGroup(i) ? "au-gs " : ""}${m.label.includes(" ") ? "au-wrap" : ""}`}>
                      {sortable(m.label, m.sort,
                        m.group === "Community" && standingsAsOf
                          ? `${m.title}\n\nAs of ${standingsAsOf}`
                          : m.title)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const s = standings[u.id];
                  return (
                    <tr key={u.id} className="au-row" data-selected={selected.has(u.id) || undefined}>
                      <td className="au-user">{who(u)}</td>
                      <td>{status(u)}</td>
                      <td>{role(u)}</td>
                      <td>{plan(u)}</td>
                      <td className="muted au-n au-date">{date(u.createdAt)}</td>
                      <td className="muted" data-zero={quiet(verifiedText(u))}>{verifiedText(u)}</td>
                      <td className="muted au-n au-date">{date(u.lastActive)}</td>
                      <td className="au-n" data-zero={quiet(u.activeDays)}>{u.activeDays}</td>
                      <td className="au-n" data-zero={quiet(u.sessions)}>{u.sessions}</td>
                      {METRICS.map((m, i) => (
                        <td key={m.label}
                          data-zero={quiet(m.value ? m.value(u) : 0)}
                          className={`${m.numeric ? "au-n " : ""}${startsGroup(i) ? "au-gs" : ""}`}>
                          {m.render(u, s)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/*
            * Not the table squeezed. One card per account, ordered by what an
            * administrator actually looks for on a phone: who it is, whether the
            * account works, then adoption.
            */}
          <ul className="au-cards" data-testid="users-cards">
            {rows.map((u) => {
              const s = standings[u.id];
              return (
                <li key={u.id} className="au-card" data-selected={selected.has(u.id) || undefined}>
                  <div className="au-card-top">
                    {who(u)}
                    <div className="au-badges">{status(u)}{role(u)}</div>
                  </div>
                  <div className="au-meta">
                    {planText(planBadge(u))} · joined {date(u.createdAt)} · verified {verifiedText(u)}
                  </div>
                  <div className="au-meta">
                    Last active {date(u.lastActive)} · {u.activeDays} active day{u.activeDays === 1 ? "" : "s"}
                    {" · "}{u.sessions} session{u.sessions === 1 ? "" : "s"}
                  </div>
                  <dl className="au-metrics">
                    {METRICS.map((m) => (
                      <div key={m.label} title={m.title}>
                        <dt>{m.short}</dt>
                        <dd data-zero={quiet(m.value ? m.value(u) : 0)}>{m.render(u, s)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {roleFor && (
        <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label="Change role">
          <div className="scrim" onClick={() => !busy && setRoleFor(null)} />
          <div className="sheet">
            <h2 className="display" style={{ fontSize: 21 }}>
              {roleFor.role === "admin" ? "Remove admin?" : "Make this account an admin?"}
            </h2>
            <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.55 }}>
              {roleFor.role === "admin" ? (
                <>
                  <b>{roleFor.email}</b> loses access to these admin screens. They keep
                  every habit, completion, goal, journal entry and spending record, and
                  carry on appearing in Community Progress — and they begin counting
                  towards the account cap, if one is set.
                </>
              ) : (
                <>
                  <b>{roleFor.email}</b> gains access to every account in this system,
                  including the ability to disable and delete them. Their own habits and
                  history are untouched, and they stop counting towards the account
                  cap.
                </>
              )}
            </p>
            {roleError && (
              <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>
                {roleError}
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <button className="btn" disabled={!!busy} onClick={() => setRoleFor(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!!busy}
                onClick={() => changeRole(roleFor, roleFor.role === "admin" ? "user" : "admin")}>
                {busy === "role" ? "Working…"
                  : roleFor.role === "admin" ? "Yes, remove admin" : "Yes, make admin"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirming && (
        <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label="Delete accounts">
          <div className="scrim" onClick={() => !busy && setConfirming(false)} />
          <div className="sheet">
            <h2 className="display" style={{ fontSize: 21 }}>
              Delete {selected.size} account{selected.size === 1 ? "" : "s"}?
            </h2>
            <p className="muted mt-2" style={{ fontSize: 14, lineHeight: 1.55 }}>
              This permanently removes each account and everything it owns — habits,
              schedules, completions, goals, awareness entries, reviews, metrics,
              spending records, preferences and sessions. Analytics rows are kept but
              detached from the person. There is no undo.
            </p>

            <div className="flat p-3 mt-3" style={{ maxHeight: 180, overflowY: "auto" }}>
              <ul style={{ fontSize: 13, lineHeight: 1.7 }}>
                {selectedRows.map((r) => (
                  <li key={r.id}>
                    {r.email}
                    {r.role === "admin" && <span style={{ color: "var(--accent)" }}> · admin</span>}
                    {r.id === currentAdminId && <span className="faint"> · you, will be skipped</span>}
                  </li>
                ))}
                {offPage > 0 && (
                  <li className="faint">…and {offPage} selected on other pages</li>
                )}
              </ul>
            </div>

            <label className="block mt-3" style={{ fontSize: 13 }}>
              Type <b>{phrase}</b> to confirm
              <input className="input mt-1" value={typed} autoFocus
                autoCapitalize="characters" spellCheck={false}
                onChange={(e) => setTyped(e.target.value)} placeholder={phrase} />
            </label>

            {error && (
              <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button className="btn" disabled={!!busy}
                onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn btn-danger"
                disabled={!!busy || typed.trim().toUpperCase() !== phrase}
                onClick={() => run("delete")}>
                {busy === "delete" ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
