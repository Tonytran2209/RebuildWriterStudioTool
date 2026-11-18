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

/** Settings › Workflow AI in the demo layout ("Models per gate"). */
export function WorkflowAiSettings({ config, files, articles, onChange }: WorkflowProps) {
  const { tr } = useI18n()
  const [status, setStatus] = useState<BackendStatus | null>(null)
  const check = () => { setStatus(null); void pingRailway(config.railwayUrl || RAILWAY_URL).then(setStatus) }
  useEffect(check, [config.railwayUrl])
  const models = config.models.filter(m => m.enabled)
  const kb = files.filter(f => f.category === "kb" && isDocumentReady(f))
  const rules = files.filter(f => f.category === "rules" && isDocumentReady(f))
  // Model only: document access per gate is the Shipper's job and must not be reset here.
  const setModel = (step: number, modelId: string) => onChange({ ...config, stepConfigs: { ...config.stepConfigs, [step]: { ...config.stepConfigs[step], modelId } } })
  const setWords = (value: number) => onChange({ ...config, stepConfigs: { ...config.stepConfigs, 4: { ...config.stepConfigs[4], maxDraftWords: Math.min(10000, Math.max(800, value || 1500)) } } })
  const rows = [{ step: 2, gates: [GATES[0]] }, { step: 3, gates: [GATES[1]] }, { step: 4, gates: [GATES[2], GATES[3]] }]
  return <>
    <Sec title={tr("Hệ thống", "System")}>
      <div className="box">
        <BackendRows status={status} onRecheck={check} />
        <div className="box-row"><I n="books" /><div className="grow">Knowledge Base<div className="s">{kb.map(f => f.name).join(", ") || tr("Chưa có dữ liệu", "No data loaded")}</div></div>{kb.length}</div>
        <div className="box-row"><I n="file-description" /><div className="grow">Skills & Rules<div className="s">{rules.map(f => f.name).join(", ") || tr("Chưa có dữ liệu", "No data loaded")}</div></div>{rules.length}</div>
      </div>
    </Sec>
    <Sec title="Models per gate" desc={tr("Model cho từng gate. Tài liệu mỗi gate được nạp do Shipper quyết định.", "The model for each gate. Which documents each gate gets is set in Shipper.")}>
      <div className="box">{rows.map(({ step, gates }) => {
        const calls = articles.flatMap(a => a.aiUsageByStep?.[step as 2 | 3 | 4] ?? [])
        const tokens = calls.reduce((n, c) => n + Number(c.totalTokens ?? 0), 0)
        const label = gates.map(g => g.label).join(" + ")
        return <div key={step} className="box-row" style={{ flexWrap: "wrap" }}>
          {gates.map(g => <span key={g.id} className={`tag t-${g.color}`}>{g.short}</span>)}
          <div className="grow" style={{ minWidth: 160 }}>{label}<div className="s">{tokens.toLocaleString()} tokens · {calls.length} AI calls</div></div>
          {step === 4 && <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--f3)" }}><input className="inp" style={{ width: 90 }} aria-label={tr("Số từ tiếng Anh mục tiêu", "Target English words")} title={tr("Mục tiêu độ dài; QC chấp nhận khoảng ±15%", "Length target; QC accepts a ±15% range")} type="number" min={800} max={10000} step={100} value={Math.max(800, config.stepConfigs[4]?.maxDraftWords ?? config.stepConfigs[4]?.maxDraftCharacters ?? 1500)} onChange={e => setWords(Number(e.target.value))} />words</label>}
          <select className="inp" style={{ width: 200 }} aria-label={`${label} model`} value={config.stepConfigs[step]?.modelId ?? ""} onChange={e => setModel(step, e.target.value)}>
            <option value="">— {tr("Chọn model", "Select model")} —</option>
            {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
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
