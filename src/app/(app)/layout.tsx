import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The real session check. Middleware only looked at whether a cookie existed.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Resolved server-side so the first paint is already in the right language.
  return <AppShell userId={user.id} locale={getLocale()}>{children}</AppShell>;
}
