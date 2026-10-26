import { TABLES, ident } from './postgres.ts';
export type ScopeEntry = { table: string; column: string; values: string[]; ownershipEvidence: string };
export type ImportScope = { project: 'writer-studio'; sourceIdentity: string; targetIdentity: string; entries: ScopeEntry[] };
export const OWNERSHIP_COLUMNS: Record<string, string[]> = {
  kv_store: ['key'], content_plans: ['id'], content_plan_sources: ['content_plan_id'],
  content_plan_items: ['content_plan_id'], writer_articles: ['id'], writer_ai_usage: ['id', 'article_id'],
  article_stage_runs: ['article_id'], batch_jobs: ['id'], batch_job_items: ['batch_job_id'],
  article_specs: ['article_id'], knowledge_items: ['id'], website_content_inventory: ['id'],
  quality_gate_runs: ['article_id'], editorial_approvals: ['article_id'],
  agent_library_versions: ['project_id'], agent_library_documents: ['project_id'], agent_library_chunks: ['project_id'],
};
export function validateScope(value: unknown): ImportScope {
  const scope = value as ImportScope;
  if (scope?.project !== 'writer-studio' || !scope.sourceIdentity || !scope.targetIdentity || scope.sourceIdentity === scope.targetIdentity || !Array.isArray(scope.entries) || !scope.entries.length) throw new Error('A reviewed Writer Studio ownership manifest with distinct source/target identities is required');
  const seen = new Set<string>();
  for (const entry of scope.entries) {
    if (!(TABLES as readonly string[]).includes(entry.table) || seen.has(entry.table) || !OWNERSHIP_COLUMNS[entry.table]?.includes(entry.column)) throw new Error('Invalid or repeated table/ownership column');
    seen.add(entry.table); ident(entry.column);
    if (!entry.ownershipEvidence?.trim() || !Array.isArray(entry.values) || !entry.values.length || entry.values.some(v => typeof v !== 'string' || !v) || new Set(entry.values).size !== entry.values.length) throw new Error('Explicit unique IDs/keys and ownership evidence required for every table');
    if (entry.table.startsWith('agent_library_') && entry.values.some(v => v !== 'writer-studio')) throw new Error('Only Writer Studio library records can be imported');
    if (entry.table === 'kv_store' && entry.values.some(v => !v.startsWith('writer:'))) throw new Error('Only explicitly reviewed writer: keys are eligible; prefix alone does not establish ownership');
  }
  return scope;
}
