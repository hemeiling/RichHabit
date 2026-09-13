import * as ai from "@/lib/aiWorkspace/queries";
import { ApiError } from "@/lib/http";
import { deleteRemoteCopies } from "@/lib/aiWorkspaceRuntime/copies";
import { readJson, workspaceJson } from "@/lib/aiWorkspaceRuntime/http";

type Params = { params: { id: string } };
const notFound = () => new ApiError("Project not found", 404);

export async function GET(_request: Request, { params }: Params) {
  return workspaceJson(async (admin) => {
    const project = await ai.getProject(admin.id, params.id);
    if (!project) throw notFound();
    const [summary, conversations, archivedConversations, files] = await Promise.all([
      ai.projectDeletionSummary(admin.id, params.id),
      ai.listConversations(admin.id, { projectId: params.id, limit: 100 }),
      ai.listConversations(admin.id, { projectId: params.id, archived: true, limit: 100 }),
      ai.listFiles(admin.id, { projectId: params.id }),
    ]);
    return { project, summary, conversations, archivedConversations, files };
  });
}

/** Rename, edit instructions, archive or restore. */
export async function PATCH(request: Request, { params }: Params) {
  return workspaceJson(async (admin) => {
    const b = await readJson(request);
    let project = await ai.getProject(admin.id, params.id);
    if (!project) throw notFound();
    if (b.name !== undefined || b.instructions !== undefined) {
      project = await ai.updateProject(admin.id, params.id, { name: b.name, instructions: b.instructions });
    }
    if (typeof b.archived === "boolean") project = await ai.setProjectArchived(admin.id, params.id, b.archived);
    if (!project) throw notFound();
    return { project };
  });
}

/** Permanent. Requires the project's exact name. */
export async function DELETE(request: Request, { params }: Params) {
  return workspaceJson(async (admin) => {
    const b = await readJson(request);
    const result = await ai.deleteProjectPermanently(admin.id, params.id, b.confirmName);
    if (!result) throw notFound();
    await deleteRemoteCopies(admin.id, result.providerCopies);
    return { deleted: true, conversations: result.conversations, files: result.files };
  });
}

export const dynamic = "force-dynamic";
