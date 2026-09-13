"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";
import {
  formatBytes, streamReply, workspaceApi,
  type AiConversation, type AiFile, type AiMessage, type Bootstrap, type ConversationView, type Exchange, type StreamEvent,
} from "./api";
import { Markdown, copyText } from "./Markdown";
import {
  Dialog, DisclosureDialog, FileChip, Header, errorText, type WorkspaceControls, type WorkspaceText,
} from "./parts";
import { Icon, ICONS } from "./icons";

/**
 * One conversation: the thread, and the composer.
 *
 * What is shown is what the server saved. While a reply streams, its text
 * arrives as deltas and is drawn on top of the saved row; when it ends the
 * conversation is read back, so Stop, a failure and a reload all land on the
 * same saved state. Which answer is visible and whether Continue or Retry apply
 * come from the server's lifecycle rules, not from anything decided here.
 */

interface Pending {
  key: string;
  name: string;
  kind: string;
  byteSize: number;
  status: "uploading" | "ready" | "error";
  file?: AiFile;
  error?: string;
  source: "upload" | "library";
}

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.markdown,.csv,.tsv,.json,.log,.xml,.yaml,.yml,"
  + "application/pdf,image/png,image/jpeg,image/gif,image/webp,text/plain";

const guessKind = (file: File) =>
  file.type.startsWith("image/") ? "image" : file.type === "application/pdf" ? "pdf" : "text";

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function Thinking({ label }: { label: string }) {
  return (
    <div className="aiw-thinking" role="status">
      <span /><span /><span />
      <span className="aiw-sr">{label}</span>
    </div>
  );
}

function UserMessage({ content, attachments }: {
  content: string;
  attachments: { fileId?: string; name: string; kind: string; byteSize: number; removed?: boolean }[];
}) {
  return (
    <div className="aiw-user-wrap">
      <div className="aiw-user" data-testid="aiw-user">
        {attachments.length > 0 && (
          <div className="aiw-chips" data-testid="aiw-user-files">
            {attachments.map((a, i) => (
              <FileChip key={a.fileId ?? i} fileId={a.fileId} name={a.name} kind={a.kind} byteSize={a.byteSize}
                removed={a.removed} />
            ))}
          </div>
        )}
        {content && <div className="aiw-user-text">{content}</div>}
      </div>
    </div>
  );
}

function Reply({ chain, exchange, text, t, canAct, runningHere, onContinue, onRetry, onStop }: {
  chain: AiMessage[];
  exchange: Exchange;
  text: string;
  t: WorkspaceText;
  canAct: boolean;
  runningHere: boolean;
  onContinue: (id: string) => void;
  onRetry: (id: string) => void;
  onStop: (message: AiMessage) => void;
}) {
  const [copied, setCopied] = useState(false);
  const tail = chain[chain.length - 1];
  const streaming = tail.status === "streaming";
  const note = tail.status === "stopped" ? t.stopped
    : tail.status === "failed" ? t.failures[tail.errorCode ?? "provider_error"]
      : tail.stopReason === "max_tokens" ? t.lengthLimit
        : tail.stopReason === "refusal" ? t.refusal
          : tail.stopReason === "context_window" ? t.contextWindow
            : null;

  return (
    <div className="aiw-reply" data-status={tail.status} data-testid="aiw-reply">
      {text ? <Markdown text={text} /> : streaming ? <Thinking label={t.thinking} /> : null}
      {streaming && text && <span className="aiw-streaming" aria-hidden="true" />}
      {streaming && !runningHere && (
        <div className="aiw-actions">
          <button type="button" className="aiw-action" onClick={() => onStop(tail)}>
            <Icon d={ICONS.stop} size={15} />{t.stop}
          </button>
        </div>
      )}
      {!streaming && (
        <div className="aiw-actions">
          {note && (
            <span className="aiw-note" data-tone={tail.status === "failed" ? "warn" : undefined} data-testid="aiw-reply-note">
              {note}
            </span>
          )}
          {text && (
            <button type="button" className="aiw-action" onClick={async () => {
              if (await copyText(text)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }
            }}>
              <Icon d={copied ? ICONS.check : ICONS.copy} size={15} />{copied ? t.copied : t.copy}
            </button>
          )}
          {canAct && exchange.continueTargetId && (
            <button type="button" className="aiw-action" data-testid="aiw-continue"
              onClick={() => onContinue(exchange.continueTargetId as string)}>
              <Icon d={ICONS.continue} size={15} />{t.continue}
            </button>
          )}
          {canAct && exchange.retryTargetId && (
            <button type="button" className="aiw-action" data-testid="aiw-retry"
              onClick={() => onRetry(exchange.retryTargetId as string)}>
              <Icon d={ICONS.retry} size={15} />{tail.status === "complete" ? t.regenerate : t.retry}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Chat({ open, boot, setBoot, conversationId, projectId, controls, onConversationCreated }: {
  open: boolean;
  boot: Bootstrap;
  setBoot: React.Dispatch<React.SetStateAction<Bootstrap | null>>;
  conversationId: string | null;
  projectId: string | null;
  controls: WorkspaceControls;
  onConversationCreated: (c: AiConversation) => void;
}) {
  const t = useT().aiWorkspace;
  const tRef = useRef(t);
  tRef.current = t;
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const [view, setView] = useState<ConversationView | null>(null);
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [live, setLive] = useState<Record<string, string>>({});
  const [active, setActive] = useState<{ messageId: string | null; conversationId: string } | null>(null);
  const [optimistic, setOptimistic] = useState<{ content: string; files: Pending[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disclosureFor, setDisclosureFor] = useState<File[] | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const [library, setLibrary] = useState<AiFile[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragging, setDragging] = useState(false);

  const idRef = useRef<string | null>(conversationId);
  const streamRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pinned = useRef(true);
  const liveBuffer = useRef<Record<string, string>>({});
  const frame = useRef<number | null>(null);
  const coarse = useMemo(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches, []);

  const project = projectId ? [...boot.projects, ...boot.archivedProjects].find((p) => p.id === projectId) ?? null : null;
  const conversation = view?.conversation ?? null;
  const archived = Boolean(conversation?.archivedAt);
  // A new chat cannot start in an archived project; an existing one carries on.
  const projectArchived = Boolean(project?.archivedAt) && !conversation;
  const canCompose = boot.available && !archived && !projectArchived;
  const readyFiles = pending.filter((p) => p.status === "ready" && p.file);
  const uploading = pending.some((p) => p.status === "uploading");
  const canSend = canCompose && !active && !uploading && (draft.trim().length > 0 || readyFiles.length > 0);
  const attachedCount = pending.filter((p) => p.status !== "error").length;

  const load = useCallback(async (id: string) => {
    try {
      const next = await workspaceApi.conversation(id);
      if (idRef.current !== id) return;
      setView(next);
      setLoadError(null);
    } catch (e) {
      if (idRef.current !== id) return;
      if ((e as { status?: number }).status === 404) controlsRef.current.newChat(null);
      else setLoadError(errorText(e, tRef.current));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (idRef.current) void load(idRef.current);
  }, [load]);

  useEffect(() => {
    if (open && !coarse) inputRef.current?.focus();
  }, [open, coarse]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [view, live, optimistic]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const queueDelta = (messageId: string, text: string) => {
    liveBuffer.current[messageId] = (liveBuffer.current[messageId] ?? "") + text;
    if (frame.current == null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setLive({ ...liveBuffer.current });
      });
    }
  };

  const ensureConversation = async (): Promise<string> => {
    if (idRef.current) return idRef.current;
    const { conversation: created } = await workspaceApi.createConversation(projectId);
    idRef.current = created.id;
    setView({ conversation: created, messages: [], exchanges: [], hasEarlier: false, files: [] });
    onConversationCreated(created);
    return created.id;
  };

  const runStream = async (path: string, body: unknown, id: string, restore?: () => void) => {
    const controller = new AbortController();
    streamRef.current = controller;
    pinned.current = true;
    setNotice(null);
    setActive({ messageId: null, conversationId: id });
    let started = false;
    try {
      const result = await streamReply(path, body, (event: StreamEvent) => {
        if (event.type === "start") {
          started = true;
          liveBuffer.current = {};
          setActive({ messageId: event.assistantMessage.id, conversationId: id });
          setView((v) => (v ? { ...v, conversation: event.conversation } : v));
          void load(id).then(() => setOptimistic(null));
        } else if (event.type === "delta") {
          queueDelta(event.messageId, event.text);
        } else if (event.type === "done") {
          setView((v) => (v ? { ...v, messages: v.messages.map((m) => (m.id === event.message.id ? event.message : m)) } : v));
        }
      }, controller.signal);
      if (result.existing) started = true;
    } catch (e) {
      if (!started) restore?.();
      setNotice(errorText(e, tRef.current));
    } finally {
      streamRef.current = null;
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = null;
      await load(id);
      setOptimistic(null);
      liveBuffer.current = {};
      setLive({});
      setActive(null);
      void controlsRef.current.refreshLists();
      if (!coarse) inputRef.current?.focus();
    }
  };

  const send = async () => {
    if (!canSend) return;
    const content = draft;
    const files = readyFiles;
    let id: string;
    try {
      id = await ensureConversation();
    } catch (e) {
      setNotice(errorText(e, t));
      return;
    }
    setOptimistic({ content, files });
    setDraft("");
    setPending((current) => current.filter((p) => p.status === "error"));
    await runStream(`/conversations/${id}/messages`, {
      clientId: newId(), content, fileIds: files.map((f) => (f.file as AiFile).id),
    }, id, () => {
      // Refused before anything was written: give the words and files back.
      setDraft(content);
      setPending((current) => [...files, ...current]);
    });
  };

  const stop = async () => {
    if (!active) return;
    if (!active.messageId) {
      streamRef.current?.abort();
      return;
    }
    try {
      await workspaceApi.stop(active.messageId, active.conversationId);
    } catch {
      streamRef.current?.abort();
    }
  };

  const stopLeftBehind = async (message: AiMessage) => {
    try {
      await workspaceApi.stop(message.id, message.conversationId);
    } catch (e) {
      setNotice(errorText(e, t));
    }
    await load(message.conversationId);
  };

  const continueReply = (id: string) => {
    if (idRef.current && !active) void runStream(`/messages/${id}/continue`, {}, idRef.current);
  };
  const retryReply = (id: string) => {
    if (idRef.current && !active) void runStream(`/messages/${id}/retry`, {}, idRef.current);
  };

  const addFiles = async (files: File[], accepted = false) => {
    if (files.length === 0 || !canCompose) return;
    if (!accepted && !boot.settings.hasAcceptedCurrentDisclosure) {
      setDisclosureFor(files);
      return;
    }
    const max = boot.limits.maxAttachments;
    const room = max - attachedCount;
    setNotice(files.length > room ? t.errors.tooManyFiles(max) : null);
    if (room <= 0) return;
    let id: string;
    try {
      id = await ensureConversation();
    } catch (e) {
      setNotice(errorText(e, t));
      return;
    }
    for (const file of files.slice(0, room)) {
      const key = newId();
      setPending((c) => [...c, {
        key, name: file.name, kind: guessKind(file), byteSize: file.size, status: "uploading", source: "upload",
      }]);
      try {
        const result = await workspaceApi.upload(file, { conversationId: id });
        setPending((c) => (c.some((p) => p.file?.id === result.file.id)
          ? c.filter((p) => p.key !== key)
          : c.map((p) => (p.key === key ? {
            ...p, status: "ready", file: result.file, name: result.file.originalFilename,
            kind: result.file.kind, byteSize: result.file.byteSize,
          } : p))));
        setBoot((b) => (b ? { ...b, storage: result.storage } : b));
      } catch (e) {
        setPending((c) => c.map((p) => (p.key === key ? { ...p, status: "error", error: errorText(e, t) } : p)));
      }
    }
  };

  const acceptDisclosure = async () => {
    const files = disclosureFor ?? [];
    setAccepting(true);
    try {
      const { settings } = await workspaceApi.acceptDisclosure(boot.settings.currentDisclosureVersion);
      setBoot((b) => (b ? { ...b, settings } : b));
      setDisclosureFor(null);
      await addFiles(files, true);
    } catch (e) {
      setDisclosureFor(null);
      setNotice(errorText(e, t));
    } finally {
      setAccepting(false);
    }
  };

  const removePending = (p: Pending) => {
    setPending((c) => c.filter((x) => x.key !== p.key));
    // An upload made for this message and never sent is removed again; a
    // library file, or one already carried by a message, is left alone.
    if (p.source === "upload" && p.status === "ready" && p.file) {
      void workspaceApi.discardUpload(p.file.id).then(() => controlsRef.current.refreshLists()).catch(() => {});
    }
  };

  const openLibrary = async () => {
    setAttachMenu(false);
    if (!projectId) return;
    try {
      const { files } = await workspaceApi.project(projectId);
      setPicked([]);
      setLibrary(files);
    } catch (e) {
      setNotice(errorText(e, t));
    }
  };

  const addFromLibrary = () => {
    const room = boot.limits.maxAttachments - attachedCount;
    const chosen = picked
      .map((id) => (library ?? []).find((f) => f.id === id))
      .filter((f): f is AiFile => Boolean(f) && !pending.some((p) => p.file?.id === (f as AiFile).id))
      .slice(0, Math.max(0, room));
    setPending((c) => [...c, ...chosen.map((f): Pending => ({
      key: newId(), name: f.originalFilename, kind: f.kind, byteSize: f.byteSize, status: "ready", file: f, source: "library",
    }))]);
    if (picked.length > room) setNotice(t.errors.tooManyFiles(boot.limits.maxAttachments));
    setLibrary(null);
  };

  const saveTitle = async () => {
    const title = renaming?.trim();
    setRenaming(null);
    if (!conversation || !title || title === conversation.title) return;
    try {
      const { conversation: updated } = await workspaceApi.updateConversation(conversation.id, { title });
      setView((v) => (v ? { ...v, conversation: updated } : v));
      void controls.refreshLists();
    } catch (e) {
      setNotice(errorText(e, t));
    }
  };

  const setArchived = async (value: boolean) => {
    setMenu(false);
    if (!conversation) return;
    try {
      const { conversation: updated } = await workspaceApi.updateConversation(conversation.id, { archived: value });
      setView((v) => (v ? { ...v, conversation: updated } : v));
      void controls.refreshLists();
    } catch (e) {
      setNotice(errorText(e, t));
    }
  };

  const remove = async () => {
    if (!conversation) return;
    try {
      await workspaceApi.deleteConversation(conversation.id);
      setConfirmDelete(false);
      await controls.refreshLists();
      controls.newChat(projectId);
    } catch (e) {
      setConfirmDelete(false);
      setNotice(errorText(e, t));
    }
  };

  const loadEarlier = async () => {
    if (!view || view.messages.length === 0) return;
    const el = scrollRef.current;
    const heightBefore = el?.scrollHeight ?? 0;
    try {
      const earlier = await workspaceApi.conversation(view.conversation.id, view.messages[0].createdAt);
      pinned.current = false;
      setView((v) => (v ? {
        ...v,
        messages: [...earlier.messages, ...v.messages],
        exchanges: [...earlier.exchanges, ...v.exchanges],
        hasEarlier: earlier.hasEarlier,
      } : v));
      requestAnimationFrame(() => { if (el) el.scrollTop += el.scrollHeight - heightBefore; });
    } catch (e) {
      setNotice(errorText(e, t));
    }
  };

  const byId = useMemo(() => new Map((view?.messages ?? []).map((m) => [m.id, m])), [view]);
  const textFor = (m: AiMessage) => {
    const streamed = live[m.id];
    return streamed !== undefined && streamed.length >= m.content.length ? streamed : m.content;
  };
  const isEmpty = !loading && !loadError && (view?.exchanges.length ?? 0) === 0 && !optimistic;

  const title = renaming !== null ? (
    <input className="aiw-title-input" value={renaming} aria-label={t.titleLabel} autoFocus data-testid="aiw-title-input"
      onChange={(e) => setRenaming(e.target.value)} onBlur={() => void saveTitle()}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void saveTitle(); }
        if (e.key === "Escape") { e.preventDefault(); setRenaming(null); }
      }} />
  ) : (
    <>
      {project && <span className="aiw-title-project">{project.name}</span>}
      <span className="aiw-title-text" data-testid="aiw-title">{conversation?.title || (project ? t.newChat : t.name)}</span>
    </>
  );

  return (
    <section className="aiw-chat"
      onDragOver={(e) => {
        if (!canCompose || !Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void addFiles(Array.from(e.dataTransfer.files));
      }}>
      <Header controls={controls} newChatProjectId={projectId} title={title}>
        {conversation && (
          <button type="button" className="aiw-icon-btn" onClick={() => setMenu((v) => !v)} aria-label={t.moreActions}
            title={t.moreActions} aria-expanded={menu} data-testid="aiw-conversation-menu">
            <Icon d={ICONS.more} />
          </button>
        )}
      </Header>
      {menu && conversation && (
        <>
          <div className="aiw-menu-scrim" onClick={() => setMenu(false)} />
          <div className="aiw-menu aiw-menu-head" role="menu">
            <button type="button" role="menuitem" className="aiw-menu-item" data-testid="aiw-rename"
              onClick={() => { setMenu(false); setRenaming(conversation.title); }}>
              {t.rename}
            </button>
            <button type="button" role="menuitem" className="aiw-menu-item" data-testid="aiw-archive"
              onClick={() => void setArchived(!archived)}>
              {archived ? t.restore : t.archive}
            </button>
            <button type="button" role="menuitem" className="aiw-menu-item" data-danger="true" data-testid="aiw-delete"
              onClick={() => { setMenu(false); setConfirmDelete(true); }}>
              {t.delete}
            </button>
          </div>
        </>
      )}

      <div className="aiw-scroll" ref={scrollRef} onScroll={() => {
        const el = scrollRef.current;
        if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}>
        {loading ? (
          <div className="aiw-loading" role="status"><Thinking label={t.thinking} /></div>
        ) : loadError ? (
          <div className="aiw-thread">
            <p className="aiw-banner" role="alert">
              <span>{loadError}</span>
              {idRef.current && (
                <button type="button" className="aiw-link" onClick={() => void load(idRef.current as string)}>{t.retry}</button>
              )}
            </p>
          </div>
        ) : isEmpty ? (
          <div className="aiw-empty" data-testid="aiw-empty">
            <div className="aiw-empty-mark"><Icon d={ICONS.spark} size={24} /></div>
            <h2 className="aiw-empty-title">{t.emptyTitle}</h2>
            <p className="aiw-empty-body">{t.emptyBody}</p>
            {project && (
              <p className="aiw-empty-project"><Icon d={ICONS.folder} size={14} /><span>{project.name}</span></p>
            )}
            {canCompose && (
              <div className="aiw-starters">
                {t.starters.map((s) => (
                  <button key={s} type="button" className="aiw-starter"
                    onClick={() => { setDraft(s); inputRef.current?.focus(); }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="aiw-thread" data-testid="aiw-thread">
            {view?.hasEarlier && (
              <button type="button" className="aiw-earlier" onClick={() => void loadEarlier()}>{t.showEarlier}</button>
            )}
            {view?.exchanges.map((x) => {
              const user = byId.get(x.userMessageId);
              if (!user) return null;
              const chain = x.chain.map((id) => byId.get(id)).filter((m): m is AiMessage => Boolean(m));
              return (
                <div key={x.userMessageId} className="aiw-exchange">
                  <UserMessage content={user.content} attachments={user.attachments.map((a) => ({
                    fileId: a.fileId, name: a.originalFilename, kind: a.kind, byteSize: a.byteSize, removed: a.removed,
                  }))} />
                  {chain.length > 0 && (
                    <Reply chain={chain} exchange={x} text={chain.map(textFor).join("")} t={t}
                      canAct={boot.available && !archived && !active}
                      runningHere={Boolean(active) && chain.some((m) => m.id === active?.messageId || active?.messageId === null)}
                      onContinue={continueReply} onRetry={retryReply} onStop={(m) => void stopLeftBehind(m)} />
                  )}
                </div>
              );
            })}
            {optimistic && (
              <div className="aiw-exchange">
                <UserMessage content={optimistic.content} attachments={optimistic.files.map((f) => ({
                  fileId: f.file?.id, name: f.name, kind: f.kind, byteSize: f.byteSize,
                }))} />
                <div className="aiw-reply"><Thinking label={t.thinking} /></div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="aiw-composer-wrap">
        {notice && (
          <p className="aiw-banner" role="alert" data-testid="aiw-notice">
            <span>{notice}</span>
            <button type="button" className="aiw-link" onClick={() => setNotice(null)} aria-label={t.close}>×</button>
          </p>
        )}
        {!boot.available && <p className="aiw-banner" data-tone="info"><span>{t.unavailable}</span></p>}
        {archived && (
          <p className="aiw-banner" data-tone="info">
            <span>{t.archivedConversation}</span>
            <button type="button" className="aiw-link" onClick={() => void setArchived(false)}>{t.restore}</button>
          </p>
        )}
        {projectArchived && <p className="aiw-banner" data-tone="info"><span>{t.archivedProject}</span></p>}

        <div className="aiw-composer" data-disabled={!canCompose}>
          {pending.length > 0 && (
            <div className="aiw-chips" data-testid="aiw-pending">
              {pending.map((p) => (
                <FileChip key={p.key} fileId={p.file?.id} name={p.name} kind={p.kind} byteSize={p.byteSize}
                  state={p.status} detail={p.error} onRemove={() => removePending(p)} />
              ))}
            </div>
          )}
          <textarea ref={inputRef} className="aiw-input" rows={1} value={draft} placeholder={t.placeholder}
            aria-label={t.placeholder} disabled={!canCompose} data-testid="aiw-input"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends on a keyboard; a phone's Enter is a new line. Never
              // while an input method is still composing a character.
              if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                void send();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.length === 0) return;
              e.preventDefault();
              void addFiles(files);
            }} />
          <div className="aiw-composer-row">
            <div className="aiw-attach-wrap">
              <button type="button" className="aiw-icon-btn" aria-label={t.attach} title={t.attach} data-testid="aiw-attach"
                disabled={!canCompose || attachedCount >= boot.limits.maxAttachments}
                onClick={() => (projectId ? setAttachMenu((v) => !v) : fileRef.current?.click())}>
                <Icon d={ICONS.paperclip} />
              </button>
              {attachMenu && (
                <>
                  <div className="aiw-menu-scrim" onClick={() => setAttachMenu(false)} />
                  <div className="aiw-menu aiw-menu-up" role="menu">
                    <button type="button" role="menuitem" className="aiw-menu-item"
                      onClick={() => { setAttachMenu(false); fileRef.current?.click(); }}>
                      <Icon d={ICONS.upload} size={16} />{t.uploadFromDevice}
                    </button>
                    <button type="button" role="menuitem" className="aiw-menu-item" data-testid="aiw-from-library"
                      onClick={() => void openLibrary()}>
                      <Icon d={ICONS.folder} size={16} />{t.fromProjectFiles}
                    </button>
                  </div>
                </>
              )}
              <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden data-testid="aiw-file-input"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void addFiles(files);
                }} />
            </div>
            <span className="aiw-count">
              {pending.length > 0 ? t.attachmentCount(attachedCount, boot.limits.maxAttachments) : ""}
            </span>
            {active ? (
              <button type="button" className="aiw-send" data-stop="true" onClick={() => void stop()}
                aria-label={t.stop} title={t.stop} data-testid="aiw-stop">
                <Icon d={ICONS.stop} />
              </button>
            ) : (
              <button type="button" className="aiw-send" onClick={() => void send()} disabled={!canSend}
                aria-label={t.send} title={t.send} data-testid="aiw-send">
                <Icon d={ICONS.send} />
              </button>
            )}
          </div>
        </div>
      </div>

      {dragging && <div className="aiw-drop">{t.dropFiles}</div>}

      {disclosureFor && (
        <DisclosureDialog busy={accepting} onAccept={() => void acceptDisclosure()} onDecline={() => setDisclosureFor(null)} />
      )}

      {library && (
        <Dialog title={t.fromProjectFiles} onClose={() => setLibrary(null)} actions={(
          <>
            <button type="button" className="btn" onClick={() => setLibrary(null)}>{t.cancel}</button>
            <button type="button" className="btn btn-primary" disabled={picked.length === 0} onClick={addFromLibrary}
              data-testid="aiw-library-add">
              {t.attach}
            </button>
          </>
        )}>
          {library.length === 0 ? (
            <p className="aiw-muted">{t.project.noFiles}</p>
          ) : (
            <div className="aiw-pick-list">
              {library.map((f) => {
                const on = picked.includes(f.id);
                return (
                  <button key={f.id} type="button" role="checkbox" aria-checked={on} className="aiw-pick"
                    data-testid="aiw-library-file"
                    onClick={() => setPicked((c) => (on ? c.filter((x) => x !== f.id) : [...c, f.id]))}>
                    <span className="aiw-pick-box">{on && <Icon d={ICONS.check} size={13} strokeWidth={2.4} />}</span>
                    <span className="aiw-pick-name">{f.originalFilename}</span>
                    <span className="aiw-pick-meta">{formatBytes(f.byteSize)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Dialog>
      )}

      {confirmDelete && (
        <Dialog title={t.deleteConversationTitle} onClose={() => setConfirmDelete(false)} actions={(
          <>
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)} data-autofocus>{t.cancel}</button>
            <button type="button" className="btn btn-danger" onClick={() => void remove()} data-testid="aiw-confirm-delete">
              {t.delete}
            </button>
          </>
        )}>
          <div className="aiw-dialog-body"><p>{t.deleteConversationBody}</p></div>
        </Dialog>
      )}
    </section>
  );
}
