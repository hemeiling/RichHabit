import ResetContent from "./ResetContent";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale } from "@/lib/i18n/server";

/**
 * Where a reset link lands.
 *
 * Public: the whole point is that nobody can sign in. The token is not in the
 * query string — it arrives in the fragment, which browsers never send — so
 * this page receives nothing identifying at all, and the credential is read in
 * the browser and posted once. A signed-in visitor is deliberately *not*
 * redirected: somebody resetting a password may be doing it precisely because a
 * session they no longer trust is open.
 */
export const dynamic = "force-dynamic";

export default function ResetPage({ searchParams }: {
  searchParams: { token?: string };
}) {
  return (
    <LocaleProvider initial={getLocale()}>
      <ResetContent queryToken={searchParams.token ?? ""} />
    </LocaleProvider>
  );
}
