"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { Avatar, call, type Person } from "@/components/together/shared";
import { Dialog } from "@/components/together/overlay";

/**
 * + Add members, without leaving the space: a centred dialog on a wide
 * screen, a sheet from the bottom on a phone (Together's `Dialog`).
 *
 * The list is the reader's one directory — accepted collaborators first, then
 * people from their other spaces — the same in every space they may invite
 * to, so nobody's address is ever typed twice. Members never appear; anyone
 * already invited here shows "Invitation pending" and cannot be picked again.
 * Several can be picked and invited in one go; email or username stays the
 * second way in. Nothing joins anyone to anything: each person still accepts.
 *
 * Someone who may not invite gets the plain reason instead of a missing
 * button. The server decides all of it (the same invitations endpoint as the
 * Members page); this screen only presents what it is told.
 */

interface Invitable extends Person { username: string | null; collaborator: boolean; pending: boolean }

export default function AddMembers({ boardId, canInvite, onClose, onInvited, onMembersPage = false }: {
  boardId: string; canInvite: boolean; onClose: () => void;
  /** After an invitation goes out — the Members page re-reads its pending list. */
  onInvited?: () => void;
  /** Opened from Members itself: no link back to the page already behind it. */
  onMembersPage?: boolean;
}) {
  const tt = useT();
  const t = tt.together;
  const [people, setPeople] = useState<Invitable[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [otherWay, setOtherWay] = useState(false);
  const searchId = useId();
  const whoId = useId();

  const load = useCallback(async () => {
    try {
      const board = await call<{ invitable: Invitable[] }>(`/api/together/boards/${boardId}`);
      setPeople(board.invitable);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPeople([]);
    }
  }, [boardId]);
  useEffect(() => { if (canInvite) void load(); }, [canInvite, load]);

  // The dialog places focus as it opens, before the list has arrived; once
  // it does, move to the search field — once, so a refresh never steals focus.
  const searchRef = useRef<HTMLInputElement>(null);
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !people?.length || !searchRef.current) return;
    placed.current = true;
    searchRef.current.focus({ preventScroll: true });
  }, [people]);

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => (people ?? []).filter((p) => !q
    || p.name.toLowerCase().includes(q) || (p.username ?? "").toLowerCase().includes(q)), [people, q]);
  const collaborators = shown.filter((p) => p.collaborator);
  const others = shown.filter((p) => !p.collaborator);

  const toggle = (id: string) => setPicked((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const run = async (fn: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    let done: string | null = null;
    try {
      done = await fn();
      onInvited?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // The confirmation lands together with the refreshed list, so "sent" is
    // never shown beside rows that do not yet say "Invitation pending".
    await load();
    setNotice(done);
    setBusy(false);
  };

  const invitePicked = () => run(async () => {
    const { invited } = await call<{ invited: number }>(`/api/together/boards/${boardId}/invitations`, {
      method: "POST", body: JSON.stringify({ people: picked }),
    });
    setPicked([]);
    return invited ? t.peopleInvited(invited) : t.nothingToInvite;
  });

  const inviteTyped = () => {
    const to = who.trim();
    if (!to) return;
    return run(async () => {
      if (to.includes("@")) {
        await call(`/api/together/boards/${boardId}/invitations`, { method: "POST", body: JSON.stringify({ email: to }) });
        setWho("");
        return t.inviteSent(to);
      }
      const { invited } = await call<{ invited: number }>(`/api/together/boards/${boardId}/invitations`, {
        method: "POST", body: JSON.stringify({ username: to }),
      });
      setWho("");
      return invited ? t.inviteSentInApp(to) : t.nothingToInvite;
    });
  };

  const membersHref = `/together/b/${boardId}/members`;
  const top = (
    <div className="tg-sheet-top">
      <h2 className="display" style={{ fontSize: 24 }}>{t.addMembers}</h2>
      <button type="button" className="btn btn-quiet tg-sheet-close" onClick={onClose}>{tt.common.close}</button>
    </div>
  );

  if (!canInvite) {
    return (
      <Dialog label={t.addMembers} onClose={onClose}>
        {top}
        <p className="muted tg-am-note" role="note">{t.ownerInvitesOnly}</p>
        {!onMembersPage && <Link href={membersHref} className="tg-am-manage" data-autofocus>{t.seeMembers} →</Link>}
      </Dialog>
    );
  }

  const row = (p: Invitable) => {
    const on = picked.includes(p.id);
    return (
      <li key={p.id}>
        <label className="tg-am-row" data-pending={p.pending || undefined} data-on={on || undefined}>
          <input type="checkbox" className="tg-am-check" checked={on} disabled={p.pending || busy}
            onChange={() => toggle(p.id)} aria-describedby={p.pending ? `${p.id}-pending` : undefined} />
          <Avatar name={p.name} size={30} />
          <span className="tg-am-who">
            <span className="tg-am-name">{p.name}</span>
            {p.username && p.username !== p.name && <span className="tg-am-handle">@{p.username}</span>}
          </span>
          {p.pending && <span id={`${p.id}-pending`} className="tg-am-pending">{t.invitationPending}</span>}
        </label>
      </li>
    );
  };

  const nobody = people !== null && people.length === 0;

  return (
    <Dialog label={t.addMembers} onClose={onClose}>
      {top}
      <p className="muted tg-am-note">{t.addMembersIntro}</p>
      {error && <p className="tg-sheet-error" role="alert">{error}</p>}
      <p className="tg-am-notice" role="status" aria-live="polite">{notice ?? ""}</p>

      {people === null ? (
        <p className="eyebrow py-6 text-center">{tt.common.loading}</p>
      ) : nobody ? (
        <p className="muted tg-am-note">{t.noCollaboratorsYet}</p>
      ) : (
        <>
          <label className="sr-only" htmlFor={searchId}>{t.searchByNameOrUsername}</label>
          <input id={searchId} ref={searchRef} className="input tg-am-search" type="search" value={search} autoComplete="off"
            autoCapitalize="none" spellCheck={false} placeholder={t.searchByNameOrUsername}
            onChange={(e) => setSearch(e.target.value)} />
          <div className="tg-am-list">
            {collaborators.length > 0 && (
              <fieldset>
                <legend className="eyebrow tg-am-legend">{t.pickCollaborators}</legend>
                <ul>{collaborators.map(row)}</ul>
              </fieldset>
            )}
            {others.length > 0 && (
              <fieldset>
                <legend className="eyebrow tg-am-legend">{t.pickOtherSpaces}</legend>
                <ul>{others.map(row)}</ul>
              </fieldset>
            )}
            {shown.length === 0 && <p className="muted tg-am-note">{t.noSearchMatch}</p>}
          </div>
          <div className="tg-am-send">
            <span className="sr-only" aria-live="polite">{picked.length ? t.nSelected(picked.length) : ""}</span>
            <button type="button" className="btn btn-primary" disabled={!picked.length || busy} onClick={() => void invitePicked()}>
              {t.inviteN(picked.length)}
            </button>
          </div>
        </>
      )}

      {/* The second way in: an address (by email) or a public username (in the app). */}
      <div className="tg-am-other">
        {otherWay || nobody ? (
          <form onSubmit={(e) => { e.preventDefault(); void inviteTyped(); }}>
            <label className="eyebrow block mb-1.5" htmlFor={whoId}>{t.inviteByEmailOrUsername}</label>
            <div className="flex gap-2 flex-wrap">
              <input id={whoId} className="input" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
                placeholder={t.inviteWhoPlaceholder} value={who} maxLength={254} autoFocus={otherWay && !nobody}
                onChange={(e) => setWho(e.target.value)} style={{ flex: "1 1 200px" }} />
              <button className="btn" type="submit" disabled={busy || !who.trim()}>{t.invite}</button>
            </div>
            <p className="faint mt-2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{t.inviteHow}</p>
          </form>
        ) : (
          <button type="button" className="tg-am-link" aria-expanded={false} onClick={() => setOtherWay(true)}>
            {t.inviteByEmailOrUsername}
          </button>
        )}
      </div>

      {!onMembersPage && <Link href={membersHref} className="tg-am-manage">{t.manageMembers} →</Link>}
    </Dialog>
  );
}
