"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The app's navigation, and admin's. One component, two sets of items.
 *
 * It holds no strings of its own — every label, including the ones only screen
 * readers hear, arrives as a prop. That is what lets the same component serve
 * the bilingual app (labels from the dictionary) and admin (which is an
 * internal tool and stays English) without either language leaking into it.
 *
 * Desktop and mobile are one DOM. The drawer/persistent split is a media query
 * in `globals.css`, not a measured width in JS: measuring means the server and
 * the first client render can disagree, and the navigation would visibly jump
 * on load. That is also what makes the hierarchy below free on a phone — the
 * drawer renders the same tree, with the same indentation.
 */

export interface NavItem {
  href: string;
  label: string;
  /**
   * The second language, in bilingual mode, set on its own line beneath the
   * first.
   *
   * The dictionary joins a label as "Rich Habits · 富有习惯", which is right in
   * a sentence and wrong in a 244px column: the longer destinations already
   * wrapped mid-label, and nesting them would have made it worse. Two lines is
   * the designed version of what was happening by accident. Admin passes none
   * of these and is unchanged.
   */
  sublabel?: string;
  /** An SVG path, drawn at 24×24. Optional — admin's items are text only. */
  icon?: string;
  /**
   * Draws a hairline above this item, marking the start of a group.
   *
   * A rule rather than a heading: it says "a different kind of thing follows"
   * in one pixel, where a label would add chrome to a narrow column.
   */
  startsGroup?: boolean;
}

/**
 * A parent with destinations nested under it — My Journey, in the app.
 *
 * It is a heading you can fold, not a place you can go, so it has no `href`.
 * That is the reason this is a separate shape rather than a NavItem with
 * children: a parent that cannot be navigated to must not render as a link, or
 * a keyboard and a screen reader are both told something untrue.
 */
export interface NavGroup {
  /** Stable, and the key the remembered open state is stored under. */
  key: string;
  label: string;
  sublabel?: string;
  children: readonly NavItem[];
  startsGroup?: boolean;
}

export type NavNode = NavItem | NavGroup;

const isGroup = (node: NavNode): node is NavGroup => "children" in node;

/** One viewer's folded/unfolded preference. Never account data. */
const OPEN_KEY = (key: string) => `rh_nav_open_${key}`;

export default function Sidebar({
  brand, items, footer, open, onClose, closeLabel, navLabel,
}: {
  brand: React.ReactNode;
  items: readonly NavNode[];
  /** Account and sign out. Anchored to the bottom by `.sidebar-foot`. */
  footer?: React.ReactNode;
  open: boolean;
  onClose: () => void;
  closeLabel: string;
  navLabel: string;
}) {
  const pathname = usePathname();

  // Escape closes the drawer. Harmless on desktop, where it is never open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /**
   * `/more/spending` should light up `/more`, but `/habits` must not light up
   * because some other route starts with the same letters — hence the boundary.
   */
  const isActive = useCallback((href: string) =>
    pathname === href || pathname.startsWith(`${href}/`), [pathname]);

  const link = (item: NavItem) => (
    <Link href={item.href} className="navlink"
      aria-current={isActive(item.href) ? "page" : undefined}
      onClick={onClose}>
      {item.icon && (
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
          strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
          <path d={item.icon} />
        </svg>
      )}
      <span style={{ minWidth: 0, overflow: "hidden" }}>
        {item.label}
        {item.sublabel && <span className="navsub">{item.sublabel}</span>}
      </span>
    </Link>
  );

  return (
    <>
      {open && (
        <div className="sidebar-scrim" onClick={onClose} aria-hidden="true" />
      )}

      <nav className="sidebar" data-open={open} aria-label={navLabel}>
        <div className="flex items-center justify-between gap-2 px-4"
          style={{ height: 56, flex: "none" }}>
          {brand}
          {/* Only reachable while the drawer is over the page. */}
          <button className="btn btn-quiet sidebar-only-mobile"
            style={{ padding: "4px 9px", fontSize: 17, lineHeight: 1 }}
            onClick={onClose} aria-label={closeLabel}>×</button>
        </div>

        <div className="py-2" style={{ flex: "none" }}>
          {items.map((node) => (
            <Fragment key={isGroup(node) ? node.key : node.href}>
              {/* Inset to 20px so the rule starts where the labels do: the
                  navlink's own 8px margin plus its 12px padding. */}
              {node.startsGroup && (
                <div aria-hidden="true" style={{
                  borderTop: "1px solid var(--line-soft)", margin: "7px 20px 8px",
                }} />
              )}
              {isGroup(node)
                ? <Group group={node} isActive={isActive} link={link} />
                : link(node)}
            </Fragment>
          ))}
        </div>

        {footer && <div className="sidebar-foot pb-3">{footer}</div>}
      </nav>
    </>
  );
}

/**
 * A foldable parent and its destinations.
 *
 * Three decisions worth stating.
 *
 * The parent never wears a selected state. The child does, in the same pill
 * every other destination uses, and a second highlight above it would have the
 * sidebar claim you are in two places at once. What the parent does instead,
 * when something inside it is where you are, is go from muted to ink: present,
 * not competing.
 *
 * It opens itself whenever a child becomes the page you are on, so arriving at
 * one of the three can never leave it hidden. A deliberate fold by the reader
 * is then respected — a control that refuses to work on the three pages people
 * spend their time in is not a control.
 *
 * The open state is remembered in `localStorage`, read after mount so the
 * server and the first paint agree, and every access is guarded because a
 * private window throws on the property itself and a folded group is never
 * worth a blank screen. Default open: these are the product's core, and hiding
 * them behind a click on a first visit would be the wrong first impression.
 */
function Group({
  group, isActive, link,
}: {
  group: NavGroup;
  isActive: (href: string) => boolean;
  link: (item: NavItem) => React.ReactNode;
}) {
  const within = group.children.some((child) => isActive(child.href));
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(OPEN_KEY(group.key));
      if (stored !== null) setOpen(stored === "1");
    } catch { /* the default stands */ }
  }, [group.key]);

  useEffect(() => { if (within) setOpen(true); }, [within]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY(group.key), next ? "1" : "0");
    } catch { /* nothing to do */ }
  };

  return (
    <>
      <button type="button" className="navlink navgroup" data-within={within || undefined}
        aria-expanded={open} onClick={toggle}>
        {/*
          * The chevron sits in the slot the icons use, which is what makes the
          * row read as a disclosure rather than a destination, and means the
          * parent needs no invented glyph of its own.
          */}
        <svg className="navgroup-chev" data-open={open} width="19" height="19"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ flex: "none" }}>
          <path d="M10 8l4 4-4 4" />
        </svg>
        <span style={{ minWidth: 0, overflow: "hidden" }}>
          {group.label}
          {group.sublabel && <span className="navsub">{group.sublabel}</span>}
        </span>
      </button>

      {open && (
        <div className="navkids">
          {group.children.map((child) => (
            <Fragment key={child.href}>{link(child)}</Fragment>
          ))}
        </div>
      )}
    </>
  );
}

/** The hamburger. Hidden at the width where the sidebar is always visible. */
export function SidebarToggle({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="btn btn-quiet sidebar-only-mobile" onClick={onClick}
      style={{ padding: "6px 9px" }} aria-label={label}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <path d="M4 7h16 M4 12h16 M4 17h16" />
      </svg>
    </button>
  );
}
