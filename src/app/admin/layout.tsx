import AdminShell from "@/components/AdminShell";
import { requireAdminPage } from "@/lib/admin";

/**
 * Admin is deliberately outside the (app) group: it has no habit store and no
 * language switcher. It is an internal product-analytics tool, not part of the
 * product, and it stays English.
 *
 * The navigation is the same `Sidebar` component the app uses, with its own
 * items — one navigation architecture, two lists. Every page under here
 * re-checks the role; the layout guard is convenience, not the boundary.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  return <AdminShell email={admin.email}>{children}</AdminShell>;
}
