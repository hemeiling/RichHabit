import { createHash } from "node:crypto";
import { query, transaction } from "@/lib/db/pool";
import { aiWorkspace } from "@/lib/env";
import { ApiError, isUuid } from "@/lib/http";
import { UPLOAD_DISCLOSURE_VERSION, isCurrentDisclosure } from "./disclosure";
import { STALE_STREAMING_MINUTES, canContinue, canRetry, visibleChain } from "./lifecycle";
import {
  FILE_KINDS, MIME_TYPES_BY_KIND,
  type AiAttachment, type AiConversation, type AiFile, type AiMessage, type AiProject, type FileKind,
  type MessageErrorCode, type ProviderCopy, type StorageUsage, type WorkspaceSettings,
} from "./types";
import * as v from "./validate";

/**
 * The AI Workspace data layer: the only module that reads or writes the seven
 * `ai_*` tables.
 *
 * Every exported function takes the admin's user id first, and every statement
 * is scoped by it. Something that does not exist and something that belongs to
 * another admin are indistinguishable: both come back as null, false or a 404.
 * Authorization that the caller is an admin at all is the route's job
 * (`withAdmin`); this layer guarantees ownership.
 *
 * Nothing here logs, and nothing here reads any RichHabit table other than
 * through the `users` foreign keys.
 */

type Q = typeof query;

const iso = (value: unknown) => new Date(value as string).toISOString();
const isoOrNull = (value: unknown) => (value == null ? null : iso(value));
const numOrNull = (value: unknown) => (value == null ? null : Number(value));
const notFound = (what: string) => new ApiError(`${what} not found`, 404);

// ───────────────────────────── row mapping ────────────────────────────────────

const PROJECT_COLUMNS = "id, name, instructions, created_at, updated_at, archived_at";
const toProject = (r: any): AiProject => ({
  id: r.id, name: r.name, instructions: r.instructions,
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), archivedAt: isoOrNull(r.archived_at),
});

const CONVERSATION_COLUMNS =
  "id, project_id, title, title_edited, created_at, updated_at, last_message_at, archived_at";
const toConversation = (r: any): AiConversation => ({
  id: r.id, projectId: r.project_id ?? null, title: r.title, titleEdited: r.title_edited === true,
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  lastMessageAt: iso(r.last_message_at), archivedAt: isoOrNull(r.archived_at),
});

const MESSAGE_COLUMNS = `m.id, m.conversation_id, m.role, m.content, m.status, m.error_code, m.client_id,
  m.reply_kind, m.reply_to_message_id, m.continuation_of_message_id, m.retry_of_message_id,
  m.provider, m.model, m.max_output_tokens, m.stop_reason, m.input_tokens, m.output_tokens,
  m.cache_read_tokens, m.cache_write_tokens, m.context_messages, m.latency_ms, m.created_at, m.completed_at`;
const RETURNING_MESSAGE = MESSAGE_COLUMNS.replace(/m\./g, "");
const toMessage = (r: any, attachments: AiAttachment[] = []): AiMessage => ({
  id: r.id, conversationId: r.conversation_id, role: r.role, content: r.content, status: r.status,
  errorCode: r.error_code ?? null, clientId: r.client_id ?? null, replyKind: r.reply_kind ?? null,
  replyToMessageId: r.reply_to_message_id ?? null,
  continuationOfMessageId: r.continuation_of_message_id ?? null,
  retryOfMessageId: r.retry_of_message_id ?? null,
  provider: r.provider ?? null, model: r.model ?? null, maxOutputTokens: numOrNull(r.max_output_tokens),
  stopReason: r.stop_reason ?? null, inputTokens: numOrNull(r.input_tokens),
  outputTokens: numOrNull(r.output_tokens), cacheReadTokens: numOrNull(r.cache_read_tokens),
  cacheWriteTokens: numOrNull(r.cache_write_tokens), contextMessages: numOrNull(r.context_messages),
  latencyMs: numOrNull(r.latency_ms), createdAt: iso(r.created_at), completedAt: isoOrNull(r.completed_at),
  attachments,
});

const FILE_COLUMNS =
  "id, project_id, conversation_id, original_filename, kind, mime_type, byte_size, sha256, created_at, deleted_at";
const toFile = (r: any): AiFile => ({
  id: r.id, projectId: r.project_id ?? null, conversationId: r.conversation_id ?? null,
  originalFilename: r.original_filename, kind: r.kind, mimeType: r.mime_type, byteSize: Number(r.byte_size),
  sha256: r.sha256, createdAt: iso(r.created_at), deletedAt: isoOrNull(r.deleted_at),
});

const COPY_COLUMNS = "c.file_id, c.provider, c.provider_file_id, c.status, c.uploaded_at, c.deleted_at, c.failure_code, c.updated_at";
const toCopy = (r: any): ProviderCopy => ({
  fileId: r.file_id, provider: r.provider, providerFileId: r.provider_file_id ?? null, status: r.status,
  uploadedAt: isoOrNull(r.uploaded_at), deletedAt: isoOrNull(r.deleted_at),
  failureCode: r.failure_code ?? null, updatedAt: iso(r.updated_at),
});

/** Uploaded provider copies of the given files, for the caller to delete remotely. */
async function uploadedCopies(q: Q, userId: string, fileWhere: string, params: unknown[]): Promise<ProviderCopy[]> {
  const rows = await q(
    `select ${COPY_COLUMNS} from ai_file_provider_copies c
       join ai_files f on f.id = c.file_id
      where f.user_id = $1 and c.status = 'uploaded' and (${fileWhere})`,
    [userId, ...params]);
  return rows.map(toCopy);
}

// ───────────────────────────── projects ───────────────────────────────────────

export async function listProjects(userId: string, opts: { archived?: boolean } = {}): Promise<AiProject[]> {
  const rows = await query(
    `select ${PROJECT_COLUMNS} from ai_projects
      where user_id = $1 and (archived_at is not null) = $2
      order by updated_at desc, id`,
    [userId, opts.archived === true]);
  return rows.map(toProject);
}

export async function getProject(userId: string, projectId: unknown): Promise<AiProject | null> {
  if (!isUuid(projectId)) return null;
  const [row] = await query(`select ${PROJECT_COLUMNS} from ai_projects where id = $1 and user_id = $2`,
    [projectId, userId]);
  return row ? toProject(row) : null;
}

export async function createProject(userId: string, input: { name: unknown; instructions?: unknown }): Promise<AiProject> {
  const name = v.projectName(input.name);
  const instructions = v.projectInstructions(input.instructions);
  const [row] = await query(
    `insert into ai_projects (user_id, name, instructions) values ($1, $2, $3) returning ${PROJECT_COLUMNS}`,
    [userId, name, instructions]);
  return toProject(row);
}

export async function updateProject(
  userId: string, projectId: unknown, input: { name?: unknown; instructions?: unknown },
): Promise<AiProject | null> {
  if (!isUuid(projectId)) return null;
  const name = input.name === undefined ? null : v.projectName(input.name);
  const instructions = input.instructions === undefined ? null : v.projectInstructions(input.instructions);
  const [row] = await query(
    `update ai_projects
        set name = coalesce($3, name), instructions = coalesce($4, instructions), updated_at = now()
      where id = $1 and user_id = $2
      returning ${PROJECT_COLUMNS}`,
    [projectId, userId, name, instructions]);
  return row ? toProject(row) : null;
}

/** Archive is the normal lifecycle action: reversible, nothing deleted. */
export async function setProjectArchived(userId: string, projectId: unknown, archived: boolean): Promise<AiProject | null> {
  if (!isUuid(projectId)) return null;
  const [row] = await query(
    `update ai_projects
        set archived_at = case when $3 then coalesce(archived_at, now()) else null end, updated_at = now()
      where id = $1 and user_id = $2
      returning ${PROJECT_COLUMNS}`,
    [projectId, userId, archived]);
  return row ? toProject(row) : null;
}

/** What a permanent delete would remove, for the confirmation. */
export async function projectDeletionSummary(
  userId: string, projectId: unknown,
): Promise<{ name: string; conversations: number; files: number } | null> {
  if (!isUuid(projectId)) return null;
  const [row] = await query(
    `select p.name,
            (select count(*)::int from ai_conversations c where c.project_id = p.id and c.user_id = p.user_id) as conversations,
            (select count(*)::int from ai_files f
              where f.user_id = p.user_id and f.deleted_at is null
                and (f.project_id = p.id or f.conversation_id in
                     (select c.id from ai_conversations c where c.project_id = p.id and c.user_id = p.user_id))) as files
       from ai_projects p where p.id = $1 and p.user_id = $2`,
    [projectId, userId]);
  return row ? { name: row.name, conversations: row.conversations, files: row.files } : null;
}

/**
 * Deletes a project, its conversations, their messages and files, and its
 * library, permanently. Refused unless `confirmName` is the project's exact
 * name. Returns the provider copies that existed, so their remote copies can be
 * deleted; the database rows are already gone.
 */
export async function deleteProjectPermanently(
  userId: string, projectId: unknown, confirmName: unknown,
): Promise<{ conversations: number; files: number; providerCopies: ProviderCopy[] } | null> {
  if (!isUuid(projectId)) return null;
  return transaction(async (q) => {
    const [project] = await q(`select name from ai_projects where id = $1 and user_id = $2 for update`, [projectId, userId]);
    if (!project) return null;
    if (confirmName !== project.name) throw new ApiError("Type the project's name to delete it permanently");
    const inProject = `f.project_id = $2 or f.conversation_id in
      (select c.id from ai_conversations c where c.project_id = $2 and c.user_id = $1)`;
    const [counts] = await q(
      `select (select count(*)::int from ai_conversations where project_id = $2 and user_id = $1) as conversations,
              (select count(*)::int from ai_files f where f.user_id = $1 and (${inProject})) as files`,
      [userId, projectId]);
    const providerCopies = await uploadedCopies(q, userId, inProject, [projectId]);
    await q(`delete from ai_projects where id = $1 and user_id = $2`, [projectId, userId]);
    return { conversations: counts.conversations, files: counts.files, providerCopies };
  });
}

// ─────────────────────────── conversations ────────────────────────────────────

export async function listConversations(
  userId: string,
  opts: { projectId?: unknown; archived?: boolean; before?: string | null; limit?: number } = {},
): Promise<AiConversation[]> {
  if (opts.projectId != null && !isUuid(opts.projectId)) return [];
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 30), 1), 100);
  const rows = await query(
    `select ${CONVERSATION_COLUMNS} from ai_conversations
      where user_id = $1 and (archived_at is not null) = $2
        and ($3::uuid is null or project_id = $3::uuid)
        and ($4::timestamptz is null or last_message_at < $4::timestamptz)
      order by last_message_at desc, id
      limit $5`,
    [userId, opts.archived === true, opts.projectId ?? null, opts.before ?? null, limit]);
  return rows.map(toConversation);
}

export async function getConversation(userId: string, conversationId: unknown): Promise<AiConversation | null> {
  if (!isUuid(conversationId)) return null;
  const [row] = await query(`select ${CONVERSATION_COLUMNS} from ai_conversations where id = $1 and user_id = $2`,
    [conversationId, userId]);
  return row ? toConversation(row) : null;
}

export async function createConversation(userId: string, input: { projectId?: unknown } = {}): Promise<AiConversation> {
  const projectId = input.projectId ?? null;
  if (projectId !== null) {
    if (!isUuid(projectId)) throw notFound("Project");
    const [project] = await query(
      `select 1 from ai_projects where id = $1 and user_id = $2 and archived_at is null`, [projectId, userId]);
    if (!project) throw notFound("Project");
  }
  const [row] = await query(
    `insert into ai_conversations (user_id, project_id) values ($1, $2) returning ${CONVERSATION_COLUMNS}`,
    [userId, projectId]);
  return toConversation(row);
}

export async function renameConversation(userId: string, conversationId: unknown, title: unknown): Promise<AiConversation | null> {
  if (!isUuid(conversationId)) return null;
  const clean = v.conversationTitle(title);
  const [row] = await query(
    `update ai_conversations set title = $3, title_edited = true, updated_at = now()
      where id = $1 and user_id = $2 returning ${CONVERSATION_COLUMNS}`,
    [conversationId, userId, clean]);
  return row ? toConversation(row) : null;
}

export async function setConversationArchived(
  userId: string, conversationId: unknown, archived: boolean,
): Promise<AiConversation | null> {
  if (!isUuid(conversationId)) return null;
  const [row] = await query(
    `update ai_conversations
        set archived_at = case when $3 then coalesce(archived_at, now()) else null end, updated_at = now()
      where id = $1 and user_id = $2 returning ${CONVERSATION_COLUMNS}`,
    [conversationId, userId, archived]);
  return row ? toConversation(row) : null;
}

/** Deletes a conversation, its messages and the files uploaded into it. Library files stay. */
export async function deleteConversation(
  userId: string, conversationId: unknown,
): Promise<{ providerCopies: ProviderCopy[] } | null> {
  if (!isUuid(conversationId)) return null;
  return transaction(async (q) => {
    const [row] = await q(`select 1 from ai_conversations where id = $1 and user_id = $2 for update`,
      [conversationId, userId]);
    if (!row) return null;
    const providerCopies = await uploadedCopies(q, userId, "f.conversation_id = $2", [conversationId]);
    await q(`delete from ai_conversations where id = $1 and user_id = $2`, [conversationId, userId]);
    return { providerCopies };
  });
}

// ───────────────────────────── messages ───────────────────────────────────────

async function attachmentsFor(q: Q, userId: string, messageIds: string[]): Promise<Map<string, AiAttachment[]>> {
  const byMessage = new Map<string, AiAttachment[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = await q(
    `select mf.message_id, mf.position, f.id as file_id, f.original_filename, f.kind, f.mime_type, f.byte_size,
            f.deleted_at is not null as removed
       from ai_message_files mf
       join ai_files f on f.id = mf.file_id and f.user_id = mf.user_id
      where mf.user_id = $1 and mf.message_id = any($2::uuid[])
      order by mf.message_id, mf.position`,
    [userId, messageIds]);
  for (const r of rows) {
    const list = byMessage.get(r.message_id) ?? [];
    list.push({
      fileId: r.file_id, position: Number(r.position), originalFilename: r.original_filename, kind: r.kind,
      mimeType: r.mime_type, byteSize: Number(r.byte_size), removed: r.removed === true,
    });
    byMessage.set(r.message_id, list);
  }
  return byMessage;
}

/**
 * Marks replies still streaming after the stale window as failed with
 * `interrupted`. Called before reading a conversation and before starting a
 * reply, so a restart mid-stream never leaves a reply spinning forever.
 */
export async function recoverStaleStreams(userId: string, conversationId: string | null = null, q: Q = query): Promise<number> {
  const rows = await q(
    `update ai_messages
        set status = 'failed', error_code = 'interrupted', completed_at = now()
      where user_id = $1 and role = 'assistant' and status = 'streaming'
        and created_at < now() - make_interval(mins => $2::int)
        and ($3::uuid is null or conversation_id = $3::uuid)
      returning id`,
    [userId, STALE_STREAMING_MINUTES, conversationId]);
  return rows.length;
}

export async function listMessages(
  userId: string, conversationId: unknown, opts: { before?: string | null; limit?: number } = {},
): Promise<AiMessage[] | null> {
  if (!isUuid(conversationId)) return null;
  const conversation = await getConversation(userId, conversationId);
  if (!conversation) return null;
  await recoverStaleStreams(userId, conversationId);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
  const rows = await query(
    `select ${MESSAGE_COLUMNS} from ai_messages m
      where m.conversation_id = $1 and m.user_id = $2
        and ($3::timestamptz is null or m.created_at < $3::timestamptz)
      -- A message and its reply can share a timestamp (same transaction, coarse clock):
      -- the admin's message always reads first, so a reply never appears above its question.
      order by m.created_at desc, (m.role = 'user') asc, m.id desc
      limit $4`,
    [conversationId, userId, opts.before ?? null, limit]);
  rows.reverse();
  const attachments = await attachmentsFor(query, userId, rows.map((r: any) => r.id));
  return rows.map((r: any) => toMessage(r, attachments.get(r.id) ?? []));
}

/** One reply at a time per admin. Stale streams are recovered first, so a crash cannot block forever. */
async function assertNoActiveReply(q: Q, userId: string): Promise<void> {
  await recoverStaleStreams(userId, null, q);
  const [active] = await q(
    `select 1 from ai_messages where user_id = $1 and role = 'assistant' and status = 'streaming' limit 1`, [userId]);
  if (active) throw new ApiError("A reply is still being written. Stop it or wait for it to finish.", 409);
}

interface ReplySettings { provider: unknown; model: unknown; maxOutputTokens: unknown }
function replySettings(input: ReplySettings) {
  return { provider: v.providerId(input.provider), model: v.modelId(input.model), maxOutputTokens: v.maxOutputTokens(input.maxOutputTokens) };
}

async function insertAssistant(
  q: Q, userId: string, conversationId: string, lineage: {
    replyKind: "reply" | "continuation" | "retry"; replyToMessageId: string;
    continuationOfMessageId?: string | null; retryOfMessageId?: string | null;
  }, settings: ReturnType<typeof replySettings>,
): Promise<AiMessage> {
  const [row] = await q(
    `insert into ai_messages
       (conversation_id, user_id, role, status, reply_kind, reply_to_message_id,
        continuation_of_message_id, retry_of_message_id, provider, model, max_output_tokens, created_at)
     values ($1, $2, 'assistant', 'streaming', $3, $4, $5, $6, $7, $8, $9, clock_timestamp())
     returning ${RETURNING_MESSAGE}`,
    [conversationId, userId, lineage.replyKind, lineage.replyToMessageId, lineage.continuationOfMessageId ?? null,
      lineage.retryOfMessageId ?? null, settings.provider, settings.model, settings.maxOutputTokens]);
  await q(`update ai_conversations set last_message_at = now(), updated_at = now() where id = $1 and user_id = $2`,
    [conversationId, userId]);
  return toMessage(row);
}

export interface StartedReply {
  userMessage: AiMessage;
  assistantMessage: AiMessage | null;
  /** False when this client id was already used: nothing new was written. */
  created: boolean;
}

/**
 * Saves the admin's message with its attachments, in order, and an empty
 * streaming reply to it, in one transaction.
 *
 * Attachment eligibility: a live file owned by this admin that was uploaded
 * into this conversation, or belongs to the library of this conversation's
 * project. A standalone conversation cannot attach library files.
 */
export async function startReply(userId: string, input: {
  conversationId: unknown; clientId: unknown; content: unknown; fileIds?: unknown;
} & ReplySettings): Promise<StartedReply> {
  if (!isUuid(input.conversationId)) throw notFound("Conversation");
  // Postgres returns ids in lower case; compare like with like.
  const conversationId = input.conversationId.toLowerCase();
  const clientId = v.clientId(input.clientId);
  const content = v.userMessageContent(input.content);
  const fileIds = v.attachmentIds(input.fileIds);
  if (!content.trim() && fileIds.length === 0) throw new ApiError("Write a message or attach a file first");
  const settings = replySettings(input);

  return transaction(async (q) => {
    const [conversation] = await q(
      `select id, project_id, title, title_edited, archived_at from ai_conversations
        where id = $1 and user_id = $2 for update`,
      [conversationId, userId]);
    if (!conversation) throw notFound("Conversation");
    if (conversation.archived_at) throw new ApiError("Restore this conversation to continue it", 409);

    const [existing] = await q(`select ${MESSAGE_COLUMNS} from ai_messages m where m.user_id = $1 and m.client_id = $2`,
      [userId, clientId]);
    if (existing) {
      if (existing.conversation_id !== conversationId) throw new ApiError("That message was already sent elsewhere", 409);
      const [reply] = await q(
        `select ${MESSAGE_COLUMNS} from ai_messages m
          where m.user_id = $1 and m.reply_to_message_id = $2 and m.reply_kind = 'reply'`,
        [userId, existing.id]);
      const attachments = await attachmentsFor(q, userId, [existing.id]);
      return { userMessage: toMessage(existing, attachments.get(existing.id) ?? []), assistantMessage: reply ? toMessage(reply) : null, created: false };
    }

    await assertNoActiveReply(q, userId);

    const files = fileIds.length === 0 ? [] : await q(
      `select id, project_id, conversation_id, original_filename, kind, mime_type, byte_size, deleted_at
         from ai_files where user_id = $1 and id = any($2::uuid[])`,
      [userId, fileIds]);
    const byId = new Map(files.map((f: any) => [f.id, f]));
    const ordered = fileIds.map((id) => {
      const file: any = byId.get(id);
      if (!file) throw notFound("File");
      if (file.deleted_at) throw new ApiError("A file you attached has been removed", 409);
      const eligible = file.conversation_id === conversationId
        || (conversation.project_id !== null && file.project_id === conversation.project_id);
      if (!eligible) throw new ApiError("That file can't be attached to this conversation");
      return file;
    });

    const [user] = await q(
      `insert into ai_messages (conversation_id, user_id, role, content, client_id, created_at)
       values ($1, $2, 'user', $3, $4, clock_timestamp())
       returning ${RETURNING_MESSAGE}`,
      [conversationId, userId, content, clientId]);
    for (const [position, file] of ordered.entries()) {
      await q(`insert into ai_message_files (message_id, file_id, user_id, position) values ($1, $2, $3, $4)`,
        [user.id, file.id, userId, position]);
    }
    const attachments: AiAttachment[] = ordered.map((f: any, position: number) => ({
      fileId: f.id, position, originalFilename: f.original_filename, kind: f.kind, mimeType: f.mime_type,
      byteSize: Number(f.byte_size), removed: false,
    }));

    if (!conversation.title_edited && !conversation.title) {
      const title = v.autoTitle(content, ordered[0]?.original_filename);
      if (title) await q(`update ai_conversations set title = $3 where id = $1 and user_id = $2`, [conversationId, userId, title]);
    }
    const assistantMessage = await insertAssistant(q, userId, conversationId,
      { replyKind: "reply", replyToMessageId: user.id }, settings);
    return { userMessage: toMessage(user, attachments), assistantMessage, created: true };
  });
}

/** The target reply, locked, with every answer to the same user message. */
async function lockedAnswer(q: Q, userId: string, messageId: unknown) {
  if (!isUuid(messageId)) throw notFound("Message");
  const [target] = await q(`select ${MESSAGE_COLUMNS} from ai_messages m where m.id = $1 and m.user_id = $2 for update`,
    [messageId, userId]);
  if (!target || target.role !== "assistant") throw notFound("Message");
  const [conversation] = await q(`select archived_at from ai_conversations where id = $1 and user_id = $2 for update`,
    [target.conversation_id, userId]);
  if (!conversation) throw notFound("Message");
  if (conversation.archived_at) throw new ApiError("Restore this conversation to continue it", 409);
  const answers = (await q(
    `select ${MESSAGE_COLUMNS} from ai_messages m where m.user_id = $1 and m.reply_to_message_id = $2`,
    [userId, target.reply_to_message_id])).map((r: any) => toMessage(r));
  return { target: toMessage(target), chain: visibleChain(answers) };
}

/**
 * Continues a stopped reply, or one that ended at the output limit. The new
 * reply records `continuation_of_message_id`; the provider layer sends the
 * saved partial text followed by a fixed continuation instruction.
 */
export async function startContinuation(userId: string, input: { messageId: unknown } & ReplySettings): Promise<AiMessage> {
  const settings = replySettings(input);
  return transaction(async (q) => {
    await assertNoActiveReply(q, userId);
    const { target, chain } = await lockedAnswer(q, userId, input.messageId);
    if (!canContinue(target, chain)) throw new ApiError("This reply can't be continued", 409);
    return insertAssistant(q, userId, target.conversationId, {
      replyKind: "continuation", replyToMessageId: target.replyToMessageId as string, continuationOfMessageId: target.id,
    }, settings);
  });
}

/** Retries the visible answer to a user message. The new reply records `retry_of_message_id`. */
export async function startRetry(userId: string, input: { messageId: unknown } & ReplySettings): Promise<AiMessage> {
  const settings = replySettings(input);
  return transaction(async (q) => {
    await assertNoActiveReply(q, userId);
    const { target, chain } = await lockedAnswer(q, userId, input.messageId);
    if (!canRetry(target, chain)) throw new ApiError("This reply can't be retried", 409);
    return insertAssistant(q, userId, target.conversationId, {
      replyKind: "retry", replyToMessageId: target.replyToMessageId as string, retryOfMessageId: target.id,
    }, settings);
  });
}

/**
 * What Continue and Retry need to choose a model before anything is written:
 * the model that wrote the reply, and the admin's message it answers.
 */
export async function replyTarget(userId: string, messageId: unknown): Promise<{
  conversationId: string; provider: string | null; model: string | null; userContent: string; attachmentKinds: FileKind[];
} | null> {
  if (!isUuid(messageId)) return null;
  const [row] = await query(
    `select m.conversation_id, m.provider, m.model, u.id as user_message_id, u.content as user_content
       from ai_messages m
       join ai_messages u on u.id = m.reply_to_message_id and u.user_id = m.user_id
      where m.id = $1 and m.user_id = $2 and m.role = 'assistant'`,
    [messageId, userId]);
  if (!row) return null;
  const attachments = await attachmentsFor(query, userId, [row.user_message_id]);
  return {
    conversationId: row.conversation_id, provider: row.provider ?? null, model: row.model ?? null,
    userContent: row.user_content,
    attachmentKinds: (attachments.get(row.user_message_id) ?? []).filter((a) => !a.removed).map((a) => a.kind),
  };
}

/** Saves streamed text so far. Only while the reply is still streaming. */
export async function saveReplyProgress(userId: string, messageId: unknown, content: unknown): Promise<boolean> {
  if (!isUuid(messageId)) return false;
  const text = v.assistantContent(content);
  const rows = await query(
    `update ai_messages set content = $3
      where id = $1 and user_id = $2 and role = 'assistant' and status = 'streaming' returning id`,
    [messageId, userId, text]);
  return rows.length > 0;
}

export type ReplyOutcome =
  | { status: "complete"; content: unknown; stopReason: unknown; inputTokens?: unknown; outputTokens?: unknown;
      cacheReadTokens?: unknown; cacheWriteTokens?: unknown; contextMessages?: unknown; latencyMs?: unknown }
  | { status: "stopped"; content: unknown; latencyMs?: unknown }
  | { status: "failed"; content: unknown; errorCode: unknown; latencyMs?: unknown };

/** Ends a streaming reply as complete, stopped or failed. Returns null if it was not streaming. */
export async function finishReply(userId: string, messageId: unknown, outcome: ReplyOutcome): Promise<AiMessage | null> {
  if (!isUuid(messageId)) return null;
  const content = v.assistantContent(outcome.content);
  const complete = outcome.status === "complete" ? outcome : null;
  const errorCode: MessageErrorCode | null = outcome.status === "failed" ? v.messageErrorCode(outcome.errorCode) : null;
  if (!["complete", "stopped", "failed"].includes(outcome.status)) throw new ApiError("Unknown reply outcome");
  const [row] = await query(
    `update ai_messages
        set status = $3, content = $4, stop_reason = $5, error_code = $6,
            input_tokens = $7, output_tokens = $8, cache_read_tokens = $9, cache_write_tokens = $10,
            context_messages = $11, latency_ms = $12, completed_at = now()
      where id = $1 and user_id = $2 and role = 'assistant' and status = 'streaming'
      returning ${RETURNING_MESSAGE}`,
    [messageId, userId, outcome.status, content,
      complete ? v.stopReason(complete.stopReason) : null, errorCode,
      v.countOrNull(complete?.inputTokens), v.countOrNull(complete?.outputTokens),
      v.countOrNull(complete?.cacheReadTokens), v.countOrNull(complete?.cacheWriteTokens),
      v.countOrNull(complete?.contextMessages), v.countOrNull(outcome.latencyMs)]);
  if (!row) return null;
  const attachments = await attachmentsFor(query, userId, [row.id]);
  return toMessage(row, attachments.get(row.id) ?? []);
}

/** Assistant messages started since a moment, for durable hourly and daily limits. */
export async function countRepliesSince(userId: string, since: Date): Promise<number> {
  const [row] = await query(
    `select count(*)::int as n from ai_messages where user_id = $1 and role = 'assistant' and created_at >= $2`,
    [userId, since.toISOString()]);
  return Number(row?.n ?? 0);
}

// ───────────────────────────── settings ───────────────────────────────────────

const toSettings = (r: any | undefined): WorkspaceSettings => {
  const version = r?.upload_disclosure_version == null ? null : Number(r.upload_disclosure_version);
  return {
    uploadDisclosureVersion: version,
    uploadDisclosureAcceptedAt: isoOrNull(r?.upload_disclosure_accepted_at),
    currentDisclosureVersion: UPLOAD_DISCLOSURE_VERSION,
    hasAcceptedCurrentDisclosure: isCurrentDisclosure(version),
  };
};

export async function getWorkspaceSettings(userId: string): Promise<WorkspaceSettings> {
  const [row] = await query(
    `select upload_disclosure_version, upload_disclosure_accepted_at from ai_workspace_settings where user_id = $1`,
    [userId]);
  return toSettings(row);
}

/** Records acceptance of the disclosure version the admin was shown. Only the current version is accepted. */
export async function acceptUploadDisclosure(userId: string, version: unknown): Promise<WorkspaceSettings> {
  if (version !== UPLOAD_DISCLOSURE_VERSION) {
    throw new ApiError("Please review the current upload notice before accepting it", 409);
  }
  const [row] = await query(
    `insert into ai_workspace_settings (user_id, upload_disclosure_version, upload_disclosure_accepted_at)
     values ($1, $2, now())
     on conflict (user_id) do update
       set upload_disclosure_version = excluded.upload_disclosure_version,
           upload_disclosure_accepted_at = excluded.upload_disclosure_accepted_at,
           updated_at = now()
     returning upload_disclosure_version, upload_disclosure_accepted_at`,
    [userId, version]);
  return toSettings(row);
}

// ─────────────────────────────── files ────────────────────────────────────────

const byteLimitFor = (kind: FileKind) =>
  kind === "pdf" ? aiWorkspace.maxPdfBytes : kind === "image" ? aiWorkspace.maxImageBytes : aiWorkspace.maxTextBytes;
const megabytesLabel = (bytes: number) => `${Math.round((bytes / 1048576) * 10) / 10} MB`;

export async function storageUsage(userId: string, q: Q = query): Promise<StorageUsage> {
  const [row] = await q(
    `select coalesce(sum(byte_size), 0)::bigint as used from ai_files where user_id = $1 and deleted_at is null`,
    [userId]);
  return { usedBytes: Number(row?.used ?? 0), quotaBytes: aiWorkspace.storageQuotaBytes };
}

/**
 * Stores an uploaded file, already type-checked from its bytes by the caller.
 *
 * In one transaction, under a per-admin advisory lock so two uploads cannot both
 * fit the same remaining space: the current disclosure version must be
 * accepted, the destination must be the admin's own and not archived, the
 * per-kind limit and the storage quota must hold. The same bytes uploaded again
 * to the same place return the existing file.
 */
export async function recordUpload(userId: string, input: {
  projectId?: unknown; conversationId?: unknown; originalFilename: unknown;
  kind: unknown; mimeType: unknown; bytes: Uint8Array;
}): Promise<{ file: AiFile; reused: boolean }> {
  const projectId = input.projectId ?? null;
  const conversationId = input.conversationId ?? null;
  if ((projectId === null) === (conversationId === null)) throw new ApiError("Upload into one project or one conversation");
  if (projectId !== null && !isUuid(projectId)) throw notFound("Project");
  if (conversationId !== null && !isUuid(conversationId)) throw notFound("Conversation");
  if (typeof input.kind !== "string" || !(FILE_KINDS as readonly string[]).includes(input.kind)) {
    throw new ApiError("That kind of file isn't supported");
  }
  const kind = input.kind as FileKind;
  if (typeof input.mimeType !== "string" || !MIME_TYPES_BY_KIND[kind].includes(input.mimeType)) {
    throw new ApiError("That kind of file isn't supported");
  }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) throw new ApiError("That file is empty");
  const byteSize = input.bytes.byteLength;
  const limit = byteLimitFor(kind);
  if (byteSize > limit) throw new ApiError(`That file is larger than the ${megabytesLabel(limit)} limit`, 413);
  const originalFilename = v.sanitizeFilename(input.originalFilename);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");

  return transaction(async (q) => {
    const [settings] = await q(`select upload_disclosure_version from ai_workspace_settings where user_id = $1`, [userId]);
    if (!isCurrentDisclosure(settings?.upload_disclosure_version == null ? null : Number(settings.upload_disclosure_version))) {
      throw new ApiError("Review the upload notice before uploading files", 409);
    }
    await q(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`ai_workspace_storage:${userId}`]);

    if (projectId !== null) {
      const [project] = await q(`select archived_at from ai_projects where id = $1 and user_id = $2`, [projectId, userId]);
      if (!project) throw notFound("Project");
      if (project.archived_at) throw new ApiError("Restore this project to add files", 409);
    } else {
      const [conversation] = await q(`select archived_at from ai_conversations where id = $1 and user_id = $2`,
        [conversationId, userId]);
      if (!conversation) throw notFound("Conversation");
      if (conversation.archived_at) throw new ApiError("Restore this conversation to add files", 409);
    }

    const [existing] = await q(
      `select ${FILE_COLUMNS} from ai_files
        where user_id = $1 and sha256 = $2 and deleted_at is null
          and coalesce(project_id, conversation_id) = $3`,
      [userId, sha256, projectId ?? conversationId]);
    if (existing) return { file: toFile(existing), reused: true };

    const usage = await storageUsage(userId, q);
    if (usage.usedBytes + byteSize > usage.quotaBytes) {
      const left = Math.max(0, usage.quotaBytes - usage.usedBytes);
      throw new ApiError(`Not enough storage: ${megabytesLabel(left)} left of ${megabytesLabel(usage.quotaBytes)}`, 413);
    }

    const [row] = await q(
      `insert into ai_files
         (user_id, project_id, conversation_id, original_filename, kind, mime_type, byte_size, sha256, content)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning ${FILE_COLUMNS}`,
      [userId, projectId, conversationId, originalFilename, kind, input.mimeType, byteSize, sha256,
        Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength)]);
    return { file: toFile(row), reused: false };
  });
}

/** The largest picture kept from an image model. A backstop: real ones are a few megabytes at most. */
const GENERATED_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Keeps a picture an image model made for a reply that is still being written,
 * as a file in the reply's conversation, carried by the reply.
 *
 * The same storage as an upload: owner-scoped, counted against the quota under
 * the same per-admin lock, de-duplicated by content, tombstoned when deleted,
 * and removed with its conversation. The upload notice is not involved, because
 * nothing is being sent anywhere; these bytes came back from the provider.
 */
export async function recordGeneratedImage(userId: string, input: {
  messageId: unknown; mimeType: unknown; bytes: Uint8Array; filename: unknown;
}): Promise<AiAttachment> {
  if (!isUuid(input.messageId)) throw notFound("Message");
  const messageId = input.messageId.toLowerCase();
  if (typeof input.mimeType !== "string" || !MIME_TYPES_BY_KIND.image.includes(input.mimeType)) {
    throw new ApiError("That kind of file isn't supported");
  }
  const mimeType = input.mimeType;
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) throw new ApiError("That file is empty");
  const byteSize = input.bytes.byteLength;
  if (byteSize > GENERATED_IMAGE_MAX_BYTES) {
    throw new ApiError(`That file is larger than the ${megabytesLabel(GENERATED_IMAGE_MAX_BYTES)} limit`, 413);
  }
  const originalFilename = v.sanitizeFilename(input.filename);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");

  return transaction(async (q) => {
    await q(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`ai_workspace_storage:${userId}`]);
    const [message] = await q(
      `select id, conversation_id from ai_messages
        where id = $1 and user_id = $2 and role = 'assistant' and status = 'streaming' for update`,
      [messageId, userId]);
    if (!message) throw notFound("Message");

    let [file] = await q(
      `select ${FILE_COLUMNS} from ai_files
        where user_id = $1 and sha256 = $2 and deleted_at is null and conversation_id = $3`,
      [userId, sha256, message.conversation_id]);
    if (!file) {
      const usage = await storageUsage(userId, q);
      if (usage.usedBytes + byteSize > usage.quotaBytes) {
        const left = Math.max(0, usage.quotaBytes - usage.usedBytes);
        throw new ApiError(`Not enough storage: ${megabytesLabel(left)} left of ${megabytesLabel(usage.quotaBytes)}`, 413);
      }
      [file] = await q(
        `insert into ai_files
           (user_id, conversation_id, original_filename, kind, mime_type, byte_size, sha256, content)
         values ($1, $2, $3, 'image', $4, $5, $6, $7)
         returning ${FILE_COLUMNS}`,
        [userId, message.conversation_id, originalFilename, mimeType, byteSize, sha256,
          Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength)]);
    }
    const [{ position }] = await q(
      `select coalesce(max(position) + 1, 0)::int as position from ai_message_files where message_id = $1`, [messageId]);
    await q(
      `insert into ai_message_files (message_id, file_id, user_id, position) values ($1, $2, $3, $4)
       on conflict (message_id, file_id) do nothing`,
      [messageId, file.id, userId, position]);
    return {
      fileId: file.id, position: Number(position), originalFilename: file.original_filename, kind: "image",
      mimeType: file.mime_type, byteSize: Number(file.byte_size), removed: false,
    };
  });
}

export async function listFiles(userId: string, where: { projectId?: unknown; conversationId?: unknown }): Promise<AiFile[]> {
  const projectId = where.projectId ?? null;
  const conversationId = where.conversationId ?? null;
  if ((projectId === null) === (conversationId === null)) return [];
  if (!isUuid(projectId ?? conversationId)) return [];
  const rows = await query(
    `select ${FILE_COLUMNS} from ai_files
      where user_id = $1 and deleted_at is null and coalesce(project_id, conversation_id) = $2
        and ($3::boolean = (project_id is not null))
      order by created_at, id`,
    [userId, projectId ?? conversationId, projectId !== null]);
  return rows.map(toFile);
}

/** A live file with its bytes, for the admin's own download or for a provider upload. */
export async function getFileContent(userId: string, fileId: unknown): Promise<{ file: AiFile; bytes: Uint8Array } | null> {
  if (!isUuid(fileId)) return null;
  const [row] = await query(
    `select ${FILE_COLUMNS}, content from ai_files where id = $1 and user_id = $2 and deleted_at is null`,
    [fileId, userId]);
  if (!row) return null;
  return { file: toFile(row), bytes: new Uint8Array(row.content) };
}

/**
 * Deletes a file by clearing its bytes and keeping its metadata as a tombstone,
 * so messages that carried it show "File removed". Returns uploaded provider
 * copies, for their remote copies to be deleted.
 */
export async function deleteFile(userId: string, fileId: unknown): Promise<{ providerCopies: ProviderCopy[] } | null> {
  if (!isUuid(fileId)) return null;
  return transaction(async (q) => {
    const [row] = await q(`select 1 from ai_files where id = $1 and user_id = $2 and deleted_at is null for update`,
      [fileId, userId]);
    if (!row) return null;
    const providerCopies = await uploadedCopies(q, userId, "f.id = $2", [fileId]);
    await q(`update ai_files set deleted_at = now(), content = null where id = $1 and user_id = $2`, [fileId, userId]);
    return { providerCopies };
  });
}

/**
 * Removes a file uploaded for a message that was never sent. Only a
 * conversation file that no message carries; returns false otherwise, and a
 * library file is never removed this way.
 */
export async function discardUnsentUpload(userId: string, fileId: unknown): Promise<boolean> {
  if (!isUuid(fileId)) return false;
  const rows = await query(
    `delete from ai_files f
      where f.id = $1 and f.user_id = $2 and f.conversation_id is not null
        and not exists (select 1 from ai_message_files mf where mf.file_id = f.id)
      returning f.id`,
    [fileId, userId]);
  return rows.length > 0;
}

// ─────────────────────────── provider copies ──────────────────────────────────

/** Creates the pending copy record for a live file if absent, and returns the record. */
export async function claimProviderCopy(userId: string, fileId: unknown, provider: unknown): Promise<ProviderCopy | null> {
  if (!isUuid(fileId)) return null;
  const providerName = v.providerId(provider);
  return transaction(async (q) => {
    const [file] = await q(`select 1 from ai_files where id = $1 and user_id = $2 and deleted_at is null for update`,
      [fileId, userId]);
    if (!file) return null;
    await q(`insert into ai_file_provider_copies (file_id, provider) values ($1, $2) on conflict (file_id, provider) do nothing`,
      [fileId, providerName]);
    const [row] = await q(`select ${COPY_COLUMNS} from ai_file_provider_copies c where c.file_id = $1 and c.provider = $2`,
      [fileId, providerName]);
    return toCopy(row);
  });
}

async function updateCopy(userId: string, fileId: unknown, provider: unknown, set: string, params: unknown[], liveOnly: boolean): Promise<boolean> {
  if (!isUuid(fileId)) return false;
  const providerName = v.providerId(provider);
  const rows = await query(
    `update ai_file_provider_copies c set ${set}, updated_at = now()
       from ai_files f
      where c.file_id = f.id and f.user_id = $1 and c.file_id = $2 and c.provider = $3
        ${liveOnly ? "and f.deleted_at is null" : ""}
      returning c.file_id`,
    [userId, fileId, providerName, ...params]);
  return rows.length > 0;
}

export async function markProviderCopyUploaded(userId: string, fileId: unknown, provider: unknown, providerFileId: unknown): Promise<boolean> {
  if (typeof providerFileId !== "string" || providerFileId.length < 1 || providerFileId.length > 200) {
    throw new ApiError("Invalid provider file reference");
  }
  return updateCopy(userId, fileId, provider,
    "status = 'uploaded', provider_file_id = $4, uploaded_at = now(), failure_code = null", [providerFileId], true);
}

export async function markProviderCopyFailed(userId: string, fileId: unknown, provider: unknown, code: unknown): Promise<boolean> {
  return updateCopy(userId, fileId, provider, "status = 'failed', failure_code = $4", [v.failureCode(code)], false);
}

export async function markProviderCopyDeleted(userId: string, fileId: unknown, provider: unknown): Promise<boolean> {
  return updateCopy(userId, fileId, provider, "status = 'deleted', deleted_at = now()", [], false);
}
