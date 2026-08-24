import { useState, useMemo } from "react";
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
import {
  collectStepDocs,
  buildRoleSystemPrompt,
  buildStepDocumentPromptRules,
  buildActionPlanFingerprint,
  describeBundle,
} from "../../lib/docContext";
import { hasEvidenceForAuthorizedCategories, verifiedRuleRefs, verifyEvidence } from "../../lib/evidenceValidation";
import { ProcessTraceModal } from './ProcessTrace';

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

const SEARCH_INTENT_META: Record<SearchIntent, { label: string; color: string }> = {
  informational: { label: "Informational", color: "bg-blue-50 text-blue-700 border-blue-200" },
  commercial:    { label: "Commercial",    color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  transactional: { label: "Transactional", color: "bg-amber-50 text-amber-700 border-amber-200" },
  navigational:  { label: "Navigational",  color: "bg-slate-100 text-slate-700 border-slate-200" },
};

const EVIDENCE_ROLE_STYLE: Record<string, string> = {
  kb:     "bg-indigo-50 text-indigo-700 border-indigo-100",
  action: "bg-emerald-50 text-emerald-700 border-emerald-100",
  rules:  "bg-amber-50 text-amber-700 border-amber-100",
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

function normalizeSections(parsed: unknown, bundle: ReturnType<typeof collectStepDocs>): { sections: OutlineSection[]; rejectedHeadings: string[] } {
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const rawSections = root?.sections ?? parsed;
  if (!Array.isArray(rawSections)) throw new Error("Phản hồi AI không có mảng sections.");
  const registry = root?.evidenceRegistry && typeof root.evidenceRegistry === "object" && !Array.isArray(root.evidenceRegistry)
    ? root.evidenceRegistry as Record<string, unknown>
    : {};
  const rejectedHeadings: string[] = [];
  const sections = rawSections
    .map(raw => {
      if (!raw || typeof raw !== "object") return null;
      const obj = raw as Record<string, unknown>;
      const heading = String(obj.heading ?? obj.title ?? "").trim();
      if (!heading) return null;
      const lvl = String(obj.level ?? "h2").toLowerCase();
      const evidenceRefs = toStringArr(obj.evidenceRefs);
      const registryEvidence = evidenceRefs.map(ref => registry[ref]).filter(Boolean);
      const evidence = verifyEvidence([
        ...(Array.isArray(obj.evidence) ? obj.evidence : []),
        ...registryEvidence,
      ], bundle);
      if (!hasEvidenceForAuthorizedCategories(evidence, bundle)) {
        rejectedHeadings.push(heading);
        return null;
      }
      return {
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
  return { sections, rejectedHeadings };
}

function targetSectionCount(wordCount: number): number {
  if (wordCount <= 1000) return 6;
  if (wordCount <= 1800) return 8;
  return 10;
}

interface Props {
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
  article,
  config,
  files,
  model,
  railwayUrl,
  onUpdate,
  onNext,
  onPrev,
}: Props) {
  const { tr, outputInstruction } = useI18n();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestingKeywords, setSuggestingKeywords] = useState(false);
  const suggestedKeywords = article.step3SuggestedKeywords ?? [];
  const [newSectionHeading, setNewSectionHeading] = useState("");
  const [newSectionLevel, setNewSectionLevel] = useState<"h2" | "h3">("h2");
  const outline = article.outline || [];

  const bundle = useMemo(() => collectStepDocs(3, config, files), [config, files]);
  const documentPromptRules = useMemo(() => buildStepDocumentPromptRules(3, config, files), [config, files]);
  const sourceFingerprint = useMemo(
    () => [
      buildActionPlanFingerprint(bundle), model.provider, model.id, "step3-audit-v3",
      article.contentType, article.topic, article.angle, article.keywords,
      article.targetAudience, article.tone, article.wordCount, documentPromptRules,
    ].join(":"),
    [article.angle, article.contentType, article.keywords, article.targetAudience, article.tone, article.topic, article.wordCount, bundle, documentPromptRules, model.id, model.provider],
  );
  const outlineIsStale = Boolean(outline.length) && article.outlineSourceFingerprint !== sourceFingerprint;

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
  const desiredSections = targetSectionCount(contextBrief.wordCount);
  const minimumSections = Math.max(4, desiredSections - 2);
  const contextQuery = [
    contextBrief.contentType,
    contextBrief.topic,
    contextBrief.angle,
    contextBrief.primaryKeyword,
    ...contextBrief.secondaryKeywords,
  ].filter(Boolean).join(" ");

  const handleGenerate = async (manual = false) => {
    if (!article.topic) {
      setError("Chưa có Core Idea từ Step 2.");
      return;
    }
    if (!bundle.totalCount) {
      setError("Chưa có tài liệu nào được phân quyền cho Step 3. Chỉ cần chọn ít nhất một tài liệu từ KB, Action Plan hoặc Rules.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const systemPrompt = buildRoleSystemPrompt(
        [
          outputInstruction,
          "Tạo dàn bài (outline) chi tiết với keyword mapping và search intent cho từng section.",
          "- Knowledge Base cung cấp luận điểm và evidence cho từng mục.",
          "- Action Plan xác định cấu trúc mẫu và các mục bắt buộc phải có.",
          "- Rules & Guidelines quyết định định dạng heading, độ sâu H2/H3, cách đặt tiêu đề, quy tắc SEO.",
          "- Mỗi section PHẢI ghi rõ: keywords được nhắm tới, searchIntent và evidenceRefs trỏ tới evidenceRegistry dùng chung.",
          "- Mỗi section phải có rationale giải thích vì sao section này cần thiết, vì sao đặt ở vị trí đó và evidence hỗ trợ quyết định như thế nào.",
          "- Nếu có KB/Action, mỗi section cần ít nhất 1 quote từ KB hoặc Action. Nếu có Rules, cần thêm ít nhất 1 quote từ Rules. Bỏ qua nhóm đang trống.",
          "- source phải đúng chính xác tên file được cấp; quote phải chép nguyên văn, không diễn giải.",
          "",
          "Mỗi quote chỉ khai báo MỘT LẦN trong evidenceRegistry; nhiều section dùng chung quote phải tham chiếu cùng ID để tiết kiệm output.",
          "Trả về DUY NHẤT một JSON object hợp lệ, không markdown fences, không giải thích.",
          "- JSON phải parse được bằng JSON.parse: dùng dấu phẩy giữa mọi field/phần tử và escape dấu ngoặc kép nằm trong chuỗi bằng \\\".",
          "Schema:",
          `{
  "evidenceRegistry": {
    "ev-1": { "source": string, "note": string, "quote": string, "role": "kb" | "action" | "rules" }
  },
  "sections": [{
  "heading": string (tiêu đề section, sẵn sàng dùng),
  "level": "h2" | "h3",
  "notes": string (1 câu ngắn mô tả nội dung, tối đa 120 ký tự),
  "rationale": string (2-3 câu giải thích lý do chọn section, vị trí và căn cứ tài liệu),
  "keywords": string[] (2-5 từ khóa nhắm tới),
  "searchIntent": "informational" | "commercial" | "transactional" | "navigational",
  "evidenceRefs": string[] (ID tồn tại trong evidenceRegistry),
  "ruleRefs": string[]
  }]
}`,
        ].join("\n"),
        documentPromptRules,
      );

      const userPrompt = [
        `TÀI LIỆU STEP 3 (${describeBundle(bundle)}):`,
        "Railway sẽ nạp trực tiếp nội dung các tài liệu đã được cấp quyền cho Step 3 từ Supabase.",
        "",
        "DỮ LIỆU TỪ 2 BƯỚC TRƯỚC:",
        `- Loại nội dung (Step 1): ${contextBrief.contentType}`,
        `- Tiêu đề bài viết (Step 2): "${contextBrief.topic}"`,
        `- Angle: ${contextBrief.angle}`,
        `- Độc giả: ${contextBrief.audience}`,
        `- Tone: ${contextBrief.tone}`,
        `- Số từ mục tiêu: ${contextBrief.wordCount}`,
        `- Primary keyword: ${contextBrief.primaryKeyword}`,
        `- Secondary keywords: ${contextBrief.secondaryKeywords.join(", ")}`,
        "",
        `Yêu cầu: Trả về khoảng ${desiredSections} section trong JSON object với keyword mapping, search intent và evidence chi tiết.`,
      ].join("\n");

      let modelCalls = 1;
      const jsonRepairCalls = 0;
      let evidenceCorrectionCalls = 0;
      const aiResponses: Awaited<ReturnType<typeof callAI>>[] = [];
      const res = await callAI({
        articleId: article.id,
        model,
        railwayUrl,
        prompt: userPrompt,
        systemPrompt,
        maxTokens: Math.min(6000, 1800 + desiredSections * 400),
        temperature: 0.1,
        stepNumber: 3,
        bypassCache: manual,
        jsonMode: model.provider === "deepseek",
        contextQuery,
      });
      aiResponses.push(res);
      let lastResponse = res;
      const parsed = extractJson(res.content);
      const normalized = normalizeSections(parsed, bundle);
      let sections = normalized.sections;
      let generatedAt = res.servedAt ?? res.generatedAt ?? new Date().toISOString();
      if (sections.length < minimumSections) {
        evidenceCorrectionCalls += 1;
        modelCalls += 1;
        const missingCount = desiredSections - sections.length;
        const corrected = await callAI({
          articleId: article.id,
          model,
          railwayUrl,
          prompt: [
            userPrompt,
            "",
            `CHỈ BỔ SUNG ${missingCount} SECTION CÒN THIẾU; không tạo lại section đã hợp lệ.`,
            `Heading đã hợp lệ, không được lặp: ${sections.map(section => JSON.stringify(section.heading)).join(", ") || "(chưa có)"}.`,
            `Heading bị loại do evidence không hợp lệ: ${normalized.rejectedHeadings.map(JSON.stringify).join(", ") || "(không xác định)"}.`,
            "Nếu KB/Action có nguồn, mỗi section mới cần ít nhất 1 evidenceRef tới quote KB hoặc Action. Nếu Rules có nguồn, cần thêm evidenceRef tới quote Rules. Bỏ qua nhóm trống.",
            "Chỉ trả về JSON object { evidenceRegistry, sections } chứa các section bổ sung.",
          ].join("\n"),
          systemPrompt,
          maxTokens: Math.min(4000, 1200 + missingCount * 400),
          temperature: 0.1,
          stepNumber: 3,
          bypassCache: true,
          jsonMode: model.provider === "deepseek",
          contextQuery,
        });
        aiResponses.push(corrected);
        lastResponse = corrected;
        const additions = normalizeSections(extractJson(corrected.content), bundle).sections;
        sections = [...sections, ...additions]
          .filter((section, index, all) => all.findIndex(candidate => candidate.heading.toLocaleLowerCase() === section.heading.toLocaleLowerCase()) === index)
          .slice(0, desiredSections);
        generatedAt = corrected.servedAt ?? corrected.generatedAt ?? new Date().toISOString();
      }
      if (sections.length < minimumSections) throw new Error(`AI chỉ trả về ${sections.length}/${minimumSections} section tối thiểu có đủ evidence sau một lần bổ sung có mục tiêu.`);
      const trace: AIProcessTraceEvent[] = [
        { id: 'step3-handoff', stage: 'input', status: 'completed', title: '1. Nhận kết quả từ Step 1–2', detail: 'Khóa Content Type, Core Idea, angle, audience, tone, word count và bộ keyword đã chọn để làm đầu vào outline.', facts: { contentType: contextBrief.contentType, topic: contextBrief.topic, primaryKeyword: contextBrief.primaryKeyword, secondaryKeywords: contextBrief.secondaryKeywords.length } },
        { id: 'step3-docs', stage: 'retrieval', status: 'completed', title: '2. Nạp tài liệu Step 3', detail: `Railway chọn các đoạn KB, Action Plan và Rules liên quan nhất theo topic, angle và keyword; quote vẫn được đối chiếu với bản đầy đủ.\nPrompting rules theo phân vùng:\n${documentPromptRules || '(không có rule tùy chỉnh)'}`, facts: { kb: bundle.knowledgeBase.length, action: bundle.actionPlan.length, rules: bundle.rules.length } },
        { id: 'step3-generation', stage: 'generation', status: 'completed', title: '3. Model dựng outline', detail: `Model ${lastResponse.model} tạo heading, notes, rationale, keyword mapping và search intent; evidence dùng registry chung để không lặp quote.`, facts: { modelCalls, inputTokens: aiResponses.reduce((sum, response) => sum + (response.usage?.inputTokens ?? 0), 0), outputTokens: aiResponses.reduce((sum, response) => sum + (response.usage?.outputTokens ?? 0), 0), cacheHits: aiResponses.filter(response => response.cacheHit).length, durationMs: aiResponses.reduce((sum, response) => sum + (response.timing?.totalMs ?? 0), 0) } },
        { id: 'step3-validation', stage: 'validation', status: evidenceCorrectionCalls ? 'warning' : 'completed', title: '4. Kiểm tra cấu trúc và dẫn chứng', detail: 'Loại section thiếu quote nguyên văn ở bất kỳ phân vùng nào đang được cấp quyền. Nếu dưới ngưỡng tối thiểu, chỉ yêu cầu bổ sung phần còn thiếu.', facts: { sectionsAccepted: sections.length, evidenceVerified: sections.reduce((sum, section) => sum + (section.evidence?.length ?? 0), 0), jsonRepairCalls, evidenceCorrectionCalls } },
        { id: 'step3-persist', stage: 'persistence', status: 'completed', title: '5. Lưu outline và audit trail', detail: 'Lưu section, rationale, evidence, nguồn Rules và nhật ký hành động này cùng bài viết trong Supabase.' },
      ];
      const saved = await onUpdate({
        outline: sections,
        outlineSourceFingerprint: sourceFingerprint,
        outlineScannedAt: generatedAt,
        step3ProcessTrace: trace,
        draft: "",
        draftSourceFingerprint: null,
        draftScannedAt: null,
      });
      if (!saved) throw new Error('Outline Step 3 chưa được lưu vào Supabase.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Không tạo được outline: ${message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleSuggestKeywords = async () => {
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
      if (!candidates.length) throw new Error("Step 2 chưa có keyword đã kiểm chứng chưa được sử dụng.");
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
    });
  };

  const removeSection = (id: string) => {
    onUpdate({ outline: outline.filter(s => s.id !== id) });
  };

  const moveSection = (id: string, dir: -1 | 1) => {
    const idx = outline.findIndex(s => s.id === id);
    if (idx + dir < 0 || idx + dir >= outline.length) return;
    const next = [...outline];
    [next[idx], next[idx + dir]] = [next[idx + dir], next[idx]];
    onUpdate({ outline: next });
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

  const h2Count = outline.filter(s => s.level === "h2").length;
  const h3Count = outline.filter(s => s.level === "h3").length;

  return (
    <div className="h-full flex flex-col gap-4 animate-fade-in-up">
      <div className="bg-white rounded-2xl border border-slate-200 flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="p-3.5 sm:p-5 md:p-6 flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto space-y-6">

            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-800 mb-1">{tr('Bước 3 — Dàn bài nháp', 'Step 3 — Draft Outline')}</h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {tr('Đọc và chỉnh dàn ý theo đúng thứ tự bài viết. Mở chi tiết khi cần xem keyword, intent hoặc nguồn tham khảo.', 'Review and edit the outline in article order. Open details to inspect keywords, intent, or sources.')}
                </p>
              </div>
              <button
                onClick={() => handleGenerate(Boolean(outline.length))}
                disabled={generating}
                className="shrink-0 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all"
              >
                {generating ? tr('Đang dựng...', 'Generating...') : outline.length ? tr('Tạo lại', 'Regenerate') : tr('Tạo outline', 'Generate outline')}
              </button>
            </div>

            {outlineIsStale && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Nguồn hoặc model đã thay đổi — vẫn dùng outline đã lưu trong Supabase. Chỉ cập nhật khi bạn nhấn “Tạo lại”.
              </div>
            )}

            {error && <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 text-xs text-rose-700">{error}</div>}

            {generating && (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="border border-slate-200 rounded-xl p-4 space-y-2">
                    <div className="ai-loading h-4 w-2/3" />
                    <div className="ai-loading h-3 w-full" />
                  </div>
                ))}
              </div>
            )}

            {!generating && outline.length === 0 && (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center">
                <p className="text-sm font-semibold text-slate-600">{tr('Chưa có outline', 'No outline yet')}</p>
                <p className="text-xs text-slate-400 mt-1">{tr('Nhấn “Tạo outline” để dựng dàn bài từ dữ liệu Bước 1–2', 'Click “Generate outline” to build it from Step 1–2 data')}</p>
              </div>
            )}

            {/* Outline */}
            {!generating && outline.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                  <span>
                    <span className="font-mono text-slate-700 font-bold">{outline.length}</span> section — {h2Count} H2 · {h3Count} H3
                  </span>
                </div>

                <div className="space-y-2.5">
                  {outline.map((section, index) => (
                    <SectionRow
                      key={section.id}
                      index={index}
                      section={section}
                      onChange={patch => updateSection(section.id, patch)}
                      onRemove={() => removeSection(section.id)}
                      onMove={dir => moveSection(section.id, dir)}
                      keywordSuggestions={suggestedKeywords}
                      onAddKeyword={kw => addKeywordToSection(section.id, kw)}
                      processTrace={article.step3ProcessTrace}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Add section */}
            <div className="border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-700">{tr('Thêm section hoặc luận điểm nhánh', 'Add a section or supporting point')}</div>
                <button
                  onClick={handleSuggestKeywords}
                  disabled={suggestingKeywords || (!contextBrief.angle && !contextBrief.topic)}
                  className="text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 border border-slate-200 rounded-md px-2.5 py-1 transition-all"
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
                  className="col-span-2 sm:col-span-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold px-4 py-1.5 rounded-lg transition-all"
                >
                  {tr('Thêm', 'Add')}
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
                        className="text-[11px] font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-md px-2 py-0.5 transition-all"
                      >
                        {kw}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between gap-2 shrink-0">
        <button onClick={onPrev} className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs py-2.5 px-3 sm:px-5 rounded-2xl shadow-sm transition-all">
          {tr('Quay lại', 'Back')}
        </button>
        <button
          onClick={onNext}
          disabled={outline.length === 0}
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs py-2.5 px-3 sm:px-6 rounded-2xl shadow-sm transition-all"
        >
          {tr('Tiếp tục — First Draft', 'Continue — First Draft')}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

function SectionRow({
  index,
  section,
  onChange,
  onRemove,
  onMove,
  keywordSuggestions,
  onAddKeyword,
  processTrace,
}: {
  index: number;
  section: OutlineSection;
  onChange: (patch: Partial<OutlineSection>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  keywordSuggestions: string[];
  onAddKeyword: (kw: string) => void;
  processTrace?: AIProcessTraceEvent[];
}) {
  const { tr } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const isH3 = section.level === "h3";

  return (
    <div className={`group rounded-xl border transition-colors ${
      isH3 ? "ml-2 sm:ml-6 border-slate-200 bg-slate-50/60" : "border-slate-200 bg-white"
    }`}>
      <div className="flex flex-wrap sm:flex-nowrap items-start gap-2 sm:gap-3 p-3 sm:p-4">
        <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${
          isH3 ? "bg-white border border-slate-200 text-slate-500" : "bg-slate-900 text-white"
        }`}>
          {index + 1}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
              {section.level.toUpperCase()}
            </span>
            {section.searchIntent && (
              <span className="text-[9px] text-slate-400">· {SEARCH_INTENT_META[section.searchIntent].label}</span>
            )}
          </div>
          <input
            value={section.heading}
            onChange={e => onChange({ heading: e.target.value })}
            placeholder={tr('Tiêu đề section...', 'Section heading...')}
            className={`w-full bg-transparent outline-none text-slate-800 placeholder:text-slate-300 ${
              isH3 ? "text-sm font-semibold" : "text-sm font-bold"
            }`}
          />
          {section.notes && !expanded && (
            <p className="text-[11px] text-slate-500 leading-relaxed mt-1.5">{section.notes}</p>
          )}

          {!expanded && (
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              {section.keywords?.slice(0, 3).map((kw, i) => (
                <span key={i} className="text-[10px] text-slate-600 bg-slate-100 rounded-md px-2 py-0.5">
                  {kw}
                </span>
              ))}
              {(section.keywords?.length ?? 0) > 3 && (
                <span className="text-[10px] text-slate-400">+{section.keywords!.length - 3} keyword</span>
              )}
              {(section.evidence?.length ?? 0) > 0 && (
                <span className="text-[10px] text-slate-400 ml-1">· {section.evidence!.length} nguồn</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-0.5 shrink-0 w-full sm:w-auto">
          <button onClick={() => setShowAudit(true)} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-violet-700 hover:bg-violet-50 rounded-md" title={tr('Xem nhật ký AI', 'View AI log')} aria-label={`${tr('Xem nhật ký AI cho', 'View AI log for')} ${section.heading}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" strokeWidth="2"/><path d="m20 20-3.5-3.5" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
          <button onClick={() => onMove(-1)} className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-800 rounded" title={tr('Lên', 'Move up')}>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" /></svg>
          </button>
          <button onClick={() => onMove(1)} className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-800 rounded" title={tr('Xuống', 'Move down')}>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] font-semibold text-slate-500 hover:text-slate-800 px-2 py-1 rounded-md hover:bg-slate-100"
          >
            {expanded ? tr('Thu gọn', 'Collapse') : tr('Chi tiết', 'Details')}
          </button>
          <button onClick={onRemove} className="w-6 h-6 flex items-center justify-center text-slate-300 hover:text-red-500 rounded" title={tr('Xoá', 'Delete')}>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-4 space-y-3">
          <div>
            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Notes</label>
            <textarea
              value={section.notes}
              onChange={e => onChange({ notes: e.target.value })}
              rows={2}
              placeholder={tr('Nội dung sẽ trình bày trong section...', 'Content to cover in this section...')}
              className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-slate-800 resize-none mt-1"
            />
          </div>
          <div>
            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{tr('Lý do & điểm cần đánh giá', 'Rationale & review points')}</label>
            <textarea value={section.rationale ?? ''} onChange={e => onChange({ rationale: e.target.value })} rows={3} placeholder={tr('Vì sao section này cần thiết, vị trí và dẫn chứng hỗ trợ...', 'Why this section, its position, and supporting evidence...')} className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-slate-800 resize-y mt-1" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Search Intent</label>
              <select
                value={section.searchIntent || ""}
                onChange={e => onChange({ searchIntent: (e.target.value || undefined) as SearchIntent | undefined })}
                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 outline-none mt-1"
              >
                <option value="">— {tr('chưa xác định', 'not set')} —</option>
                {Object.entries(SEARCH_INTENT_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Level</label>
              <select
                value={section.level}
                onChange={e => onChange({ level: e.target.value as "h2" | "h3" })}
                className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 outline-none mt-1"
              >
                <option value="h2">H2</option>
                <option value="h3">H3</option>
              </select>
            </div>
          </div>
          {(section.keywords?.length ?? 0) > 0 && (
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Keywords</label>
              <div className="flex flex-wrap gap-1 mt-1">
                {section.keywords?.map((kw, i) => (
                  <span key={i} className="text-[10px] text-slate-600 bg-white border border-slate-200 rounded-md px-2 py-0.5">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(section.evidence?.length ?? 0) > 0 && (
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{tr('Toàn bộ dẫn chứng đã kiểm chứng', 'All verified evidence')}</label>
              <div className="space-y-2 mt-1">
                {section.evidence?.map((e, i) => (
                  <div
                    key={i}
                    className={`text-[10px] rounded-lg px-3 py-2 border ${
                      e.role ? EVIDENCE_ROLE_STYLE[e.role] : "bg-white text-slate-600 border-slate-200"
                    }`}
                  >
                    <div className="font-bold mb-1">{e.role?.toUpperCase()} · {e.source}</div>
                    {e.quote && <blockquote className="border-l-2 border-current/30 pl-2 leading-relaxed whitespace-pre-wrap">“{e.quote}”</blockquote>}
                    {e.note && <p className="mt-1.5"><b>{tr('Lý do sử dụng:', 'Why it matters:')}</b> {e.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {(section.ruleRefs?.length ?? 0) > 0 && <div><label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Rules áp dụng</label><div className="flex flex-wrap gap-1 mt-1">{section.ruleRefs?.map(rule => <span key={rule} className="text-[10px] rounded-md px-2 py-0.5 border bg-amber-50 text-amber-700 border-amber-100">{rule}</span>)}</div></div>}
          {keywordSuggestions.length > 0 && (
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                Thêm keyword từ gợi ý
              </label>
              <div className="flex flex-wrap gap-1 mt-1">
                {keywordSuggestions
                  .filter(k => !section.keywords?.includes(k))
                  .map(k => (
                    <button
                      key={k}
                      onClick={() => onAddKeyword(k)}
                      className="text-[10px] font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded px-1.5 py-0.5 transition-all"
                    >
                      {k}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
      {showAudit && <ProcessTraceModal title={section.heading} events={processTrace} onClose={() => setShowAudit(false)}><div className="space-y-4"><div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{tr('Lý do tạo section', 'Section rationale')}</div><p className="text-xs text-slate-700 leading-relaxed mt-2 whitespace-pre-wrap">{section.rationale || tr('Chưa có rationale trong kết quả đã lưu.', 'No rationale in the saved result.')}</p></div><div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">{tr('Dẫn chứng của section', 'Section evidence')}</div><div className="space-y-2">{section.evidence?.map((e, i) => <div key={`${e.source}-${i}`} className={`rounded-lg border p-3 text-[10px] ${e.role ? EVIDENCE_ROLE_STYLE[e.role] : 'bg-white border-slate-200'}`}><b>{e.role?.toUpperCase()} · {e.source}</b>{e.quote && <blockquote className="border-l-2 border-current/30 pl-2 mt-1.5 whitespace-pre-wrap">“{e.quote}”</blockquote>}{e.note && <p className="mt-1.5"><b>{tr('Lý do sử dụng:', 'Why it matters:')}</b> {e.note}</p>}</div>)}</div></div></div></ProcessTraceModal>}
    </div>
  );
}
