"use client";
import { useEffect, useId, useRef } from "react";
import type { Dict } from "@/lib/i18n";
import { useT } from "@/lib/i18n/context";
import { WorkspaceError, workspaceApi, formatBytes } from "./api";
import { Icon, ICONS } from "./icons";

export type WorkspaceText = Dict["aiWorkspace"];

/** What the admin reads for a failed request: the server's words, or a plain fallback. */
export function errorText(e: unknown, t: WorkspaceText): string {
  if (e instanceof WorkspaceError) return e.status === 0 ? t.errors.offline : e.message || t.errors.generic;
  return t.errors.generic;
}

/** The controls every page of the workspace shares. */
export interface WorkspaceControls {
  expanded: boolean;
  toggleExpanded: () => void;
  openSide: () => void;
  close: () => void;
  newChat: (projectId?: string | null) => void;
  openProject: (projectId: string) => void;
  openConversation: (conversationId: string, projectId: string | null) => void;
  refreshLists: () => Promise<void>;
}

export function Header({ controls, newChatProjectId = null, children, title }: {
  controls: WorkspaceControls;
  newChatProjectId?: string | null;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  const t = useT().aiWorkspace;
  return (
    <header className="aiw-head">
      <button type="button" className="aiw-icon-btn aiw-side-btn" onClick={controls.openSide}
        aria-label={t.history} title={t.history}>
        <Icon d={ICONS.menu} />
      </button>
      <div className="aiw-title">{title}</div>
      {children}
      <button type="button" className="aiw-icon-btn" onClick={() => controls.newChat(newChatProjectId)}
        aria-label={t.newChat} title={t.newChat} data-testid="aiw-new-chat">
        <Icon d={ICONS.plus} />
      </button>
      <button type="button" className="aiw-icon-btn aiw-expand-btn" onClick={controls.toggleExpanded}
        aria-label={controls.expanded ? t.collapse : t.expand} title={controls.expanded ? t.collapse : t.expand}>
        <Icon d={controls.expanded ? ICONS.shrink : ICONS.expand} />
      </button>
      <button type="button" className="aiw-icon-btn" onClick={controls.close} aria-label={t.close} title={t.close}>
        <Icon d={ICONS.close} />
      </button>
    </header>
  );
}

export function Dialog({ title, children, actions, onClose }: {
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, textarea, [data-autofocus]")?.focus();
  }, []);
  return (
    <div className="aiw-dialog-wrap"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div ref={ref} className="aiw-dialog" role="dialog" aria-modal="true" aria-labelledby={id}>
        <h2 id={id} className="aiw-dialog-title">{title}</h2>
        {children}
        {actions && <div className="aiw-dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * The upload notice. Shown before the first upload and again whenever its
 * version changes; the server refuses uploads until the current version is
 * accepted, so this is the explanation, not the enforcement.
 */
export function DisclosureDialog({ onAccept, onDecline, busy }: {
  onAccept: () => void; onDecline: () => void; busy?: boolean;
}) {
  const t = useT().aiWorkspace.disclosure;
  return (
    <Dialog title={t.title} onClose={onDecline} actions={(
      <>
        <button type="button" className="btn" onClick={onDecline}>{t.decline}</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onAccept} data-autofocus
          data-testid="aiw-disclosure-accept">
          {t.accept}
        </button>
      </>
    )}>
      <div className="aiw-dialog-body">
        {t.body.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
      </div>
    </Dialog>
  );
}

/** A file on a message, in the composer, or in a project library. */
export function FileChip({ fileId, name, kind, byteSize, removed, state, detail, onRemove, removeLabel }: {
  fileId?: string;
  name: string;
  kind: string;
  byteSize?: number;
  removed?: boolean;
  state?: "uploading" | "ready" | "error";
  detail?: string;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const t = useT().aiWorkspace;
  if (removed) {
    return (
      <span className="aiw-chip" data-removed="true" title={name}>
        <Icon d={ICONS.file} size={15} />
        <span className="aiw-chip-name">{t.fileRemoved}</span>
      </span>
    );
  }
  const openable = fileId && state !== "uploading" && state !== "error";
  const body = (
    <>
      {kind === "image" && openable
        // eslint-disable-next-line @next/next/no-img-element
        ? <img className="aiw-chip-thumb" src={workspaceApi.fileUrl(fileId)} alt="" loading="lazy" />
        : <Icon d={kind === "image" ? ICONS.image : ICONS.file} size={15} />}
      <span className="aiw-chip-name">{name}</span>
      <span className="aiw-chip-meta">
        {state === "uploading" ? t.uploading : state === "error" ? detail : byteSize != null ? formatBytes(byteSize) : null}
      </span>
    </>
  );
  return (
    <span className="aiw-chip" data-state={state ?? "ready"} title={state === "error" ? detail : name}>
      {openable
        ? <a className="aiw-chip-link" href={workspaceApi.fileUrl(fileId)} target="_blank" rel="noopener noreferrer">{body}</a>
        : <span className="aiw-chip-link">{body}</span>}
      {onRemove && (
        <button type="button" className="aiw-chip-x" onClick={onRemove} aria-label={removeLabel ?? t.removeAttachment(name)}>
          <Icon d={ICONS.close} size={13} />
        </button>
      )}
    </span>
  );
}
