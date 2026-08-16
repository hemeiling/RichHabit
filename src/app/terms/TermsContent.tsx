"use client";
import Link from "next/link";
import LanguageToggle from "@/components/LanguageToggle";
import { useT } from "@/lib/i18n/context";

/**
 * A client component, deliberately.
 *
 * The first version resolved the dictionary on the server with `getDict()`,
 * which meant the language toggle changed the cookie and the tab title but not
 * a word of the page until a reload — the switch looked broken. Reading the
 * dictionary from context is what makes switching instant here, exactly as it
 * is everywhere else in the app.
 */
export default function TermsContent() {
  const t = useT();

  return (
    <main className="mx-auto px-4 py-10" style={{ maxWidth: 560 }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">{t.appName}</div>
          <h1 className="display mt-1" style={{ fontSize: 27, lineHeight: 1.15 }}>
            {t.earlyAccess.termsTitle}
          </h1>
        </div>
        <LanguageToggle />
      </div>

      <section className="card p-5 mt-5">
        <div className="eyebrow">{t.earlyAccess.title}</div>
        <p className="mt-2" style={{ fontSize: 14.5, lineHeight: 1.65 }}>{t.earlyAccess.body}</p>
      </section>

      <section className="card p-5 mt-4">
        <div className="eyebrow">{t.earlyAccess.factsTitle}</div>
        <ul className="mt-2 flex flex-col gap-2" style={{ fontSize: 14, lineHeight: 1.6 }}>
          {t.earlyAccess.facts.map((f) => (
            <li key={f} className="flex gap-2">
              <span className="faint">·</span><span className="muted">{f}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-5">
        <Link href="/login" className="btn">{t.earlyAccess.back}</Link>
      </p>
    </main>
  );
}
