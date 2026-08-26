import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, FileText, Plus, Sheet, Upload, X } from "lucide-react"
import type {
  AIModel,
  Article,
  ContentPlan,
  ContentPlanItem,
  ContentPlanSourceType,
} from "../types"
import {
  classifyContentPlan,
  fetchContentPlans,
  importContentPlan,
  updateContentPlanItem,
} from "../lib/contentPlans"
import { useI18n } from "../lib/i18n"
import BrandMark from "./BrandMark"

interface Props {
  railwayUrl: string
  models: AIModel[]
  modelId: string
  recentArticles: Article[]
  initialHistoryOpen?: boolean
  onOpenArticle: (id: string) => void
  onModelChange: (id: string) => void
  onCreate: (
    type: "comparison-seo" | "editorial-originality",
    plan: ContentPlan,
    items: ContentPlanItem[],
    batchSize?: 5 | 10 | 15 | 20,
  ) => Promise<void>
}
const quick = [
  { title: "Content Plan history", detail: "Open previous plans and versions" },
  { title: "Import a new plan", detail: "File, Google Docs or Sheets" },
]

export default function ActivityLauncher({
  railwayUrl,
  models,
  modelId,
  recentArticles,
  initialHistoryOpen,
  onOpenArticle,
  onModelChange,
  onCreate,
}: Props) {
  const { tr } = useI18n()
  const fileInput = useRef<HTMLInputElement>(null)
  const [plans, setPlans] = useState<ContentPlan[]>([])
  const [plan, setPlan] = useState<ContentPlan | null>(null)
  const [versionBase, setVersionBase] = useState<ContentPlan | null>(null)
  const [showHistory, setShowHistory] = useState(Boolean(initialHistoryOpen))
  const [sourceType, setSourceType] = useState<ContentPlanSourceType>("paste")
  const [content, setContent] = useState("")
  const [url, setUrl] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [menu, setMenu] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [category, setCategory] =
    useState<"comparison-seo" | "editorial-originality">("comparison-seo")
  const [busy, setBusy] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [analysisPhase, setAnalysisPhase] = useState<"upload" | "extract" | "classify" | "save">("upload")
  const [analysisName, setAnalysisName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    fetchContentPlans(railwayUrl)
      .then(setPlans)
      .catch(() => {})
  }, [railwayUrl])
  useEffect(() => {
    const open = () => setShowHistory(true)
    window.addEventListener("writer:open-plan-history", open)
    return () => window.removeEventListener("writer:open-plan-history", open)
  }, [])
  useEffect(() => {
    if (initialHistoryOpen) setShowHistory(true)
  }, [initialHistoryOpen])
  const visible = (plan?.items ?? []).filter((item) => item.type === category)
  const chosen = visible.filter((item) => selected.includes(item.id))
  const articleByPlanItem = new Map(
    recentArticles
      .filter((article) => article.contentPlanItemId || article.contentPlanSourceItemId)
      .map((article) => [article.contentPlanItemId ?? article.contentPlanSourceItemId, article]),
  )
  const chooseSource = (type: ContentPlanSourceType) => {
    setSourceType(type)
    setMenu(false)
    if (type === "file") fileInput.current?.click()
  }
  const submit = async () => {
    setBusy(true)
    setIsAnalyzing(true)
    setAnalysisProgress(6)
    setAnalysisPhase("upload")
    setError(null)
    let progressTimer: number | undefined
    let extractionTimer: number | undefined
    try {
      const name =
        file?.name?.replace(/\.[^.]+$/, "") ||
        versionBase?.name ||
        `Content Plan ${new Date().toLocaleDateString()}`
      setAnalysisName(file?.name || name)
      extractionTimer = window.setTimeout(() => {
        setAnalysisPhase("extract")
        setAnalysisProgress((value) => Math.max(value, 24))
      }, 900)
      progressTimer = window.setInterval(() => {
        setAnalysisProgress((value) => Math.min(value + (value < 45 ? 3 : 1), 88))
      }, 650)
      const imported = await importContentPlan(
        {
          name,
          sourceType,
          content: sourceType === "paste" ? content : undefined,
          url: sourceType.startsWith("google_") ? url : undefined,
          file: sourceType === "file" ? (file ?? undefined) : undefined,
          previousVersionId: versionBase?.id,
        },
        railwayUrl,
      )
      if (extractionTimer) window.clearTimeout(extractionTimer)
      setAnalysisPhase("extract")
      setAnalysisProgress((value) => Math.max(value, 38))
      await new Promise((resolve) => window.setTimeout(resolve, 120))
      setAnalysisPhase("classify")
      setAnalysisProgress((value) => Math.max(value, 52))
      const classified = await classifyContentPlan(imported.id, railwayUrl)
      setAnalysisPhase("save")
      setAnalysisProgress(96)
      setPlan(classified)
      setPlans((current) => [
        classified,
        ...current.filter((item) => item.id !== classified.id),
      ])
      setSelected([])
      setVersionBase(null)
      setAnalysisProgress(100)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (progressTimer) window.clearInterval(progressTimer)
      if (extractionTimer) window.clearTimeout(extractionTimer)
      setBusy(false)
      setIsAnalyzing(false)
    }
  }
  const move = async (item: ContentPlanItem, type: ContentPlanItem["type"]) => {
    if (!plan) return
    const updated = await updateContentPlanItem(
      plan.id,
      item.id,
      type,
      railwayUrl,
    )
    setPlan(updated)
    setSelected((current) => current.filter((id) => id !== item.id))
  }
  const generate = async () => {
    if (!plan || !chosen.length) return
    const target = chosen.slice(0, 20)
    setBusy(true)
    try {
      await onCreate(
        category,
        plan,
        target,
        target.length > 1
          ? ([5, 10, 15, 20].find(
              (size) => size >= target.length,
            ) as 5 | 10 | 15 | 20 ?? 20)
          : undefined,
      )
    } finally {
      setBusy(false)
    }
  }
  const canSubmit =
    sourceType === "file"
      ? Boolean(file)
      : sourceType === "paste"
        ? Boolean(content.trim())
        : Boolean(url.trim())

  return (
    <main className="relative flex-1 overflow-y-auto bg-[#171717] text-[#d8d8d8]">
      <div
        className={`mx-auto flex min-h-full max-w-[920px] flex-col px-5 ${
          plan ? "pb-44 pt-8" : "justify-center pb-52 pt-16"
        }`}
      >
        {!plan && !isAnalyzing && (
          <>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-[#2a2a2a] bg-[#1c1c1c]">
                <BrandMark className="h-7 w-7" />
              </div>
              <h1 className="mt-6 text-[27px] font-medium tracking-[-.02em] text-[#e8e8e8]">
                {tr("Bạn muốn tạo nội dung gì?", "What should we create?")}
              </h1>
              <p className="mt-2 text-sm text-[#737373]">
                {tr(
                  "Nhập Content Plan hoặc mở nhanh một workspace gần đây",
                  "Add a Content Plan or jump back into recent work",
                )}
              </p>
            </div>
            <div className="mx-auto mt-8 grid w-full max-w-[520px] grid-cols-1 gap-2 sm:grid-cols-2">
              {quick.map((item, index) => (
                <button
                  key={item.title}
                  onClick={() =>
                    index === 0 ? setShowHistory(true) : setMenu(true)
                  }
                  className="card-prompt flex h-28 flex-col justify-between rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-3 text-left transition-all hover:border-[#3a3a3a] hover:bg-[#222]"
                >
                  <div className="flex items-center justify-between text-[#777]">
                    <span className="text-[10px] font-medium">
                      Quick access
                    </span>
                    <ArrowRight className="app-icon" aria-hidden="true" />
                  </div>
                  <div className="mt-5 text-[12px] font-medium text-[#d0d0d0]">
                    {item.title}
                  </div>
                  <div className="mt-1 text-[10px] leading-relaxed text-[#686868]">
                    {item.detail}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
        {!plan && isAnalyzing && (
          <div className="mx-auto w-full max-w-[620px]">
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-[#343434] bg-[#202020]">
                <BrandMark className="h-7 w-7 animate-pulse" />
              </div>
              <h1 className="mt-5 text-xl font-medium text-[#e5e5e5]">
                {tr("Đang phân tích Content Plan", "Analyzing Content Plan")}
              </h1>
              <p className="mt-1 truncate text-xs text-[#777]">{analysisName}</p>
            </div>
            <div className="mt-7 rounded-2xl border border-[#303030] bg-[#1b1b1b] p-5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#b8b8b8]">
                  {{
                    upload: tr("Đang tải và kiểm tra tài liệu…", "Uploading and validating document…"),
                    extract: tr("Đã trích xuất nội dung, đang chuẩn hóa…", "Content extracted, normalizing…"),
                    classify: tr("AI đang phân loại các chủ đề…", "AI is classifying topics…"),
                    save: tr("Đang lưu kết quả vào Supabase…", "Saving results to Supabase…"),
                  }[analysisPhase]}
                </span>
                <span className="font-mono text-[#888]">{analysisProgress}%</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#292929]">
                <div
                  className="h-full rounded-full bg-[#d8d8d8] transition-[width] duration-500 ease-out"
                  style={{ width: `${analysisProgress}%` }}
                />
              </div>
              <div className="mt-5 grid grid-cols-4 gap-2">
                {[
                  ["upload", tr("Tải file", "Upload")],
                  ["extract", tr("Trích xuất", "Extract")],
                  ["classify", tr("Phân loại", "Classify")],
                  ["save", tr("Lưu dữ liệu", "Save")],
                ].map(([phase, label], index) => {
                  const phases = ["upload", "extract", "classify", "save"]
                  const activeIndex = phases.indexOf(analysisPhase)
                  const complete = index < activeIndex
                  const active = phase === analysisPhase
                  return (
                    <div key={phase} className="min-w-0 text-center">
                      <div className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full border text-[10px] ${complete ? "border-[#777] bg-[#dedede] text-[#171717]" : active ? "border-[#888] bg-[#292929] text-white animate-pulse" : "border-[#333] text-[#555]"}`}>
                        {complete ? "✓" : index + 1}
                      </div>
                      <div className={`mt-1 truncate text-[9px] ${active || complete ? "text-[#aaa]" : "text-[#555]"}`}>{label}</div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-5 space-y-2" aria-hidden="true">
                {["82%", "68%", "91%"].map((width) => (
                  <div key={width} className="h-9 animate-pulse rounded-lg border border-[#292929] bg-[#202020] p-3">
                    <div className="h-2 rounded bg-[#303030]" style={{ width }} />
                  </div>
                ))}
              </div>
              <p className="mt-4 text-center text-[10px] text-[#666]">
                {tr("Kết quả sẽ xuất hiện tự động ngay khi từng chủ đề được tổng hợp xong.", "Results will appear automatically as soon as the plan is ready.")}
              </p>
            </div>
          </div>
        )}
        {plan && (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <button
                  onClick={() => setPlan(null)}
                  className="mb-3 text-[11px] text-[#777] hover:text-white"
                >
                  <ArrowLeft className="app-icon mr-1 inline-flex" aria-hidden="true" /> New activity
                </button>
                <h1 className="text-xl font-medium text-[#e5e5e5]">
                  {plan.name}{" "}
                  <span className="text-[#707070]">· v{plan.version}</span>
                </h1>
                <p className="mt-1 text-xs text-[#6f6f6f]">
                  {plan.comparisonCount + plan.editorialCount} classified topics
                  · {plan.reviewCount} need review
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setVersionBase(plan)
                    setPlan(null)
                    setContent("")
                    setFile(null)
                    setUrl("")
                  }}
                  className="rounded-lg border border-[#343434] px-3 py-2 text-[11px] text-[#aaa] hover:bg-[#252525]"
                >
                  {tr("Phiên bản mới", "New version")}
                </button>
                <button
                  onClick={() => setShowHistory(true)}
                  className="rounded-lg border border-[#343434] px-3 py-2 text-[11px] text-[#aaa]"
                >
                  History
                </button>
              </div>
            </div>
            <div className="mt-7 flex items-center gap-1 border-b border-[#2b2b2b]">
              <button
                onClick={() => {
                  setCategory("comparison-seo")
                  setSelected([])
                }}
                className={`workspace-tab ${
                  category === "comparison-seo" ? "active" : ""
                }`}
              >
                Comparison / SEO <span>{plan.comparisonCount}</span>
              </button>
              <button
                onClick={() => {
                  setCategory("editorial-originality")
                  setSelected([])
                }}
                className={`workspace-tab ${
                  category === "editorial-originality" ? "active" : ""
                }`}
              >
                Editorial / Originality <span>{plan.editorialCount}</span>
              </button>
              <div className="ml-auto pb-2 text-[10px] text-[#666]">
                {selected.length}/20 selected
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              {visible.map((item) => (
                <div
                  key={item.id}
                  className={`group flex items-center gap-3 rounded-xl border px-3 py-3 ${
                    selected.includes(item.id)
                      ? "border-[#575757] bg-[#252525]"
                      : "border-[#292929] bg-[#1b1b1b] hover:bg-[#202020]"
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={articleByPlanItem.has(item.id)}
                    checked={selected.includes(item.id)}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(item.id)
                          ? current.filter((id) => id !== item.id)
                          : current.length < 20
                            ? [...current, item.id]
                            : current,
                      )
                    }
                    className="accent-white"
                  />
                  <button
                    onClick={() => {
                      const existing = articleByPlanItem.get(item.id)
                      if (existing) return onOpenArticle(existing.id)
                      setSelected((current) =>
                        current.includes(item.id)
                          ? current.filter((id) => id !== item.id)
                          : current.length < 20
                            ? [...current, item.id]
                            : current,
                      )
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-[13px] text-[#d8d8d8]">
                      {item.title}
                    </div>
                    <div className="mt-1 truncate text-[10px] text-[#686868]">
                      {Math.round((item.confidence ?? 0) * 100)}% ·{" "}
                      {item.classificationReason}
                    </div>
                  </button>
                  {articleByPlanItem.has(item.id) && (
                    <button
                      onClick={() => onOpenArticle(articleByPlanItem.get(item.id)!.id)}
                      className="rounded-md border border-[#3a3a3a] px-2 py-1 text-[9px] text-[#aaa] hover:bg-[#2b2b2b] hover:text-white"
                    >
                      {articleByPlanItem.get(item.id)?.status === 'done' ? tr('Đã hoàn tất', 'Completed') : tr('Tiếp tục', 'Continue')}
                    </button>
                  )}
                  <select
                    value={item.type}
                    onChange={(event) =>
                      move(item, event.target.value as ContentPlanItem["type"])
                    }
                    className="opacity-0 group-hover:opacity-100 rounded-md border border-[#3a3a3a] bg-[#252525] p-1 text-[9px]"
                  >
                    <option value="comparison-seo">Comparison/SEO</option>
                    <option value="editorial-originality">Editorial</option>
                    <option value="needs-review">Needs review</option>
                  </select>
                </div>
              ))}
            </div>
            {selected.length > 0 && (
              <div className="sticky bottom-2 mt-5 flex items-center justify-between rounded-xl border border-[#3a3a3a] bg-[#252525]/95 px-4 py-3 shadow-2xl backdrop-blur">
                <div className="text-xs text-[#aaa]">
                  {selected.length === 1
                    ? tr("Chạy thủ công workflow 3 bước", "Manual 3-step workflow")
                    : tr(
                        `Tự động tạo ${selected.length} bài`,
                        `Auto-generate ${selected.length} articles`,
                      )}
                </div>
                <button
                  disabled={busy}
                  onClick={generate}
                  className="rounded-lg bg-[#ededed] px-4 py-2 text-[11px] font-semibold text-[#171717] disabled:opacity-40"
                >
                  {busy
                    ? "…"
                    : selected.length === 1
                      ? tr("Bắt đầu", "Start")
                      : tr("Tạo tất cả", "Generate all")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {!plan && !isAnalyzing && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 md:left-64">
          <div className="pointer-events-auto mx-auto w-[calc(100%-24px)] max-w-[680px]">
            {versionBase && (
              <div className="mb-2 flex items-center justify-between rounded-xl border border-[#343434] bg-[#202020] px-3 py-2 text-[11px] text-[#aaa]">
                <span>{tr("Tạo phiên bản mới từ", "Creating a new version from")} <b className="text-[#ddd]">{versionBase.name} · v{versionBase.version}</b></span>
                <button onClick={() => setVersionBase(null)} className="text-[#777] hover:text-white">×</button>
              </div>
            )}
            {error && (
              <div className="mb-2 rounded-xl border border-red-900/50 bg-red-950/80 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
            {sourceType.startsWith("google_") && (
              <div className="mb-2 rounded-xl border border-[#333] bg-[#222] p-2">
                <input
                  autoFocus
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={
                    sourceType === "google_doc"
                      ? "Paste public Google Doc link"
                      : "Paste public Google Sheet link"
                  }
                  className="w-full bg-transparent px-2 py-2 text-xs outline-none"
                />
              </div>
            )}
            <div
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                const dropped = event.dataTransfer.files?.[0]
                if (dropped) {
                  setFile(dropped)
                  setSourceType("file")
                }
              }}
              className={`rounded-2xl border bg-[#292929] p-3 shadow-2xl ${
                dragging ? "border-[#777]" : "border-[#383838]"
              }`}
            >
              {file && (
                <div className="mb-2 inline-flex items-center gap-2 rounded-lg bg-[#353535] px-2.5 py-1.5 text-[10px] text-[#bbb]">
                  <FileText className="app-icon" aria-hidden="true" /> {file.name}
                  <button onClick={() => setFile(null)} className="text-[#777]">
                    <X className="app-icon" aria-hidden="true" />
                  </button>
                </div>
              )}
              <textarea
                value={content}
                onChange={(event) => {
                  setContent(event.target.value)
                  if (event.target.value) setSourceType("paste")
                }}
                rows={2}
                placeholder={tr(
                  "Nhập Content Plan hoặc kéo thả tài liệu vào đây…",
                  "Add a Content Plan or drop a document here…",
                )}
                className="composer-textarea block w-full resize-none bg-transparent text-[13px] text-[#e0e0e0] outline-none placeholder:text-[#777]"
              />
              <div className="mt-2 flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={() => setMenu((value) => !value)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-lg text-[#aaa] hover:bg-[#3a3a3a]"
                  >
                    <Plus className="app-icon" aria-hidden="true" />
                  </button>
                  {menu && (
                    <div className="absolute bottom-9 left-0 w-52 rounded-xl border border-[#3a3a3a] bg-[#252525] p-1.5 shadow-2xl">
                      <button
                        onClick={() => chooseSource("file")}
                        className="composer-menu"
                      >
                        <Upload className="app-icon" aria-hidden="true" /> Upload file
                      </button>
                      <button
                        onClick={() => chooseSource("google_doc")}
                        className="composer-menu"
                      >
                        <FileText className="app-icon" aria-hidden="true" /> Google Doc link
                      </button>
                      <button
                        onClick={() => chooseSource("google_sheet")}
                        className="composer-menu"
                      >
                        <Sheet className="app-icon" aria-hidden="true" /> Google Sheet link
                      </button>
                      <button
                        onClick={() => chooseSource("paste")}
                        className="composer-menu"
                      >
                        <FileText className="app-icon" aria-hidden="true" /> Direct input
                      </button>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.json"
                  className="hidden"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null)
                    setSourceType("file")
                  }}
                />
                <div className="ml-auto flex items-center gap-2">
                  <select
                    value={modelId}
                    onChange={(event) => onModelChange(event.target.value)}
                    className="max-w-44 bg-transparent text-[10px] text-[#aaa] outline-none"
                  >
                    {models
                      .filter((model) => model.enabled)
                      .map((model) => (
                        <option
                          className="bg-[#252525]"
                          key={model.id}
                          value={model.id}
                        >
                          {model.name}
                        </option>
                      ))}
                  </select>
                  <button
                    disabled={!canSubmit || busy}
                    onClick={submit}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ededed] text-[#171717] disabled:bg-[#444] disabled:text-[#777]"
                  >
                    {busy ? "…" : "↑"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {showHistory && (
        <div
          className="fixed inset-0 z-40 bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowHistory(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="mx-auto mt-16 max-h-[75dvh] max-w-xl overflow-y-auto rounded-2xl border border-[#353535] bg-[#202020] p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-white">
                Content Plan history
              </h2>
              <button
                onClick={() => setShowHistory(false)}
                className="text-[#777]"
              >
                ×
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {plans.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setPlan(item)
                    setShowHistory(false)
                    setSelected([])
                  }}
                  className="w-full rounded-xl border border-[#303030] bg-[#1b1b1b] p-3 text-left hover:bg-[#252525]"
                >
                  <div className="flex justify-between">
                    <span className="text-xs text-[#ddd]">{item.name}</span>
                    <span className="text-[10px] text-[#777]">
                      v{item.version}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-[#666]">
                    {item.totalArticles} articles · {item.comparisonCount} SEO ·{" "}
                    {item.editorialCount} Editorial
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
