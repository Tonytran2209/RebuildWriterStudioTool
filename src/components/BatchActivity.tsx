import { useState } from "react"
import { CircleAlert, CircleCheck, Download, LoaderCircle, Pause, Play } from "lucide-react"
import type { Article } from "../types"
import { useI18n } from "../lib/i18n"
import { buildBatchZip } from "../lib/zipExport"

interface Props { articles: Article[]; onOpen: (id: string) => void; onStart: () => Promise<void>; onPause: () => Promise<void>; onRetry: (id: string) => Promise<void> }

function completedStages(article: Article) {
  if (article.draft?.trim() || article.batchStatus === "completed") return 3
  if (article.outline?.length) return 2
  if (article.coreIdeaSuggestions?.length) return 1
  return 0
}

function articleProgress(article: Article) {
  const done = completedStages(article)
  if (done === 3) return 100
  return Math.round(((done + (article.batchStatus === "running" ? 0.35 : 0)) / 3) * 100)
}

function download(article: Article) {
  const blob = new Blob([article.draft ?? ""], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${(article.topic || article.title).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "article"}.md`
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function BatchActivity({ articles, onOpen, onStart, onPause, onRetry }: Props) {
  const { tr } = useI18n()
  const [action, setAction] = useState<string | null>(null)
  const complete = articles.filter((article) => article.batchStatus === "completed" || article.draft?.trim()).length
  const failed = articles.filter((article) => article.batchStatus === "failed").length
  const running = articles.some((article) => article.batchStatus === "running")
  const paused = !running && articles.some((article) => article.batchStatus === "paused")
  const progress = articles.length ? Math.round(articles.reduce((sum, article) => sum + articleProgress(article), 0) / articles.length) : 0
  const usage = articles.flatMap((article) => Object.values(article.aiUsageByStep ?? {}).flat())
  const totalTokens = usage.reduce((sum, call) => sum + call.totalTokens, 0)
  const knownCost = usage.reduce((sum, call) => sum + Number(call.costUsd ?? 0), 0)
  const hasUnknownCost = usage.some((call) => call.costUsd == null)
  const act = async (name: string, callback: () => Promise<void>) => { setAction(name); try { await callback() } finally { setAction(null) } }
  const downloadAll = () => { const blob = buildBatchZip(articles); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `comparison-seo-${articles[0]?.activityId ?? "batch"}.zip`; anchor.click(); URL.revokeObjectURL(url) }

  return (
    <main className="flex-1 overflow-y-auto bg-[#141414] p-4 md:p-6"><div className="mx-auto max-w-5xl space-y-4">
      <section className="rounded-2xl border border-[#2b2b2b] bg-[#1b1b1b] p-5">
        <div className="text-[10px] font-medium uppercase tracking-[.18em] text-[#8b8b8b]">Comparison / SEO batch</div>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h1 className="text-xl font-medium text-[#e5e5e5]">{complete}/{articles.length} {tr("bài hoàn tất", "articles completed")}</h1><p className="mt-1 text-xs text-[#858585]">{progress}% · {totalTokens.toLocaleString()} tokens · ${knownCost.toFixed(4)}{hasUnknownCost ? "+" : ""} · {failed} {tr("lỗi", "failed")}</p></div>
          <div className="flex flex-wrap gap-2">
            {running ? <button disabled={Boolean(action)} onClick={() => act("pause", onPause)} className="inline-flex items-center gap-2 rounded-lg border border-[#3a3a3a] px-3 py-2 text-xs text-[#d0d0d0] hover:bg-[#252525]"><Pause className="app-icon" />{action === "pause" ? "…" : tr("Tạm dừng", "Pause")}</button> : complete < articles.length && <button disabled={Boolean(action)} onClick={() => act("start", onStart)} className="inline-flex items-center gap-2 rounded-lg bg-[#dedede] px-3 py-2 text-xs font-medium text-[#171717] hover:bg-white"><Play className="app-icon" />{action === "start" ? "…" : paused ? tr("Tiếp tục", "Resume") : tr("Chạy batch", "Run batch")}</button>}
            <button disabled={!complete} onClick={downloadAll} className="inline-flex items-center gap-2 rounded-lg border border-[#3a3a3a] px-3 py-2 text-xs text-[#d0d0d0] hover:bg-[#252525] disabled:opacity-35"><Download className="app-icon" />{tr("Tải ZIP", "Download ZIP")}</button>
          </div>
        </div>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#292929]"><div className="h-full rounded-full bg-[#d8d8d8] transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} /></div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">{articles.map((article, index) => {
        const status = article.batchStatus ?? "queued"
        const stage = Math.min(3, Math.max(1, completedStages(article) + (status === "running" ? 1 : 0)))
        const itemProgress = articleProgress(article)
        return <article key={article.id} className="rounded-xl border border-[#2b2b2b] bg-[#1b1b1b] p-4">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-[10px] font-medium uppercase tracking-[.08em] text-[#858585]">#{index + 1} · {status} · Step {stage}/3</div><h2 className="mt-2 line-clamp-2 text-sm font-medium text-[#dedede]">{article.topic || article.title}</h2></div>
            {status === "completed" || article.draft?.trim() ? <CircleCheck className="app-icon shrink-0 text-emerald-400" aria-label={tr("Hoàn tất", "Completed")} /> : status === "failed" ? <CircleAlert className="app-icon shrink-0 text-red-400" aria-label={tr("Lỗi", "Failed")} /> : status === "running" ? <LoaderCircle className="app-icon shrink-0 animate-spin text-[#c8c8c8]" aria-label={tr("Đang tạo", "Generating")} /> : <span className="h-4 w-4 shrink-0 rounded-full border border-[#555]" aria-label={tr("Đang chờ", "Queued")} />}
          </div>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-[#292929]"><div className="h-full bg-[#aaa] transition-[width] duration-500" style={{ width: `${itemProgress}%` }} /></div>
          {article.batchError && <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/20 p-2 text-[10px] text-red-300">{article.batchError}</div>}
          <div className="mt-4 flex gap-2"><button onClick={() => onOpen(article.id)} className="flex-1 rounded-lg bg-[#dedede] px-3 py-2 text-[11px] font-medium text-[#171717] hover:bg-white">{tr("Mở pipeline", "Open pipeline")}</button>{status === "failed" && <button disabled={Boolean(action)} onClick={() => act(article.id, () => onRetry(article.id))} className="rounded-lg border border-red-900/60 px-3 py-2 text-[11px] text-red-300">{tr("Thử lại", "Retry")}</button>}<button disabled={!article.draft?.trim()} onClick={() => download(article)} className="rounded-lg border border-[#343434] px-3 py-2 text-[11px] text-[#aaa] hover:bg-[#252525] disabled:opacity-30">{tr("Tải bài", "Download")}</button></div>
        </article>
      })}</div>
    </div></main>
  )
}
