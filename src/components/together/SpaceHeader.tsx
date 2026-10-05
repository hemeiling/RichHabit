"use client";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useT } from "@/lib/i18n/context";
import { boardColor, markColors } from "@/lib/together/identity";
import { AvatarRow, BoardMark, type Person } from "@/components/together/shared";

/**
 * The top of a space: its mark and name, who is in it (which opens Members),
 * a quiet ⋯ for the space's housekeeping, and the work views.
 *
 * The views are a registry, so Calendar joins later as one more entry. They
 * are links — each view has its own address — styled as tabs, with the
 * space's own colour under the one you are on: the only colour on the page
 * besides the mark.
 */

export type SpaceView = "board" | "backlog" | "members";

const VIEWS = [
  { key: "board", path: "" },
  { key: "backlog", path: "/backlog" },
] as const;

/** The space's colour as CSS variables, per theme — for the tab underline and the cards' hover edge. */
export function spaceStyle(id: string): CSSProperties {
  const c = markColors(boardColor(id));
  return { "--space-l": c.light.ink, "--space-d": c.dark.ink } as CSSProperties;
}

export default function SpaceHeader({ id, name, members, view, backlogCount, onMore }: {
  id: string;
  name: string;
  members: Person[];
  view: SpaceView;
  backlogCount?: number;
  /** Opens the ⋯ menu; absent where the page has no housekeeping. */
  onMore?: (anchor: HTMLElement) => void;
}) {
  const t = useT().together;
  const href = (path: string) => `/together/b/${id}${path}`;
  return (
    <header className="tg-space-head">
      <div className="tg-space-row">
        <div className="tg-board-head">
          <BoardMark id={id} name={name} size={32} />
          <h2 className="display tg-board-title">{name}</h2>
        </div>
        <div className="tg-space-tools">
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
      <nav className="tg-tabs" aria-label={t.work.views}>
        {VIEWS.map((v) => (
          <Link key={v.key} href={href(v.path)} className="tg-tab" aria-current={view === v.key ? "page" : undefined}>
            {t.work[v.key]}
            {v.key === "backlog" && backlogCount !== undefined && backlogCount > 0 && (
              <span className="tg-tab-n">{backlogCount}</span>
            )}
          </Link>
        ))}
      </nav>
    </header>
  );
}
