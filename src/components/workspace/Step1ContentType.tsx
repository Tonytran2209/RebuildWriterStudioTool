import { useState, useMemo, useEffect, useRef } from "react";
import type {
  Article,
  AIModel,
  AppConfig,
  DocumentFile,
  ContentTypeSuggestion,
} from "../../types";
import { callAI } from "../../lib/aiService";
import {
  collectStepDocs,
  buildDocContextBlock,
  buildRoleSystemPrompt,
  describeBundle,
} from "../../lib/docContext";

interface Props {
  article: Article;
  config: AppConfig;
  files: DocumentFile[];
  model: AIModel;
  railwayUrl: string;
  onUpdate: (updates: Partial<Article>) => void;
  onNext: () => void;
}

const CARD_COLORS = [
  "border-violet-200 hover:border-violet-400 bg-violet-50/40",
  "border-amber-200 hover:border-amber-400 bg-amber-50/40",
  "border-blue-200 hover:border-blue-400 bg-blue-50/40",
  "border-emerald-200 hover:border-emerald-400 bg-emerald-50/40",
  "border-pink-200 hover:border-pink-400 bg-pink-50/40",
  "border-orange-200 hover:border-orange-400 bg-orange-50/40",
  "border-teal-200 hover:border-teal-400 bg-teal-50/40",
  "border-slate-200 hover:border-slate-400 bg-slate-50",
];

const DEFAULT_ICONS = ["◎", "★", "⇄", "◈", "✉", "◉", "⬡", "▶"];

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Không tìm thấy mảng JSON trong phản hồi AI.");
  return JSON.parse(body.slice(start, end + 1));
}

function normalizeSuggestions(parsed: unknown): ContentTypeSuggestion[] {
  if (!Array.isArray(parsed)) throw new Error("Phản hồi AI không phải mảng.");
  return parsed
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const label = String(obj.label ?? obj.name ?? "").trim();
      const description = String(obj.description ?? obj.summary ?? "").trim();
      if (!label || !description) return null;
      const arr = (key: string): string[] =>
        Array.isArray(obj[key]) ? (obj[key] as unknown[]).map(String).filter(Boolean) : [];
      return {
        id: `sg-${idx}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
        label,
        description,
        audience: obj.audience ? String(obj.audience) : undefined,
        format: obj.format ? String(obj.format) : undefined,
        matchedDocs: arr("matchedDocs"),
        ruleRefs: arr("ruleRefs"),
        icon: obj.icon ? String(obj.icon) : undefined,
      } as ContentTypeSuggestion;
    })
    .filter((v): v is ContentTypeSuggestion => v !== null);
}

export default function Step1ContentType({
  article,
  config,
  files,
  model,
  railwayUrl,
  onUpdate,
  onNext,
}: Props) {
  const selected = article.contentType;
  const suggestions = article.contentTypeSuggestions ?? [];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const autoRequestedRef = useRef(false);

  const bundle = useMemo(() => collectStepDocs(1, config, files), [config, files]);
  const contextBlock = useMemo(() => buildDocContextBlock(bundle), [bundle]);

  const fetchSuggestions = async () => {
    if (!bundle.totalCount) {
      setError("Chưa có tài liệu nào được phân quyền cho Step 1. Vui lòng mở Cấu hình → Step Setup để gán tài liệu.");
      return;
    }
    if (!bundle.actionPlan.length && !bundle.knowledgeBase.length) {
      setError("Cần ít nhất 1 tài liệu Knowledge Base hoặc Action Plan để AI đề xuất loại nội dung.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const systemPrompt = buildRoleSystemPrompt(
        [
          "Đề xuất 4-8 loại nội dung (Content Type) mà người viết có thể sản xuất từ tài liệu được cấp.",
          "- Ưu tiên phân loại theo Action Plan (nếu có).",
          "- Dùng Knowledge Base để mô tả cụ thể chủ đề/độ sâu có thể khai thác.",
          "- Bắt buộc kiểm chứng mọi đề xuất với Rules & Guidelines; ghi rõ rule nào áp dụng ở trường ruleRefs.",
          "- Không đề xuất loại nội dung mà tài liệu không hỗ trợ.",
          "",
          "Trả về DUY NHẤT một mảng JSON hợp lệ, không kèm markdown fences hay text giải thích.",
          "Mỗi phần tử schema:",
          `{ "label": string, "description": string (2-3 câu: định dạng, mục đích, giá trị), "audience": string, "format": string (VD "Bài blog 1200 từ"), "matchedDocs": string[] (tên tài liệu KB/Action đã dùng), "ruleRefs": string[] (tên rule/guideline áp dụng), "icon": string (1 emoji/glyph) }`,
        ].join("\n"),
      );

      const prompt = [
        `TÀI LIỆU ĐƯỢC PHÂN QUYỀN ĐỌC Ở STEP 1 (${describeBundle(bundle)}):`,
        contextBlock,
        "",
        "Yêu cầu: Đề xuất các loại nội dung phù hợp có thể sản xuất từ những tài liệu trên.",
        "Chỉ trả về JSON array — không markdown, không giải thích, không text thừa.",
      ].join("\n");

      const res = await callAI({ model, railwayUrl, prompt, systemPrompt });
      const parsed = extractJson(res.content);
      const normalized = normalizeSuggestions(parsed);
      if (!normalized.length) throw new Error("AI không trả về đề xuất hợp lệ.");
      onUpdate({ contentTypeSuggestions: normalized });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Không lấy được đề xuất từ AI: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  // First-time scan only — cache in article.contentTypeSuggestions.
  // Explicit user click on "Đề xuất lại" is the only way to re-scan afterwards.
  useEffect(() => {
    if (autoRequestedRef.current) return;
    if (!bundle.totalCount) return;
    if (suggestions.length > 0) return;
    autoRequestedRef.current = true;
    fetchSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.totalCount, suggestions.length]);

  const handleSelect = (label: string) => onUpdate({ contentType: label });

  const handleUseCustom = () => {
    const trimmed = customLabel.trim();
    if (!trimmed) return;
    onUpdate({ contentType: trimmed });
    setCustomLabel("");
  };

  const selectedSuggestion = suggestions.find(s => s.label === selected);

  return (
    <div className="h-full flex flex-col gap-4 animate-fade-in-up">
      <div className="bg-[#ebedf3] rounded-3xl p-1.5 shadow-sm border border-slate-200/60 flex-1 flex flex-col min-h-0">
        <div className="bg-white rounded-2xl p-6 flex-1 overflow-y-auto shadow-sm">
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-800 mb-1">Step 1: Content Type Selection</h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  AI phân tích tài liệu theo 3 vai trò — <b>KB</b> (nền tảng), <b>Action</b> (phân loại), <b>Rules</b> (bắt buộc) — rồi đề xuất loại nội dung phù hợp kèm mô tả chi tiết.
                </p>
              </div>
              <button
                onClick={fetchSuggestions}
                disabled={loading || !bundle.totalCount}
                className="shrink-0 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all whitespace-nowrap"
              >
                {loading ? "Đang phân tích..." : suggestions.length ? "↻ Đề xuất lại" : "✨ Lấy đề xuất từ AI"}
              </button>
            </div>

            {/* Doc context summary — grouped by role */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tài liệu AI được đọc ở Step 1</span>
                <span className="text-[10px] font-mono text-slate-500">{describeBundle(bundle)} · Model: {model.name}</span>
              </div>

              {bundle.totalCount ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <RoleColumn title="Knowledge Base" tone="indigo" hint="Nền tảng" docs={bundle.knowledgeBase} />
                  <RoleColumn title="Action Plan" tone="emerald" hint="Phân loại" docs={bundle.actionPlan} />
                  <RoleColumn title="Rules & Guidelines" tone="amber" hint="Bắt buộc" docs={bundle.rules} />
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  Chưa có tài liệu nào được phân quyền cho Step 1. Mở <span className="font-semibold">Cấu hình → Step Setup</span> để gán tài liệu.
                </p>
              )}
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-700">{error}</div>
            )}

            {loading && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="border-2 border-slate-100 rounded-2xl p-4 space-y-2">
                    <div className="ai-loading h-4 w-3/5" />
                    <div className="ai-loading h-3 w-full" />
                    <div className="ai-loading h-3 w-4/5" />
                  </div>
                ))}
              </div>
            )}

            {!loading && suggestions.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {suggestions.map((s, i) => {
                  const isSelected = selected === s.label;
                  return (
                    <button
                      key={s.id}
                      onClick={() => handleSelect(s.label)}
                      className={`text-left p-4 rounded-2xl border-2 transition-all space-y-2 ${CARD_COLORS[i % CARD_COLORS.length]} ${
                        isSelected ? "ring-2 ring-slate-900 ring-offset-1 border-transparent shadow-md" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="text-xl">{s.icon || DEFAULT_ICONS[i % DEFAULT_ICONS.length]}</div>
                        {isSelected && (
                          <div className="flex items-center space-x-1 text-[10px] font-bold text-slate-800">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
                            </svg>
                            <span>Đã chọn</span>
                          </div>
                        )}
                      </div>
                      <div className="text-sm font-bold text-slate-800 leading-tight">{s.label}</div>
                      <div className="text-[11px] text-slate-600 leading-relaxed">{s.description}</div>
                      {(s.audience || s.format) && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {s.format && (
                            <span className="text-[10px] font-semibold text-slate-700 bg-white/70 border border-slate-200 rounded-full px-2 py-0.5">
                              {s.format}
                            </span>
                          )}
                          {s.audience && (
                            <span className="text-[10px] font-semibold text-slate-700 bg-white/70 border border-slate-200 rounded-full px-2 py-0.5">
                              👥 {s.audience}
                            </span>
                          )}
                        </div>
                      )}
                      {s.matchedDocs && s.matchedDocs.length > 0 && (
                        <div className="text-[10px] text-indigo-700 pt-1">
                          <span className="font-bold">KB/Action:</span> {s.matchedDocs.join(", ")}
                        </div>
                      )}
                      {s.ruleRefs && s.ruleRefs.length > 0 && (
                        <div className="text-[10px] text-amber-700">
                          <span className="font-bold">Rules áp dụng:</span> {s.ruleRefs.join(", ")}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {!loading && suggestions.length === 0 && !error && bundle.totalCount > 0 && (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
                Nhấn <span className="font-semibold">"Lấy đề xuất từ AI"</span> để AI phân tích tài liệu và gợi ý loại nội dung.
              </div>
            )}

            {/* Custom content type */}
            <div className="border border-slate-200 rounded-2xl p-4 space-y-2">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Hoặc nhập loại nội dung tùy chỉnh</div>
              <div className="flex gap-2">
                <input
                  value={customLabel}
                  onChange={e => setCustomLabel(e.target.value)}
                  placeholder="Ví dụ: Bài phân tích chuyên sâu, Ebook hướng dẫn..."
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-slate-800 transition-all placeholder:text-slate-400"
                />
                <button
                  onClick={handleUseCustom}
                  disabled={!customLabel.trim()}
                  className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all"
                >
                  Dùng
                </button>
              </div>
            </div>

            {selected && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 animate-fade-in-up">
                <div className="flex items-center space-x-2 mb-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Loại đã chọn</span>
                </div>
                <p className="text-sm font-bold text-slate-800">{selected}</p>
                {selectedSuggestion?.description && (
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">{selectedSuggestion.description}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end shrink-0">
        <button
          onClick={onNext}
          disabled={!selected}
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs py-2.5 px-6 rounded-2xl shadow-sm transition-all flex items-center space-x-2"
        >
          <span>Tiếp tục → Core Idea & Angle</span>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const TONE_STYLE: Record<string, { text: string; bg: string; border: string }> = {
  indigo:  { text: "text-indigo-700",  bg: "bg-indigo-50/70",  border: "border-indigo-200" },
  emerald: { text: "text-emerald-700", bg: "bg-emerald-50/70", border: "border-emerald-200" },
  amber:   { text: "text-amber-700",   bg: "bg-amber-50/70",   border: "border-amber-200" },
};

function RoleColumn({ title, tone, hint, docs }: { title: string; tone: string; hint: string; docs: { name: string; meta?: string }[] }) {
  const style = TONE_STYLE[tone];
  return (
    <div className={`${style.bg} border ${style.border} rounded-xl p-2.5`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-[10px] font-bold ${style.text} uppercase tracking-wider`}>{title}</span>
        <span className="text-[9px] font-mono text-slate-500">{hint}</span>
      </div>
      {docs.length === 0 ? (
        <div className="text-[10px] text-slate-400 italic">Chưa cấp tài liệu</div>
      ) : (
        <ul className="space-y-0.5 max-h-24 overflow-y-auto">
          {docs.map((d, i) => (
            <li key={i} className="text-[10px] text-slate-700 leading-relaxed">
              • {d.name}
              {d.meta && <span className="text-slate-400 ml-1">({d.meta})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
