import * as ai from "@/lib/aiWorkspace/queries";
import { deleteRemoteCopies } from "@/lib/aiWorkspaceRuntime/copies";
import { notFoundResponse, workspaceAdmin, workspaceJson } from "@/lib/aiWorkspaceRuntime/http";
import { ApiError } from "@/lib/http";

type Params = { params: { id: string } };

/**
 * The admin's own file, for a preview or a download.
 *
 * Images are shown inline; PDFs and text download. The response is sandboxed
 * and never sniffed, so a stored file cannot run as a page on RichHabit's origin.
 */
export async function GET(_request: Request, { params }: Params) {
  const admin = await workspaceAdmin();
  if (!admin) return notFoundResponse();
  const stored = await ai.getFileContent(admin.id, params.id).catch(() => null);
  if (!stored) return notFoundResponse();

  const inline = stored.file.kind === "image";
  const name = encodeURIComponent(stored.file.originalFilename);
  return new Response(Buffer.from(stored.bytes), {
    headers: {
      "Content-Type": stored.file.mimeType,
      "Content-Length": String(stored.bytes.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Deletes a file. Its bytes are cleared and its name kept, so messages that
 * carried it show "File removed". `?discard=1` instead removes a file uploaded
 * for a message that was never sent.
 */
export async function DELETE(request: Request, { params }: Params) {
  return workspaceJson(async (admin) => {
    if (new URL(request.url).searchParams.get("discard") === "1") {
      return { discarded: await ai.discardUnsentUpload(admin.id, params.id) };
    }
    const result = await ai.deleteFile(admin.id, params.id);
    if (!result) throw new ApiError("File not found", 404);
    await deleteRemoteCopies(admin.id, result.providerCopies, { markDeleted: true });
    return { deleted: true, storage: await ai.storageUsage(admin.id) };
  });
}

export const dynamic = "force-dynamic";
