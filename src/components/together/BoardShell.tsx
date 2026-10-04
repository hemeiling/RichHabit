"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { Avatar, call, type Person } from "@/components/together/shared";

/**
 * One board, V1A: who is on it and how people join — always by invitation,
 * accepted. The shared work — the backlog and the board itself — arrives in
 * V1B; this is its frame.
 *
 * What a member can do is decided on the server; the screen only hides
 * controls that would be refused anyway, so nothing here is a security check.
 */

interface Member extends Person { role: "owner" | "member"; joinedAt: string }
interface Invitation { id: string; kind: "email" | "person"; label: string; invitedBy: string; expiresAt: string }
interface Board {
  id: string; name: string; role: "owner" | "member"; archived: boolean;
  members: Member[]; invitations: Invitation[]; otherInvitations: number;
  canInvite: boolean; invitable: Person[];
}

export default function BoardShell({ boardId, viewerId }: { boardId: string; viewerId: string }) {
  const t = useT();
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setBoard(await call<Board>(`/api/together/boards/${boardId}`));
      setGone(null);
    } catch (e) {
      // Removed, or the board went away while this tab was open: say so plainly.
      setBoard(null);
      setGone(e instanceof Error ? e.message : String(e));
    }
  }, [boardId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Back in the tab: re-read the board, and the shell (others may have changed boards meanwhile).
    const onFocus = () => { if (document.visibilityState === "visible") { load(); router.refresh(); } };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [load, router]);

  /**
   * Runs a change, then re-reads the board — the server is the truth. Says
   * whether it worked, so a follow-up (closing a form, leaving the page) never
   * hides a refusal. `reload: false` is for a change after which this board is
   * no longer the viewer's to read; `nav: true` for one the sidebar's board
   * shortcuts show (name, archived, membership), which re-renders the shell.
   */
  const act = async (fn: () => Promise<unknown>, done?: string,
    { reload = true, nav = false } = {}): Promise<boolean> => {
    setError(null);
    setNotice(null);
    let ok = false;
    try {
      await fn();
      ok = true;
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (reload || !ok) await load();
    if (ok && nav) router.refresh();
    return ok;
  };

  if (gone) {
    return (
      <div className="card p-5" role="alert">
        <p style={{ fontSize: 14 }}>{gone}</p>
        <button className="btn mt-3" onClick={() => router.push("/together")}>← {t.together.title}</button>
      </div>
    );
  }
  if (!board) return <div className="eyebrow py-10 text-center">{t.common.loading}</div>;

  const owner = board.role === "owner";
  const writable = !board.archived;

  return (
    <div className="tg-board">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        {renaming ? (
          <form className="flex items-center gap-2 flex-wrap" onSubmit={(e) => {
            e.preventDefault();
            act(() => call(`/api/together/boards/${boardId}`, { method: "PATCH", body: JSON.stringify({ name }) }),
              undefined, { nav: true })
              .then((ok) => { if (ok) setRenaming(false); });
          }}>
            <input className="input" autoFocus maxLength={80} value={name} aria-label={t.together.boardName}
              onChange={(e) => setName(e.target.value)} style={{ minWidth: 220 }} />
            <button className="btn btn-primary" type="submit">{t.common.save}</button>
            <button className="btn" type="button" onClick={() => setRenaming(false)}>{t.common.cancel}</button>
          </form>
        ) : (
          <h2 className="display tg-board-title">{board.name}</h2>
        )}
        {owner && writable && !renaming && (
          <button className="btn btn-quiet" onClick={() => { setName(board.name); setRenaming(true); }}>
            {t.together.rename}
          </button>
        )}
      </div>

      {board.archived && <p className="tg-archived mt-3" role="status">{t.together.archivedNote}</p>}
      {notice && <p className="mt-3" role="status" style={{ fontSize: 13.5, color: "var(--accent)" }}>{notice}</p>}
      {error && <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>{error}</p>}

      <div className="card p-4 mt-4 tg-placeholder">
        <p className="muted" style={{ fontSize: 14 }}>{t.together.workComingSoon}</p>
      </div>

      <section className="card p-4 mt-4" aria-labelledby="tg-members">
        <h3 id="tg-members" className="eyebrow">{t.together.members}</h3>
        <ul className="tg-members mt-2">
          {board.members.map((m) => (
            <li key={m.id} className="tg-member">
              <Avatar name={m.name} />
              <span className="tg-member-name">
                {m.name}{m.id === viewerId && <span className="faint"> ({t.together.you})</span>}
              </span>
              <span className="faint" style={{ fontSize: 12.5 }}>
                {m.role === "owner" ? t.together.owner : t.together.member}
              </span>
              {owner && m.id !== viewerId && (
                <button className="btn btn-quiet tg-small" onClick={() => {
                  if (window.confirm(t.together.confirmRemove(m.name))) {
                    act(() => call(`/api/together/boards/${boardId}/members/${m.id}`, { method: "DELETE" }));
                  }
                }}>{t.together.remove}</button>
              )}
            </li>
          ))}
        </ul>

        {board.canInvite && board.invitable.length > 0 && (
          <fieldset className="mt-4">
            <legend className="eyebrow mb-1.5">{t.together.addFromPeople}</legend>
            <div className="flex flex-wrap gap-1.5">
              {board.invitable.map((p) => (
                <button key={p.id} type="button" className="chip" aria-pressed={adding.includes(p.id)}
                  data-on={adding.includes(p.id)}
                  onClick={() => setAdding((v) => (v.includes(p.id) ? v.filter((x) => x !== p.id) : [...v, p.id]))}>
                  {p.name}
                </button>
              ))}
            </div>
            <button className="btn mt-2" disabled={!adding.length} onClick={async () => {
              let invited = 0;
              const ok = await act(async () => {
                ({ invited } = await call<{ invited: number }>(`/api/together/boards/${boardId}/invitations`, {
                  method: "POST", body: JSON.stringify({ people: adding }),
                }));
              });
              if (ok) {
                setAdding([]);
                setNotice(invited ? t.together.peopleInvited(invited) : t.together.nothingToInvite);
              }
            }}>{t.together.add}</button>
          </fieldset>
        )}

        {board.canInvite && (
          <form className="mt-4" onSubmit={(e) => {
            e.preventDefault();
            if (inviting || !email.trim()) return;
            setInviting(true);
            const to = email.trim();
            act(() => call(`/api/together/boards/${boardId}/invitations`, {
              method: "POST", body: JSON.stringify({ email: to }),
            }).then(() => setEmail("")), t.together.inviteSent(to)).finally(() => setInviting(false));
          }}>
            <label className="eyebrow block mb-1.5" htmlFor="tg-invite">{t.together.inviteByEmail}</label>
            <div className="flex gap-2 flex-wrap">
              <input id="tg-invite" className="input" type="email" autoComplete="off" inputMode="email"
                placeholder={t.together.inviteEmailPlaceholder} value={email} maxLength={254}
                onChange={(e) => setEmail(e.target.value)} style={{ flex: "1 1 220px" }} />
              <button className="btn btn-primary" type="submit" disabled={inviting || !email.trim()}>
                {t.together.invite}
              </button>
            </div>
          </form>
        )}

        {(board.invitations.length > 0 || board.otherInvitations > 0) && (
          <div className="mt-4">
            <h4 className="eyebrow">{t.together.pendingInvitations}</h4>
            <ul className="tg-members mt-1">
              {board.invitations.map((i) => (
                <li key={i.id} className="tg-member">
                  <span className="tg-member-name" style={{ overflowWrap: "anywhere" }}>{i.label}</span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {i.kind === "person" && `${t.together.inTogether} · `}
                    {t.together.expires(i.expiresAt)}
                    {owner && ` · ${t.together.invitedBy(i.invitedBy)}`}
                  </span>
                  <button className="btn btn-quiet tg-small" onClick={() =>
                    act(() => call(`/api/together/boards/${boardId}/invitations/${i.id}`, { method: "DELETE" }))}>
                    {t.together.withdraw}
                  </button>
                </li>
              ))}
            </ul>
            {board.otherInvitations > 0 && (
              <p className="faint mt-1" style={{ fontSize: 12.5 }}>{t.together.otherPending(board.otherInvitations)}</p>
            )}
          </div>
        )}
      </section>

      <div className="flex gap-2 flex-wrap mt-4">
        {owner ? (
          <button className="btn" onClick={() => {
            if (board.archived || window.confirm(t.together.confirmArchive)) {
              act(() => call(`/api/together/boards/${boardId}`, {
                method: "PATCH", body: JSON.stringify({ archived: !board.archived }),
              }), undefined, { nav: true });
            }
          }}>{board.archived ? t.together.unarchive : t.together.archive}</button>
        ) : (
          <button className="btn" onClick={() => {
            if (window.confirm(t.together.confirmLeave)) {
              act(() => call(`/api/together/boards/${boardId}/leave`, { method: "POST" }), undefined, { reload: false })
                .then((ok) => { if (ok) { router.push("/together"); router.refresh(); } });
            }
          }}>{t.together.leave}</button>
        )}
      </div>
    </div>
  );
}
