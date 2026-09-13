import * as ai from "@/lib/aiWorkspace/queries";
import { replyResponse } from "@/lib/aiWorkspaceRuntime/reply";
import { aiWorkspace } from "@/lib/env";
import { ApiError } from "@/lib/http";

type Params = { params: { id: string } };

/** Continues a stopped reply, or one that reached the length limit. Streams NDJSON. */
export async function POST(request: Request, { params }: Params) {
  return replyResponse(request, async (admin, provider) => {
    const assistant = await ai.startContinuation(admin.id, {
      messageId: params.id, provider: provider.id,
      model: aiWorkspace.model, maxOutputTokens: aiWorkspace.maxOutputTokens,
    });
    const conversation = await ai.getConversation(admin.id, assistant.conversationId);
    if (!conversation) throw new ApiError("Message not found", 404);
    return { conversation, userMessage: null, assistant, mode: { kind: "continue", targetMessageId: params.id.toLowerCase() } };
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
