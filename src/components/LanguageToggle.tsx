"use client";
import { LOCALES, dict } from "@/lib/i18n";
import { setLocale, useLocale } from "@/lib/i18n/context";

/**
 * Each option is written in its own language — someone who can't read the
 * current one still needs to find the way out.
 */
export default function LanguageToggle({ small }: { small?: boolean }) {
  const current = useLocale();
  return (
    <div className="flex flex-wrap gap-1.5">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className="chip"
          data-on={current === l}
          lang={l}
          style={small ? { padding: "5px 11px", fontSize: 12.5 } : undefined}
          onClick={() => current !== l && setLocale(l)}
        >
          {l === "both" ? "EN+中文" : dict(l).localeName}
        </button>
      ))}
    </div>
  );
}
