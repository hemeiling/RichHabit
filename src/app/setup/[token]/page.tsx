import SetupForm from "./SetupForm";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale } from "@/lib/i18n/server";

/**
 * Redeeming a setup link. Public by necessity — the person following it has no
 * account yet in any usable sense — but the token is the credential, and it is
 * checked, consumed and expired server-side.
 */
export default function SetupPage({ params }: { params: { token: string } }) {
  return (
    <LocaleProvider initial={getLocale()}>
      <SetupForm token={params.token} />
    </LocaleProvider>
  );
}
