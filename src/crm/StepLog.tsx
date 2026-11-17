import { useEffect, useState } from "react"
import type { Article, BatchStepRun } from "../types"
import { useI18n } from "../lib/i18n"
import { I } from "./ui"

type Props = { article: Article; step: 2 | 3 | 4 }

/** Sub-jobs of the batch runner shown under each manual-mode step, in pipeline order. */
const RUN_KEYS: Record<2 | 3 | 4, BatchStepRun["key"][]> = { 2: ["plan", "seo", "spec"], 3: ["outline"], 4: ["draft", "quality"] }
const LABELS: Record<BatchStepRun["key"], [string, string]> = {
  plan: ["Nhận bài từ Content Plan", "Take the article from the Content Plan"],
  seo: ["Nghiên cứu từ khóa SEO", "Research SEO keywords"],
  spec: ["Tạo Article Spec & Core Ideas", "Generate the Article Spec & Core Ideas"],
  outline: ["Lập outline", "Write the outline"],
  draft: ["Viết draft", "Write the draft"],
  quality: ["Kiểm tra chất lượng (SEO, Universal QC)", "Quality check (SEO, Universal QC)"],
}
const ICON = { running: "loader-2", completed: "circle-check", failed: "circle-x", pending: "circle-dashed" } as const
const COLOR = { running: "var(--accent)", completed: "var(--c-green)", failed: "var(--danger)", pending: "var(--f4)" } as const

const dur = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s` }

/** Demo-style "Checklist xử lý" + "AI log" for one step, from what the pipeline saved on the article. */
export default function StepLog({ article: a, step }: Props) {
  const { tr, language } = useI18n()
  const runs = a.batchStepRuns ?? []
  const live = runs.some(r => r.status === "running") && (a.batchStatus === "running" || a.batchStatus === "queued")
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!live) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [live])

  const ideas = Boolean(a.coreIdeaSuggestions?.length)
  const hasOutput: Record<BatchStepRun["key"], boolean> = { plan: ideas, seo: ideas, spec: ideas, outline: Boolean(a.outline?.length), draft: Boolean(a.draft?.trim()), quality: Boolean(a.qualityReport) }
  const checklist = RUN_KEYS[step].map(key => {
    const run = runs.find(r => r.key === key)
    // A resumed attempt records only the steps it ran; earlier output still counts as done.
    const state: keyof typeof ICON = !run ? (hasOutput[key] ? "completed" : "pending") : run.status === "running" && !live ? "failed" : run.status
    return { key, run, state }
  })
  const usage = a.aiUsageByStep?.[step] ?? []
  const trace = (step === 2 ? a.step2ProcessTrace : step === 3 ? a.step3ProcessTrace : a.step4ProcessTrace) ?? []
  const tokens = usage.reduce((n, u) => n + Number(u.totalTokens ?? 0), 0)
  const cost = usage.reduce((n, u) => n + Number(u.costUsd ?? 0), 0)
  const unknownCost = usage.some(u => u.costUsd == null)
  const done = checklist.filter(c => c.state === "completed").length
  const summary = (icon: string, label: string, meta: string) => <summary style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", listStyle: "none", color: "var(--f2)" }}>
    <I n={icon} /><span className="grow">{label}</span><span style={{ color: "var(--f3)", fontSize: 12 }}>{meta}</span><I n="chevron-down" />
  </summary>

  return <div style={{ display: "grid", gap: 6, margin: "8px 0 4px" }}>
    <details className="box">
      {summary("list-check", tr("Checklist xử lý", "Process checklist"), runs.length || done ? `${done}/${checklist.length}` : tr("Chưa có lượt chạy", "No runs yet"))}
      {checklist.map(({ key, run, state }) => <div key={key} className="box-row" aria-current={state === "running" ? "step" : undefined}>
        <span style={{ color: COLOR[state] }}><I n={ICON[state]} /></span>
        <span className="grow" style={{ color: state === "pending" ? "var(--f3)" : "var(--f1)" }}>{tr(...LABELS[key])}<span className="sr-only"> · {state}</span></span>
        {run && <span style={{ color: "var(--f3)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{dur((run.endedAt ? Date.parse(run.endedAt) : now) - Date.parse(run.startedAt))}</span>}
      </div>)}
      {a.batchStatus === "failed" && a.batchError && checklist.some(c => c.state === "failed") && <div className="box-row" role="alert" style={{ color: "var(--danger)" }}><I n="alert-triangle" />{a.batchError}</div>}
    </details>
    <details className="box">
      {summary("terminal-2", tr("AI log", "AI log"), usage.length ? `${usage.length} AI calls · ${tokens.toLocaleString()} tokens · ${unknownCost ? (cost ? `$${cost.toFixed(4)} +` : "USD N/A") : `$${cost.toFixed(4)}`}` : tr("Chưa có lượt gọi AI", "No AI calls yet"))}
      {trace.map((e, i) => <div key={e.id} className="box-row" style={{ alignItems: "flex-start" }}>
        <span className={`tag t-${e.status === "completed" ? "green" : e.status === "warning" ? "orange" : "red"}`}>{i + 1}</span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div><b style={{ fontWeight: 500 }}>{e.title}</b> <span className="tag t-gray">{e.stage}</span></div>
          {e.detail && <div style={{ color: "var(--f3)", whiteSpace: "pre-wrap", marginTop: 2 }}>{e.detail}</div>}
          {e.facts && <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>{Object.entries(e.facts).map(([k, v]) => <span key={k} className="rchip">{k}: {String(v ?? "n/a")}</span>)}</div>}
          {e.sources?.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>{e.sources.map((url, j) => <a key={url + j} className="rchip" href={url} target="_blank" rel="noreferrer"><I n="link" />Source {j + 1}</a>)}</div> : null}
        </div>
      </div>)}
      {[...usage].reverse().map(u => <div key={u.id} className="box-row">
        <span className="tag t-gray">{u.purpose || "generation"}</span>
        <div className="grow" style={{ minWidth: 0 }}><b style={{ fontWeight: 500 }}>{u.model}</b><div style={{ color: "var(--f3)", fontSize: 12 }}>In {u.inputTokens.toLocaleString()}{u.cachedInputTokens ? ` (${u.cachedInputTokens.toLocaleString()} cached)` : ""} · Out {u.outputTokens.toLocaleString()}{u.durationMs ? ` · ${dur(u.durationMs)}` : ""}</div></div>
        <div style={{ textAlign: "right", fontSize: 12, color: "var(--f3)" }}><b style={{ color: "var(--f1)", fontWeight: 500 }}>{u.costUsd == null ? "N/A" : `$${u.costUsd.toFixed(6)}`}</b><div>{u.cacheHit ? "cache · $0" : new Date(u.calledAt).toLocaleTimeString(language === "vi" ? "vi-VN" : "en-US")}</div></div>
      </div>)}
      {!usage.length && !trace.length && <div className="box-row" style={{ color: "var(--f3)" }}>{tr("Nhật ký sẽ có khi pipeline chạy bước này.", "The log appears once the pipeline runs this step.")}</div>}
      {unknownCost && <div className="box-row" style={{ color: "var(--f3)", fontSize: 12 }}>{tr("N/A: chưa cấu hình đơn giá cho một hoặc nhiều model.", "N/A: pricing is not configured for one or more models.")}</div>}
    </details>
  </div>
}

