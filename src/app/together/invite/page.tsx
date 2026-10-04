import InviteLanding from "@/components/together/InviteLanding";
import { getSessionUser } from "@/lib/auth";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale } from "@/lib/i18n/server";
import { togetherEnabledFor } from "@/lib/together/access";

/**
 * A Together invitation, which must open for someone not yet signed in or not
 * yet registered — hence outside the signed-in app. It is told two booleans
 * and nothing else; the APIs it calls decide everything on the server.
 */
export const dynamic = "force-dynamic";

export default async function InvitePage() {
  const user = await getSessionUser();
  return (
    <LocaleProvider initial={getLocale()}>
      <InviteLanding signedIn={Boolean(user)} enabled={user ? togetherEnabledFor(user.id) : false} />
    </LocaleProvider>
  );
}
