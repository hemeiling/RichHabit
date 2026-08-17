import VerifyContent from "./VerifyContent";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale } from "@/lib/i18n/server";

/**
 * Where a verification link lands.
 *
 * Public: the whole point is that nobody can sign in yet. The token in the
 * query string is the credential and is checked server-side, once, when the
 * button on this page posts it.
 */
export const dynamic = "force-dynamic";

export default function VerifyPage({ searchParams }: {
  searchParams: { token?: string };
}) {
  return (
    <LocaleProvider initial={getLocale()}>
      <VerifyContent token={searchParams.token ?? ""} />
    </LocaleProvider>
  );
}
