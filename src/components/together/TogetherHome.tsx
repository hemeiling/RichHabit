"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Field, Sheet } from "@/components/ui";
import { useT } from "@/lib/i18n/context";
import { AvatarRow, Avatar, call, type Person } from "@/components/together/shared";

/**
 * Together home: the boards this account is on, and its People — everyone it
 * shares a board with. One calm page; a new board is one sheet away.
 */

interface BoardSummary { id: string; name: string; role: "owner" | "member"; archived: boolean; members: Person[] }
interface Home { boards: BoardSummary[]; people: Person[] }

export default function TogetherHome() {
  const t = useT();
  const [home, setHome] = useState<Home | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    call<Home>("/api/together/home").then(setHome).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Back in the tab: someone may have added you to a board meanwhile.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [load]);

  if (failed) {
    return (
      <div className="card p-5" role="alert">
        <p style={{ fontSize: 14 }}>{t.together.loadFailed}</p>
        <button className="btn mt-3" onClick={load}>{t.together.retry}</button>
      </div>
    );
  }
  if (!home) return <div className="eyebrow py-10 text-center">{t.common.loading}</div>;

  const active = home.boards.filter((b) => !b.archived);
  const archived = home.boards.filter((b) => b.archived);

  return (
    <div className="tg-home">
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>{t.together.tagline}</p>

      <section className="mt-5" aria-labelledby="tg-boards">
        <div className="flex items-center justify-between gap-3">
          <h2 id="tg-boards" className="eyebrow">{t.together.boards}</h2>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ {t.together.newBoard}</button>
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

/** Name, then any People to put on it. Anyone else is invited from the board. */
function NewBoardSheet({ people, onClose }: { people: Person[]; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await call<{ id: string }>("/api/together/boards", {
        method: "POST", body: JSON.stringify({ name, people: picked }),
      });
      router.push(`/together/b/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

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
      </fieldset>
      <p className="faint" style={{ fontSize: 12.5 }}>{t.together.inviteAfterCreate}</p>
      {error && <p role="alert" style={{ color: "var(--warn)", fontSize: 13 }}>{error}</p>}
    </Sheet>
  );
}
