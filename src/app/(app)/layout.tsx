import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { databaseUrl, isLocalDatabase } from "@/lib/env";

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

  /*
   * Whether this page is reading the development database.
   *
   * Resolved on the server, where the connection string actually is. It exists
   * because an empty local account and a catastrophically empty production
   * account look identical in a browser — the same "0 / 0 habits", the same
   * empty board — and the only thing that distinguishes them is a value the
   * user cannot see. That ambiguity has already cost one genuine scare.
   */
  const localDb = isLocalDatabase(databaseUrl());

  // Resolved server-side so the first paint is already in the right language.
  return (
    <AppShell userId={user.id} email={user.email} locale={getLocale()} localDb={localDb}>
      {children}
    </AppShell>
  );
}
