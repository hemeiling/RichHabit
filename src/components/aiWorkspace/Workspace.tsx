"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { workspaceApi, type AiConversation, type AiProject, type Bootstrap } from "./api";
import Chat from "./Chat";
import ProjectPage from "./ProjectPage";
import { Dialog, Header, errorText, type WorkspaceControls } from "./parts";
import { Icon, ICONS } from "./icons";

/**
 * The AI Workspace: a panel at the bottom right on a desktop that expands to
 * fill the window, and the whole screen on a phone.
 *
 * Two kinds of page live in it — a conversation, and a project — with history
 * and projects in a side list that is a drawer in the panel and on a phone, and
 * a column when expanded on a wide screen.
 */

type Route =
  | { kind: "chat"; conversationId: string | null; projectId: string | null }
  | { kind: "project"; projectId: string };

const ROUTE_KEY = "rh.aiWorkspace.route";
const EXPANDED_KEY = "rh.aiWorkspace.expanded";
const NEW_CHAT: Route = { kind: "chat", conversationId: null, projectId: null };

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not remembered */ }
}

function SideItem({ icon, label, sub, current, onClick, testId }: {
  icon?: string; label: string; sub?: string; current: boolean; onClick: () => void; testId?: string;
}) {
  return (
    <button type="button" className="aiw-side-item" aria-current={current ? "page" : undefined} onClick={onClick}
      data-testid={testId}>
      {icon && <Icon d={icon} size={16} />}
      <span className="aiw-side-text">
        <span className="aiw-side-name">{label}</span>
        {sub && <span className="aiw-side-sub">{sub}</span>}
      </span>
    </button>
  );
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: AiProject) => void }) {
  const t = useT().aiWorkspace;
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated((await workspaceApi.createProject(name, instructions)).project);
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };
  return (
    <Dialog title={t.newProject} onClose={onClose} actions={(
      <>
        <button type="button" className="btn" onClick={onClose}>{t.cancel}</button>
        <button type="button" className="btn btn-primary" disabled={!name.trim() || busy} onClick={create}
          data-testid="aiw-project-create">
          {t.project.create}
        </button>
      </>
    )}>
      <div className="aiw-dialog-body">
        <label className="aiw-field">
          {t.project.nameLabel}
          <input className="input" value={name} placeholder={t.project.namePlaceholder} data-testid="aiw-project-name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void create(); }} />
        </label>
        <label className="aiw-field">
          {t.project.instructionsLabel}
          <textarea className="textarea" rows={4} value={instructions} placeholder={t.project.instructionsPlaceholder}
            onChange={(e) => setInstructions(e.target.value)} data-testid="aiw-project-instructions" />
          <span className="aiw-hint">{t.project.instructionsHint}</span>
        </label>
        {error && <p className="aiw-banner" role="alert"><span>{error}</span></p>}
      </div>
    </Dialog>
  );
}

export default function Workspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT().aiWorkspace;
  const tRef = useRef(t);
  tRef.current = t;
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(() => readStored(ROUTE_KEY, NEW_CHAT));
  const [expanded, setExpanded] = useState<boolean>(() => readStored(EXPANDED_KEY, false));
  const [pageKey, setPageKey] = useState(0);
  const [sideOpen, setSideOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const refreshLists = useCallback(async () => {
    try {
      setBoot(await workspaceApi.bootstrap());
      setBootError(null);
    } catch (e) {
      setBootError(errorText(e, tRef.current));
    }
  }, []);

  useEffect(() => { if (open) void refreshLists(); }, [open, refreshLists]);
  useEffect(() => { store(ROUTE_KEY, route); }, [route]);
  useEffect(() => { store(EXPANDED_KEY, expanded); }, [expanded]);

  /*
   * A phone's on-screen keyboard shrinks the visual viewport but not the layout
   * one, so a full-screen panel sized to 100dvh would put the composer under the
   * keyboard. The panel follows the visual viewport instead.
   */
  useEffect(() => {
    const viewport = window.visualViewport;
    const el = rootRef.current;
    if (!open || !viewport || !el) return;
    const update = () => {
      el.style.setProperty("--aiw-vh", `${viewport.height}px`);
      el.style.setProperty("--aiw-top", `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [open]);

  // Full screen on a phone: the page behind must not scroll under a finger.
  useEffect(() => {
    if (!open || !window.matchMedia("(max-width: 639px)").matches) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const go = useCallback((next: Route) => {
    setRoute(next);
    setPageKey((k) => k + 1);
    setSideOpen(false);
  }, []);

  const controls: WorkspaceControls = useMemo(() => ({
    expanded,
    toggleExpanded: () => setExpanded((v) => !v),
    openSide: () => setSideOpen(true),
    close: onClose,
    newChat: (projectId = null) => go({ kind: "chat", conversationId: null, projectId }),
    openProject: (projectId) => go({ kind: "project", projectId }),
    openConversation: (conversationId, projectId) => go({ kind: "chat", conversationId, projectId }),
    refreshLists,
  }), [expanded, onClose, go, refreshLists]);

  const projectNames = useMemo(() => new Map(
    [...(boot?.projects ?? []), ...(boot?.archivedProjects ?? [])].map((p) => [p.id, p.name])), [boot]);
  const isOpenChat = (c: AiConversation) => route.kind === "chat" && route.conversationId === c.id;
  const isOpenProject = (p: AiProject) => route.kind === "project" && route.projectId === p.id;

  return (
    <div ref={rootRef} className="aiw" data-mode={expanded ? "expanded" : "panel"} role="dialog" aria-modal="false"
      aria-label={t.name} hidden={!open} data-testid="aiw"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        if (sideOpen) setSideOpen(false);
        else onClose();
      }}>
      <div className="aiw-body">
        <aside className="aiw-side" data-open={sideOpen} aria-label={t.history}>
          <div className="aiw-side-head">
            <button type="button" className="aiw-side-new" onClick={() => controls.newChat(null)}>
              <Icon d={ICONS.plus} size={16} />
              <span>{t.newChat}</span>
            </button>
            <button type="button" className="aiw-icon-btn aiw-side-close" onClick={() => setSideOpen(false)}
              aria-label={t.close} title={t.close}>
              <Icon d={ICONS.close} />
            </button>
          </div>
          <nav className="aiw-side-scroll">
            <div className="aiw-side-label">
              <span>{t.projects}</span>
              <button type="button" className="aiw-icon-btn aiw-icon-sm" onClick={() => setCreatingProject(true)}
                aria-label={t.newProject} title={t.newProject} data-testid="aiw-new-project">
                <Icon d={ICONS.plus} size={15} />
              </button>
            </div>
            {boot?.projects.map((p) => (
              <SideItem key={p.id} icon={ICONS.folder} label={p.name} current={isOpenProject(p)}
                onClick={() => controls.openProject(p.id)} testId="aiw-side-project" />
            ))}

            <div className="aiw-side-label"><span>{t.recent}</span></div>
            {boot?.conversations.map((c) => (
              <SideItem key={c.id} label={c.title || t.untitled} current={isOpenChat(c)} testId="aiw-side-conversation"
                sub={c.projectId ? projectNames.get(c.projectId) : undefined}
                onClick={() => controls.openConversation(c.id, c.projectId)} />
            ))}
            {boot && boot.conversations.length === 0 && <p className="aiw-side-empty">{t.noConversations}</p>}

            <button type="button" className="aiw-side-toggle" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? t.hideArchived : t.showArchived}
            </button>
            {showArchived && boot && (
              <>
                <div className="aiw-side-label"><span>{t.archived}</span></div>
                {boot.archivedProjects.map((p) => (
                  <SideItem key={p.id} icon={ICONS.folder} label={p.name} current={isOpenProject(p)}
                    onClick={() => controls.openProject(p.id)} />
                ))}
                {boot.archivedConversations.map((c) => (
                  <SideItem key={c.id} label={c.title || t.untitled} current={isOpenChat(c)}
                    sub={c.projectId ? projectNames.get(c.projectId) : undefined}
                    onClick={() => controls.openConversation(c.id, c.projectId)} />
                ))}
              </>
            )}
          </nav>
        </aside>
        {sideOpen && <div className="aiw-side-scrim" onClick={() => setSideOpen(false)} />}

        <div className="aiw-main">
          {!boot ? (
            <section className="aiw-chat">
              <Header controls={controls} title={<span className="aiw-title-text">{t.name}</span>} />
              <div className="aiw-scroll">
                {bootError
                  ? (
                    <div className="aiw-thread">
                      <p className="aiw-banner" role="alert">
                        <span>{bootError}</span>
                        <button type="button" className="aiw-link" onClick={() => void refreshLists()}>{t.retry}</button>
                      </p>
                    </div>
                  )
                  : <div className="aiw-loading" role="status"><Icon d={ICONS.spark} size={22} /></div>}
              </div>
            </section>
          ) : route.kind === "project" ? (
            <ProjectPage key={pageKey} boot={boot} setBoot={setBoot} projectId={route.projectId} controls={controls} />
          ) : (
            <Chat key={pageKey} open={open} boot={boot} setBoot={setBoot} controls={controls}
              conversationId={route.conversationId} projectId={route.projectId}
              onConversationCreated={(c) => {
                // The same page carries on: only the address changes.
                setRoute({ kind: "chat", conversationId: c.id, projectId: c.projectId });
                void refreshLists();
              }} />
          )}
        </div>
      </div>

      {creatingProject && (
        <NewProjectDialog onClose={() => setCreatingProject(false)} onCreated={(p) => {
          setCreatingProject(false);
          void refreshLists();
          controls.openProject(p.id);
        }} />
      )}
    </div>
  );
}
