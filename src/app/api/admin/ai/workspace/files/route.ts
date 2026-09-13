import * as ai from "@/lib/aiWorkspace/queries";
import { ApiError } from "@/lib/http";
import { detectFileType } from "@/lib/aiWorkspaceRuntime/fileType";
import { WorkspaceRefusal, workspaceJson } from "@/lib/aiWorkspaceRuntime/http";
import { aiWorkspace } from "@/lib/env";

/** Room for the multipart envelope around the largest file allowed. */
const ENVELOPE_BYTES = 64 * 1024;
const megabytes = (bytes: number) => `${Math.round((bytes / 1048576) * 10) / 10} MB`;

export async function GET(request: Request) {
  return workspaceJson(async (admin) => {
    const q = new URL(request.url).searchParams;
    return {
      files: await ai.listFiles(admin.id, {
        projectId: q.get("projectId") ?? undefined, conversationId: q.get("conversationId") ?? undefined,
      }),
    };
  });
}

/**
 * One file into a project library or a conversation.
 *
 * The type is decided from the bytes here; what the browser says a file is does
 * not count. The data layer then enforces the current upload notice, ownership,
 * archive state, the per-type limit, the storage quota (under the per-admin
 * lock) and de-duplication.
 */
export async function POST(request: Request) {
  return workspaceJson(async (admin, t) => {
    const largest = Math.max(aiWorkspace.maxPdfBytes, aiWorkspace.maxImageBytes, aiWorkspace.maxTextBytes);
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > largest + ENVELOPE_BYTES) {
      throw new WorkspaceRefusal(t.aiWorkspace.errors.fileTooLarge(megabytes(largest)), 413);
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !file || typeof file === "string") throw new ApiError("Malformed request body");
    if (file.size > largest) throw new WorkspaceRefusal(t.aiWorkspace.errors.fileTooLarge(megabytes(largest)), 413);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) throw new ApiError("That file is empty");
    const detected = detectFileType(bytes);
    if (!detected) throw new WorkspaceRefusal(t.aiWorkspace.errors.unsupportedFile, 415);

    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" && value ? value : null;
    };
    const { file: stored, reused } = await ai.recordUpload(admin.id, {
      projectId: field("projectId"),
      conversationId: field("conversationId"),
      originalFilename: (file as File).name,
      kind: detected.kind,
      mimeType: detected.mimeType,
      bytes,
    });
    return { file: stored, reused, storage: await ai.storageUsage(admin.id) };
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
