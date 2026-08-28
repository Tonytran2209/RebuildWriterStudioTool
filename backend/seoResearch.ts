export interface SeoKeywordMetric {
  keyword: string;
  searchVolume: null;
  keywordDifficulty: null;
  competition: null;
  cpc: null;
  intent: string | null;
  source: 'openai_web_search';
  sources: string[];
  marketEvidence: string;
  updatedAt: string;
}

export function seoResearchConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function extractJsonArray(raw: string): unknown[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('OpenAI Web Search không trả về JSON array.');
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('OpenAI Web Search không trả về danh sách keyword.');
  return parsed;
}

function validUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function researchSeoKeywords(seeds: string[], keywordCount = 10): Promise<{
  keywords: SeoKeywordMetric[];
  seedKeywords: string[];
  location: string;
  language: string;
  researchedAt: string;
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
}> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI Web Search chưa sẵn sàng vì Railway chưa có OPENAI_API_KEY.');
  const cleanSeeds = [...new Set(seeds.map(seed => String(seed).trim()).filter(Boolean))].slice(0, 20);
  if (!cleanSeeds.length) throw new Error('Cần ít nhất một seed keyword để research SEO.');
  const location = 'United States';
  const language = 'en';
  const researchedAt = new Date().toISOString();
  const requestedCount = Math.min(20, Math.max(5, Math.round(keywordCount)));
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: 'gpt-5.4-mini',
    tools: [{ type: 'web_search' }],
    input: [
      'Research the current United States Google search landscape for the seed keywords below.',
      'Use web search and inspect current SERP language, autocomplete/related-query patterns, recurring topics, and search intent.',
      `Return exactly ${requestedCount} distinct, actionable English SEO keywords ranked by observed market prominence and relevance.`,
      'Do not invent search volume, keyword difficulty, CPC, or competition metrics.',
      'Every keyword must include at least one real supporting URL found during web search and a concise marketEvidence statement describing what was observed.',
      'Return only a valid JSON array with this schema:',
      '[{"keyword":string,"intent":"informational"|"commercial"|"transactional"|"navigational","sources":string[],"marketEvidence":string}]',
      `Seeds: ${JSON.stringify(cleanSeeds)}`,
    ].join('\n'),
  } as any);
  const items = extractJsonArray(response.output_text).flatMap((raw): SeoKeywordMetric[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const keyword = String(item.keyword ?? '').trim();
    const sources = (Array.isArray(item.sources) ? item.sources : []).map(validUrl).filter((url): url is string => Boolean(url));
    const marketEvidence = String(item.marketEvidence ?? '').trim();
    if (!keyword || !sources.length || !marketEvidence) return [];
    return [{ keyword, searchVolume: null, keywordDifficulty: null, competition: null, cpc: null, intent: item.intent ? String(item.intent) : null, source: 'openai_web_search', sources, marketEvidence, updatedAt: researchedAt }];
  });
  const unique = [...new Map(items.map(item => [item.keyword.toLocaleLowerCase(), item])).values()].slice(0, requestedCount);
  if (unique.length !== requestedCount) throw new Error(`OpenAI Web Search chỉ trả về ${unique.length}/${requestedCount} keyword có nguồn hợp lệ; pipeline dừng để tránh kết quả thiếu căn cứ.`);
  return { keywords: unique, seedKeywords: cleanSeeds, location, language, researchedAt, usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0, cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0 } };
}
