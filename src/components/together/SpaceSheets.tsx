"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DeletedTask, GroupView, TaskSummary } from "@/lib/together/work";
import { useT } from "@/lib/i18n/context";
import { afterSpaceGone, call } from "@/components/together/shared";
import { Dialog } from "@/components/together/overlay";

/**
 * The space's housekeeping sheets, from ⋯: Groups and Recently deleted (both
 * read-only in an archived space), and Delete space (the owner's).
 */

/**
 * Deleting a space, for good. Offered only to the owner — and the server decides
 * that again, along with the typed name, so nothing here is a security check.
 * Typing the name exactly is the confirmation. On success the space no longer
 * exists, so the page moves to Together Overview, which says so; on failure the
 * space is untouched and the reason is shown here.
 */
export function DeleteSpaceDialog({ boardId, name, archived, onClose }: {
  boardId: string; name: string;
  /** Already archived: the reversible choice was made, so it is not offered again. */
  archived: boolean;
  onClose: () => void;
}) {
  const tt = useT();
  const t = tt.together;
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const same = (s: string) => s.trim().normalize("NFC");
  const matches = same(typed) === same(name);
  const close = () => { if (!busy) onClose(); };     // not mid-request: the answer must be seen

  const remove = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ together?: boolean }>(`/api/together/boards/${boardId}`,
        { method: "DELETE", body: JSON.stringify({ confirmName: typed }) });
      afterSpaceGone(router, r.together, t.deleted(name));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog label={t.deleteTitle} onClose={close} footer={
      <>
        <button className="btn" type="button" disabled={busy} onClick={close}>{tt.common.cancel}</button>
        <button className="btn tg-danger" type="button" disabled={!matches || busy} onClick={remove}>
          {busy ? t.deleting : t.deleteConfirm}
        </button>
      </>
    }>
      <div className="tg-sheet-top">
        <h2 className="display" style={{ fontSize: 24 }}>{t.deleteTitle}</h2>
        <button type="button" className="btn btn-quiet tg-sheet-close" disabled={busy} onClick={close}>{tt.common.close}</button>
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.55, overflowWrap: "anywhere" }}>{t.deleteBody(name)}</p>
      <p className="muted mt-2" style={{ fontSize: 13.5, lineHeight: 1.5 }}>{t.deleteKeeps}</p>
      {/* The reversible alternative that already exists: Archive, on the Members page. */}
      {!archived && (
        <p className="mt-2" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          {t.deleteArchiveHint}{" "}
          <Link href={`/together/b/${boardId}/members`} className="tg-archive-link">{t.deleteArchiveLink}</Link>
        </p>
      )}
      <p className="mt-2" style={{ fontSize: 13.5, fontWeight: 500, color: "var(--warn)" }}>{t.deleteIrreversible}</p>
      <label className="block mt-4">
        <span className="block mb-1.5" style={{ fontSize: 13.5 }}>
          {t.deleteTypePrompt} <strong style={{ overflowWrap: "anywhere" }}>{name}</strong>
        </span>
        <input className="input" data-autofocus value={typed} autoComplete="off" spellCheck={false}
          aria-invalid={typed.length > 0 && !matches ? true : undefined}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void remove(); } }} />
      </label>
      {error && <p className="tg-sheet-error" role="alert">{error}</p>}
    </Dialog>
  );
}

export function GroupsSheet({ boardId, groups, readOnly, onClose, onChanged }: {
  boardId: string; groups: GroupView[]; readOnly: boolean; onClose: () => void; onChanged: () => void;
}) {
  const tt = useT();
  const t = tt.together.work;
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<GroupView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/together/boards/${boardId}/groups`;
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); onChanged(); return true; } catch (e) { setError((e as Error).message); return false; }
  };

  return (
    <Dialog label={t.groups} onClose={onClose}>
      <div className="tg-sheet-top">
        <h2 className="display" style={{ fontSize: 24 }}>{t.groups}</h2>
        <button type="button" className="btn btn-quiet tg-sheet-close" onClick={onClose}>{tt.common.close}</button>
      </div>
      <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>{t.groupsIntro}</p>
      {error && <p className="tg-sheet-error" role="alert">{error}</p>}
      {groups.length === 0 ? (
        <p className="faint mt-4" style={{ fontSize: 13.5 }}>{t.noGroups}</p>
      ) : (
        <ul className="tg-members mt-3">
          {groups.map((g) => (
            <li key={g.id} className="tg-member">
              {editing?.id === g.id ? (
                <form className="flex gap-2 flex-wrap items-center" style={{ flex: "1 1 100%" }} onSubmit={(e) => {
                  e.preventDefault();
                  run(() => call(`${base}/${g.id}`, { method: "PATCH", body: JSON.stringify({ name: editing.name }) }))
                    .then((ok) => { if (ok) setEditing(null); });
                }}>
                  <input className="input" autoFocus maxLength={40} value={editing.name} aria-label={t.groupName}
                    style={{ flex: "1 1 180px" }}
                    onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditing(null); } }}
                    onChange={(e) => setEditing({ id: g.id, name: e.target.value })} />
                  <button className="btn btn-primary tg-small" type="submit">{tt.common.save}</button>
                  <button className="btn tg-small" type="button" onClick={() => setEditing(null)}>{tt.common.cancel}</button>
                </form>
              ) : deleting?.id === g.id ? (
                <div style={{ flex: "1 1 100%" }}>
                  <p style={{ fontSize: 14 }}>{t.confirmDeleteGroup(g.name)}</p>
                  <div className="flex gap-2 justify-end mt-2">
                    <button className="btn tg-small" type="button" data-autofocus onClick={() => setDeleting(null)}>{tt.common.cancel}</button>
                    <button className="btn tg-small tg-danger" type="button" onClick={() =>
                      run(() => call(`${base}/${g.id}`, { method: "DELETE" })).then(() => setDeleting(null))}>
                      {t.deleteGroup}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="tg-member-name">{g.name}</span>
                  {!readOnly && (
                    <>
                      <button className="btn btn-quiet tg-small" type="button" onClick={() => setEditing({ id: g.id, name: g.name })}>
                        {tt.together.rename}
                      </button>
                      <button className="btn btn-quiet tg-small" type="button" onClick={() => setDeleting(g)}>{t.delete}</button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form className="flex gap-2 flex-wrap mt-4" onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run(() => call(base, { method: "POST", body: JSON.stringify({ name }) })).then((ok) => { if (ok) setName(""); });
        }}>
          <input className="input" maxLength={40} value={name} placeholder={t.groupName} aria-label={t.newGroup}
            style={{ flex: "1 1 200px" }} onChange={(e) => setName(e.target.value)} />
          <button className="btn" type="submit" disabled={!name.trim()}>{t.newGroup}</button>
        </form>
      )}
    </Dialog>
  );
}

export function DeletedSheet({ boardId, readOnly, onClose, onRestored }: {
  boardId: string; readOnly: boolean; onClose: () => void; onRestored: (task: TaskSummary) => void;
}) {
  const tt = useT();
  const t = tt.together.work;
  const [items, setItems] = useState<DeletedTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<DeletedTask[]>(`/api/together/boards/${boardId}/tasks/deleted`).then(setItems).catch((e) => setError((e as Error).message));
  }, [boardId]);

  return (
    <Dialog label={t.recentlyDeleted} onClose={onClose}>
      <div className="tg-sheet-top">
        <h2 className="display" style={{ fontSize: 24 }}>{t.recentlyDeleted}</h2>
        <button type="button" className="btn btn-quiet tg-sheet-close" onClick={onClose}>{tt.common.close}</button>
      </div>
      {error && <p className="tg-sheet-error" role="alert">{error}</p>}
      {!items ? (
        !error && <p className="eyebrow py-6 text-center">{tt.common.loading}</p>
      ) : items.length === 0 ? (
        <p className="faint" style={{ fontSize: 13.5 }}>{t.nothingDeleted}</p>
      ) : (
        <ul className="tg-members">
          {items.map((d) => (
            <li key={d.id} className="tg-member">
              <span className="tg-member-name">
                <span style={{ display: "block", overflowWrap: "anywhere" }}>{d.title}</span>
                <span className="faint" style={{ fontSize: 12.5 }}>{t.stages[d.stage]} · {t.deletedBy(d.deletedBy?.name ?? null, d.deletedAt)}</span>
              </span>
              {!readOnly && (
                <button className="btn tg-small" type="button" onClick={async () => {
                  setError(null);
                  try {
                    const { task } = await call<{ task: TaskSummary }>(`/api/together/boards/${boardId}/tasks/${d.id}/restore`, { method: "POST" });
                    setItems((list) => (list ?? []).filter((x) => x.id !== d.id));
                    onRestored(task);
                  } catch (e) { setError((e as Error).message); }
                }}>{t.restore}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
