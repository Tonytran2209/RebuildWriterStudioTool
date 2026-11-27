/**
 * Writer Brief: a Markdown brief a person can write from, assembled from what G1/G2 already produced
 * (Article Spec, selected idea, outline with evidence, SEO metadata). No AI call, no I/O.
 */
import type { Article } from '../types/index.ts';
import { seoMetadataOf } from './specMaps.ts';

const list = (items?: string[]) => (items ?? []).filter(Boolean).map(item => `- ${item}`).join('\n');
const block = (title: string, body?: string | null) => body?.trim() ? `## ${title}\n\n${body.trim()}\n` : '';

export function writerBriefMarkdown(article: Article): string {
  const spec = article.articleSpec;
  const idea = article.coreIdeaSuggestions?.find(item => item.id === article.selectedCoreIdeaId);
  const meta = seoMetadataOf(article);
  const outline = (article.outline ?? []).map(section => {
    const evidence = (section.evidence ?? []).filter(item => item.quote).map(item => `  - Evidence (${item.source}): "${item.quote}"`).join('\n');
    return [`${section.level === 'h3' ? '  ' : ''}- **${section.level.toUpperCase()} ${section.heading}**${section.notes ? `: ${section.notes}` : ''}`, evidence].filter(Boolean).join('\n');
  }).join('\n');
  return [
    `# Writer Brief: ${meta?.title || article.title || article.topic}`,
    '',
    block('Search strategy', spec && [
      `- Primary query: ${spec.primaryQuery}`,
      spec.secondaryQueries.length ? `- Secondary queries: ${spec.secondaryQueries.join(', ')}` : '',
      `- Intent: ${spec.primaryIntent}${spec.secondaryIntent ? ` (secondary: ${spec.secondaryIntent})` : ''}`,
      `- Audience: ${spec.audience} · Market: ${spec.market} · Language: ${spec.language}`,
      spec.pageType ? `- Page type: ${spec.pageType}${spec.pageTypeReason ? `. ${spec.pageTypeReason}` : ''}` : '',
      `- Format: ${spec.winningFormat}`,
    ].filter(Boolean).join('\n')),
    block('Angle', [idea?.title && `**${idea.title}**`, idea?.angleDescription, spec?.thesis && `Thesis: ${spec.thesis}`, spec?.brandPov && `Brand POV: ${spec.brandPov}`, spec?.expectedReaderOutcome && `Reader outcome: ${spec.expectedReaderOutcome}`, idea?.recommendedTone && `Tone: ${idea.recommendedTone}`].filter(Boolean).join('\n\n')),
    block('Must cover', list(spec?.mustCover)),
    block('Reader questions to answer', list(spec?.questions)),
    block('Competitor gaps to fill', list(spec?.contentGaps)),
    block('Information gain', list(spec?.informationGain)),
    block('Brand assets to show', (spec?.brandAssets ?? []).map(item => `- ${item.asset}${item.use ? `: ${item.use}` : ''}`).join('\n')),
    block('Entities', (spec?.entityMap?.length ? spec.entityMap.map(item => `- **${item.name}**${item.attributes.length ? `: ${item.attributes.join('; ')}` : ''}${item.related.length ? ` (related: ${item.related.join(', ')})` : ''}`) : (spec?.entities ?? []).map(item => `- ${item}`)).join('\n')),
    block('Outline', outline),
    block('Statements worth citing', (spec?.citations?.length ? spec.citations.map(item => `- "${item.statement}"${item.source ? ` (source: ${item.source}` : ''}${item.entity ? `${item.source ? '; ' : ' ('}entity: ${item.entity}` : ''}${item.source || item.entity ? ')' : ''}`) : (spec?.citationTargets ?? []).map(item => `- "${item}"`)).join('\n')),
    block('Internal links', list(spec?.internalLinkRequirements)),
    block('Call to action', spec?.ctaObjective),
    block('SEO metadata', meta && [`- Title: ${meta.title}`, meta.metaDescription ? `- Meta description: ${meta.metaDescription}` : '', `- Slug: /${meta.slug}`, `- Schema: ${meta.schemaTypes.join(', ')}`].filter(Boolean).join('\n')),
  ].filter(Boolean).join('\n');
}
