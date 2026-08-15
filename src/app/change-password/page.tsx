import { redirect } from "next/navigation";
import ChangePasswordForm from "./ChangePasswordForm";
import { getSessionUser } from "@/lib/auth";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale } from "@/lib/i18n/server";

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <LocaleProvider initial={getLocale()}>
      <ChangePasswordForm email={user.email} forced={user.mustChangePassword} />
    </LocaleProvider>
  );
}
