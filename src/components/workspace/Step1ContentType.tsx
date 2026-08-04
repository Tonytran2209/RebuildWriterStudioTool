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
        keywords: arr("keywords"),
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
          `{ "label": string, "description": string (2-3 câu: định dạng, mục đích, giá trị), "keywords": string[] (3-6 từ khóa chắt lọc cốt lõi, sát với loại nội dung, có căn cứ trong tài liệu), "matchedDocs": string[] (tên tài liệu KB/Action đã dùng — dùng nội bộ, không hiển thị), "ruleRefs": string[] (tên rule/guideline áp dụng — dùng nội bộ) }`,
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
                <h2 className="text-base font-bold text-slate-800 mb-1">Step 1 — Content Type</h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  AI đề xuất loại nội dung phù hợp kèm mô tả và từ khóa chắt lọc. Chọn 1 để sang Step 2.
                </p>
              </div>
              <button
                onClick={fetchSuggestions}
                disabled={loading || !bundle.totalCount}
                className="shrink-0 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all whitespace-nowrap"
              >
                {loading ? "Đang phân tích..." : suggestions.length ? "Đề xuất lại" : "Lấy đề xuất"}
              </button>
            </div>

            {!bundle.totalCount && (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
                Chưa có tài liệu nào được phân quyền cho Step 1. Mở <span className="font-semibold">Cấu hình → Step Setup</span> để gán tài liệu.
              </div>
            )}

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
                {suggestions.map(s => {
                  const isSelected = selected === s.label;
                  return (
                    <button
                      key={s.id}
                      onClick={() => handleSelect(s.label)}
                      className={`text-left p-4 rounded-2xl border-2 transition-all space-y-2.5 ${
                        isSelected
                          ? "border-slate-900 bg-slate-900/[0.02] ring-2 ring-slate-900 ring-offset-1 shadow-md"
                          : "border-slate-200 bg-white hover:border-slate-400 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-bold text-slate-800 leading-tight">{s.label}</div>
                        {isSelected && (
                          <span className="shrink-0 text-[10px] font-bold text-slate-900">✓ Đã chọn</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-600 leading-relaxed">{s.description}</div>
                      {s.keywords && s.keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {s.keywords.map((kw, i) => (
                            <span
                              key={i}
                              className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2 py-0.5"
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {!loading && suggestions.length === 0 && !error && bundle.totalCount > 0 && (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
                Nhấn <span className="font-semibold">"Lấy đề xuất"</span> để AI phân tích tài liệu và gợi ý loại nội dung.
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
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs py-2.5 px-6 rounded-2xl shadow-sm transition-all"
        >
          Tiếp tục — Core Idea & Angle
        </button>
      </div>
    </div>
  );
}
