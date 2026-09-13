import { acceptUploadDisclosure } from "@/lib/aiWorkspace/queries";
import { readJson, workspaceJson } from "@/lib/aiWorkspaceRuntime/http";

/** Records that the admin accepted the upload notice version they were shown. */
export async function POST(request: Request) {
  return workspaceJson(async (admin) => {
    const b = await readJson(request);
    return { settings: await acceptUploadDisclosure(admin.id, b.version) };
  });
}

export const dynamic = "force-dynamic";
