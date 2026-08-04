import { useState, useMemo } from "react";
import type {
  Article,
  AIModel,
  AppConfig,
  DocumentFile,
  OutlineSection,
  EvidenceRef,
  SearchIntent,
} from "../../types";
import { callAI } from "../../lib/aiService";
import {
  collectStepDocs,
  buildDocContextBlock,
  buildRoleSystemPrompt,
  describeBundle,
} from "../../lib/docContext";

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

const SEARCH_INTENT_META: Record<SearchIntent, { label: string; color: string; icon: string }> = {
  informational: { label: "Informational", color: "bg-blue-100 text-blue-700 border-blue-200", icon: "ℹ" },
  commercial:    { label: "Commercial",    color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: "◈" },
  transactional: { label: "Transactional", color: "bg-amber-100 text-amber-700 border-amber-200", icon: "★" },
  navigational:  { label: "Navigational",  color: "bg-slate-100 text-slate-700 border-slate-200", icon: "◎" },
};

const EVIDENCE_ROLE_STYLE: Record<string, string> = {
  kb:     "bg-indigo-50 text-indigo-700 border-indigo-200",
  action: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rules:  "bg-amber-50 text-amber-700 border-amber-200",
};

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Không tìm thấy mảng JSON.");
  return JSON.parse(body.slice(start, end + 1));
}

function toStringArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean) : [];
}

function normalizeEvidence(v: unknown): EvidenceRef[] {
  if (!Array.isArray(v)) return [];
  return v
    .map(e => {
      if (!e) return null;
      if (typeof e === "string") return { source: e } as EvidenceRef;
      if (typeof e === "object") {
        const obj = e as Record<string, unknown>;
        const source = String(obj.source ?? obj.doc ?? obj.name ?? "").trim();
        if (!source) return null;
        const roleRaw = String(obj.role ?? "").toLowerCase();
        const role: EvidenceRef["role"] =
          roleRaw === "kb" || roleRaw === "action" || roleRaw === "rules" ? roleRaw : undefined;
        return { source, note: obj.note ? String(obj.note) : undefined, role };
      }
      return null;
    })
    .filter((v): v is EvidenceRef => v !== null);
}

function normalizeIntent(v: unknown): SearchIntent | undefined {
  const s = String(v ?? "").toLowerCase();
  if (s === "informational" || s === "commercial" || s === "transactional" || s === "navigational") return s;
  return undefined;
}

function normalizeSections(parsed: unknown): OutlineSection[] {
  if (!Array.isArray(parsed)) throw new Error("Phản hồi AI không phải mảng.");
  return parsed
    .map(raw => {
      if (!raw || typeof raw !== "object") return null;
      const obj = raw as Record<string, unknown>;
      const heading = String(obj.heading ?? obj.title ?? "").trim();
      if (!heading) return null;
      const lvl = String(obj.level ?? "h2").toLowerCase();
      return {
        id: generateId(),
        heading,
        notes: String(obj.notes ?? obj.description ?? "").trim(),
        level: lvl === "h3" ? "h3" : "h2",
        keywords: toStringArr(obj.keywords),
        searchIntent: normalizeIntent(obj.searchIntent),
        evidence: normalizeEvidence(obj.evidence),
        ruleRefs: toStringArr(obj.ruleRefs),
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
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestingKeywords, setSuggestingKeywords] = useState(false);
  const [suggestedKeywords, setSuggestedKeywords] = useState<string[]>([]);
  const [newSectionHeading, setNewSectionHeading] = useState("");
  const [newSectionLevel, setNewSectionLevel] = useState<"h2" | "h3">("h2");
  const outline = article.outline || [];

  const bundle = useMemo(() => collectStepDocs(3, config, files), [config, files]);
  const contextBlock = useMemo(() => buildDocContextBlock(bundle), [bundle]);

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
    setGenerating(true);
    setError(null);
    try {
      const systemPrompt = buildRoleSystemPrompt(
        [
          "Tạo dàn bài (outline) chi tiết với keyword mapping và search intent cho từng section.",
          "- Knowledge Base cung cấp luận điểm và evidence cho từng mục.",
          "- Action Plan xác định cấu trúc mẫu và các mục bắt buộc phải có.",
          "- Rules & Guidelines quyết định định dạng heading, độ sâu H2/H3, cách đặt tiêu đề, quy tắc SEO.",
          "- Mỗi section PHẢI ghi rõ: keywords được nhắm tới, searchIntent, evidence (nguồn tài liệu KB/Action/Rules đã dùng).",
          "",
          "Trả về DUY NHẤT một mảng JSON hợp lệ, không markdown fences, không giải thích.",
          "Schema mỗi phần tử:",
          `{
  "heading": string (tiêu đề section, sẵn sàng dùng),
  "level": "h2" | "h3",
  "notes": string (1-2 câu mô tả nội dung sẽ trình bày),
  "keywords": string[] (2-5 từ khóa nhắm tới trong section này, ưu tiên từ danh sách keywords có sẵn),
  "searchIntent": "informational" | "commercial" | "transactional" | "navigational",
  "evidence": [{ "source": string (tên tài liệu), "note": string (data/luận điểm rút ra), "role": "kb" | "action" | "rules" }],
  "ruleRefs": string[] (tên rule/guideline áp dụng cho section)
}`,
        ].join("\n"),
      );

      const userPrompt = [
        `TÀI LIỆU STEP 3 (${describeBundle(bundle)}):`,
        contextBlock,
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

      const res = await callAI({ model, railwayUrl, prompt: userPrompt, systemPrompt });
      const parsed = extractJson(res.content);
      const sections = normalizeSections(parsed);
      if (!sections.length) throw new Error("AI không trả về section hợp lệ.");
      onUpdate({ outline: sections });
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
          "Đề xuất 6-10 từ khóa phụ / long-tail liên quan tới angle và tài liệu được cấp.",
          "- Chỉ trả về mảng JSON các chuỗi từ khóa (không kèm mô tả).",
          "- Ưu tiên từ khóa có căn cứ trong Knowledge Base / Action Plan.",
          "- Tránh trùng lặp với keywords đã có.",
        ].join("\n"),
      );
      const userPrompt = [
        `TÀI LIỆU STEP 3 (${describeBundle(bundle)}):`,
        contextBlock,
        "",
        `Chủ đề: "${contextBrief.topic}" · Angle: "${contextBrief.angle}"`,
        `Keywords đã có: ${[contextBrief.primaryKeyword, ...contextBrief.secondaryKeywords].join(", ")}`,
        "",
        "Trả về JSON array các chuỗi keyword, không giải thích.",
      ].join("\n");
      const res = await callAI({ model, railwayUrl, prompt: userPrompt, systemPrompt });
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

  const addSection = (extraKeyword?: string) => {
    const heading = newSectionHeading.trim();
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
      <div className="bg-[#ebedf3] rounded-3xl p-1.5 shadow-sm border border-slate-200/60 flex-1 flex flex-col min-h-0">
        <div className="bg-white rounded-2xl p-6 flex-1 overflow-y-auto shadow-sm">
          <div className="max-w-4xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-800 mb-1">Step 3: Draft Outline</h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  AI dệt outline từ dữ liệu Step 1-2 + Rules DB. Mỗi section có keyword mapping, search intent và evidence rõ nguồn.
                </p>
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="shrink-0 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all flex items-center space-x-1.5"
              >
                {generating ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>AI đang dựng...</span>
                  </>
                ) : (
                  <><span>✨</span><span>{outline.length ? "Tạo lại" : "AI Tạo Outline"}</span></>
                )}
              </button>
            </div>

            {/* Context brief — data from Step 1-2 + Rules */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Dữ liệu đầu vào cho Outline</span>
                <span className="text-[10px] font-mono text-slate-500">Tài liệu Step 3: {describeBundle(bundle)}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px]">
                <BriefItem icon="📋" label="Loại nội dung" value={contextBrief.contentType} tone="slate" />
                <BriefItem icon="🎯" label="Angle" value={contextBrief.angle} tone="indigo" />
                <BriefItem icon="🎙" label="Tone" value={contextBrief.tone} tone="slate" />
                <BriefItem icon="👥" label="Độc giả" value={contextBrief.audience} tone="slate" wide />
                <BriefItem icon="📏" label="Số từ" value={`${contextBrief.wordCount.toLocaleString()} từ`} tone="slate" />
                <BriefItem icon="🔑" label="Primary KW" value={contextBrief.primaryKeyword} tone="indigo" />
              </div>
              {contextBrief.topic && (
                <div className="bg-white border border-slate-200 rounded-xl p-2.5">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Core Idea</div>
                  <div className="text-xs font-semibold text-slate-800">{contextBrief.topic}</div>
                </div>
              )}
              {contextBrief.secondaryKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {contextBrief.secondaryKeywords.map(kw => (
                    <span key={kw} className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5">
                      {kw}
                    </span>
                  ))}
                </div>
              )}
              {bundle.rules.length > 0 && (
                <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-2.5">
                  <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">Rules & Guidelines áp dụng</div>
                  <div className="text-[11px] text-amber-800">{bundle.rules.map(r => r.name).join(", ")}</div>
                </div>
              )}
            </div>

            {error && <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-700">{error}</div>}

            {generating && (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="space-y-2 p-4 border-2 border-slate-100 rounded-2xl">
                    <div className="ai-loading h-5 w-2/3" />
                    <div className="ai-loading h-3 w-full" />
                    <div className="flex gap-2 pt-1">
                      <div className="ai-loading h-5 w-16 rounded-full" />
                      <div className="ai-loading h-5 w-20 rounded-full" />
                      <div className="ai-loading h-5 w-14 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!generating && outline.length === 0 && (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center">
                <div className="text-3xl mb-3">📄</div>
                <p className="text-sm font-semibold text-slate-600">Chưa có outline</p>
                <p className="text-xs text-slate-400 mt-1">Nhấn "AI Tạo Outline" để dệt dàn bài từ dữ liệu Step 1-2</p>
              </div>
            )}

            {/* Outline sections */}
            {!generating && outline.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">
                    <b className="text-slate-700">{outline.length}</b> section — <b>{h2Count}</b> H2 · <b>{h3Count}</b> H3
                  </span>
                </div>

                <div className="space-y-2.5">
                  {outline.map(section => (
                    <SectionCard
                      key={section.id}
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

            {/* Add section panel */}
            <div className="border-2 border-dashed border-slate-300 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-700">+ Thêm section hoặc luận điểm nhánh</div>
                <button
                  onClick={handleSuggestKeywords}
                  disabled={suggestingKeywords || (!contextBrief.angle && !contextBrief.topic)}
                  className="text-[10px] font-semibold bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 text-indigo-700 border border-indigo-200 rounded-full px-3 py-1 transition-all"
                >
                  {suggestingKeywords ? "..." : "💡 Gợi ý keyword theo angle"}
                </button>
              </div>

              <div className="flex gap-2">
                <select
                  value={newSectionLevel}
                  onChange={e => setNewSectionLevel(e.target.value as "h2" | "h3")}
                  className="bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-slate-800"
                >
                  <option value="h2">H2</option>
                  <option value="h3">H3</option>
                </select>
                <input
                  value={newSectionHeading}
                  onChange={e => setNewSectionHeading(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addSection()}
                  placeholder="Tiêu đề section mới..."
                  className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-slate-800 placeholder:text-slate-400"
                />
                <button
                  onClick={() => addSection()}
                  disabled={!newSectionHeading.trim()}
                  className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold px-4 py-1.5 rounded-xl transition-all"
                >
                  Thêm
                </button>
              </div>

              {suggestedKeywords.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Keyword gợi ý theo angle (click để tạo section mới với keyword đó)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestedKeywords.map(kw => (
                      <button
                        key={kw}
                        onClick={() => {
                          setNewSectionHeading(kw);
                          addSection(kw);
                        }}
                        className="text-[11px] font-semibold bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2.5 py-1 transition-all"
                      >
                        + {kw}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between shrink-0">
        <button onClick={onPrev} className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs py-2.5 px-5 rounded-2xl shadow-sm transition-all">
          ← Quay lại
        </button>
        <button
          onClick={onNext}
          disabled={outline.length === 0}
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs py-2.5 px-6 rounded-2xl shadow-sm transition-all flex items-center space-x-2"
        >
          <span>Tiếp tục → First Draft</span>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

const BRIEF_TONE: Record<string, string> = {
  slate: "border-slate-200 bg-white",
  indigo: "border-indigo-200 bg-indigo-50/70",
};

function BriefItem({
  icon,
  label,
  value,
  tone,
  wide,
}: {
  icon: string;
  label: string;
  value: string;
  tone: string;
  wide?: boolean;
}) {
  return (
    <div className={`border rounded-xl px-2.5 py-1.5 ${BRIEF_TONE[tone]} ${wide ? "col-span-2" : ""}`}>
      <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{icon} {label}</div>
      <div className="text-[11px] font-semibold text-slate-800 truncate mt-0.5">
        {value || <span className="text-slate-400 italic font-normal">chưa có</span>}
      </div>
    </div>
  );
}

function SectionCard({
  section,
  onChange,
  onRemove,
  onMove,
  keywordSuggestions,
  onAddKeyword,
}: {
  section: OutlineSection;
  onChange: (patch: Partial<OutlineSection>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  keywordSuggestions: string[];
  onAddKeyword: (kw: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const intentMeta = section.searchIntent ? SEARCH_INTENT_META[section.searchIntent] : null;
  const isH3 = section.level === "h3";

  return (
    <div
      className={`group border-2 rounded-2xl p-4 transition-all ${
        isH3
          ? "border-slate-100 bg-white ml-6"
          : "border-slate-200 bg-slate-50/60"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start gap-2">
        <div className="flex flex-col gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={() => onMove(-1)} className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-800">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" /></svg>
          </button>
          <button onClick={() => onMove(1)} className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-800">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
          </button>
        </div>

        <span
          className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md mt-1 ${
            isH3 ? "bg-slate-200 text-slate-600" : "bg-slate-800 text-white"
          }`}
        >
          {section.level.toUpperCase()}
        </span>

        <input
          value={section.heading}
          onChange={e => onChange({ heading: e.target.value })}
          placeholder="Tiêu đề section..."
          className={`flex-1 bg-transparent outline-none text-slate-800 placeholder:text-slate-300 ${
            isH3 ? "text-xs font-semibold" : "text-sm font-bold"
          }`}
        />

        {intentMeta && (
          <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${intentMeta.color}`}>
            {intentMeta.icon} {intentMeta.label}
          </span>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-700 shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md border border-slate-200"
        >
          {expanded ? "−" : "+"} Edit
        </button>
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-red-500 shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Notes */}
      {section.notes && !expanded && (
        <p className="text-[11px] text-slate-600 mt-2 leading-relaxed pl-12">{section.notes}</p>
      )}

      {/* Keywords chips */}
      {section.keywords && section.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 pl-12">
          {section.keywords.map((kw, i) => (
            <span
              key={i}
              className={`text-[10px] font-semibold rounded-full px-2 py-0.5 border ${
                i === 0
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-indigo-50 text-indigo-700 border-indigo-200"
              }`}
            >
              🔑 {kw}
            </span>
          ))}
        </div>
      )}

      {/* Evidence */}
      {section.evidence && section.evidence.length > 0 && (
        <div className="mt-2 pl-12 space-y-1">
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Evidence</div>
          <div className="flex flex-wrap gap-1">
            {section.evidence.map((e, i) => (
              <span
                key={i}
                className={`text-[10px] font-semibold rounded-md px-2 py-0.5 border ${
                  e.role ? EVIDENCE_ROLE_STYLE[e.role] : "bg-slate-100 text-slate-700 border-slate-200"
                }`}
                title={e.note}
              >
                📎 {e.source}{e.note ? ` — ${e.note}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Rules refs */}
      {section.ruleRefs && section.ruleRefs.length > 0 && (
        <div className="mt-2 pl-12 text-[10px] text-amber-700">
          <span className="font-bold">Rules:</span> {section.ruleRefs.join(", ")}
        </div>
      )}

      {/* Expanded editor */}
      {expanded && (
        <div className="mt-3 pl-12 space-y-2 border-t border-slate-200 pt-3">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Notes</label>
            <textarea
              value={section.notes}
              onChange={e => onChange({ notes: e.target.value })}
              rows={2}
              placeholder="Nội dung sẽ trình bày trong section..."
              className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-slate-800 resize-none mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Search Intent</label>
              <select
                value={section.searchIntent || ""}
                onChange={e => onChange({ searchIntent: (e.target.value || undefined) as SearchIntent | undefined })}
                className="w-full bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-xs text-slate-700 outline-none mt-1"
              >
                <option value="">— chưa xác định —</option>
                {Object.entries(SEARCH_INTENT_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Level</label>
              <select
                value={section.level}
                onChange={e => onChange({ level: e.target.value as "h2" | "h3" })}
                className="w-full bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-xs text-slate-700 outline-none mt-1"
              >
                <option value="h2">H2</option>
                <option value="h3">H3</option>
              </select>
            </div>
          </div>
          {keywordSuggestions.length > 0 && (
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Thêm keyword từ gợi ý
              </label>
              <div className="flex flex-wrap gap-1 mt-1">
                {keywordSuggestions
                  .filter(k => !section.keywords?.includes(k))
                  .map(k => (
                    <button
                      key={k}
                      onClick={() => onAddKeyword(k)}
                      className="text-[10px] font-semibold bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5 transition-all"
                    >
                      + {k}
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
