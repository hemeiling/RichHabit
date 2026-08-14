import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getSessionUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The real session check. Middleware only looked at whether a cookie existed.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return <AppShell userId={user.id}>{children}</AppShell>;
}
