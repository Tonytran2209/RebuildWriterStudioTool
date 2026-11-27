/**
 * Article Spec maps filled at G1 (Brand Opportunity Map, Semantic & Entity Map, AI Citation Map, page-type reason,
 * SEO metadata) and the SEO metadata derived from them. No I/O.
 */
import type { Article, ArticleSpec } from '../types/index.ts';

export const SPEC_MAP_INSTRUCTION = [
  'Map fields of articleSpec: pageTypeReason = one sentence on why that page type wins for this query (what ranking pages and searchers show).',
  'brandAssets = brand assets from Brand context and the Knowledge Base worth showing (a case, a number, a USP, a product, a method), each with "use" = which part of the article and how (for example "comparison section: as the third option with its price model"). Only assets present in the supplied documents.',
  'entityMap = the key entities with their attributes (facts a reader expects about each) and related = other entities in this list it connects to.',
  'citations = one entry per citationTargets statement: statement (same text), source (the supplied document or evidence it rests on), entity (the organisation, product or concept it is attributed to).',
  'metaDescription = 140-160 characters, contains the primary query, says what the reader gets. schemaTypes = schema.org types that fit this page (for example Article, FAQPage, ItemList, HowTo, Service).',
].join('\n');

const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
const strings = (value: unknown, count: number, max: number) => (Array.isArray(value) ? value : []).map(item => text(item, max)).filter(Boolean).slice(0, count);
const objects = (value: unknown, count: number) => (Array.isArray(value) ? value : []).filter(item => item && typeof item === 'object').slice(0, count) as Array<Record<string, unknown>>;

/** The map fields of a raw G1 Spec, capped so they never crowd the prompts that carry the Spec. Empty fields are left out. */
export function specMapFields(raw: any): Partial<ArticleSpec> {
  const fields: Partial<ArticleSpec> = {
    pageTypeReason: text(raw?.pageTypeReason, 300) || undefined,
    brandAssets: objects(raw?.brandAssets, 10).map(item => ({ asset: text(item.asset, 200), use: text(item.use, 200) })).filter(item => item.asset),
    entityMap: objects(raw?.entityMap, 15).map(item => ({ name: text(item.name, 120), attributes: strings(item.attributes, 6, 150), related: strings(item.related, 6, 120) })).filter(item => item.name),
    citations: objects(raw?.citations, 8).map(item => ({ statement: text(item.statement, 300), source: text(item.source, 200), entity: text(item.entity, 120) })).filter(item => item.statement),
    metaDescription: text(raw?.metaDescription, 200) || undefined,
    schemaTypes: strings(raw?.schemaTypes, 5, 40),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => Array.isArray(value) ? value.length : value)) as Partial<ArticleSpec>;
}

/** URL slug from a phrase: lower case, ASCII, hyphens, at most 6 words. */
export function slugify(phrase: string) {
  return phrase.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 6).join('-');
}

/** Schema types when G1 gave none: from the page type, plus FAQPage when the Spec lists reader questions. */
export function fallbackSchemaTypes(spec?: Partial<ArticleSpec> | null) {
  const type = (spec?.pageType ?? '').toLowerCase();
  const base = /service|product|landing/.test(type) ? ['Service'] : /list|toplist|top |best|comparison| vs/.test(type) ? ['Article', 'ItemList'] : /how.?to|tutorial|step/.test(type) ? ['Article', 'HowTo'] : ['Article'];
  return spec?.questions?.length ? [...base, 'FAQPage'] : base;
}

export type SeoMetadata = { title: string; metaDescription: string; slug: string; schemaTypes: string[]; titleLength: number; metaLength: number };

/** SEO metadata for an article: H1 of the draft (else the selected idea title), G1 meta description, slug from the primary query. */
export function seoMetadataOf(article: Partial<Article>): SeoMetadata | null {
  const spec = article.articleSpec;
  if (!spec) return null;
  const h1 = (article.draft ?? '').split('\n').find(line => /^#\s+\S/.test(line.trim()))?.replace(/^\s*#\s+/, '').trim();
  const idea = article.coreIdeaSuggestions?.find(item => item.id === article.selectedCoreIdeaId);
  const title = h1 || idea?.title || article.title || spec.topic;
  const metaDescription = spec.metaDescription ?? '';
  return { title, metaDescription, slug: slugify(spec.primaryQuery || title), schemaTypes: spec.schemaTypes?.length ? spec.schemaTypes : fallbackSchemaTypes(spec), titleLength: title.length, metaLength: metaDescription.length };
}
