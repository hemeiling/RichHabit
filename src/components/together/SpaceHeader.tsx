"use client";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useT } from "@/lib/i18n/context";
import { boardColor, markColors } from "@/lib/together/identity";
import { AvatarRow, BoardMark, type Person } from "@/components/together/shared";

/**
 * The top of a space: its mark and name, Invite people (for whoever may invite),
 * who is in it (which opens Members) and a quiet ⋯ for the space's housekeeping. The work — Board, Backlog, History —
 * is one surface below it, so there are no view tabs; when Calendar arrives, a
 * small view switcher joins here. On the Members page a quiet link leads back
 * to the work.
 */

export type SpaceView = "work" | "members";

/** The space's colour as CSS variables, per theme — for the tab underline and the cards' hover edge. */
export function spaceStyle(id: string): CSSProperties {
  const c = markColors(boardColor(id));
  return { "--space-l": c.light.ink, "--space-d": c.dark.ink } as CSSProperties;
}

export default function SpaceHeader({ id, name, members, view, canInvite, onInvite, onMore }: {
  id: string;
  name: string;
  members: Person[];
  view: SpaceView;
  /** The server's answer to "may this reader invite here" — shows the Invite action; not a security check. */
  canInvite?: boolean;
  /** On the Members page: bring its invite form into view instead of navigating. */
  onInvite?: () => void;
  /** Opens the ⋯ menu; absent where the page has no housekeeping. */
  onMore?: (anchor: HTMLElement) => void;
}) {
  const t = useT().together;
  const href = (path: string) => `/together/b/${id}${path}`;
  // "Invite people" where there is room; on a phone, "Invite" — the full name stays the accessible one.
  const inviteLabel = (<>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M19 8v6M16 11h6" />
    </svg>
    <span className="tg-invite-long">{t.addPeople}</span>
    <span className="tg-invite-short" aria-hidden="true">{t.invite}</span>
  </>);
  return (
    <header className="tg-space-head">
      <div className="tg-space-row">
        <div className="tg-board-head">
          <BoardMark id={id} name={name} size={32} />
          <h2 className="display tg-board-title">{name}</h2>
        </div>
        <div className="tg-space-tools">
          {canInvite && (onInvite
            ? <button type="button" className="tg-invite-btn" aria-label={t.addPeople} onClick={onInvite}>{inviteLabel}</button>
            : <Link href={href("/members#invite")} className="tg-invite-btn" aria-label={t.addPeople}>{inviteLabel}</Link>)}
          <Link href={href("/members")} className="tg-members-link" aria-current={view === "members" ? "page" : undefined}>
            <AvatarRow people={members} label={t.work.membersOf(members.map((m) => m.name).join(", "))} />
          </Link>
          {onMore && (
            <button type="button" className="tg-more-btn" aria-haspopup="menu" aria-label={t.work.more}
              onClick={(e) => onMore(e.currentTarget)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {view === "members" && (
        <Link href={href("")} className="tg-back-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          {t.work.backToWork}
        </Link>
      )}
    </header>
  );
}
