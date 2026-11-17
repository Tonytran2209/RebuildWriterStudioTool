import { useEffect, useState, type ReactNode } from "react"
import type { AICallUsage, Article, BatchStepRun } from "../types"
import { useI18n } from "../lib/i18n"
import { I } from "./ui"

type Step = 2 | 3 | 4
type Key = BatchStepRun["key"]
type State = "pending" | "running" | "completed" | "failed"

/** Sub-jobs of the batch runner under each manual-mode step, in pipeline order. */
const RUN_KEYS: Record<Step, Key[]> = { 2: ["plan", "seo", "spec"], 3: ["outline"], 4: ["draft", "quality"] }
const LABELS: Record<Key, [string, string]> = {
  plan: ["Nhận bài từ Content Plan", "Take the article from the Content Plan"],
  seo: ["Nghiên cứu từ khóa SEO", "Research SEO keywords"],
  spec: ["Tạo Article Spec & Core Ideas", "Generate the Article Spec & Core Ideas"],
  outline: ["Lập outline", "Write the outline"],
  draft: ["Viết draft", "Write the draft"],
  quality: ["Kiểm tra chất lượng (SEO, Universal QC)", "Quality check (SEO, Universal QC)"],
}
const ICON: Record<State, string> = { running: "loader-2", completed: "circle-check", failed: "circle-x", pending: "circle-dashed" }
const COLOR: Record<State, string> = { running: "var(--accent)", completed: "var(--c-green)", failed: "var(--danger)", pending: "var(--f4)" }

const dur = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s` }
const tok = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n)
const usd = (calls: AICallUsage[]) => { const cost = calls.reduce((n, c) => n + Number(c.costUsd ?? 0), 0), unknown = calls.some(c => c.costUsd == null); return unknown && !cost ? "$ N/A" : `$${cost.toFixed(cost < 0.1 ? 3 : 2)}${unknown ? "+" : ""}` }
/** Compact usage line: "4 AI · 50.3k tok · $0.079". */
export const usageLine = (calls: AICallUsage[]) => `${calls.length} AI · ${tok(calls.reduce((n, c) => n + Number(c.totalTokens ?? 0), 0))} tok · ${usd(calls)}`
const words = (text?: string) => (text ?? "").split(/\s+/).filter(Boolean).length
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

/** One box per manual-mode step: the process checklist with its AI journal, inputs, outputs, rules and documents. */
export default function StepLog({ article: a, step }: { article: Article; step: Step }) {
  const { tr } = useI18n()
  const runs = a.batchStepRuns ?? []
  const busy = a.batchStatus === "running" || a.batchStatus === "queued"
  const live = busy && runs.some(r => r.status === "running" && RUN_KEYS[step].includes(r.key))
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!live) return; setNow(Date.now()); const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [live])

  const ideas = a.coreIdeaSuggestions ?? []
  const hasOutput: Record<Key, boolean> = { plan: ideas.length > 0, seo: ideas.length > 0 || Boolean(a.seoResearch), spec: ideas.length > 0, outline: Boolean(a.outline?.length), draft: Boolean(a.draft?.trim()), quality: Boolean(a.qualityReport) }
  const calls = [...(a.aiUsageByStep?.[step] ?? [])].sort((x, y) => x.calledAt.localeCompare(y.calledAt))
  const at = (iso?: string | null) => iso ? Date.parse(iso) : NaN
  const rows = RUN_KEYS[step].map(key => {
    const run = runs.find(r => r.key === key)
    // A run still marked running after the batch stopped was interrupted.
    const state: State = !run ? (hasOutput[key] ? "completed" : "pending") : run.status === "running" && !busy ? "failed" : run.status
    const end = run?.endedAt ? at(run.endedAt) : now
    const mine = run ? calls.filter(c => at(c.calledAt) >= at(run.startedAt) && at(c.calledAt) <= end + 3000) : []
    return { key, run, state, calls: mine }
  })
  const matched = new Set(rows.flatMap(r => r.calls.map(c => c.id)))
  const earlier = calls.filter(c => !matched.has(c.id))
  const trace = (step === 2 ? a.step2ProcessTrace : step === 3 ? a.step3ProcessTrace : a.step4ProcessTrace) ?? []
  const done = rows.filter(r => r.state === "completed").length
  const current = rows.find(r => r.state === "running")
  const failed = a.batchStatus === "failed" && a.batchError && rows.some(r => r.state === "failed")

  return <details className="box plog" open={live || undefined} style={{ margin: "8px 0 4px" }}>
    <summary style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", cursor: "pointer", listStyle: "none", color: "var(--f2)" }}>
      <I n={live ? "loader-2" : "list-check"} s={live ? { color: "var(--accent)" } : undefined} />
      <span className="grow">{tr("Checklist xử lý", "Process checklist")}</span>
      {calls.length > 0 && <span className="plog-meta">{usageLine(calls)}</span>}
      <span className={`tag t-${live ? "blue" : failed ? "red" : done === rows.length ? "green" : "gray"}`}>{live ? tr("Đang chạy", "Running") : `${done}/${rows.length}`}</span>
      <I n="chevron-down" />
    </summary>
    {current?.run && live && <div className="plog-live" role="status"><I n="loader-2" /><span className="grow">{tr("Đang chạy", "Running")}: {tr(...LABELS[current.key])}</span><span className="plog-meta" style={{ color: "inherit" }}>{dur(now - at(current.run.startedAt))}</span></div>}
    {rows.map((r, i) => r.state === "pending"
      ? <div key={r.key} className="plog-row plog-in" style={{ animationDelay: `${i * 70}ms`, display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", color: "var(--f3)" }}><I n={ICON.pending} s={{ color: COLOR.pending }} /><span className="grow">{tr(...LABELS[r.key])}<span className="sr-only"> · pending</span></span></div>
      : <details key={r.key} className="plog-row plog-in" style={{ animationDelay: `${i * 70}ms` }} aria-current={r.state === "running" ? "step" : undefined}>
        <summary>
          <I n={ICON[r.state]} s={{ color: COLOR[r.state] }} />
          <span className="grow" style={{ minWidth: 0 }}>{tr(...LABELS[r.key])}<span className="sr-only"> · {r.state}</span>{r.state !== "running" && <span style={{ color: "var(--f3)" }}> · {summaryOf(a, r.key, tr)}</span>}</span>
          {r.calls.length > 0 && <span className="plog-meta">{usageLine(r.calls)}</span>}
          {r.run && <span className="plog-meta">{dur((r.run.endedAt ? at(r.run.endedAt) : now) - at(r.run.startedAt))}</span>}
          <I n="chevron-down" s={{ color: "var(--f4)" }} />
        </summary>
        <div className="plog-body">
          <Output a={a} k={r.key} />
          <div className="plog-tl" aria-label={tr("Nhật ký AI", "AI journal")}>
            {r.run && <div><span className="t">{clock(r.run.startedAt)}</span>{tr("Bắt đầu", "Started")}</div>}
            {r.calls.map(c => <Call key={c.id} c={c} start={r.run ? at(r.run.startedAt) : NaN} />)}
            {r.state === "running" && r.run && <div style={{ color: "var(--accent)" }}><span className="t">+{dur(now - at(r.run.startedAt))}</span><I n="loader-2" /> {tr("AI đang xử lý…", "AI is working…")}</div>}
            {r.run?.endedAt && <div style={{ color: r.state === "failed" ? "var(--danger)" : undefined }}><span className="t">{clock(r.run.endedAt)}</span>{r.state === "failed" ? (a.batchError || tr("Không hoàn tất", "Did not finish")) : tr("Hoàn thành", "Completed")}</div>}
            {!r.run && <div style={{ color: "var(--f3)" }}>{tr("Đã xong ở lượt chạy trước; không có nhật ký thời gian.", "Finished in an earlier run; no timed journal.")}</div>}
          </div>
        </div>
      </details>)}
    {failed && <div className="plog-row" role="alert" style={{ display: "flex", gap: 8, padding: "9px 12px", color: "var(--danger)" }}><I n="alert-triangle" />{a.batchError}</div>}
    {earlier.length > 0 && <details className="plog-row"><summary><I n="history" s={{ color: "var(--f3)" }} /><span className="grow" style={{ color: "var(--f2)" }}>{tr("Lượt gọi AI trước đó", "Earlier AI calls")}</span><span className="plog-meta">{usageLine(earlier)}</span><I n="chevron-down" s={{ color: "var(--f4)" }} /></summary>
      <div className="plog-body"><div className="plog-tl">{earlier.map(c => <Call key={c.id} c={c} start={NaN} />)}</div></div></details>}
    {trace.length > 0 && <details className="plog-row"><summary><I n="notes" s={{ color: "var(--f3)" }} /><span className="grow" style={{ color: "var(--f2)" }}>{tr("Nhật ký AI (bản cũ)", "AI log (legacy)")}</span><I n="chevron-down" s={{ color: "var(--f4)" }} /></summary>
      <div className="plog-body"><div className="plog-tl">{trace.map(e => <div key={e.id}><b style={{ fontWeight: 500 }}>{e.title}</b> <span className={`tag t-${e.status === "completed" ? "green" : e.status === "warning" ? "orange" : "red"}`}>{e.stage}</span>{e.detail && <div style={{ color: "var(--f3)", whiteSpace: "pre-wrap" }}>{e.detail}</div>}{e.facts && <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>{Object.entries(e.facts).map(([k, v]) => <span key={k} className="rchip">{k}: {String(v ?? "n/a")}</span>)}</div>}</div>)}</div></div></details>}
  </details>
}

function Call({ c, start }: { c: AICallUsage; start: number }) {
  const { tr } = useI18n()
  const offset = Number.isFinite(start) ? `+${dur(Date.parse(c.calledAt) - start)}` : clock(c.calledAt)
  const kv = (label: string, value: ReactNode) => <><dt>{label}</dt><dd>{value}</dd></>
  const list = (items?: string[]) => items?.length ? <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{items.map(x => <span key={x} className="rchip">{x}</span>)}</span> : <span style={{ color: "var(--f4)" }}>—</span>
  return <details className="plog-call plog-in">
    <summary><span className="t" style={{ color: "var(--f4)", fontVariantNumeric: "tabular-nums" }}>{offset}</span><span className="tag t-gray">{c.purpose || "generation"}</span><span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.model}</span>
      <span className="plog-meta">{tok(c.totalTokens)} tok · {c.cacheHit ? "cache" : c.costUsd == null ? "$ N/A" : `$${c.costUsd.toFixed(4)}`}{c.durationMs ? ` · ${dur(c.durationMs)}` : ""}</span><I n="chevron-down" s={{ color: "var(--f4)" }} />
    </summary>
    <dl className="plog-kv" style={{ margin: 0 }}>
      {kv("Input", c.trace?.input || <span style={{ color: "var(--f4)" }}>{tr("Chưa ghi (lượt chạy trước bản cập nhật này)", "Not recorded (run predates this update)")}</span>)}
      {kv("Output", c.trace?.output || <span style={{ color: "var(--f4)" }}>—</span>)}
      {kv(tr("Tài liệu", "Documents"), list(c.trace?.sources))}
      {kv("Rules", list(c.trace?.rules))}
      {kv("Tokens", `In ${c.inputTokens.toLocaleString()}${c.cachedInputTokens ? ` (${c.cachedInputTokens.toLocaleString()} cached)` : ""} · Out ${c.outputTokens.toLocaleString()}`)}
    </dl>
  </details>
}

function summaryOf(a: Article, k: Key, tr: (vi: string, en: string) => string): string {
  const qc = a.qualityReport?.checks ?? []
  const pick = a.coreIdeaSuggestions?.find(x => x.id === a.selectedCoreIdeaId)
  switch (k) {
    case "plan": return a.contentPlanInput ? tr("từ Content Plan", "from the Content Plan") : tr("bài lẻ", "single article")
    case "seo": return a.seoResearch?.keywords?.length ? `${a.seoResearch.keywords.length} keywords` : "—"
    case "spec": return ideas(a) ? `${ideas(a)} ${tr("ý tưởng", "ideas")}${pick ? ` · ${(pick.rating?.overall ?? 0).toFixed(1)}` : ""}` : "—"
    case "outline": return a.outline?.length ? `${a.outline.filter(s => s.level === "h2").length} H2 · ${a.outline.length} ${tr("mục", "sections")}` : "—"
    case "draft": return a.draft?.trim() ? `${words(a.draft).toLocaleString()} ${tr("từ", "words")}` : "—"
    case "quality": return qc.length ? `QC ${qc.filter(c => c.status === "pass").length}/${qc.length}` : "—"
  }
}
const ideas = (a: Article) => a.coreIdeaSuggestions?.length ?? 0

/** What the sub-step produced, from the saved article. */
function Output({ a, k }: { a: Article; k: Key }) {
  const { tr } = useI18n()
  const row = (children: ReactNode) => <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}><span style={{ color: "var(--f3)", marginRight: 4 }}>{tr("Kết quả", "Output")}:</span>{children}</div>
  if (k === "plan") return row(<><span className="rchip">{a.topic || a.title}</span>{a.outlineStructure && <span className="rchip"><I n="list-tree" />{a.outlineStructure.name}</span>}</>)
  if (k === "seo") return a.seoResearch?.keywords?.length ? row(a.seoResearch.keywords.slice(0, 12).map((x: any, i: number) => <span key={i} className="rchip">{x.keyword ?? String(x)}</span>)) : null
  if (k === "spec") { const pick = a.coreIdeaSuggestions?.find(x => x.id === a.selectedCoreIdeaId); return pick ? row(<><span className="tag t-green">{tr("đã chọn", "selected")}</span><span>{pick.title}</span>{a.articleSpec && <span className="rchip"><I n="key" />{a.articleSpec.primaryQuery} · {a.articleSpec.primaryIntent}</span>}</>) : null }
  if (k === "outline") return a.outline?.length ? row(a.outline.filter(s => s.level === "h2").slice(0, 8).map(s => <span key={s.id} className="rchip">{s.heading}</span>)) : null
  if (k === "draft") return a.draft?.trim() ? row(<><span className="rchip">{words(a.draft).toLocaleString()} {tr("từ", "words")}</span><span className="rchip">{(a.draft.match(/^## /gm) ?? []).length} H2</span></>) : null
  const qc = a.qualityReport?.checks ?? []
  if (!qc.length) return null
  const n = (s: string) => qc.filter(c => c.status === s).length
  return row(<><span className="tag t-green">{n("pass")} pass</span>{n("warning") > 0 && <span className="tag t-orange">{n("warning")} warning</span>}{n("fail") > 0 && <span className="tag t-red">{n("fail")} fail</span>}{qc.filter(c => c.status === "fail").slice(0, 4).map(c => <span key={c.id} className="rchip">{c.label}</span>)}</>)
}
