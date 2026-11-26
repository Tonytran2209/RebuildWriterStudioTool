/**
 * One-time move to Gate documents v2 (.agent-hub/backend/gate-documents-v2.md §8). Runs at startup and
 * never deletes anything: Voice & Style files become Standards, vocabulary KB files become Brand context,
 * and the numbers v1 read from front matter / old Settings are written into config.gateSettings.
 */
import { legacyGateNumbers } from '../shared/gateSettings.ts';

export const GATE_DOCUMENTS_VERSION = 2;

type File = { id: string; name: string; category?: string; storageGroup?: string; content?: string; knowledgeMetadata?: Record<string, any> };

/** v1 guessed a Rules file without a saved group as Voice & Style from these name words (Standards words won first). */
const v1GuessedVoice = (file: File) => !file.storageGroup && /tone|voice|style|giọng/.test(file.name.toLowerCase()) && !/checklist|standard|link|upload|quy tắc/.test(file.name.toLowerCase());

export function migrateGateDocuments(files: File[], config: Record<string, any>) {
  if (Number(config?.gateDocumentsVersion ?? 0) >= GATE_DOCUMENTS_VERSION) return null;
  // Numbers are read before files change, with v1's own rules.
  const numbers = legacyGateNumbers(files, config);
  const changedFiles: File[] = [];
  const nextFiles = files.map(file => {
    if (file.category === 'rules' && (file.storageGroup === 'Voice & Style' || v1GuessedVoice(file))) {
      const next = { ...file, storageGroup: 'Standards' };
      changedFiles.push(next);
      return next;
    }
    if (file.category === 'kb' && /vocab/i.test(file.name) && !file.knowledgeMetadata) {
      const next = { ...file, knowledgeMetadata: { type: 'brand_voice', topics: [], visibility: 'internal', approvedForExternalUse: false } };
      changedFiles.push(next);
      return next;
    }
    return file;
  });
  // Values an admin already saved in gateSettings win over migrated ones.
  const nextConfig = { ...config, gateSettings: { ...numbers, ...(config?.gateSettings ?? {}) }, gateDocumentsVersion: GATE_DOCUMENTS_VERSION };
  return { files: nextFiles, config: nextConfig, changedFiles, numbers };
}

export async function runGateDocumentsMigration(deps: {
  kvGet: <T>(key: string) => Promise<T | null>;
  kvSet: (key: string, value: unknown) => Promise<unknown>;
  withLock: <T>(job: () => Promise<T>) => Promise<T>;
  onKnowledgeMetadata?: (file: File) => Promise<unknown>;
}) {
  return deps.withLock(async () => {
    const [config, files] = await Promise.all([deps.kvGet<Record<string, any>>('writer:config'), deps.kvGet<File[]>('writer:files')]);
    if (!config) return null;
    const result = migrateGateDocuments(Array.isArray(files) ? files : [], config);
    if (!result) return null;
    if (result.changedFiles.length) await deps.kvSet('writer:files', result.files);
    await deps.kvSet('writer:config', { ...result.config, revision: Number(config.revision ?? 0) + 1 });
    for (const file of result.changedFiles) if (file.category === 'kb') await deps.onKnowledgeMetadata?.(file);
    return result;
  });
}
