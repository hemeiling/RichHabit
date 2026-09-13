import { NextResponse } from "next/server";
import type { AdminUser } from "@/lib/admin";
import * as ai from "@/lib/aiWorkspace/queries";
import type { AiAttachment, AiConversation, AiMessage, MessageErrorCode } from "@/lib/aiWorkspace/types";
import { aiWorkspace } from "@/lib/env";
import { getDict } from "@/lib/i18n/server";
import { assembleContext, type ContextMode, type ContextTurn } from "./context";
import { decodeText } from "./fileType";
import {
  NO_STORE, WorkspaceRefusal, errorResponse, logUnexpected, ndjsonResponse, notFoundResponse, workspaceAdmin,
} from "./http";
import { hourlyAndDailyAllowance, releaseReply, reserveReply } from "./limits";
import {
  ProviderAborted, ProviderFailure, workspaceProvider,
  type ProviderPart, type ProviderTurn, type WorkspaceProvider,
} from "./provider";

/**
 * Writing one reply: context, files, the streamed request, and the reply's
 * final state — always one of complete, stopped or failed.
 *
 * The browser never holds the only copy. Text is saved to the reply's row as it
 * arrives (at most every `SAVE_EVERY_MS`), and the last save happens in the same
 * statement that ends the reply. Stop, a closed tab and a reload all abort the
 * request; what was written is saved as stopped and can be continued.
 */

const SAVE_EVERY_MS = 1000;
const MAX_REPLY_CHARS = 500_000;
const PAGE = 200;
const MAX_PAGES = 5;

export type ReplyEvent =
  | { type: "delta"; messageId: string; text: string }
  | { type: "done"; message: AiMessage };

/** The conversation's latest messages, reaching back far enough to include `mustInclude`. */
async function loadMessages(userId: string, conversationId: string, mustInclude: string[]): Promise<AiMessage[]> {
  let messages = (await ai.listMessages(userId, conversationId, { limit: PAGE })) ?? [];
  for (let page = 1; page < MAX_PAGES; page++) {
    const ids = new Set(messages.map((m) => m.id));
    if (mustInclude.every((id) => ids.has(id)) || messages.length < PAGE * page) break;
    const earlier = (await ai.listMessages(userId, conversationId, { before: messages[0].createdAt, limit: PAGE })) ?? [];
    if (earlier.length === 0) break;
    messages = [...earlier, ...messages];
  }
  return messages;
}

const removedNote = (filename: string): ProviderPart =>
  ({ type: "text", text: `[The file "${filename}" was attached here but has since been removed.]` });

/**
 * An attachment as the provider receives it. PDFs and images are uploaded once
 * and the provider's copy reused afterwards; text is sent as text. If an upload
 * fails the bytes are sent inline for this request, so a flaky upload does not
 * cost the admin their reply.
 */
async function resolveAttachment(
  userId: string, provider: WorkspaceProvider, a: AiAttachment, usedCopies: string[],
): Promise<ProviderPart> {
  if (a.removed) return removedNote(a.originalFilename);
  if (a.kind === "text") {
    const stored = await ai.getFileContent(userId, a.fileId);
    if (!stored) return removedNote(a.originalFilename);
    return { type: "document", title: a.originalFilename, source: { kind: "text", text: decodeText(stored.bytes) } };
  }

  const reference = (providerFileId: string): ProviderPart => (a.kind === "pdf"
    ? { type: "document", title: a.originalFilename, source: { kind: "file", providerFileId } }
    : { type: "image", source: { kind: "file", providerFileId } });

  const copy = await ai.claimProviderCopy(userId, a.fileId, provider.id);
  if (!copy) return removedNote(a.originalFilename);
  if (copy.status === "uploaded" && copy.providerFileId) {
    usedCopies.push(a.fileId);
    return reference(copy.providerFileId);
  }

  const stored = await ai.getFileContent(userId, a.fileId);
  if (!stored) return removedNote(a.originalFilename);
  try {
    const providerFileId = await provider.uploadFile({
      bytes: stored.bytes, filename: a.originalFilename, mimeType: a.mimeType,
    });
    await ai.markProviderCopyUploaded(userId, a.fileId, provider.id, providerFileId);
    usedCopies.push(a.fileId);
    return reference(providerFileId);
  } catch (e) {
    const code = e instanceof ProviderFailure ? e.code : "provider_error";
    console.error(`[ai-workspace] file copy failed (${code})`);
    await ai.markProviderCopyFailed(userId, a.fileId, provider.id, code).catch(() => {});
    const data = Buffer.from(stored.bytes).toString("base64");
    return a.kind === "pdf"
      ? { type: "document", title: a.originalFilename, source: { kind: "base64", mimeType: "application/pdf", data } }
      : { type: "image", source: { kind: "base64", mimeType: a.mimeType, data } };
  }
}

async function resolveTurns(
  userId: string, provider: WorkspaceProvider, turns: ContextTurn[], usedCopies: string[],
): Promise<ProviderTurn[]> {
  const resolved: ProviderTurn[] = [];
  for (const turn of turns) {
    const parts: ProviderPart[] = [];
    for (const part of turn.parts) {
      if (part.type === "text") parts.push(part);
      else if (part.type === "removed-file") parts.push(removedNote(part.filename));
      else parts.push(await resolveAttachment(userId, provider, part.attachment, usedCopies));
    }
    resolved.push({ role: turn.role, parts });
  }
  return resolved;
}

export async function runReply(input: {
  userId: string;
  conversation: AiConversation;
  assistant: AiMessage;
  mode: ContextMode;
  provider: WorkspaceProvider;
  signal: AbortSignal;
  emit: (event: ReplyEvent) => void;
}): Promise<AiMessage | null> {
  const { userId, conversation, assistant, mode, provider, signal, emit } = input;
  const started = Date.now();
  let content = "";
  let lastSave = started;
  let saving: Promise<unknown> = Promise.resolve();
  let contextMessages: number | null = null;
  const usedCopies: string[] = [];

  const finish = async (outcome: ai.ReplyOutcome): Promise<AiMessage | null> => {
    await saving;
    try {
      const saved = await ai.finishReply(userId, assistant.id, outcome);
      if (saved) return saved;
      // No longer streaming: stopped elsewhere, or recovered as interrupted.
      const current = await ai.listMessages(userId, conversation.id, { limit: PAGE });
      return current?.find((m) => m.id === assistant.id) ?? null;
    } catch (e) {
      logUnexpected("finishing a reply", e);
      return null;
    }
  };
  const done = (message: AiMessage | null) => {
    emit({ type: "done", message: message ?? { ...assistant, content, status: "failed", errorCode: "provider_error" } });
    return message;
  };

  try {
    const required = mode.kind === "reply" ? [mode.userMessageId] : [mode.targetMessageId];
    const messages = await loadMessages(userId, conversation.id, required);
    const project = conversation.projectId ? await ai.getProject(userId, conversation.projectId) : null;
    const context = assembleContext(messages, mode, project?.instructions ?? null,
      { targetTokens: aiWorkspace.contextTargetTokens }, assistant.id);
    contextMessages = context.contextMessages;
    const turns = await resolveTurns(userId, provider, context.turns, usedCopies);
    if (signal.aborted) throw new ProviderAborted();

    const result = await provider.streamChat({
      model: assistant.model ?? aiWorkspace.model,
      system: context.system,
      turns,
      maxOutputTokens: assistant.maxOutputTokens ?? aiWorkspace.maxOutputTokens,
      signal,
    }, (delta) => {
      if (!delta || content.length + delta.length > MAX_REPLY_CHARS) return;
      content += delta;
      emit({ type: "delta", messageId: assistant.id, text: delta });
      if (Date.now() - lastSave >= SAVE_EVERY_MS) {
        lastSave = Date.now();
        const snapshot = content;
        saving = saving
          .then(() => ai.saveReplyProgress(userId, assistant.id, snapshot))
          .catch((e) => logUnexpected("saving reply progress", e));
      }
    });

    return done(await finish({
      status: "complete", content, stopReason: result.stopReason,
      inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens, cacheWriteTokens: result.cacheWriteTokens,
      contextMessages, latencyMs: Date.now() - started,
    }));
  } catch (e) {
    if (signal.aborted || e instanceof ProviderAborted) {
      return done(await finish({ status: "stopped", content, latencyMs: Date.now() - started }));
    }
    const failure = e instanceof ProviderFailure ? e : null;
    const errorCode: MessageErrorCode = failure?.code ?? "provider_error";
    if (failure) console.error(`[ai-workspace] reply failed (${failure.code}${failure.status ? ` ${failure.status}` : ""})`);
    else logUnexpected("reply", e);
    // A stored copy the provider could not use is re-uploaded next time.
    if (failure && (failure.code === "unreadable_file" || failure.status === 404)) {
      for (const fileId of usedCopies) {
        await ai.markProviderCopyFailed(userId, fileId, provider.id, failure.code).catch(() => {});
      }
    }
    return done(await finish({ status: "failed", content, errorCode, latencyMs: Date.now() - started }));
  }
}

export interface StartedGeneration {
  conversation: AiConversation;
  userMessage: AiMessage | null;
  assistant: AiMessage;
  mode: ContextMode;
}

/**
 * The shared shape of send, Continue and Retry: admin check, one reply at a
 * time, provider available, hourly and daily limits, then `start` writes the
 * rows and the reply streams back as NDJSON.
 *
 * `start` may return `{ existing }` for a repeated client id: the same message
 * was already sent, so nothing is written and the model is not asked again.
 */
export async function replyResponse(
  request: Request,
  start: (admin: AdminUser, provider: WorkspaceProvider) => Promise<StartedGeneration | { existing: unknown }>,
): Promise<Response> {
  const admin = await workspaceAdmin();
  if (!admin) return notFoundResponse();
  const t = getDict();

  const slot = reserveReply(admin.id);
  if (!slot) return errorResponse(new WorkspaceRefusal(t.aiWorkspace.errors.busy, 409), t);

  let streaming = false;
  try {
    const provider = await workspaceProvider();
    if (!provider) throw new WorkspaceRefusal(t.aiWorkspace.errors.unavailable, 503);
    const limit = await hourlyAndDailyAllowance(admin.id);
    if (limit) {
      throw new WorkspaceRefusal(limit === "hour" ? t.aiWorkspace.errors.hourLimit : t.aiWorkspace.errors.dayLimit, 429);
    }

    const started = await start(admin, provider);
    if ("existing" in started) return NextResponse.json(started.existing, { headers: NO_STORE });

    slot.messageId = started.assistant.id;
    streaming = true;
    return ndjsonResponse(request, slot.controller, async (send, signal) => {
      try {
        send({
          type: "start", conversation: started.conversation,
          userMessage: started.userMessage, assistantMessage: started.assistant,
        });
        await runReply({
          userId: admin.id, conversation: started.conversation, assistant: started.assistant,
          mode: started.mode, provider, signal, emit: send,
        });
      } finally {
        releaseReply(slot);
      }
    });
  } catch (e) {
    return errorResponse(e, t);
  } finally {
    if (!streaming) releaseReply(slot);
  }
}
