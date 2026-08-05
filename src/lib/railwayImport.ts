import type { ActionDataSource, DocumentFile, FileCategory } from '../types';

interface ImportResponse {
  target: 'writer:files' | 'writer:config.actionSources';
  record: ActionDataSource | DocumentFile;
}

export async function importSourceThroughRailway(
  source: Partial<ActionDataSource> & Pick<ActionDataSource, 'sourceType'>,
  category: FileCategory,
  railwayUrl: string,
): Promise<ImportResponse> {
  const baseUrl = railwayUrl.trim().replace(/\/$/, '') || window.location.origin;
  const response = await fetch(`${baseUrl}/api/import/source`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...source, category }),
  });
  const payload = await response.json().catch(() => ({ error: response.statusText }));
  if (!response.ok) throw new Error(payload.error || `Railway import error ${response.status}`);
  return payload as ImportResponse;
}
