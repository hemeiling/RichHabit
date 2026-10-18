import FragmentSetup from "./FragmentSetup";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale } from "@/lib/i18n/server";

/**
 * Redeeming a setup link issued as `/setup#token=…` (UM-4). Public by
 * necessity; the token is the credential, checked, consumed and expired
 * server-side by /api/auth/setup exactly as for the older path-style links.
 */
export default function SetupPage() {
  return (
    <LocaleProvider initial={getLocale()}>
      <FragmentSetup />
    </LocaleProvider>
  );
}
