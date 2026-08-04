import { useState, useMemo, useEffect, useRef } from "react";
import type { Article, AIModel, AppConfig, DocumentFile } from "../../types";
import { callAI } from "../../lib/aiService";
import {
  collectStepDocs,
  buildDocContextBlock,
  buildRoleSystemPrompt,
  describeBundle,
} from "../../lib/docContext";

interface CoreIdeaSuggestion {
  id: string;
  title: string;
  angleLabel: string;
  angleDescription: string;
  mainArgument: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  targetAudience: string;
  recommendedTone: string;
  recommendedWordCount: number;
  rating: {
    overall: number;
    seoPotential: number;
    audienceFit: number;
    docSupport: number;
    uniqueness: number;
  };
  ratingRationale: string;
  matchedDocs: string[];
  ruleRefs: string[];
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

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Không tìm thấy mảng JSON trong phản hồi AI.");
  return JSON.parse(body.slice(start, end + 1));
}

function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

function toStringArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean) : [];
}

function normalizeIdeas(parsed: unknown): CoreIdeaSuggestion[] {
  if (!Array.isArray(parsed)) throw new Error("Phản hồi AI không phải mảng.");
  return parsed
    .map((raw, idx) => {
      if (!raw || typeof raw !== "object") return null;
      const obj = raw as Record<string, unknown>;
      const title = String(obj.title ?? obj.name ?? "").trim();
      const mainArgument = String(obj.mainArgument ?? obj.thesis ?? "").trim();
      if (!title || !mainArgument) return null;
      const ratingObj = (obj.rating && typeof obj.rating === "object" ? obj.rating : {}) as Record<string, unknown>;
      const seo = (obj.seoKeywords && typeof obj.seoKeywords === "object" ? obj.seoKeywords : {}) as Record<string, unknown>;
      return {
        id: `idea-${idx}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
        title,
        angleLabel: String(obj.angleLabel ?? obj.angle ?? "").trim(),
        angleDescription: String(obj.angleDescription ?? "").trim(),
        mainArgument,
        primaryKeyword: String(seo.primary ?? obj.primaryKeyword ?? "").trim(),
        secondaryKeywords: toStringArr(seo.secondary ?? obj.secondaryKeywords),
        targetAudience: String(obj.targetAudience ?? "").trim(),
        recommendedTone: String(obj.recommendedTone ?? obj.tone ?? "").trim(),
        recommendedWordCount: toNumber(obj.recommendedWordCount ?? obj.wordCount, 1500),
        rating: {
          overall: toNumber(ratingObj.overall, 0),
          seoPotential: toNumber(ratingObj.seoPotential, 0),
          audienceFit: toNumber(ratingObj.audienceFit, 0),
          docSupport: toNumber(ratingObj.docSupport, 0),
          uniqueness: toNumber(ratingObj.uniqueness, 0),
        },
        ratingRationale: String(obj.ratingRationale ?? "").trim(),
        matchedDocs: toStringArr(obj.matchedDocs),
        ruleRefs: toStringArr(obj.ruleRefs),
      } as CoreIdeaSuggestion;
    })
    .filter((v): v is CoreIdeaSuggestion => v !== null);
}

function ratingColor(score: number): string {
  if (score >= 8.5) return "text-emerald-600";
  if (score >= 7) return "text-blue-600";
  if (score >= 5.5) return "text-amber-600";
  return "text-rose-600";
}

function ratingBar(score: number): string {
  if (score >= 8.5) return "bg-emerald-500";
  if (score >= 7) return "bg-blue-500";
  if (score >= 5.5) return "bg-amber-400";
  return "bg-rose-400";
}

export default function Step2CoreIdea({
  article,
  config,
  files,
  model,
  railwayUrl,
  onUpdate,
  onNext,
  onPrev,
}: Props) {
  const [ideas, setIdeas] = useState<CoreIdeaSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const autoRequestedRef = useRef<string | null>(null);

  const bundle = useMemo(() => collectStepDocs(2, config, files), [config, files]);
  const contextBlock = useMemo(() => buildDocContextBlock(bundle), [bundle]);

  const fetchIdeas = async () => {
    if (!article.contentType) {
      setError("Chưa chọn loại nội dung ở Step 1. Vui lòng quay lại Step 1 trước.");
      return;
    }
    if (!bundle.totalCount) {
      setError("Chưa có tài liệu nào được phân quyền cho Step 2. Vui lòng mở Cấu hình → Step Setup.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const systemPrompt = buildRoleSystemPrompt(
        [
          `Đề xuất ÍT NHẤT 3 core ideas / góc độ cho bài viết dạng "${article.contentType}".`,
          "- Mọi ý tưởng phải suy ra từ Knowledge Base (nội dung), Action Plan (định hướng), Rules (chuẩn output).",
          "- Không dùng dữ liệu ngoài tài liệu được cấp. Nếu không đủ, tạo ít ý tưởng hơn.",
          "- Mỗi idea phải có tiêu đề rõ ràng, main argument (luận điểm cốt lõi), Top SEO keywords, và rating chi tiết.",
          "- Rating cho theo thang 0-10 với 5 tiêu chí (overall, seoPotential, audienceFit, docSupport, uniqueness). Ghi rõ căn cứ chấm điểm.",
          "",
          "Trả về DUY NHẤT một mảng JSON hợp lệ, không kèm markdown fences hay text giải thích.",
          "Schema mỗi phần tử:",
          `{
  "title": string (tiêu đề bài viết đề xuất, sẵn sàng dùng),
  "angleLabel": string (tên góc tiếp cận ngắn gọn, ví dụ "So sánh benchmark", "Hướng dẫn thực chiến"),
  "angleDescription": string (1-2 câu giải thích góc tiếp cận),
  "mainArgument": string (2-3 câu nêu luận điểm cốt lõi bài sẽ chứng minh),
  "seoKeywords": { "primary": string, "secondary": string[] (5-8 từ khóa phụ) },
  "targetAudience": string (mô tả cụ thể độc giả mục tiêu),
  "recommendedTone": string (ví dụ "Chuyên nghiệp", "Thân thiện" — phải khớp Rules),
  "recommendedWordCount": number (600-3000),
  "rating": {
    "overall": number (0-10),
    "seoPotential": number (0-10),
    "audienceFit": number (0-10),
    "docSupport": number (0-10, mức độ tài liệu hỗ trợ),
    "uniqueness": number (0-10, độ độc đáo so với thị trường)
  },
  "ratingRationale": string (1-2 câu giải thích điểm),
  "matchedDocs": string[] (tên tài liệu KB/Action đã dùng),
  "ruleRefs": string[] (tên rule/guideline đã áp dụng)
}`,
        ].join("\n"),
      );

      const userPrompt = [
        `TÀI LIỆU STEP 2 (${describeBundle(bundle)}):`,
        contextBlock,
        "",
        "LOẠI NỘI DUNG ĐÃ CHỌN Ở STEP 1:",
        `- ${article.contentType}`,
        "",
        "Yêu cầu: Đề xuất ít nhất 3 core ideas theo schema.",
        "Chỉ trả về JSON array — không markdown, không giải thích, không text thừa.",
      ].join("\n");

      const res = await callAI({ model, railwayUrl, prompt: userPrompt, systemPrompt });
      const parsed = extractJson(res.content);
      const normalized = normalizeIdeas(parsed);
      if (normalized.length < 3) throw new Error(`AI chỉ trả về ${normalized.length} idea hợp lệ (yêu cầu ≥3).`);
      setIdeas(normalized);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Không lấy được đề xuất từ AI: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch when entering step (once per contentType + doc bundle combination)
  useEffect(() => {
    const key = `${article.contentType || ""}::${bundle.totalCount}`;
    if (autoRequestedRef.current === key) return;
    if (!article.contentType || !bundle.totalCount) return;
    autoRequestedRef.current = key;
    fetchIdeas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.contentType, bundle.totalCount]);

  const handleSelect = (idea: CoreIdeaSuggestion) => {
    setSelectedId(idea.id);
    onUpdate({
      topic: idea.title,
      angle: idea.angleLabel,
      keywords: [idea.primaryKeyword, ...idea.secondaryKeywords].filter(Boolean).join(", "),
      targetAudience: idea.targetAudience,
      tone: idea.recommendedTone,
      wordCount: idea.recommendedWordCount,
    });
  };

  return (
    <div className="h-full flex flex-col gap-4 animate-fade-in-up">
      <div className="bg-[#ebedf3] rounded-3xl p-1.5 shadow-sm border border-slate-200/60 flex-1 flex flex-col min-h-0">
        <div className="bg-white rounded-2xl p-6 flex-1 overflow-y-auto shadow-sm">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-800 mb-1">Step 2: Core Idea & Angle</h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  AI đề xuất ≥3 core ideas cho loại nội dung <b>"{article.contentType || "(chưa chọn)"}"</b> dựa trên tài liệu Step 2 và Rules bắt buộc. Bạn chỉ cần chọn 1.
                </p>
              </div>
              <button
                onClick={fetchIdeas}
                disabled={loading || !article.contentType || !bundle.totalCount}
                className="shrink-0 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all whitespace-nowrap"
              >
                {loading ? "Đang phân tích..." : ideas.length ? "↻ Đề xuất lại" : "✨ Lấy đề xuất từ AI"}
              </button>
            </div>

            {/* Doc context summary */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 flex items-center justify-between text-[11px] text-slate-600">
              <span>Tài liệu AI đọc ở Step 2: <b>{describeBundle(bundle)}</b></span>
              <span className="font-mono text-slate-500">Model: {model.name}</span>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-700">{error}</div>
            )}

            {loading && (
              <div className="space-y-3">
                {[0, 1, 2].map(i => (
                  <div key={i} className="border-2 border-slate-100 rounded-2xl p-5 space-y-3">
                    <div className="ai-loading h-5 w-3/4" />
                    <div className="ai-loading h-3 w-full" />
                    <div className="ai-loading h-3 w-5/6" />
                    <div className="flex gap-2 pt-2">
                      <div className="ai-loading h-6 w-20" />
                      <div className="ai-loading h-6 w-24" />
                      <div className="ai-loading h-6 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && ideas.length > 0 && (
              <div className="space-y-3">
                {ideas.map(idea => {
                  const isSelected = selectedId === idea.id;
                  return (
                    <button
                      key={idea.id}
                      onClick={() => handleSelect(idea)}
                      className={`w-full text-left p-5 rounded-2xl border-2 transition-all space-y-4 ${
                        isSelected
                          ? "border-slate-900 bg-slate-900/[0.02] ring-2 ring-slate-900 ring-offset-2 shadow-lg"
                          : "border-slate-200 bg-white hover:border-slate-400 hover:shadow-md"
                      }`}
                    >
                      {/* Header: title + overall score */}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-1.5">
                          {idea.angleLabel && (
                            <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                              {idea.angleLabel}
                            </div>
                          )}
                          <h3 className="text-base font-bold text-slate-800 leading-snug">{idea.title}</h3>
                          {idea.angleDescription && (
                            <p className="text-[11px] text-slate-500 italic">{idea.angleDescription}</p>
                          )}
                        </div>
                        <div className="shrink-0 text-center bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 min-w-[80px]">
                          <div className={`text-2xl font-bold font-mono ${ratingColor(idea.rating.overall)}`}>
                            {idea.rating.overall.toFixed(1)}
                          </div>
                          <div className="text-[9px] font-bold text-slate-500 uppercase">Rating</div>
                        </div>
                      </div>

                      {/* Main argument */}
                      <div className="bg-slate-50 border-l-4 border-slate-800 rounded-r-xl px-3 py-2.5">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Main Argument</div>
                        <p className="text-xs text-slate-700 leading-relaxed">{idea.mainArgument}</p>
                      </div>

                      {/* Rating breakdown */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {[
                          { label: "SEO", val: idea.rating.seoPotential },
                          { label: "Audience", val: idea.rating.audienceFit },
                          { label: "Doc Support", val: idea.rating.docSupport },
                          { label: "Uniqueness", val: idea.rating.uniqueness },
                        ].map(r => (
                          <div key={r.label} className="space-y-1">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-slate-500 font-medium">{r.label}</span>
                              <span className={`font-mono font-bold ${ratingColor(r.val)}`}>{r.val.toFixed(1)}</span>
                            </div>
                            <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${ratingBar(r.val)}`}
                                style={{ width: `${Math.min(r.val * 10, 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {idea.ratingRationale && (
                        <p className="text-[10px] text-slate-500 italic leading-relaxed">
                          <span className="font-bold not-italic">Căn cứ chấm điểm:</span> {idea.ratingRationale}
                        </p>
                      )}

                      {/* SEO Keywords */}
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Top SEO Keywords</div>
                        <div className="flex flex-wrap gap-1.5">
                          {idea.primaryKeyword && (
                            <span className="text-[11px] font-bold bg-indigo-600 text-white px-2.5 py-1 rounded-full">
                              ★ {idea.primaryKeyword}
                            </span>
                          )}
                          {idea.secondaryKeywords.map((kw, i) => (
                            <span key={i} className="text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-1 rounded-full">
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Meta chips */}
                      <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
                        {idea.targetAudience && (
                          <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                            👥 {idea.targetAudience}
                          </span>
                        )}
                        {idea.recommendedTone && (
                          <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                            🎙 Tone: {idea.recommendedTone}
                          </span>
                        )}
                        {idea.recommendedWordCount > 0 && (
                          <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                            📏 ~{idea.recommendedWordCount.toLocaleString()} từ
                          </span>
                        )}
                      </div>

                      {/* Source refs */}
                      {(idea.matchedDocs.length > 0 || idea.ruleRefs.length > 0) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px]">
                          {idea.matchedDocs.length > 0 && (
                            <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg p-2">
                              <span className="font-bold text-indigo-700">KB/Action:</span>{" "}
                              <span className="text-indigo-800">{idea.matchedDocs.join(", ")}</span>
                            </div>
                          )}
                          {idea.ruleRefs.length > 0 && (
                            <div className="bg-amber-50/60 border border-amber-100 rounded-lg p-2">
                              <span className="font-bold text-amber-700">Rules:</span>{" "}
                              <span className="text-amber-800">{idea.ruleRefs.join(", ")}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {isSelected && (
                        <div className="flex items-center space-x-1 text-[11px] font-bold text-slate-900 pt-1">
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
                          </svg>
                          <span>Đã chọn — sẵn sàng sang Step 3</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {!loading && ideas.length === 0 && !error && article.contentType && bundle.totalCount > 0 && (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
                Nhấn <span className="font-semibold">"Lấy đề xuất từ AI"</span> để AI phân tích tài liệu và gợi ý core ideas.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-between shrink-0">
        <button
          onClick={onPrev}
          className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs py-2.5 px-5 rounded-2xl shadow-sm transition-all"
        >
          ← Quay lại
        </button>
        <button
          onClick={onNext}
          disabled={!selectedId}
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs py-2.5 px-6 rounded-2xl shadow-sm transition-all flex items-center space-x-2"
        >
          <span>Tiếp tục → Draft Outline</span>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
