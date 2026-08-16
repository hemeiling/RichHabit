"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminUserRow } from "@/lib/analytics/queries";

/**
 * The users table, its selection, and the bulk actions that selection enables.
 *
 * Two things this component is careful about.
 *
 * It never decides who may be deleted. The header checkbox selects everything
 * on screen including the caller's own account, because pretending a row is
 * unselectable would teach the wrong lesson about where the rule lives: the
 * server evaluates protections against the whole set and reports back what it
 * skipped and why. What is shown here is the answer, not the rule.
 *
 * And it is explicit about what "all" means. "Select all visible" ticks this
 * page. Selecting every account the filters match is a second, separate action
 * with its own count, so nobody can believe they have selected 10,000 rows
 * when they have ticked 50.
 */

const ROLE_STYLE: Record<string, string> = { admin: "var(--accent)" };
const SOURCE_LABEL: Record<string, string> = {
  self_signup: "signed up", admin: "created by an admin", test: "test",
};

const date = (v: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : "—");

/** First and last name where the sign-up form asked for them; otherwise nothing. */
const fullName = (u: AdminUserRow) =>
  [u.firstName, u.lastName].filter(Boolean).join(" ") || u.displayName || null;

export default function UsersTable({
  rows, total, page, pages, allMatchingIds, currentAdminId,
}: {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pages: number;
  /** Every id the current filters match, so "select all matching" needs no round trip. */
  allMatchingIds: string[];
  currentAdminId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<null | {
    requested: number; deleted: number;
    skipped: { id: string; email: string | null; reason: string }[];
    verb: string;
  }>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
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

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--faint)" }}>
                <th style={{ padding: "6px 8px 6px 0" }}>
                  <input type="checkbox" checked={allVisibleSelected}
                    aria-label="Select all visible"
                    onChange={(e) => setSelected((prev) => {
                      const next = new Set(prev);
                      visibleIds.forEach((id) => e.target.checked ? next.add(id) : next.delete(id));
                      return next;
                    })} />
                </th>
                {["Name", "Username", "Email", "Status", "Signup date", "Role", "Verified",
                  "Source", "Last active", "Days", "Sessions", "Habits", "Done",
                  "Goals", "Reviews"]
                  .map((h) => (
                    <th key={h} style={{ padding: "6px 10px", whiteSpace: "nowrap", fontWeight: 500 }}>
                      {h}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} style={{ borderTop: "1px solid var(--line-soft)" }}
                  data-selected={selected.has(u.id) || undefined}>
                  <td style={{ padding: "8px 8px 8px 0" }}>
                    <input type="checkbox" checked={selected.has(u.id)}
                      aria-label={`Select ${u.email}`}
                      onChange={() => toggle(u.id)} />
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    <Link href={`/admin/users/${u.id}`} style={{ textDecoration: "underline" }}>
                      {fullName(u) ?? u.email}
                    </Link>
                    {u.id === currentAdminId && <span className="faint"> · you</span>}
                  </td>
                  <td className="muted" style={{ padding: "8px 10px" }}>{u.username ?? "—"}</td>
                  <td className="muted" style={{ padding: "8px 10px" }}>{u.address ?? "—"}</td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap",
                    color: u.disabledAt ? "var(--warn)" : undefined }}>
                    {u.disabledAt ? "disabled" : "active"}
                  </td>
                  <td className="muted num" style={{ padding: "8px 10px" }}>{date(u.createdAt)}</td>
                  <td style={{ padding: "8px 10px", color: ROLE_STYLE[u.role] }}>{u.role}</td>
                  <td className="muted" style={{ padding: "8px 10px" }}>
                    {u.address == null ? "—" : u.emailVerifiedAt ? "yes" : "not yet"}
                  </td>
                  <td className="muted" style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {u.createdVia ? SOURCE_LABEL[u.createdVia] ?? u.createdVia : "unclassified"}
                  </td>
                  <td className="muted num" style={{ padding: "8px 10px" }}>{date(u.lastActive)}</td>
                  {[u.activeDays, u.sessions, u.habits, u.completions, u.goals, u.reviews].map((n, i) => (
                    <td key={i} className="num" style={{ padding: "8px 10px" }}>{n}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
                {busy === "delete" ? "Deleting…" : "Delete accounts"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
