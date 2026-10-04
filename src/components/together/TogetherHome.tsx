"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Field, Sheet } from "@/components/ui";
import { useT } from "@/lib/i18n/context";
import { AvatarRow, Avatar, call, type Person } from "@/components/together/shared";

/**
 * Together home: invitations waiting for you, the boards you are on, and your
 * People — everyone you share a board with, whom you can invite to another.
 * One calm page; a new board is one sheet away.
 */

interface BoardSummary { id: string; name: string; role: "owner" | "member"; archived: boolean; members: Person[] }
interface Waiting { id: string; board: string; inviter: string; expiresAt: string }
interface Home { access: "full" | "invited"; boards: BoardSummary[]; people: Person[]; invitations: Waiting[] }

export default function TogetherHome() {
  const t = useT();
  const router = useRouter();
  const [home, setHome] = useState<Home | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    call<Home>("/api/together/home").then(setHome).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Back in the tab: someone may have invited you, or changed a board, meanwhile —
  // re-read the home and the shell's board shortcuts.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") { load(); router.refresh(); } };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [load, router]);

  const answer = async (id: string, accept: boolean) => {
    if (answering) return;
    setAnswering(id);
    setProblem(null);
    try {
      const r = await call<{ boardId?: string }>("/api/together/invitations/respond", {
        method: "POST", body: JSON.stringify({ id, accept }),
      });
      if (accept && r.boardId) { router.push(`/together/b/${r.boardId}`); router.refresh(); return; }
      router.refresh();   // the navigation's indicator
      load();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      load();
    }
    setAnswering(null);
  };

  if (failed) {
    return (
      <div className="card p-5" role="alert">
        <p style={{ fontSize: 14 }}>{t.together.loadFailed}</p>
        <button className="btn mt-3" onClick={load}>{t.together.retry}</button>
      </div>
    );
  }
  if (!home) return <div className="eyebrow py-10 text-center">{t.common.loading}</div>;

  const full = home.access === "full";
  const active = home.boards.filter((b) => !b.archived);
  const archived = home.boards.filter((b) => b.archived);

  return (
    <div className="tg-home">
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>{t.together.tagline}</p>

      {home.invitations.length > 0 && (
        <section className="mt-5" aria-labelledby="tg-invitations">
          <h2 id="tg-invitations" className="eyebrow">{t.together.invitations}</h2>
          <ul className="tg-board-list mt-3">
            {home.invitations.map((i) => (
              <li key={i.id} className="card tg-waiting">
                <p style={{ fontSize: 15 }}>{t.together.invitePage.invitedYou(i.inviter, i.board)}</p>
                <div className="flex gap-2 flex-wrap mt-3">
                  <button className="btn" disabled={answering !== null} onClick={() => answer(i.id, false)}>
                    {t.together.decline}
                  </button>
                  <button className="btn btn-primary" disabled={answering !== null} onClick={() => answer(i.id, true)}>
                    {t.together.accept}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* Outside the section: when an answer fails because the invitation is
          gone, the reload empties the list, and the reason must stay readable. */}
      {problem && <p className="mt-2" role="alert" style={{ color: "var(--warn)", fontSize: 13.5 }}>{problem}</p>}

      <section className="mt-5" aria-labelledby="tg-boards">
        <div className="flex items-center justify-between gap-3">
          <h2 id="tg-boards" className="eyebrow">{t.together.boards}</h2>
          {full && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ {t.together.newBoard}</button>}
        </div>
        {active.length === 0 ? (
          <p className="muted mt-3" style={{ fontSize: 14 }}>{t.together.noBoards}</p>
        ) : (
          <ul className="tg-board-list mt-3">
            {active.map((b) => <BoardCard key={b.id} board={b} />)}
          </ul>
        )}
        {archived.length > 0 && (
          <div className="mt-4">
            <button className="btn btn-quiet" aria-expanded={showArchived}
              onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "▾" : "▸"} {t.together.archivedBoards(archived.length)}
            </button>
            {showArchived && (
              <ul className="tg-board-list mt-2">
                {archived.map((b) => <BoardCard key={b.id} board={b} />)}
              </ul>
            )}
          </div>
        )}
      </section>

      {full ? (
        <section className="mt-7" aria-labelledby="tg-people">
          <h2 id="tg-people" className="eyebrow">{t.together.people}</h2>
          {home.people.length === 0 ? (
            <p className="muted mt-2" style={{ fontSize: 14 }}>{t.together.noPeople}</p>
          ) : (
            <ul className="tg-people mt-2">
              {home.people.map((p) => (
                <li key={p.id} className="tg-person"><Avatar name={p.name} /> <span>{p.name}</span></li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="faint mt-7" style={{ fontSize: 13 }}>{t.together.invitedOnly}</p>
      )}

      {creating && <NewBoardSheet people={home.people} onClose={() => setCreating(false)} />}
    </div>
  );
}

function BoardCard({ board }: { board: BoardSummary }) {
  const t = useT();
  return (
    <li>
      <Link href={`/together/b/${board.id}`} className="card tg-board-card" data-archived={board.archived || undefined}
        aria-label={t.together.openBoard(board.name)}>
        <span className="tg-board-name">{board.name}</span>
        <span className="tg-board-meta">
          <AvatarRow people={board.members} label={board.members.map((m) => m.name).join(", ")} />
          <span className="faint" style={{ fontSize: 12.5 }}>
            {t.together.memberCount(board.members.length)}
            {board.role === "owner" && ` · ${t.together.owner}`}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Name, then whom to invite: People by ticking them (an invitation inside
 * Together), anyone else by address (an email). Nobody joins until they accept.
 */
function NewBoardSheet({ people, onClose }: { people: Person[]; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [emails, setEmails] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partly, setPartly] = useState<{ id: string; failed: string[] } | null>(null);

  /** A first check only; the server validates every address again. */
  const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const addEmail = () => {
    const e = email.trim();
    if (!e) return;
    if (!looksLikeEmail(e)) { setError(t.together.errors.emailInvalid); return; }
    setError(null);
    setEmails((v) => (v.some((x) => x.toLowerCase() === e.toLowerCase()) ? v : [...v, e]));
    setEmail("");
  };

  const create = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    // An address typed but not yet added is meant, too.
    const typed = email.trim();
    if (typed && !looksLikeEmail(typed)) { setError(t.together.errors.emailInvalid); setBusy(false); return; }
    const all = typed && !emails.includes(typed) ? [...emails, typed] : emails;
    try {
      const r = await call<{ id: string; failedEmails: string[] }>("/api/together/boards", {
        method: "POST", body: JSON.stringify({ name, people: picked, emails: all }),
      });
      router.refresh();   // the board exists now: the sidebar's shortcuts
      if (r.failedEmails.length) { setPartly({ id: r.id, failed: r.failedEmails }); setBusy(false); return; }
      router.push(`/together/b/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (partly) {
    return (
      <Sheet open onClose={() => router.push(`/together/b/${partly.id}`)} title={t.together.newBoard}
        footer={<button className="btn btn-primary" onClick={() => router.push(`/together/b/${partly.id}`)}>
          {t.together.goToBoard}</button>}>
        <p role="alert" style={{ fontSize: 14, lineHeight: 1.55 }}>{t.together.createdPartly(partly.failed.join(", "))}</p>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title={t.together.newBoard}
      footer={<>
        <button className="btn" onClick={onClose}>{t.common.cancel}</button>
        <button className="btn btn-primary" onClick={create} disabled={busy || !name.trim()}>{t.together.create}</button>
      </>}>
      <Field label={t.together.boardName}>
        <input className="input" autoFocus maxLength={80} value={name} placeholder={t.together.boardNamePlaceholder}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) create(); }} />
      </Field>
      <fieldset className="mb-3">
        <legend className="eyebrow mb-1.5">{t.together.addPeople}</legend>
        {people.length === 0 ? (
          <p className="faint" style={{ fontSize: 13 }}>{t.together.noPeopleToAdd}</p>
        ) : (
          <ul className="tg-pick">
            {people.map((p) => (
              <li key={p.id}>
                <label className="tg-pick-row">
                  <input type="checkbox" checked={picked.includes(p.id)}
                    onChange={(e) => setPicked((v) => (e.target.checked ? [...v, p.id] : v.filter((x) => x !== p.id)))} />
                  <Avatar name={p.name} size={24} /> <span>{p.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {emails.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 mt-2" aria-label={t.together.inviteByEmail}>
            {emails.map((e) => (
              <li key={e} className="chip tg-email-chip">
                <span style={{ overflowWrap: "anywhere" }}>{e}</span>
                <button type="button" className="tg-chip-x" aria-label={t.together.removeEmail(e)}
                  onClick={() => setEmails((v) => v.filter((x) => x !== e))}>×</button>
              </li>
            ))}
          </ul>
        )}
        {emailOpen ? (
          <div className="flex gap-2 flex-wrap mt-2">
            <input className="input" type="email" autoFocus autoComplete="off" inputMode="email" maxLength={254}
              aria-label={t.together.inviteByEmail} placeholder={t.together.inviteEmailPlaceholder}
              value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: "1 1 200px" }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }} />
            <button type="button" className="btn" onClick={addEmail} disabled={!email.trim()}>{t.together.addEmail}</button>
          </div>
        ) : (
          <button type="button" className="btn btn-quiet mt-1" onClick={() => setEmailOpen(true)}>
            {t.together.inviteByEmailToggle}
          </button>
        )}
      </fieldset>
      <p className="faint" style={{ fontSize: 12.5 }}>{t.together.inviteAfterCreate}</p>
      {error && <p role="alert" style={{ color: "var(--warn)", fontSize: 13 }}>{error}</p>}
    </Sheet>
  );
}
