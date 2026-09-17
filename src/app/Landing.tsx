"use client";
import Link from "next/link";
import LanguageToggle from "@/components/LanguageToggle";
import { useLocale, useT } from "@/lib/i18n/context";
import { en } from "@/lib/i18n/en";
import { zh } from "@/lib/i18n/zh";

/**
 * The public front page.
 *
 * One sentence, two buttons, and room to breathe. It explains nothing: a
 * visitor should feel what the product is for before they have read a second
 * line, and the only two things to do are join or come back.
 *
 * Two deliberate decisions about type.
 *
 * The statement is written as its own lines rather than left to wrap. A
 * headline this size is the whole page, and where it breaks is part of the
 * design — "Turn what matters / into what you do." is the sentence's own hinge,
 * and the Chinese breaks at its comma. Relying on the browser gave three
 * lopsided lines in English and four in Chinese, differently at every width.
 *
 * And bilingual mode is typeset, not concatenated. Everywhere else `both` joins
 * the languages with a middot, which is right for a label in a 244px sidebar
 * and wrong for a 68px headline, where it reads as a paragraph. So the
 * statement and its supporting line read the two dictionaries directly and
 * stack — English at full size, Chinese beneath at half, quieter — while the
 * buttons do use the joined labels, where "Sign Up · 注册" is exactly right.
 */

/** One line per line of copy, so the break is the one that was written. */
const Lines = ({ lines, lang }: { lines: readonly string[]; lang: string }) => (
  <>{lines.map((line) => <span key={line} lang={lang}>{line}</span>)}</>
);

export default function Landing() {
  const locale = useLocale();
  /* Joined in bilingual mode, which is what the buttons want. */
  const t = useT();
  const bilingual = locale === "both";
  /** The language the page leads in; Chinese leads only when Chinese is chosen. */
  const lead = locale === "zh" ? zh : en;
  const leadIsChinese = locale === "zh";

  return (
    <main className="lp">
      <header className="lp-top">
        {/*
          * The name, and under it the Chinese name rather than a second
          * slogan. Hidden in English, where it would be decoration nobody can
          * read.
          */}
        <div className="lp-brand">
          <span className="lp-wordmark">{en.appName}</span>
          {locale !== "en" && (
            <span className="lp-brand-zh lp-hans" lang="zh-Hans">{zh.appName}</span>
          )}
        </div>
        <LanguageToggle />
      </header>

      <div className="lp-hero">
        <h1 className={`lp-headline${leadIsChinese ? " lp-hans-display" : ""}`}
          data-script={leadIsChinese ? "hans" : "latin"}>
          <Lines lines={lead.landing.headline} lang={leadIsChinese ? "zh-Hans" : "en"} />
          {bilingual && (
            <span className="lp-headline-second lp-hans-display" lang="zh-Hans">
              <Lines lines={zh.landing.headline} lang="zh-Hans" />
            </span>
          )}
        </h1>

        <p className={`lp-support${leadIsChinese ? " lp-hans" : ""}`}>
          <Lines lines={lead.landing.support} lang={leadIsChinese ? "zh-Hans" : "en"} />
          {bilingual && (
            <span className="lp-support-second lp-hans" lang="zh-Hans">
              <Lines lines={zh.landing.support} lang="zh-Hans" />
            </span>
          )}
        </p>

        {/*
          * Two actions, nothing beside them. Both are ordinary links into the
          * existing sign-in screen — `?mode=signup` only decides which of its
          * two states it opens in, and every account is still created by the
          * one registration flow behind it.
          */}
        <div className="lp-actions">
          <Link href="/login?mode=signup" className="btn btn-primary lp-btn">
            {t.landing.signUp}
          </Link>
          <Link href="/login" className="btn lp-btn">
            {t.landing.logIn}
          </Link>
        </div>

        {/*
          * The one visual: four marks, the last one filled. It is the shape of
          * the product — direction, behaviour, action, and something finished —
          * without a word of explanation, and it is decoration as far as a
          * screen reader is concerned.
          */}
        <div className="lp-path" aria-hidden="true">
          <span className="lp-node" />
          <span className="lp-seg" />
          <span className="lp-node" />
          <span className="lp-seg" />
          <span className="lp-node" />
          <span className="lp-seg" />
          <span className="lp-node lp-node-done" />
        </div>
      </div>
    </main>
  );
}
