/**
 * G1 research helpers with no I/O: which pages to analyse as competitors, and whether a new article
 * overlaps an existing page or article (cannibalisation).
 */
import type { CannibalisationMatch, WebsiteContentRecord } from '../types/index.ts';

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/** Unique source URLs from keyword research, in research order, without the brand's own site (Website Inventory hosts). */
export function competitorUrls(keywords: Array<{ sources?: string[] }> = [], inventory: Array<Pick<WebsiteContentRecord, 'url'>> = [], max = 5) {
  const own = new Set(inventory.map(record => hostOf(record.url)).filter(Boolean));
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const url of keywords.flatMap(keyword => keyword.sources ?? [])) {
    const host = hostOf(url);
    if (!host || own.has(host)) continue;
    let key: string;
    try { const parsed = new URL(url); key = `${host}${parsed.pathname.replace(/\/+$/, '')}`; } catch { continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
    if (urls.length >= max) break;
  }
  return urls;
}

/** Light English plural stemming: companies → company, studios → studio, glass stays. */
const stem = (word: string) => word.length > 4 && word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'vs', 'versus', 'how', 'what', 'why', 'is', 'are', 'your', 'best', 'top', 'guide', 'complete', 'examples', 'example', '2024', '2025', '2026', '2027']);
/** Content words of a phrase, lower-cased, light plural stemming. */
export function keywordTokens(text: string) {
  return new Set(text.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length > 1 && !STOP.has(word))
    .map(stem));
}
function overlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared < Math.min(2, a.size, b.size) ? 0 : shared / (a.size + b.size - shared);
}

type ArticleLike = { id: string; title?: string; topic?: string; articleSpec?: { primaryQuery?: string } | null };
/**
 * Existing pages (Website Inventory, not broken or redirected) and other articles whose keyword or title overlaps
 * this article's primary keyword or title. Score is word overlap (Jaccard, 1 = same words); matches from 0.6 up.
 */
export function findCannibalisation(target: { id: string; primaryQuery: string; title?: string }, inventory: WebsiteContentRecord[] = [], articles: ArticleLike[] = [], threshold = 0.6): CannibalisationMatch[] {
  const mine = [keywordTokens(target.primaryQuery), keywordTokens(target.title ?? '')].filter(set => set.size);
  if (!mine.length) return [];
  const best = (phrases: string[]) => {
    let top = { score: 0, keyword: '' };
    for (const phrase of phrases.filter(Boolean)) for (const set of mine) {
      const score = overlap(set, keywordTokens(phrase));
      if (score > top.score) top = { score, keyword: phrase };
    }
    return top;
  };
  const matches: CannibalisationMatch[] = [];
  for (const page of inventory) {
    if (['broken', 'redirected'].includes(page.status)) continue;
    const top = best([page.primaryTopic ?? '', page.title, ...(page.internalLinkAnchors ?? [])]);
    if (top.score >= threshold) matches.push({ kind: 'page', id: page.id, title: page.title, url: page.url, keyword: top.keyword, score: Math.round(top.score * 100) / 100 });
  }
  for (const article of articles) {
    if (article.id === target.id) continue;
    const top = best([article.articleSpec?.primaryQuery ?? '', article.title ?? article.topic ?? '']);
    if (top.score >= threshold) matches.push({ kind: 'article', id: article.id, title: article.title || article.topic || article.id, keyword: top.keyword, score: Math.round(top.score * 100) / 100 });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}
