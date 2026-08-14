import Link from "next/link";
import { requireAdminPage } from "@/lib/admin";

/**
 * Admin is deliberately outside the (app) group: it has no habit store, no
 * bottom tab bar and no language switcher. It is an internal product-analytics
 * tool, not part of the product, and it stays English.
 *
 * Every page under here re-checks the role — the layout guard is convenience,
 * not the security boundary. Each page and API route checks for itself.
 */
const TABS = [
  ["/admin", "Overview"],
  ["/admin/users", "Users"],
  ["/admin/engagement", "Engagement"],
  ["/admin/retention", "Retention"],
  ["/admin/features", "Features"],
  ["/admin/funnel", "Funnel"],
  ["/admin/usage", "Usage times"],
  ["/admin/system", "System"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  return (
    <div style={{ minHeight: "100vh" }}>
      <header style={{ borderBottom: "1px solid var(--line)", background: "var(--bg)" }}>
        <div className="mx-auto px-4 sm:px-6 py-3" style={{ maxWidth: 1100 }}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="display" style={{ fontSize: 20 }}>Rich Habits · Admin</span>
            <span className="faint" style={{ fontSize: 12 }}>{admin.email}</span>
          </div>
          <nav className="flex flex-wrap gap-1.5 mt-2.5">
            {TABS.map(([href, label]) => (
              <Link key={href} href={href} className="chip" style={{ textDecoration: "none" }}>
                {label}
              </Link>
            ))}
            <Link href="/today" className="chip" style={{ textDecoration: "none", marginLeft: "auto" }}>
              ← Back to app
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto px-4 sm:px-6 py-5" style={{ maxWidth: 1100 }}>{children}</main>
    </div>
  );
}
