import * as ai from "@/lib/aiWorkspace/queries";
import { ApiError, isUuid } from "@/lib/http";
import { readJson, workspaceJson } from "@/lib/aiWorkspaceRuntime/http";
import { stopRunningReply } from "@/lib/aiWorkspaceRuntime/limits";

type Params = { params: { id: string } };

/**
 * Stops a reply. When this process is writing it, the request is aborted and
 * the writer saves what it has as stopped. When nothing is writing it — the tab
 * that started it is gone and the server restarted — it is ended here with the
 * text already saved.
 */
export async function POST(request: Request, { params }: Params) {
  return workspaceJson(async (admin) => {
    const b = await readJson(request);
    if (!isUuid(params.id) || !isUuid(b.conversationId)) throw new ApiError("Message not found", 404);
    const messageId = params.id.toLowerCase();
    if (stopRunningReply(admin.id, messageId)) return { stopping: true };

    const messages = await ai.listMessages(admin.id, b.conversationId, { limit: 200 });
    const message = messages?.find((m) => m.id === messageId);
    if (!message || message.role !== "assistant") throw new ApiError("Message not found", 404);
    if (message.status !== "streaming") return { stopping: false, message };
    const stopped = await ai.finishReply(admin.id, messageId, { status: "stopped", content: message.content });
    return { stopping: false, message: stopped ?? message };
  });
}

export const dynamic = "force-dynamic";
