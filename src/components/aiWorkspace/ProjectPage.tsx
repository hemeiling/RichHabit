"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatBytes, workspaceApi, type AiFile, type Bootstrap, type ProjectView } from "./api";
import { Dialog, DisclosureDialog, FileChip, Header, errorText, type WorkspaceControls } from "./parts";
import { Icon, ICONS } from "./icons";

/**
 * A project: its chats, its file library, its instructions, and — kept at the
 * bottom and behind a typed confirmation — permanent deletion. Archive is the
 * normal way to put a project away, and it can be undone.
 */

interface Upload { key: string; name: string; status: "uploading" | "error"; error?: string }

export default function ProjectPage({ boot, setBoot, projectId, controls }: {
  boot: Bootstrap;
  setBoot: React.Dispatch<React.SetStateAction<Bootstrap | null>>;
  projectId: string;
  controls: WorkspaceControls;
}) {
  const t = useT().aiWorkspace;
  const tRef = useRef(t);
  tRef.current = t;
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const [view, setView] = useState<ProjectView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [disclosureFor, setDisclosureFor] = useState<File[] | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (resetForm = false) => {
    try {
      const next = await workspaceApi.project(projectId);
      setView(next);
      setLoadError(null);
      if (resetForm) {
        setName(next.project.name);
        setInstructions(next.project.instructions);
      }
    } catch (e) {
      if ((e as { status?: number }).status === 404) controlsRef.current.newChat(null);
      else setLoadError(errorText(e, tRef.current));
    }
  }, [projectId]);

  useEffect(() => { void load(true); }, [load]);

  const project = view?.project ?? null;
  const archived = Boolean(project?.archivedAt);
  const dirty = Boolean(project) && (name !== project?.name || instructions !== project?.instructions);

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const { project: updated } = await workspaceApi.updateProject(projectId, { name, instructions });
      setView((v) => (v ? { ...v, project: updated } : v));
      setName(updated.name);
      setInstructions(updated.instructions);
      setSaved(true);
      void controls.refreshLists();
    } catch (e) {
      setNotice(errorText(e, t));
    } finally {
      setSaving(false);
    }
  };

  const setArchived = async (value: boolean) => {
    try {
      const { project: updated } = await workspaceApi.updateProject(projectId, { archived: value });
      setView((v) => (v ? { ...v, project: updated } : v));
      void controls.refreshLists();
    } catch (e) {
      setNotice(errorText(e, t));
    }
  };

  const upload = async (files: File[], accepted = false) => {
    if (files.length === 0 || archived) return;
    if (!accepted && !boot.settings.hasAcceptedCurrentDisclosure) {
      setDisclosureFor(files);
      return;
    }
    setNotice(null);
    for (const file of files) {
      const key = `${Date.now()}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: file.name, status: "uploading" }]);
      try {
        const result = await workspaceApi.upload(file, { projectId });
        setBoot((b) => (b ? { ...b, storage: result.storage } : b));
        setUploads((u) => u.filter((x) => x.key !== key));
      } catch (e) {
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: "error", error: errorText(e, t) } : x)));
      }
    }
    await load();
  };

  const acceptDisclosure = async () => {
    const files = disclosureFor ?? [];
    setAccepting(true);
    try {
      const { settings } = await workspaceApi.acceptDisclosure(boot.settings.currentDisclosureVersion);
      setBoot((b) => (b ? { ...b, settings } : b));
      setDisclosureFor(null);
      await upload(files, true);
    } catch (e) {
      setDisclosureFor(null);
      setNotice(errorText(e, t));
    } finally {
      setAccepting(false);
    }
  };

  const removeFile = async (file: AiFile) => {
    try {
      const { storage } = await workspaceApi.deleteFile(file.id);
      setBoot((b) => (b ? { ...b, storage } : b));
      await load();
    } catch (e) {
      setNotice(errorText(e, t));
    }
  };

  const removeProject = async () => {
    try {
      await workspaceApi.deleteProject(projectId, confirmName);
      setConfirming(false);
      await controls.refreshLists();
      controls.newChat(null);
    } catch (e) {
      setNotice(errorText(e, t));
    }
  };

  const conversations = showArchived ? view?.archivedConversations ?? [] : view?.conversations ?? [];

  return (
    <section className="aiw-chat">
      <Header controls={controls} newChatProjectId={archived ? null : projectId} title={(
        <>
          <span className="aiw-title-project">{t.projects}</span>
          <span className="aiw-title-text" data-testid="aiw-project-title">{project?.name ?? ""}</span>
        </>
      )} />
      <div className="aiw-scroll">
        {loadError ? (
          <div className="aiw-thread">
            <p className="aiw-banner" role="alert">
              <span>{loadError}</span>
              <button type="button" className="aiw-link" onClick={() => void load(true)}>{t.retry}</button>
            </p>
          </div>
        ) : !view ? (
          <div className="aiw-loading" role="status"><Icon d={ICONS.folder} size={22} /></div>
        ) : (
          <div className="aiw-project">
            {archived && (
              <p className="aiw-banner" data-tone="info">
                <span>{t.archivedProject}</span>
                <button type="button" className="aiw-link" onClick={() => void setArchived(false)}>{t.restore}</button>
              </p>
            )}
            {notice && (
              <p className="aiw-banner" role="alert" data-testid="aiw-project-notice">
                <span>{notice}</span>
                <button type="button" className="aiw-link" onClick={() => setNotice(null)} aria-label={t.close}>×</button>
              </p>
            )}

            <div className="aiw-row">
              <button type="button" className="btn btn-primary" disabled={archived} data-testid="aiw-project-new-chat"
                onClick={() => controls.newChat(projectId)}>
                <Icon d={ICONS.plus} size={16} />{t.project.newChat}
              </button>
            </div>

            <section>
              <h3 className="aiw-section-title">{t.project.conversations}</h3>
              <div className="aiw-list">
                {conversations.map((c) => (
                  <div key={c.id} className="aiw-list-row">
                    <button type="button" className="aiw-list-button" data-testid="aiw-project-conversation"
                      onClick={() => controls.openConversation(c.id, projectId)}>
                      <Icon d={ICONS.chat} size={16} />
                      <span>{c.title || t.untitled}</span>
                    </button>
                  </div>
                ))}
                {conversations.length === 0 && <p className="aiw-muted aiw-list-empty">{t.project.noConversations}</p>}
              </div>
              {(view.archivedConversations.length > 0 || showArchived) && (
                <button type="button" className="aiw-side-toggle" onClick={() => setShowArchived((v) => !v)}>
                  {showArchived ? t.hideArchived : t.showArchived}
                </button>
              )}
            </section>

            <section>
              <h3 className="aiw-section-title">{t.project.files}</h3>
              <p className="aiw-hint">{t.project.filesHint}</p>
              <div className="aiw-list" data-testid="aiw-project-files">
                {view.files.map((f) => (
                  <div key={f.id} className="aiw-list-row">
                    <FileChip fileId={f.id} name={f.originalFilename} kind={f.kind} byteSize={f.byteSize} />
                    <span className="aiw-grow" />
                    <button type="button" className="aiw-icon-btn" aria-label={t.project.deleteFile(f.originalFilename)}
                      title={t.project.deleteFile(f.originalFilename)} onClick={() => void removeFile(f)}
                      data-testid="aiw-project-file-delete">
                      <Icon d={ICONS.trash} size={16} />
                    </button>
                  </div>
                ))}
                {uploads.map((u) => (
                  <div key={u.key} className="aiw-list-row">
                    <FileChip name={u.name} kind="file" state={u.status} detail={u.error}
                      onRemove={u.status === "error" ? () => setUploads((x) => x.filter((y) => y.key !== u.key)) : undefined} />
                  </div>
                ))}
                {view.files.length === 0 && uploads.length === 0 && <p className="aiw-muted aiw-list-empty">{t.project.noFiles}</p>}
              </div>
              <div className="aiw-row">
                <button type="button" className="btn" disabled={archived} onClick={() => fileRef.current?.click()}
                  data-testid="aiw-project-upload">
                  <Icon d={ICONS.upload} size={16} />{t.project.upload}
                </button>
                <span className="aiw-muted">
                  {t.storageUsed(formatBytes(boot.storage.usedBytes), formatBytes(boot.storage.quotaBytes))}
                </span>
              </div>
              <p className="aiw-hint">
                {t.fileLimits(formatBytes(boot.limits.maxPdfBytes), formatBytes(boot.limits.maxImageBytes),
                  formatBytes(boot.limits.maxTextBytes))}
              </p>
              <input ref={fileRef} type="file" multiple hidden data-testid="aiw-project-file-input"
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.json,application/pdf,image/*,text/plain"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void upload(files);
                }} />
            </section>

            <section>
              <h3 className="aiw-section-title">{t.project.settings}</h3>
              <label className="aiw-field">
                {t.project.nameLabel}
                <input className="input" value={name} data-testid="aiw-project-name-edit"
                  onChange={(e) => { setName(e.target.value); setSaved(false); }} />
              </label>
              <label className="aiw-field">
                {t.project.instructionsLabel}
                <textarea className="textarea" rows={6} value={instructions} placeholder={t.project.instructionsPlaceholder}
                  data-testid="aiw-project-instructions-edit"
                  onChange={(e) => { setInstructions(e.target.value); setSaved(false); }} />
                <span className="aiw-hint">{t.project.instructionsHint}</span>
              </label>
              <div className="aiw-row">
                <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}
                  data-testid="aiw-project-save">
                  {saved && !dirty ? t.saved : t.save}
                </button>
              </div>
            </section>

            <div className="aiw-danger-zone">
              <button type="button" className="btn" onClick={() => void setArchived(!archived)} data-testid="aiw-project-archive">
                {archived ? t.restore : t.archive}
              </button>
              <button type="button" className="btn btn-danger" data-testid="aiw-project-delete"
                onClick={() => { setConfirmName(""); setConfirming(true); }}>
                {t.project.deleteForever}
              </button>
            </div>
          </div>
        )}
      </div>

      {disclosureFor && (
        <DisclosureDialog busy={accepting} onAccept={() => void acceptDisclosure()} onDecline={() => setDisclosureFor(null)} />
      )}

      {confirming && project && (
        <Dialog title={t.project.deleteTitle} onClose={() => setConfirming(false)} actions={(
          <>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>{t.cancel}</button>
            <button type="button" className="btn btn-danger" disabled={confirmName !== project.name}
              onClick={() => void removeProject()} data-testid="aiw-project-delete-confirm">
              {t.project.deleteForever}
            </button>
          </>
        )}>
          <div className="aiw-dialog-body">
            <p>{t.project.deleteBody(view?.summary?.conversations ?? 0, view?.summary?.files ?? 0)}</p>
            <label className="aiw-field">
              {t.project.deleteConfirm(project.name)}
              <input className="input" value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off" data-testid="aiw-project-delete-name" />
            </label>
          </div>
        </Dialog>
      )}
    </section>
  );
}
