import { notFound, redirect } from "next/navigation";
import SpaceMembers from "@/components/together/SpaceMembers";
import { getSessionUser } from "@/lib/auth";
import { isUuid } from "@/lib/http";
import { togetherAccess } from "@/lib/together/access";

/** A space's members, invitations and the owner's housekeeping. Same gate as the Board. */
export default async function SpaceMembersPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isUuid(params.id) || !(await togetherAccess(user.id))) notFound();
  return <SpaceMembers boardId={params.id} viewerId={user.id} />;
}
