import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ApiError, withUser } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import {
  AttachmentRefused, PRIORITY_ATTACHMENT_LIMITS, addPriorityAttachment,
  deletePriorityAttachment, listPriorityAttachments, readPriorityAttachment,
} from "@/lib/db/queries";
import { getDict } from "@/lib/i18n/server";
import { isUuid } from "@/lib/http";
import { sanitizeFilename } from "@/lib/aiWorkspace/validate";
import { detectFileType } from "@/lib/aiWorkspaceRuntime/fileType";

/**
 * Files on a priority. Private user content behind the session, like the
 * priority itself: every operation answers only for the caller's own rows,
 * and anyone else's attachment id simply does not exist. There is no public
 * or signed URL anywhere — the bytes leave the database only through the GET
 * below, which checks the session first.
 *
 * The stored type is decided from the bytes (the AI Workspace's detector) and
 * is what the download serves, with `nosniff`, so nothing a browser executes
 * can be smuggled through a renamed file. Images and PDFs render inline —
 * that is what previewing an attachment is — text downloads as a file.
 */

/** Room for the multipart envelope around the largest file allowed. */
const ENVELOPE_BYTES = 64 * 1024;
const megabytes = (bytes: number) => `${Math.round((bytes / 1048576) * 10) / 10} MB`;

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const t = getDict();
    const max = PRIORITY_ATTACHMENT_LIMITS.maxBytes;
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > max + ENVELOPE_BYTES) {
      throw new ApiError(t.priorities.details.fileTooLarge(megabytes(max)), 413);
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const priorityId = form?.get("priorityId");
    if (!form || !file || typeof file === "string") throw new ApiError("Malformed request body");
    if (typeof priorityId !== "string" || !isUuid(priorityId)) throw new ApiError("Malformed request body");
    if (file.size > max) throw new ApiError(t.priorities.details.fileTooLarge(megabytes(max)), 413);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) throw new ApiError(t.priorities.details.fileEmpty);
    const detected = detectFileType(bytes);
    if (!detected) throw new ApiError(t.priorities.details.fileUnsupported, 415);

    try {
      const attachment = await addPriorityAttachment(userId, priorityId, {
        originalFilename: sanitizeFilename((file as File).name) || "attachment",
        kind: detected.kind,
        mimeType: detected.mimeType,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes,
      });
      return { attachment };
    } catch (e) {
      if (e instanceof AttachmentRefused) {
        throw new ApiError(e.reason === "tooMany"
          ? t.priorities.details.tooManyFiles(PRIORITY_ATTACHMENT_LIMITS.maxPerPriority)
          : t.priorities.details.storageFull(megabytes(PRIORITY_ATTACHMENT_LIMITS.maxTotalBytes)), 409);
      }
      throw e;
    }
  });
}

/**
 * `?priorityId=` lists metadata; `?id=` serves one file's bytes. The byte
 * response bypasses `withUser`'s JSON wrapping but uses the same session
 * check; a missing session, someone else's id and a deleted id all answer
 * alike, with nothing in the body worth probing for.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const id = q.get("id");

  if (!id) {
    return withUser(async (userId) => {
      const priorityId = q.get("priorityId");
      if (!priorityId || !isUuid(priorityId)) throw new ApiError("Malformed request");
      return { attachments: await listPriorityAttachments(userId, priorityId) };
    }, (d) => d.errors.loadFailedTitle);
  }

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: getDict().errors.notSignedIn }, { status: 401 });
  if (!isUuid(id)) return new NextResponse(null, { status: 404 });
  const file = await readPriorityAttachment(user.id, id);
  if (!file) return new NextResponse(null, { status: 404 });

  // ASCII fallback plus RFC 5987 for the real name, so any filename survives.
  const ascii = file.originalFilename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const disposition = file.kind === "text" ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.byteSize),
      "Content-Disposition":
        `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.originalFilename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}

export async function DELETE(request: Request) {
  return withUser(async (userId) => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !isUuid(id)) throw new ApiError("Malformed request");
    if (!await deletePriorityAttachment(userId, id)) throw new ApiError("Not found", 404);
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
