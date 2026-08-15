import { redirect } from "next/navigation";
import More from "@/components/screens/More";
import { getSessionUser } from "@/lib/auth";
import { loadAccount } from "@/lib/db/queries";

export default async function Page() {
  // The layout already refused a signed-out visitor; this narrows the type and
  // means the account card can never render against a guess.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const account = await loadAccount(user.id);
  if (!account) redirect("/login");

  return <More account={account} />;
}
