import type { ContentPlan, ContentPlanSourceType } from '../types';

function baseUrl(railwayUrl: string) { return railwayUrl.trim().replace(/\/$/, '') || window.location.origin; }
async function parse(response: Response) { const payload = await response.json().catch(() => ({ error: response.statusText })); if (!response.ok) throw new Error(payload.error || `Content Plan error ${response.status}`); return payload; }

export async function importContentPlan(input: { name: string; sourceType: ContentPlanSourceType; content?: string; url?: string; file?: File; previousVersionId?: string }, railwayUrl: string): Promise<ContentPlan> {
  if (input.file) {
    const body = new FormData(); body.append('file', input.file); body.append('name', input.name); body.append('sourceType', 'file'); if (input.previousVersionId) body.append('previousVersionId', input.previousVersionId);
    return (await parse(await fetch(`${baseUrl(railwayUrl)}/api/content-plans/import`, { method: 'POST', body }))).plan;
  }
  return (await parse(await fetch(`${baseUrl(railwayUrl)}/api/content-plans/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }))).plan;
}

export async function classifyContentPlan(id: string, railwayUrl: string, force = false): Promise<ContentPlan> {
  return (await parse(await fetch(`${baseUrl(railwayUrl)}/api/content-plans/${encodeURIComponent(id)}/${force ? 'reclassify' : 'classify'}`, { method: 'POST' }))).plan;
}

export async function fetchContentPlans(railwayUrl: string): Promise<ContentPlan[]> {
  return parse(await fetch(`${baseUrl(railwayUrl)}/api/content-plans`));
}

export async function updateContentPlanItem(planId: string, itemId: string, type: 'comparison-seo' | 'editorial-originality' | 'needs-review', railwayUrl: string): Promise<ContentPlan> {
  return (await parse(await fetch(`${baseUrl(railwayUrl)}/api/content-plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) }))).plan;
}

export async function updateContentPlanStatus(planId: string, status: 'active' | 'archived', railwayUrl: string): Promise<ContentPlan> {
  return (await parse(await fetch(`${baseUrl(railwayUrl)}/api/content-plans/${encodeURIComponent(planId)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }))).plan;
}
