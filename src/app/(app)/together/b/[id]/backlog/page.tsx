import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import SpaceWork from "@/components/together/SpaceWork";
import { getSessionUser } from "@/lib/auth";
import { isUuid } from "@/lib/http";
import { togetherAccess } from "@/lib/together/access";

/** A space's Backlog — what "we might" do. Same gate as the Board. */
export default async function SpaceBacklogPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isUuid(params.id) || !(await togetherAccess(user.id))) notFound();
  return <Suspense><SpaceWork boardId={params.id} viewerId={user.id} view="backlog" /></Suspense>;
}
