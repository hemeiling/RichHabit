import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";
import { initialLoginMode, loginReturnPath } from "@/lib/loginMode";
import { getSessionUser } from "@/lib/auth";
import { google } from "@/lib/env";
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
  searchParams?: { mode?: string; then?: string; google?: string; gerr?: string };
}) {
  const returnTo = loginReturnPath(searchParams?.then);
  if (await getSessionUser()) redirect(returnTo ?? "/habits");

  // Google's callback lands back here with a step or a reason — keys, never prose.
  const googleStep = searchParams?.google === "linkExisting" ? "linkExisting"
    : searchParams?.google === "finish" ? "finish" : null;
  const googleError = searchParams?.gerr === "cancelled" ? "cancelled"
    : searchParams?.gerr === "disabled" ? "disabled"
      : searchParams?.gerr === "failed" ? "failed" : null;

  return (
    <LocaleProvider initial={getLocale()}>
      {/* The front page's Sign Up button opens this same screen on its
          registration form; everything else opens it on sign-in. */}
      <LoginForm initialMode={initialLoginMode(searchParams?.mode)} returnTo={returnTo}
        withGoogle={google.enabled} googleStep={googleStep} googleError={googleError}
        thenKeyword={returnTo ? searchParams?.then : undefined} />
    </LocaleProvider>
  );
}
