import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import SpaceProgress from "@/components/together/SpaceProgress";
import { getSessionUser } from "@/lib/auth";
import { isUuid } from "@/lib/http";
import { togetherAccess } from "@/lib/together/access";

/**
 * A space's Project Progress & Contributions. The same gate as the Board: the
 * API the screen calls answers a non-member exactly as a space that does not
 * exist.
 */
export default async function SpaceProgressPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isUuid(params.id) || !(await togetherAccess(user.id))) notFound();
  return <Suspense><SpaceProgress boardId={params.id} /></Suspense>;
}
