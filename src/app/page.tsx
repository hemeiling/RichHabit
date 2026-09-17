import { redirect } from "next/navigation";
import Landing from "./Landing";
import { getSessionUser } from "@/lib/auth";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale } from "@/lib/i18n/server";

/**
 * The public front page, and the app's front door for somebody who has one.
 *
 * This address used to redirect straight to /habits, which meant a visitor
 * without an account bounced through the app and landed on the sign-in form
 * with no idea what they had arrived at.
 *
 * A visitor who is already signed in still goes to /habits, and the check is
 * the session row rather than the presence of a cookie — the same rule the
 * sign-in page uses, and for the same reason: a stale cookie must not loop.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  if (await getSessionUser()) redirect("/habits");

  return (
    <LocaleProvider initial={getLocale()}>
      <Landing />
    </LocaleProvider>
  );
}
