import { NextResponse } from "next/server";
import type { AdminUser } from "@/lib/admin";
import * as ai from "@/lib/aiWorkspace/queries";
import type { AiAttachment, AiConversation, AiMessage, MessageErrorCode } from "@/lib/aiWorkspace/types";
import { aiWorkspace } from "@/lib/env";
import { ApiError } from "@/lib/http";
import { getDict } from "@/lib/i18n/server";
import { assembleContext, type ContextMode, type ContextTurn } from "./context";
import { decodeText, detectFileType } from "./fileType";
import {
  NO_STORE, WorkspaceRefusal, errorResponse, logUnexpected, ndjsonResponse, notFoundResponse, workspaceAdmin,
} from "./http";
import { hourlyAndDailyAllowance, releaseReply, reserveReply } from "./limits";
import { isChatModel, isImageModel, type ModelOption } from "./models";
import { failureName, statusClass } from "./providerErrors";
import {
  ProviderAborted, ProviderFailure, chatProvider, imageProvider, modelCatalogue,
  type ImageProvider, type ProviderPart, type ProviderTurn, type WorkspaceProvider,
} from "./provider";

/**
 * Writing one reply: which model answers, the context or prompt, the request,
 * and the reply's final state — always one of complete, stopped or failed.
 *
 * The browser never holds the only copy. Streamed text is saved to the reply's
 * row as it arrives (at most every `SAVE_EVERY_MS`), and the last save happens
 * in the same statement that ends the reply. A generated picture is saved as a
 * file carried by the reply before the reply ends. Stop, a closed tab and a
 * reload all abort the request; what was written is saved as stopped.
 */

const SAVE_EVERY_MS = 1000;
const MAX_REPLY_CHARS = 500_000;
const PAGE = 200;
const MAX_PAGES = 5;
/** Pictures attached to the prompt that are sent along as references. */
const MAX_REFERENCE_IMAGES = 3;
/** Room a new picture needs before it is worth asking for one. */
export const GENERATED_IMAGE_RESERVE_BYTES = 2 * 1024 * 1024;

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
 * An attachment as the provider receives it. For a provider with a files API,
 * PDFs and images are uploaded once and the provider's copy reused afterwards;
 * if an upload fails the bytes are sent inline for this request, so a flaky
 * upload does not cost the admin their reply. A provider without a files API
 * receives them inline every time. Text is always sent as text.
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

  const inline = (bytes: Uint8Array): ProviderPart => {
    const data = Buffer.from(bytes).toString("base64");
    return a.kind === "pdf"
      ? { type: "document", title: a.originalFilename, source: { kind: "base64", mimeType: "application/pdf", data } }
      : { type: "image", source: { kind: "base64", mimeType: a.mimeType, data } };
  };
  const reference = (providerFileId: string): ProviderPart => (a.kind === "pdf"
    ? { type: "document", title: a.originalFilename, source: { kind: "file", providerFileId } }
    : { type: "image", source: { kind: "file", providerFileId } });

  if (!provider.uploadFile) {
    const stored = await ai.getFileContent(userId, a.fileId);
    return stored ? inline(stored.bytes) : removedNote(a.originalFilename);
  }

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
    return inline(stored.bytes);
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

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** "generated-image-20260913-142501.png": a name that sorts by time and says what it is. */
export function generatedImageFilename(at: Date, index: number, mimeType: string): string {
  const stamp = at.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `generated-image-${stamp}${index > 0 ? `-${index + 1}` : ""}.${EXTENSIONS[mimeType] ?? "png"}`;
}

export async function runReply(input: {
  userId: string;
  conversation: AiConversation;
  assistant: AiMessage;
  mode: ContextMode;
  /** The conversational model's provider. */
  provider?: WorkspaceProvider | null;
  /** Set instead when the reply is a generated picture. */
  image?: ImageProvider | null;
  /** Whether image generation is configured, which the conversational model is told. */
  imageGeneration?: boolean;
  signal: AbortSignal;
  emit: (event: ReplyEvent) => void;
}): Promise<AiMessage | null> {
  const { userId, conversation, assistant, mode, provider, image, signal, emit } = input;
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

    if (image) {
      // A picture is made from the message it answers, and any pictures attached to it.
      const target = mode.kind === "reply" ? null : messages.find((m) => m.id === mode.targetMessageId);
      const anchorId = mode.kind === "reply" ? mode.userMessageId : target?.replyToMessageId;
      const anchor = messages.find((m) => m.id === anchorId && m.role === "user");
      if (!anchor) throw new Error("image prompt not loaded");
      const references: { mimeType: string; data: string }[] = [];
      for (const a of anchor.attachments.filter((f) => f.kind === "image" && !f.removed).slice(0, MAX_REFERENCE_IMAGES)) {
        const stored = await ai.getFileContent(userId, a.fileId);
        if (stored) references.push({ mimeType: a.mimeType, data: Buffer.from(stored.bytes).toString("base64") });
      }
      contextMessages = 1;
      if (signal.aborted) throw new ProviderAborted();

      const result = await image.generateImage({
        model: assistant.model ?? aiWorkspace.imageModel,
        prompt: anchor.content.trim() || "Create an image.",
        references,
        imageSize: aiWorkspace.imageSize,
        signal,
      });
      if (signal.aborted) throw new ProviderAborted();

      let saved = 0;
      let storageFull = false;
      const at = new Date();
      for (const [index, picture] of result.images.entries()) {
        // The stored type is decided from the bytes, as for an upload.
        const detected = detectFileType(picture.bytes);
        if (!detected || detected.kind !== "image") continue;
        try {
          await ai.recordGeneratedImage(userId, {
            messageId: assistant.id, mimeType: detected.mimeType, bytes: picture.bytes,
            filename: generatedImageFilename(at, index, detected.mimeType),
          });
          saved++;
        } catch (e) {
          if (e instanceof ApiError && e.status === 413) {
            storageFull = true;
            break;
          }
          throw e;
        }
      }
      content = result.text.slice(0, MAX_REPLY_CHARS);
      if (content) emit({ type: "delta", messageId: assistant.id, text: content });
      if (saved === 0 && !storageFull && !content) throw new ProviderFailure("malformed_response");

      return done(await finish({
        status: "complete", content,
        stopReason: saved === 0 && storageFull ? "storage_full" : result.stopReason,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        cacheReadTokens: null, cacheWriteTokens: null, contextMessages, latencyMs: Date.now() - started,
      }));
    }

    if (!provider) throw new ProviderFailure("provider_error");
    const project = conversation.projectId ? await ai.getProject(userId, conversation.projectId) : null;
    const context = assembleContext(messages, mode, project?.instructions ?? null,
      { targetTokens: aiWorkspace.contextTargetTokens }, assistant.id, { imageGeneration: input.imageGeneration });
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
    if (failure) {
      // Safe, structured metadata only: never the prompt, the reply, an image or the provider's words.
      const providerName = image?.id ?? provider?.id ?? "none";
      const capability = image ? "image_generation" : "text";
      console.error(`[ai-workspace] reply failed provider=${providerName} capability=${capability} status=${statusClass(failure.status)} code=${failureName(failure)}`);
    } else {
      logUnexpected("reply", e);
    }
    // A stored copy the provider could not use is re-uploaded next time.
    if (failure && provider && (failure.code === "unreadable_file" || failure.status === 404)) {
      for (const fileId of usedCopies) {
        await ai.markProviderCopyFailed(userId, fileId, provider.id, failure.code).catch(() => {});
      }
    }
    return done(await finish({
      status: "failed", content, errorCode, detail: failure?.detail ?? null, latencyMs: Date.now() - started,
    }));
  }
}

export interface StartedGeneration {
  conversation: AiConversation;
  userMessage: AiMessage | null;
  assistant: AiMessage;
  mode: ContextMode;
  /** The model chosen through `ReplyTools.use`. */
  option: ModelOption;
}

export interface ReplyTools {
  /** The models configured right now. */
  catalogue: ModelOption[];
  /**
   * Confirms the chosen model can answer, before anything is written: its
   * provider is configured and, for a picture, there is room to keep one.
   */
  use(option: ModelOption): Promise<void>;
}

const megabytes = (bytes: number) => `${Math.round((bytes / 1048576) * 10) / 10} MB`;

/**
 * The shared shape of send, Continue and Retry: admin check, one reply at a
 * time, a model available, hourly and daily limits, then `start` routes the
 * request, confirms the model with `use`, writes the rows, and the reply
 * streams back as NDJSON.
 *
 * `start` may return `{ existing }` for a repeated client id: the same message
 * was already sent, so nothing is written and no model is asked again.
 */
export async function replyResponse(
  request: Request,
  start: (admin: AdminUser, tools: ReplyTools) => Promise<StartedGeneration | { existing: unknown }>,
): Promise<Response> {
  const admin = await workspaceAdmin();
  if (!admin) return notFoundResponse();
  const t = getDict();

  const slot = reserveReply(admin.id);
  if (!slot) return errorResponse(new WorkspaceRefusal(t.aiWorkspace.errors.busy, 409), t);

  let streaming = false;
  try {
    const catalogue = await modelCatalogue();
    if (!catalogue.some(isChatModel)) throw new WorkspaceRefusal(t.aiWorkspace.errors.unavailable, 503);
    const limit = await hourlyAndDailyAllowance(admin.id);
    if (limit) {
      throw new WorkspaceRefusal(limit === "hour" ? t.aiWorkspace.errors.hourLimit : t.aiWorkspace.errors.dayLimit, 429);
    }

    const chosen: { current: { option: ModelOption; chat: WorkspaceProvider | null; image: ImageProvider | null } | null } =
      { current: null };
    const tools: ReplyTools = {
      catalogue,
      async use(option) {
        if (isImageModel(option)) {
          const image = await imageProvider(option.provider);
          if (!image) throw new WorkspaceRefusal(t.aiWorkspace.errors.unavailable, 503);
          const usage = await ai.storageUsage(admin.id);
          const left = Math.max(0, usage.quotaBytes - usage.usedBytes);
          if (left < GENERATED_IMAGE_RESERVE_BYTES) {
            throw new ApiError(`Not enough storage: ${megabytes(left)} left of ${megabytes(usage.quotaBytes)}`, 413);
          }
          chosen.current = { option, chat: null, image };
        } else {
          const chat = await chatProvider(option.provider);
          if (!chat) throw new WorkspaceRefusal(t.aiWorkspace.errors.unavailable, 503);
          chosen.current = { option, chat, image: null };
        }
      },
    };

    const started = await start(admin, tools);
    if ("existing" in started) return NextResponse.json(started.existing, { headers: NO_STORE });
    const resolved = chosen.current;
    if (!resolved || resolved.option !== started.option) throw new Error("reply model was not confirmed");

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
          mode: started.mode, provider: resolved.chat, image: resolved.image,
          imageGeneration: catalogue.some(isImageModel), signal, emit: send,
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
