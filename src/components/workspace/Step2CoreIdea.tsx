import { useState, useMemo, useEffect, useRef } from "react";
import type {
  Article,
  AIModel,
  AppConfig,
  DocumentFile,
  CoreIdeaSuggestion,
  ContentTypeSuggestion,
  EvidenceRef,
} from "../../types";
import { callAI } from "../../lib/aiService";
import {
  collectStepDocs,
  buildRoleSystemPrompt,
  buildActionPlanFingerprint,
  describeBundle,
} from "../../lib/docContext";
import { hasResearchEvidence, hasRulesEvidence, verifiedRuleRefs, verifyEvidence } from "../../lib/evidenceValidation";

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
  const json = body.slice(start, end + 1);
  try {
    return JSON.parse(json);
  } catch (firstError) {
    // Repair common syntax slips without changing evidence text.
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

function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

function toStringArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  return [];
}

function snapshotEvidence(
  snapshot: ContentTypeSuggestion | null | undefined,
  bundle: ReturnType<typeof collectStepDocs>,
): EvidenceRef[] {
  if (!snapshot) return [];
  const candidates: EvidenceRef[] = [];
  const researchSource = snapshot.matchedDocs?.[0];
  const kbSource = snapshot.kbRefs?.[0];
  const ruleSource = snapshot.ruleRefs?.[0];
  if (researchSource && snapshot.actionPlanEvidence) {
    candidates.push({ source: researchSource, role: "action", quote: snapshot.actionPlanEvidence, note: "Snapshot Step 1 đã kiểm chứng" });
  }
  if (kbSource && snapshot.kbEvidence) {
    candidates.push({ source: kbSource, role: "kb", quote: snapshot.kbEvidence, note: "Snapshot Step 1 đã kiểm chứng" });
  }
  if (ruleSource && snapshot.ruleEvidence) {
    candidates.push({ source: ruleSource, role: "rules", quote: snapshot.ruleEvidence, note: "Snapshot Step 1 đã kiểm chứng" });
  }
  return verifyEvidence(candidates, bundle);
}

function normalizeIdeas(
  parsed: unknown,
  bundle: ReturnType<typeof collectStepDocs>,
  trustedSnapshotEvidence: EvidenceRef[] = [],
): CoreIdeaSuggestion[] {
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
      const evidence = [
        ...verifyEvidence(obj.evidence, bundle),
        ...trustedSnapshotEvidence,
      ].filter((item, index, all) => all.findIndex(candidate =>
        candidate.role === item.role && candidate.source === item.source && candidate.quote === item.quote
      ) === index);
      const ruleRefs = [...new Set([
        ...verifiedRuleRefs(obj.ruleRefs, bundle),
        ...evidence.filter(item => item.role === "rules").map(item => item.source),
      ])];
      if (!hasResearchEvidence(evidence) || !hasRulesEvidence(evidence)) return null;
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
        matchedDocs: [...new Set(evidence.filter(item => item.role === "kb" || item.role === "action").map(item => item.source))],
        ruleRefs,
        evidence,
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

function ratingTag(score: number): { label: string; className: string } {
  if (score >= 9)   return { label: "Đề xuất mạnh", className: "bg-emerald-600 text-white" };
  if (score >= 8)   return { label: "Đề xuất",      className: "bg-emerald-100 text-emerald-800 border border-emerald-200" };
  if (score >= 7)   return { label: "Cân nhắc",     className: "bg-blue-100 text-blue-800 border border-blue-200" };
  if (score >= 5.5) return { label: "Tùy chọn",     className: "bg-amber-100 text-amber-800 border border-amber-200" };
  return { label: "Yếu", className: "bg-rose-100 text-rose-800 border border-rose-200" };
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
  const storedIdeas = article.coreIdeaSuggestions ?? [];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(article.selectedCoreIdeaId ?? null);
  const autoRequestedRef = useRef<string | null>(null);

  const bundle = useMemo(() => collectStepDocs(2, config, files), [config, files]);
  const selectedSnapshot = useMemo(
    () => article.selectedContentTypeSnapshot
      ?? article.contentTypeSuggestions?.find(item => item.id === article.selectedContentTypeSuggestionId)
      ?? article.contentTypeSuggestions?.find(item => item.label === article.contentType)
      ?? null,
    [article.contentType, article.contentTypeSuggestions, article.selectedContentTypeSnapshot, article.selectedContentTypeSuggestionId],
  );
  const trustedSnapshotEvidence = useMemo(
    () => snapshotEvidence(selectedSnapshot, bundle),
    [bundle, selectedSnapshot],
  );
  const selectedSnapshotSignature = useMemo(
    () => selectedSnapshot ? JSON.stringify({
      id: selectedSnapshot.id,
      label: selectedSnapshot.label,
      typeGroup: selectedSnapshot.typeGroup,
      wave: selectedSnapshot.wave,
      timeframe: selectedSnapshot.timeframe,
      keywords: selectedSnapshot.keywords,
      matchedDocs: selectedSnapshot.matchedDocs,
      kbRefs: selectedSnapshot.kbRefs,
      ruleRefs: selectedSnapshot.ruleRefs,
      actionPlanEvidence: selectedSnapshot.actionPlanEvidence,
      kbEvidence: selectedSnapshot.kbEvidence,
      ruleEvidence: selectedSnapshot.ruleEvidence,
    }) : article.contentType ?? "",
    [article.contentType, selectedSnapshot],
  );
  const sourceFingerprint = useMemo(
    () => `${buildActionPlanFingerprint(bundle)}:${model.provider}:${model.id}:step2-evidence-json-v4:${selectedSnapshotSignature}`,
    [bundle, model.id, model.provider, selectedSnapshotSignature],
  );
  const scanIsStale = Boolean(storedIdeas.length) && article.coreIdeaSourceFingerprint !== sourceFingerprint;
  const ideas = scanIsStale ? [] : storedIdeas;

  const fetchIdeas = async () => {
    if (!article.contentType) {
      setError("Chưa chọn loại nội dung ở Step 1. Vui lòng quay lại Step 1 trước.");
      return;
    }
    if (!bundle.totalCount) {
      setError("Chưa có tài liệu nào được phân quyền cho Step 2. Vui lòng mở Cấu hình → Step Setup.");
      return;
    }
    if (!bundle.knowledgeBase.length && !bundle.actionPlan.length) {
      setError("Step 2 cần ít nhất một Knowledge Base hoặc Action Plan có nội dung thật.");
      return;
    }
    if (!bundle.rules.length) {
      setError("Step 2 chưa được cấp Rules & Guidelines để kiểm chứng Core Idea.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const systemPrompt = buildRoleSystemPrompt(
        [
          `Đề xuất ÍT NHẤT 3 core ideas / góc độ cho bài viết dạng "${article.contentType}".`,
          selectedSnapshot
            ? `- Dùng lựa chọn Step 1 đã khóa làm định hướng bắt buộc: ${selectedSnapshot.label}; Type ${selectedSnapshot.typeGroup ?? "không xác định"}; ${selectedSnapshot.wave ?? ""}; ${selectedSnapshot.timeframe ?? ""}; keywords: ${(selectedSnapshot.keywords ?? []).join(", ")}.`
            : "- Không có snapshot cấu trúc từ Step 1; chỉ dùng content type đã chọn.",
          "- Mọi ý tưởng phải suy ra từ Knowledge Base (nội dung), Action Plan (định hướng), Rules (chuẩn output).",
          "- Không dùng dữ liệu ngoài tài liệu được cấp. Nếu không đủ, tạo ít ý tưởng hơn.",
          "- Mỗi idea phải có tiêu đề rõ ràng, main argument (luận điểm cốt lõi), Top SEO keywords, và rating chi tiết.",
          "- Rating cho theo thang 0-10 với 5 tiêu chí (overall, seoPotential, audienceFit, docSupport, uniqueness). Ghi rõ căn cứ chấm điểm.",
          "- Mỗi idea phải có evidence gồm ít nhất 1 trích dẫn nguyên văn từ KB/Action và 1 trích dẫn nguyên văn từ Rules.",
          "- source phải đúng chính xác tên file được cấp; quote phải được chép nguyên văn, không diễn giải.",
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
  "ruleRefs": string[] (tên rule/guideline đã áp dụng),
  "evidence": [{ "source": string, "role": "kb" | "action" | "rules", "quote": string, "note": string }]
}`,
        ].join("\n"),
      );

      const userPrompt = [
        `TÀI LIỆU STEP 2 (${describeBundle(bundle)}):`,
        "Railway sẽ nạp trực tiếp nội dung các tài liệu đã được cấp quyền cho Step 2 từ Supabase.",
        "",
        "LOẠI NỘI DUNG ĐÃ CHỌN Ở STEP 1:",
        `- ${article.contentType}`,
        ...(selectedSnapshot ? [
          "",
          "SNAPSHOT STEP 1 ĐÃ LƯU TRÊN SUPABASE (nguồn lựa chọn cố định):",
          JSON.stringify(selectedSnapshot),
        ] : []),
        "",
        "Yêu cầu: Đề xuất ít nhất 3 core ideas theo schema.",
        "Chỉ trả về JSON array — không markdown, không giải thích, không text thừa.",
      ].join("\n");

      const requestIdeas = async (correction = "", bypassCache = false) => {
        let res = await callAI({
          model,
          railwayUrl,
          prompt: `${userPrompt}${correction}`,
          systemPrompt,
          maxTokens: 8000,
          temperature: 0.1,
          stepNumber: 2,
          bypassCache,
        });
        let parsed: unknown;
        try {
          parsed = extractJson(res.content);
        } catch {
          const repaired = await callAI({
            model,
            railwayUrl,
            prompt: [
              "Sửa nội dung dưới đây thành đúng một JSON array hợp lệ.",
              "Giữ nguyên toàn bộ giá trị, quote evidence và thứ tự; chỉ sửa dấu phẩy, ngoặc và escape chuỗi.",
              "Không thêm markdown hoặc giải thích.",
              "",
              res.content,
            ].join("\n"),
            systemPrompt: "Bạn là JSON formatter. Chỉ trả về JSON array parse được bằng JSON.parse.",
            maxTokens: 8000,
            temperature: 0,
            stepNumber: 2,
          });
          parsed = extractJson(repaired.content);
          res = repaired;
        }
        return { res, ideas: normalizeIdeas(parsed, bundle, trustedSnapshotEvidence) };
      };
      let result = await requestIdeas();
      if (!result.ideas.length) {
        const rejectedJson = result.res.content;
        result = await requestIdeas([
          "\n\nNHIỆM VỤ SỬA RESPONSE BỊ TỪ CHỐI:",
          "- Giữ các core idea hữu ích, nhưng đọc lại DOCUMENT trong context và thay evidence bằng quote nguyên văn có thật.",
          `- Tên nguồn KB hợp lệ: ${bundle.knowledgeBase.map(doc => JSON.stringify(doc.name)).join(", ") || "(không có)"}.`,
          `- Tên nguồn Action hợp lệ: ${bundle.actionPlan.map(doc => JSON.stringify(doc.name)).join(", ") || "(không có)"}.`,
          `- Tên nguồn Rules hợp lệ: ${bundle.rules.map(doc => JSON.stringify(doc.name)).join(", ")}.`,
          "- Mỗi idea bắt buộc có ít nhất 1 evidence role kb/action và 1 evidence role rules.",
          "- source phải chép đúng một tên trong danh sách trên; quote phải là một đoạn liên tục chép nguyên văn từ chính source đó.",
          "- Chỉ trả về JSON array hoàn chỉnh, không giải thích.",
          "",
          "RESPONSE BỊ TỪ CHỐI CẦN SỬA:",
          rejectedJson,
        ].join("\n"), true);
      }
      if (!result.ideas.length) {
        throw new Error(
          `AI chưa trả về core idea có evidence kiểm chứng được. Đã đối chiếu ${bundle.knowledgeBase.length + bundle.actionPlan.length} nguồn KB/Action và ${bundle.rules.length} nguồn Rules được cấp cho Step 2.`,
        );
      }
      onUpdate({
        coreIdeaSuggestions: result.ideas,
        selectedCoreIdeaId: null,
        coreIdeaSourceFingerprint: sourceFingerprint,
        coreIdeaScannedAt: result.res.servedAt ?? result.res.generatedAt ?? new Date().toISOString(),
      });
      setSelectedId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Không lấy được đề xuất từ AI: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  // First-time scan only — cache in article.coreIdeaSuggestions.
  // Re-scan only when user explicitly clicks "Đề xuất lại".
  useEffect(() => {
    const key = sourceFingerprint;
    if (autoRequestedRef.current === key) return;
    if (!article.contentType || !bundle.totalCount) return;
    if (ideas.length > 0 && !scanIsStale) {
      autoRequestedRef.current = key;
      return;
    }
    autoRequestedRef.current = key;
    fetchIdeas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.contentType, bundle.totalCount, ideas.length, scanIsStale, sourceFingerprint]);

  const handleSelect = (idea: CoreIdeaSuggestion) => {
    setSelectedId(idea.id);
    onUpdate({
      selectedCoreIdeaId: idea.id,
      title: idea.title,
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
      <div className="bg-white rounded-2xl border border-slate-200 flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="p-3.5 sm:p-5 md:p-6 flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-800 mb-1">Step 2 — Core Idea & Angle</h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  AI đề xuất ≥3 core ideas cho loại nội dung <b>"{article.contentType || "(chưa chọn)"}"</b>. Chọn 1 để sang Step 3.
                </p>
              </div>
              <button
                onClick={fetchIdeas}
                disabled={loading || !article.contentType || !bundle.totalCount}
                className="shrink-0 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all whitespace-nowrap"
              >
                {loading ? "Đang phân tích..." : ideas.length ? "Đề xuất lại" : "Lấy đề xuất"}
              </button>
            </div>

            {scanIsStale && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Nguồn KB / Action Plan / Rules hoặc model đã thay đổi — AI đang cần research lại Core Idea.
              </div>
            )}

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 text-xs text-rose-700">{error}</div>
            )}

            {loading && (
              <div className="space-y-3">
                {[0, 1, 2].map(i => (
                  <div key={i} className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="ai-loading h-3 w-20" />
                      <div className="ai-loading h-6 w-10" />
                    </div>
                    <div className="ai-loading h-5 w-full" />
                    <div className="ai-loading h-3 w-full" />
                    <div className="ai-loading h-3 w-5/6" />
                    <div className="flex gap-1 pt-1">
                      <div className="ai-loading h-5 w-16 rounded-full" />
                      <div className="ai-loading h-5 w-20 rounded-full" />
                      <div className="ai-loading h-5 w-14 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && ideas.length > 0 && (
              <div className="space-y-3">
                {ideas.map(idea => {
                  const isSelected = selectedId === idea.id;
                  const tag = ratingTag(idea.rating.overall);
                  return (
                    <button
                      key={idea.id}
                      onClick={() => handleSelect(idea)}
                      className={`w-full text-left rounded-xl border transition-all flex flex-col ${
                        isSelected
                          ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                          : "border-slate-200 bg-white hover:border-slate-400"
                      }`}
                    >
                      {/* Top: angle + tag + rating number */}
                      <div className="flex items-start justify-between gap-2 p-4 pb-3">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          {idea.angleLabel && (
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">
                              {idea.angleLabel}
                            </div>
                          )}
                          <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${tag.className}`}>
                            {tag.label}
                          </span>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={`text-2xl font-bold font-mono leading-none ${ratingColor(idea.rating.overall)}`}>
                            {idea.rating.overall.toFixed(1)}
                          </div>
                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">/10</div>
                        </div>
                      </div>

                      {/* Title */}
                      <div className="px-4 pb-3">
                        <h3 className="text-sm font-bold text-slate-800 leading-snug">{idea.title}</h3>
                      </div>

                      {/* Main argument */}
                      <div className="mx-4 mb-3 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Main Argument</div>
                        <p className="text-[11px] text-slate-700 leading-relaxed">{idea.mainArgument}</p>
                      </div>

                      {/* Top SEO Keywords */}
                      <div className="px-4 pb-3">
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Top SEO Keywords</div>
                        <div className="flex flex-wrap gap-1">
                          {idea.primaryKeyword && (
                            <span className="text-[10px] font-bold bg-indigo-600 text-white rounded-full px-2 py-0.5">
                              {idea.primaryKeyword}
                            </span>
                          )}
                          {idea.secondaryKeywords.map((kw, i) => (
                            <span key={i} className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2 py-0.5">
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Rating breakdown */}
                      <div className="mt-auto border-t border-slate-100 p-4 space-y-1.5">
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Rating breakdown</div>
                        {[
                          { label: "SEO Potential",  val: idea.rating.seoPotential },
                          { label: "Audience Fit",   val: idea.rating.audienceFit },
                          { label: "Doc Support",    val: idea.rating.docSupport },
                          { label: "Uniqueness",     val: idea.rating.uniqueness },
                        ].map(r => (
                          <div key={r.label} className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 font-medium w-24 shrink-0">{r.label}</span>
                            <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${ratingBar(r.val)}`}
                                style={{ width: `${Math.min(r.val * 10, 100)}%` }}
                              />
                            </div>
                            <span className={`text-[10px] font-mono font-bold w-6 text-right ${ratingColor(r.val)}`}>
                              {r.val.toFixed(1)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {isSelected && (
                        <div className="border-t border-slate-100 px-4 py-2 text-[10px] font-bold text-slate-900">
                          ✓ Đã chọn
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {!loading && ideas.length === 0 && !error && article.contentType && bundle.totalCount > 0 && (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
                Nhấn <span className="font-semibold">"Lấy đề xuất"</span> để AI phân tích tài liệu và gợi ý core ideas.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-between gap-2 shrink-0">
        <button
          onClick={onPrev}
          className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs py-2.5 px-3 sm:px-5 rounded-2xl shadow-sm transition-all"
        >
          Quay lại
        </button>
        <button
          onClick={onNext}
          disabled={!selectedId || scanIsStale}
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs py-2.5 px-3 sm:px-6 rounded-2xl shadow-sm transition-all"
        >
          Tiếp tục — Draft Outline
        </button>
      </div>
    </div>
  );
}
