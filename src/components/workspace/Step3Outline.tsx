import { isArticleCompleted } from '../../lib/workflowGuards';
import WorkflowCheckLog, { useWorkflowCheckLog } from './WorkflowCheckLog';
import { measureUiAfterPaint, sendOutlinePerformanceSample, uiInteractionStart } from "../../lib/performanceTelemetry";
import { getArticleStages, type ArticleStageVersion } from "../../lib/db";
import OutlineStructureSelect from '../OutlineStructureSelect';
import { buildOutlineTask, validateOutlineStructure, outlineSelectionUpdates } from '../../../shared/outlineStructures';
import { type ReactNode, useEffect, useLayoutEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, ChevronUp, Eye, History, Pencil, LoaderCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import type {
  Article,
  AIModel,
  AppConfig,
  DocumentFile,
  OutlineSection,
  SearchIntent,
  AIProcessTraceEvent,
} from "../../types";
import { callAI } from "../../lib/aiService";
import { useI18n } from "../../lib/i18n";
import { mapMustCoverTopics } from "../../lib/mustCoverPolicy";
import { notifyWorkspace } from "./WorkspaceNotification";
import {
  collectStepDocs,
  buildRoleSystemPrompt,
  buildStepDocumentPromptRules,
  buildWorkflowSourceFingerprint,
  describeBundle,
} from "../../lib/docContext";
import { hasEvidenceForAuthorizedCategories, verifiedRuleRefs, verifyEvidence } from "../../lib/evidenceValidation";
import { sectionEvidence, knowledgeExcerpts, isClaimEvidence } from '../../lib/evidencePolicy';
import { ProcessTraceModal } from './ProcessTrace';
import { parseAIJson } from '../../lib/aiJson';
import { compileWorkflowRules, getWorkflowParameter } from '../../lib/workflowRules';
import { gateArticleStep, gateStepCompletion } from '../../lib/workflowGuards';
import { StepUsage } from './StepUsage';

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

const SEARCH_INTENT_META: Record<SearchIntent, { label: string; color: string }> = {
  informational: { label: "Informational", color: "bg-blue-50 text-blue-700 border-blue-200" },
  commercial:    { label: "Commercial",    color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  transactional: { label: "Transactional", color: "bg-amber-50 text-amber-700 border-amber-200" },
  navigational:  { label: "Navigational",  color: "bg-slate-100 text-slate-700 border-slate-200" },
};

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const objectStart = body.indexOf("{");
  const arrayStart = body.indexOf("[");
  const start = objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart) ? objectStart : arrayStart;
  const end = start === objectStart ? body.lastIndexOf("}") : body.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Không tìm thấy JSON.");
  const json = body.slice(start, end + 1);
  try {
    return JSON.parse(json);
  } catch (firstError) {
    // Repair common model-output mistakes without changing any text values:
    // trailing commas, adjacent objects and missing commas between properties.
    const repaired = json
      .replace(/\u00a0/g, " ")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/}\s*{/g, "},{")
      .replace(
        /("(?:\\.|[^"\\])*"|\d+(?:\.\d+)?|true|false|null|\]|})\s*\n\s*(?="[^"\n]+"\s*:)/g,
        "$1,\n",
      );
    try {
      return JSON.parse(repaired);
    } catch {
      throw firstError;
    }
  }
}

function toStringArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  return [];
}

function normalizeIntent(v: unknown): SearchIntent | undefined {
  const s = String(v ?? "").toLowerCase();
  if (s === "informational" || s === "commercial" || s === "transactional" || s === "navigational") return s;
  return undefined;
}

function normalizeSections(
  parsed: unknown,
  bundle: ReturnType<typeof collectStepDocs>,
  trustedEvidence: ReturnType<typeof verifyEvidence> = [],
): { sections: OutlineSection[]; rejectedHeadings: string[]; rawSectionCount: number; registryCount: number } {
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const rawSections = root?.sections ?? parsed;
  if (!Array.isArray(rawSections)) throw new Error("Phản hồi AI không có mảng sections.");
  const registryValue = root?.evidenceRegistry;
  const registry: Record<string, unknown> = registryValue && typeof registryValue === "object" && !Array.isArray(registryValue)
    ? registryValue as Record<string, unknown>
    : Object.fromEntries((Array.isArray(registryValue) ? registryValue : []).flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const id = String(record.id ?? record.key ?? record.ref ?? `ev-${index + 1}`).trim();
      return id ? [[id, record]] : [];
    }));
  const rejectedHeadings: string[] = [];
  const sectionCandidates = [...trustedEvidence, ...knowledgeExcerpts(bundle.knowledgeBase)];
  const sections = rawSections
    .map(raw => {
      if (!raw || typeof raw !== "object") return null;
      const obj = raw as Record<string, unknown>;
      const heading = String(obj.heading ?? obj.title ?? "").trim();
      if (!heading) return null;
      const lvl = String(obj.level ?? "h2").toLowerCase();
      const rawRefs = Array.isArray(obj.evidenceRefs) ? obj.evidenceRefs : toStringArr(obj.evidenceRefs);
      const registryEvidence = rawRefs.flatMap(ref => {
        if (ref && typeof ref === "object") {
          const record = ref as Record<string, unknown>;
          const id = String(record.id ?? record.ref ?? record.evidenceId ?? "").trim();
          return id && registry[id] ? [registry[id]] : [record];
        }
        const id = String(ref).trim();
        return registry[id] ? [registry[id]] : [];
      });
      const evidence = verifyEvidence([
        ...(Array.isArray(obj.evidence) ? obj.evidence : []),
        ...registryEvidence,
        ...trustedEvidence.filter(item => item.role === 'rules'),
        ...sectionEvidence(sectionCandidates, [heading, obj.notes ?? '', obj.keywords ?? ''].join(' ')),
      ], bundle).filter((item, index, all) => all.findIndex(candidate =>
        candidate.source === item.source && candidate.role === item.role && candidate.quote === item.quote
      ) === index);
      if (!hasEvidenceForAuthorizedCategories(evidence, { ...bundle, knowledgeBase: [] })) {
        rejectedHeadings.push(heading);
        return null;
      }
      return {
        grounding: evidence.some(isClaimEvidence) ? 'evidence-led' : 'editorial-guidance',
        id: generateId(),
        heading,
        notes: String(obj.notes ?? obj.description ?? "").trim(),
        rationale: String(obj.rationale ?? obj.reasoning ?? "").trim(),
        level: lvl === "h3" ? "h3" : "h2",
        keywords: toStringArr(obj.keywords),
        searchIntent: normalizeIntent(obj.searchIntent),
        evidence,
        ruleRefs: verifiedRuleRefs(obj.ruleRefs, bundle),
      } as OutlineSection;
    })
    .filter((v): v is OutlineSection => v !== null);
  return { sections, rejectedHeadings, rawSectionCount: rawSections.length, registryCount: Object.keys(registry).length };
}

interface GenerationTiming {
  start: number;
  clickMeasured: boolean;
  acceptMeasured: boolean;
  acceptedMs?: number;
  saved: boolean;
  finished: boolean;
  responseSent: boolean;
}

// Sent once both the accepted frame was measured and the outline was saved;
// either can happen first.
function sendAcceptedResponseTime(timing: GenerationTiming) {
  if (!timing.finished || !timing.saved || timing.acceptedMs === undefined || timing.responseSent) return;
  timing.responseSent = true;
  sendOutlinePerformanceSample("responseTime", timing.acceptedMs);
}

function targetSectionCount(wordCount: number): number {
  if (wordCount <= 1000) return 6;
  if (wordCount <= 1800) return 8;
  return 10;
}

interface Props {
  embedded?: boolean;
  article: Article;
  config: AppConfig;
  files: DocumentFile[];
  model: AIModel;
  railwayUrl: string;
  onUpdate: (updates: Partial<Article>) => Promise<boolean>;
  onNext: () => void;
  onPrev: () => void;
}

export default function Step3Outline({
  embedded = false,
  article,
  config,
  files,
  model,
  railwayUrl,
  onUpdate,
  onNext,
  onPrev,
}: Props) {
  const { tr, canonicalAIOutputInstruction } = useI18n();
  const completed = isArticleCompleted(article);
  const generationLog = useWorkflowCheckLog(article.id, 3);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [suggestingKeywords, setSuggestingKeywords] = useState(false);
  const suggestedKeywords = article.step3SuggestedKeywords ?? [];
  const [newSectionHeading, setNewSectionHeading] = useState("");
  const [newSectionLevel, setNewSectionLevel] = useState<"h2" | "h3">("h2");
  const generationInFlight = useRef(false);
  // ui-kpi-v2: both KPIs start at the click and end in the second animation
  // frame after the state is shown. clickLatency ends at the painted
  // "generating" state; responseTime ends at the painted "accepted" state (the
  // server took the job, before the AI runs) and, as before, is only reported
  // for generations whose outline was saved.
  const [generationAccepted, setGenerationAccepted] = useState(false);
  const generationTiming = useRef<GenerationTiming | null>(null);
  useLayoutEffect(() => {
    const timing = generationTiming.current;
    if (!timing) return;
    if (generating && !timing.clickMeasured) {
      timing.clickMeasured = true;
      measureUiAfterPaint(timing.start, ms => sendOutlinePerformanceSample("clickLatency", ms));
    } else if (!generating) {
      generationTiming.current = null;
      timing.finished = true;
      sendAcceptedResponseTime(timing);
    }
  }, [generating]);
  useLayoutEffect(() => {
    const timing = generationTiming.current;
    if (!generationAccepted || !timing || timing.acceptMeasured) return;
    timing.acceptMeasured = true;
    measureUiAfterPaint(timing.start, ms => {
      timing.acceptedMs = ms;
      sendAcceptedResponseTime(timing);
    });
  }, [generationAccepted]);
  const outline = article.outline || [];
  const prerequisite = gateArticleStep(article, 3);

  useEffect(() => { if (error) notifyWorkspace(error, 'error'); }, [error]);
  useEffect(() => { if (warning) notifyWorkspace(warning, 'warning'); }, [warning]);

  const bundle = useMemo(() => collectStepDocs(3, config, files, article.contentPlanInput), [article.contentPlanInput, config, files]);
  const documentPromptRules = useMemo(() => buildStepDocumentPromptRules(3, config, files), [config, files]);
  const compiledWorkflowRules = useMemo(() => compileWorkflowRules(config, 3, 'manual'), [config]);
  const selectedCoreIdea = useMemo(
    () => article.coreIdeaSuggestions?.find(idea => idea.id === article.selectedCoreIdeaId) ?? null,
    [article.coreIdeaSuggestions, article.selectedCoreIdeaId],
  );
  const trustedCoreIdeaEvidence = useMemo(
    // The registry can reuse a small verified evidence set by ID. Sending an
    // unbounded history here duplicates prompt context without improving the
    // outline's grounding.
    () => verifyEvidence(selectedCoreIdea?.evidence, bundle).slice(0, 8),
    [bundle, selectedCoreIdea],
  );
  const sourceFingerprint = useMemo(
    () => [
      buildWorkflowSourceFingerprint(bundle), model.provider, model.id, "step3-audit-v6-content-plan",
      article.contentType, article.topic, article.angle, article.keywords,
      article.targetAudience, article.tone, article.wordCount, article.selectedCoreIdeaId, compiledWorkflowRules.fingerprint,
      article.articleSpecFingerprint,
      JSON.stringify(article.outlineStructure),
    ].join(":"),
    [article.angle, article.articleSpecFingerprint, article.outlineStructure, article.contentType, article.keywords, article.selectedCoreIdeaId, article.targetAudience, article.tone, article.topic, article.wordCount, bundle, compiledWorkflowRules.fingerprint, model.id, model.provider],
  );
  const outlineIsStale = Boolean(outline.length) && article.outlineSourceFingerprint !== sourceFingerprint;
  useEffect(() => {
    if (outlineIsStale) notifyWorkspace('Nguồn hoặc model đã thay đổi. Outline đã lưu vẫn được giữ nguyên cho đến khi tạo lại.', 'warning');
  }, [outlineIsStale]);

  const contextBrief = useMemo(() => {
    const kws = (article.keywords || "").split(",").map(k => k.trim()).filter(Boolean);
    return {
      contentType: article.contentType || "",
      topic: article.topic || "",
      angle: article.angle || "",
      tone: article.tone || "",
      audience: article.targetAudience || "",
      wordCount: article.wordCount || 1500,
      primaryKeyword: kws[0] || "",
      secondaryKeywords: kws.slice(1),
    };
  }, [article]);
  const compactArticleSpec = useMemo(() => ({
    primaryQuery: article.articleSpec?.primaryQuery,
    secondaryQueries: article.articleSpec?.secondaryQueries?.slice(0, 6),
    audience: article.articleSpec?.audience,
    primaryIntent: article.articleSpec?.primaryIntent,
    expectedReaderOutcome: article.articleSpec?.expectedReaderOutcome,
    winningFormat: article.articleSpec?.winningFormat,
    mustCover: article.articleSpec?.mustCover?.slice(0, 8),
    thesis: article.articleSpec?.thesis,
    brandPov: article.articleSpec?.brandPov,
    ctaObjective: article.articleSpec?.ctaObjective,
  }), [article.articleSpec]);
  const desiredSections = Math.max(targetSectionCount(contextBrief.wordCount), article.outlineStructure?.requiredHeadings.length ?? 0);
  const configuredMinimumSections = Math.min(12, Math.max(4, Number(getWorkflowParameter(config, 'outline', 'outline-mapping', 'minimumSections') ?? 4)));
  const minimumSections = Math.max(configuredMinimumSections, desiredSections - 2);
  const contextQuery = [
    contextBrief.contentType,
    contextBrief.topic,
    contextBrief.angle,
    contextBrief.primaryKeyword,
    ...contextBrief.secondaryKeywords,
  ].filter(Boolean).join(" ");

  const handleGenerate = async (manual: boolean, eventTime: number) => {
    const startedAt = uiInteractionStart(eventTime);
    if (completed || generationInFlight.current) return;
    if (!prerequisite.allowed) {
      setError(tr(prerequisite.reasonVi, prerequisite.reason));
      return;
    }
    if (!article.outlineStructure) { setError(tr('Chọn cấu trúc outline từ Skills & Rules trước khi tạo.', 'Select an outline structure from Skills & Rules first.')); return; }
    if (!article.contentPlanInput?.trim() || !article.topic?.trim()) {
      setError("Bài viết chưa có topic được tổng hợp từ Content Plan hiện tại.");
      return;
    }
    if (!article.topic) {
      setError("Chưa có Core Idea từ Bước 1.");
      return;
    }
    if (!bundle.totalCount) {
      setError("Chưa có tài liệu nào được phân quyền cho Bước 2. Chỉ cần ít nhất một tài liệu từ Knowledge Base hoặc Skills.");
      return;
    }
    generationInFlight.current = true;
    generationTiming.current = { start: startedAt, clickMeasured: false, acceptMeasured: false, saved: false, finished: false, responseSent: false };
    setGenerationAccepted(false);
    const progress = generationLog.start(tr('Chuẩn bị Article Spec, cấu trúc đã chọn và nguồn được cấp.', 'Prepare the Article Spec, selected structure and available sources.'));
    setGenerating(true);
    setError(null);
    setWarning(null);
    try {
      const systemPrompt = buildRoleSystemPrompt(
        [
          canonicalAIOutputInstruction,
          "Create an evidence-grounded outline using the shared task contract and frozen MD structure in the request.",
        ].join("\n"),
        documentPromptRules,
      );

      const userPrompt = [
        `TÀI LIỆU STEP 3 (${describeBundle(bundle)}):`,
        "Railway sẽ nạp trực tiếp nội dung các tài liệu đã được cấp quyền cho Bước 2 từ Supabase.",
        "",
        "DỮ LIỆU TỪ 2 BƯỚC TRƯỚC:",
        `- ARTICLE SPEC CONTRACT (compact): ${JSON.stringify(compactArticleSpec)}`,
        `- Loại nội dung (Step 1): ${contextBrief.contentType}`,
        `- Tiêu đề bài viết (Step 2): "${contextBrief.topic}"`,
        `- Angle: ${contextBrief.angle}`,
        `- Độc giả: ${contextBrief.audience}`,
        `- Tone: ${contextBrief.tone}`,
        `- Số từ mục tiêu: ${contextBrief.wordCount}`,
        `- Primary keyword: ${contextBrief.primaryKeyword}`,
        `- Secondary keywords: ${contextBrief.secondaryKeywords.join(", ")}`,
        buildOutlineTask({ spec: compactArticleSpec, direction: selectedCoreIdea, structure: article.outlineStructure, desiredSections, minimumSections }),
        ...(trustedCoreIdeaEvidence.length ? [
          "",
          "EVIDENCE STEP 2 ĐÃ ĐƯỢC XÁC MINH (có thể tái sử dụng bằng quote/source tương ứng):",
          JSON.stringify(trustedCoreIdeaEvidence),
        ] : []),
        "",
        `Yêu cầu: Trả về khoảng ${desiredSections} section trong JSON object với keyword mapping, search intent và evidence chi tiết.`,
        compiledWorkflowRules.taskGuidance,
      ].join("\n");

      progress.inspect({
        input: { ArticleSpec: compactArticleSpec, [tr('Định hướng bài', 'Article brief')]: contextBrief },
        sources: { [tr('Dẫn chứng kế thừa', 'Inherited evidence')]: trustedCoreIdeaEvidence },
        rules: { [tr('Cấu trúc đã chọn', 'Selected structure')]: article.outlineStructure },
      });
      let modelCalls = 1;
      const jsonRepairCalls = 0;
      let evidenceCorrectionCalls = 0;
      const aiResponses: Awaited<ReturnType<typeof callAI>>[] = [];
      progress.advance(tr('Đang yêu cầu AI dựng dàn bài theo cấu trúc đã chọn.', 'Requesting an outline using the selected structure.'));
      progress.inspect({
        input: { Model: model.id, [tr('Yêu cầu gửi AI', 'Request sent to AI')]: userPrompt },
        rules: { [tr('Chỉ dẫn hệ thống', 'System instructions')]: systemPrompt, Workflow: compiledWorkflowRules.snapshot.rules },
      });
      const res = await callAI({
        articleId: article.id,
        model,
        railwayUrl,
        prompt: userPrompt,
        systemPrompt,
        maxTokens: Math.min(4800, 1400 + desiredSections * 320),
        temperature: 0.1,
        stepNumber: 3,
        bypassCache: manual,
        jsonMode: true,
        contextQuery,
        onAccepted: () => setGenerationAccepted(true),
      });
      progress.inspect({
        output: { Model: res.model, Tokens: res.usage, [tr('Trích đoạn phản hồi (tối đa 12.000 ký tự)', 'Response excerpt (up to 12,000 characters)')]: res.content.slice(0, 12000) },
        sources: { [tr('Tài liệu theo phản hồi máy chủ', 'Documents reported by the server')]: res.context },
      });
      progress.advance(tr('Đang kiểm tra đề mục, chủ đề bắt buộc và dẫn chứng.', 'Checking headings, required topics and evidence.'));
      aiResponses.push(res);
      let lastResponse = res;
      const parsed = parseAIJson(res.content);
      const normalized = normalizeSections(parsed, bundle, trustedCoreIdeaEvidence);
      progress.inspect({
        input: { [tr('Số mục AI trả về', 'Returned section count')]: normalized.rawSectionCount, [tr('Mục bị loại ban đầu', 'Initially rejected headings')]: normalized.rejectedHeadings },
        rules: { [tr('Số mục tối thiểu', 'Minimum section count')]: minimumSections, [tr('Cấu trúc đã chọn', 'Selected structure')]: article.outlineStructure },
      });
      let sections = normalized.sections;
      let generatedAt = res.servedAt ?? res.generatedAt ?? new Date().toISOString();
      if (sections.length < minimumSections) {
        evidenceCorrectionCalls += 1;
        modelCalls += 1;
        const missingCount = desiredSections - sections.length;
        progress.note(tr('Đang yêu cầu bổ sung các mục dàn bài còn thiếu.', 'Requesting missing outline sections.'));
        const corrected = await callAI({
          articleId: article.id,
          model,
          railwayUrl,
          prompt: [
            userPrompt,
            "",
            `CHỈ BỔ SUNG ${missingCount} SECTION CÒN THIẾU; không tạo lại section đã hợp lệ.`,
            `Heading đã hợp lệ, không được lặp: ${sections.map(section => JSON.stringify(section.heading)).join(", ") || "(chưa có)"}.`,
            `Heading bị loại do evidence không hợp lệ: ${normalized.rejectedHeadings.map(heading => JSON.stringify(heading)).join(", ") || "(không xác định)"}.`,
            "Nếu KB hoặc Content Plan có nguồn, mỗi section mới cần ít nhất 1 evidenceRef tới quote từ nguồn đó. Nếu Skills có nguồn, cần thêm evidenceRef tới quote Skills. Bỏ qua nhóm trống.",
            "Chỉ trả về JSON object { evidenceRegistry, sections } chứa các section bổ sung.",
          ].join("\n"),
          systemPrompt,
          maxTokens: Math.min(4000, 1200 + missingCount * 400),
          temperature: 0.1,
          stepNumber: 3,
          bypassCache: true,
          jsonMode: true,
          contextQuery,
        });
        aiResponses.push(corrected);
        lastResponse = corrected;
        const correctedNormalized = normalizeSections(parseAIJson(corrected.content), bundle, trustedCoreIdeaEvidence);
        const additions = correctedNormalized.sections;
        sections = [...sections, ...additions]
          .filter((section, index, all) => all.findIndex(candidate => candidate.heading.toLocaleLowerCase() === section.heading.toLocaleLowerCase()) === index)
          .slice(0, desiredSections);
        generatedAt = corrected.servedAt ?? corrected.generatedAt ?? new Date().toISOString();
      }
      if (!sections.length) throw new Error(
        `Không có section nào vượt qua kiểm chứng sau một lần bổ sung có mục tiêu. `
        + `Đã đọc ${normalized.rawSectionCount} section, ${normalized.registryCount} evidence registry và ${trustedCoreIdeaEvidence.length} evidence kế thừa từ Step 2.`,
      );
      sections = mapMustCoverTopics(sections, article.articleSpec?.mustCover ?? []);
      const structureErrors = validateOutlineStructure(sections, article.outlineStructure);
      progress.inspect({
        output: { [tr('Mục đã xác minh', 'Validated sections')]: sections, [tr('Lỗi cấu trúc', 'Structure errors')]: structureErrors },
        sources: { [tr('Dẫn chứng theo mục', 'Evidence by section')]: sections.map(section => ({ heading: section.heading, evidence: section.evidence })) },
      });
      if (structureErrors.length) throw new Error(structureErrors.join('\n'));
      const partialResult = sections.length < minimumSections;
      const trace: AIProcessTraceEvent[] = [
        { id: 'step3-handoff', stage: 'input', status: 'completed', title: '1. Nhận Content Plan và kết quả Bước 1', detail: 'Khóa nhóm nội dung, Core Idea, angle, audience, tone, word count và bộ keyword đã chọn để làm đầu vào outline.', facts: { contentType: contextBrief.contentType, topic: contextBrief.topic, primaryKeyword: contextBrief.primaryKeyword, secondaryKeywords: contextBrief.secondaryKeywords.length } },
        { id: 'step3-docs', stage: 'retrieval', status: 'completed', title: '2. Nạp nguồn của activity', detail: `Railway chọn các đoạn Knowledge Base, Content Plan hiện tại và Skills liên quan nhất theo topic, angle và keyword.\nPrompting rules theo phân vùng:\n${documentPromptRules || '(không có rule tùy chỉnh)'}`, facts: { kb: bundle.knowledgeBase.length, contentPlan: bundle.contentPlan.length, rules: bundle.rules.length } },
        { id: 'step3-generation', stage: 'generation', status: 'completed', title: '3. Model dựng outline', detail: `Model ${lastResponse.model} tạo heading, notes, rationale, keyword mapping và search intent; evidence dùng registry chung để không lặp quote.`, facts: { modelCalls, inputTokens: aiResponses.reduce((sum, response) => sum + (response.usage?.inputTokens ?? 0), 0), outputTokens: aiResponses.reduce((sum, response) => sum + (response.usage?.outputTokens ?? 0), 0), cacheHits: aiResponses.filter(response => response.cacheHit).length, durationMs: aiResponses.reduce((sum, response) => sum + (response.timing?.totalMs ?? 0), 0) } },
        { id: 'step3-validation', stage: 'validation', status: evidenceCorrectionCalls ? 'warning' : 'completed', title: '4. Kiểm tra cấu trúc và dẫn chứng', detail: 'Loại section thiếu quote nguyên văn ở bất kỳ phân vùng nào đang được cấp quyền. Nếu dưới ngưỡng tối thiểu, chỉ yêu cầu bổ sung phần còn thiếu.', facts: { sectionsAccepted: sections.length, evidenceVerified: sections.reduce((sum, section) => sum + (section.evidence?.length ?? 0), 0), jsonRepairCalls, evidenceCorrectionCalls } },
        { id: 'step3-persist', stage: 'persistence', status: 'completed', title: '5. Lưu outline và audit trail', detail: 'Lưu section, rationale, evidence, nguồn Rules và nhật ký hành động này cùng bài viết trong Supabase.' },
      ];
      progress.advance(tr('Đang lưu dàn bài đã kiểm tra.', 'Saving the validated outline.'));
      progress.inspect({ input: { [tr('Đề mục cần lưu', 'Headings to save')]: sections.map(section => section.heading) } });
      const saved = await onUpdate({
        outline: sections,
        outlineGenerationId: crypto.randomUUID(),
        outlineNeedsRegeneration: false,
        draftNeedsRegeneration: true,
        outlineSourceFingerprint: sourceFingerprint,
        outlineScannedAt: generatedAt,
        step3ProcessTrace: trace,
        workflowRuleSnapshots: { ...article.workflowRuleSnapshots, 3: compiledWorkflowRules.snapshot },
        editorialApproval: article.activityType === 'editorial-originality' ? { status: 'pending' } : null,
        draft: "",
        draftSourceFingerprint: null,
        draftScannedAt: null,
        currentStep: 3,
      });
      if (!saved) throw new Error('Outline Bước 2 chưa được lưu vào Supabase.');
      if (generationTiming.current) generationTiming.current.saved = true;
      window.dispatchEvent(new CustomEvent('writer:generation-saved', { detail: { articleId: article.id, stage: 'outline' } }));
      progress.inspect({ output: { [tr('Số mục đã lưu', 'Saved section count')]: sections.length } });
      progress.finish(partialResult, tr(`Đã lưu ${sections.length} mục dàn bài.`, `Saved ${sections.length} outline sections.`));
      if (partialResult) {
        setWarning(`Đã lưu ${sections.length}/${minimumSections} section tối thiểu vượt qua kiểm chứng. Bạn có thể chỉnh sửa thủ công hoặc nhấn “Tạo lại” để thử bổ sung.`);
      } else {
        notifyWorkspace('Đã tạo, kiểm tra và lưu outline.', 'success');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      progress.fail(message);
      setError(`Không tạo được outline: ${message}`);
    } finally {
      generationInFlight.current = false;
      setGenerationAccepted(false);
      setGenerating(false);
    }
  };

  const handleSuggestKeywords = async () => {
    if (completed) return;
    if (!contextBrief.angle && !contextBrief.topic) return;
    setSuggestingKeywords(true);
    try {
      const selectedIdea = article.coreIdeaSuggestions?.find(idea => idea.id === article.selectedCoreIdeaId);
      const existing = new Set([
        contextBrief.primaryKeyword,
        ...contextBrief.secondaryKeywords,
      ].map(keyword => keyword.toLocaleLowerCase()));
      const candidates = [
        ...(selectedIdea?.keywordAudit ?? []).filter(item => item.decision === "accepted").map(item => item.keyword),
        ...(article.seoResearch?.keywords ?? []).map(item => item.keyword),
      ].map(keyword => keyword.trim()).filter(Boolean)
        .filter(keyword => !existing.has(keyword.toLocaleLowerCase()))
        .filter((keyword, index, all) => all.findIndex(candidate => candidate.toLocaleLowerCase() === keyword.toLocaleLowerCase()) === index)
        .slice(0, 10);
      if (!candidates.length) throw new Error("Bước 1 chưa có keyword đã kiểm chứng chưa được sử dụng.");
      const saved = await onUpdate({ step3SuggestedKeywords: candidates });
      if (!saved) throw new Error('Keyword gợi ý chưa được lưu vào Supabase.');
    } catch (error) {
      setError(`Không gợi ý được keyword: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSuggestingKeywords(false);
    }
  };

  const updateSection = (id: string, patch: Partial<OutlineSection>) => {
    onUpdate({
      outline: outline.map(s => (s.id === id ? { ...s, ...patch } : s)),
      ...(article.activityType === 'editorial-originality' ? { editorialApproval: { status: 'pending' as const } } : {}),
    });
  };

  const removeSection = (id: string) => {
    onUpdate({ outline: outline.filter(s => s.id !== id), ...(article.activityType === 'editorial-originality' ? { editorialApproval: { status: 'pending' as const } } : {}) });
  };

  const moveSection = (id: string, dir: -1 | 1) => {
    const idx = outline.findIndex(s => s.id === id);
    if (idx + dir < 0 || idx + dir >= outline.length) return;
    const next = [...outline];
    [next[idx], next[idx + dir]] = [next[idx + dir], next[idx]];
    onUpdate({ outline: next, ...(article.activityType === 'editorial-originality' ? { editorialApproval: { status: 'pending' as const } } : {}) });
  };

  const addSection = (extraKeyword?: string, headingOverride?: string) => {
    const heading = (headingOverride ?? newSectionHeading).trim();
    if (!heading) return;
    const kws = extraKeyword ? [extraKeyword] : [];
    onUpdate({
      outline: [
        ...outline,
        { id: generateId(), heading, notes: "", level: newSectionLevel, keywords: kws, evidence: [] },
      ],
      ...(article.activityType === 'editorial-originality' ? { editorialApproval: { status: 'pending' as const } } : {}),
    });
    setNewSectionHeading("");
  };

  const addKeywordToSection = (sectionId: string, kw: string) => {
    const section = outline.find(s => s.id === sectionId);
    if (!section) return;
    const existing = section.keywords || [];
    if (existing.includes(kw)) return;
    updateSection(sectionId, { keywords: [...existing, kw] });
  };

  // A subsection belongs to the nearest preceding H2 in the saved order.
  const groups: Array<{ root: number; children: number[] }> = [];
  outline.forEach((section, index) => {
    const group = groups.at(-1);
    if (section.level === 'h3' && group && outline[group.root].level === 'h2') {
      group.children.push(index);
    } else {
      groups.push({ root: index, children: [] });
    }
  });
  const renderSection = (index: number) => {
    const section = outline[index];
    return (
      <SectionRow
        isFirst={index === 0}
        isLast={index === outline.length - 1}
        section={section}
        onChange={patch => updateSection(section.id, patch)}
        onRemove={() => removeSection(section.id)}
        onMove={dir => moveSection(section.id, dir)}
        keywordSuggestions={suggestedKeywords}
        onAddKeyword={kw => addKeywordToSection(section.id, kw)}
        readOnly={completed}
        processTrace={article.step3ProcessTrace}
      />
    );
  };
  const h2Count = outline.filter(s => s.level === "h2").length;
  const h3Count = outline.filter(s => s.level === "h3").length;
  const isCurrentStep = (article.currentStep ?? 2) <= 3;
  const needsOutlineApproval = isCurrentStep && article.activityType === 'editorial-originality' && article.editorialApproval?.status !== 'approved';
  const canContinueToDraft = isCurrentStep && gateStepCompletion(article, 3).allowed && !needsOutlineApproval;
  const stepActionDisabled = completed || (!canContinueToDraft && !needsOutlineApproval && !article.outlineStructure) || generating || (needsOutlineApproval ? !outline.length : !canContinueToDraft && !prerequisite.allowed);

  return (
    <div className={`minimal-step flex flex-col gap-4 animate-fade-in-up ${embedded ? 'continuous-step' : 'h-full'}`}>
      <div className={`outline-workspace-shell minimal-step-shell flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white ${embedded ? '' : 'min-h-0 flex-1'}`}>
        <div className={`${embedded ? '' : 'flex-1 overflow-y-auto'} p-3.5 sm:p-5 md:p-6`}>
          <div className="mx-auto max-w-4xl space-y-5">

            {/* Header */}
            <div className="outline-toolbar flex flex-col justify-between gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0">
                <h2 className="mb-1 text-base font-semibold text-slate-800">{tr('Bước 2 — Dàn bài nháp', 'Step 2 — Draft Outline')}</h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {tr('Đọc và chỉnh dàn ý theo đúng thứ tự bài viết. Mở chi tiết khi cần xem keyword, intent hoặc nguồn tham khảo.', 'Review and edit the outline in article order. Open details to inspect keywords, intent, or sources.')}
                </p>
              </div>
            </div>
            <OutlineStructureSelect files={files} allowedIds={config.stepConfigs[3]?.fileAccess?.rules ?? []} value={article.outlineStructure} disabled={completed || generating || (article.activityKind === "batch" && !["completed", "failed"].includes(article.batchStatus ?? "queued"))} onChange={outlineStructure => void onUpdate(outlineSelectionUpdates(outlineStructure))} />
            {article.outlineNeedsRegeneration && <p role="status" className="text-xs">{tr('Cấu trúc đã đổi. Hãy tạo lại outline trước khi viết draft. Kết quả cũ vẫn được giữ.', 'Structure changed. Regenerate the outline before drafting. Previous output is preserved.')}</p>}
            <GenerationHistory articleId={article.id} stage="outline" generationId={article.outlineGenerationId} />
            <StepUsage step={2} usage={article.aiUsageByStep?.[3]} />

            <WorkflowCheckLog key={article.id} run={generationLog.run} steps={[
              tr('Chuẩn bị Article Spec và cấu trúc đã chọn', 'Prepare the Article Spec and selected structure'),
              tr('Dựng dàn bài từ tài liệu được cấp', 'Generate the outline from available sources'),
              tr('Kiểm tra cấu trúc và dẫn chứng', 'Validate structure and evidence'),
              tr('Lưu dàn bài', 'Save the outline'),
            ]} />

            {!generating && outline.length === 0 && (
              <div className="outline-empty-state rounded-xl border border-dashed border-slate-200 p-8 text-center">
                <p className="text-sm font-semibold text-slate-600">{tr('Chưa có outline', 'No outline yet')}</p>
                <p className="text-xs text-slate-400 mt-1">{tr('Nhấn “Tạo outline” để dựng dàn bài từ dữ liệu Bước 1–2', 'Click “Generate outline” to build it from Step 1–2 data')}</p>
              </div>
            )}

            {/* Outline */}
            {!generating && outline.length > 0 && (
              <div className="space-y-2">
                {article.title && (
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="text-[11px] text-slate-500">{tr('Tiêu đề bài viết', 'Article title')}</div>
                    <h3 data-testid="outline-article-title" className="mt-1 whitespace-pre-wrap break-words text-base font-medium text-slate-800">{article.title}</h3>
                  </div>
                )}
                <div className="outline-summary flex items-center justify-between px-1 text-[11px] text-slate-500">
                  <span>
                    <span className="font-mono text-slate-700 font-bold">{outline.length}</span> section — {h2Count} H2 · {h3Count} H3
                  </span>
                </div>

                <ol aria-label={tr('Các heading trong dàn bài', 'Outline headings')} className="overflow-hidden divide-y divide-[var(--ui-border)] rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)]">
                  {groups.map(({ root, children }) => (
                    <li key={outline[root].id} className="min-w-0">
                      {renderSection(root)}
                      {children.length > 0 && (
                        <ol aria-label={tr(`Các mục con của ${outline[root].heading}`, `Subheadings of ${outline[root].heading}`)}
                          className="mb-2 ml-6 border-l border-[var(--ui-border)] sm:ml-8">
                          {children.map(index => <li key={outline[index].id}>{renderSection(index)}</li>)}
                        </ol>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Add section */}
            {!completed && <div className="outline-add-panel space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-700">{tr('Thêm section hoặc luận điểm nhánh', 'Add a section or supporting point')}</div>
                <button
                  onClick={handleSuggestKeywords}
                  disabled={suggestingKeywords || (!contextBrief.angle && !contextBrief.topic)}
                  className="outline-secondary-button rounded-md border border-slate-200 px-2.5 py-1 text-[10px] font-medium transition-colors disabled:opacity-40"
                >
                  {suggestingKeywords ? tr('Đang lấy...', 'Loading...') : tr('Lấy keyword đã kiểm chứng', 'Use verified keywords')}
                </button>
              </div>

              <div className="grid grid-cols-[auto_1fr] sm:flex gap-2">
                <select
                  value={newSectionLevel}
                  onChange={e => setNewSectionLevel(e.target.value as "h2" | "h3")}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-800"
                >
                  <option value="h2">H2</option>
                  <option value="h3">H3</option>
                </select>
                <input
                  value={newSectionHeading}
                  onChange={e => setNewSectionHeading(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addSection()}
                  placeholder={tr('Tiêu đề section mới...', 'New section heading...')}
                  className="min-w-0 flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-slate-800 placeholder:text-slate-400"
                />
                <button
                  onClick={() => addSection()}
                  disabled={!newSectionHeading.trim()}
                  className="outline-add-button col-span-2 flex items-center justify-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 sm:col-span-1"
                >
                  <Plus className="app-icon" aria-hidden="true" />
                  <span>{tr('Thêm', 'Add')}</span>
                </button>
              </div>

              {suggestedKeywords.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Keyword theo angle — click để tạo section mới
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {suggestedKeywords.map(kw => (
                      <button
                        key={kw}
                        onClick={() => addSection(kw, kw)}
                        className="outline-keyword-chip rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors"
                      >
                        {kw}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>}
          </div>
        </div>
      </div>

      <div className={`flex gap-2 shrink-0 ${embedded ? 'continuous-step-action justify-start' : 'justify-between'}`}>
        {!embedded && (
        <button onClick={onPrev} className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs py-2.5 px-3 sm:px-5 rounded-2xl shadow-sm transition-all">
          {tr('Quay lại', 'Back')}
        </button>
        )}
        <div className="flex flex-col items-start gap-2">
          {!article.outlineStructure && !canContinueToDraft && !needsOutlineApproval && <p className="text-xs text-[var(--ui-secondary)]">{tr("Chọn cấu trúc outline ở trên để bắt đầu.", "Choose an outline structure above to begin.")}</p>}
          <button
            onClick={needsOutlineApproval
              ? () => void onUpdate({ editorialApproval: { status: 'approved', approvedAt: new Date().toISOString(), outlineFingerprint: article.outlineSourceFingerprint ?? undefined } })
              : canContinueToDraft ? onNext : (event) => void handleGenerate(Boolean(outline.length), event.timeStamp)}
            disabled={stepActionDisabled}
            className="workflow-endpoint-button"
          >
            {generating ? <><LoaderCircle className="app-icon animate-spin" aria-hidden="true" /><span>{generationAccepted ? tr('Đã nhận yêu cầu — đang dựng...', 'Request accepted — generating...') : tr('Đang dựng...', 'Generating...')}</span></>
              : needsOutlineApproval ? <><Check className="app-icon" aria-hidden="true" /><span>{tr('Phê duyệt outline', 'Approve outline')}</span></>
              : canContinueToDraft ? <><span>{tr('Tiếp tục — First Draft', 'Continue — First Draft')}</span><ArrowRight className="app-icon" aria-hidden="true" /></>
              : <><Sparkles className="app-icon" aria-hidden="true" /><span>{outline.length ? tr('Tạo lại outline', 'Regenerate outline') : tr('Tạo outline', 'Generate outline')}</span></>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

function SectionRow({
  isFirst,
  isLast,
  section,
  onChange,
  onRemove,
  onMove,
  keywordSuggestions,
  onAddKeyword,
  processTrace,
  readOnly,
}: {
  isFirst: boolean;
  isLast: boolean;
  section: OutlineSection;
  onChange: (patch: Partial<OutlineSection>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  keywordSuggestions: string[];
  onAddKeyword: (kw: string) => void;
  processTrace?: AIProcessTraceEvent[];
  readOnly: boolean;
}) {
  const { tr } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const detailsId = useId();
  const [headingDraft, setHeadingDraft] = useState(section.heading);
  const [notesDraft, setNotesDraft] = useState(section.notes ?? '');
  const [rationaleDraft, setRationaleDraft] = useState(section.rationale ?? '');
  const isH3 = section.level === "h3";

  useEffect(() => setHeadingDraft(section.heading), [section.heading]);
  useEffect(() => setNotesDraft(section.notes ?? ''), [section.notes]);
  useEffect(() => setRationaleDraft(section.rationale ?? ''), [section.rationale]);

  const labelClass = "block text-xs font-medium text-[var(--ui-secondary)]";
  const fieldClass = "outline-editor-control mt-1 block min-h-11 w-full rounded-lg border px-3 py-2 text-sm";
  const actionClass = "outline-heading-action inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-xs disabled:opacity-40";
  const isEditing = editing && !readOnly;

  return (
    <div>
      <button type="button" onClick={() => { setExpanded(value => !value); setEditing(false); }}
        aria-expanded={expanded} aria-controls={detailsId}
        className="outline-heading-trigger flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left sm:px-5">
        <span className="shrink-0 font-mono text-xs text-[var(--ui-secondary)]">{section.level.toUpperCase()}</span>
        <span className={`min-w-0 flex-1 break-words text-[var(--ui-text)] ${isH3 ? 'text-sm' : 'text-base font-medium'}`}>
          {section.heading || tr('Heading chưa có tiêu đề', 'Untitled heading')}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--ui-secondary)] ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {expanded && (
        <div id={detailsId} className="border-t border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 pt-4 sm:px-5">
          <div className="space-y-4">
            {isEditing ? (
              <>
                <label className="block">
                  <span className={labelClass}>{tr('Tiêu đề heading', 'Heading title')}</span>
                  <textarea autoFocus value={headingDraft} onChange={event => setHeadingDraft(event.target.value)}
                    onBlur={() => headingDraft !== section.heading && onChange({ heading: headingDraft })}
                    rows={2} className={`${fieldClass} resize-y`} />
                </label>
                <label className="block">
                  <span className={labelClass}>{tr('Ghi chú', 'Notes')}</span>
                  <textarea value={notesDraft} onChange={event => setNotesDraft(event.target.value)}
                    onBlur={() => notesDraft !== (section.notes ?? '') && onChange({ notes: notesDraft })}
                    rows={3} className={`${fieldClass} resize-y`} />
                </label>
                <label className="block">
                  <span className={labelClass}>{tr('Lý do & điểm cần đánh giá', 'Rationale & review points')}</span>
                  <textarea value={rationaleDraft} onChange={event => setRationaleDraft(event.target.value)}
                    onBlur={() => rationaleDraft !== (section.rationale ?? '') && onChange({ rationale: rationaleDraft })}
                    rows={3} className={`${fieldClass} resize-y`} />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block min-w-0">
                    <span className={labelClass}>{tr('Ý định tìm kiếm', 'Search intent')}</span>
                    <select value={section.searchIntent || ""} className={fieldClass}
                      onChange={event => onChange({ searchIntent: (event.target.value || undefined) as SearchIntent | undefined })}>
                      <option value="">{tr('Chưa xác định', 'Not set')}</option>
                      {Object.entries(SEARCH_INTENT_META).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
                    </select>
                  </label>
                  <label className="block min-w-0">
                    <span className={labelClass}>{tr('Cấp heading', 'Heading level')}</span>
                    <select value={section.level} className={fieldClass}
                      onChange={event => onChange({ level: event.target.value as "h2" | "h3" })}>
                      <option value="h2">H2</option>
                      <option value="h3">H3</option>
                    </select>
                  </label>
                </div>
              </>
            ) : (
              <>
                <dl className="space-y-3 text-sm">
                  {section.notes && <div><dt className={labelClass}>{tr('Ghi chú', 'Notes')}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{section.notes}</dd></div>}
                  {section.rationale && <div><dt className={labelClass}>{tr('Lý do & điểm cần đánh giá', 'Rationale & review points')}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{section.rationale}</dd></div>}
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <dt className={labelClass}>{tr('Ý định tìm kiếm', 'Search intent')}</dt>
                    <dd>{section.searchIntent ? SEARCH_INTENT_META[section.searchIntent]?.label : tr('Chưa xác định', 'Not set')}</dd>
                  </div>
                </dl>
              </>
            )}
            {(section.keywords?.length ?? 0) > 0 && (
              <div>
                <label className={labelClass}>Keywords</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {section.keywords?.map((kw, i) => (
                    <span key={i} className="break-words rounded-md border border-[var(--ui-border)] px-2 py-1 text-xs text-[var(--ui-secondary)]">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(section.evidence?.length ?? 0) > 0 && (
              <div>
                <label className={labelClass}>{tr('Toàn bộ dẫn chứng đã kiểm chứng', 'All verified evidence')}</label>
                <div className="space-y-2 mt-1">
                  {section.evidence?.map((e, i) => (
                    <div key={i} className="outline-evidence-card rounded-lg border px-3 py-2 text-[10px]">
                      <div className="font-bold mb-1">{e.role?.toUpperCase()} · {e.source}</div>
                      {e.quote && <blockquote className="border-l-2 border-current/30 pl-2 leading-relaxed whitespace-pre-wrap">“{e.quote}”</blockquote>}
                      {e.note && <p className="mt-1.5"><b>{tr('Lý do sử dụng:', 'Why it matters:')}</b> {e.note}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(section.ruleRefs?.length ?? 0) > 0 && <div><label className={labelClass}>Rules áp dụng</label><div className="flex flex-wrap gap-1 mt-1">{section.ruleRefs?.map(rule => <span key={rule} className="outline-rule-chip text-[10px] rounded-md border px-2 py-0.5">{rule}</span>)}</div></div>}
            {isEditing && keywordSuggestions.some(keyword => !section.keywords?.includes(keyword)) && (
              <div>
                <label className={labelClass}>
                  Thêm keyword từ gợi ý
                </label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {keywordSuggestions
                    .filter(k => !section.keywords?.includes(k))
                    .map(k => (
                      <button
                        key={k}
                        disabled={readOnly} onClick={() => onAddKeyword(k)}
                        className="text-[10px] font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded px-1.5 py-0.5 transition-all"
                      >
                        {k}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-2 border-t border-[var(--ui-border)] py-1">
            <div className="flex flex-wrap items-center gap-1">
              {!readOnly && <button type="button" onClick={() => setEditing(value => !value)} className={actionClass}>
                {isEditing ? <Check className="app-icon" aria-hidden="true" /> : <Pencil className="app-icon" aria-hidden="true" />}
                {isEditing ? tr('Xong', 'Done') : tr('Chỉnh sửa', 'Edit')}
              </button>}
              <button type="button" onClick={() => setShowAudit(true)} className={actionClass}>
                <Eye className="app-icon" aria-hidden="true" />{tr('Xem AI log', 'View AI log')}
              </button>
            </div>
            {!readOnly && <div className="flex items-center gap-1">
              <button type="button" disabled={isFirst} onClick={() => onMove(-1)} aria-label={tr('Di chuyển lên', 'Move up')} title={tr('Di chuyển lên', 'Move up')} className={`${actionClass} w-11`}>
                <ChevronUp className="app-icon" aria-hidden="true" />
              </button>
              <button type="button" disabled={isLast} onClick={() => onMove(1)} aria-label={tr('Di chuyển xuống', 'Move down')} title={tr('Di chuyển xuống', 'Move down')} className={`${actionClass} w-11`}>
                <ChevronDown className="app-icon" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => { if (window.confirm(tr(`Xóa mục “${section.heading}” khỏi dàn bài?`, `Delete “${section.heading}” from the outline?`))) onRemove(); }} aria-label={tr('Xóa section', 'Delete section')} title={tr('Xóa section', 'Delete section')} className={`${actionClass} w-11`}>
                <Trash2 className="app-icon" aria-hidden="true" />
              </button>
            </div>}
          </div>
        </div>
      )}
      {showAudit && <ProcessTraceModal title={section.heading} events={processTrace} onClose={() => setShowAudit(false)}><div className="outline-audit-content space-y-4"><div className="outline-audit-summary rounded-lg border p-4"><div className="outline-audit-label">{tr('Lý do tạo section', 'Section rationale')}</div><p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">{section.rationale || tr('Chưa có rationale trong kết quả đã lưu.', 'No rationale in the saved result.')}</p></div><div><div className="outline-audit-label mb-2">{tr('Dẫn chứng của section', 'Section evidence')}</div><div className="space-y-2">{section.evidence?.map((e, i) => <div key={`${e.source}-${i}`} className="outline-audit-evidence rounded-lg border p-3 text-[10px]"><b>{e.role?.toUpperCase()} · {e.source}</b>{e.quote && <blockquote className="mt-1.5 whitespace-pre-wrap border-l-2 pl-2">“{e.quote}”</blockquote>}{e.note && <p className="mt-1.5"><b>{tr('Lý do sử dụng:', 'Why it matters:')}</b> {e.note}</p>}</div>)}</div></div></div></ProcessTraceModal>}
    </div>
  );
}

// Read-only history is deliberately separate from the live workflow/editor.
export function GenerationHistory({ articleId, stage, generationId, children }: { articleId: string; stage: "outline" | "draft"; generationId?: string; children?: (trigger: ReactNode, panel: ReactNode) => ReactNode }) {
  const { tr } = useI18n();
  const panelId = useId();
  const key = `writer:version:${articleId}:${stage}`;
  const [state, setState] = useState<{ key: string; versions: ArticleStageVersion[]; loading: boolean; error: string }>({ key: "", versions: [], loading: true, error: "" });
  const [selection, setSelection] = useState({ key, id: "" });
  const [reload, setReload] = useState(0);
  const [openedKey, setOpenedKey] = useState(() => {
    try { return sessionStorage.getItem(key) ? key : ""; } catch { return ""; }
  });
  const expanded = openedKey === key;
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.articleId === articleId && detail?.stage === stage) setReload(value => value + 1);
    };
    window.addEventListener('writer:generation-saved', refresh);
    return () => window.removeEventListener('writer:generation-saved', refresh);
  }, [articleId, stage]);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setState({ key, versions: [], loading: true, error: "" });
    let saved = "";
    try { saved = sessionStorage.getItem(key) ?? ""; } catch { /* Storage is optional. */ }
    setSelection({ key, id: saved });
    getArticleStages(articleId).then(rows => {
      if (!active) return;
      const versions = rows.filter(row => row.stage === stage && row.output_snapshot &&
        (stage === "draft" ? typeof row.output_snapshot.markdown === "string" : Array.isArray(row.output_snapshot.sections)))
        .sort((a, b) => b.revision_number - a.revision_number);
      setState({ key, versions, loading: false, error: "" });
      if (!versions.some(row => row.id === saved)) setSelection({ key, id: "" });
    }).catch(() => { if (active) setState({ key, versions: [], loading: false, error: tr("Không tải được lịch sử. Bản hiện hành vẫn được giữ.", "Could not load history. The current version is preserved.") }); });
    return () => { active = false; };
  }, [articleId, stage, generationId, reload, key, expanded]);
  const versions = state.key === key ? state.versions : [];
  const selected = versions.find(row => row.id === (selection.key === key ? selection.id : ""));
  const label = stage === "outline" ? tr("Lịch sử outline", "Outline history") : tr("Lịch sử draft", "Draft history");
  const trigger = <span className={children ? "group relative inline-flex shrink-0" : "block"}>
    <button type="button"
      className={children ? "draft-toolbar-action" : "flex min-h-11 w-full items-center gap-2 rounded-xl p-3 text-left text-sm font-medium hover:bg-[var(--ui-control)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ui-text)]"}
      aria-label={label} title={children ? label : undefined} aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
      onClick={() => setOpenedKey(expanded ? "" : key)}>
      {children ? <History className="app-icon" aria-hidden="true" /> : <>
        <History className="app-icon shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{label}</span>
        {expanded ? <ChevronUp className="app-icon shrink-0" aria-hidden="true" /> : <ChevronDown className="app-icon shrink-0" aria-hidden="true" />}
      </>}
    </button>
    {children && <span role="tooltip" className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2 py-1 text-xs text-[var(--ui-text)] group-hover:block group-focus-within:block">{label}</span>}
  </span>;
  const content = <>
    <label className="block text-sm font-medium">
      {stage === "outline" ? tr("Phiên bản outline", "Outline version") : tr("Phiên bản draft", "Draft version")}
      <select className="block min-h-11 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-control)] px-3 mt-2" value={selected?.id ?? ""} disabled={state.key !== key || state.loading} onChange={event => {
        const id = event.target.value; setSelection({ key, id });
        try { sessionStorage.setItem(key, id); } catch { /* Storage is optional. */ }
      }}>
        <option value="">{tr("Bản hiện hành (chỉnh sửa bên dưới)", "Current version (edit below)")}</option>
        {versions.map(row => <option key={row.id} value={row.id}>{tr("Phiên bản", "Version")} {row.revision_number} · {row.output_snapshot?.generationId ? tr("Lượt generate", "Generation") : tr("Lịch sử cũ", "Legacy history")} · {row.created_at && !Number.isNaN(Date.parse(row.created_at)) ? new Date(row.created_at).toLocaleString() : tr("Không có ngày", "Date unavailable")}</option>)}
      </select>
    </label>
    {(state.key !== key || state.loading) && <p role="status">{tr("Đang tải lịch sử…", "Loading history…")}</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {!state.loading && !state.error && versions.length === 0 && <p className="text-xs">{tr("Chưa có phiên bản đã lưu.", "No saved versions yet.")}</p>}
    <button type="button" className="min-h-11 underline" onClick={() => setReload(value => value + 1)}>{tr("Tải lại lịch sử", "Reload history")}</button>
    {selected && <div className="space-y-3" data-testid={`${stage}-history-preview`}>
      <p role="status" className="text-xs">{tr("Chỉ xem lịch sử. Editor, QC và xuất bài vẫn dùng bản hiện hành bên dưới.", "Read-only history. The editor, QC and export still use the current version below.")}</p>
      {stage === "draft" ? <pre className="whitespace-pre-wrap break-words font-sans">{selected.output_snapshot?.markdown}</pre> : selected.output_snapshot?.sections?.map((section, index) => <div key={index} className="whitespace-pre-wrap break-words"><h3 className="font-medium">{section.heading}</h3><p>{section.notes}</p><details><summary>{tr("Chi tiết snapshot", "Snapshot details")}</summary><pre className="whitespace-pre-wrap break-words font-sans text-xs">{JSON.stringify(section, null, 2)}</pre></details></div>)}
    </div>}
  </>;
  const panel = expanded ? <section id={panelId} className="rounded-xl border border-[var(--ui-border)] p-3 space-y-2 text-[var(--ui-text)]" aria-label={tr("Lịch sử phiên bản", "Version history")}>{content}</section> : null;
  return children ? children(trigger, panel) : <section className="rounded-xl border border-[var(--ui-border)] text-[var(--ui-text)]" aria-label={tr("Lịch sử phiên bản", "Version history")}>
    {trigger}
    {expanded && <div id={panelId} className="space-y-2 px-3 pb-3">{content}</div>}
  </section>;
}
