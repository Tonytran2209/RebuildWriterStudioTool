/**
 * Removing Storage documents from the library (no I/O). A deleted file also leaves every gate's
 * Shipper access, and a primary Playbook that pointed at it is cleared.
 */
type LibraryFile = { id: string; storagePath?: string | null; category?: string };

export const MAX_FILES_PER_DELETE = 200;

export function removeFilesFromLibrary<F extends LibraryFile>(files: F[], config: Record<string, any>, ids: string[]) {
  const wanted = new Set(ids);
  const removed = files.filter(file => wanted.has(file.id));
  const gone = new Set(removed.map(file => file.id));
  const stepConfigs = Object.fromEntries(Object.entries(config?.stepConfigs ?? {}).map(([step, stepConfig]: [string, any]) => {
    if (!stepConfig) return [step, stepConfig];
    const next = { ...stepConfig };
    if (stepConfig.fileAccess) next.fileAccess = { ...stepConfig.fileAccess, kb: (stepConfig.fileAccess.kb ?? []).filter((id: string) => !gone.has(id)), rules: (stepConfig.fileAccess.rules ?? []).filter((id: string) => !gone.has(id)) };
    if (gone.has(stepConfig.primaryPlaybookId)) delete next.primaryPlaybookId;
    return [step, next];
  }));
  return {
    files: files.filter(file => !gone.has(file.id)),
    config: { ...config, stepConfigs, revision: Number(config?.revision ?? 0) + 1 },
    removed,
    missing: ids.filter(id => !gone.has(id)),
  };
}
