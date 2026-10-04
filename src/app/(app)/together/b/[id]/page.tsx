import { notFound, redirect } from "next/navigation";
import BoardShell from "@/components/together/BoardShell";
import { getSessionUser } from "@/lib/auth";
import { isUuid } from "@/lib/http";
import { togetherEnabledFor } from "@/lib/together/access";

/**
 * One board. Membership is checked by the API the shell calls, which answers a
 * non-member exactly as it answers a board that does not exist.
 */
export default async function BoardPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!togetherEnabledFor(user.id) || !isUuid(params.id)) notFound();
  return <BoardShell boardId={params.id} viewerId={user.id} />;
}
