import { NextResponse } from "next/server";
import { currentAdmin, type AdminUser } from "@/lib/admin";
import { ApiError } from "@/lib/http";
import type { Dict } from "@/lib/i18n";
import { getDict } from "@/lib/i18n/server";

/**
 * Route plumbing for the AI Workspace API.
 *
 * Every workspace route starts with `currentAdmin()`, which re-reads
 * `users.role` from the database, and answers 404 to anyone who is not an
 * admin — signed out, an ordinary account, or a disabled one — exactly like the
 * rest of /api/admin. The admin id then scopes every data-layer call.
 *
 * Nothing here logs what anyone wrote. Unexpected errors are logged as a name
 * and a code only: a database error can quote the row it refused, and rows here
 * hold prompts, replies, instructions and files.
 */

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** A refusal whose message is already in the reader's language. */
export class WorkspaceRefusal extends ApiError {}

export const notFoundResponse = () =>
  NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

export function logUnexpected(where: string, e: unknown) {
  const name = e instanceof Error ? e.name : typeof e;
  const code = (e as { code?: unknown } | null)?.code;
  console.error(`[ai-workspace] ${where} failed (${name}${typeof code === "string" ? ` ${code}` : ""})`);
}

/**
 * The data layer's refusals are written in English for developers; the admin
 * reads them in their own language. Anything not recognised becomes the generic
 * message rather than leaking an internal sentence.
 */
export function localiseError(message: string, t: Dict): string {
  const e = t.aiWorkspace.errors;
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^Restore this conversation/, () => e.restoreConversation],
    [/^Restore this project/, () => e.restoreProject],
    [/^A reply is still being written/, () => e.busy],
    [/already sent elsewhere/, () => e.duplicateSend],
    [/^A file you attached has been removed/, () => e.fileRemoved],
    [/can't be attached to this conversation/, () => e.fileNotEligible],
    [/^Write a message or attach a file first/, () => e.emptyMessage],
    [/^Attach up to (\d+) files/, (m) => e.tooManyFiles(Number(m[1]))],
    [/^The same file is attached twice/, () => e.duplicateAttachment],
    [/^That message is too long/, () => e.messageTooLong],
    [/^Not enough storage: (.+) left of (.+)$/, (m) => e.storageFull(m[1], m[2])],
    [/^That file is larger than the (.+) limit$/, (m) => e.fileTooLarge(m[1])],
    [/^That file is empty/, () => e.fileEmpty],
    [/^That kind of file isn't supported/, () => e.unsupportedFile],
    [/upload notice/, () => e.disclosureRequired],
    [/^Type the project's name/, () => e.confirmName],
    [/^(Conversation|Project|File|Message) not found$/, () => e.notFound],
    [/can't be continued/, () => e.cannotContinue],
    [/can't be retried/, () => e.cannotRetry],
    [/^Give the project a name/, () => e.projectNameRequired],
    [/^That project name is too long/, () => e.projectNameTooLong],
    [/^Those instructions are too long/, () => e.instructionsTooLong],
    [/^Give the conversation a title/, () => e.titleRequired],
    [/^That title is too long/, () => e.titleTooLong],
  ];
  for (const [pattern, render] of rules) {
    const match = message.match(pattern);
    if (match) return render(match);
  }
  return e.generic;
}

export function errorResponse(e: unknown, t: Dict): NextResponse {
  if (e instanceof WorkspaceRefusal) {
    return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
  }
  if (e instanceof ApiError) {
    return NextResponse.json({ error: localiseError(e.message, t) }, { status: e.status, headers: NO_STORE });
  }
  logUnexpected("request", e);
  return NextResponse.json({ error: t.aiWorkspace.errors.generic }, { status: 500, headers: NO_STORE });
}

/** The signed-in admin, or null. A database failure is not an admin. */
export async function workspaceAdmin(): Promise<AdminUser | null> {
  try {
    return await currentAdmin();
  } catch (e) {
    logUnexpected("admin check", e);
    return null;
  }
}

export async function workspaceJson(
  fn: (admin: AdminUser, t: Dict) => Promise<unknown>,
): Promise<NextResponse> {
  const admin = await workspaceAdmin();
  if (!admin) return notFoundResponse();
  const t = getDict();
  try {
    return NextResponse.json((await fn(admin, t)) ?? { ok: true }, { headers: NO_STORE });
  } catch (e) {
    return errorResponse(e, t);
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const parsed = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ApiError("Malformed request body");
  return parsed as Record<string, unknown>;
}

/**
 * A newline-delimited JSON stream. The generation is tied to `controller`:
 * the browser going away, or Stop from anywhere, aborts it, and the reply is
 * then saved as stopped by the caller.
 */
export function ndjsonResponse(
  request: Request,
  controller: AbortController,
  run: (send: (event: object) => void, signal: AbortSignal) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const onDisconnect = () => controller.abort();
  request.signal?.addEventListener("abort", onDisconnect);
  let open = true;

  const stream = new ReadableStream<Uint8Array>({
    start(sink) {
      const send = (event: object) => {
        if (!open) return;
        try {
          sink.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      run(send, controller.signal)
        .catch((e) => logUnexpected("stream", e))
        .finally(() => {
          request.signal?.removeEventListener("abort", onDisconnect);
          if (open) {
            open = false;
            try { sink.close(); } catch { /* already closed by the client */ }
          }
        });
    },
    cancel() {
      open = false;
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
