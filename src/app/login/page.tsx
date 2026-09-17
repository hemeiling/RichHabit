import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";
import { initialLoginMode } from "@/lib/loginMode";
import { getSessionUser } from "@/lib/auth";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale } from "@/lib/i18n/server";

/**
 * Sends an already-signed-in visitor to /habits — checked against the session
 * row, not against the presence of a cookie.
 *
 * Middleware used to make this call, but it runs on the edge runtime and can
 * only see that a cookie exists. A stale cookie therefore looped: the layout
 * refused it and redirected here, and this redirected straight back.
 *
 * A stale cookie is simply ignored; the next successful sign-in overwrites it.
 */
export default async function LoginPage({ searchParams }: {
  searchParams?: { mode?: string };
}) {
  if (await getSessionUser()) redirect("/habits");

  return (
    <LocaleProvider initial={getLocale()}>
      {/* The front page's Sign Up button opens this same screen on its
          registration form; everything else opens it on sign-in. */}
      <LoginForm initialMode={initialLoginMode(searchParams?.mode)} />
    </LocaleProvider>
  );
}
