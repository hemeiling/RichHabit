"use client";
import { useEffect } from "react";
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
 * on load.
 */

export interface NavItem {
  href: string;
  label: string;
  /** An SVG path, drawn at 24×24. Optional — admin's items are text only. */
  icon?: string;
}

export default function Sidebar({
  brand, items, footer, open, onClose, closeLabel, navLabel,
}: {
  brand: React.ReactNode;
  items: readonly NavItem[];
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
   * `/more/spending` should light up `/more`, but `/today` must not light up
   * because some other route starts with the same letters — hence the boundary.
   */
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

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
          {items.map((item) => {
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href} className="navlink"
                aria-current={active ? "page" : undefined}
                onClick={onClose}>
                {item.icon && (
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
                    <path d={item.icon} />
                  </svg>
                )}
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>

        {footer && <div className="sidebar-foot pb-3">{footer}</div>}
      </nav>
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
