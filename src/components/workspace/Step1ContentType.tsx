import { useState, useMemo, useEffect, useRef } from "react";
import type {
  Article,
  AIModel,
  AppConfig,
  DocumentFile,
  ContentTypeSuggestion,
  ContentTypeGroup,
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

interface Props {
  article: Article;
  config: AppConfig;
  files: DocumentFile[];
  model: AIModel;
  railwayUrl: string;
  onUpdate: (updates: Partial<Article>) => Promise<boolean>;
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

function normalizeGroup(v: unknown): ContentTypeGroup | undefined {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "A" || s === "B" || s === "C") return s;
  const m = s.match(/\b(A|B|C)\b/);
  return m ? (m[1] as ContentTypeGroup) : undefined;
}

function canonical(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\\([.()\[\]~-])/g, "$1")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceContains(source: string, value: string): boolean {
  const needle = canonical(value);
  return Boolean(needle) && canonical(source).includes(needle);
}

function evidenceQuoteExists(source: string, quote: string): boolean {
  const normalizedSource = canonical(source);
  const normalizedQuote = canonical(quote);
  if (!normalizedQuote) return false;
  if (normalizedSource.includes(normalizedQuote)) return true;

  // Models sometimes preserve a verbatim PDF row but add line breaks or an ellipsis
  // between its cells. Require a meaningful literal fragment instead of rejecting the
  // entire result solely because the full multi-column row was not contiguous.
  return quote
    .split(/\r?\n|\.{3}|…/)
    .map(part => canonical(part))
    .filter(part => part.length >= 16)
    .some(part => normalizedSource.includes(part));
}

function findEvidenceWindow(source: string, terms: string[]): string | undefined {
  const required = terms.map(canonical).filter(Boolean);
  if (!required.length) return undefined;
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const start = Math.max(0, index - 3);
    const end = Math.min(lines.length, index + 4);
    const window = lines.slice(start, end).join("\n").trim();
    const normalized = canonical(window);
    if (required.every(term => normalized.includes(term))) return window;
  }
  return undefined;
}

function extractDocumentYear(text: string): number | undefined {
  const header = text.slice(0, 2500);
  const match = header.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

interface EvidenceIndex {
  actionPlanNames: Set<string>;
  actionPlanOriginalNames: string[];
  kbOriginalNames: string[];
  ruleOriginalNames: string[];
  actionText: string;
  actionByName: Map<string, string>;
  kbByName: Map<string, string>;
  rulesByName: Map<string, string>;
}

function findTypeEvidence(documents: Map<string, string>, typeGroup: ContentTypeGroup): string | undefined {
  const pattern = new RegExp(`(?:comparison\\s+)?type\\s*${typeGroup}\\b`, "i");
  for (const content of documents.values()) {
    const line = content
      .split(/\r?\n/)
      .map(value => value.trim())
      .find(value => pattern.test(value));
    if (line) return line;
  }
  return undefined;
}

function normalizeSuggestions(parsed: unknown, evidence: EvidenceIndex): ContentTypeSuggestion[] {
  if (!Array.isArray(parsed)) throw new Error("Phản hồi AI không phải mảng.");
  return parsed
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const label = String(obj.label ?? obj.name ?? "").trim();
      const description = String(obj.description ?? obj.summary ?? "").trim();
      if (!label || !description) return null;
      const arr = (key: string): string[] => {
        const value = obj[key];
        if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
        // Some providers serialize list fields as comma/newline-separated strings even
        // when the requested JSON schema says string[]. Normalize that shape, then let
        // the evidence checks below reject every value not found in its source document.
        if (typeof value === "string") {
          return value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean);
        }
        return [];
      };
      const typeGroup = normalizeGroup(obj.typeGroup ?? obj.type);
      const wave = String(obj.wave ?? "").trim();
      const timeframe = String(obj.timeframe ?? "").trim();
      const keywords = arr("keywords").map(keyword => keyword.trim()).filter(Boolean);
      const matchedDocs = arr("matchedDocs").map(name => name.trim()).filter(Boolean);
      const actionPlanEvidence = String(obj.actionPlanEvidence ?? "").trim();
      const scheduleEvidence = String(obj.scheduleEvidence ?? "").trim();
      const referencesActionPlan = matchedDocs.some(name => evidence.actionPlanNames.has(canonical(name)));
      const timeframeExists = sourceContains(evidence.actionText, timeframe);
      const waveExists = sourceContains(evidence.actionText, wave);
      const labelExists = sourceContains(evidence.actionText, label);
      const keywordsExist = keywords.every(keyword => sourceContains(evidence.actionText, keyword));
      const verifiedActionEvidence = evidenceQuoteExists(evidence.actionText, actionPlanEvidence)
        ? actionPlanEvidence
        : findEvidenceWindow(evidence.actionText, [label, keywords[0]]);
      const modelScheduleIsValid = evidenceQuoteExists(evidence.actionText, scheduleEvidence) &&
        canonical(scheduleEvidence).includes(canonical(wave)) &&
        canonical(scheduleEvidence).includes(canonical(timeframe));
      const verifiedScheduleEvidence = modelScheduleIsValid
        ? scheduleEvidence
        : findEvidenceWindow(evidence.actionText, [wave, timeframe]);
      const verifiedActionTypeEvidence = typeGroup
        ? findTypeEvidence(evidence.actionByName, typeGroup)
        : undefined;
      const verifiedKbEvidence = typeGroup ? findTypeEvidence(evidence.kbByName, typeGroup) : undefined;
      const verifiedRuleEvidence = typeGroup ? findTypeEvidence(evidence.rulesByName, typeGroup) : undefined;
      // Action Plan is authoritative for the available choices. KB and Rules enrich
      // the description but must not hide a valid type/wave/timeline combination.
      if (
        !typeGroup || !wave || !timeframe || !keywords.length ||
        !waveExists || !timeframeExists || !labelExists || !keywordsExist ||
        !verifiedActionEvidence || !verifiedScheduleEvidence ||
        !verifiedActionTypeEvidence
      ) return null;
      return {
        id: `sg-${idx}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
        label,
        description,
        keywords,
        typeGroup,
        wave,
        timeframe,
        audience: obj.audience ? String(obj.audience) : undefined,
        format: obj.format ? String(obj.format) : undefined,
        // A model may accidentally put KB/Rules names in matchedDocs. Once the
        // literal Action Plan evidence has passed all checks, bind the result to
        // the actual authorized Action Plan records instead of trusting that field.
        matchedDocs: referencesActionPlan ? matchedDocs : evidence.actionPlanOriginalNames,
        kbRefs: evidence.kbOriginalNames,
        ruleRefs: evidence.ruleOriginalNames,
        kbEvidence: verifiedKbEvidence,
        ruleEvidence: verifiedRuleEvidence,
        actionPlanEvidence: verifiedActionEvidence,
        scheduleEvidence: verifiedScheduleEvidence,
        sourceYear: extractDocumentYear(evidence.actionText),
        icon: obj.icon ? String(obj.icon) : undefined,
      } as ContentTypeSuggestion;
    })
    .filter((v): v is ContentTypeSuggestion => v !== null);
}

const GROUP_META: Record<ContentTypeGroup, { title: string; accent: string; badge: string; ring: string }> = {
  A: { title: "Type A", accent: "text-violet-700",  badge: "bg-violet-100 text-violet-700 border-violet-200",   ring: "bg-violet-500" },
  B: { title: "Type B", accent: "text-emerald-700", badge: "bg-emerald-100 text-emerald-700 border-emerald-200", ring: "bg-emerald-500" },
  C: { title: "Type C", accent: "text-amber-700",   badge: "bg-amber-100 text-amber-700 border-amber-200",       ring: "bg-amber-500" },
};

const GROUP_ORDER: ContentTypeGroup[] = ["A", "B", "C"];
const STEP1_PROMPT_VERSION = "step1-manifest-v9-merged-retries";

function suggestionScopeKey(suggestion: ContentTypeSuggestion): string {
  return [
    suggestion.typeGroup ?? "?",
    canonical(suggestion.wave ?? ""),
    canonical(suggestion.timeframe ?? ""),
  ].join("|");
}

function preserveCompleteScopes(
  current: ContentTypeSuggestion[],
  previous: ContentTypeSuggestion[],
): ContentTypeSuggestion[] {
  const currentCounts = new Map<string, number>();
  const previousCounts = new Map<string, number>();
  current.forEach(item => currentCounts.set(suggestionScopeKey(item), (currentCounts.get(suggestionScopeKey(item)) ?? 0) + 1));
  previous.forEach(item => previousCounts.set(suggestionScopeKey(item), (previousCounts.get(suggestionScopeKey(item)) ?? 0) + 1));
  const regressedScopes = new Set(
    [...previousCounts].filter(([scope, count]) => (currentCounts.get(scope) ?? 0) < count).map(([scope]) => scope),
  );
  if (!regressedScopes.size) return current;
  return [
    ...current.filter(item => !regressedScopes.has(suggestionScopeKey(item))),
    ...previous.filter(item => regressedScopes.has(suggestionScopeKey(item))),
  ];
}

function displayTimeframe(suggestion: ContentTypeSuggestion): string {
  const timeframe = suggestion.timeframe ?? "";
  if (!suggestion.sourceYear || /\b20\d{2}\b/.test(timeframe)) return timeframe;
  return `${timeframe} · ${suggestion.sourceYear}`;
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
  const autoRequestedRef = useRef<string | null>(null);
  const { tr, outputInstruction } = useI18n();

  const bundle = useMemo(() => collectStepDocs(1, config, files), [config, files]);
  const documentPromptRules = useMemo(() => buildStepDocumentPromptRules(1, config, files), [config, files]);
  const sourceFingerprint = useMemo(
    () => `${buildActionPlanFingerprint(bundle)}:${model.provider}:${model.id}:${STEP1_PROMPT_VERSION}`,
    [bundle, model.id, model.provider],
  );
  const sourceModelPrefix = useMemo(
    () => `${buildActionPlanFingerprint(bundle)}:${model.provider}:${model.id}:`,
    [bundle, model.id, model.provider],
  );
  const hasCachedScan = Boolean(
    suggestions.length || article.contentTypeSourceFingerprint || article.contentTypeScannedAt,
  );
  const scanIsStale = hasCachedScan && article.contentTypeSourceFingerprint !== sourceFingerprint;
  // A verified Step 1 scan is an immutable article snapshot. Source/model
  // changes are shown to the user, but never hide or automatically replace it.
  const visibleSuggestions = suggestions;

  // Group suggestions by Type A/B/C; anything without a group falls to "other".
  const grouped = useMemo(() => {
    const byGroup: Record<ContentTypeGroup, ContentTypeSuggestion[]> = { A: [], B: [], C: [] };
    const other: ContentTypeSuggestion[] = [];
    visibleSuggestions.forEach(s => {
      if (s.typeGroup && byGroup[s.typeGroup]) byGroup[s.typeGroup].push(s);
      else other.push(s);
    });
    return { byGroup, other };
  }, [visibleSuggestions]);

  const fetchSuggestions = async (manual = false) => {
    if (!bundle.totalCount) {
      setError("Chưa có tài liệu nào được phân quyền cho Step 1. Vui lòng mở Cấu hình → Step Setup để gán tài liệu.");
      return;
    }
    if (!bundle.actionPlan.some(doc => doc.content)) {
      setError("Step 1 cần ít nhất một Action Plan có nội dung để xác định Content Type, timeframe và keywords. Knowledge Base và Rules là tùy chọn.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const systemPrompt = buildRoleSystemPrompt(
        [
          outputInstruction,
          "Tổng hợp ĐẦY ĐỦ Content Type A/B/C từ toàn bộ Action Plan được cấp quyền; chỉ dùng thêm Knowledge Base hoặc Rules khi các phân vùng đó được cấp tài liệu.",
          "",
          "QUY TẮC PHÂN LOẠI (bắt buộc):",
          "- Action Plan là nguồn sự thật cho danh sách lựa chọn: nhận diện tên Content Type, typeGroup (A/B/C), topic, wave, timeline và keywords trực tiếp từ TOÀN BỘ Action Plan.",
          "- Knowledge Base và Rules chỉ dùng để bổ sung mô tả/tiêu chí. Không loại bỏ một lựa chọn hợp lệ chỉ vì KB hoặc Rules không có dòng ghi nguyên văn Type A/B/C.",
          "- `wave` là PUBLISHING WAVE từ tiêu đề section, ví dụ `Wave 1`/`Wave 2`; KHÔNG dùng W2/W3/W4/W5 vì đó là execution week của từng row.",
          "- `timeframe` là mốc đi cùng publishing wave trong tiêu đề section. Cả wave và timeframe PHẢI sao chép nguyên văn từ cùng một tiêu đề/đoạn Action Plan, tuyệt đối không tự quy đổi quý/năm.",
          "- Mỗi loại gắn với đúng bộ keywords mà Action Plan chỉ định cho loại/wave đó. Trích nguyên văn, không thêm bớt từ khóa không có trong tài liệu.",
          "- Chỉ trả về lựa chọn có đủ nhóm + wave + timeframe + ít nhất 1 keyword. Bỏ qua mục thiếu dữ liệu thay vì suy đoán.",
          "- PHẢI quét từ đầu đến cuối TẤT CẢ tài liệu Action Plan được cấp quyền, qua TẤT CẢ publishing wave và TẤT CẢ timeline/tháng.",
          "- Trả về MỌI tổ hợp content type + topic + publishing wave + timeline có trong tài liệu; không dừng sau Wave 1, không giới hạn ở Tháng 7, không chỉ trả Type A/B.",
          "- Trước khi trả JSON, tự đối chiếu lại toàn bộ Action Plan để bảo đảm không bỏ sót Type A, Type B hoặc Type C ở bất kỳ wave/timeline nào.",
          "- matchedDocs chỉ chứa chính xác tên tài liệu Action Plan làm căn cứ cho lựa chọn; không đặt tên KB hoặc Rules vào matchedDocs.",
          "- kbRefs và ruleRefs phải chứa chính xác tên file KB và Rules dùng để nhận diện Content Type.",
          "- kbEvidence và ruleEvidence là các đoạn trích nguyên văn mô tả tiêu chí taxonomy dùng để suy ra Type A/B/C.",
          "- actionPlanEvidence là đoạn/hàng nguyên văn chứa topic và toàn bộ keywords trả về.",
          "- scheduleEvidence là tiêu đề/đoạn nguyên văn chứa đồng thời wave và timeframe. Có thể khác actionPlanEvidence vì PDF tách lịch ở tiêu đề section.",
          "- Với file Revised June 2026, giữ timeframe nguyên văn như 'Tháng 7'/'Tháng 8'; không đổi thành Q1/Q2/Q3/Q4 và không thêm năm khác.",
          "- Không dùng kiến thức ghi nhớ hoặc năm từ ví dụ. Nếu file ghi 2026 thì không được trả về 2024.",
          "",
          "NGUYÊN TẮC QUÉT DỮ LIỆU:",
          "- Đọc kỹ toàn bộ Action Plan (là nguồn phân loại cơ bản). Action Plan được cập nhật định kỳ mỗi 3 tháng — luôn phản ánh đúng nội dung file hiện tại, không dùng dữ liệu cũ ghi nhớ.",
          "- Dùng Knowledge Base để mô tả chủ đề/độ sâu. Kiểm chứng với Rules & Guidelines (ghi ở ruleRefs).",
          "",
          "Trả về DUY NHẤT một mảng JSON hợp lệ, không kèm markdown fences hay text giải thích.",
          "Mỗi phần tử schema:",
          `{ "label": string (topic Action Plan), "typeGroup": "A" | "B" | "C", "wave": string, "timeframe": string (chép nguyên văn), "description": string, "keywords": string[] (chép nguyên văn), "matchedDocs": string[] (tên Action Plan), "kbRefs": string[] (tên KB), "ruleRefs": string[] (tên Rules), "kbEvidence": string, "ruleEvidence": string, "actionPlanEvidence": string (topic + keywords), "scheduleEvidence": string (wave + timeframe) }`,
        ].join("\n"),
        documentPromptRules,
      );

      const prompt = [
        `TÀI LIỆU ĐƯỢC PHÂN QUYỀN ĐỌC Ở STEP 1 (${describeBundle(bundle)}):`,
        "Railway sẽ nạp trực tiếp nội dung các tài liệu đã được cấp quyền cho Step 1 từ Supabase.",
        "",
        "Yêu cầu: Đọc toàn bộ các Action Plan đã được cấp quyền trong Supabase và tổng hợp đầy đủ mọi Content Type A/B/C của tất cả wave và timeline. Phân loại đúng nhóm, gán đúng wave + mốc thời gian + keywords cho từng lựa chọn; tuyệt đối không giới hạn ở Tháng 7 / Wave 1.",
        "Chỉ trả về JSON array — không markdown, không giải thích, không text thừa.",
      ].join("\n");

      const res = await callAI({
        articleId: article.id,
        model,
        railwayUrl,
        prompt,
        systemPrompt,
        maxTokens: 16000,
        temperature: 0.1,
        stepNumber: 1,
        splitByWave: true,
        bypassCache: manual,
      });
      const parsed = extractJson(res.content);
      const evidence: EvidenceIndex = {
        actionPlanNames: new Set(bundle.actionPlan.map(doc => canonical(doc.name))),
        actionPlanOriginalNames: bundle.actionPlan.map(doc => doc.name),
        kbOriginalNames: bundle.knowledgeBase.map(doc => doc.name),
        ruleOriginalNames: bundle.rules.map(doc => doc.name),
        actionText: bundle.actionPlan.map(doc => doc.content ?? "").join("\n"),
        actionByName: new Map(bundle.actionPlan.map(doc => [canonical(doc.name), doc.content ?? ""])),
        kbByName: new Map(bundle.knowledgeBase.map(doc => [canonical(doc.name), doc.content ?? ""])),
        rulesByName: new Map(bundle.rules.map(doc => [canonical(doc.name), doc.content ?? ""])),
      };
      const normalized = normalizeSuggestions(parsed, evidence);
      if (!normalized.length) {
        throw new Error("Toàn bộ đề xuất bị từ chối vì thiếu dẫn chứng Type A/B/C, timeframe hoặc keyword trong Action Plan.");
      }
      const sameSourceSnapshot = manual
        && Boolean(article.contentTypeSourceFingerprint?.startsWith(sourceModelPrefix));
      const nextSuggestions = sameSourceSnapshot
        ? preserveCompleteScopes(normalized, suggestions)
        : normalized;
      const saved = await onUpdate({
        // A manual rescan of unchanged sources must never silently replace a
        // fuller verified snapshot with a shorter stochastic model response.
        contentTypeSuggestions: nextSuggestions,
        contentTypeSourceFingerprint: sourceFingerprint,
        contentTypeScannedAt: res.servedAt ?? res.generatedAt ?? new Date().toISOString(),
        contentTypeCacheHit: Boolean(res.cacheHit),
        contentType: null,
        selectedContentTypeSuggestionId: null,
        selectedContentTypeSnapshot: null,
        coreIdeaSuggestions: [],
        selectedCoreIdeaId: undefined,
        coreIdeaSourceFingerprint: null,
        seoResearch: null,
        step2ProcessTrace: [],
        coreIdeaScannedAt: null,
        outline: [],
        outlineSourceFingerprint: null,
        outlineScannedAt: null,
        step3ProcessTrace: [],
        draft: "",
        draftSourceFingerprint: null,
        draftScannedAt: null,
      });
      if (!saved) throw new Error('Kết quả Step 1 chưa được lưu vào Supabase.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Không lấy được đề xuất từ AI: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  // First-time scan only — cache in article.contentTypeSuggestions.
  // Explicit user click on "Tổng hợp lại toàn bộ" is the only way to re-scan afterwards.
  useEffect(() => {
    if (autoRequestedRef.current === "initial") return;
    if (!bundle.totalCount) return;
    if (suggestions.length > 0) return;
    autoRequestedRef.current = "initial";
    fetchSuggestions(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.totalCount, suggestions.length]);

  const handleSelect = (suggestion: ContentTypeSuggestion) => {
    const selectionChanged = article.selectedContentTypeSuggestionId !== suggestion.id;
    onUpdate({
      contentType: suggestion.label,
      selectedContentTypeSuggestionId: suggestion.id,
      selectedContentTypeSnapshot: suggestion,
      ...(selectionChanged ? {
        coreIdeaSuggestions: [],
        selectedCoreIdeaId: undefined,
        coreIdeaSourceFingerprint: null,
        seoResearch: null,
        step2ProcessTrace: [],
        coreIdeaScannedAt: null,
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

  const handleUseCustom = () => {
    const trimmed = customLabel.trim();
    if (!trimmed) return;
    onUpdate({
      contentType: trimmed,
      selectedContentTypeSuggestionId: null,
      selectedContentTypeSnapshot: null,
      coreIdeaSuggestions: [],
      selectedCoreIdeaId: undefined,
      coreIdeaSourceFingerprint: null,
      seoResearch: null,
      step2ProcessTrace: [],
      coreIdeaScannedAt: null,
      outline: [],
      outlineSourceFingerprint: null,
      outlineScannedAt: null,
      step3ProcessTrace: [],
      draft: "",
      draftSourceFingerprint: null,
      draftScannedAt: null,
    });
    setCustomLabel("");
  };

  const selectedSuggestion = visibleSuggestions.find(s =>
    s.id === article.selectedContentTypeSuggestionId ||
    (!article.selectedContentTypeSuggestionId && s.label === selected),
  );

  return (
    <div className="h-full flex flex-col gap-4 animate-fade-in-up">
      <div className="bg-[#ebedf3] rounded-3xl p-1.5 shadow-sm border border-slate-200/60 flex-1 flex flex-col min-h-0">
        <div className="bg-white rounded-2xl p-3.5 sm:p-6 flex-1 overflow-y-auto shadow-sm">
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-800 mb-1">{tr('Bước 1 — Loại nội dung', 'Step 1 — Content Type')}</h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {tr('AI lấy chủ đề, wave và mốc thời gian từ Action Plan; dùng Knowledge Base + Rules để phân loại ', 'AI reads topics, waves, and timeframes from the Action Plan and uses Knowledge Base + Rules to classify ')}<b>Type A / B / C</b>. {tr('Chọn một phương án để sang Bước 2.', 'Select one option to continue to Step 2.')}
                </p>
              </div>
              <button
                onClick={() => fetchSuggestions(true)}
                disabled={loading || !bundle.totalCount}
                className="shrink-0 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all whitespace-nowrap"
              >
                {loading ? tr('Đang quét toàn bộ...', 'Scanning all...') : visibleSuggestions.length ? tr('Tổng hợp lại toàn bộ', 'Rescan all') : tr('Tổng hợp toàn bộ', 'Scan all')}
              </button>
            </div>

            {article.contentTypeScannedAt && !loading && (
              <div className={`rounded-xl border px-3 py-2 text-[11px] ${
                scanIsStale
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700"
              }`}>
                {scanIsStale
                  ? tr('Nguồn hoặc model đã thay đổi — vẫn đang dùng snapshot Bước 1 đã lưu. Chỉ cập nhật khi bạn nhấn “Tổng hợp lại toàn bộ”.', 'Sources or model changed — the saved Step 1 snapshot remains active. It only updates when you click “Rescan all”.')
                  : article.contentTypeCacheHit
                    ? `Snapshot Step 1 đã lưu trên Supabase lúc ${new Date(article.contentTypeScannedAt).toLocaleString("vi-VN")} — dùng lại kết quả cache đã xác thực.`
                    : `Snapshot Step 1 đã lưu trên Supabase sau khi quét Action Plan lúc ${new Date(article.contentTypeScannedAt).toLocaleString("vi-VN")}.`}
              </div>
            )}

            {!bundle.totalCount && (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
                {tr('Chưa có tài liệu nào được phân quyền cho Bước 1. Mở ', 'No documents are authorized for Step 1. Open ')}<span className="font-semibold">{tr('Cấu hình → Phân quyền theo Step', 'Settings → Step access')}</span>{tr(' để gán tài liệu.', ' to assign documents.')}
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

            {!loading && visibleSuggestions.length > 0 && (
              <div className="space-y-5">
                {GROUP_ORDER.map(g => {
                  const items = grouped.byGroup[g];
                  if (!items.length) return null;
                  const meta = GROUP_META[g];
                  const waves = Object.entries(
                    items.reduce<Record<string, ContentTypeSuggestion[]>>((acc, item) => {
                      const key = `${item.wave}|||${displayTimeframe(item)}`;
                      (acc[key] ??= []).push(item);
                      return acc;
                    }, {}),
                  );
                  return (
                    <div key={g} className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.ring}`} />
                        <span className={`text-xs font-bold ${meta.accent}`}>{meta.title}</span>
                        <span className="text-[10px] text-slate-400">· {items.length} loại</span>
                      </div>
                      {waves.map(([waveKey, waveItems]) => {
                        const [wave, timeframe] = waveKey.split("|||");
                        return (
                          <div key={waveKey} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 space-y-2.5">
                            <div className="flex flex-wrap items-center gap-2 px-0.5">
                              <span className={`text-[10px] font-bold border rounded-full px-2 py-0.5 ${meta.badge}`}>{wave}</span>
                              <span className="text-[10px] font-semibold text-slate-600">{timeframe}</span>
                              <span className="text-[10px] text-slate-400">· {waveItems.length} lựa chọn</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {waveItems.map(s => (
                                <SuggestionCard key={s.id} s={s} isSelected={selectedSuggestion?.id === s.id} onSelect={handleSelect} groupBadge={meta.badge} />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {grouped.other.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      <span className="text-xs font-bold text-slate-600">{tr('Chưa phân nhóm', 'Uncategorized')}</span>
                      <span className="text-[10px] text-slate-400">· {grouped.other.length} loại</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {grouped.other.map(s => (
                        <SuggestionCard key={s.id} s={s} isSelected={selectedSuggestion?.id === s.id} onSelect={handleSelect} groupBadge="bg-slate-100 text-slate-600 border-slate-200" />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!loading && visibleSuggestions.length === 0 && !error && bundle.totalCount > 0 && (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
                {tr('Nhấn', 'Click')} <span className="font-semibold">"{tr('Lấy đề xuất', 'Generate')}"</span> {tr('để AI phân tích tài liệu và gợi ý loại nội dung.', 'to let AI analyze documents and suggest content types.')}
              </div>
            )}

            {/* Custom content type */}
            <div className="border border-slate-200 rounded-2xl p-4 space-y-2">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{tr('Hoặc nhập loại nội dung tùy chỉnh', 'Or enter a custom content type')}</div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={customLabel}
                  onChange={e => setCustomLabel(e.target.value)}
                  placeholder={tr('Ví dụ: Bài phân tích chuyên sâu, Ebook hướng dẫn...', 'Example: In-depth analysis, instructional ebook...')}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-slate-800 transition-all placeholder:text-slate-400"
                />
                <button
                  onClick={handleUseCustom}
                  disabled={!customLabel.trim()}
                  className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all"
                >
                  {tr('Dùng', 'Use')}
                </button>
              </div>
            </div>

            {selected && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 animate-fade-in-up">
                <div className="flex items-center space-x-2 mb-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{tr('Loại đã chọn', 'Selected type')}</span>
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
          {tr('Tiếp tục — Core Idea & Angle', 'Continue — Core Idea & Angle')}
        </button>
      </div>
    </div>
  );
}

function SuggestionCard({
  s,
  isSelected,
  onSelect,
  groupBadge,
}: {
  s: ContentTypeSuggestion;
  isSelected: boolean;
  onSelect: (suggestion: ContentTypeSuggestion) => void;
  groupBadge: string;
}) {
  const { tr } = useI18n();
  return (
    <button
      onClick={() => onSelect(s)}
      className={`text-left p-4 rounded-2xl border-2 transition-all space-y-2.5 ${
        isSelected
          ? "border-slate-900 bg-slate-900/[0.02] ring-2 ring-slate-900 ring-offset-1 shadow-md"
          : "border-slate-200 bg-white hover:border-slate-400 hover:shadow-sm"
      }`}
    >
      {/* Wave + timeframe */}
      {(s.wave || s.timeframe) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {s.wave && (
            <span className={`text-[10px] font-bold border rounded-full px-2 py-0.5 ${groupBadge}`}>
              {s.wave}
            </span>
          )}
          {s.timeframe && (
            <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
              {displayTimeframe(s)}
            </span>
          )}
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-bold text-slate-800 leading-tight">{s.label}</div>
        {isSelected && <span className="shrink-0 text-[10px] font-bold text-slate-900">✓ {tr('Đã chọn', 'Selected')}</span>}
      </div>

      <div className="text-[11px] text-slate-600 leading-relaxed">{s.description}</div>

      {s.keywords && s.keywords.length > 0 && (
        <div className="pt-0.5 space-y-1">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Keywords · Action Plan</div>
          <div className="flex flex-wrap gap-1">
            {s.keywords.map((kw, i) => (
              <span
                key={i}
                className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2 py-0.5"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}
    </button>
  );
}
