export interface SeoKeywordMetric {
  keyword: string;
  searchVolume: number;
  keywordDifficulty: number | null;
  competition: number | null;
  cpc: number | null;
  intent: string | null;
  source: 'dataforseo';
  updatedAt: string | null;
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function seoResearchConfigured(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

export async function researchSeoKeywords(seeds: string[]): Promise<{
  keywords: SeoKeywordMetric[];
  seedKeywords: string[];
  location: string;
  language: string;
  researchedAt: string;
}> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error('SEO research chưa được cấu hình. Thêm DATAFORSEO_LOGIN và DATAFORSEO_PASSWORD vào Railway Variables.');
  }
  const cleanSeeds = [...new Set(seeds.map(seed => String(seed).trim()).filter(Boolean))].slice(0, 20);
  if (!cleanSeeds.length) throw new Error('Cần ít nhất một seed keyword để research SEO.');
  const location = process.env.SEO_LOCATION_NAME || 'United States';
  const language = process.env.SEO_LANGUAGE_CODE || 'en';
  const response = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{
      keywords: cleanSeeds,
      location_name: location,
      language_code: language,
      include_serp_info: true,
      closely_variants: true,
      limit: 100,
      order_by: ['keyword_data.keyword_info.search_volume,desc'],
    }]),
  });
  const payload = await response.json() as any;
  if (!response.ok || payload?.status_code !== 20000) {
    throw new Error(payload?.status_message || `DataForSEO error ${response.status}`);
  }
  const task = payload.tasks?.[0];
  if (task?.status_code !== 20000) throw new Error(task?.status_message || 'DataForSEO không trả về kết quả hợp lệ.');
  const items = task?.result?.[0]?.items ?? [];
  const keywords: SeoKeywordMetric[] = items.map((item: any): SeoKeywordMetric | null => {
    const data = item.keyword_data ?? item;
    const keyword = String(data.keyword ?? '').trim();
    if (!keyword) return null;
    const info = data.keyword_info ?? {};
    const properties = data.keyword_properties ?? item.keyword_properties ?? {};
    const intentInfo = data.search_intent_info ?? item.search_intent_info ?? {};
    return {
      keyword,
      searchVolume: numberOrNull(info.search_volume) ?? 0,
      keywordDifficulty: numberOrNull(properties.keyword_difficulty),
      competition: numberOrNull(info.competition),
      cpc: numberOrNull(info.cpc),
      intent: intentInfo.main_intent ? String(intentInfo.main_intent) : null,
      source: 'dataforseo',
      updatedAt: info.last_updated_time ? String(info.last_updated_time) : null,
    };
  }).filter((item: SeoKeywordMetric | null): item is SeoKeywordMetric => Boolean(item));
  const unique: SeoKeywordMetric[] = [...new Map<string, SeoKeywordMetric>(keywords.map((item): [string, SeoKeywordMetric] => [item.keyword.toLocaleLowerCase(), item])).values()]
    .sort((a, b) => b.searchVolume - a.searchVolume)
    .slice(0, 10);
  if (unique.length < 10) throw new Error(`DataForSEO chỉ tìm thấy ${unique.length}/10 keyword cho seed và thị trường đã chọn; pipeline dừng để tránh kết quả thiếu.`);
  return { keywords: unique, seedKeywords: cleanSeeds, location, language, researchedAt: new Date().toISOString() };
}
