import { useEffect, useState, type ReactNode } from "react"
import type { AIProvider, AppConfig, Article, DocumentFile } from "../types"
import { pingRailway, type BackendStatus } from "../lib/db"
import { isDocumentReady } from "../lib/documentStatus"
import { PROVIDER_LABELS } from "../lib/defaultData"
import { useI18n } from "../lib/i18n"
import { GATES } from "./model"
import { I } from "./ui"

const RAILWAY_URL = "https://rebuildwriterstudiotool-production.up.railway.app"
const Sec = ({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children: ReactNode }) => <section><h2>{title}</h2>{desc ? <p className="desc">{desc}</p> : <div style={{ height: 12 }} />}{children}</section>

type WorkflowProps = { config: AppConfig; files: DocumentFile[]; articles: Article[]; onChange: (config: AppConfig) => void }
type TaskKey = "review" | "seo" | "inventory"
type Task = { key: string; tag: string; color: string; label: string; desc: string; step?: number; task?: TaskKey; required?: boolean; openaiOnly?: boolean; fallback?: string }

/** Settings › Workflow AI in the demo layout: one row per AI task that has a model to choose. */
export function WorkflowAiSettings({ config, files, articles, onChange }: WorkflowProps) {
  const { tr } = useI18n()
  const [status, setStatus] = useState<BackendStatus | null>(null)
  const check = () => { setStatus(null); void pingRailway(config.railwayUrl || RAILWAY_URL).then(setStatus) }
  useEffect(check, [config.railwayUrl])
  const models = config.models.filter(m => m.enabled)
  const kb = files.filter(f => f.category === "kb" && isDocumentReady(f))
  const rules = files.filter(f => f.category === "rules" && isDocumentReady(f))
  // Every AI call the tool makes, in pipeline order. Steps keep their document access (Shipper); only the model changes here.
  const tasks: Task[] = [
    { key: "classify", tag: "Plan", color: "gray", step: 1, required: true, label: tr("Phân loại Content Plan", "Content Plan classification"), desc: tr("Chạy khi Add Plan: xếp từng topic vào Comparison hoặc Editorial.", "Runs on Add Plan: sorts each topic into Comparison or Editorial.") },
    { key: "g1", tag: GATES[0].short, color: GATES[0].color, step: 2, required: true, label: tr("Ý tưởng & Article Spec", "Ideas & Article Spec"), desc: tr("Tạo ý tưởng, chọn title và lập Article Spec cho từng bài.", "Generates ideas, picks the title and writes each article's spec.") },
    { key: "seo", tag: GATES[0].short, color: GATES[0].color, task: "seo", openaiOnly: true, fallback: "gpt-5.4-mini", label: "SEO keyword research", desc: tr("Tra keyword trên web trước khi lập Article Spec. Chỉ model OpenAI dùng được (cần công cụ web search).", "Looks up keywords on the web before the spec. OpenAI models only (needs the web search tool).") },
    { key: "g2", tag: GATES[1].short, color: GATES[1].color, step: 3, required: true, label: tr("Outline", "Outline"), desc: tr("Lập outline theo cấu trúc đã chọn khi tạo batch.", "Builds the outline from the structure chosen for the batch.") },
    { key: "g3", tag: GATES[2].short, color: GATES[2].color, step: 4, required: true, label: tr("Viết draft", "Draft"), desc: tr("Viết bài hoàn chỉnh theo outline.", "Writes the full article from the outline.") },
    { key: "review", tag: GATES[3].short, color: GATES[3].color, task: "review", label: "AI Review", desc: tr("Chấm bài theo checklist và sửa phần chưa đạt. Để trống thì dùng model của G3.", "Scores the draft against the checklist and repairs failures. Empty = the G3 model.") },
    { key: "inventory", tag: "Storage", color: "gray", task: "inventory", fallback: "gpt-5.4-mini", label: tr("Tóm tắt Website Inventory", "Website Inventory summaries"), desc: tr("Tóm tắt từng URL để AI gợi ý internal link.", "Summarizes each URL so AI can suggest internal links.") },
  ]
  const valueOf = (t: Task) => t.step ? config.stepConfigs[t.step]?.modelId ?? "" : config.taskModels?.[t.task!] ?? ""
  const setValue = (t: Task, modelId: string) => onChange(t.step
    ? { ...config, stepConfigs: { ...config.stepConfigs, [t.step]: { ...config.stepConfigs[t.step], modelId } } }
    : { ...config, taskModels: { ...config.taskModels, [t.task!]: modelId } })
  const usage = (step?: number) => {
    if (!step || step === 1) return null
    const calls = articles.flatMap(a => a.aiUsageByStep?.[step as 2 | 3 | 4] ?? [])
    return `${calls.reduce((n, c) => n + Number(c.totalTokens ?? 0), 0).toLocaleString()} tokens · ${calls.length} AI calls`
  }
  const missing = tasks.filter(t => t.required && !models.some(m => m.id === valueOf(t)))
  return <>
    <Sec title={tr("Hệ thống", "System")}>
      <div className="box">
        <BackendRows status={status} onRecheck={check} />
        <div className="box-row"><I n="books" /><div className="grow">Knowledge Base<div className="s">{kb.map(f => f.name).join(", ") || tr("Chưa có dữ liệu", "No data loaded")}</div></div>{kb.length}</div>
        <div className="box-row"><I n="file-description" /><div className="grow">Skills & Rules<div className="s">{rules.map(f => f.name).join(", ") || tr("Chưa có dữ liệu", "No data loaded")}</div></div>{rules.length}</div>
      </div>
    </Sec>
    <Sec title={tr("Model cho từng tác vụ AI", "Model per AI task")} desc={tr("Mọi bước có gọi AI trong tool, theo thứ tự pipeline. Tài liệu mỗi gate được nạp do Shipper quyết định; model chỉ hiện khi đã bật ở AI Models.", "Every AI call the tool makes, in pipeline order. Shipper decides which documents each gate gets; a model appears here once enabled in AI Models.")}>
      {missing.length > 0 && <div className="box" style={{ marginBottom: 12, borderColor: "var(--c-orange-bg)", background: "var(--c-orange-bg)" }}><div className="box-row" style={{ color: "var(--c-orange)" }}><I n="alert-triangle" /><div className="grow">{tr("Chưa chọn model", "No model selected")}: {missing.map(t => t.label).join(", ")}<div className="s">{tr("Batch sẽ dừng ở bước này cho đến khi có model.", "Batches stop at this step until a model is set.")}</div></div></div></div>}
      <div className="box">{tasks.map(t => {
        const choices = t.openaiOnly ? models.filter(m => m.provider === "openai") : models
        const stat = usage(t.step)
        return <div key={t.key} className="box-row" style={{ flexWrap: "wrap" }}>
          <span className={`tag t-${t.color}`}>{t.tag}</span>
          <div className="grow" style={{ minWidth: 200 }}>{t.label}<div className="s">{t.desc}{stat && <> · {stat}</>}</div></div>
          <select className="inp" style={{ width: 200 }} aria-label={`${t.label} model`} value={valueOf(t)} onChange={e => setValue(t, e.target.value)}>
            <option value="">{t.required ? `— ${tr("Chọn model", "Select model")} —` : t.task === "review" ? tr("Giống model G3", "Same as G3") : `${tr("Mặc định", "Default")} (${t.fallback})`}</option>
            {choices.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      })}</div>
    </Sec>
  </>
}

const Light = ({ ok, on, off, wait }: { ok: boolean | null | undefined; on: string; off: string; wait?: string }) =>
  <span className={`tag t-${ok ? "green" : ok === false ? "red" : "gray"}`}>{ok ? on : ok === false ? off : wait ?? "—"}</span>

/** Railway backend health: the server that runs every AI step, its database, sign-in store and AI provider keys. */
function BackendRows({ status, onRecheck }: { status: BackendStatus | null; onRecheck: () => void }) {
  const { tr } = useI18n()
  const checking = tr("Đang kiểm tra", "Checking")
  if (!status) return <div className="box-row"><I n="server" /><div className="grow">AI Backend<div className="s">{tr("Đang kiểm tra Railway…", "Checking Railway…")}</div></div><Light ok={null} on="" off="" wait={checking} /></div>
  const d = status.dependencies
  const keys = Object.entries(status.providers ?? {}).filter(([, on]) => on).map(([p]) => PROVIDER_LABELS[p as AIProvider]?.label ?? p)
  const tables = d && d.relationalContentPlans !== undefined ? d.relationalContentPlans && d.threeStageSessions : undefined
  return <>
    <div className="box-row"><I n="server" /><div className="grow">AI Backend<div className="s">{status.ok
      ? `${tr("Phản hồi", "Responded in")} ${status.latencyMs} ms · ${d ? (d.status === "ok" ? tr("mọi phụ thuộc ổn", "all dependencies healthy") : tr("một số phụ thuộc lỗi", "some dependencies degraded")) : tr("không đọc được chẩn đoán", "diagnostics unavailable")}`
      : tr("Không kết nối được Railway. Pipeline và batch sẽ không chạy.", "Cannot reach Railway. Pipelines and batches will not run.")}</div></div>
      <button className="icon-btn" aria-label={tr("Kiểm tra lại", "Check again")} title={tr("Kiểm tra lại", "Check again")} onClick={onRecheck}><I n="refresh" /></button>
      <Light ok={status.ok ? (d ? d.status === "ok" : true) : false} on="Online" off={status.ok ? tr("Suy giảm", "Degraded") : tr("Mất kết nối", "Offline")} /></div>
    {status.ok && <>
      <div className="box-row"><I n="database" /><div className="grow">{tr("Cơ sở dữ liệu", "Database")}<div className="s">{status.databaseProvider ?? "—"} · {tr("lưu file", "files")}: {status.storageProvider ?? "—"}{tables === false ? ` · ${tr("thiếu bảng, cần chạy migration", "tables missing, run migrations")}` : ""}</div></div><Light ok={d ? Boolean(d.databaseConnected) && tables !== false : undefined} on={tr("Kết nối", "Connected")} off={tr("Lỗi", "Error")} /></div>
      <div className="box-row"><I n="lock" /><div className="grow">{tr("Đăng nhập", "Sign-in")}<div className="s">{tr("Kho tài khoản người dùng", "User account store")}</div></div><Light ok={d ? d.authConnected ?? true : undefined} on={tr("Kết nối", "Connected")} off={tr("Lỗi", "Error")} /></div>
      <div className="box-row"><I n="key" /><div className="grow">AI providers<div className="s">{keys.length ? keys.join(", ") : tr("Chưa đặt API key nào trên Railway", "No API key set on Railway")}</div></div><Light ok={keys.length > 0} on={`${keys.length} ${tr("đã cấu hình", "configured")}`} off={tr("Thiếu key", "No keys")} /></div>
      <div className="box-row"><I n="world-search" /><div className="grow">SEO research<div className="s">{tr("Tra keyword bằng web search ở G1", "Keyword lookup via web search at G1")}</div></div>{/* Optional feature: off is neutral, not an error. */}<Light ok={status.seoResearch || undefined} on={tr("Bật", "On")} off="" wait={tr("Chưa cấu hình", "Not configured")} /></div>
    </>}
  </>
}

const API_KEY_NAMES: Record<AIProvider, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY", mistral: "MISTRAL_API_KEY", together: "TOGETHER_API_KEY", groq: "GROQ_API_KEY", deepseek: "DEEPSEEK_API_KEY" }
type PriceField = "inputUsdPerMillion" | "cachedInputUsdPerMillion" | "outputUsdPerMillion"

/** Settings › AI Models in the demo layout: one box per provider, a switch per model. */
export function ModelsSettings({ config, onChange }: { config: AppConfig; onChange: (config: AppConfig) => void }) {
  const { tr, language } = useI18n()
  const toggle = (id: string) => onChange({ ...config, models: config.models.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m) })
  const price = (id: string, field: PriceField, value: string) => {
    const n = Number(value)
    onChange({ ...config, models: config.models.map(m => m.id === id ? { ...m, pricing: { ...m.pricing, inputUsdPerMillion: m.pricing?.inputUsdPerMillion ?? 0, outputUsdPerMillion: m.pricing?.outputUsdPerMillion ?? 0, [field]: Number.isFinite(n) && n >= 0 ? n : 0 } } : m) })
  }
  const providers = [...new Set(config.models.map(m => m.provider))]
  const speed = { fast: tr("Nhanh", "Fast"), medium: tr("Trung bình", "Medium"), slow: tr("Chậm", "Slow") }
  return <>{providers.map(provider => {
    const models = config.models.filter(m => m.provider === provider)
    const active = models.some(m => m.enabled)
    return <Sec key={provider} title={<span style={{ display: "flex", alignItems: "center", gap: 8 }}>{PROVIDER_LABELS[provider]?.label || provider}<span className={`tag t-${active ? "green" : "gray"}`}>{active ? "Active" : "Inactive"}</span></span>}
      desc={<>API key: <code>{API_KEY_NAMES[provider as AIProvider]}</code> {tr("(đặt trong biến môi trường Railway)", "(set in Railway environment variables)")}</>}>
      <div className="box">{models.map(m => <div key={m.id} className="box-row" style={{ alignItems: "flex-start" }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{m.name}<span className="tag t-gray">{m.contextWindow}</span><span className="tag t-gray">{speed[m.speed]}</span></div>
          <div className="s">{language === "vi" ? m.description : `${m.name} for step-based content workflows.`}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>{([["inputUsdPerMillion", "Input $/1M", "N/A"], ["cachedInputUsdPerMillion", "Cache $/1M", "= input"], ["outputUsdPerMillion", "Output $/1M", "N/A"]] as const).map(([field, label, ph]) =>
            <label key={field} style={{ display: "flex", flexDirection: "column", gap: 4, color: "var(--f3)", fontSize: 12, width: 110 }}>{label}<input className="inp" type="number" min="0" step="0.01" placeholder={ph} value={m.pricing?.[field] ?? ""} onChange={e => price(m.id, field, e.target.value)} /></label>)}
          </div>
        </div>
        <button role="switch" aria-checked={m.enabled} aria-label={m.name} className={`toggle${m.enabled ? " on" : ""}`} style={{ marginTop: 2 }} onClick={() => toggle(m.id)} />
      </div>)}</div>
    </Sec>
  })}</>
}
