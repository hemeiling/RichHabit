"use client";
import type { CSSProperties } from "react";
import { boardColor, boardInitial, markColors } from "@/lib/together/identity";

/**
 * Small pieces shared by the Together screens. Nothing here knows about any
 * private RichHabit data; a person is an id and a display name.
 */

export interface Person { id: string; name: string }

/** A JSON call to a Together API. Throws the server's own (translated) sentence. */
export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(data?.error || `Request failed (${res.status})`) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return data as T;
}

/*
 * A sentence for Together Overview to show once, after an action that leaves
 * the page it happened on (deleting or leaving a space). Kept in this tab's
 * session only — never in the address, where a space's name would end up in
 * history — and read once. Storage can be unavailable (private mode); then
 * the message is simply skipped and nothing else changes.
 */
const NOTICE_KEY = "rh:together:notice";
export function leaveNotice(text: string) {
  try { sessionStorage.setItem(NOTICE_KEY, text); } catch { /* no storage: no message */ }
}
export function takeNotice(): string | null {
  try {
    const text = sessionStorage.getItem(NOTICE_KEY);
    sessionStorage.removeItem(NOTICE_KEY);
    return text;
  } catch { return null; }
}

/**
 * Where to go once a space is no longer yours to open (deleted, or left), with
 * the sentence to show there. Overview when Together still exists for this
 * account; otherwise — someone outside the preview who had only that space —
 * Today, since Together has nothing left to show them.
 */
export function afterSpaceGone(router: { push: (href: string) => void; refresh: () => void },
  together: boolean | undefined, message: string) {
  if (together === false) {
    router.push("/habits");
  } else {
    leaveNotice(message);
    router.push("/together");
  }
  router.refresh();   // the sidebar's list of spaces comes from the server
}

/** A trash can, for the one destructive item in a menu. */
export function TrashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}

/** Up to two letters, from the display name. */
export const initials = (name: string) =>
  (name.trim().split(/\s+/).map((w) => [...w][0] ?? "").slice(0, 2).join("") || "·").toUpperCase();

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span className="tg-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Overlapping avatars, with the full list as the accessible name. */
export function AvatarRow({ people, label }: { people: Person[]; label: string }) {
  const shown = people.slice(0, 5);
  return (
    <span className="tg-avatars" role="img" aria-label={label}>
      {shown.map((p) => <Avatar key={p.id} name={p.name} size={26} />)}
      {people.length > shown.length && <span className="tg-avatar tg-more" aria-hidden="true">+{people.length - shown.length}</span>}
    </span>
  );
}

/**
 * A board's mark: a soft tile of the board's colour with its initial — the same
 * identity in the sidebar (19px), on the overview's tiles (44px) and beside the
 * board's title. From 28px up it carries a faint three-by-three grid, the
 * "cube face" that makes a collection of boards read as a set. Decorative: the
 * board's name always sits beside it.
 */
export function BoardMark({ id, name, size = 19 }: { id: string; name: string; size?: number }) {
  const c = markColors(boardColor(id));
  const style = {
    width: size, height: size,
    fontSize: Math.round(size * (size >= 28 ? 0.44 : 0.54)),
    borderRadius: Math.max(5, Math.round(size * 0.27)),
    "--mk-ink-l": c.light.ink, "--mk-fill-l": c.light.fill, "--mk-edge-l": c.light.edge, "--mk-grid-l": c.light.grid,
    "--mk-ink-d": c.dark.ink, "--mk-fill-d": c.dark.fill, "--mk-edge-d": c.dark.edge, "--mk-grid-d": c.dark.grid,
  } as CSSProperties;
  return (
    <span className="tg-mark" data-grid={size >= 28 || undefined} aria-hidden="true" style={style}>
      {boardInitial(name)}
    </span>
  );
}
