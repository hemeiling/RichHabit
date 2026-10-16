"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHabits } from "@/components/store";
import { Sheet } from "@/components/ui";
import * as db from "@/lib/db";
import { prettyDateFor, shortDateFor } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/context";
import { QUADRANTS } from "@/lib/priorities";
import type { Priority, PriorityCategory, PriorityLink } from "@/lib/types";

/**
 * A priority's details: everything beyond the words on the card, all of it
 * optional. A side panel on desktop and the bottom sheet on a phone, reading
 * the live row from the store so the card and the panel can never disagree.
 *
 * Editing autosaves. The title and the notes write the way the journal does —
 * the screen is live at once, one write goes out when the typing pauses, and
 * the store owns the timer, so closing the panel never loses words. Links and
 * files are discrete acts and save on the spot. Failures follow the house
 * rule: the banner explains, the optimistic change rolls back, and whatever
 * was typed stays put.
 *
 * Attachments: metadata is listed here; bytes go up as multipart and come
 * back through a session-checked download. Nothing in this panel ever builds
 * a public URL, and the link list renders only http(s) — the API refuses
 * anything else, and the anchor carries rel="noopener noreferrer".
 */

const QUADRANT_COLOR: Record<PriorityCategory, string> = {
  urgent_important: "var(--q-urgent-important)",
  urgent_not_important: "var(--q-urgent-not-important)",
  important_not_urgent: "var(--q-important-not-urgent)",
  not_important_not_urgent: "var(--q-not-important-not-urgent)",
  unsorted: "var(--q-important-not-urgent)",
};

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
}

export default function PriorityDetails({
  item, date, onSetCategory, onClose,
}: {
  item: Priority;
  date: string;
  /** Runs through the same layout move every other path uses. */
  onSetCategory: (category: PriorityCategory) => void;
  onClose: () => void;
}) {
  const { actions } = useHabits();
  const t = useT();
  const locale = useLocale();
  const phone = usePhone();
  const d = t.priorities.details;

  /*
   * The title keeps a local draft so emptiness can be refused without ever
   * sending it: blanking the field is not a way to delete a priority. Any
   * non-empty pause of the typing saves; closing with an empty field simply
   * leaves the last saved words standing.
   */
  const [title, setTitle] = useState(item.text);
  const [titleEmpty, setTitleEmpty] = useState(false);
  const titleTimer = useRef<ReturnType<typeof setTimeout>>();
  const editTitle = (value: string) => {
    const oneLine = value.replace(/[\r\n]+/g, " ");
    setTitle(oneLine);
    setTitleEmpty(!oneLine.trim());
    clearTimeout(titleTimer.current);
    if (oneLine.trim()) {
      titleTimer.current = setTimeout(() => {
        if (oneLine.trim() !== item.text) actions.setPriorityText(item.id, oneLine.trim());
      }, 600);
    }
  };
  useEffect(() => () => clearTimeout(titleTimer.current), []);

  /* Notes go through the store's own debounce; the draft IS the store value. */
  const editNotes = (value: string) => actions.setPriorityDescription(item.id, value);

  /* Links: one small add-form; the list itself is the stored value. */
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const addLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    let parsed: URL | null = null;
    try { parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { /* said below */ }
    if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      setLinkError(t.priorities.details.linkInvalid);
      return;
    }
    setLinkError(null);
    const next = [...item.links, { url: parsed.href, label: linkLabel.trim() }];
    setLinkUrl("");
    setLinkLabel("");
    void actions.setPriorityLinks(item.id, next).then((ok) => {
      // The rollback restored the shorter list; the typed address comes back.
      if (!ok) { setLinkUrl(url); setLinkLabel(linkLabel); }
    });
  };
  const removeLink = (at: number) =>
    void actions.setPriorityLinks(item.id, item.links.filter((_, i) => i !== at));

  /* Attachments. The list is this panel's own read; the card shows a count. */
  const [files, setFiles] = useState<db.PriorityAttachment[] | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    db.listPriorityAttachments(item.id)
      .then((r) => { if (alive) { setFiles(r.attachments); actions.notePriorityAttachments(item.id, r.attachments.length); } })
      .catch(() => { if (alive) setFiles([]); });
    return () => { alive = false; };
    // Once per panel opening; changes below keep it current by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const upload = async (file: File) => {
    setFileBusy(true);
    setFileError(null);
    try {
      const { attachment } = await db.uploadPriorityAttachment(item.id, file);
      setFiles((v) => {
        const next = [...(v ?? []), attachment];
        actions.notePriorityAttachments(item.id, next.length);
        return next;
      });
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
    setFileBusy(false);
    if (fileInput.current) fileInput.current.value = "";
  };
  const removeFile = async (f: db.PriorityAttachment) => {
    if (!window.confirm(d.deleteFileConfirm(f.originalFilename))) return;
    setFileError(null);
    try {
      await db.deletePriorityAttachment(f.id);
      setFiles((v) => {
        const next = (v ?? []).filter((x) => x.id !== f.id);
        actions.notePriorityAttachments(item.id, next.length);
        return next;
      });
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  };

  const checked = Boolean(item.completedOn);
  const body = (
    <div className="pdx">
      {/* Title */}
      <textarea
        className="pdx-title" rows={1} value={title} maxLength={200}
        aria-label={t.priorities.editField}
        aria-invalid={titleEmpty || undefined}
        onChange={(e) => editTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      />
      {titleEmpty && <p className="pdx-error" role="alert">{t.priorities.editEmpty}</p>}

      {/* Quadrant + completion, side by side: the two facts of the card. */}
      <div className="pdx-row">
        <div role="group" aria-label={d.categoryLabel} className="pdx-quads">
          {QUADRANTS.map((category) => {
            const label = t.priorities.quadrants[category];
            const current = (item.category === category)
              || (item.category === "unsorted" && category === "important_not_urgent");
            return (
              <button key={category} type="button" className="chip" data-on={current}
                aria-pressed={current} title={label.subtitle}
                onClick={() => { if (!current) onSetCategory(category); }}>
                <span className="quad-dot" aria-hidden="true" style={{ background: QUADRANT_COLOR[category] }} />
                <span>{label.short}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className={checked ? "btn" : "btn btn-primary"} style={{ flex: "none" }}
          onClick={() => actions.setPriorityDone(item.id, !checked, date)}>
          {checked ? d.reopen : d.markDone}
        </button>
      </div>

      {/* Notes */}
      <label className="eyebrow block" htmlFor="pdx-notes" style={{ marginTop: 14 }}>{d.notesLabel}</label>
      <textarea
        id="pdx-notes" className="pdx-notes" rows={4} value={item.description} maxLength={5000}
        placeholder={d.notesPlaceholder}
        onChange={(e) => editNotes(e.target.value)}
      />

      {/* Links */}
      <label className="eyebrow block" style={{ marginTop: 14 }}>{d.linksLabel}</label>
      {item.links.length > 0 && (
        <ul className="pdx-links">
          {item.links.map((link: PriorityLink, i: number) => (
            <li key={`${link.url}-${i}`} className="pdx-link">
              <a href={link.url} target="_blank" rel="noopener noreferrer"
                aria-label={d.openLink(link.label || link.url)}>
                {link.label || link.url}
              </a>
              <button type="button" className="pdx-x" aria-label={d.removeLink(link.label || link.url)}
                onClick={() => removeLink(i)}>×</button>
            </li>
          ))}
        </ul>
      )}
      {item.links.length < 10 && (
        <div className="pdx-addlink">
          <input className="input" type="text" inputMode="url" autoComplete="off" spellCheck={false}
            placeholder={d.linkUrlPlaceholder} aria-label={d.linkUrlPlaceholder} value={linkUrl} maxLength={2048}
            onChange={(e) => { setLinkUrl(e.target.value); if (linkError) setLinkError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} />
          <input className="input" type="text" autoComplete="off"
            placeholder={d.linkLabelPlaceholder} aria-label={d.linkLabelPlaceholder} value={linkLabel} maxLength={120}
            onChange={(e) => setLinkLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} />
          <button type="button" className="btn" disabled={!linkUrl.trim()} onClick={addLink}>{d.addLink}</button>
        </div>
      )}
      {linkError && <p className="pdx-error" role="alert">{linkError}</p>}

      {/* Files */}
      <label className="eyebrow block" style={{ marginTop: 14 }}>{d.filesLabel}</label>
      {files === null ? (
        <p className="faint" style={{ fontSize: 12.5 }}>{t.common.loading}</p>
      ) : (<>
        {files.length > 0 && (
          <ul className="pdx-files">
            {files.map((f) => (
              <li key={f.id} className="pdx-file">
                <a href={db.priorityAttachmentUrl(f.id)} target="_blank" rel="noopener noreferrer">
                  {f.originalFilename}
                </a>
                <span className="faint num" style={{ fontSize: 11.5, flex: "none" }}>{kb(f.byteSize)}</span>
                <button type="button" className="pdx-x" aria-label={d.removeFile(f.originalFilename)}
                  onClick={() => removeFile(f)}>×</button>
              </li>
            ))}
          </ul>
        )}
        {files.length < 5 && (
          <div className="mt-1">
            <input ref={fileInput} type="file" className="sr-only" id="pdx-file"
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            <label htmlFor="pdx-file" className={`btn btn-quiet pdx-upload${fileBusy ? " pdx-busy" : ""}`}>
              {fileBusy ? d.uploading : `+ ${d.addFile}`}
            </label>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>{d.fileRules("5 MB", 5)}</p>
          </div>
        )}
      </>)}
      {fileError && <p className="pdx-error" role="alert">{fileError}</p>}

      <p className="faint" style={{ fontSize: 11.5, marginTop: 16 }}>
        {d.written(prettyDateFor(item.createdOn, locale as any))}
        {item.plannedOn ? ` · ${t.priorities.plannedFor(item.text, shortDateFor(item.plannedOn, locale as any))}` : ""}
      </p>
    </div>
  );

  if (phone) {
    return <Sheet open onClose={onClose} title={d.title}>{body}</Sheet>;
  }

  /* Desktop: a side panel over a light scrim. Portal for the reason every
     overlay here portals: main's fade-in animation would otherwise make it
     position against the page instead of the viewport. */
  return createPortal((
    <div className="pdx-wrap" role="presentation"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="pdx-scrim" aria-hidden="true" onClick={onClose} />
      <aside className="pdx-panel" role="dialog" aria-label={d.title} tabIndex={-1}
        ref={(el) => { if (el && !el.contains(document.activeElement)) el.focus(); }}>
        <div className="pdx-head">
          <h2 className="pdx-heading">{d.title}</h2>
          <button type="button" className="btn btn-quiet" onClick={onClose}>{t.common.close}</button>
        </div>
        {body}
      </aside>
    </div>
  ), document.body);
}
