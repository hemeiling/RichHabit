import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The real session check. Middleware only looked at whether a cookie existed.
  const user = await getSessionUser();
  if (!user) redirect("/login");
  /*
   * A temporary password gets you exactly one place. Enforced in the layout
   * rather than in middleware, because middleware cannot reach the database and
   * this is a fact about the user row, not about the cookie.
   */
  if (user.mustChangePassword) redirect("/change-password");

  // Resolved server-side so the first paint is already in the right language.
  return (
    <AppShell userId={user.id} email={user.email} locale={getLocale()}>
      {children}
    </AppShell>
  );
}
