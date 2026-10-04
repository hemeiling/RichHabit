import { notFound, redirect } from "next/navigation";
import TogetherHome from "@/components/together/TogetherHome";
import { getSessionUser } from "@/lib/auth";
import { togetherEnabledFor } from "@/lib/together/access";

/** Together home. Outside the preview it does not exist. */
export default async function TogetherPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!togetherEnabledFor(user.id)) notFound();
  return <TogetherHome />;
}
