import { redirect } from "next/navigation";
import ForgotForm from "./ForgotForm";
import { getSessionUser } from "@/lib/auth";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale } from "@/lib/i18n/server";

/**
 * Asking for a reset link.
 *
 * Public, because somebody who cannot sign in is exactly who needs it. A
 * visitor who *is* signed in has no business here and is sent to the app —
 * checked against the session row, like every other page that makes that call.
 */
export const dynamic = "force-dynamic";

export default async function ForgotPage() {
  if (await getSessionUser()) redirect("/habits");

  return (
    <LocaleProvider initial={getLocale()}>
      <ForgotForm />
    </LocaleProvider>
  );
}
