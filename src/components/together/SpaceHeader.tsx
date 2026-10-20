"use client";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useT } from "@/lib/i18n/context";
import { boardColor, markColors } from "@/lib/together/identity";
import { AvatarRow, BoardMark, type Person } from "@/components/together/shared";

/**
 * The top of a space: its mark and name, who is in it (which opens Members) and
 * a quiet ⋯ for the space's housekeeping (Members first). + Add members opens
 * the one invite dialog (AddMembers) in place, on the work and on Members
 * alike; Members itself manages who is in and who is pending.
 *
 * Under the name, a visible two-way switch — Board · Progress (看板 · 进展) —
 * between the work and its Project Progress & Contributions. It is navigation,
 * so it is links (the current one marked), and it carries the group filter
 * across, so a chosen group stays chosen. On the Members page a quiet link leads
 * back to the work instead.
 */

export type SpaceView = "work" | "progress" | "members";

/** The space's colour as CSS variables, per theme — for the tab underline and the cards' hover edge. */
export function spaceStyle(id: string): CSSProperties {
  const c = markColors(boardColor(id));
  return { "--space-l": c.light.ink, "--space-d": c.dark.ink } as CSSProperties;
}

export default function SpaceHeader({ id, name, members, view, group, onMore, onAddMembers }: {
  id: string;
  name: string;
  members: Person[];
  view: SpaceView;
  /** The group filter to carry from one view to the other ("all" carries nothing). */
  group?: string;
  /** Opens the ⋯ menu; absent where the page has no housekeeping. */
  onMore?: (anchor: HTMLElement) => void;
  /** Opens + Add members in place. Every member of a live space sees it: the
   *  owner to invite, anyone else to learn how people are invited here. */
  onAddMembers?: () => void;
}) {
  const t = useT().together;
  const href = (path: string) => `/together/b/${id}${path}`;
  const carry = group && group !== "all" ? `?group=${encodeURIComponent(group)}` : "";
  return (
    <header className="tg-space-head">
      <div className="tg-space-row">
        <div className="tg-board-head">
          <BoardMark id={id} name={name} size={32} />
          <h2 className="display tg-board-title">{name}</h2>
        </div>
        <div className="tg-space-tools">
          {onAddMembers && (
            <button type="button" className="btn btn-quiet tg-small tg-add-members" aria-haspopup="dialog"
              onClick={onAddMembers}>
              + {t.addMembers}
            </button>
          )}
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
      {view === "members" ? (
        <Link href={href("")} className="tg-back-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          {t.work.backToWork}
        </Link>
      ) : (
        <nav className="tg-views" aria-label={t.progress.views}>
          <Link href={`${href("")}${carry}`} className="tg-view" aria-current={view === "work" ? "page" : undefined}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3.5" y="4" width="5" height="16" rx="1.5" /><rect x="10.5" y="4" width="5" height="11" rx="1.5" /><rect x="17.5" y="4" width="3" height="7" rx="1.2" />
            </svg>
            {t.progress.board}
          </Link>
          <Link href={`${href("/progress")}${carry}`} className="tg-view" aria-current={view === "progress" ? "page" : undefined}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
            {t.progress.progress}
          </Link>
        </nav>
      )}
    </header>
  );
}
