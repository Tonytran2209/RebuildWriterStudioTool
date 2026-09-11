import { useState, useMemo, useEffect, useRef } from 'react';
import { Check, CircleX, ClipboardCopy, Copy, Download, Eye, Highlighter, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import type { Article, AIModel, AIProcessTraceEvent, AppConfig, DocumentFile, EvidenceRef, QualityGateCheck } from '../../types';
import { callAI } from '../../lib/aiService';
import { useI18n } from '../../lib/i18n';
import { parseAIJson } from '../../lib/aiJson';
import {
  collectStepDocs,
  buildWorkflowSourceFingerprint,
  buildRoleSystemPrompt,
  buildStepDocumentPromptRules,
  describeBundle,
} from '../../lib/docContext';
import { compileWorkflowRules, getWorkflowParameter } from '../../lib/workflowRules';
import { selectInternalLinkCandidates } from '../../lib/internalLinkInventory';
import { gateArticleStep } from '../../lib/workflowGuards';
import { auditInternalLinks, deterministicQualityChecks, qualityReport } from '../../lib/universalQuality';
import { ProcessTraceModal } from './ProcessTrace';
import { notifyWorkspace } from './WorkspaceNotification';

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function renderKeywordMarks(text: string, keywords: string[]) {
  const terms = [...new Set(keywords.map(item => item.trim()).filter(item => item.length >= 3))]
    .sort((a, b) => b.length - a.length);
  if (!terms.length) return text;
  const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const matcher = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.split(matcher).map((part, index) => terms.some(term => term.toLocaleLowerCase() === part.toLocaleLowerCase())
    ? <span key={`${index}-${part}`} className="draft-keyword-mark">{part}</span>
    : part);
}

type StructuredDraftPayload = {
  title?: string;
  introduction?: string;
  conclusion?: string;
  sections?: Array<{ id?: string; content?: string; usedEvidenceRefs?: string[] }>;
};

const structuredDraftSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'introduction', 'sections', 'conclusion'],
  properties: {
    title: { type: 'string', minLength: 1 },
    introduction: { type: 'string', minLength: 1 },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'content', 'usedEvidenceRefs'],
        properties: {
          id: { type: 'string', minLength: 1 },
          content: { type: 'string', minLength: 1 },
          usedEvidenceRefs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    conclusion: { type: 'string', minLength: 1 },
  },
};

type TargetedDraftRepair = {
  edits?: Array<{ find?: string; replace?: string }>;
  appendBeforeConclusion?: string;
};

const targetedDraftRepairSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['edits', 'appendBeforeConclusion'],
  properties: {
    edits: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['find', 'replace'],
        properties: {
          find: { type: 'string' },
          replace: { type: 'string' },
        },
      },
    },
    appendBeforeConclusion: { type: 'string' },
  },
};

function applyTargetedDraftRepair(draft: string, repair: TargetedDraftRepair) {
  let next = draft;
  for (const edit of repair.edits ?? []) {
    const find = String(edit.find ?? '');
    const replace = String(edit.replace ?? '');
    if (find && next.includes(find)) next = next.replace(find, replace);
  }
  const addition = String(repair.appendBeforeConclusion ?? '').trim();
  if (addition) {
    const conclusionIndex = next.search(/^##\s+Conclusion\s*$/mi);
    next = conclusionIndex >= 0
      ? `${next.slice(0, conclusionIndex).trimEnd()}\n\n${addition}\n\n${next.slice(conclusionIndex)}`
      : `${next.trimEnd()}\n\n${addition}`;
  }
  return next;
}

function semanticReviewInstruction(article: Article, draft: string) {
  const keyword = getPrimaryKeyword(article);
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactMatches = keyword ? draft.match(new RegExp(escaped, 'gi'))?.length ?? 0 : 0;
  const density = keyword ? (exactMatches / Math.max(countWords(draft), 1)) * 100 : 0;
  return [
    'For keyword-naturalness, pass when the primary query is present in the H1/body and reads grammatically in context.',
    'Do not warn merely because an exact-match keyword is used. Warn only for a clearly awkward sentence or avoidable repetition, and quote its exact location.',
    'Fail only for material keyword stuffing that blocks publication.',
    `PRIMARY KEYWORD METRICS: ${JSON.stringify({ keyword, exactMatches, approximateDensityPercent: Number(density.toFixed(2)) })}`,
  ].join('\n');
}

function missingStructuredParts(parsed: StructuredDraftPayload, article: Article) {
  const missing: Array<'title' | 'introduction' | 'sections' | 'conclusion'> = [];
  if (!parsed.title?.trim()) missing.push('title');
  if (!parsed.introduction?.trim()) missing.push('introduction');
  if (!parsed.conclusion?.trim()) missing.push('conclusion');
  const expected = article.outline ?? [];
  const byId = new Map((parsed.sections ?? []).map(section => [section.id, section]));
  const resolved = expected.map((section, index) => byId.get(section.id) ?? parsed.sections?.[index]);
  if (!Array.isArray(parsed.sections) || resolved.length !== expected.length || resolved.some(section => !section?.content?.trim())) missing.push('sections');
  return missing;
}

function repairSchemaFor(parts: ReturnType<typeof missingStructuredParts>) {
  const properties = structuredDraftSchema.properties as Record<string, unknown>;
  return {
    type: 'object',
    additionalProperties: false,
    required: parts,
    properties: Object.fromEntries(parts.map(part => [part, properties[part]])),
  };
}

function mergeStructuredDraft(base: StructuredDraftPayload, repair: StructuredDraftPayload, article: Article): StructuredDraftPayload {
  const expected = article.outline ?? [];
  const baseById = new Map((base.sections ?? []).map(section => [section.id, section]));
  const repairById = new Map((repair.sections ?? []).map(section => [section.id, section]));
  return {
    title: base.title?.trim() || repair.title,
    introduction: base.introduction?.trim() || repair.introduction,
    conclusion: base.conclusion?.trim() || repair.conclusion,
    sections: expected.map((section, index) => {
      const existing = baseById.get(section.id) ?? base.sections?.[index];
      if (existing?.content?.trim()) return { id: section.id, content: existing.content, usedEvidenceRefs: existing.usedEvidenceRefs ?? [] };
      const replacement = repairById.get(section.id) ?? repair.sections?.[index];
      return { id: section.id, content: replacement?.content, usedEvidenceRefs: replacement?.usedEvidenceRefs ?? [] };
    }),
  };
}

const semanticCheckIds = ['intent-satisfied', 'reader-outcome', 'intro-quality', 'keyword-naturalness', 'evidence-support', 'brand-pov'] as const;

const semanticCheckSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'status', 'reason', 'evidence', 'location', 'recommendedAction', 'autoFixAllowed'],
  properties: {
    label: { type: 'string' },
    status: { type: 'string', enum: ['pass', 'warning', 'fail'] },
    reason: { type: 'string' },
    evidence: { type: 'string' },
    location: { type: 'string' },
    recommendedAction: { type: 'string' },
    autoFixAllowed: { type: 'boolean' },
  },
};

const semanticQualitySchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['checks'],
  properties: {
    checks: {
      type: 'object',
      additionalProperties: false,
      required: semanticCheckIds,
      properties: Object.fromEntries(semanticCheckIds.map(id => [id, semanticCheckSchema])),
    },
  },
};

function buildSectionBudget(outline: NonNullable<Article['outline']>, wordTarget: number, introductionPercent = 8, conclusionPercent = 7) {
  const targetMin = Math.ceil(wordTarget * 0.95);
  const targetMax = Math.floor(wordTarget * 1.03);
  const introduction = { min: Math.floor(targetMin * introductionPercent / 100), max: Math.floor(targetMax * (introductionPercent + 1) / 100) };
  const conclusion = { min: Math.floor(targetMin * conclusionPercent / 100), max: Math.floor(targetMax * (conclusionPercent + 1) / 100) };
  const headingOverhead = outline.reduce((sum, section) => sum + countWords(section.heading) + 1, 10);
  const sectionPoolMin = Math.max(0, targetMin - introduction.min - conclusion.min - headingOverhead);
  const sectionPoolMax = Math.max(sectionPoolMin, targetMax - introduction.max - conclusion.max - headingOverhead);
  const totalWeight = outline.reduce((sum, section) => sum + (section.level === 'h3' ? 0.65 : 1), 0) || 1;
  const sections = outline.map(section => {
    const weight = section.level === 'h3' ? 0.65 : 1;
    return {
      id: section.id,
      heading: section.heading,
      level: section.level,
      minWords: Math.max(35, Math.floor(sectionPoolMin * weight / totalWeight)),
      maxWords: Math.max(45, Math.floor(sectionPoolMax * weight / totalWeight)),
    };
  });
  return { wordTarget, acceptedMin: Math.max(800, Math.ceil(wordTarget * 0.85)), acceptedMax: Math.floor(wordTarget * 1.15), targetMin, targetMax, introduction, conclusion, headingOverhead, sections };
}

function assessOutlineFeasibility(article: Article, wordTarget: number) {
  const outline = article.outline ?? [];
  const headingWords = outline.reduce((sum, section) => sum + countWords(section.heading) + 1, 10);
  const sectionMinimum = outline.reduce((sum, section) => sum + (section.level === 'h3' ? 55 : 90), 0);
  const coverageMinimum = (article.articleSpec?.mustCover?.length ?? 0) * 30;
  const minimumRequired = headingWords + sectionMinimum + coverageMinimum + 130;
  return {
    minimumRequired,
    feasible: minimumRequired <= Math.floor(wordTarget * 1.15),
  };
}

function parseStructuredDraft(raw: string, article: Article) {
  const parsed = parseAIJson(raw) as StructuredDraftPayload;
  if (!parsed.title?.trim() || !parsed.introduction?.trim() || !parsed.conclusion?.trim() || !Array.isArray(parsed.sections)) {
    throw new Error('AI trả về structured draft thiếu title, introduction, sections hoặc conclusion.');
  }
  const expected = article.outline ?? [];
  const byId = new Map(parsed.sections.map(section => [section.id, section]));
  const sections = expected.map((outlineSection, index) => byId.get(outlineSection.id) ?? parsed.sections?.[index]).filter(Boolean);
  if (sections.length !== expected.length || sections.some(section => !section?.content?.trim())) {
    throw new Error(`AI chỉ hoàn thiện ${sections.filter(section => section?.content?.trim()).length}/${expected.length} section; draft không được lưu.`);
  }
  const primaryKeyword = getPrimaryKeyword(article);
  const title = parsed.title.toLocaleLowerCase().includes(primaryKeyword.toLocaleLowerCase())
    ? parsed.title.trim()
    : `${parsed.title.trim()}: ${primaryKeyword}`;
  return [
    `# ${title}`,
    parsed.introduction.trim(),
    ...sections.flatMap((section, index) => [`${expected[index].level === 'h3' ? '###' : '##'} ${expected[index].heading}`, section!.content!.trim()]),
    '## Conclusion',
    parsed.conclusion.trim(),
  ].join('\n\n');
}

function getPrimaryKeyword(article: Article) {
  const selectedIdea = article.coreIdeaSuggestions?.find(idea => idea.id === article.selectedCoreIdeaId)
    ?? article.coreIdeaSuggestions?.[0];
  return article.articleSpec?.primaryQuery?.trim() || selectedIdea?.primaryKeyword?.trim() || (article.keywords || '').split(',')[0]?.trim() || article.topic?.trim() || '';
}

function evaluateSeoChecklist(text: string, article: Article, targetWords: number) {
  const wordCount = countWords(text);
  const primaryKeyword = getPrimaryKeyword(article);
  const normalizedKeyword = primaryKeyword.toLocaleLowerCase();
  const normalizedDraft = text.toLocaleLowerCase();
  const markdownTitle = text.split('\n').find(line => /^#\s+\S/.test(line.trim()))?.replace(/^#\s+/, '').trim() || '';
  const conclusionCount = [...text.matchAll(/^##\s+conclusion\s*$/gim)].length;
  const items = [
    { key: 'titleKeyword', label: 'Tiêu đề H1 có primary keyword', pass: Boolean(normalizedKeyword && markdownTitle.toLocaleLowerCase().includes(normalizedKeyword)) },
    { key: 'minimumLength', label: 'Độ dài >= 800 từ', pass: wordCount >= 800 },
    { key: 'targetLength', label: `Trong khoảng mục tiêu ${Math.max(800, Math.ceil(targetWords * 0.85)).toLocaleString()}–${Math.floor(targetWords * 1.15).toLocaleString()} từ`, pass: wordCount >= Math.max(800, Math.ceil(targetWords * 0.85)) && wordCount <= Math.floor(targetWords * 1.15) },
    { key: 'headings', label: 'Có headings H2/H3', pass: /^#{2,3}\s+\S/m.test(text) },
    { key: 'conclusion', label: 'Có đúng một phần Conclusion', pass: conclusionCount === 1 },
    { key: 'bodyKeyword', label: 'Primary keyword xuất hiện trong bài', pass: Boolean(normalizedKeyword && normalizedDraft.includes(normalizedKeyword)) },
  ];
  return { items, failed: items.filter(item => !item.pass), primaryKeyword, markdownTitle, wordCount };
}

function parseSemanticQuality(raw: string): QualityGateCheck[] {
  const parsed = parseAIJson(raw) as { checks?: Array<Record<string, unknown>> | Record<string, Record<string, unknown>> };
  const required = new Set<string>(semanticCheckIds);
  const entries = Array.isArray(parsed.checks)
    ? parsed.checks.map(item => [String(item.id ?? '').trim(), item] as const)
    : Object.entries(parsed.checks ?? {});
  const checks = entries.flatMap(([id, item]) => {
    const status: QualityGateCheck['status'] = item.status === 'pass' ? 'pass' : item.status === 'warning' ? 'warning' : 'fail';
    if (!required.has(id)) return [];
    return [{ id, label: String(item.label ?? id), kind: 'semantic' as const, status, reason: String(item.reason ?? '').trim(), evidence: String(item.evidence ?? '').trim(), location: String(item.location ?? '').trim(), recommendedAction: String(item.recommendedAction ?? '').trim(), autoFixAllowed: Boolean(item.autoFixAllowed) }];
  });
  const present = new Set(checks.map(item => item.id));
  const missing = semanticCheckIds.filter(id => !present.has(id));
  if (missing.length) throw new Error(`Semantic reviewer chưa hoàn tất báo cáo; thiếu: ${missing.join(', ')}. Draft chưa bị đánh dấu fail.`);
  return checks;
}

function getDraftEvidenceUsage(parsed: StructuredDraftPayload, article: Article) {
  const byId = new Map((parsed.sections ?? []).map(section => [section.id, section]));
  return Object.fromEntries((article.outline ?? []).map((section, index) => {
    const generated = byId.get(section.id) ?? parsed.sections?.[index];
    return [section.id, [...new Set((generated?.usedEvidenceRefs ?? []).map(String).filter(Boolean))]];
  }));
}

function evidenceMappingChecks(
  article: Article,
  usage: Record<string, string[]>,
  verifiedOutline: ReturnType<typeof buildVerifiedOutlineContext>,
): QualityGateCheck[] {
  const registered = new Set(Object.keys(verifiedOutline.evidenceRegistry));
  const mapped = new Map(verifiedOutline.sections.map(section => [section.id, new Set(section.evidenceRefs)]));
  const invalid: string[] = [];
  const missing: string[] = [];
  for (const section of article.outline ?? []) {
    const allowed = mapped.get(section.id) ?? new Set<string>();
    const used = usage[section.id] ?? [];
    const bad = used.filter(id => !registered.has(id) || !allowed.has(id));
    if (bad.length) invalid.push(`${section.id}: ${bad.join(', ')}`);
    if (allowed.size > 0 && used.length === 0) missing.push(section.id);
  }
  return [{
    id: 'evidence-mapping',
    label: 'Evidence mapped to outline sections',
    kind: 'deterministic',
    status: invalid.length || missing.length ? 'fail' : 'pass',
    reason: invalid.length
      ? `Evidence references outside their approved section: ${invalid.join('; ')}.`
      : missing.length
        ? `Sections with approved evidence did not declare usage: ${missing.join(', ')}.`
        : 'Every declared evidence reference exists and belongs to its outline section.',
    evidence: JSON.stringify(usage),
    autoFixAllowed: true,
  }];
}

function calcReadability(text: string) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 3);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!sentences.length || !words.length) return null;
  const avgWordsPerSentence = words.length / sentences.length;
  if (avgWordsPerSentence < 15) return { label: 'Rất dễ đọc', score: 95, color: 'text-emerald-600' };
  if (avgWordsPerSentence < 20) return { label: 'Dễ đọc', score: 80, color: 'text-emerald-500' };
  if (avgWordsPerSentence < 25) return { label: 'Trung bình', score: 65, color: 'text-amber-500' };
  return { label: 'Khó đọc', score: 40, color: 'text-red-500' };
}

function buildVerifiedOutlineContext(outline: NonNullable<Article['outline']>) {
  const evidenceRegistry: Record<string, EvidenceRef> = {};
  const evidenceIds = new Map<string, string>();
  const sections = outline.map(section => {
    const refs = (section.evidence ?? []).map(evidence => {
      const key = [evidence.role, evidence.source, evidence.quote].join('|');
      let id = evidenceIds.get(key);
      if (!id) {
        id = `ev-${evidenceIds.size + 1}`;
        evidenceIds.set(key, id);
        evidenceRegistry[id] = evidence;
      }
      return id;
    });
    return {
      id: section.id,
      heading: section.heading,
      level: section.level,
      notes: section.notes,
      rationale: section.rationale ?? '',
      keywords: section.keywords ?? [],
      searchIntent: section.searchIntent ?? '',
      evidenceRefs: refs,
      ruleRefs: section.ruleRefs ?? [],
    };
  });
  return { evidenceRegistry, sections };
}

function assessDraft(text: string, article: Article, targetWords: number): string[] {
  if (!text.trim()) return [];
  const normalized = text.toLocaleLowerCase();
  const words = countWords(text);
  const warnings: string[] = [];
  if (words < targetWords * 0.9) warnings.push(`Draft có ${words}/${targetWords} từ — thấp hơn khoảng viết khuyến nghị nhưng vẫn có thể hoàn thành nếu các kiểm tra coverage và chất lượng đều đạt.`);
  const primaryKeyword = (article.keywords || '').split(',')[0]?.trim();
  if (primaryKeyword && !normalized.includes(primaryKeyword.toLocaleLowerCase())) warnings.push(`Chưa tìm thấy primary keyword “${primaryKeyword}”.`);
  const missingHeadings = (article.outline ?? []).filter(section =>
    section.heading.trim() && !normalized.includes(section.heading.trim().toLocaleLowerCase()),
  );
  if (missingHeadings.length) warnings.push(`Thiếu ${missingHeadings.length} heading từ outline Bước 2.`);
  return warnings;
}

interface Props {
  embedded?: boolean;
  article: Article;
  config: AppConfig;
  files: DocumentFile[];
  model: AIModel;
  railwayUrl: string;
  onUpdate: (updates: Partial<Article>) => Promise<boolean>;
  onPrev: () => void;
  onToggleComplete: () => void;
  completionSaving: boolean;
}

export default function Step4Draft({ embedded = false, article, config, files, model, railwayUrl, onUpdate, onPrev, onToggleComplete, completionSaving }: Props) {
  const { tr, canonicalAIOutputInstruction } = useI18n();
  const bundle = useMemo(() => collectStepDocs(4, config, files, article.contentPlanInput), [article.contentPlanInput, config, files]);
  const documentPromptRules = useMemo(() => buildStepDocumentPromptRules(4, config, files), [config, files]);
  const compiledWorkflowRules = useMemo(() => compileWorkflowRules(config, 4, 'manual'), [config]);
  const introductionPercent = Number(getWorkflowParameter(config, 'draft', 'word-allocation', 'introductionPercent') ?? 8);
  const conclusionPercent = Number(getWorkflowParameter(config, 'draft', 'word-allocation', 'conclusionPercent') ?? 7);
  const maxSentencesPerParagraph = Number(getWorkflowParameter(config, 'draft', 'structured-assembly', 'maxSentencesPerParagraph') ?? 5);
  const [generating, setGenerating] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [formatCopying, setFormatCopying] = useState(false);
  const [formatCopied, setFormatCopied] = useState(false);
  const [highlightsEnabled, setHighlightsEnabled] = useState(true);
  const [insightPanel, setInsightPanel] = useState<'analysis' | 'quality' | 'keywords'>('quality');
  const [showAudit, setShowAudit] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const generationInFlight = useRef(false);
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<string | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const recoveryKey = `writer:draft-recovery:${article.id}`;
  const [recoveryDraft, setRecoveryDraft] = useState(() => sessionStorage.getItem(recoveryKey) ?? '');
  const draft = article.draft || recoveryDraft;
  const prerequisite = gateArticleStep(article, 4);
  const draftSourceFingerprint = useMemo(
    () => [
      buildWorkflowSourceFingerprint(bundle), model.provider, model.id, 'step4-draft-v7-flexible-word-target',
      article.selectedCoreIdeaId, article.topic, article.angle,
      JSON.stringify(article.outline ?? []), article.tone, article.keywords, config.stepConfigs[4]?.maxDraftWords ?? config.stepConfigs[4]?.maxDraftCharacters ?? 1500, compiledWorkflowRules.fingerprint,
    ].join(':'),
    [article.angle, article.keywords, article.outline, article.selectedCoreIdeaId, article.tone, article.topic, bundle, compiledWorkflowRules.fingerprint, config.stepConfigs, model.id, model.provider],
  );
  const wordCount = countWords(draft);
  const targetWords = Math.min(10000, Math.max(800, config.stepConfigs[4]?.maxDraftWords ?? config.stepConfigs[4]?.maxDraftCharacters ?? 1500));
  const readability = calcReadability(draft);
  const progress = Math.min(Math.round((wordCount / targetWords) * 100), 100);
  const draftIsStale = Boolean(draft) && article.draftSourceFingerprint !== draftSourceFingerprint;
  useEffect(() => {
    if (draftIsStale && !generating) notifyWorkspace('Outline, tài liệu, prompting rules hoặc model đã thay đổi. Draft đã lưu vẫn được giữ nguyên cho đến khi viết lại.', 'warning');
  }, [draftIsStale, generating]);
  const draftWarnings = useMemo(() => assessDraft(draft, article, targetWords), [article, draft, targetWords]);
  const seoChecklist = useMemo(() => evaluateSeoChecklist(draft, article, targetWords), [article, draft, targetWords]);
  const deterministicChecks = useMemo(() => deterministicQualityChecks(
    article,
    draft,
    targetWords,
    config.websiteInventory ?? [],
    files.filter(file => !file.knowledgeMetadata?.approvedForExternalUse).map(file => file.name),
  ), [article, config.websiteInventory, draft, files, targetWords]);
  const savedQualityReport = article.qualityReport;
  const displayedQualityChecks = savedQualityReport && savedQualityReport.articleSpecFingerprint === article.articleSpecFingerprint && !draftIsStale
    ? savedQualityReport.checks
    : deterministicChecks;
  const seoChecklistPassed = Boolean(draft) && displayedQualityChecks.length > 0 && displayedQualityChecks.every(item => item.status === 'pass');

  useEffect(() => {
    if (!article.draft) return;
    sessionStorage.removeItem(recoveryKey);
    setRecoveryDraft('');
  }, [article.draft, recoveryKey]);

  useEffect(() => {
    if (!article.draft) setRecoveryDraft(sessionStorage.getItem(recoveryKey) ?? '');
  }, [article.id, article.draft, recoveryKey]);

  // Keyword density check
  const keywordList = (article.keywords || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  const draftLower = draft.toLowerCase();
  const keywordStats = keywordList.slice(0, 4).map(kw => ({
    keyword: kw,
    count: (draftLower.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length,
    density: draft ? `${(((draftLower.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length / Math.max(wordCount, 1)) * 100).toFixed(1)}%` : '0%',
  }));

  useEffect(() => { if (error) notifyWorkspace(error, 'error'); }, [error]);
  useEffect(() => {
    if (draftWarnings.length) notifyWorkspace(draftWarnings.join(' '), 'warning');
  }, [draftWarnings]);

  const handleGenerate = async (manual = false) => {
    if (generationInFlight.current) return;
    if (!prerequisite.allowed) {
      setError(tr(prerequisite.reasonVi, prerequisite.reason));
      return;
    }
    if (!article.contentPlanInput?.trim() || !article.topic?.trim()) {
      setError('Bài viết chưa có topic được tổng hợp từ Content Plan hiện tại.');
      return;
    }
    if (!(article.outline && article.outline.length)) {
      setError('Bước 3 cần outline đã lưu từ Bước 2. Vui lòng quay lại Bước 2 và tạo hoặc lưu ít nhất một section.');
      return;
    }
    const feasibility = assessOutlineFeasibility(article, targetWords);
    if (!feasibility.feasible) {
      setError(`Outline hiện tại cần tối thiểu khoảng ${feasibility.minimumRequired} từ để bao phủ đủ section và must-cover topic, vượt vùng linh hoạt quanh target ${targetWords} từ. Hãy tăng target hoặc rút gọn outline trước khi tạo draft.`);
      return;
    }
    generationInFlight.current = true;
    setGenerating(true);
    setError('');
    const processTrace: AIProcessTraceEvent[] = [...(article.step4ProcessTrace ?? []), {
      id: `draft-request-${Date.now()}`,
      stage: 'generation',
      status: 'completed',
      title: manual && draft ? 'Rewrite requested' : 'Structured draft request',
      detail: `Requested title, introduction, ${article.outline?.length ?? 0} outline sections and conclusion with provider JSON enforcement.`,
      facts: { model: model.id, provider: model.provider, targetWords },
    }];
    let rawResponseExcerpt = '';
    try {
      const verifiedOutline = buildVerifiedOutlineContext(article.outline || []);
      const contextQuery = [
        article.topic,
        article.angle,
        article.keywords,
        ...(article.outline ?? []).map(section => section.heading),
      ].filter(Boolean).join(' ');
      const wordBudget = buildSectionBudget(article.outline || [], targetWords, introductionPercent, conclusionPercent);
      // English prose, JSON escaping and provider tokenization need headroom beyond
      // the visible word target. The hard word limit is still enforced after assembly.
      const maxTokens = Math.min(12_000, Math.max(1800, Math.ceil(targetWords * 1.9)));

      const systemPrompt = buildRoleSystemPrompt(
        [
          canonicalAIOutputInstruction,
          'Viết bài hoàn chỉnh theo dàn bài và tài liệu được cấp.',
          '- Knowledge Base là nguồn dữ liệu duy nhất cho số liệu, dẫn chứng, thông tin sản phẩm. KHÔNG bịa dữ liệu.',
          '- Content Plan hiện tại cung cấp topic, nhóm nội dung và keyword đã được tổng hợp cho article; không đọc kế hoạch legacy.',
          '- Rules & Guidelines quyết định tone of voice, từ ngữ cấm, cấu trúc câu, quy tắc SEO. PHẢI tuân thủ tuyệt đối.',
          '- Khi dùng thông tin từ KB, nêu tự nhiên trong văn bản; không cần footnote hay hiển thị mã evidence trong bài.',
          '- Nếu không có evidence cho một claim cụ thể, bỏ claim đó hoặc viết một câu chuyển ý tổng quát không chứa dữ kiện có thể kiểm chứng. Không tạo placeholder.',
          '- Giữ nguyên đầy đủ heading và đúng thứ tự section của OUTLINE_STEP_3.',
          '- Evidence trong OUTLINE_STEP_3 đã được kiểm chứng; dùng đúng evidenceRefs cho section tương ứng, không bịa thêm số liệu.',
          '- Hoàn thiện mọi section trước khi mở rộng bất kỳ section nào. Không lặp định nghĩa, lợi ích, so sánh, evidence hoặc kết luận.',
          `- Mỗi đoạn chỉ phục vụ một claim, tối đa ${maxSentencesPerParagraph} câu. Không thêm section ngoài outline.`,
          `- TITLE phải chứa chính xác primary keyword “${getPrimaryKeyword(article)}”.`,
          '- Trả về DUY NHẤT JSON object đúng schema; không Markdown fences, lời dẫn hay nhật ký.',
        ].join('\n'),
        documentPromptRules,
      );
      const userPrompt = [
        `TÀI LIỆU STEP 4 (${describeBundle(bundle)}):`,
        bundle.totalCount
          ? 'Railway sẽ nạp các đoạn tài liệu liên quan nhất trong tài liệu được cấp quyền cho Bước 3 từ Supabase.'
          : 'Bước 3 không có tài liệu riêng; dùng evidence đã kiểm chứng trong outline Bước 2 làm nguồn.',
        '',
        'THÔNG TIN BÀI VIẾT:',
        `- Chủ đề: "${article.topic}"`,
        `- ARTICLE SPEC CONTRACT: ${JSON.stringify(article.articleSpec)}`,
        `- Angle: ${article.angle || ''}`,
        `- Độc giả: ${article.targetAudience || ''}`,
        `- Giọng văn: ${article.tone || ''}`,
        `- Từ khóa: ${article.keywords || ''}`,
        `- TARGET WORDS: ${wordBudget.wordTarget} từ tiếng Anh. Hãy chủ động viết trong vùng tối ưu ${wordBudget.targetMin}–${wordBudget.targetMax}; QC chấp nhận ${wordBudget.acceptedMin}–${wordBudget.acceptedMax}. Đây là target linh hoạt, không phải yêu cầu cắt câu hoặc bỏ kết luận.`,
        `- Introduction: ${wordBudget.introduction.min}–${wordBudget.introduction.max} từ`,
        `- Conclusion: ${wordBudget.conclusion.min}–${wordBudget.conclusion.max} từ`,
        `- Section budgets: ${JSON.stringify(wordBudget.sections)}`,
        `- RELEVANT APPROVED INTERNAL LINK CANDIDATES: ${JSON.stringify(selectInternalLinkCandidates(article, config.websiteInventory ?? [], 6))}`,
        '- Never invent a URL. Use only URLs in the approved inventory, and only when the Article Spec requires a relevant internal link.',
        '',
        'OUTLINE_STEP_3 VÀ EVIDENCE ĐÃ KIỂM CHỨNG:',
        JSON.stringify(verifiedOutline),
        '',
        'SCHEMA OUTPUT:',
        '{"title":string,"introduction":string,"sections":[{"id":string,"content":string,"usedEvidenceRefs":string[]}],"conclusion":string}',
        'Yêu cầu: Viết đủ đúng một entry cho mọi section ID theo đúng thứ tự. usedEvidenceRefs chỉ chứa ID được cấp cho chính section đó; để [] nếu section không dùng evidence. Không lặp nội dung giữa các field.',
        compiledWorkflowRules.taskGuidance,
      ].join('\n');

      const res = await callAI({
        articleId: article.id,
        model,
        railwayUrl,
        prompt: userPrompt,
        systemPrompt,
        stepNumber: 4,
        bypassCache: manual || Boolean(article.qualityReport && article.qualityReport.status !== 'pass'),
        maxTokens,
        temperature: 0.2,
        jsonMode: true,
        jsonSchema: structuredDraftSchema,
        contextQuery,
        skipDocumentContext: !bundle.totalCount,
      });
      rawResponseExcerpt = res.content.slice(0, 12_000);
      if (!res.content.trim()) throw new Error('AI trả về draft rỗng. Kết quả cũ vẫn được giữ nguyên.');
      let parsed: StructuredDraftPayload;
      try {
        parsed = parseAIJson(res.content) as StructuredDraftPayload;
      } catch {
        parsed = {};
      }
      const missingParts = missingStructuredParts(parsed, article);
      processTrace.push({
        id: `draft-validate-${Date.now()}`,
        stage: 'validation',
        status: missingParts.length ? 'warning' : 'completed',
        title: 'Validate structured response',
        detail: missingParts.length ? `Missing or incomplete fields: ${missingParts.join(', ')}.` : 'All required structured fields were returned.',
        facts: { missingFields: missingParts.join(', ') || 'none', responseCharacters: res.content.length },
      });
      if (missingParts.length) {
        const missingSectionIds = (article.outline ?? []).filter((section, index) => {
          const byId = new Map((parsed.sections ?? []).map(item => [item.id, item]));
          return !(byId.get(section.id) ?? parsed.sections?.[index])?.content?.trim();
        }).map(section => section.id);
        const repairResponse = await callAI({
          articleId: article.id,
          model,
          railwayUrl,
          stepNumber: 4,
          bypassCache: true,
          maxTokens: missingParts.includes('sections')
            ? Math.min(maxTokens, Math.max(1200, Math.ceil(maxTokens * Math.max(0.25, missingSectionIds.length / Math.max(article.outline?.length ?? 1, 1)))))
            : 700,
          temperature: 0.1,
          jsonMode: true,
          jsonSchema: repairSchemaFor(missingParts),
          contextQuery,
          skipDocumentContext: !bundle.totalCount,
          systemPrompt: [
            systemPrompt,
            'Repair only the missing structured-draft fields listed by the user. Return only those fields as one JSON object. Do not rewrite fields that already passed validation.',
          ].join('\n'),
          prompt: [
            `MISSING FIELDS: ${missingParts.join(', ')}`,
            missingSectionIds.length ? `MISSING SECTION IDS: ${missingSectionIds.join(', ')}` : '',
            `ARTICLE SPEC: ${JSON.stringify(article.articleSpec)}`,
            `OUTLINE: ${JSON.stringify(verifiedOutline)}`,
            `WORD BUDGET: ${JSON.stringify(wordBudget)}`,
            `FIELDS ALREADY RECEIVED: ${JSON.stringify({
              hasTitle: Boolean(parsed.title?.trim()),
              hasIntroduction: Boolean(parsed.introduction?.trim()),
              sectionIds: (parsed.sections ?? []).filter(item => item.content?.trim()).map(item => item.id),
              hasConclusion: Boolean(parsed.conclusion?.trim()),
            })}`,
          ].filter(Boolean).join('\n\n'),
        });
        rawResponseExcerpt = `${rawResponseExcerpt}\n\n--- TARGETED REPAIR RESPONSE ---\n${repairResponse.content.slice(0, 6_000)}`.slice(0, 18_000);
        const repaired = parseAIJson(repairResponse.content) as StructuredDraftPayload;
        parsed = mergeStructuredDraft(parsed, repaired, article);
        const remaining = missingStructuredParts(parsed, article);
        processTrace.push({
          id: `draft-repair-${Date.now()}`,
          stage: 'repair',
          status: remaining.length ? 'failed' : 'completed',
          title: 'Targeted field repair',
          detail: remaining.length ? `Repair still missing: ${remaining.join(', ')}.` : `Recovered only the missing fields: ${missingParts.join(', ')}.`,
          facts: { repairedFields: missingParts.join(', '), remainingFields: remaining.join(', ') || 'none' },
        });
      }
      let assembledDraft = parseStructuredDraft(JSON.stringify(parsed), article);
      let evidenceUsage = getDraftEvidenceUsage(parsed, article);
      sessionStorage.setItem(recoveryKey, assembledDraft);
      setRecoveryDraft(assembledDraft);
      if (editorRef.current) editorRef.current.innerText = assembledDraft;
      const checkpointSaved = await onUpdate({
        draft: assembledDraft,
        draftEvidenceUsage: evidenceUsage,
        qualityReport: null,
        draftSourceFingerprint,
        draftScannedAt: res.servedAt ?? res.generatedAt ?? new Date().toISOString(),
        step4ProcessTrace: processTrace,
        step4RawResponseExcerpt: rawResponseExcerpt,
        workflowRuleSnapshots: { ...article.workflowRuleSnapshots, 4: compiledWorkflowRules.snapshot },
      });
      if (!checkpointSaved) throw new Error('Draft đã được giữ tạm trên thiết bị nhưng chưa thể lưu checkpoint vào Supabase. Hãy kiểm tra kết nối rồi thử lưu lại; không cần gọi AI lại ngay.');
      const validation = evaluateSeoChecklist(assembledDraft, article, targetWords);
      if (validation.failed.length) throw new Error(`Draft đã được lưu để chỉnh sửa nhưng chưa đạt 100% SEO checklist (${validation.wordCount}/${targetWords} từ): ${validation.failed.map(item => item.label).join(', ')}.`);
      let deterministic = [
        ...deterministicQualityChecks(article, assembledDraft, targetWords, config.websiteInventory ?? [], files.filter(file => !file.knowledgeMetadata?.approvedForExternalUse).map(file => file.name)),
        ...evidenceMappingChecks(article, evidenceUsage, verifiedOutline),
      ];
      if (deterministic.some(item => item.status === 'fail')) {
        const report = qualityReport(article, deterministic);
        await onUpdate({ qualityReport: report });
        throw new Error(`Draft đã được lưu nhưng Universal Quality Gate chưa đạt: ${deterministic.filter(item => item.status === 'fail').map(item => `${item.label} — ${item.reason}`).join('; ')}.`);
      }
      const runSemanticReview = async (candidate: string, candidateUsage: Record<string, string[]>) => {
        const requestReview = (recovery = false) => callAI({
          articleId: article.id,
          model,
          railwayUrl,
          stepNumber: 4,
          bypassCache: recovery || manual || Boolean(article.qualityReport && article.qualityReport.status !== 'pass'),
          maxTokens: 1400,
          temperature: 0,
          jsonMode: true,
          jsonSchema: semanticQualitySchema,
          skipDocumentContext: true,
          systemPrompt: 'You are a strict publishing quality reviewer. Evaluate the supplied Article Spec, approved evidence registry, section-to-evidence mapping and draft. Visible citations, footnotes, filenames and evidence IDs are not required in the prose. Evidence support passes when concrete claims are supported by the supplied evidence and declared mapping; do not penalize general explanatory prose for lacking a citation. Return JSON only. Do not rewrite the article.',
          prompt: [
            `ARTICLE SPEC: ${JSON.stringify(article.articleSpec)}`,
            `APPROVED EVIDENCE REGISTRY: ${JSON.stringify(verifiedOutline.evidenceRegistry)}`,
            `OUTLINE EVIDENCE MAPPING: ${JSON.stringify(verifiedOutline.sections.map(section => ({ id: section.id, evidenceRefs: section.evidenceRefs })))}`,
            `DRAFT EVIDENCE USAGE: ${JSON.stringify(candidateUsage)}`,
            `DRAFT: ${candidate}`,
            semanticReviewInstruction(article, candidate),
            recovery ? 'The prior reviewer report was structurally incomplete. Return a fresh complete report.' : '',
            `Return checks as an object containing exactly these keys: ${semanticCheckIds.join(', ')}. Use warning only for a genuine publish-quality concern; use fail for a blocking unsupported claim or contract violation.`,
          ].join('\n\n'),
        });
        const first = await requestReview();
        try {
          return { response: first, checks: parseSemanticQuality(first.content) };
        } catch {
          const recovered = await requestReview(true);
          return { response: recovered, checks: parseSemanticQuality(recovered.content) };
        }
      };
      let semanticReview = await runSemanticReview(assembledDraft, evidenceUsage);
      const semantic = semanticReview.checks;
      let report = qualityReport(article, [...deterministic, ...semantic]);
      processTrace.push({
        id: `draft-semantic-${Date.now()}`,
        stage: 'validation',
        status: report.status === 'pass' ? 'completed' : 'warning',
        title: 'Evidence-aware semantic review',
        detail: report.status === 'pass' ? 'All semantic publishing checks passed.' : `Targeted repair required for: ${semantic.filter(item => item.status !== 'pass').map(item => item.label).join(', ')}.`,
      });
      if (report.status !== 'pass') {
        await onUpdate({ qualityReport: report });
        const failedChecks = report.checks.filter(item => item.kind === 'semantic' && item.status !== 'pass');
        const repairResponse = await callAI({
          articleId: article.id,
          model,
          railwayUrl,
          stepNumber: 4,
          bypassCache: true,
          maxTokens,
          temperature: 0.1,
          jsonMode: true,
          jsonSchema: structuredDraftSchema,
          contextQuery,
          skipDocumentContext: !bundle.totalCount,
          systemPrompt: [systemPrompt, 'Revise only what is necessary to resolve the supplied semantic findings. Preserve every outline section ID and heading. Return the complete structured draft JSON so it can be validated deterministically.'].join('\n'),
          prompt: [
            `SEMANTIC FINDINGS: ${JSON.stringify(failedChecks)}`,
            `CURRENT STRUCTURED DRAFT: ${JSON.stringify(parsed)}`,
            `ARTICLE SPEC: ${JSON.stringify(article.articleSpec)}`,
            `APPROVED OUTLINE AND EVIDENCE: ${JSON.stringify(verifiedOutline)}`,
            `WORD BUDGET: ${JSON.stringify(wordBudget)}`,
          ].join('\n\n'),
        });
        rawResponseExcerpt = `${rawResponseExcerpt}\n\n--- SEMANTIC REPAIR ---\n${repairResponse.content.slice(0, 8_000)}`.slice(0, 20_000);
        parsed = parseAIJson(repairResponse.content) as StructuredDraftPayload;
        const remainingParts = missingStructuredParts(parsed, article);
        if (remainingParts.length) throw new Error(`Draft đã được lưu; semantic repair trả thiếu: ${remainingParts.join(', ')}.`);
        assembledDraft = parseStructuredDraft(JSON.stringify(parsed), article);
        evidenceUsage = getDraftEvidenceUsage(parsed, article);
        sessionStorage.setItem(recoveryKey, assembledDraft);
        setRecoveryDraft(assembledDraft);
        const repairedValidation = evaluateSeoChecklist(assembledDraft, article, targetWords);
        deterministic = [
          ...deterministicQualityChecks(article, assembledDraft, targetWords, config.websiteInventory ?? [], files.filter(file => !file.knowledgeMetadata?.approvedForExternalUse).map(file => file.name)),
          ...evidenceMappingChecks(article, evidenceUsage, verifiedOutline),
        ];
        const repairedSaved = await onUpdate({ draft: assembledDraft, draftEvidenceUsage: evidenceUsage, qualityReport: null, draftSourceFingerprint, step4RawResponseExcerpt: rawResponseExcerpt });
        if (!repairedSaved) throw new Error('Semantic repair đã tạo xong nhưng chưa thể lưu vào Supabase.');
        if (editorRef.current) editorRef.current.innerText = assembledDraft;
        if (repairedValidation.failed.length || deterministic.some(item => item.status === 'fail')) {
          report = qualityReport(article, deterministic);
          await onUpdate({ qualityReport: report });
          throw new Error(`Draft đã được lưu nhưng bản sửa semantic chưa đạt kiểm tra deterministic: ${[...repairedValidation.failed.map(item => item.label), ...deterministic.filter(item => item.status === 'fail').map(item => item.label)].join(', ')}.`);
        }
        semanticReview = await runSemanticReview(assembledDraft, evidenceUsage);
        report = qualityReport(article, [...deterministic, ...semanticReview.checks]);
        processTrace.push({
          id: `draft-semantic-recheck-${Date.now()}`,
          stage: 'validation',
          status: report.status === 'pass' ? 'completed' : 'failed',
          title: 'Semantic repair recheck',
          detail: report.status === 'pass' ? 'The targeted repair passed all quality gates.' : 'The repaired draft was saved, but one or more semantic checks still require editorial review.',
        });
        if (report.status !== 'pass') {
          await onUpdate({ qualityReport: report });
          throw new Error(`Draft đã được lưu để review; Semantic Quality Gate còn cảnh báo: ${report.checks.filter(item => item.status !== 'pass').map(item => item.label).join(', ')}.`);
        }
      }
      const saved = await onUpdate({
        draft: assembledDraft,
        draftEvidenceUsage: evidenceUsage,
        qualityReport: report,
        draftSourceFingerprint,
        draftScannedAt: res.servedAt ?? res.generatedAt ?? new Date().toISOString(),
        step4ProcessTrace: processTrace,
        step4RawResponseExcerpt: rawResponseExcerpt,
        workflowRuleSnapshots: { ...article.workflowRuleSnapshots, 4: compiledWorkflowRules.snapshot },
      });
      if (!saved) throw new Error('Draft Bước 3 chưa được lưu vào Supabase.');
      if (editorRef.current) editorRef.current.innerText = assembledDraft;
      notifyWorkspace(manual && draft ? 'Đã viết lại, kiểm tra và lưu draft.' : 'Đã tạo, kiểm tra và lưu draft.', 'success');
    } catch (err) {
      processTrace.push({
        id: `draft-failure-${Date.now()}`,
        stage: 'validation',
        status: 'failed',
        title: 'Draft rejected safely',
        detail: err instanceof Error ? err.message : String(err),
      });
      try {
        await onUpdate({ step4ProcessTrace: processTrace, step4RawResponseExcerpt: rawResponseExcerpt || null });
      } catch {
        // Preserve the original generation error even if diagnostic persistence fails.
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      generationInFlight.current = false;
      setGenerating(false);
    }
  };

  const handleRecheckAndFix = async () => {
    if (!draft.trim() || generationInFlight.current) return;
    generationInFlight.current = true;
    setRepairing(true);
    setError('');
    const processTrace: AIProcessTraceEvent[] = [...(article.step4ProcessTrace ?? []), {
      id: `draft-recheck-request-${Date.now()}`,
      stage: 're-check',
      status: 'completed',
      title: 'Re-check & Fix requested',
      detail: 'Started deterministic audit, targeted repair and semantic verification without rewriting the full draft.',
      facts: { model: model.id, provider: model.provider, targetWords },
    }];
    try {
      const inventory = config.websiteInventory ?? [];
      const candidates = selectInternalLinkCandidates(article, inventory, 6);
      let candidateDraft = draft;
      let linkAudit = auditInternalLinks(article, candidateDraft, inventory);

      // URL-only failures can be repaired deterministically without spending AI
      // credits: normalize an invalid same-site target to the best approved
      // candidate, or add one relevant approved link when the spec requires it.
      if (candidates.length) {
        for (const invalidUrl of linkAudit.unapprovedUrls)
          candidateDraft = candidateDraft.split(invalidUrl).join(candidates[0].url);
        linkAudit = auditInternalLinks(article, candidateDraft, inventory);
        if (linkAudit.required && !linkAudit.approvedDraftUrls.length) {
          const selected = candidates[0];
          const anchor = selected.suggestedAnchors?.[0] || selected.title;
          const safeAnchor = anchor.replace(/[\[\]]/g, '');
          candidateDraft = applyTargetedDraftRepair(candidateDraft, {
            appendBeforeConclusion: `For related guidance, see [${safeAnchor}](${selected.url}).`,
          });
        }
      }

      const verifiedOutline = buildVerifiedOutlineContext(article.outline || []);
      const sourceNames = files.filter(file => !file.knowledgeMetadata?.approvedForExternalUse).map(file => file.name);
      const check = (value: string) => [
        ...deterministicQualityChecks(article, value, targetWords, inventory, sourceNames),
        ...evidenceMappingChecks(article, article.draftEvidenceUsage ?? {}, verifiedOutline),
      ];
      let deterministic = check(candidateDraft);
      let seo = evaluateSeoChecklist(candidateDraft, article, targetWords);
      const priorSemantic = (article.qualityReport?.checks ?? []).filter(item => item.kind === 'semantic');
      let findings = [
        ...seo.failed.map(item => ({ label: item.label, reason: item.label })),
        ...deterministic.filter(item => item.status === 'fail').map(item => ({ label: item.label, reason: item.reason })),
      ];
      processTrace.push({
        id: `draft-recheck-audit-${Date.now()}`,
        stage: 'validation',
        status: findings.length ? 'warning' : 'completed',
        title: 'Deterministic audit',
        detail: findings.length ? `Found: ${findings.map(item => item.label).join(', ')}.` : 'SEO, structure, evidence mapping and approved-link checks passed.',
        facts: { failedChecks: findings.length, approvedLinks: auditInternalLinks(article, candidateDraft, inventory).approvedDraftUrls.length },
      });

      if (findings.length) {
        const unresolvedLinkOnly = findings.every(item => item.label === 'Approved internal links') && !candidates.length;
        if (unresolvedLinkOnly) {
          const report = qualityReport(article, [...deterministic, ...priorSemantic]);
          await onUpdate({ draft: candidateDraft, qualityReport: report });
          throw new Error('Không có URL phù hợp đang được approved trong Website Inventory để sửa internal link.');
        }
        const repairResponse = await callAI({
          articleId: article.id,
          model,
          railwayUrl,
          stepNumber: 4,
          bypassCache: true,
          requestPurpose: 'recheck',
          maxTokens: 1800,
          temperature: 0,
          jsonMode: true,
          jsonSchema: targetedDraftRepairSchema,
          skipDocumentContext: true,
          systemPrompt: 'You are a surgical draft editor. Fix only the supplied failed checks. Return compact exact-text replacement operations, not a rewritten article. Every find value must be copied verbatim from the current draft. Never invent URLs; use only approved candidates supplied by the user.',
          prompt: [
            `FAILED CHECKS: ${JSON.stringify(findings)}`,
            `ARTICLE SPEC: ${JSON.stringify(article.articleSpec)}`,
            `APPROVED INTERNAL LINK CANDIDATES: ${JSON.stringify(candidates)}`,
            `TARGET WORDS: ${targetWords}`,
            `CURRENT DRAFT:\n${candidateDraft}`,
            'Return at most 8 minimal find/replace edits. Use appendBeforeConclusion only when adding a short missing passage. Preserve headings and all unaffected prose.',
          ].join('\n\n'),
        });
        const beforeRepair = candidateDraft;
        candidateDraft = applyTargetedDraftRepair(candidateDraft, parseAIJson(repairResponse.content) as TargetedDraftRepair);
        processTrace.push({
          id: `draft-recheck-deterministic-repair-${Date.now()}`,
          stage: 'repair',
          status: candidateDraft === beforeRepair ? 'failed' : 'completed',
          title: 'Targeted deterministic repair',
          detail: candidateDraft === beforeRepair ? 'The returned patch did not match any exact draft text.' : 'Applied a local patch only to failed deterministic checks.',
          facts: { draftChanged: candidateDraft !== beforeRepair },
        });
        deterministic = check(candidateDraft);
        seo = evaluateSeoChecklist(candidateDraft, article, targetWords);
        findings = [
          ...seo.failed.map(item => ({ label: item.label, reason: item.label })),
          ...deterministic.filter(item => item.status === 'fail').map(item => ({ label: item.label, reason: item.reason })),
        ];
        if (findings.length) {
          const report = qualityReport(article, deterministic);
          await onUpdate({ draft: candidateDraft, qualityReport: report, draftSourceFingerprint });
          if (editorRef.current) editorRef.current.innerText = candidateDraft;
          throw new Error(`Bản sửa cục bộ đã được lưu nhưng còn lỗi: ${findings.map(item => item.label).join(', ')}.`);
        }
      }

      const reviewSemantic = async (value: string) => {
        const requestReview = (recovery = false) => callAI({
          articleId: article.id,
          model,
          railwayUrl,
          stepNumber: 4,
          bypassCache: true,
          requestPurpose: 'recheck',
          maxTokens: 1400,
          temperature: 0,
          jsonMode: true,
          jsonSchema: semanticQualitySchema,
          skipDocumentContext: true,
          systemPrompt: 'You are a strict publishing quality reviewer. Re-check the repaired draft against the Article Spec and evidence mapping. Return JSON only; do not rewrite the article.',
          prompt: [
            `ARTICLE SPEC: ${JSON.stringify(article.articleSpec)}`,
            `APPROVED EVIDENCE REGISTRY: ${JSON.stringify(verifiedOutline.evidenceRegistry)}`,
            `DRAFT EVIDENCE USAGE: ${JSON.stringify(article.draftEvidenceUsage ?? {})}`,
            `DRAFT: ${value}`,
            semanticReviewInstruction(article, value),
            recovery ? 'The prior reviewer report was structurally incomplete. Return a fresh report using every required object key exactly once.' : '',
            `Return checks as an object containing exactly these keys: ${semanticCheckIds.join(', ')}.`,
          ].join('\n\n'),
        });
        const first = await requestReview();
        try {
          return parseSemanticQuality(first.content);
        } catch {
          const recovered = await requestReview(true);
          return parseSemanticQuality(recovered.content);
        }
      };

      let semantic = await reviewSemantic(candidateDraft);
      const semanticFindings = semantic
        .filter(item => item.status !== 'pass')
        .map(item => ({ label: item.label, reason: item.reason, location: item.location, recommendedAction: item.recommendedAction }));
      processTrace.push({
        id: `draft-recheck-semantic-${Date.now()}`,
        stage: 'validation',
        status: semanticFindings.length ? 'warning' : 'completed',
        title: 'Semantic quality audit',
        detail: semanticFindings.length
          ? semanticFindings.map(item => `${item.label}: ${item.reason}${item.location ? ` (${item.location})` : ''}`).join('\n')
          : 'All six semantic publishing checks passed.',
        facts: { failedOrWarningChecks: semanticFindings.length },
      });

      if (semanticFindings.length) {
        const repairResponse = await callAI({
          articleId: article.id,
          model,
          railwayUrl,
          stepNumber: 4,
          bypassCache: true,
          requestPurpose: 'recheck',
          maxTokens: 1800,
          temperature: 0,
          jsonMode: true,
          jsonSchema: targetedDraftRepairSchema,
          skipDocumentContext: true,
          systemPrompt: 'You are a surgical draft editor. Fix only the supplied semantic findings. Return compact exact-text replacement operations, never a rewritten article. Every find value must be copied verbatim from the current draft. Preserve headings, verified claims and approved URLs.',
          prompt: [
            `SEMANTIC FINDINGS: ${JSON.stringify(semanticFindings)}`,
            `ARTICLE SPEC: ${JSON.stringify(article.articleSpec)}`,
            `APPROVED EVIDENCE REGISTRY: ${JSON.stringify(verifiedOutline.evidenceRegistry)}`,
            `TARGET WORDS: ${targetWords}`,
            `CURRENT DRAFT:\n${candidateDraft}`,
            'Return at most 8 minimal operations that directly resolve the findings.',
          ].join('\n\n'),
        });
        const beforeSemanticRepair = candidateDraft;
        candidateDraft = applyTargetedDraftRepair(candidateDraft, parseAIJson(repairResponse.content) as TargetedDraftRepair);
        const semanticDraftChanged = candidateDraft !== beforeSemanticRepair;
        processTrace.push({
          id: `draft-recheck-semantic-repair-${Date.now()}`,
          stage: 'repair',
          status: semanticDraftChanged ? 'completed' : 'failed',
          title: 'Targeted semantic repair',
          detail: semanticDraftChanged ? `Applied focused edits for: ${semanticFindings.map(item => item.label).join(', ')}.` : 'The reviewer identified issues, but the repair response produced no applicable exact-text edits.',
          facts: { draftChanged: semanticDraftChanged, targetedChecks: semanticFindings.length },
        });
        if (!semanticDraftChanged) {
          const report = qualityReport(article, [...deterministic, ...semantic]);
          await onUpdate({ qualityReport: report, step4ProcessTrace: processTrace });
          throw new Error(`Không áp dụng được bản sửa cục bộ. Hãy xem AI log để kiểm tra vị trí và đề xuất của: ${semanticFindings.map(item => item.label).join(', ')}.`);
        }
        deterministic = check(candidateDraft);
        seo = evaluateSeoChecklist(candidateDraft, article, targetWords);
        const remainingDeterministic = [
          ...seo.failed.map(item => item.label),
          ...deterministic.filter(item => item.status === 'fail').map(item => item.label),
        ];
        if (remainingDeterministic.length) {
          const report = qualityReport(article, deterministic);
          await onUpdate({ draft: candidateDraft, qualityReport: report, draftSourceFingerprint });
          if (editorRef.current) editorRef.current.innerText = candidateDraft;
          throw new Error(`Bản sửa semantic đã được lưu nhưng tạo ra lỗi cần xử lý: ${remainingDeterministic.join(', ')}.`);
        }
        semantic = await reviewSemantic(candidateDraft);
        const remainingSemantic = semantic.filter(item => item.status !== 'pass');
        processTrace.push({
          id: `draft-recheck-verification-${Date.now()}`,
          stage: 'verification',
          status: remainingSemantic.length ? 'warning' : 'completed',
          title: 'Post-repair verification',
          detail: remainingSemantic.length
            ? remainingSemantic.map(item => `${item.label}: ${item.reason}${item.recommendedAction ? ` Action: ${item.recommendedAction}` : ''}`).join('\n')
            : 'The repaired draft passed deterministic and semantic verification.',
          facts: { remainingChecks: remainingSemantic.length },
        });
      }

      const report = qualityReport(article, [...deterministic, ...semantic]);
      processTrace.push({
        id: `draft-recheck-result-${Date.now()}`,
        stage: 're-check',
        status: report.status === 'pass' ? 'completed' : 'warning',
        title: 'Re-check & Fix completed',
        detail: report.status === 'pass'
          ? 'The draft passed every deterministic and semantic check.'
          : report.checks.filter(item => item.status !== 'pass').map(item => `${item.label}: ${item.reason}${item.recommendedAction ? ` Action: ${item.recommendedAction}` : ''}`).join('\n'),
        facts: { result: report.status, passedChecks: report.checks.filter(item => item.status === 'pass').length, totalChecks: report.checks.length },
      });
      await onUpdate({ draft: candidateDraft, qualityReport: report, draftSourceFingerprint, step4ProcessTrace: processTrace });
      if (editorRef.current) editorRef.current.innerText = candidateDraft;
      if (report.status === 'pass') notifyWorkspace('Re-check & Fix hoàn tất. Draft đã vượt qua toàn bộ checklist.', 'success');
      if (report.status !== 'pass')
        throw new Error(`Re-check hoàn tất nhưng còn mục cần review: ${report.checks.filter(item => item.status !== 'pass').map(item => `${item.label} — ${item.reason}${item.recommendedAction ? `; đề xuất: ${item.recommendedAction}` : ''}`).join(' | ')}.`);
    } catch (err) {
      processTrace.push({
        id: `draft-recheck-result-${Date.now()}`,
        stage: 're-check',
        status: 'failed',
        title: 'Re-check requires attention',
        detail: err instanceof Error ? err.message : String(err),
      });
      try { await onUpdate({ step4ProcessTrace: processTrace }); } catch { /* Preserve the original error. */ }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      generationInFlight.current = false;
      setRepairing(false);
    }
  };

  const handleEditorInput = () => {
    if (editorRef.current) {
      pendingDraft.current = editorRef.current.innerText;
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
      draftSaveTimer.current = setTimeout(() => {
        if (pendingDraft.current !== null) onUpdateRef.current({ draft: pendingDraft.current, qualityReport: null, draftSourceFingerprint: null });
        pendingDraft.current = null;
        draftSaveTimer.current = null;
      }, 700);
    }
  };

  useEffect(() => () => {
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    if (pendingDraft.current !== null) onUpdateRef.current({ draft: pendingDraft.current, qualityReport: null, draftSourceFingerprint: null });
  }, []);

  useEffect(() => {
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightConstructor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const root = editorRef.current;
    if (!registry || !HighlightConstructor || !root) return;
    const names = ['draft-heading', 'draft-keyword', 'draft-evidence', 'draft-attention'];
    names.forEach(name => registry.delete(name));
    if (!draft || !highlightsEnabled) return;
    const highlightStyles = document.createElement('style');
    highlightStyles.textContent = `
      ::highlight(draft-heading){color:#f1f1f1;background-color:#343434}
      ::highlight(draft-evidence){color:#dedede;background-color:#303030}
      ::highlight(draft-attention){color:#ffffff;background-color:#3a3a3a}
      .writer-light ::highlight(draft-heading){color:#30302d;background-color:#deded9}
      .writer-light ::highlight(draft-evidence){color:#444440;background-color:#e8e8e4}
      .writer-light ::highlight(draft-attention){color:#242422;background-color:#d5d5cf}
    `;
    document.head.appendChild(highlightStyles);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Array<{ node: Text; start: number; end: number }> = [];
    let text = '';
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const start = text.length;
      text += node.data;
      nodes.push({ node, start, end: text.length });
    }
    const rangesFor = (matches: Array<{ start: number; end: number }>) => matches.flatMap(match => {
      const startNode = nodes.find(item => match.start >= item.start && match.start <= item.end);
      const endNode = [...nodes].reverse().find(item => match.end >= item.start && match.end <= item.end);
      if (!startNode || !endNode || match.end <= match.start) return [];
      const range = new Range();
      range.setStart(startNode.node, Math.min(match.start - startNode.start, startNode.node.length));
      range.setEnd(endNode.node, Math.min(match.end - endNode.start, endNode.node.length));
      return [range];
    });
    const regexMatches = (regex: RegExp) => [...text.matchAll(regex)].map(match => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }));
    const headingMatches = regexMatches(/^#{1,3}\s+.+$/gm);
    const evidenceMatches = regexMatches(/^>\s+.+$/gm);
    const attentionMatches = regexMatches(/\[Cần bổ sung dữ liệu\]/gi);
    const reserved = [...headingMatches, ...evidenceMatches, ...attentionMatches];
    const groups = {
      'draft-heading': rangesFor(headingMatches),
      'draft-evidence': rangesFor(evidenceMatches),
      'draft-attention': rangesFor(attentionMatches),
    };
    Object.entries(groups).forEach(([name, ranges]) => { if (ranges.length) registry.set(name, new HighlightConstructor(...ranges)); });
    return () => { names.forEach(name => registry.delete(name)); highlightStyles.remove(); };
  }, [article, draft, highlightsEnabled]);

  const handleCopy = () => {
    navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyGoogleDocs = async () => {
    if (!draft || formatCopying) return;
    setFormatCopying(true);
    setError('');
    try {
      const baseUrl = railwayUrl.trim().replace(/\/$/, '') || window.location.origin;
      const response = await fetch(`${baseUrl}/api/format/google-docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draft,
          title: article.title || article.topic || '',
          outline: (article.outline ?? []).map(section => ({ heading: section.heading, level: section.level })),
        }),
      });
      const payload = await response.json().catch(() => ({ error: response.statusText }));
      if (!response.ok) throw new Error(payload.error || `Railway formatter error ${response.status}`);
      if (navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([payload.html], { type: 'text/html' }),
          'text/plain': new Blob([payload.markdown], { type: 'text/plain' }),
        })]);
      } else {
        await navigator.clipboard.writeText(payload.markdown);
      }
      setFormatCopied(true);
      setTimeout(() => setFormatCopied(false), 2500);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    } finally {
      setFormatCopying(false);
    }
  };

  return (
    <div className={`minimal-step flex flex-col gap-4 animate-fade-in-up ${embedded ? 'continuous-step' : 'h-full'}`}>
      <div className={`draft-workspace-shell minimal-step-shell flex flex-col ${embedded ? '' : 'min-h-0 flex-1'}`}>
        <div className={`mx-auto flex w-full max-w-4xl flex-col gap-3 p-2 sm:p-3 ${embedded ? '' : 'min-h-0 flex-1 overflow-y-auto lg:flex-row lg:overflow-hidden'}`}>

          {/* Editor panel */}
          <div className={`draft-editor flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white ${embedded ? 'min-h-[60dvh]' : 'min-h-[55dvh] lg:min-h-0'}`}>
            {/* Editor toolbar */}
            <div className="draft-toolbar flex flex-col justify-between gap-2 border-b border-slate-100 px-3 py-2.5 sm:flex-row sm:items-center sm:px-4">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-800">{tr('Bước 3: Bản nháp & Kiểm tra', 'Step 3: First Draft & Audit')}</h2>
                <p className="text-[10px] text-slate-400">{article.title || 'Bài viết mới'}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowAudit(true)}
                  disabled={!article.step4ProcessTrace?.length}
                  title={tr('Xem nhật ký AI', 'View AI log')}
                  className="draft-toolbar-action"
                  aria-label={tr('Xem nhật ký AI', 'View AI log')}
                >
                  <Eye className="app-icon" aria-hidden="true" />
                  <span className="sr-only">{tr('Xem nhật ký AI', 'View AI log')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setHighlightsEnabled(enabled => !enabled)}
                  disabled={!draft || generating || repairing}
                  aria-pressed={highlightsEnabled}
                  title={tr(highlightsEnabled ? 'Ẩn điểm nhấn trong bài' : 'Hiện điểm nhấn trong bài', highlightsEnabled ? 'Hide article highlights' : 'Show article highlights')}
                  className={`draft-toolbar-action ${highlightsEnabled ? 'is-active' : ''}`}
                >
                  <Highlighter className="app-icon" aria-hidden="true" />
                  <span className="sr-only">{tr('Bật hoặc tắt điểm nhấn', 'Toggle highlights')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleRecheckAndFix()}
                  disabled={!draft || generating || repairing}
                  title={tr('Kiểm tra lại và chỉ sửa các mục chưa đạt', 'Re-check and fix only failed checks')}
                  className="draft-toolbar-action"
                  aria-label={tr('Kiểm tra lại và sửa', 'Re-check and fix')}
                >
                  <RefreshCw className={`app-icon ${repairing ? 'animate-spin' : ''}`} aria-hidden="true" />
                  <span className="sr-only">{repairing ? tr('Đang sửa…', 'Fixing…') : tr('Kiểm tra lại và sửa', 'Re-check and fix')}</span>
                </button>
                <button
                  onClick={() => handleGenerate(Boolean(draft))}
                  disabled={generating || repairing || !prerequisite.allowed}
                  title={!prerequisite.allowed ? tr(prerequisite.reasonVi, prerequisite.reason) : draft ? tr('Viết lại toàn bộ draft', 'Rewrite the full draft') : tr('AI viết draft', 'Generate draft with AI')}
                  className="draft-toolbar-action"
                  aria-label={draft ? tr('Viết lại toàn bộ draft', 'Rewrite the full draft') : tr('AI viết draft', 'Generate draft with AI')}
                >
                  {generating ? (
                    <LoaderCircle className="app-icon animate-spin" aria-hidden="true" />
                    ) : <Sparkles className="app-icon" aria-hidden="true" />}
                  <span className="sr-only">{generating ? tr('Đang viết...', 'Writing...') : draft ? tr('Viết lại', 'Rewrite') : tr('AI viết draft', 'AI draft')}</span>
                </button>
                <button
                  onClick={handleCopy}
                  disabled={!draft}
                  title={copied ? tr('Đã sao chép', 'Copied') : tr('Sao chép draft', 'Copy draft')}
                  aria-label={copied ? tr('Đã sao chép', 'Copied') : tr('Sao chép draft', 'Copy draft')}
                  className="draft-toolbar-action"
                >
                  {copied ? <Check className="app-icon" aria-hidden="true" /> : <Copy className="app-icon" aria-hidden="true" />}
                  <span className="sr-only">{copied ? tr('Đã sao chép', 'Copied') : tr('Sao chép draft', 'Copy draft')}</span>
                </button>
              </div>
            </div>

            {/* Draft editor */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-5">
              {generating ? (
                <div className="space-y-3">
                  {[...Array(12)].map((_, i) => (
                    <div key={i} className="ai-loading h-4" style={{ width: `${60 + Math.random() * 40}%` }} />
                  ))}
                </div>
              ) : (
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={handleEditorInput}
                  data-placeholder={tr("Nhấn 'AI Viết Draft' để tạo nội dung, hoặc bắt đầu viết thủ công...", "Click 'AI Draft' to generate content, or start writing manually...")}
                  className="draft-prose prose-editor min-h-full whitespace-pre-wrap"
                >
                  {highlightsEnabled
                    ? renderKeywordMarks(draft, [getPrimaryKeyword(article), ...(article.keywords || '').split(',')])
                    : draft || ''}
                </div>
              )}
            </div>

            {/* Word count bar */}
            <div className="px-5 py-2.5 border-t border-slate-100">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-slate-500">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono font-semibold">
                  <span>{wordCount.toLocaleString()} {tr('từ tiếng Anh', 'English words')}</span>
                  <span>Target {targetWords.toLocaleString()}</span>
                  <span>QC range {Math.max(800, Math.ceil(targetWords * 0.85)).toLocaleString()}–{Math.floor(targetWords * 1.15).toLocaleString()}</span>
                  <span>{draft.length.toLocaleString()} {tr('ký tự', 'characters')}</span>
                </div>
                <span>{progress}% {tr('hoàn thành', 'complete')}</span>
              </div>
              <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="draft-progress-fill h-full rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>

          {/* Audit panel */}
          <aside className={`draft-insights grid w-full shrink-0 grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-white ${embedded ? '' : 'lg:min-h-0 lg:w-[236px] lg:overflow-y-auto lg:overscroll-contain'}`}>
            <nav className="draft-insight-tabs" aria-label={tr('Thông tin kiểm tra draft', 'Draft inspector')}>
              {([
                ['analysis', tr('Phân tích', 'Analysis')],
                ['quality', 'QC'],
                ['keywords', tr('Từ khóa', 'Keywords')],
              ] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setInsightPanel(key)} className={`draft-insight-tab ${insightPanel === key ? 'is-active' : ''}`}>{label}</button>
              ))}
            </nav>
            {/* Readability */}
            {insightPanel === 'analysis' && <section className="draft-insight-panel space-y-3 p-3">
              <h3 className="text-[11px] font-medium text-slate-800">{tr('Phân tích nội dung', 'Content analysis')}</h3>
              <div className="space-y-2">
                <div>
                  <div className="mb-1.5 flex justify-between text-[10px]">
                    <span className="text-slate-500">{tr('Độ dễ đọc', 'Readability')}</span>
                    <span className="font-medium text-slate-600">{readability
                      ? tr(readability.label, readability.score >= 90 ? 'Very easy' : readability.score >= 75 ? 'Easy' : readability.score >= 60 ? 'Medium' : 'Difficult')
                      : '—'}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="draft-readability-progress h-full rounded-full transition-all" style={{ width: `${readability?.score || 0}%` }} />
                  </div>
                </div>

                <div className="divide-y divide-slate-100 border-t border-slate-100 pt-1">
                  <div className="flex items-center justify-between py-1 text-[10px]"><span className="text-slate-500">{tr('Số từ', 'Words')}</span><b className="font-mono font-medium text-slate-700">{wordCount.toLocaleString()}</b></div>
                  <div className="flex items-center justify-between py-1 text-[10px]"><span className="text-slate-500">{tr('Số đoạn', 'Paragraphs')}</span><b className="font-mono font-medium text-slate-700">{draft.split('\n\n').filter(p => p.trim()).length}</b></div>
                  <div className="flex items-center justify-between py-1 text-[10px]"><span className="text-slate-500">{tr('Số ký tự', 'Characters')}</span><b className="font-mono font-medium text-slate-700">{draft.length.toLocaleString()}</b></div>
                </div>
              </div>
            </section>}

            {/* Universal Quality Gate */}
            {insightPanel === 'quality' && <section className="draft-insight-panel space-y-2.5 p-3">
              <div className="flex items-center justify-between"><h3 className="text-[11px] font-medium text-slate-800">Universal QC</h3><span className={`seo-score-tag rounded-full border px-2 py-0.5 text-[9px] font-medium ${seoChecklistPassed ? 'is-pass' : ''}`}>{displayedQualityChecks.filter(item => item.status === 'pass').length}/{displayedQualityChecks.length}</span></div>
              <div className="space-y-1.5">
                {displayedQualityChecks.map(item => (
                  <div key={item.id} className="flex items-start gap-2" title={item.reason}>
                    {item.status === 'pass'
                      ? <span className="seo-check-icon is-pass flex h-4 w-4 shrink-0 items-center justify-center rounded-full" aria-hidden="true"><Check className="app-icon" /></span>
                      : <CircleX className="seo-check-icon app-icon shrink-0" aria-hidden="true" />}
                    <span className={`text-[10px] leading-snug ${item.status === 'pass' ? 'text-slate-600' : 'text-slate-400'}`}>{item.label}</span>
                  </div>
                ))}
              </div>
            </section>}

            {/* Keyword density */}
            {insightPanel === 'keywords' && keywordStats.length > 0 && (
              <section className="draft-insight-panel space-y-2.5 p-3">
                <h3 className="text-[11px] font-medium text-slate-800">{tr('Mật độ từ khóa', 'Keyword density')}</h3>
                <div className="keyword-density-list divide-y divide-slate-100">
                  {keywordStats.map(kw => (
                    <div key={kw.keyword} className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                      <span className="max-w-[150px] truncate text-[10px] text-slate-500" title={kw.keyword}>{kw.keyword}</span>
                      <div className="shrink-0 text-right"><span className="block font-mono text-[10px] font-medium text-slate-700">{kw.density}</span><span className="block text-[8px] text-slate-400">{kw.count}×</span></div>
                    </div>
                  ))}
                </div>
              </section>
            )}

          </aside>
        </div>
      </div>

      <div className={`flex gap-2 shrink-0 ${embedded ? 'continuous-step-action justify-start' : 'justify-between'}`}>
        {!embedded && (
        <button onClick={onPrev} className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs py-2.5 px-3 sm:px-5 rounded-2xl shadow-sm transition-all">
          {tr('← Quay lại Outline', '← Back to Outline')}
        </button>
        )}
        <div className="draft-footer-actions flex flex-1 flex-wrap items-center gap-2">
          <button onClick={handleCopy} disabled={!draft} className="draft-export-secondary inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-[10px] font-medium transition-colors disabled:opacity-40">
            {copied ? <Check className="app-icon" aria-hidden="true" /> : <Copy className="app-icon" aria-hidden="true" />}
            <span>{copied ? tr('Đã copy', 'Copied') : tr('Copy nội dung', 'Copy content')}</span>
          </button>
          <button onClick={handleCopyGoogleDocs} disabled={!draft || formatCopying} className="draft-export-secondary inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-[10px] font-medium transition-colors disabled:opacity-40">
            {formatCopying ? <LoaderCircle className="app-icon animate-spin" aria-hidden="true" /> : formatCopied ? <Check className="app-icon" aria-hidden="true" /> : <ClipboardCopy className="app-icon" aria-hidden="true" />}
            <span>{formatCopying ? tr('Đang định dạng…', 'Formatting…') : formatCopied ? tr('Đã copy', 'Copied') : 'Copy formated content'}</span>
          </button>
          <button disabled={!draft} onClick={() => {
            const blob = new Blob([draft], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${(article.title || 'bai-viet').replace(/\s+/g, '-')}.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }} className="draft-export-secondary inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-[10px] font-medium transition-colors disabled:opacity-40">
            <Download className="app-icon" aria-hidden="true" />
            <span>{tr('Tải .txt', 'Download .txt')}</span>
          </button>
        <button
          onClick={onToggleComplete}
          disabled={!draft || completionSaving || (article.status !== 'done' && !seoChecklistPassed)}
          title={!seoChecklistPassed && article.status !== 'done' ? tr('Cần đạt 100% SEO checklist trước khi hoàn thành', 'The SEO checklist must reach 100% before completion') : undefined}
          className={`workflow-endpoint-button ${article.status === 'done' ? 'is-complete' : ''}`}
        >
          {completionSaving ? <><LoaderCircle className="app-icon animate-spin" aria-hidden="true" /><span>{tr('Đang lưu...', 'Saving...')}</span></> : article.status === 'done' ? <><RefreshCw className="app-icon" aria-hidden="true" /><span>{tr('Mở lại bài viết', 'Reopen article')}</span></> : !seoChecklistPassed ? <span>SEO {seoChecklist.items.length - seoChecklist.failed.length}/{seoChecklist.items.length}</span> : <><Check className="app-icon" aria-hidden="true" /><span>{tr('Đánh dấu hoàn thành', 'Mark complete')}</span></>}
        </button>
        </div>
      </div>
      {showAudit && (
        <ProcessTraceModal
          title={tr('Nhật ký tạo bản nháp', 'Draft generation log')}
          events={article.step4ProcessTrace}
          onClose={() => setShowAudit(false)}
        >
          {article.step4RawResponseExcerpt && (
            <section className="rounded-xl border border-slate-200 p-4">
              <h4 className="text-[11px] font-medium text-slate-800">{tr('Phản hồi cấu trúc từ AI', 'Raw structured AI response')}</h4>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px] leading-relaxed text-slate-500">{article.step4RawResponseExcerpt}</pre>
            </section>
          )}
        </ProcessTraceModal>
      )}
    </div>
  );
}
