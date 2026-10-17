import { redirect } from "next/navigation";
import More from "@/components/screens/More";
import { getSessionUser } from "@/lib/auth";
import { loadAccount } from "@/lib/db/queries";
import { google } from "@/lib/env";

export default async function Page({ searchParams }: {
  searchParams?: { google?: string };
}) {
  // The layout already refused a signed-out visitor; this narrows the type and
  // means the account card can never render against a guess.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const account = await loadAccount(user.id);
  if (!account) redirect("/login");

  const googleNote = searchParams?.google === "connected" ? "connected"
    : searchParams?.google === "notYours" ? "notYours" : null;
  return <More account={account} googleEnabled={google.enabled} googleNote={googleNote} />;
}
