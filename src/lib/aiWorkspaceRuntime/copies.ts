import { markProviderCopyDeleted } from "@/lib/aiWorkspace/queries";
import type { ProviderCopy } from "@/lib/aiWorkspace/types";
import { ProviderFailure, chatProvider, type WorkspaceProvider } from "./provider";

/**
 * Removes the provider's copies of deleted files.
 *
 * The data layer has already deleted (or tombstoned) the files and returns the
 * copies that had been uploaded. Each copy is deleted through the provider that
 * holds it. Deleting them remotely is best effort: a failure is logged as a code
 * and never undoes the admin's delete. When the file row still exists as a
 * tombstone, its copy is marked deleted too.
 */
export async function deleteRemoteCopies(userId: string, copies: ProviderCopy[], { markDeleted = false } = {}) {
  if (copies.length === 0) return;
  const providers = new Map<string, WorkspaceProvider | null>();
  for (const copy of copies) {
    if (!copy.providerFileId) continue;
    if (!providers.has(copy.provider)) providers.set(copy.provider, await chatProvider(copy.provider));
    const provider = providers.get(copy.provider);
    if (!provider?.deleteFile) continue;
    try {
      await provider.deleteFile(copy.providerFileId);
      if (markDeleted) await markProviderCopyDeleted(userId, copy.fileId, copy.provider);
    } catch (e) {
      const code = e instanceof ProviderFailure ? e.code : "provider_error";
      console.error(`[ai-workspace] provider copy delete failed (${code})`);
    }
  }
}
