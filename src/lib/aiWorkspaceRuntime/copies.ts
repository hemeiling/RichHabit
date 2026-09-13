import { markProviderCopyDeleted } from "@/lib/aiWorkspace/queries";
import type { ProviderCopy } from "@/lib/aiWorkspace/types";
import { ProviderFailure, workspaceProvider } from "./provider";

/**
 * Removes the provider's copies of deleted files.
 *
 * The data layer has already deleted (or tombstoned) the files and returns the
 * copies that had been uploaded. Deleting them remotely is best effort: a
 * failure is logged as a code and never undoes the admin's delete. When the
 * file row still exists as a tombstone, its copy is marked deleted too.
 */
export async function deleteRemoteCopies(userId: string, copies: ProviderCopy[], { markDeleted = false } = {}) {
  if (copies.length === 0) return;
  const provider = await workspaceProvider();
  if (!provider) return;
  for (const copy of copies) {
    if (copy.provider !== provider.id || !copy.providerFileId) continue;
    try {
      await provider.deleteFile(copy.providerFileId);
      if (markDeleted) await markProviderCopyDeleted(userId, copy.fileId, copy.provider);
    } catch (e) {
      const code = e instanceof ProviderFailure ? e.code : "provider_error";
      console.error(`[ai-workspace] provider copy delete failed (${code})`);
    }
  }
}
