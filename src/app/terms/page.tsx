import TermsContent from "./TermsContent";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale } from "@/lib/i18n/server";

/**
 * The free early-access terms in full.
 *
 * Public, because it is linked from the sign-in card and has to be readable
 * before anyone has an account. It says the same thing the card says, plus
 * statements about how the app already behaves — nothing here promises
 * anything the application does not already do.
 */
export const dynamic = "force-dynamic";

export default function TermsPage() {
  return (
    <LocaleProvider initial={getLocale()}>
      <TermsContent />
    </LocaleProvider>
  );
}
