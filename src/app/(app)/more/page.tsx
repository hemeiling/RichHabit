import More from "@/components/screens/More";
import { getSessionUser } from "@/lib/auth";

export default async function Page() {
  const user = await getSessionUser();
  return <More email={user?.email ?? ""} />;
}
