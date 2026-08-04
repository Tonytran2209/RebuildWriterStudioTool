import { useState, useMemo, useEffect, useRef } from "react";
import type {
  Article,
  AIModel,
  AppConfig,
  DocumentFile,
  ActionDataSource,
} from "../../types";
import { callAI } from "../../lib/aiService";

interface ContentTypeSuggestion {
  id: string;
  label: string;
  description: string;
  audience?: string;
  format?: string;
  matchedDocs?: string[];
  icon?: string;
}

interface Props {
  article: Article;
  config: AppConfig;
  files: DocumentFile[];
  model: AIModel;
  railwayUrl: string;
  onUpdate: (updates: Partial<Article>) => void;
  onNext: () => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  kb: "Knowledge Base",
  action: "Action Plan",
  rules: "Rules & Guidelines",
};

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
      const matched = Array.isArray(obj.matchedDocs)
        ? (obj.matchedDocs as unknown[]).map(String).filter(Boolean)
        : [];
      return {
        id: `sg-${idx}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
        label,
        description,
        audience: obj.audience ? String(obj.audience) : undefined,
        format: obj.format ? String(obj.format) : undefined,
        matchedDocs: matched,
        icon: obj.icon ? String(obj.icon) : undefined,
      } as ContentTypeSuggestion;
    })
    .filter((v): v is ContentTypeSuggestion => v !== null);
}

function buildDocContext(
  files: DocumentFile[],
  actionSources: ActionDataSource[],
  fileAccess: { kb: string[]; action: string[]; rules: string[] },
): { text: string; count: number } {
  const lines: string[] = [];

  (["kb", "action", "rules"] as const).forEach(cat => {
    const ids = fileAccess[cat] ?? [];
    if (!ids.length) return;
    lines.push(`\n[${CATEGORY_LABEL[cat]}]`);
    ids.forEach(id => {
      if (cat === "action") {
        const src = actionSources.find(s => s.id === id);
        if (src) {
          const meta = [
            `nguồn: ${src.sourceType}`,
            src.rowCount ? `${src.rowCount} dòng` : "",
            src.columns?.length ? `cột: ${src.columns.join(", ")}` : "",
          ].filter(Boolean).join(" · ");
          lines.push(`- ${src.name}${meta ? ` (${meta})` : ""}${src.preview ? `\n  Preview: ${src.preview.slice(0, 240)}` : ""}`);
          return;
        }
      }
      const file = files.find(f => f.id === id);
      if (file) lines.push(`- ${file.name} (${file.fileType.toUpperCase()}, ${file.size})`);
    });
  });

  return { text: lines.join("\n"), count: lines.filter(l => l.startsWith("- ")).length };
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
  const [suggestions, setSuggestions] = useState<ContentTypeSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const autoRequestedRef = useRef(false);

  const fileAccess = config.stepConfigs[1]?.fileAccess ?? { kb: [], action: [], rules: [] };
  const actionSources = config.actionSources ?? [];

  const docContext = useMemo(
    () => buildDocContext(files, actionSources, fileAccess),
    [files, actionSources, fileAccess],
  );

  const fetchSuggestions = async () => {
    if (!docContext.count) {
      setError("Chưa có tài liệu nào được phân quyền cho Step 1. Vui lòng mở Cấu hình → Step Setup để gán tài liệu.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const systemPrompt = [
        "Bạn là chiến lược gia nội dung. Dựa trên danh sách tài liệu người dùng cho phép đọc ở bước 1,",
        "hãy đề xuất 4-8 loại nội dung (Content Type) phù hợp nhất có thể sản xuất từ các tài liệu đó.",
        "Chỉ đề xuất những loại thực sự khớp với tài liệu — không bịa nội dung.",
        "Trả về DUY NHẤT một mảng JSON hợp lệ, không kèm text giải thích, mỗi phần tử có schema:",
        `{ "label": string, "description": string (2-3 câu mô tả rõ định dạng, mục đích và giá trị mang lại), "audience": string, "format": string (ví dụ "Bài blog dài 1200 từ", "Carousel 8 slide"), "matchedDocs": string[] (tên các tài liệu liên quan), "icon": string (1 ký tự emoji hoặc glyph) }`,
      ].join(" ");

      const prompt = [
        `Tài liệu được phân quyền đọc ở Step 1 (${docContext.count} mục):`,
        docContext.text,
        "",
        "Yêu cầu: Đề xuất các loại nội dung phù hợp có thể sản xuất từ những tài liệu trên.",
        "Mỗi đề xuất phải có mô tả đầy đủ: (1) loại nội dung là gì, (2) khai thác tài liệu nào, (3) phục vụ mục đích/độc giả nào.",
        "Chỉ trả về JSON array, không markdown, không giải thích.",
      ].join("\n");

      const res = await callAI({ model, railwayUrl, prompt, systemPrompt });
      const parsed = extractJson(res.content);
      const normalized = normalizeSuggestions(parsed);
      if (!normalized.length) throw new Error("AI không trả về đề xuất hợp lệ.");
      setSuggestions(normalized);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Không lấy được đề xuất từ AI: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoRequestedRef.current) return;
    if (!docContext.count) return;
    autoRequestedRef.current = true;
    fetchSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docContext.count]);

  const handleSelect = (label: string) => {
    onUpdate({ contentType: label });
  };

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
                  AI phân tích các tài liệu được phân quyền đọc ở Step 1 và đề xuất loại nội dung phù hợp nhất kèm mô tả chi tiết.
                </p>
              </div>
              <button
                onClick={fetchSuggestions}
                disabled={loading || !docContext.count}
                className="shrink-0 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all whitespace-nowrap"
              >
                {loading ? "Đang phân tích..." : suggestions.length ? "↻ Đề xuất lại" : "✨ Lấy đề xuất từ AI"}
              </button>
            </div>

            {/* Doc context summary */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tài liệu AI được đọc ở Step 1</span>
                <span className="text-[10px] font-mono text-slate-500">
                  {docContext.count} mục · Model: {model.name}
                </span>
              </div>
              {docContext.count ? (
                <pre className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap font-sans mt-1 max-h-32 overflow-y-auto">
                  {docContext.text.trim()}
                </pre>
              ) : (
                <p className="text-xs text-slate-500 mt-1">
                  Chưa có tài liệu nào được phân quyền cho Step 1. Mở <span className="font-semibold">Cấu hình → Step Setup</span> để gán tài liệu.
                </p>
              )}
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-700">
                {error}
              </div>
            )}

            {loading && (
              <div className="grid grid-cols-2 gap-3">
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
                        <div className="text-[10px] text-slate-500 pt-1">
                          <span className="font-bold">Dựa trên:</span> {s.matchedDocs.join(", ")}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {!loading && suggestions.length === 0 && !error && docContext.count > 0 && (
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
