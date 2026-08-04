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
import {
  collectStepDocs,
  buildDocContextBlock,
  buildRoleSystemPrompt,
  buildActionPlanFingerprint,
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

function normalizeGroup(v: unknown): ContentTypeGroup | undefined {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "A" || s === "B" || s === "C") return s;
  const m = s.match(/\b(A|B|C)\b/);
  return m ? (m[1] as ContentTypeGroup) : undefined;
}

function normalizeSuggestions(parsed: unknown, actionPlanNames: Set<string>): ContentTypeSuggestion[] {
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
      const typeGroup = normalizeGroup(obj.typeGroup ?? obj.type);
      const wave = String(obj.wave ?? "").trim();
      const timeframe = String(obj.timeframe ?? "").trim();
      const keywords = arr("keywords").map(keyword => keyword.trim()).filter(Boolean);
      const matchedDocs = arr("matchedDocs").map(name => name.trim()).filter(Boolean);
      const referencesActionPlan = matchedDocs.some(name => actionPlanNames.has(name.toLocaleLowerCase()));
      // A selectable suggestion must be traceable to one exact Action Plan slot.
      if (!typeGroup || !wave || !timeframe || !keywords.length || !referencesActionPlan) return null;
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
        matchedDocs,
        ruleRefs: arr("ruleRefs"),
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

  const bundle = useMemo(() => collectStepDocs(1, config, files), [config, files]);
  const contextBlock = useMemo(() => buildDocContextBlock(bundle), [bundle]);
  const sourceFingerprint = useMemo(() => buildActionPlanFingerprint(bundle), [bundle]);
  const scanIsStale = Boolean(
    suggestions.length && article.contentTypeSourceFingerprint !== sourceFingerprint,
  );

  // Group suggestions by Type A/B/C; anything without a group falls to "other".
  const grouped = useMemo(() => {
    const byGroup: Record<ContentTypeGroup, ContentTypeSuggestion[]> = { A: [], B: [], C: [] };
    const other: ContentTypeSuggestion[] = [];
    suggestions.forEach(s => {
      if (s.typeGroup && byGroup[s.typeGroup]) byGroup[s.typeGroup].push(s);
      else other.push(s);
    });
    return { byGroup, other };
  }, [suggestions]);

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
          "Tổng hợp CHÍNH XÁC các loại nội dung (Content Type) từ Action Plan và phân loại theo 3 nhóm chính: Type A, Type B, Type C.",
          "",
          "QUY TẮC PHÂN LOẠI (bắt buộc):",
          "- Mỗi Content Type PHẢI được gán đúng typeGroup (A/B/C) theo cách Action Plan phân loại. Không tự bịa nhóm.",
          "- Mỗi loại thuộc một WAVE (đợt triển khai) gắn với một MỐC THỜI GIAN cụ thể (timeframe) — trích đúng từ Action Plan.",
          "- Mỗi loại gắn với đúng bộ keywords mà Action Plan chỉ định cho loại/wave đó. Trích nguyên văn, không thêm bớt từ khóa không có trong tài liệu.",
          "- Chỉ trả về lựa chọn có đủ nhóm + wave + timeframe + ít nhất 1 keyword. Bỏ qua mục thiếu dữ liệu thay vì suy đoán.",
          "- matchedDocs phải chứa chính xác tên của ít nhất một tài liệu Action Plan làm căn cứ cho lựa chọn.",
          "",
          "NGUYÊN TẮC QUÉT DỮ LIỆU:",
          "- Đọc kỹ toàn bộ Action Plan (là nguồn phân loại cơ bản). Action Plan được cập nhật định kỳ mỗi 3 tháng — luôn phản ánh đúng nội dung file hiện tại, không dùng dữ liệu cũ ghi nhớ.",
          "- Dùng Knowledge Base để mô tả chủ đề/độ sâu. Kiểm chứng với Rules & Guidelines (ghi ở ruleRefs).",
          "",
          "Trả về DUY NHẤT một mảng JSON hợp lệ, không kèm markdown fences hay text giải thích.",
          "Mỗi phần tử schema:",
          `{ "label": string (tên loại nội dung), "typeGroup": "A" | "B" | "C", "wave": string (tên/số wave, VD "Wave 1"), "timeframe": string (mốc thời gian, VD "Q1 2026" hoặc "Tháng 1-3"), "description": string (2-3 câu: định dạng, mục đích, giá trị), "keywords": string[] (bộ từ khóa Action Plan gán cho loại này — trích đúng), "matchedDocs": string[] (tên tài liệu KB/Action đã dùng — nội bộ), "ruleRefs": string[] (tên rule áp dụng — nội bộ) }`,
        ].join("\n"),
      );

      const prompt = [
        `TÀI LIỆU ĐƯỢC PHÂN QUYỀN ĐỌC Ở STEP 1 (${describeBundle(bundle)}):`,
        contextBlock,
        "",
        "Yêu cầu: Tổng hợp các loại nội dung từ Action Plan, phân loại đúng Type A/B/C, gán đúng wave + mốc thời gian + keywords cho từng loại.",
        "Chỉ trả về JSON array — không markdown, không giải thích, không text thừa.",
      ].join("\n");

      const res = await callAI({ model, railwayUrl, prompt, systemPrompt });
      const parsed = extractJson(res.content);
      const actionPlanNames = new Set(bundle.actionPlan.map(doc => doc.name.toLocaleLowerCase()));
      const normalized = normalizeSuggestions(parsed, actionPlanNames);
      if (!normalized.length) {
        throw new Error("AI không trả về lựa chọn có đủ Type, Wave, mốc thời gian và keywords theo Action Plan.");
      }
      onUpdate({
        contentTypeSuggestions: normalized,
        contentTypeSourceFingerprint: sourceFingerprint,
        contentTypeScannedAt: new Date().toISOString(),
        contentType: undefined,
        selectedContentTypeSuggestionId: undefined,
      });
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
    if (autoRequestedRef.current === sourceFingerprint) return;
    if (!bundle.totalCount) return;
    if (suggestions.length > 0 && !scanIsStale) return;
    autoRequestedRef.current = sourceFingerprint;
    fetchSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.totalCount, suggestions.length, scanIsStale, sourceFingerprint]);

  const handleSelect = (suggestion: ContentTypeSuggestion) => onUpdate({
    contentType: suggestion.label,
    selectedContentTypeSuggestionId: suggestion.id,
  });

  const handleUseCustom = () => {
    const trimmed = customLabel.trim();
    if (!trimmed) return;
    onUpdate({ contentType: trimmed });
    setCustomLabel("");
  };

  const selectedSuggestion = suggestions.find(s =>
    s.id === article.selectedContentTypeSuggestionId ||
    (!article.selectedContentTypeSuggestionId && s.label === selected),
  );

  return (
    <div className="h-full flex flex-col gap-4 animate-fade-in-up">
      <div className="bg-[#ebedf3] rounded-3xl p-1.5 shadow-sm border border-slate-200/60 flex-1 flex flex-col min-h-0">
        <div className="bg-white rounded-2xl p-6 flex-1 overflow-y-auto shadow-sm">
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-800 mb-1">Step 1 — Content Type</h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  AI tổng hợp Content Type từ Action Plan, phân theo <b>Type A / B / C</b> — mỗi loại gắn wave, mốc thời gian và bộ keyword riêng. Chọn 1 để sang Step 2.
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

            {article.contentTypeScannedAt && !loading && (
              <div className={`rounded-xl border px-3 py-2 text-[11px] ${
                scanIsStale
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700"
              }`}>
                {scanIsStale
                  ? "Action Plan đã thay đổi — AI đang cần quét lại dữ liệu quý mới."
                  : `Đã quét Action Plan lúc ${new Date(article.contentTypeScannedAt).toLocaleString("vi-VN")}.`}
              </div>
            )}

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
              <div className="space-y-5">
                {GROUP_ORDER.map(g => {
                  const items = grouped.byGroup[g];
                  if (!items.length) return null;
                  const meta = GROUP_META[g];
                  const waves = Object.entries(
                    items.reduce<Record<string, ContentTypeSuggestion[]>>((acc, item) => {
                      const key = `${item.wave}|||${item.timeframe}`;
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
                      <span className="text-xs font-bold text-slate-600">Chưa phân nhóm</span>
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
              {s.timeframe}
            </span>
          )}
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-bold text-slate-800 leading-tight">{s.label}</div>
        {isSelected && <span className="shrink-0 text-[10px] font-bold text-slate-900">✓ Đã chọn</span>}
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
