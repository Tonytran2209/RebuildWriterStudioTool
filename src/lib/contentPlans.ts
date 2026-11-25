import type { ContentPlan, ContentPlanSourceType } from '../types';
import type { ContentPlanSettings } from '../../shared/contentPlanSettings';
import { authenticatedRailwayFetch } from './db';

async function parse(response: Response) { const payload = await response.json().catch(() => ({ error: response.statusText })); if (!response.ok) throw new Error(payload.error || `Content Plan error ${response.status}`); return payload; }

function contentPlanRequest(path: string, railwayUrl: string, init?: RequestInit): Promise<Response> {
  return authenticatedRailwayFetch(path, init, railwayUrl);
}

/** `classify: true` asks the server to classify right after import, in the background (the plan comes back as `processing`). */
export async function importContentPlan(input: { name: string; sourceType: ContentPlanSourceType; content?: string; url?: string; file?: File; previousVersionId?: string; classify?: boolean }, railwayUrl: string): Promise<ContentPlan> {
  if (input.file) {
    const body = new FormData(); body.append('file', input.file); body.append('name', input.name); body.append('sourceType', 'file'); if (input.previousVersionId) body.append('previousVersionId', input.previousVersionId); if (input.classify) body.append('classify', '1');
    return (await parse(await contentPlanRequest('/api/content-plans/import', railwayUrl, { method: 'POST', body }))).plan;
  }
  return (await parse(await contentPlanRequest('/api/content-plans/import', railwayUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }))).plan;
}

export async function classifyContentPlan(id: string, railwayUrl: string, force = false): Promise<ContentPlan> {
  return (await parse(await contentPlanRequest(`/api/content-plans/${encodeURIComponent(id)}/${force ? 'reclassify' : 'classify'}`, railwayUrl, { method: 'POST' }))).plan;
}

/** Start classification on the server in the background; the plan comes back as `processing`. */
export async function startContentPlanClassification(id: string, railwayUrl: string, force = false): Promise<ContentPlan> {
  return (await parse(await contentPlanRequest(`/api/content-plans/${encodeURIComponent(id)}/${force ? 'reclassify' : 'classify'}?background=1`, railwayUrl, { method: 'POST' }))).plan;
}

export async function fetchContentPlan(id: string, railwayUrl: string): Promise<ContentPlan> {
  return (await parse(await contentPlanRequest(`/api/content-plans/${encodeURIComponent(id)}`, railwayUrl))).plan;
}

export async function fetchContentPlans(railwayUrl: string): Promise<ContentPlan[]> {
  return parse(await contentPlanRequest('/api/content-plans', railwayUrl));
}

export async function deleteContentPlan(id: string, railwayUrl: string): Promise<void> {
  await parse(await contentPlanRequest(`/api/content-plans/${encodeURIComponent(id)}`, railwayUrl, { method: 'DELETE' }));
}

export async function updateContentPlanItem(planId: string, itemId: string, type: 'comparison-seo' | 'editorial-originality' | 'needs-review', railwayUrl: string): Promise<ContentPlan> {
  return (await parse(await contentPlanRequest(`/api/content-plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}`, railwayUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) }))).plan;
}

export async function updateContentPlanStatus(planId: string, status: 'active' | 'archived', railwayUrl: string): Promise<ContentPlan> {
  return (await parse(await contentPlanRequest(`/api/content-plans/${encodeURIComponent(planId)}/status`, railwayUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }))).plan;
}

export type GroupCounts = { total: number; comparison: number; editorial: number; review: number };
export type RulesPreview = { before: GroupCounts; after: GroupCounts; changed: { id: string; title: string; from: string; to: string }[]; added: string[]; removed: string[] };

/** What the draft classification settings would change on a plan, from its saved AI picks (no AI call, nothing saved). */
export async function previewPlanRules(planId: string, settings: ContentPlanSettings, railwayUrl: string): Promise<RulesPreview> {
  return (await parse(await contentPlanRequest(`/api/content-plans/${encodeURIComponent(planId)}/reapply`, railwayUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: true, settings }) }))).preview;
}

/** Apply the saved classification settings to a plan again, without AI. */
export async function reapplyPlanRules(planId: string, railwayUrl: string): Promise<ContentPlan> {
  return (await parse(await contentPlanRequest(`/api/content-plans/${encodeURIComponent(planId)}/reapply`, railwayUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))).plan;
}
