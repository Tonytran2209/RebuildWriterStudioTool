import { useState, useMemo } from "react";
import type {
  Article,
  AIModel,
  AppConfig,
  DocumentFile,
  OutlineSection,
  SearchIntent,
} from "../../types";
import { callAI } from "../../lib/aiService";
import { useI18n } from "../../lib/i18n";
import {
  collectStepDocs,
  buildRoleSystemPrompt,
  buildActionPlanFingerprint,
  describeBundle,
} from "../../lib/docContext";
import { hasResearchEvidence, hasRulesEvidence, verifiedRuleRefs, verifyEvidence } from "../../lib/evidenceValidation";

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
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Không tìm thấy mảng JSON.");
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

function normalizeSections(parsed: unknown, bundle: ReturnType<typeof collectStepDocs>): OutlineSection[] {
  if (!Array.isArray(parsed)) throw new Error("Phản hồi AI không phải mảng.");
  return parsed
    .map(raw => {
      if (!raw || typeof raw !== "object") return null;
      const obj = raw as Record<string, unknown>;
      const heading = String(obj.heading ?? obj.title ?? "").trim();
      if (!heading) return null;
      const lvl = String(obj.level ?? "h2").toLowerCase();
      const evidence = verifyEvidence(obj.evidence, bundle);
      if (!hasResearchEvidence(evidence) || !hasRulesEvidence(evidence)) return null;
      return {
        id: generateId(),
        heading,
        notes: String(obj.notes ?? obj.description ?? "").trim(),
        level: lvl === "h3" ? "h3" : "h2",
        keywords: toStringArr(obj.keywords),
        searchIntent: normalizeIntent(obj.searchIntent),
        evidence,
        ruleRefs: verifiedRuleRefs(obj.ruleRefs, bundle),
      } as OutlineSection;
    })
    .filter((v): v is OutlineSection => v !== null);
}

interface Props {
  article: Article;
  config: AppConfig;
  files: DocumentFile[];
  model: AIModel;
  railwayUrl: string;
  onUpdate: (updates: Partial<Article>) => void;
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
  const [suggestedKeywords, setSuggestedKeywords] = useState<string[]>([]);
  const [newSectionHeading, setNewSectionHeading] = useState("");
  const [newSectionLevel, setNewSectionLevel] = useState<"h2" | "h3">("h2");
  const outline = article.outline || [];

  const bundle = useMemo(() => collectStepDocs(3, config, files), [config, files]);
  const sourceFingerprint = useMemo(
    () => [
      buildActionPlanFingerprint(bundle), model.provider, model.id, "step3-evidence-v1",
      article.contentType, article.topic, article.angle, article.keywords,
      article.targetAudience, article.tone, article.wordCount,
    ].join(":"),
    [article.angle, article.contentType, article.keywords, article.targetAudience, article.tone, article.topic, article.wordCount, bundle, model.id, model.provider],
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

  const handleGenerate = async () => {
    if (!article.topic) {
      setError("Chưa có Core Idea từ Step 2.");
      return;
    }
    if (!bundle.knowledgeBase.length && !bundle.actionPlan.length) {
      setError("Step 3 cần ít nhất một Knowledge Base hoặc Action Plan có nội dung thật.");
      return;
    }
    if (!bundle.rules.length) {
      setError("Step 3 chưa được cấp Rules & Guidelines để kiểm chứng outline.");
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
          "- Mỗi section PHẢI ghi rõ: keywords được nhắm tới, searchIntent, evidence (nguồn tài liệu KB/Action/Rules đã dùng).",
          "- Mỗi section phải có ít nhất 1 quote nguyên văn từ KB/Action và 1 quote nguyên văn từ Rules.",
          "- source phải đúng chính xác tên file được cấp; quote phải chép nguyên văn, không diễn giải.",
          "",
          "Trả về DUY NHẤT một mảng JSON hợp lệ, không markdown fences, không giải thích.",
          "- JSON phải parse được bằng JSON.parse: dùng dấu phẩy giữa mọi field/phần tử và escape dấu ngoặc kép nằm trong chuỗi bằng \\\".",
          "Schema mỗi phần tử:",
          `{
  "heading": string (tiêu đề section, sẵn sàng dùng),
  "level": "h2" | "h3",
  "notes": string (1 câu ngắn mô tả nội dung, tối đa 120 ký tự),
  "keywords": string[] (2-5 từ khóa nhắm tới),
  "searchIntent": "informational" | "commercial" | "transactional" | "navigational",
  "evidence": [{ "source": string, "note": string, "quote": string, "role": "kb" | "action" | "rules" }],
  "ruleRefs": string[]
}`,
        ].join("\n"),
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
        "Yêu cầu: Trả về outline dạng JSON array với keyword mapping, search intent và evidence chi tiết cho từng section.",
      ].join("\n");

      const res = await callAI({
        model,
        railwayUrl,
        prompt: userPrompt,
        systemPrompt,
        maxTokens: 8000,
        temperature: 0.1,
        stepNumber: 3,
      });
      let parsed: unknown;
      try {
        parsed = extractJson(res.content);
      } catch {
        const repairPrompt = [
          "Chuẩn hóa nội dung bên dưới thành đúng một JSON array hợp lệ.",
          "Giữ nguyên dữ liệu và thứ tự section; chỉ sửa cú pháp JSON, dấu phẩy và escape chuỗi.",
          "Không thêm markdown hoặc giải thích.",
          "",
          res.content,
        ].join("\n");
        const repaired = await callAI({
          model,
          railwayUrl,
          prompt: repairPrompt,
          systemPrompt: "Bạn là JSON formatter. Chỉ trả về JSON array parse được bằng JSON.parse.",
          maxTokens: 8000,
          temperature: 0,
          stepNumber: 3,
        });
        parsed = extractJson(repaired.content);
      }
      let sections = normalizeSections(parsed, bundle);
      let generatedAt = res.servedAt ?? res.generatedAt ?? new Date().toISOString();
      if (!sections.length) {
        const corrected = await callAI({
          model,
          railwayUrl,
          prompt: `${userPrompt}\n\nLần trước không có section vượt qua kiểm chứng. Bắt buộc mỗi section chép quote nguyên văn và đúng tên source cho cả KB/Action lẫn Rules.`,
          systemPrompt,
          maxTokens: 8000,
          temperature: 0.1,
          stepNumber: 3,
        });
        sections = normalizeSections(extractJson(corrected.content), bundle);
        generatedAt = corrected.servedAt ?? corrected.generatedAt ?? new Date().toISOString();
      }
      if (!sections.length) throw new Error("AI chưa trả về outline có đủ evidence KB/Action và Rules.");
      onUpdate({ outline: sections, outlineSourceFingerprint: sourceFingerprint, outlineScannedAt: generatedAt });
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
    setSuggestedKeywords([]);
    try {
      const systemPrompt = buildRoleSystemPrompt(
        [
          outputInstruction,
          "Đề xuất 6-10 từ khóa phụ / long-tail liên quan tới angle và tài liệu được cấp.",
          "- Chỉ trả về mảng JSON các chuỗi từ khóa (không kèm mô tả).",
          "- Ưu tiên từ khóa có căn cứ trong Knowledge Base / Action Plan.",
          "- Tránh trùng lặp với keywords đã có.",
        ].join("\n"),
      );
      const userPrompt = [
        `TÀI LIỆU STEP 3 (${describeBundle(bundle)}):`,
        "Railway sẽ nạp trực tiếp nội dung các tài liệu đã được cấp quyền cho Step 3 từ Supabase.",
        "",
        `Chủ đề: "${contextBrief.topic}" · Angle: "${contextBrief.angle}"`,
        `Keywords đã có: ${[contextBrief.primaryKeyword, ...contextBrief.secondaryKeywords].join(", ")}`,
        "",
        "Trả về JSON array các chuỗi keyword, không giải thích.",
      ].join("\n");
      const res = await callAI({ model, railwayUrl, prompt: userPrompt, systemPrompt, stepNumber: 3 });
      const parsed = extractJson(res.content);
      if (!Array.isArray(parsed)) throw new Error("Không phải mảng.");
      setSuggestedKeywords(parsed.map(String).filter(Boolean));
    } catch {
      setSuggestedKeywords([]);
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
                onClick={handleGenerate}
                disabled={generating}
                className="shrink-0 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all"
              >
                {generating ? tr('Đang dựng...', 'Generating...') : outline.length ? tr('Tạo lại', 'Regenerate') : tr('Tạo outline', 'Generate outline')}
              </button>
            </div>

            {outlineIsStale && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Nguồn tài liệu, model hoặc Core Idea đã thay đổi — hãy tạo lại outline để dùng evidence mới.
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
                  {suggestingKeywords ? tr('Đang gợi ý...', 'Suggesting...') : tr('Gợi ý keyword theo angle', 'Suggest keywords by angle')}
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
          disabled={outline.length === 0 || outlineIsStale}
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
}: {
  index: number;
  section: OutlineSection;
  onChange: (patch: Partial<OutlineSection>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  keywordSuggestions: string[];
  onAddKeyword: (kw: string) => void;
}) {
  const { tr } = useI18n();
  const [expanded, setExpanded] = useState(false);
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
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{tr('Nguồn tham khảo', 'Sources')}</label>
              <div className="flex flex-wrap gap-1 mt-1">
                {section.evidence?.map((e, i) => (
                  <span
                    key={i}
                    className={`text-[10px] rounded-md px-2 py-0.5 border ${
                      e.role ? EVIDENCE_ROLE_STYLE[e.role] : "bg-white text-slate-600 border-slate-200"
                    }`}
                    title={e.note ? `${e.source} — ${e.note}` : e.source}
                  >
                    {e.source}
                  </span>
                ))}
              </div>
            </div>
          )}
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
    </div>
  );
}
