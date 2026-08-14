"use client";
import { LOCALES } from "@/lib/i18n";
import { useLocale, useSetLocale } from "@/lib/i18n/context";

/**
 * EN | 中文, in the header, on every screen.
 *
 * Each option is written in its own language — someone who cannot read the
 * current one still has to be able to find the way out. Switching is instant:
 * the dictionary is swapped in React state, so nothing reloads and nothing
 * loses its scroll position or half-typed input.
 */
const SHORT: Record<string, string> = { en: "EN", zh: "中文", both: "双语" };

export default function LanguageToggle() {
  const current = useLocale();
  const setLocale = useSetLocale();

  return (
    <div className="flex items-center" role="group" aria-label="Language · 语言">
      {LOCALES.map((l, i, shown) => (
        <span key={l} className="flex items-center">
          <button
            type="button"
            lang={l === "both" ? undefined : l}
            aria-pressed={current === l}
            onClick={() => current !== l && setLocale(l)}
            className="btn btn-quiet"
            style={{
              padding: "3px 7px", fontSize: 12.5, borderColor: "transparent",
              color: current === l ? "var(--ink)" : "var(--faint)",
              fontWeight: current === l ? 600 : 400,
            }}
          >
            {SHORT[l]}
          </button>
          {i < shown.length - 1 && (
            <span className="faint" aria-hidden="true" style={{ fontSize: 11 }}>|</span>
          )}
        </span>
      ))}
    </div>
  );
}
