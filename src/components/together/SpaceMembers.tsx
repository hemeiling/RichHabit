"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { Avatar, call, type Person } from "@/components/together/shared";
import SpaceHeader, { spaceStyle } from "@/components/together/SpaceHeader";
import { cachedWork } from "@/components/together/SpaceWork";

/**
 * A space's Members page: who is in it and how people join — always by
 * invitation, accepted — and the owner's housekeeping (rename, archive). Off
 * the everyday work surface on purpose: Board and Backlog are for the work.
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

export default function SpaceMembers({ boardId, viewerId }: { boardId: string; viewerId: string }) {
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

  /**
   * Bring the invite form into view and put the cursor in the email field — on
   * arriving from the Together overview's Invite people (#invite).
   */
  const focusInvite = useCallback(() => {
    const area = document.getElementById("invite");
    if (!area) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    area.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    (document.getElementById("tg-invite") ?? area).focus({ preventScroll: true });
  }, []);
  const arrived = useRef(false);
  useEffect(() => {
    if (!board?.canInvite || arrived.current || window.location.hash !== "#invite") return;
    arrived.current = true;
    focusInvite();
  }, [board, focusInvite]);
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
  /** How many of this space's open tasks someone holds, from the last reading of its work (if any). */
  const assignedTo = (id: string) =>
    cachedWork(boardId)?.tasks.filter((x) => x.stage !== "done" && x.assignees.includes(id)).length ?? 0;

  return (
    <div className="tg-space" style={spaceStyle(board.id)}>
      <SpaceHeader id={board.id} name={board.name} members={board.members} view="members" />
    <div className="tg-board tg-narrow">
      <div className="flex items-start justify-between gap-3 flex-wrap mt-5">
        <h3 className="display" style={{ fontSize: 22 }}>{t.together.members}</h3>
      </div>

      {board.archived && <p className="tg-archived mt-3" role="status">{t.together.archivedNote}</p>}
      {notice && <p className="mt-3" role="status" style={{ fontSize: 13.5, color: "var(--accent)" }}>{notice}</p>}
      {error && <p className="mt-3" role="alert" style={{ fontSize: 13.5, color: "var(--warn)" }}>{error}</p>}

      <section className="card p-4 mt-4" aria-label={t.together.members}>
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
                  const n = assignedTo(m.id);
                  if (window.confirm(n ? t.together.confirmRemoveAssigned(m.name, n) : t.together.confirmRemove(m.name))) {
                    act(() => call(`/api/together/boards/${boardId}/members/${m.id}`, { method: "DELETE" }));
                  }
                }}>{t.together.remove}</button>
              )}
            </li>
          ))}
        </ul>

        {board.canInvite && (
          <div id="invite" className="tg-invite-area mt-5" tabIndex={-1} aria-labelledby="tg-invite-h">
            <h4 id="tg-invite-h" className="tg-invite-h">{t.together.addPeople}</h4>
            {board.invitable.length > 0 && (
              <fieldset className="mt-3">
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
          </div>
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

      {/* The space's own housekeeping, apart from its people: rename, archive — or leave. */}
      <div className="flex gap-2 flex-wrap mt-4">
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
        ) : owner ? (<>
          {writable && (
            <button className="btn" onClick={() => { setName(board.name); setRenaming(true); }}>{t.together.renameSpace}</button>
          )}
          <button className="btn" onClick={() => {
            if (board.archived || window.confirm(t.together.confirmArchive)) {
              act(() => call(`/api/together/boards/${boardId}`, {
                method: "PATCH", body: JSON.stringify({ archived: !board.archived }),
              }), undefined, { nav: true });
            }
          }}>{board.archived ? t.together.unarchive : t.together.archive}</button>
        </>) : (
          <button className="btn" onClick={() => {
            if (window.confirm(t.together.confirmLeave)) {
              act(() => call(`/api/together/boards/${boardId}/leave`, { method: "POST" }), undefined, { reload: false })
                .then((ok) => { if (ok) { router.push("/together"); router.refresh(); } });
            }
          }}>{t.together.leave}</button>
        )}
      </div>
    </div>
    </div>
  );
}
