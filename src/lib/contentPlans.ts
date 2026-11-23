import type { ContentPlan, ContentPlanSourceType } from '../types';
import { authenticatedRailwayFetch } from './db';

async function parse(response: Response) { const payload = await response.json().catch(() => ({ error: response.statusText })); if (!response.ok) throw new Error(payload.error || `Content Plan error ${response.status}`); return payload; }

function contentPlanRequest(path: string, railwayUrl: string, init?: RequestInit): Promise<Response> {
  return authenticatedRailwayFetch(path, init, railwayUrl);
}

export async function importContentPlan(input: { name: string; sourceType: ContentPlanSourceType; content?: string; url?: string; file?: File; previousVersionId?: string }, railwayUrl: string): Promise<ContentPlan> {
  if (input.file) {
    const body = new FormData(); body.append('file', input.file); body.append('name', input.name); body.append('sourceType', 'file'); if (input.previousVersionId) body.append('previousVersionId', input.previousVersionId);
    return (await parse(await contentPlanRequest('/api/content-plans/import', railwayUrl, { method: 'POST', body }))).plan;
  }
  return (await parse(await contentPlanRequest('/api/content-plans/import', railwayUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }))).plan;
}

export async function classifyContentPlan(id: string, railwayUrl: string, force = false): Promise<ContentPlan> {
  return (await parse(await contentPlanRequest(`/api/content-plans/${encodeURIComponent(id)}/${force ? 'reclassify' : 'classify'}`, railwayUrl, { method: 'POST' }))).plan;
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
