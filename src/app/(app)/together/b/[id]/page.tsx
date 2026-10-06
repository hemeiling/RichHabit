import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import SpaceWork from "@/components/together/SpaceWork";
import { getSessionUser } from "@/lib/auth";
import { isUuid } from "@/lib/http";
import { togetherAccess } from "@/lib/together/access";

/**
 * A space's work: Board, Backlog and History on one surface. Membership is
 * checked by the API the screen calls, which answers a non-member exactly as it
 * answers a space that does not exist.
 */
export default async function SpaceWorkPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isUuid(params.id) || !(await togetherAccess(user.id))) notFound();
  return <Suspense><SpaceWork boardId={params.id} viewerId={user.id} /></Suspense>;
}
