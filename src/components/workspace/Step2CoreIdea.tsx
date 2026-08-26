import { useState, useMemo, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import type {
  Article,
  AIModel,
  AppConfig,
  DocumentFile,
  CoreIdeaSuggestion,
  ContentTypeSuggestion,
  EvidenceRef,
  SeoResearchResult,
  KeywordAuditItem,
  AIProcessTraceEvent,
} from "../../types";
import { callAI, researchSeoKeywords } from "../../lib/aiService";
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

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const objectStart = body.indexOf("{");
  const arrayStart = body.indexOf("[");
  const start = objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart) ? objectStart : arrayStart;
  const end = start === objectStart ? body.lastIndexOf("}") : body.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Không tìm thấy JSON trong phản hồi AI.");
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

function deterministicBundleEvidence(
  bundle: ReturnType<typeof collectStepDocs>,
  query: string,
): EvidenceRef[] {
  const terms = [...new Set(query.normalize("NFKC").toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter(term => term.length >= 3))].slice(0, 30);
  const bestExcerpt = (docs: Array<{ name: string; content?: string }>, role: EvidenceRef["role"]): EvidenceRef | null => {
    const ranked = docs.flatMap(doc => (doc.content ?? "").split(/\n\s*\n|\r?\n/)
      .map(text => text.replace(/\s+/g, " ").trim())
      .filter(text => text.length >= 40)
      .map(text => ({
        source: doc.name,
        quote: text.slice(0, 800),
        score: terms.reduce((sum, term) => sum + (text.toLocaleLowerCase().includes(term) ? 1 : 0), 0),
      }))
    ).sort((a, b) => b.score - a.score || b.quote.length - a.quote.length);
    const best = ranked[0];
    return best ? { source: best.source, role, quote: best.quote, note: "Deterministically selected and verified source excerpt." } : null;
  };
  const research = bestExcerpt([...bundle.knowledgeBase, ...bundle.actionPlan], "kb");
  const rules = bestExcerpt(bundle.rules, "rules");
  return verifyEvidence([research, rules].filter((item): item is EvidenceRef => Boolean(item)), bundle);
}

function normalizeIdeas(
  parsed: unknown,
  bundle: ReturnType<typeof collectStepDocs>,
  seoResearch: SeoResearchResult,
  trustedSnapshotEvidence: EvidenceRef[] = [],
): CoreIdeaSuggestion[] {
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const rawIdeas = root?.ideas ?? parsed;
  if (!Array.isArray(rawIdeas)) throw new Error("Phản hồi AI không có mảng ideas.");
  const registryValue = root?.evidenceRegistry;
  const evidenceRegistry: Record<string, unknown> = registryValue && typeof registryValue === "object" && !Array.isArray(registryValue)
    ? registryValue as Record<string, unknown>
    : Object.fromEntries((Array.isArray(registryValue) ? registryValue : []).flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const id = String(record.id ?? record.key ?? record.ref ?? `ev-${index + 1}`).trim();
      return id ? [[id, record]] : [];
    }));
  const resolveEvidenceRefs = (value: unknown): unknown[] => (Array.isArray(value) ? value : []).flatMap(ref => {
    if (ref && typeof ref === "object") {
      const record = ref as Record<string, unknown>;
      const id = String(record.id ?? record.ref ?? record.evidenceId ?? "").trim();
      return id && evidenceRegistry[id] ? [evidenceRegistry[id]] : [record];
    }
    const id = String(ref ?? "").trim();
    return evidenceRegistry[id] ? [evidenceRegistry[id]] : [];
  });
  const sharedEvidence = verifyEvidence([
    ...(Array.isArray(root?.sharedEvidence) ? root.sharedEvidence : []),
    ...resolveEvidenceRefs(root?.sharedEvidenceRefs),
  ], bundle);
  const researchedKeywords = new Map(seoResearch.keywords.map(item => [item.keyword.toLocaleLowerCase(), item.keyword]));
  const normalizeAudit = (value: unknown): KeywordAuditItem[] => (Array.isArray(value) ? value : []).flatMap((raw): KeywordAuditItem[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const keyword = researchedKeywords.get(String(item.keyword ?? "").trim().toLocaleLowerCase());
    const decision = item.decision === "accepted" ? "accepted" : item.decision === "rejected" ? "rejected" : null;
    if (!keyword || !decision) return [];
    const normalized = { keyword, decision, reason: String(item.reason ?? "").trim(), ruleReason: String(item.ruleReason ?? "").trim(), kbReason: String(item.kbReason ?? "").trim() };
    const hasResearchDocs = Boolean(bundle.knowledgeBase.length || bundle.actionPlan.length);
    return normalized.reason
      && (!bundle.rules.length || normalized.ruleReason)
      && (!hasResearchDocs || normalized.kbReason)
      ? [normalized]
      : [];
  });
  const sharedKeywordAudit = normalizeAudit(root?.keywordAudit);
  const hasCompleteSharedAudit = new Set(sharedKeywordAudit.map(item => item.keyword.toLocaleLowerCase())).size === seoResearch.keywords.length;
  return rawIdeas
    .map((raw, idx) => {
      if (!raw || typeof raw !== "object") return null;
      const obj = raw as Record<string, unknown>;
      const title = String(obj.title ?? obj.name ?? "").trim();
      const mainArgument = String(obj.mainArgument ?? obj.thesis ?? "").trim();
      if (!title || !mainArgument) return null;
      const ratingObj = (obj.rating && typeof obj.rating === "object" ? obj.rating : {}) as Record<string, unknown>;
      const seo = (obj.seoKeywords && typeof obj.seoKeywords === "object" ? obj.seoKeywords : {}) as Record<string, unknown>;
      const evidence = [
        ...verifyEvidence([
          ...(Array.isArray(obj.evidence) ? obj.evidence : []),
          ...resolveEvidenceRefs(obj.evidenceRefs),
        ], bundle),
        ...sharedEvidence,
        ...trustedSnapshotEvidence,
      ].filter((item, index, all) => all.findIndex(candidate =>
        candidate.role === item.role && candidate.source === item.source && candidate.quote === item.quote
      ) === index);
      const ruleRefs = [...new Set([
        ...verifiedRuleRefs(obj.ruleRefs, bundle),
        ...evidence.filter(item => item.role === "rules").map(item => item.source),
      ])];
      const keywordAudit = hasCompleteSharedAudit ? sharedKeywordAudit : normalizeAudit(obj.keywordAudit);
      if (new Set(keywordAudit.map(item => item.keyword.toLocaleLowerCase())).size !== seoResearch.keywords.length) return null;
      const accepted = new Set(keywordAudit.filter(item => item.decision === "accepted").map(item => item.keyword.toLocaleLowerCase()));
      const primaryKeyword = researchedKeywords.get(String(seo.primary ?? obj.primaryKeyword ?? "").trim().toLocaleLowerCase()) ?? "";
      const secondaryKeywords = toStringArr(seo.secondary ?? obj.secondaryKeywords)
        .map(keyword => researchedKeywords.get(keyword.toLocaleLowerCase()))
        .filter((keyword): keyword is string => Boolean(keyword))
        .filter(keyword => accepted.has(keyword.toLocaleLowerCase()));
      if (!primaryKeyword || !accepted.has(primaryKeyword.toLocaleLowerCase())) return null;
      if (!hasEvidenceForAuthorizedCategories(evidence, bundle)) return null;
      return {
        id: `idea-${idx}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
        title,
        angleLabel: String(obj.angleLabel ?? obj.angle ?? "").trim(),
        angleDescription: String(obj.angleDescription ?? "").trim(),
        mainArgument,
        primaryKeyword,
        secondaryKeywords,
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
        ratingRationales: Object.fromEntries(
          Object.entries((obj.ratingRationales && typeof obj.ratingRationales === "object" ? obj.ratingRationales : {}) as Record<string, unknown>)
            .map(([key, value]) => [key, String(value ?? "").trim()])
            .filter(([, value]) => Boolean(value)),
        ),
        keywordAudit,
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
  const [warning, setWarning] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(article.selectedCoreIdeaId ?? null);
  const [auditIdeaId, setAuditIdeaId] = useState<string | null>(null);
  const autoRequestedRef = useRef<string | null>(null);
  const { tr, canonicalAIOutputInstruction } = useI18n();

  const bundle = useMemo(() => collectStepDocs(2, config, files), [config, files]);
  const documentPromptRules = useMemo(() => buildStepDocumentPromptRules(2, config, files), [config, files]);
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
  const trustedEvidence = useMemo(() => [
    ...trustedSnapshotEvidence,
    ...deterministicBundleEvidence(bundle, [
      article.contentType,
      selectedSnapshot?.label,
      ...(selectedSnapshot?.keywords ?? []),
    ].filter(Boolean).join(" ")),
  ].filter((item, index, all) => all.findIndex(candidate =>
    candidate.role === item.role && candidate.source === item.source && candidate.quote === item.quote
  ) === index), [article.contentType, bundle, selectedSnapshot, trustedSnapshotEvidence]);
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
    () => `${buildActionPlanFingerprint(bundle)}:${model.provider}:${model.id}:step2-seo-pipeline-v10-en-deterministic-evidence:${selectedSnapshotSignature}:${documentPromptRules}`,
    [bundle, documentPromptRules, model.id, model.provider, selectedSnapshotSignature],
  );
  const scanIsStale = Boolean(storedIdeas.length) && article.coreIdeaSourceFingerprint !== sourceFingerprint;
  // Saved Supabase results remain authoritative until the Step 1 selection
  // changes (which clears them) or the user explicitly regenerates.
  const ideas = storedIdeas;

  const fetchIdeas = async (manual = false) => {
    if (!article.contentType) {
      setError("Chưa chọn loại nội dung ở Step 1. Vui lòng quay lại Step 1 trước.");
      return;
    }
    if (!bundle.totalCount) {
      setError("Chưa có tài liệu nào được phân quyền cho Bước 1. Vui lòng mở Cấu hình → AI access by Step.");
      return;
    }
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const seeds = [
        ...(selectedSnapshot?.keywords ?? []),
        selectedSnapshot?.label ?? "",
        article.contentType ?? "",
      ].map(seed => seed.trim()).filter(Boolean);
      const seoResearch = await researchSeoKeywords(seeds, article.id, railwayUrl);
      const contextQuery = [
        ...seeds,
        ...seoResearch.keywords.map(item => item.keyword),
      ].join(" ");
      const systemPrompt = buildRoleSystemPrompt(
        [
          canonicalAIOutputInstruction,
          `Đề xuất ÍT NHẤT 3 core ideas / góc độ cho bài viết dạng "${article.contentType}".`,
          selectedSnapshot
            ? `- Dùng lựa chọn Step 1 đã khóa làm định hướng bắt buộc: ${selectedSnapshot.label}; Type ${selectedSnapshot.typeGroup ?? "không xác định"}; ${selectedSnapshot.wave ?? ""}; ${selectedSnapshot.timeframe ?? ""}; keywords: ${(selectedSnapshot.keywords ?? []).join(", ")}.`
            : "- Không có snapshot cấu trúc từ Step 1; chỉ dùng content type đã chọn.",
          "- Mọi ý tưởng phải suy ra từ các phân vùng tài liệu thực sự được cấp quyền; không yêu cầu hoặc suy đoán dữ liệu từ phân vùng đang trống.",
          "- Dữ liệu SEO thị trường duy nhất được phép dùng là SEO_RESEARCH_TOP_10 do OpenAI Web Search thu thập kèm URL nguồn.",
          "- Đánh giá đủ cả 10 keyword đúng MỘT LẦN ở keywordAudit cấp cao nhất: đối chiếu với từng phân vùng tài liệu đang được cấp quyền, rồi ghi accepted/rejected cùng lý do cụ thể.",
          "- primary/secondary keywords chỉ được lấy từ các keyword accepted trong SEO_RESEARCH_TOP_10; không tự tạo keyword mới.",
          "- Mỗi idea phải có tiêu đề rõ ràng, main argument (luận điểm cốt lõi), Top SEO keywords, và rating chi tiết.",
          "- Rating cho theo thang 0-10 với 5 tiêu chí (overall, seoPotential, audienceFit, docSupport, uniqueness). Ghi rõ căn cứ chấm điểm.",
          "- ratingRationales phải giải thích riêng từng điểm: overall, seoPotential, audienceFit, docSupport và uniqueness; nêu rõ điểm mạnh, điểm yếu hoặc dữ liệu còn thiếu.",
          "- Ứng dụng tự gắn các excerpt đã kiểm chứng sau khi model trả kết quả. KHÔNG trả evidence, matchedDocs hoặc ruleRefs để tránh lặp token.",
          "- Trả CHÍNH XÁC 3 ideas khác nhau; mỗi idea phải chọn một primary keyword accepted.",
          "",
          "Trả về DUY NHẤT một JSON object hợp lệ, không kèm markdown fences hay text giải thích.",
          "Schema:",
          `{
  "keywordAudit": [{ "keyword": string (chép đúng từ SEO_RESEARCH_TOP_10), "decision": "accepted" | "rejected", "reason": string, "ruleReason": string, "kbReason": string }],
  "ideas": [{
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
  "ratingRationales": { "overall": string, "seoPotential": string, "audienceFit": string, "docSupport": string, "uniqueness": string },
  "ideaSupport": string (1 câu giải thích idea phù hợp với tài liệu nội bộ như thế nào)
  }]
}`,
        ].join("\n"),
        documentPromptRules,
      );

      const userPrompt = [
        `TÀI LIỆU STEP 2 (${describeBundle(bundle)}):`,
        "Railway sẽ nạp trực tiếp nội dung các tài liệu đã được cấp quyền cho Bước 1 từ Supabase.",
        "",
        "LOẠI NỘI DUNG ĐÃ CHỌN Ở STEP 1:",
        `- ${article.contentType}`,
        ...(selectedSnapshot ? [
          "",
          "SNAPSHOT STEP 1 ĐÃ LƯU TRÊN SUPABASE (nguồn lựa chọn cố định):",
          JSON.stringify(selectedSnapshot),
        ] : []),
        "",
        `SEO_RESEARCH_TOP_10 — dữ liệu thị trường ${seoResearch.location}/${seoResearch.language}, research lúc ${seoResearch.researchedAt}:`,
        JSON.stringify(seoResearch.keywords),
        "",
        "Yêu cầu: Đề xuất ít nhất 3 core ideas theo schema.",
        "Chỉ trả về JSON object theo schema — không markdown, không giải thích, không text thừa.",
      ].join("\n");

      let modelCalls = 0;
      const jsonRepairCalls = 0;
      let evidenceCorrectionCalls = 0;
      const aiResponses: Awaited<ReturnType<typeof callAI>>[] = [];
      const requestIdeas = async (bypassCache = false) => {
        modelCalls += 1;
        const res = await callAI({
          articleId: article.id,
          model,
          railwayUrl,
          prompt: userPrompt,
          systemPrompt,
          maxTokens: 5500,
          temperature: 0.1,
          stepNumber: 2,
          bypassCache,
          jsonMode: model.provider === "deepseek",
          contextQuery,
        });
        aiResponses.push(res);
        const parsed = extractJson(res.content);
        return { res, parsed, ideas: normalizeIdeas(parsed, bundle, seoResearch, trustedEvidence) };
      };
      let result = await requestIdeas(manual);
      if (result.ideas.length < 3) {
        evidenceCorrectionCalls += 1;
        const acceptedIdeas = result.ideas;
        const root = result.parsed && typeof result.parsed === "object" && !Array.isArray(result.parsed)
          ? result.parsed as Record<string, unknown>
          : {};
        const baseAudit = Array.isArray(root.keywordAudit) ? root.keywordAudit : [];
        const acceptedKeywords = baseAudit.flatMap(item => item && typeof item === "object" && (item as Record<string, unknown>).decision === "accepted"
          ? [String((item as Record<string, unknown>).keyword ?? "").trim()]
          : []).filter(Boolean);
        modelCalls += 1;
        const correctionResponse = await callAI({
          articleId: article.id,
          model,
          railwayUrl,
          prompt: [
            `Create exactly ${3 - acceptedIdeas.length} additional distinct English core ideas for: ${article.contentType}.`,
            `Existing titles that must not be repeated: ${acceptedIdeas.map(item => JSON.stringify(item.title)).join(", ") || "none"}.`,
            `Allowed accepted SEO keywords only: ${JSON.stringify(acceptedKeywords)}.`,
            "Return only a JSON object with an ideas array. Do not return keywordAudit, evidence, documents, or explanations outside JSON.",
            "Each idea must include: title, angleLabel, angleDescription, mainArgument, seoKeywords {primary, secondary}, targetAudience, recommendedTone, recommendedWordCount, rating, ratingRationale, ratingRationales.",
          ].join("\n"),
          systemPrompt: canonicalAIOutputInstruction,
          maxTokens: Math.min(2800, 1000 + (3 - acceptedIdeas.length) * 700),
          temperature: 0.2,
          stepNumber: 2,
          bypassCache: true,
          jsonMode: model.provider === "deepseek",
          skipDocumentContext: true,
        });
        aiResponses.push(correctionResponse);
        const correctionParsed = extractJson(correctionResponse.content);
        const correctionRoot = correctionParsed && typeof correctionParsed === "object" && !Array.isArray(correctionParsed)
          ? correctionParsed as Record<string, unknown>
          : { ideas: correctionParsed };
        const correctionIdeas = normalizeIdeas({ keywordAudit: baseAudit, ideas: correctionRoot.ideas }, bundle, seoResearch, trustedEvidence);
        const mergedIdeas = [...acceptedIdeas, ...correctionIdeas]
          .filter((idea, index, all) => all.findIndex(candidate => candidate.title.toLocaleLowerCase() === idea.title.toLocaleLowerCase()) === index)
          .slice(0, Math.max(3, acceptedIdeas.length));
        result = { ...result, res: correctionResponse, ideas: mergedIdeas };
      }
      if (!result.ideas.length) {
        throw new Error(
          `Không có core idea nào vượt qua kiểm chứng sau một lần bổ sung có mục tiêu. Đã đối chiếu ${bundle.knowledgeBase.length} KB, ${bundle.actionPlan.length} Action và ${bundle.rules.length} Rules.`,
        );
      }
      const partialResult = result.ideas.length < 3;
      const allAudits = result.ideas.flatMap(idea => idea.keywordAudit ?? []);
      const acceptedKeywords = new Set(allAudits.filter(item => item.decision === 'accepted').map(item => item.keyword.toLocaleLowerCase())).size;
      const rejectedKeywords = new Set(allAudits.filter(item => item.decision === 'rejected').map(item => item.keyword.toLocaleLowerCase())).size;
      const trace: AIProcessTraceEvent[] = [
        { id: 'step2-seeds', stage: 'input', status: 'completed', title: '1. Thu thập seed keyword', detail: 'Lấy seed từ Content Type và snapshot Step 1 đã chọn.', facts: { seeds: seeds.length, contentType: article.contentType } },
        { id: 'step2-web-search', stage: 'tool', status: 'completed', title: '2. OpenAI Web Search thị trường USA', detail: 'Tìm tín hiệu SERP, related-query patterns và search intent. Hệ thống chỉ giữ keyword có URL nguồn hợp lệ.', facts: { keywords: seoResearch.keywords.length, cacheHit: Boolean(seoResearch.cacheHit), market: seoResearch.location }, sources: [...new Set(seoResearch.keywords.flatMap(keyword => keyword.sources ?? []))] },
        { id: 'step2-docs', stage: 'retrieval', status: 'completed', title: '3. Nạp tài liệu được phân quyền', detail: `Railway chọn các đoạn liên quan nhất từ Content Plan, Knowledge Base và Skills được cấp cho Bước 1; quote vẫn được kiểm chứng với nội dung đầy đủ.\nPrompting rules theo phân vùng:\n${documentPromptRules || '(không có rule tùy chỉnh)'}`, facts: { kb: bundle.knowledgeBase.length, action: bundle.actionPlan.length, rules: bundle.rules.length } },
        { id: 'step2-model', stage: 'generation', status: 'completed', title: '4. Model tạo và chấm Core Idea', detail: `Model ${result.res.model} audit Top 10 và tạo đúng ba Core Idea. Evidence không được model sinh lại; ứng dụng gắn excerpt đã kiểm chứng để giảm token và lỗi quote.`, facts: { modelCalls, inputTokens: aiResponses.reduce((sum, response) => sum + (response.usage?.inputTokens ?? 0), 0), outputTokens: aiResponses.reduce((sum, response) => sum + (response.usage?.outputTokens ?? 0), 0), cacheHits: aiResponses.filter(response => response.cacheHit).length, durationMs: aiResponses.reduce((sum, response) => sum + (response.timing?.totalMs ?? 0), 0) } },
        { id: 'step2-validation', stage: 'validation', status: jsonRepairCalls || evidenceCorrectionCalls || partialResult ? 'warning' : 'completed', title: '5. Đối chứng tài liệu và kiểm tra output', detail: 'Cả bộ Core Idea phải audit đủ Top 10 và chỉ dùng keyword accepted. Evidence KB/Action/Rules được chọn và xác minh xác định ở ứng dụng; lượt bổ sung idea không nạp lại tài liệu.', facts: { acceptedKeywords, rejectedKeywords, ideasAccepted: result.ideas.length, verifiedEvidence: trustedEvidence.length, jsonRepairCalls, evidenceCorrectionCalls } },
        { id: 'step2-persist', stage: 'persistence', status: 'completed', title: '6. Lưu kết quả có thể audit', detail: 'Lưu Top 10, quyết định chọn/loại, evidence, điểm số, lý do và nhật ký này cùng bài viết trong Supabase.' },
      ];
      const saved = await onUpdate({
        coreIdeaSuggestions: result.ideas,
        selectedCoreIdeaId: undefined,
        coreIdeaSourceFingerprint: sourceFingerprint,
        coreIdeaScannedAt: result.res.servedAt ?? result.res.generatedAt ?? new Date().toISOString(),
        seoResearch,
        step2ProcessTrace: trace,
      });
      if (!saved) throw new Error('Kết quả Bước 1 chưa được lưu vào Supabase.');
      if (partialResult) {
        setWarning(`Đã lưu ${result.ideas.length}/3 core idea vượt qua đầy đủ kiểm chứng. Bạn có thể tiếp tục với kết quả hợp lệ hoặc nhấn “Đề xuất lại” để thử bổ sung.`);
      }
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
    const key = selectedSnapshotSignature;
    if (autoRequestedRef.current === key) return;
    if (!article.contentType || !bundle.totalCount) return;
    if (ideas.length > 0) {
      autoRequestedRef.current = key;
      return;
    }
    autoRequestedRef.current = key;
    fetchIdeas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article.contentType, bundle.totalCount, ideas.length, selectedSnapshotSignature]);

  const handleSelect = (idea: CoreIdeaSuggestion) => {
    const selectionChanged = article.selectedCoreIdeaId !== idea.id;
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
      ...(selectionChanged ? {
        outline: [],
        outlineSourceFingerprint: null,
        outlineScannedAt: null,
        step3ProcessTrace: [],
        draft: "",
        draftSourceFingerprint: null,
        draftScannedAt: null,
      } : {}),
    });
  };

  return (
    <div className="minimal-step h-full flex flex-col gap-4 animate-fade-in-up">
      <div className="minimal-step-shell bg-white rounded-2xl border border-slate-200 flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="p-3.5 sm:p-5 md:p-6 flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-800 mb-1">{tr('Bước 1 — Ý tưởng cốt lõi & Góc tiếp cận', 'Step 1 — Core Idea & Angle')}</h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {tr('AI đề xuất ≥3 ý tưởng cho loại nội dung ', 'AI proposes ≥3 core ideas for ')}<b>"{article.contentType || tr('(chưa chọn)', '(not selected)')}"</b>. {tr('Chọn một để sang Bước 2.', 'Select one to continue to Step 2.')}
                </p>
              </div>
              <button
                onClick={() => fetchIdeas(true)}
                disabled={loading || !article.contentType || !bundle.totalCount}
                className="shrink-0 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all whitespace-nowrap"
              >
                {loading ? tr('Đang phân tích...', 'Analyzing...') : ideas.length ? tr('Đề xuất lại', 'Regenerate') : tr('Lấy đề xuất', 'Generate ideas')}
              </button>
            </div>

            {scanIsStale && ideas.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {tr('Nguồn hoặc model đã thay đổi — vẫn dùng kết quả Bước 1 đã lưu trong Supabase. Chỉ tạo lại khi bạn nhấn “Đề xuất lại”.', 'Sources or model changed — the Step 1 result saved in Supabase remains active. It only changes when you click “Regenerate”.')}
              </div>
            )}

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 text-xs text-rose-700">{error}</div>
            )}

            {warning && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">{warning}</div>
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
                    <div key={idea.id} className="relative">
                    <button
                      onClick={() => handleSelect(idea)}
                      className={`step-result-card w-full text-left rounded-xl border transition-all flex flex-col ${
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

                      <div className="px-4 pb-3 space-y-2">
                        {idea.angleDescription && <div><div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{tr('Lý do chọn góc tiếp cận', 'Angle rationale')}</div><p className="text-[11px] text-slate-600 leading-relaxed mt-1">{idea.angleDescription}</p></div>}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px]">
                          <div className="rounded-lg border border-slate-100 bg-slate-50 p-2"><b className="block text-slate-500">{tr('Độc giả', 'Audience')}</b><span>{idea.targetAudience || '—'}</span></div>
                          <div className="rounded-lg border border-slate-100 bg-slate-50 p-2"><b className="block text-slate-500">Tone</b><span>{idea.recommendedTone || '—'}</span></div>
                          <div className="rounded-lg border border-slate-100 bg-slate-50 p-2"><b className="block text-slate-500">{tr('Độ dài', 'Length')}</b><span>{idea.recommendedWordCount.toLocaleString()} {tr('từ', 'words')}</span></div>
                        </div>
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
                          { key: "seoPotential" as const, label: "SEO Potential", val: idea.rating.seoPotential },
                          { key: "audienceFit" as const, label: "Audience Fit", val: idea.rating.audienceFit },
                          { key: "docSupport" as const, label: "Doc Support", val: idea.rating.docSupport },
                          { key: "uniqueness" as const, label: "Uniqueness", val: idea.rating.uniqueness },
                        ].map(r => (
                          <div key={r.label} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-500 font-medium w-24 shrink-0">{r.label}</span>
                              <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${ratingBar(r.val)}`} style={{ width: `${Math.min(r.val * 10, 100)}%` }} /></div>
                              <span className={`text-[10px] font-mono font-bold w-6 text-right ${ratingColor(r.val)}`}>{r.val.toFixed(1)}</span>
                            </div>
                            {(idea.ratingRationales?.[r.key] || idea.ratingRationale) && <p className="pl-[6.5rem] text-[10px] text-slate-500 leading-relaxed">{idea.ratingRationales?.[r.key] || idea.ratingRationale}</p>}
                          </div>
                        ))}
                        {idea.ratingRationale && <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-[10px] text-blue-800"><b>{tr('Đánh giá tổng quan:', 'Overall assessment:')}</b> {idea.ratingRationales?.overall || idea.ratingRationale}</div>}
                      </div>

                      <div className="border-t border-slate-100 px-4 py-4 space-y-2">
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{tr('Toàn bộ dẫn chứng đã kiểm chứng', 'All verified evidence')}</div>
                        {(idea.evidence ?? []).map((e, i) => <div key={`${e.source}-${i}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex flex-wrap gap-1.5 mb-1.5"><span className="text-[9px] font-bold uppercase text-slate-500">{e.role}</span><span className="text-[10px] font-semibold text-slate-700">{e.source}</span></div>{e.quote && <blockquote className="border-l-2 border-slate-300 pl-2 text-[10px] text-slate-700 leading-relaxed whitespace-pre-wrap">“{e.quote}”</blockquote>}{e.note && <p className="text-[10px] text-slate-500 mt-1.5"><b>{tr('Lý do sử dụng:', 'Why it matters:')}</b> {e.note}</p>}</div>)}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]"><div><b className="text-slate-500">KB / Action:</b> {idea.matchedDocs.join(', ') || '—'}</div><div><b className="text-slate-500">Rules:</b> {idea.ruleRefs.join(', ') || '—'}</div></div>
                      </div>

                      {isSelected && (
                        <div className="border-t border-slate-100 px-4 py-2 text-[10px] font-bold text-slate-900">
                          ✓ Đã chọn
                        </div>
                      )}
                    </button>
                    <button type="button" onClick={() => setAuditIdeaId(idea.id)} className="absolute top-3 right-16 w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-violet-50 hover:border-violet-300 text-slate-500 hover:text-violet-700 flex items-center justify-center shadow-sm" title={tr('Xem nhật ký AI', 'View AI log')} aria-label={`${tr('Xem nhật ký AI cho', 'View AI log for')} ${idea.title}`}>
                      <Search className="app-icon" aria-hidden="true" />
                    </button>
                    </div>
                  );
                })}
              </div>
            )}

            {!loading && ideas.length === 0 && !error && article.contentType && bundle.totalCount > 0 && (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
                {tr('Nhấn', 'Click')} <span className="font-semibold">"{tr('Lấy đề xuất', 'Generate ideas')}"</span> {tr('để AI phân tích tài liệu và gợi ý core ideas.', 'to let AI analyze documents and suggest core ideas.')}
              </div>
            )}
          </div>
        </div>
      </div>

      {auditIdeaId && (() => { const idea = ideas.find(item => item.id === auditIdeaId); if (!idea) return null; return <ProcessTraceModal title={idea.title} events={article.step2ProcessTrace} onClose={() => setAuditIdeaId(null)}><div className="space-y-4"><div><h4 className="text-xs font-bold text-slate-800">SEO Research Top 10</h4><div className="space-y-2 mt-2">{article.seoResearch?.keywords.map((keyword, index) => <div key={keyword.keyword} className="rounded-lg border border-cyan-100 bg-cyan-50/50 p-3 text-[10px]"><div className="flex flex-wrap gap-2"><span className="font-mono text-cyan-700">#{index + 1}</span><b>{keyword.keyword}</b><span>{keyword.intent ?? 'intent n/a'}</span></div>{keyword.marketEvidence && <p className="mt-1 text-slate-600">{keyword.marketEvidence}</p>}<div className="flex gap-2 mt-1">{keyword.sources?.map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-cyan-700 underline">Source {i + 1}</a>)}</div></div>)}</div></div><div><h4 className="text-xs font-bold text-slate-800">{tr('Đối chứng keyword của lựa chọn', 'Keyword validation for this idea')}</h4><div className="divide-y divide-slate-100 rounded-lg border border-slate-200 mt-2">{idea.keywordAudit?.map(item => <div key={item.keyword} className="p-3 text-[10px]"><div className="flex gap-2"><span className={`font-bold ${item.decision === 'accepted' ? 'text-emerald-700' : 'text-rose-700'}`}>{item.decision}</span><b>{item.keyword}</b></div><p className="mt-1">{item.reason}</p><p className="mt-1 text-amber-700"><b>Rules:</b> {item.ruleReason}</p><p className="mt-1 text-indigo-700"><b>KB/Action:</b> {item.kbReason}</p></div>)}</div></div></div></ProcessTraceModal>; })()}

      <div className="flex justify-between gap-2 shrink-0">
        <button
          onClick={onPrev}
          className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs py-2.5 px-3 sm:px-5 rounded-2xl shadow-sm transition-all"
        >
          {tr('Quay lại', 'Back')}
        </button>
        <button
          onClick={onNext}
          disabled={!selectedId || scanIsStale}
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs py-2.5 px-3 sm:px-6 rounded-2xl shadow-sm transition-all"
        >
          {tr('Tiếp tục — Draft Outline', 'Continue — Draft Outline')}
        </button>
      </div>
    </div>
  );
}
