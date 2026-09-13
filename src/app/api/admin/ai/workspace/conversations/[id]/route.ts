import * as ai from "@/lib/aiWorkspace/queries";
import { ApiError } from "@/lib/http";
import { deleteRemoteCopies } from "@/lib/aiWorkspaceRuntime/copies";
import { readJson, workspaceJson } from "@/lib/aiWorkspaceRuntime/http";
import { conversationView } from "@/lib/aiWorkspaceRuntime/view";

type Params = { params: { id: string } };
const notFound = () => new ApiError("Conversation not found", 404);

export async function GET(request: Request, { params }: Params) {
  return workspaceJson(async (admin) => {
    const before = new URL(request.url).searchParams.get("before");
    const view = await conversationView(admin.id, params.id, before);
    if (!view) throw notFound();
    return view;
  });
}

/** Rename, archive or restore. */
export async function PATCH(request: Request, { params }: Params) {
  return workspaceJson(async (admin) => {
    const b = await readJson(request);
    let conversation = await ai.getConversation(admin.id, params.id);
    if (!conversation) throw notFound();
    if (b.title !== undefined) conversation = await ai.renameConversation(admin.id, params.id, b.title);
    if (typeof b.archived === "boolean") {
      conversation = await ai.setConversationArchived(admin.id, params.id, b.archived);
    }
    if (!conversation) throw notFound();
    return { conversation };
  });
}

/** Permanent: its messages and the files uploaded into it. Project files stay. */
export async function DELETE(_request: Request, { params }: Params) {
  return workspaceJson(async (admin) => {
    const result = await ai.deleteConversation(admin.id, params.id);
    if (!result) throw notFound();
    await deleteRemoteCopies(admin.id, result.providerCopies);
    return { deleted: true };
  });
}

export const dynamic = "force-dynamic";
