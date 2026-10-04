import { notFound, redirect } from "next/navigation";
import TogetherHome from "@/components/together/TogetherHome";
import { getSessionUser } from "@/lib/auth";
import { togetherAccess } from "@/lib/together/access";

/** Together home. For anyone without Together access it does not exist. */
export default async function TogetherPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!(await togetherAccess(user.id))) notFound();
  return <TogetherHome />;
}
