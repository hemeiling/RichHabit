import type {
  AiAttachment, AiConversation, AiFile, AiMessage, AiProject, StorageUsage, WorkspaceSettings,
} from "@/lib/aiWorkspace/types";
import type { PublicModel } from "@/lib/aiWorkspaceRuntime/models";
import type { Exchange, ReplyModel } from "@/lib/aiWorkspaceRuntime/view";

/**
 * The browser's view of the AI Workspace API.
 *
 * Types only are imported from the server modules — `import type` is erased at
 * compile time, so no data-layer or provider code reaches the client bundle
 * (tests/ai-workspace-runtime-boundaries.test.ts holds that). Everything else
 * here is fetch against same-origin routes; the browser holds no credential.
 */

export type {
  AiAttachment, AiConversation, AiFile, AiMessage, AiProject, Exchange, PublicModel, ReplyModel, StorageUsage, WorkspaceSettings,
};

export interface Limits {
  maxAttachments: number;
  maxMessageChars: number;
  maxInstructions: number;
  maxProjectName: number;
  maxTitle: number;
  maxPdfBytes: number;
  maxImageBytes: number;
  maxTextBytes: number;
}

export interface Bootstrap {
  settings: WorkspaceSettings;
  storage: StorageUsage;
  projects: AiProject[];
  archivedProjects: AiProject[];
  conversations: AiConversation[];
  archivedConversations: AiConversation[];
  available: boolean;
  /** Conversational models configured right now; the selector shows them when there is more than one. */
  models: PublicModel[];
  defaultModelId: string | null;
  /** Whether an explicit request for a picture is answered with one. */
  imageGeneration: boolean;
  limits: Limits;
}

export interface ConversationView {
  conversation: AiConversation;
  messages: AiMessage[];
  exchanges: Exchange[];
  hasEarlier: boolean;
  files: AiFile[];
  /** The conversational model this conversation carries on with, or null for the default. */
  modelId: string | null;
  /** Which model wrote each reply, by message id. */
  replyModels: Record<string, ReplyModel>;
}

export interface ProjectView {
  project: AiProject;
  summary: { name: string; conversations: number; files: number } | null;
  conversations: AiConversation[];
  archivedConversations: AiConversation[];
  files: AiFile[];
}

export type StreamEvent =
  | { type: "start"; conversation: AiConversation; userMessage: AiMessage | null; assistantMessage: AiMessage }
  | { type: "delta"; messageId: string; text: string }
  | { type: "done"; message: AiMessage };

const BASE = "/api/admin/ai/workspace";

/** A refusal or failure; `status` 0 means the server could not be reached. */
export class WorkspaceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WorkspaceError";
  }
}

async function call<T>(path: string, init: { method?: string; json?: unknown; body?: BodyInit } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: init.method ?? "GET",
      headers: init.json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      cache: "no-store",
    });
  } catch {
    throw new WorkspaceError("", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new WorkspaceError(typeof data?.error === "string" ? data.error : "", res.status);
  return data as T;
}

const q = (params: Record<string, string | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const text = s.toString();
  return text ? `?${text}` : "";
};

export const workspaceApi = {
  bootstrap: () => call<Bootstrap>(""),

  createProject: (name: string, instructions: string) =>
    call<{ project: AiProject }>("/projects", { method: "POST", json: { name, instructions } }),
  project: (id: string) => call<ProjectView>(`/projects/${id}`),
  updateProject: (id: string, patch: { name?: string; instructions?: string; archived?: boolean }) =>
    call<{ project: AiProject }>(`/projects/${id}`, { method: "PATCH", json: patch }),
  deleteProject: (id: string, confirmName: string) =>
    call<{ deleted: true }>(`/projects/${id}`, { method: "DELETE", json: { confirmName } }),

  conversations: (params: { projectId?: string; archived?: boolean }) =>
    call<{ conversations: AiConversation[] }>(`/conversations${q({
      projectId: params.projectId, archived: params.archived ? "1" : null,
    })}`),
  createConversation: (projectId: string | null) =>
    call<{ conversation: AiConversation }>("/conversations", { method: "POST", json: { projectId } }),
  conversation: (id: string, before?: string | null) =>
    call<ConversationView>(`/conversations/${id}${q({ before })}`),
  updateConversation: (id: string, patch: { title?: string; archived?: boolean }) =>
    call<{ conversation: AiConversation }>(`/conversations/${id}`, { method: "PATCH", json: patch }),
  deleteConversation: (id: string) => call<{ deleted: true }>(`/conversations/${id}`, { method: "DELETE" }),

  stop: (messageId: string, conversationId: string) =>
    call<{ stopping: boolean; message?: AiMessage }>(`/messages/${messageId}/stop`, {
      method: "POST", json: { conversationId },
    }),

  acceptDisclosure: (version: number) =>
    call<{ settings: WorkspaceSettings }>("/disclosure", { method: "POST", json: { version } }),

  upload: (file: File, where: { projectId?: string | null; conversationId?: string | null }) => {
    const form = new FormData();
    form.append("file", file, file.name);
    if (where.projectId) form.append("projectId", where.projectId);
    if (where.conversationId) form.append("conversationId", where.conversationId);
    return call<{ file: AiFile; reused: boolean; storage: StorageUsage }>("/files", { method: "POST", body: form });
  },
  deleteFile: (id: string) => call<{ deleted: true; storage: StorageUsage }>(`/files/${id}`, { method: "DELETE" }),
  discardUpload: (id: string) => call<{ discarded: boolean }>(`/files/${id}?discard=1`, { method: "DELETE" }),
  fileUrl: (id: string) => `${BASE}/files/${id}`,
};

/**
 * Sends, continues or retries, and reads the NDJSON stream as it arrives.
 * Resolves with `existing` when the server recognised a repeated send and
 * wrote nothing new.
 */
export async function streamReply(
  path: string,
  body: unknown,
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
): Promise<{ existing?: { userMessage: AiMessage; assistantMessage: AiMessage | null } }> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal,
      cache: "no-store",
    });
  } catch {
    if (signal.aborted) return {};
    throw new WorkspaceError("", 0);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new WorkspaceError(typeof data?.error === "string" ? data.error : "", res.status);
  }
  if (!(res.headers.get("content-type") ?? "").includes("ndjson") || !res.body) {
    return { existing: await res.json() };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) onEvent(JSON.parse(line) as StreamEvent);
      }
    }
  } catch {
    if (!signal.aborted) throw new WorkspaceError("", 0);
  }
  return {};
}

export const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${Math.round((bytes / 1048576) * 10) / 10} MB`;
