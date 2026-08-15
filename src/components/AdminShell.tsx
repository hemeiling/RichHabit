"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import Sidebar, { SidebarToggle, type NavItem } from "@/components/Sidebar";
import { useSignOut } from "@/components/useSignOut";

/**
 * Admin's chrome. Same sidebar component as the app, different items — and no
 * dictionary: admin is an internal product-analytics tool with one audience,
 * and it stays English on purpose. The strings live here rather than in the
 * shared component, which is exactly why that component takes labels as props.
 */
const ITEMS: readonly NavItem[] = [
  { href: "/admin", label: "Overview", icon: "M4 5h16v15H4z M4 10h16" },
  { href: "/admin/users", label: "Users", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" },
  { href: "/admin/engagement", label: "Engagement", icon: "M5 19V10 M10 19V5 M15 19v-6 M20 19v-9" },
  { href: "/admin/retention", label: "Retention", icon: "M4 17s3-8 8-8 8 8 8 8" },
  { href: "/admin/features", label: "Features", icon: "M5 7h14 M5 12h14 M5 17h9" },
  { href: "/admin/funnel", label: "Funnel", icon: "M4 5h16l-6 7v6l-4 2v-8z" },
  { href: "/admin/usage", label: "Usage times", icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2" },
  { href: "/admin/system", label: "System", icon: "M5 6h14v12H5z M9 10h6 M9 14h6" },
];

export default function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { signOut, busy } = useSignOut();

  return (
    <div style={{ minHeight: "100vh" }}>
      <Sidebar
        brand={<span className="display" style={{ fontSize: 18 }}>Rich Habits · Admin</span>}
        items={ITEMS}
        open={open} onClose={close}
        closeLabel="Close menu" navLabel="Admin navigation"
        footer={
          <div style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 8 }}>
            <div className="px-5 pt-2 pb-1 faint"
              style={{ fontSize: 12, overflowWrap: "anywhere", lineHeight: 1.35 }}>{email}</div>
            <Link href="/today" className="navlink" onClick={close}>← Back to app</Link>
            <button className="navlink" onClick={signOut} disabled={busy}>
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        }
      />

      <div className="with-sidebar">
        {/* Nothing in here but the drawer's affordances — the sidebar carries
            the title and the account once it is permanently on screen. */}
        <header className="sidebar-only-mobile" style={{
          position: "sticky", top: 0, zIndex: 20,
          background: "var(--bg)", borderBottom: "1px solid var(--line)",
        }}>
          <div className="mx-auto px-4 sm:px-6 flex items-center gap-2"
            style={{ maxWidth: 1100, height: 56 }}>
            <SidebarToggle onClick={() => setOpen(true)} label="Open menu" />
            <span className="display" style={{ fontSize: 18 }}>Admin</span>
          </div>
        </header>
        <main className="mx-auto px-4 sm:px-6 py-5" style={{ maxWidth: 1100 }}>{children}</main>
      </div>
    </div>
  );
}
