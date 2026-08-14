import LoginForm from "./LoginForm";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale } from "@/lib/i18n/server";

export default function LoginPage() {
  return (
    <LocaleProvider initial={getLocale()}>
      <LoginForm />
    </LocaleProvider>
  );
}
