"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useHabits } from "@/components/store";
import { Sheet } from "@/components/ui";
import * as db from "@/lib/db";
import { dict, type Locale } from "@/lib/i18n";
import { joinPair } from "@/lib/i18n/both";
import { useLocale, useSetLocale, useT } from "@/lib/i18n/context";
import {
  newestShown, releaseById, unreadReleases, type Release, type ReleaseIcon,
} from "@/lib/releases";

/**
 * The right-hand side of the signed-in header: What's New, then Language.
 *
 * Quiet text controls from 900px, where the sidebar is always on screen and the
 * header has room; 44×44 icon buttons below that, so a phone header keeps its
 * title. In bilingual mode a label is two short lines rather than one long
 * joined one — the same treatment the sidebar gives its items.
 *
 * Nothing here opens by itself, counts anything or moves: the person's own
 * habits and priorities are the page, and this is chrome.
 */

/* --------------------------------- icons ---------------------------------- */

/** Open strokes, at the sidebar's weight, so the header reads as one family. */
const ICON_PATHS = {
  sparkle: "M12 3.5l1.8 4.9 4.9 1.8-4.9 1.8L12 16.9l-1.8-4.9-4.9-1.8 4.9-1.8z M18.6 15.2l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3.5 12h17 M12 3c2.6 2.5 3.9 5.5 3.9 9s-1.3 6.5-3.9 9c-2.6-2.5-3.9-5.5-3.9-9S9.4 5.5 12 3z",
  calendar: "M4.5 6h15v14h-15z M4.5 10.5h15 M8.5 3.5v4 M15.5 3.5v4",
  crown: "M4 17.5l-1-9.5 5 4 4-7 4 7 5-4-1 9.5z M5 20.5h14",
  check: "M5 12.5l4.2 4.2L19 7",
} as const;

function Icon({ name, size = 18 }: { name: keyof typeof ICON_PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

const RELEASE_ICON: Record<ReleaseIcon, keyof typeof ICON_PATHS> = {
  calendar: "calendar", crown: "crown", sparkle: "sparkle",
};

/** A control's visible label: one line, or two short ones in bilingual mode. */
function ControlLabel({ locale, en, zh }: { locale: Locale; en: string; zh: string }) {
  if (locale !== "both") {
    return <span className="hdr-label">{locale === "zh" ? zh : en}</span>;
  }
  return (
    <span className="hdr-label hdr-label-two">
      <span lang="zh">{zh}</span>
      <span lang="en">{en}</span>
    </span>
  );
}

/** Closes on a press anywhere outside `ref` — without moving focus anywhere. */
function useOutsidePress(ref: React.RefObject<HTMLElement>, active: boolean, onOutside: () => void) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [ref, active, onOutside]);
}

/* -------------------------------- Language -------------------------------- */

/**
 * Each option is written in its own language and never translated, so whoever
 * cannot read the current one can still find theirs. For the same reason the
 * trigger's accessible name is always "Language · 语言", and its icon is a globe.
 */
const LANGUAGES: { locale: Locale; label: string; lang?: string }[] = [
  { locale: "both", label: "双语 · Bilingual" },
  { locale: "en", label: "English", lang: "en" },
  { locale: "zh", label: "中文", lang: "zh" },
];
const LANGUAGE_NAME = "Language · 语言";

export function LanguageMenu() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);
  const outside = useCallback(() => close(false), [close]);
  useOutsidePress(wrap, open, outside);

  // Opening puts focus on the language in use, as a radio group would.
  useEffect(() => {
    if (!open) return;
    const i = Math.max(0, LANGUAGES.findIndex((o) => o.locale === locale));
    items.current[i]?.focus();
    // Only when it opens, not when the language changes underneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const move = (to: number) => {
    const n = LANGUAGES.length;
    items.current[(to + n) % n]?.focus();
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    const at = items.current.findIndex((el) => el === document.activeElement);
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(at + 1); break;
      case "ArrowUp": e.preventDefault(); move(at - 1); break;
      case "Home": e.preventDefault(); move(0); break;
      case "End": e.preventDefault(); move(LANGUAGES.length - 1); break;
      case "Escape": e.preventDefault(); close(true); break;
      case "Tab": close(false); break;
    }
  };
  const choose = (next: Locale) => {
    if (next !== locale) setLocale(next);
    close(true);
  };

  return (
    <div className="hdr-anchor" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="hdr-ctl"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={LANGUAGE_NAME}
        title={LANGUAGE_NAME}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); }
        }}
      >
        <Icon name="globe" />
        <ControlLabel locale={locale} en={dict("en").language.label} zh={dict("zh").language.label} />
      </button>

      {open && (
        <div id={menuId} role="menu" aria-label={LANGUAGE_NAME} className="hdr-pop lang-pop" onKeyDown={onMenuKey}>
          <div className="hdr-pop-heading" aria-hidden="true">{LANGUAGE_NAME}</div>
          {LANGUAGES.map((o, i) => (
            <button
              key={o.locale}
              ref={(el) => { items.current[i] = el; }}
              type="button"
              role="menuitemradio"
              aria-checked={locale === o.locale}
              tabIndex={-1}
              lang={o.lang}
              className="lang-item"
              onClick={() => choose(o.locale)}
            >
              <span className="lang-check">{locale === o.locale && <Icon name="check" size={16} />}</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- What's New ------------------------------- */

/** Narrow enough that an anchored panel would be squeezed: use the sheet. */
const PHONE = "(max-width: 639px)";

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
}

/** A release's day, as published (UTC), with its year. */
function releaseDate(iso: string, locale: Locale): string {
  const one = (tag: string) => new Date(iso).toLocaleDateString(tag,
    { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  return locale === "both" ? joinPair(one("en-US"), one("zh-CN")) : one(locale === "zh" ? "zh-CN" : "en-US");
}

export function WhatsNew() {
  const { state, actions } = useHabits();
  const t = useT();
  const locale = useLocale();
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  /** What was unread when the panel opened — its "New" tags outlive the mark. */
  const [newWhenOpened, setNewWhenOpened] = useState<string[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  /** One report per opening, even if the panel re-mounts (sheet ↔ popover). */
  const reported = useRef(false);

  const { releases, seenAt, accountCreatedAt } = state.whatsNew;
  // Only releases this build can show: never mark seen something not on screen.
  const shown = releases.filter((r) => releaseById(r.id));
  const unread = unreadReleases(shown, seenAt, accountCreatedAt);
  const hasUnread = unread.length > 0;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);
  const outside = useCallback(() => close(false), [close]);
  // The sheet has its own scrim; outside presses only matter for the popover.
  useOutsidePress(wrap, open && !phone, outside);

  // The popover answers Escape wherever focus is while it is open. (The sheet
  // handles its own.)
  useEffect(() => {
    if (!open || phone) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(true); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, phone, close]);

  const toggle = () => {
    if (open) { close(true); return; }
    setNewWhenOpened(unread);
    reported.current = false;
    setOpen(true);
  };

  const panel = (
    <WhatsNewPanel
      releases={shown}
      newIds={newWhenOpened}
      locale={locale}
      onShown={(ids) => {
        if (reported.current) return;
        reported.current = true;
        const newest = newestShown(ids);
        if (newest) void actions.markWhatsNewSeen(newest.id);
      }}
      onFollow={(id) => { void db.whatsNewCta(id); close(false); }}
      onClose={() => close(true)}
      inSheet={phone}
    />
  );

  return (
    <div
      className="hdr-anchor"
      ref={wrap}
      // The popover is non-modal: tabbing out of it closes it, as clicking out does.
      onBlur={(e) => {
        if (open && !phone && !wrap.current?.contains(e.relatedTarget as Node | null)) close(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="hdr-ctl"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hasUnread ? t.whatsNew.openUnread : t.whatsNew.open}
        title={t.whatsNew.open}
        onClick={toggle}
      >
        <span className="hdr-icon">
          <Icon name="sparkle" />
          {hasUnread && <span className="hdr-dot" aria-hidden="true" />}
        </span>
        <ControlLabel locale={locale} en={dict("en").whatsNew.open} zh={dict("zh").whatsNew.open} />
      </button>

      {open && (phone
        ? <Sheet open onClose={() => close(true)} title={t.whatsNew.title}>{panel}</Sheet>
        : panel)}
    </div>
  );
}

/**
 * The release history. Calls `onShown` once, after it has been painted with
 * the releases in it — what it reports is what was actually on screen, and the
 * unread mark moves only when the server has recorded that.
 */
function WhatsNewPanel({
  releases, newIds, locale, onShown, onFollow, onClose, inSheet,
}: {
  releases: { id: string; preview: boolean }[];
  newIds: string[];
  locale: Locale;
  onShown: (ids: string[]) => void;
  onFollow: (id: string) => void;
  onClose: () => void;
  inSheet: boolean;
}) {
  const t = useT();
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const reported = useRef(false);

  useEffect(() => {
    // Focus into the panel, so a keyboard user is where the content is.
    box.current?.focus();
    // Two frames: the first lets the panel be laid out, the second runs after
    // it has been painted. Only then is it "shown".
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (reported.current || !box.current) return;
        const ids = Array.from(box.current.querySelectorAll<HTMLElement>("[data-release]"))
          .map((el) => el.dataset.release!);
        reported.current = true;
        onShown(ids);
      });
    });
    return () => cancelAnimationFrame(frame);
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body = (
    <ol className="wn-list">
      {releases.map(({ id, preview }) => {
        const r = releaseById(id) as Release;
        return (
          <li key={id} data-release={id} className="wn-item">
            <span className="wn-icon"><Icon name={RELEASE_ICON[r.icon]} size={18} /></span>
            <ReleaseText release={r} preview={preview} isNew={newIds.includes(id)} locale={locale}
              onFollow={() => onFollow(id)} />
          </li>
        );
      })}
    </ol>
  );

  if (inSheet) {
    return (
      <div ref={box} tabIndex={-1} className="wn-sheet" aria-label={t.whatsNew.title}>{body}</div>
    );
  }
  return (
    <div
      ref={box}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="hdr-pop wn-pop"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
    >
      <div className="wn-head">
        <h2 id={titleId} className="wn-title">{t.whatsNew.title}</h2>
        <button type="button" className="btn btn-quiet wn-close" onClick={onClose}>{t.common.close}</button>
      </div>
      {body}
    </div>
  );
}

function ReleaseText({
  release, preview, isNew, locale, onFollow,
}: {
  release: Release; preview: boolean; isNew: boolean; locale: Locale; onFollow: () => void;
}) {
  const t = useT();
  const en = dict("en").whatsNew.releases[release.id];
  const zh = dict("zh").whatsNew.releases[release.id];
  const one = locale === "zh" ? zh : en;
  const cta = "cta" in en ? { en: en.cta, zh: (zh as typeof en).cta } : null;

  return (
    <div className="wn-text">
      {locale === "both" ? (
        <h3 className="wn-item-title">
          <span lang="zh">{zh.title}</span>
          <span lang="en" className="wn-second">{en.title}</span>
        </h3>
      ) : (
        <h3 className="wn-item-title">{one.title}</h3>
      )}
      {isNew && <span className="wn-new">{t.whatsNew.newTag}</span>}

      {locale === "both" ? (
        <>
          <p className="wn-body" lang="zh">{zh.body}</p>
          <p className="wn-body wn-second" lang="en">{en.body}</p>
        </>
      ) : (
        <p className="wn-body">{one.body}</p>
      )}

      {preview && release.audience && (
        <p className="wn-audience">{t.whatsNew.shownTo[release.audience]}</p>
      )}

      <div className="wn-foot">
        <span className="wn-date num">{releaseDate(release.publishedAt, locale)}</span>
        {cta && release.href && (
          <Link href={release.href} className="wn-cta" onClick={onFollow}>
            {locale === "both" ? `${cta.zh} · ${cta.en}` : locale === "zh" ? cta.zh : cta.en} →
          </Link>
        )}
      </div>
    </div>
  );
}
