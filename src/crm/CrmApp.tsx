import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"
import type { AppConfig, Article, ContentPlan, ContentPlanItem, DocumentFile, PipelineSettings } from "../types"
import type { OutlineStructureSnapshot } from "../../shared/outlineStructures"
import type { ThemePreference } from "../lib/theme"
import { useI18n } from "../lib/i18n"
import * as db from "../lib/db"
import { classifyContentPlan, deleteContentPlan, importContentPlan, updateContentPlanStatus } from "../lib/contentPlans"
import { markdownToHtml, normalizeDraftOutput } from "../lib/draftExport"
import { buildBatchZip } from "../lib/zipExport"
import { inReviewSample, pipelineSettings, type RerunGate } from "../lib/pipeline"
import ManualTab from "./ManualTab"
import { draftWithoutImagePlaceholders, step4ChecklistDocs } from "../lib/qualityPolicy"

// Drafts saved before the image step was removed may still hold image placeholders.
const readable = (draft?: string) => normalizeDraftOutput(draftWithoutImagePlaceholders(draft ?? ""))
import { QC_GROUPS, QC_LABELS_VI, qcGroupOf } from "../lib/qcGroups"
import StructureSelect from "./StructureSelect"
import { ModelsSettings, WorkflowAiSettings } from "./AiSettings"
import { AddDocForm, DocDetails, LegacyArchive } from "./StorageDocs"
import WebsiteInventory from "./WebsiteInventory"
import WorkflowRules from "./WorkflowRules"
import { isLegacyActionPlan } from "../lib/legacyCompatibility"
import { GATES, STORAGE_GROUPS, batchesOf, planStats, plansOf, storageDocs, toCrmArticle, toggleShip, type CrmArticle, type CrmBatch, type CrmPlan, type HumanStatus, type StorageDoc } from "./model"
import { Av, I, confirmDiscard, enc, errText, go, markUnsaved, person, toast, toastErr, trackHandoff } from "./ui"
import "./crm.css"

/* ─── helpers (same as the demo) ───────────────────────────────────────── */

const TYPES = { A: ["So sánh format", "Format vs format"], B: ["So sánh khái niệm", "Concept comparison"], C: ["Nhiều lựa chọn", "Multiple options"], ED: ["Editorial", "Editorial"] } as const
const STATUS = { queued: ["Queued", "gray"], running: ["Running", "blue"], failed: ["Failed (No-pass)", "red"], completed: ["AI Approved", "green"], attention: ["Needs attention", "red"] } as const
const HUMAN = { not: ["Not Reviewed", "gray"], approved: ["Approved", "green"], revision: ["Needs Revision", "orange"] } as const
const OBJ_META = {
  plans: { label: "Content Plans", icon: "list-details", color: "#4662d5" },
  batches: { label: "Batches", icon: "stack-2", color: "#7948af" },
  articles: { label: "Articles", icon: "file-text", color: "#c25700" },
  reviews: { label: "Review Workspace", icon: "checklist", color: "#14806e" },
  storage: { label: "Storage", icon: "folders", color: "#317299" },
} as const
type Obj = keyof typeof OBJ_META

function useAgo() {
  const { tr } = useI18n()
  return (d?: string | null) => {
    if (!d) return "—"
    const s = (Date.now() - new Date(d).getTime()) / 1000
    if (s < 60) return tr("vừa xong", "just now")
    if (s < 3600) return Math.floor(s / 60) + tr(" phút trước", " min ago")
    if (s < 86400) return Math.floor(s / 3600) + tr(" giờ trước", "h ago")
    return Math.floor(s / 86400) + tr(" ngày trước", " days ago")
  }
}
const fmtTime = (d?: string | null, lang = "vi") => d ? new Date(d).toLocaleString(lang === "vi" ? "vi-VN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

/* ─── toast (demo style), fed by the app-wide notice event ─────────────── */

export function CrmToastHost() {
  const [items, setItems] = useState<Array<{ id: number; message: string; error: boolean; out?: boolean }>>([])
  useEffect(() => {
    const on = (event: Event) => {
      const { id, message, kind } = (event as CustomEvent<{ id: number; message: string; kind?: string }>).detail
      if (!message?.trim()) return
      const error = kind === "error" || kind === "warning"
      const ttl = error ? 6000 : 2400
      setItems(list => [...list, { id, message, error }])
      window.setTimeout(() => setItems(list => list.map(t => t.id === id ? { ...t, out: true } : t)), ttl)
      window.setTimeout(() => setItems(list => list.filter(t => t.id !== id)), ttl + 220)
    }
    window.addEventListener("writer:workspace-notice", on)
    return () => window.removeEventListener("writer:workspace-notice", on)
  }, [])
  return <div className="crm" style={{ position: "fixed", height: 0, width: 0, overflow: "visible" }}>{items.slice(-1).map(t => <div key={t.id} role={t.error ? "alert" : "status"} className={`toast${t.error ? " err" : ""}${t.out ? " out" : ""}`}><I n={t.error ? "alert-triangle" : "info-circle"} /><span>{t.message}</span>{t.error && <button className="icon-btn" aria-label="Đóng / Close" style={{ color: "inherit" }} onClick={() => setItems(list => list.filter(x => x.id !== t.id))}><I n="x" /></button>}</div>)}</div>
}

/* ─── props ────────────────────────────────────────────────────────────── */

export type CrmProps = {
  user: { email: string; role: "user" | "admin" }
  articles: Article[]
  contentPlans: ContentPlan[]
  files: DocumentFile[]
  config: AppConfig
  onUpdateArticle: (id: string, updates: Partial<Article>) => Promise<boolean>
  onDeleteArticle: (article: Article, batch?: boolean) => void
  onRetry: (article: Article) => Promise<void>
  onCreate: (type: "comparison-seo" | "editorial-originality", plan: ContentPlan, items: ContentPlanItem[], batchSize?: 5 | 10 | 15 | 20, outlineStructure?: OutlineStructureSnapshot, options?: { forceBatch?: boolean; select?: boolean }) => Promise<void>
  onContentPlansChange: (plans: ContentPlan[], removedId?: string) => void
  onSaveConfig: (config: AppConfig, files: DocumentFile[], filesChanged: boolean) => Promise<void>
  onFilesSynced: (files: DocumentFile[], config?: AppConfig) => void
  onSignOut: () => void
  themePreference: ThemePreference
  onThemeChange: (preference: ThemePreference) => void
  onRerun: (article: Article, gate: RerunGate) => Promise<void>
  onToggleComplete: (article: Article) => void
  onMigrateLegacy: (article: Article) => void
}

type Panel = { kind: "plan" } | { kind: "review"; id: string } | { kind: "doc"; id: string } | { kind: "add-doc" } | { kind: "run-items"; id: string } | { kind: "step"; i: number } | { kind: "cmd" } | null
type Ctx = CrmProps & {
  settings: PipelineSettings
  list: CrmArticle[]
  plans: CrmPlan[]
  batches: CrmBatch[]
  docs: StorageDoc[]
  can: (what: string) => boolean
  isAdmin: boolean
  panel: Panel
  setPanel: (panel: Panel) => void
  route: string[]
}

const ROLES = {
  operator: { name: "Content Operator", desc: "Add Plan, run pipeline, view articles, Retry, Copy" },
  reviewer: { name: "Reviewer", desc: "Review Workspace, Approve / Request Revision, Approved Articles" },
  admin: { name: "Admin", desc: "Storage, Shipper, models, threshold, perBatch, maxParallel" },
} as const

const NavToggle = createContext<() => void>(() => {})

/* ─── shell ────────────────────────────────────────────────────────────── */

export default function CrmApp(props: CrmProps) {
  const settings = pipelineSettings(props.config)
  const [hash, setHash] = useState(() => window.location.hash)
  const [panel, setPanel] = useState<Panel>(null)
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => {
    let current = window.location.hash, reverting = false
    const on = () => {
      if (reverting) { reverting = false; return }
      // Leaving a page with unsaved edits asks first; "Cancel" puts the previous address back.
      if (!confirmDiscard()) { reverting = true; window.location.hash = current; return }
      current = window.location.hash
      setHash(current); setNavOpen(false); setPanel(null)
    }
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPanel({ kind: "cmd" }) }
      if (e.key === "Escape" && confirmDiscard()) setPanel(null)
    }
    document.addEventListener("keydown", on)
    return () => document.removeEventListener("keydown", on)
  }, [])
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?")
  const route = (path || "objects/articles").split("/").map(decodeURIComponent)
  const [a, b, c] = route

  const settingsKey = JSON.stringify(settings)
  const list = useMemo(() => props.articles.map(x => toCrmArticle(x, settings)), [props.articles, settingsKey])
  const plans = useMemo(() => plansOf(props.contentPlans, list, settings), [props.contentPlans, list, settingsKey])
  const batches = useMemo(() => batchesOf(list), [list])
  const docs = useMemo(() => storageDocs(props.files, props.config, props.articles.filter(x => x.approvedArticle).length, props.contentPlans), [props.files, props.config, props.articles, props.contentPlans])
  const isAdmin = props.user.role === "admin"
  // No reviewer role in the database yet: every signed-in user may review.
  // Approved Articles feed the Storage examples and deletes are permanent: admin only until a Reviewer role exists.
  const can = (what: string) => isAdmin || ["plans", "retry", "copy", "manual", "review"].includes(what)
  const ctx: Ctx = { ...props, settings, list, plans, batches, docs, can, isAdmin, panel, setPanel, route }

  let page: ReactNode
  if (a === "objects" && b in OBJ_META) page = <ObjectIndex ctx={ctx} o={b as Obj} />
  else if (a === "object" && b === "articles") page = <ArticleShow ctx={ctx} id={c} initialTab={new URLSearchParams(query).get("tab") ?? "final"} />
  else if (a === "object" && b === "plans") page = <PlanShow ctx={ctx} id={c} />
  else if (a === "object" && b === "batches") page = <BatchShow ctx={ctx} id={c} />
  else if (a === "storage" && (b === "website" || b === "legacy")) page = <StorageSubPage ctx={ctx} p={b} />
  else if (a === "workflows") page = <PipelineCanvas ctx={ctx} />
  else if (a === "dashboards") page = <Dashboard ctx={ctx} />
  else if (a === "settings") page = <SettingsPage ctx={ctx} p={b} />
  else page = <NotFound />

  return (
    <div className={`crm enter tab-enter${navOpen ? " nav-open" : ""}`} onClick={e => { if (navOpen && !(e.target as HTMLElement).closest(".nav,.menu-btn")) setNavOpen(false) }}>
      {a === "settings" ? <SettingsNav ctx={ctx} p={b} /> : <NavDrawer ctx={ctx} />}
      <div className="page" role="main" key={path}>
        <NavToggle.Provider value={() => setNavOpen(v => !v)}>{page}</NavToggle.Provider>
      </div>
      {panel?.kind === "plan" && <AddPlanPanel ctx={ctx} />}
      {panel?.kind === "review" && <ReviewPanel ctx={ctx} id={panel.id} />}
      {panel?.kind === "doc" && <DocPanel ctx={ctx} id={panel.id} />}
      {panel?.kind === "add-doc" && <AddDocPanel ctx={ctx} />}
      {panel?.kind === "run-items" && <RunItemsPanel ctx={ctx} planId={panel.id} />}
      {panel?.kind === "step" && <StepPanel ctx={ctx} i={panel.i} />}
      {panel?.kind === "cmd" && <CommandMenu ctx={ctx} />}
    </div>
  )
}

function NavDrawer({ ctx }: { ctx: Ctx }) {
  const { tr, language, toggleLanguage } = useI18n()
  const [a, b, c] = ctx.route
  const pending = ctx.list.filter(x => x.status === "completed" && x.human.status === "not").length
  const item = (href: string, icon: ReactNode, label: ReactNode, on: boolean, extra?: ReactNode) =>
    <a key={href} className={`nav-item${on ? " on" : ""}`} href={href} aria-current={on ? "page" : undefined}>{icon}<span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>{extra}</a>
  const objIco = (o: Obj) => <span className="nav-ico" style={{ background: OBJ_META[o].color }}><I n={OBJ_META[o].icon} s={{ fontSize: 11 }} /></span>
  const nav: Array<[Obj, string]> = [["plans", "plans"], ["batches", "plans"], ["articles", "plans"], ["reviews", "review"], ["storage", "storage"]]
  const campaigns = ctx.plans.filter(p => p.articles.length && p.plan.status !== "archived")
  return <nav className="nav" aria-label={tr("Điều hướng chính", "Main navigation")}>
    <div className="ws"><span className="ws-logo" style={{ background: "#ff8f2b", color: "#fff" }}>F</span>Writer Studio</div>
    <button className="nav-item" onClick={() => ctx.setPanel({ kind: "cmd" })}><I n="search" /><span>{tr("Tìm kiếm", "Search")}</span><span className="kbd">⌘K</span></button>
    <a className="nav-item" href={ctx.can("settings") ? "#/settings/pipeline" : "#/settings/experience"}><I n="settings" /><span>{tr("Cài đặt", "Settings")}</span></a>
    <button className="nav-item" onClick={() => ctx.setPanel({ kind: "plan" })}><I n="circle-plus" /><span>Add Plan</span></button>
    <div className="nav-sec">Pipeline</div>
    {nav.filter(([, need]) => ctx.can(need)).map(([o]) => item("#/objects/" + o, objIco(o), OBJ_META[o].label, ((a === "objects" || a === "object") && b === o) || (a === "storage" && o === "storage"), o === "reviews" && pending ? <span className="kbd">{pending}</span> : undefined))}
    {item("#/workflows", <span className="nav-ico" style={{ background: "#307f52" }}><I n="settings-automation" s={{ fontSize: 11 }} /></span>, tr("Quy trình 3 gate", "3-gate pipeline"), a === "workflows")}
    {item("#/dashboards", <span className="nav-ico" style={{ background: "#b23887" }}><I n="layout-dashboard" s={{ fontSize: 11 }} /></span>, "Dashboards", a === "dashboards")}
    {campaigns.length > 0 && <div className="nav-sec">Campaign</div>}
    {campaigns.map(p => { const s = planStats(p.articles); return item("#/object/plans/" + p.id, <Av name={p.name} />, p.name, a === "object" && b === "plans" && c === p.id, <span className="kbd">{s.c}/{s.n}</span>) })}
    <div className="nav-foot">
      <button className="nav-item" onClick={toggleLanguage}><I n="world" /><span>{language === "vi" ? "Tiếng Việt" : "English"}</span></button>
      <a className="nav-item" href="#/settings/roles"><Av name={person(ctx.user.email)} round /><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{person(ctx.user.email)}</span><span className="kbd">{ctx.isAdmin ? "Admin" : "Content Operator"}</span></a>
    </div>
  </nav>
}

function Header({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  const toggle = useContext(NavToggle)
  const { tr } = useI18n()
  return <div className="ph">
    <button className="icon-btn menu-btn" aria-label={tr("Mở menu", "Open menu")} onClick={toggle}><I n="menu-2" /></button>
    <div className="ph-title" style={{ minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{title}</div>
    <div className="ph-actions">{actions}</div>
  </div>
}
function NotFound({ t = "Not found" }: { t?: string }) {
  return <><Header title={t} /><div className="card"><div className="empty-state"><I n="ghost" /><h3>{t}</h3><a className="btn" href="#/objects/articles">Articles</a></div></div></>
}
function Forbidden() {
  const { tr } = useI18n()
  return <><Header title={tr("Không có quyền", "No access")} /><div className="card"><div className="empty-state"><I n="lock" /><h3>Content Operator</h3><span>{tr("Vai trò này không mở được mục này.", "This role cannot open this area.")}</span><a className="btn" href="#/settings/roles"><I n="lock" />Roles</a></div></div></>
}

/* ─── chips & tags ─────────────────────────────────────────────────────── */

const Tag = ({ c, children, s }: { c: string; children: ReactNode; s?: CSSProperties }) => <span className={`tag t-${c}`} style={s}>{children}</span>
const STATUS_VI: Record<keyof typeof STATUS, string> = { queued: "Chờ chạy", running: "Đang chạy", failed: "Lỗi (No-pass)", completed: "AI Approved", attention: "Cần xử lý" }
const HUMAN_VI: Record<HumanStatus, string> = { not: "Chưa review", approved: "Đã duyệt", revision: "Cần sửa" }
function StatusTag({ k }: { k: keyof typeof STATUS }) { const { tr } = useI18n(); return <Tag c={STATUS[k][1]}>{tr(STATUS_VI[k], STATUS[k][0])}</Tag> }
function HumanTag({ h }: { h: HumanStatus }) { const { tr } = useI18n(); return <Tag c={HUMAN[h][1]}>{tr(HUMAN_VI[h], HUMAN[h][0])}</Tag> }
function TypeTag({ t }: { t: CrmArticle["type"] }) { const { tr } = useI18n(); return <Tag c={({ A: "blue", B: "purple", C: "turq", ED: "pink" })[t]}>{t} · {tr(TYPES[t][0], TYPES[t][1])}</Tag> }
function GateTag({ a }: { a: CrmArticle }) {
  if (a.status === "completed") return <Tag c="green"><I n="check" />&nbsp;Completed</Tag>
  if (a.status === "queued") return <Tag c="gray">Queued</Tag>
  if (a.awaiting) return <Tag c="orange"><I n="user-check" />&nbsp;G2 · Chờ duyệt outline</Tag>
  const g = GATES[(a.status === "failed" ? a.failGate! : a.gate) - 1]
  return <Tag c={a.status === "failed" ? "red" : g.color}>{g.label}</Tag>
}
const ScoreTag = ({ s, t }: { s: number | null; t: number }) => s == null ? <span className="muted">—</span> : <Tag c={s >= t ? "green" : "red"}>{s}%</Tag>
function GateBar({ a }: { a: CrmArticle }) {
  return <span style={{ display: "inline-flex", gap: 2, verticalAlign: "middle" }}>{GATES.map(g => {
    let bg = "var(--bg4)"
    if (a.status === "completed" || a.gate > g.id) bg = "var(--c-green)"
    else if (a.status === "failed" && a.failGate === g.id) bg = "var(--c-red)"
    const live = a.status === "running" && a.gate === g.id
    return <span key={g.id} title={g.label} style={{ position: "relative", width: 26, height: 6, borderRadius: 2, background: bg, overflow: "hidden" }}>
      {live && <span style={{ position: "absolute", inset: "0 auto 0 0", width: a.a.batchStatus === "running" ? "60%" : "30%", background: "var(--accent)" }} />}
    </span>
  })}</span>
}
function PlanChip({ ctx, id }: { ctx: Ctx; id?: string }) {
  const p = ctx.plans.find(x => x.id === id)
  return p ? <a className="rchip" href={`#/object/plans/${p.id}`} onClick={e => e.stopPropagation()}><Av name={p.name} />{p.name}</a> : null
}
function BatchChip({ ctx, a }: { ctx: Ctx; a: CrmArticle }) {
  const b = ctx.batches.find(x => x.id === a.batchId)
  return b ? <a className="rchip" href={`#/object/batches/${enc(b.id)}`} onClick={e => e.stopPropagation()}><I n="stack-2" />Batch {b.idx}</a> : <span className="muted">—</span>
}
const PersonChip = ({ n }: { n?: string }) => n ? <span className="rchip"><Av name={n} round />{n}</span> : null

/* ─── object index (table / kanban) ────────────────────────────────────── */

type Field = { key: string; label: string; icon: string; num?: boolean; render?: (r: any) => ReactNode; sortVal?: (r: any) => string | number; text?: (r: any) => string }
const docStatus = (d: StorageDoc) => ({ ok: ["Ready", "green"], partial: ["Partial", "orange"], draft: ["Draft", "orange"], missing: ["Missing", "red"] } as const)[d.st]
const nameOf = (o: Obj, r: any): string => o === "batches" ? `Batch ${r.idx}` : r.name ?? r.title

function fieldsFor(ctx: Ctx, o: Obj, ago: (d?: string | null) => string, tr: (vi: string, en: string) => string): Field[] {
  const t = ctx.settings.threshold
  const planPaused = (id: string) => { const bs = ctx.batches.filter(x => x.planId === id); return bs.length > 0 && bs.some(x => x.paused) && !bs.some(x => x.status === "running" && !x.paused) }
  if (o === "plans") return [
    { key: "name", label: "Name", icon: "abc", text: (r: CrmPlan) => r.name },
    { key: "progress", label: "Progress", icon: "progress-check", render: (r: CrmPlan) => { const s = planStats(r.articles); return <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span style={{ width: 90, height: 6, borderRadius: 3, background: "var(--bg4)", overflow: "hidden", display: "inline-block" }}><span style={{ display: "block", height: "100%", width: `${s.pct}%`, background: "var(--c-green)" }} /></span>{s.c}/{s.n}</span> }, sortVal: (r: CrmPlan) => planStats(r.articles).pct },
    { key: "status", label: "Status", icon: "player-play", render: (r: CrmPlan) => { const s = planStats(r.articles); return r.plan.status === "archived" ? <Tag c="gray">{tr("Đã lưu trữ", "Archived")}</Tag> : planPaused(r.id) ? <Tag c="orange">{tr("Tạm dừng", "Paused")}</Tag> : s.n && s.c === s.n ? <Tag c="green">{tr("Xong", "Done")}</Tag> : s.n ? <Tag c="blue">{tr("Đang chạy", "Running")}</Tag> : <Tag c="gray">{tr("Chưa chạy", "Not started")}</Tag> } },
    { key: "batches", label: "Batches", icon: "stack-2", num: true, render: (r: CrmPlan) => ctx.batches.filter(x => x.planId === r.id).length },
    { key: "topics", label: "Topics", icon: "list", num: true, render: (r: CrmPlan) => r.plan.totalArticles },
    { key: "perBatch", label: "Per batch", icon: "layout-rows", num: true, render: (r: CrmPlan) => r.perBatch },
    { key: "failed", label: "Failed", icon: "alert-triangle", num: true, render: (r: CrmPlan) => { const f = planStats(r.articles).f; return f ? <span style={{ color: "var(--danger)" }}>{f}</span> : "0" } },
    { key: "created", label: "Creation date", icon: "calendar", render: (r: CrmPlan) => <span className="muted">{ago(r.created)}</span>, sortVal: (r: CrmPlan) => r.created },
  ]
  if (o === "batches") return [
    { key: "name", label: "Name", icon: "abc", sortVal: (r: CrmBatch) => (r.planId ?? "") + String(r.idx).padStart(4, "0") },
    { key: "planId", label: "Content Plan", icon: "list-details", render: (r: CrmBatch) => <PlanChip ctx={ctx} id={r.planId} /> },
    { key: "status", label: "Status", icon: "progress-check", render: (r: CrmBatch) => r.paused ? <Tag c="orange">Paused</Tag> : <StatusTag k={r.status} /> },
    { key: "done", label: "AI Approved", icon: "circle-check", render: (r: CrmBatch) => `${r.done}/${r.articles.length}` },
    { key: "schedule", label: "Schedule", icon: "calendar-event", render: (r: CrmBatch) => fmtTime(r.schedule), sortVal: (r: CrmBatch) => r.schedule },
  ]
  if (o === "articles") return [
    { key: "name", label: "Title", icon: "abc", text: (r: CrmArticle) => r.title },
    { key: "gate", label: "Gate", icon: "git-merge", render: (r: CrmArticle) => <GateTag a={r} />, sortVal: (r: CrmArticle) => r.gate },
    { key: "bar", label: "G1 · G2 · G3 · AI", icon: "progress", render: (r: CrmArticle) => <GateBar a={r} />, sortVal: (r: CrmArticle) => r.gate },
    { key: "status", label: "Status", icon: "progress-check", render: (r: CrmArticle) => <StatusTag k={r.status} /> },
    { key: "score", label: "AI score", icon: "gauge", num: true, render: (r: CrmArticle) => <ScoreTag s={r.score} t={t} />, sortVal: (r: CrmArticle) => r.score ?? -1 },
    { key: "type", label: "Type", icon: "category", render: (r: CrmArticle) => <TypeTag t={r.type} /> },
    { key: "planId", label: "Content Plan", icon: "list-details", render: (r: CrmArticle) => <PlanChip ctx={ctx} id={r.planId} /> },
    { key: "batch", label: "Batch", icon: "stack-2", render: (r: CrmArticle) => <BatchChip ctx={ctx} a={r} /> },
    { key: "human", label: "Human review", icon: "user-check", render: (r: CrmArticle) => r.status === "completed" ? <HumanTag h={r.human.status} /> : <span className="muted">—</span>, sortVal: (r: CrmArticle) => r.human.status },
    { key: "keyword", label: "Keyword", icon: "key", text: (r: CrmArticle) => r.keyword },
  ]
  if (o === "reviews") return [
    { key: "name", label: "Article", icon: "abc", text: (r: CrmArticle) => r.title },
    { key: "human", label: "Human review", icon: "user-check", render: (r: CrmArticle) => <HumanTag h={r.human.status} />, sortVal: (r: CrmArticle) => r.human.status },
    { key: "score", label: "AI score", icon: "gauge", render: (r: CrmArticle) => <ScoreTag s={r.score} t={t} />, sortVal: (r: CrmArticle) => r.score ?? -1 },
    { key: "planId", label: "Content Plan", icon: "list-details", render: (r: CrmArticle) => <PlanChip ctx={ctx} id={r.planId} /> },
    { key: "batch", label: "Batch", icon: "stack-2", render: (r: CrmArticle) => <BatchChip ctx={ctx} a={r} /> },
    { key: "reviewer", label: "Reviewer", icon: "user-circle", render: (r: CrmArticle) => <PersonChip n={person(r.human.reviewer)} /> },
    { key: "approvedArticle", label: "Approved Article", icon: "star", render: (r: CrmArticle) => r.a.approvedArticle ? <Tag c="yellow">Yes</Tag> : <Tag c="gray">No</Tag> },
  ]
  return [
    { key: "name", label: "Document", icon: "abc", text: (r: StorageDoc) => r.name },
    { key: "g", label: "Group", icon: "folder", render: (r: StorageDoc) => <Tag c={STORAGE_GROUPS.find(g => g[0] === r.g)![1]}>{r.g}</Tag> },
    { key: "st", label: "Status", icon: "progress-check", render: (r: StorageDoc) => { const [l, c] = docStatus(r); return <Tag c={c}>{l}</Tag> } },
    { key: "used", label: "Used at", icon: "git-merge", render: (r: StorageDoc) => r.used.map(u => <Tag key={u} c="blue" s={{ marginRight: 4 }}>{u === 4 ? "Final" : "G" + u}</Tag>) },
    { key: "types", label: "Applies to types", icon: "category", render: (r: StorageDoc) => r.types.map(x => <Tag key={x} c="gray" s={{ marginRight: 4 }}>{x}</Tag>) },
    { key: "note", label: "Note", icon: "notes", render: (r: StorageDoc) => <span className="muted">{r.note}</span> },
    { key: "updatedAt", label: "Last update", icon: "calendar", render: (r: StorageDoc) => <span className="muted">{r.updatedAt ? ago(r.updatedAt) : ""}</span>, sortVal: (r: StorageDoc) => r.updatedAt ?? "" },
  ]
}

const VIEW_KEY = "writer:crm-view"
/** Article ids in the order last shown on the Articles page (filter + sort), for Prev/Next on the record. */
let lastArticleOrder: string[] = []
function ObjectIndex({ ctx, o }: { ctx: Ctx; o: Obj }) {
  const { tr } = useI18n()
  const ago = useAgo()
  const need = ({ plans: "plans", batches: "plans", articles: "plans", reviews: "review", storage: "storage" } as const)[o]
  const [filter, setFilter] = useState("")
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null)
  const [kanban, setKanban] = useState(() => { try { return localStorage.getItem(VIEW_KEY) !== "table" } catch { return true } })
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, kanban ? "kanban" : "table") } catch { /* per-viewer convenience */ } }, [kanban])
  if (!ctx.can(need)) return <Forbidden />
  const m = OBJ_META[o], fields = fieldsFor(ctx, o, ago, tr)
  const data: any[] = o === "plans" ? ctx.plans : o === "batches" ? ctx.batches : o === "articles" ? ctx.list : o === "reviews" ? ctx.list.filter(x => x.status === "completed") : ctx.docs
  const q = filter.toLowerCase()
  let rows = data.filter(r => !q || nameOf(o, r).toLowerCase().includes(q) || String(r.keyword ?? r.g ?? "").toLowerCase().includes(q))
  if (sort) {
    const f = fields.find(x => x.key === sort.key)!
    const val = (r: any) => f.sortVal ? f.sortVal(r) : f.key === "name" ? nameOf(o, r) : f.text ? f.text(r) : r[f.key]
    rows = [...rows].sort((x, y) => { const A = val(x) ?? "", B = val(y) ?? ""; return (A > B ? 1 : A < B ? -1 : 0) * (sort.dir === "asc" ? 1 : -1) })
  }
  if (o === "articles") lastArticleOrder = rows.map(r => r.id)
  const isKanban = o === "articles" && kanban
  const sortBy = (key: string) => setSort(s => ({ key, dir: s?.key === key && s.dir === "asc" ? "desc" : "asc" }))
  // Picks from the review sample (Settings › Pipeline, %) first; falls back to any unreviewed article.
  const randomReview = () => { const open = ctx.list.filter(a => a.status === "completed" && a.human.status === "not"), sampled = open.filter(a => inReviewSample(a.id, ctx.settings.reviewSample)), pool = sampled.length ? sampled : open; if (!pool.length) return toast(tr("Không còn bài chưa review", "No unreviewed articles")); ctx.setPanel({ kind: "review", id: pool[Math.floor(Math.random() * pool.length)].id }) }
  const addDoc = () => ctx.setPanel({ kind: "add-doc" })
  const legacyCount = ctx.files.filter(isLegacyActionPlan).length
  const primary = o === "storage" ? <>
      {legacyCount > 0 && <button className="btn" aria-label="Legacy Action Plans" onClick={() => go("#/storage/legacy")}><I n="archive" /><span>Legacy</span></button>}
      {ctx.isAdmin && <button className="btn" aria-label="Website Inventory" onClick={() => go("#/storage/website")}><I n="world" /><span>Website Inventory</span></button>}
      {ctx.isAdmin && <button className="btn" aria-label={tr("Thêm tài liệu", "Add document")} onClick={addDoc}><I n="upload" /><span>{tr("Thêm tài liệu", "Add document")}</span></button>}
    </>
    : o === "reviews" ? <button className="btn" aria-label={tr("Chọn ngẫu nhiên", "Random pick")} onClick={randomReview}><I n="dice-5" /><span>{tr("Chọn ngẫu nhiên", "Random pick")} · {tr("mẫu", "sample")} {ctx.settings.reviewSample}%</span></button>
    : <button className="btn primary" aria-label="Add Plan" onClick={() => ctx.setPanel({ kind: "plan" })}><I n="plus" /><span>Add Plan</span></button>
  const gaps = o === "storage" ? ctx.docs.filter(d => d.st !== "ok") : []
  const desc = ({ reviews: tr("Thư viện bài đã AI Approved. Chọn bài bất kỳ, không cần phân công. Human review không chặn việc bài hoàn thành.", "Library of AI-approved articles. Pick any; no assignment needed. Human review never blocks completion."), storage: tr("Shipper chỉ nạp phần tài liệu cần cho từng gate và article type.", "The Shipper loads only what each gate and article type needs.") } as Partial<Record<Obj, string>>)[o]
  const sortField = sort && fields.find(f => f.key === sort.key)
  return <>
    <Header title={<><span className="nav-ico" style={{ background: m.color }}><I n={m.icon} s={{ fontSize: 11 }} /></span>{m.label}</>} actions={primary} />
    <div className="card">
      <div className="vbar">
        <span className="btn ghost" style={{ cursor: "default" }}><I n={isKanban ? "layout-kanban" : "list"} />{m.label}<span className="count">· {rows.length}</span></span>
        {desc && <span className="muted" style={{ color: "var(--f3)", marginLeft: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{desc}</span>}
        <span className="grow" />
        {sortField && <span className="chip-f"><I n={sort!.dir === "asc" ? "arrow-up" : "arrow-down"} />{sortField.label}<button aria-label="Clear sort" onClick={() => setSort(null)}><I n="x" /></button></span>}
        <span className="btn ghost" style={{ cursor: "text" }}><I n="filter" /><input aria-label="Filter" placeholder="Filter…" value={filter} onChange={e => setFilter(e.target.value)} /></span>
        
        {o === "articles" && <button className="btn ghost" onClick={() => setKanban(k => !k)}><I n={isKanban ? "table" : "layout-kanban"} /><span>{isKanban ? "Table" : "Kanban"}</span></button>}
      </div>
      {gaps.length > 0 && <div style={{ margin: 8, border: "1px solid var(--c-orange-bg)", background: "var(--c-orange-bg)", borderRadius: 6, padding: "10px 12px", color: "var(--c-orange)" }}>
        <b style={{ fontWeight: 600 }}><I n="alert-triangle" /> Open gaps · {gaps.length}</b>
        <div style={{ color: "var(--f2)", marginTop: 4 }}>{gaps.map(d => <span key={d.id} className="rchip" style={{ margin: "2px 4px 2px 0", background: "var(--bg1)" }}>{d.name}</span>)}</div>
      </div>}
      {isKanban ? <KanbanView ctx={ctx} rows={rows} /> : <TableView ctx={ctx} o={o} rows={rows} fields={fields} sort={sort} sortBy={sortBy} onFoot={o === "storage" ? addDoc : o === "reviews" ? randomReview : () => ctx.setPanel({ kind: "plan" })} />}
    </div>
  </>
}

function StorageSubPage({ ctx, p }: { ctx: Ctx; p: "website" | "legacy" }) {
  const { tr } = useI18n()
  // The server owns inventory records (saved per record); keep the live list on this page only.
  const [records, setRecords] = useState(ctx.config.websiteInventory ?? [])
  if (p === "website" && !ctx.isAdmin) return <Forbidden />
  const title = p === "website" ? "Website Inventory" : "Legacy Action Plans"
  return <>
    <Header title={<><a className="crumb" href="#/objects/storage">Storage</a><span className="crumb">/</span>{title}</>} />
    <div className="card"><div className="set"><div className="set-inner" style={{ maxWidth: 960 }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title}</h1>
      {p === "website" ? <><p className="desc" style={{ color: "var(--f3)", margin: 0 }}>{tr("Danh sách URL duy nhất AI được phép đề xuất làm internal link.", "The only URLs AI may suggest as internal links.")}</p><WebsiteInventory records={records} railwayUrl={ctx.config.railwayUrl} onChange={setRecords} /></>
        : <LegacyArchive files={ctx.files.filter(isLegacyActionPlan)} />}
    </div></div></div>
  </>
}

function TableView({ ctx, o, rows, fields, sort, sortBy, onFoot }: { ctx: Ctx; o: Obj; rows: any[]; fields: Field[]; sort: { key: string; dir: string } | null; sortBy: (k: string) => void; onFoot: () => void }) {
  const { tr } = useI18n()
  const m = OBJ_META[o]
  if (!rows.length) return <div className="empty-state"><I n={m.icon} /><h3>{tr("Không có dữ liệu", "Nothing here")}</h3><span>{tr("Thử bộ lọc khác.", "Try another filter.")}</span></div>
  const groups: Array<{ label?: ReactNode; rows: any[] }> = o === "reviews" ? (Object.keys(HUMAN) as HumanStatus[]).map(k => ({ label: <HumanTag h={k} />, rows: rows.filter(r => r.human.status === k) }))
    : o === "storage" ? STORAGE_GROUPS.map(([g, c]) => ({ label: <Tag c={c}>{g}</Tag>, rows: rows.filter(r => r.g === g) }))
    : o === "batches" ? [...new Set(rows.map(r => r.planId))].map(id => ({ label: ctx.plans.some(p => p.id === id) ? <PlanChip ctx={ctx} id={id} /> : <span className="muted">—</span>, rows: rows.filter(r => r.planId === id) }))
    : [{ rows }]
  const click = (r: any) => o === "reviews" ? ctx.setPanel({ kind: "review", id: r.id }) : o === "storage" ? (r.planId ? go(`#/object/plans/${enc(r.planId)}`) : ctx.setPanel({ kind: "doc", id: r.id })) : go(`#/object/${o}/${enc(r.id)}`)
  const name = (r: any) => {
    if (o === "storage") return <span className="rchip plain"><I n="file-description" />{r.name}</span>
    if (o === "reviews") return <span className="rchip plain"><Av name={r.title} />{r.title}</span>
    if (o === "batches") return <a className="rchip" href={`#/object/batches/${enc(r.id)}`}><I n="stack-2" />Batch {r.idx}</a>
    return <a className="rchip" href={`#/object/${o}/${enc(r.id)}`}><Av name={nameOf(o, r)} />{nameOf(o, r)}</a>
  }
  let n = 0
  return <>
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr>{fields.map((f, i) => <th key={f.key} className={i === 0 ? "first" : ""} aria-sort={sort?.key === f.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}><button className="th-btn" onClick={() => sortBy(f.key)}><I n={f.icon} />{f.label}{sort?.key === f.key && <> <I n={sort.dir === "asc" ? "arrow-up" : "arrow-down"} /></>}</button></th>)}</tr></thead>
      <tbody>{groups.map((g, gi) => <GroupRows key={gi} label={g.label} count={g.rows.length} span={fields.length}>
        {g.rows.map(r => <tr key={r.id} tabIndex={0} style={{ cursor: "pointer", animationDelay: `${Math.min(n++, 14) * 16}ms` }} onClick={() => click(r)} onKeyDown={e => { if (e.key === "Enter" && e.target === e.currentTarget) click(r) }}>
          {fields.map((f, i) => <td key={f.key} className={`${i === 0 ? "first" : ""}${f.num ? " num" : ""}`}>{f.key === "name" ? name(r) : f.render ? f.render(r) : f.text ? f.text(r) : r[f.key]}</td>)}
        </tr>)}
      </GroupRows>)}</tbody>
    </table></div>
    {(o !== "storage" || ctx.isAdmin) && o !== "batches" && <button type="button" className="foot" style={{ width: "100%", textAlign: "left", border: 0, background: "none", font: "inherit" }} onClick={onFoot}><I n={o === "reviews" ? "dice-5" : "plus"} /> {o === "storage" ? tr("Thêm tài liệu", "Add document") : o === "reviews" ? tr("Chọn ngẫu nhiên 1 bài", "Pick a random article") : "Add Plan"}</button>}
  </>
}
function GroupRows({ label, count, span, children }: { label?: ReactNode; count: number; span: number; children: ReactNode }) {
  return <>{label && <tr className="grp"><td className="first" colSpan={span}>{label} <span className="muted">{count}</span></td></tr>}{children}</>
}

const COLS = [
  { key: "queued", label: "Queued", color: "gray", test: (a: CrmArticle) => a.status === "queued" },
  ...GATES.map(g => ({ key: g.short, label: g.label, color: g.color, test: (a: CrmArticle) => a.status === "running" && a.gate === g.id })),
  { key: "failed", label: "Failed (No-pass)", color: "red", test: (a: CrmArticle) => a.status === "failed" },
  { key: "completed", label: "Completed", color: "green", test: (a: CrmArticle) => a.status === "completed" },
]
function RetryButton({ ctx, a, primary }: { ctx: Ctx; a: CrmArticle; primary?: boolean }) {
  const { tr } = useI18n()
  if (!ctx.can("retry") || a.status !== "failed") return null
  const g = GATES[(a.failGate ?? 1) - 1]
  const run = (e: ReactMouseEvent) => {
    e.stopPropagation()
    // Batch failures resume on the server; an AI Review failure re-runs the review gate.
    const job = () => a.a.batchStatus === "failed" && a.batchId ? ctx.onRetry(a.a) : ctx.onRerun(a.a, (a.failGate ?? 4) as RerunGate)
    void trackHandoff(e.timeStamp, job).then(() => toast(tr(`Đã gửi chạy lại ${g.short}`, `Retry ${g.short} sent`))).catch(err => toastErr(err))
  }
  return <button className={`btn${primary ? " primary" : ""}`} aria-label={`Retry ${g.short}`} onClick={run}><I n="refresh" /><span>Retry {g.short}</span></button>
}
function KanbanView({ ctx, rows }: { ctx: Ctx; rows: CrmArticle[] }) {
  return <div className="kb">{COLS.map((col, ci) => {
    const items = rows.filter(col.test)
    return <section key={col.key} className="kcol" aria-label={col.label} style={{ animationDelay: `${ci * 45}ms` }}>
      <div className="khead"><Tag c={col.color}>{col.label}</Tag><span className="n">{items.length}</span>{col.key === "completed" && <span className="sum">{items.filter(a => a.human.status === "approved").length} human ✓</span>}</div>
      {items.map((a, i) => <div key={a.id} className="kcard" role="link" tabIndex={0} style={{ cursor: "pointer", animationDelay: `${ci * 45 + Math.min(i, 8) * 30}ms` }} onClick={() => go(`#/object/articles/${enc(a.id)}`)} onKeyDown={e => { if (e.key === "Enter") go(`#/object/articles/${enc(a.id)}`) }}>
        <div className="kt"><Av name={a.title} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span></div>
        <div className="kf"><I n="progress" /><GateBar a={a} /></div>
        <div className="kf"><I n="category" /><TypeTag t={a.type} /></div>
        {a.planId && <div className="kf"><I n="list-details" /><PlanChip ctx={ctx} id={a.planId} /></div>}
        {a.score != null && <div className="kf"><I n="gauge" /><ScoreTag s={a.score} t={ctx.settings.threshold} />{a.status === "completed" && <HumanTag h={a.human.status} />}</div>}
        {a.status === "failed" && <><div className="kf" style={{ color: "var(--danger)" }}><I n="alert-triangle" />{a.failReason}</div><RetryButton ctx={ctx} a={a} /></>}
        {a.awaiting && <><div className="kf" style={{ color: "var(--c-orange)" }}><I n="user-check" />Editorial · chờ duyệt outline</div><button className="btn" onClick={e => { e.stopPropagation(); go(`#/object/articles/${enc(a.id)}?tab=manual`) }}><I n="list-check" /><span>Duyệt outline</span></button></>}
      </div>)}
      {col.key === "queued" && <button className="kadd" onClick={() => ctx.setPanel({ kind: "plan" })}><I n="plus" /> Add Plan</button>}
    </section>
  })}</div>
}

/* ─── record show pages ────────────────────────────────────────────────── */

const Frow = ({ icon, label, children }: { icon: string; label: ReactNode; children?: ReactNode }) =>
  <div className="frow"><div className="flabel"><I n={icon} />{label}</div><div className="fval">{children || <span className="empty">Empty</span>}</div></div>
function ShowShell({ crumbs, actions, left, tabs, tab, setTab, children }: { crumbs: ReactNode; actions?: ReactNode; left: ReactNode; tabs: Array<[string, string, string, (number | string)?]>; tab: string; setTab: (t: string) => void; children: ReactNode }) {
  return <>
    <Header title={crumbs} actions={actions} />
    <div className="card"><div className="show"><aside className="show-left">{left}</aside><section className="show-right">
      <div className="tabs" role="tablist">{tabs.map(([k, i, l, n]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? " on" : ""}`} onClick={() => { if (k !== tab && confirmDiscard()) setTab(k) }}><I n={i} />{l}{n ? <span className="n">{n}</span> : null}</button>)}</div>
      <div className="tab-body" key={tab}>{children}</div>
    </section></div></div>
  </>
}

async function copyToDocs(a: Article) {
  const markdown = readable(a.draft)
  if (navigator.clipboard.write && typeof ClipboardItem !== "undefined")
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([markdownToHtml(markdown)], { type: "text/html" }), "text/plain": new Blob([markdown], { type: "text/plain" }) })])
  else await navigator.clipboard.writeText(markdown)
}

function ArticleShow({ ctx, id, initialTab }: { ctx: Ctx; id: string; initialTab: string }) {
  const { tr } = useI18n()
  const ago = useAgo()
  const [tab, setTab] = useState(initialTab)
  const a = ctx.list.find(x => x.id === id)
  if (!a) return <NotFound t="Article not found" />
  const order = lastArticleOrder.includes(a.id) ? lastArticleOrder.filter(x => ctx.list.some(y => y.id === x)) : ctx.list.map(x => x.id)
  const idx = order.indexOf(a.id)
  const ideas = a.a.coreIdeaSuggestions ?? []
  const selected = ideas.find(i => i.id === a.a.selectedCoreIdeaId)
  const failed = (a.a.qualityReport?.checks ?? []).filter(c => c.status !== "pass").length
  const actions = <>
    <button className="icon-btn" aria-label={tr("Bài trước", "Previous")} disabled={idx <= 0} onClick={() => go(`#/object/articles/${enc(order[idx - 1])}`)}><I n="chevron-up" /></button>
    <button className="icon-btn" aria-label={tr("Bài sau", "Next")} disabled={idx >= order.length - 1} onClick={() => go(`#/object/articles/${enc(order[idx + 1])}`)}><I n="chevron-down" /></button>
    <RetryButton ctx={ctx} a={a} primary />
    {a.status === "completed" && ctx.can("review") && <button className="btn" aria-label="Review" onClick={() => ctx.setPanel({ kind: "review", id: a.id })}><I n="checklist" /><span>Review</span></button>}
    {a.a.draft?.trim() && ctx.can("copy") && <button className="btn" aria-label="Copy to Docs" onClick={() => void copyToDocs(a.a).then(() => toast(tr("Đã copy (giữ heading, bảng, link) để dán vào Google Docs", "Copied for Google Docs"))).catch(err => toastErr(err))}><I n="brand-google-drive" /><span>Copy to Docs</span></button>}
    {ctx.isAdmin && <button className="icon-btn" aria-label={tr("Xoá bài viết", "Delete article")} onClick={() => ctx.onDeleteArticle(a.a)}><I n="trash" /></button>}
  </>
  const left = <>
    <div className="rec-head"><Av name={a.title} xl /><h1>{a.title}</h1><div className="sub">Topic: {a.topic}</div><div><GateBar a={a} /></div></div>
    <div className="fields">
      <Frow icon="progress-check" label="Status"><StatusTag k={a.status} /></Frow>
      <Frow icon="git-merge" label="Gate"><GateTag a={a} /></Frow>
      {a.status === "failed" && <Frow icon="alert-triangle" label="Fail reason"><span style={{ color: "var(--danger)" }}>{a.failReason}</span></Frow>}
      <Frow icon="gauge" label="AI score">{a.score != null && <><ScoreTag s={a.score} t={ctx.settings.threshold} /><span className="muted" style={{ color: "var(--f3)" }}>&nbsp;/ {tr("ngưỡng", "threshold")} {ctx.settings.threshold}%</span></>}</Frow>
      <Frow icon="user-check" label="Human review">{a.status === "completed" ? <HumanTag h={a.human.status} /> : <span className="empty">—</span>}</Frow>
      <Frow icon="category" label="Type"><TypeTag t={a.type} /></Frow>
      <Frow icon="key" label="Keyword">{a.keyword}</Frow>
      <Frow icon="list-details" label="Content Plan"><PlanChip ctx={ctx} id={a.planId} /></Frow>
      <Frow icon="stack-2" label="Batch"><BatchChip ctx={ctx} a={a} /></Frow>
      <Frow icon="circle-check" label={tr("Option được chọn", "Selected option")}>{selected && `${selected.title} · ${Math.round((selected.rating?.overall ?? 0) * 10)}%`}</Frow>
      <Frow icon="calendar" label="Started">{a.startedAt && <span className="muted" style={{ color: "var(--f3)" }}>{ago(a.startedAt)}</span>}</Frow>
    </div>
  </>
  const tabs: Array<[string, string, string, (number | string)?]> = [["final", "file-text", "Final Article"], ["review", "checklist", "AI Review", failed || ""], ["history", "history", "Generation History", [ideas.length, a.a.outline?.length, a.a.draft?.trim()].filter(Boolean).length], ["timeline", "timeline-event", "Timeline"]]
  if (ctx.can("manual")) tabs.push(["manual", "adjustments", tr("Chế độ thủ công", "Manual mode")])
  return <ShowShell crumbs={<><a className="crumb" href="#/objects/articles">Articles</a><span className="crumb">/</span>{a.title}</>} actions={actions} left={left} tabs={tabs} tab={tab} setTab={setTab}>
    {tab === "final" && <FinalTab a={a} />}
    {tab === "review" && <ReviewTab ctx={ctx} a={a} />}
    {tab === "history" && <HistoryTab ctx={ctx} a={a} />}
    {tab === "timeline" && <TimelineTab ctx={ctx} a={a} />}
    {tab === "manual" && <ManualTab article={a.a} settings={ctx.settings} files={ctx.files} config={ctx.config} onUpdateArticle={ctx.onUpdateArticle} onRerun={ctx.onRerun} onToggleComplete={ctx.onToggleComplete} onMigrateLegacy={ctx.onMigrateLegacy} />}
  </ShowShell>
}

function FinalTab({ a }: { a: CrmArticle }) {
  const { tr } = useI18n()
  if (!a.a.draft?.trim()) return <div className="empty-state"><I n="hourglass" /><h3>{tr("Chưa có bài", "No article yet")}</h3><span>{tr("Bài xuất hiện khi G3 Final Article chọn được option đạt ngưỡng.", "Appears once G3 Final Article selects an option above the threshold.")}</span></div>
  const h1 = a.a.draft.match(/^#\s+(.+)$/m)?.[1]?.trim() || a.title
  return <div style={{ maxWidth: 720 }}>
    <div className="box" style={{ marginBottom: 20 }}>
      <div className="box-row"><div className="grow"><div className="s">Meta title · {h1.length} chars</div>{h1}</div></div>
      
    </div>
    <article className="crm-draft" dangerouslySetInnerHTML={{ __html: markdownToHtml(readable(a.a.draft)) }} />
  </div>
}

const GROUP_COLOR: Record<string, string> = { structure: "blue", seo: "purple", content: "turq", checklist: "pink" }
function ReviewTab({ ctx, a }: { ctx: Ctx; a: CrmArticle }) {
  const { tr, language } = useI18n()
  const checks = a.a.qualityReport?.checks ?? []
  if (!checks.length) return <div className="empty-state"><I n="hourglass" /><h3>{tr("Chưa có AI Review", "No AI Review yet")}</h3><span>{tr("AI Review chạy ở bước AI Approval sau G3.", "AI Review runs at the AI Approval step after G3.")}</span></div>
  const met = checks.filter(c => c.status === "pass").length, pass = a.status === "completed"
  const groups = QC_GROUPS.filter(g => checks.some(c => qcGroupOf(c.id) === g.key))
  return <div className="dash" style={{ padding: 0, gridTemplateColumns: "repeat(4,1fr)" }}>
    <div className="widget"><h4><I n="gauge" />Score</h4><div className="kpi" style={{ color: pass ? "var(--c-green)" : "var(--danger)" }}>{a.score}%</div><div className="kpi-sub">{met}/{checks.length} · {tr("ngưỡng", "threshold")} {ctx.settings.threshold}% <Tag c="orange">{tr("chưa chốt", "not final")}</Tag></div></div>
    {groups.map(g => { const it = checks.filter(c => qcGroupOf(c.id) === g.key), ok = it.filter(c => c.status === "pass").length; return <div key={g.key} className="widget"><h4><I n="list-check" />{language === "vi" ? g.vi : g.en}</h4><div className="kpi">{ok}/{it.length}</div><div className="kpi-sub">{ok === it.length ? tr("đạt toàn bộ", "all met") : `${it.length - ok} ${tr("tiêu chí chưa đạt", "not met")}`}</div></div> })}
    <div className="widget w4"><h4><I n="list-check" />{tr("Kết quả theo tiêu chí", "Criteria results")}</h4><table className="tbl"><thead><tr><th style={{ position: "static" }}>Section</th><th style={{ position: "static" }}>Criterion</th><th style={{ position: "static" }}>Result</th><th style={{ position: "static" }}>Note</th></tr></thead><tbody>
      {checks.map(c => { const g = QC_GROUPS.find(x => x.key === qcGroupOf(c.id))!; return <tr key={c.id}><td><Tag c={GROUP_COLOR[g.key]}>{language === "vi" ? g.vi : g.en}</Tag></td><td>{(language === "vi" && QC_LABELS_VI[c.id]) || c.label}</td><td>{c.status === "pass" ? <Tag c="green">Pass</Tag> : c.status === "warning" ? <Tag c="orange">Warn</Tag> : <Tag c="red">Fail</Tag>}</td><td className="muted" style={{ whiteSpace: "normal", maxWidth: 420 }}>{c.status === "pass" ? "" : c.reason}</td></tr> })}
    </tbody></table></div>
  </div>
}

function stepFiles(ctx: Ctx, step: number) {
  const access = ctx.config.stepConfigs[step]?.fileAccess
  return ctx.files.filter(f => access?.kb?.includes(f.id) || access?.rules?.includes(f.id))
}
function reviewerPackage(ctx: Ctx, gate: number, article?: Article) {
  if (gate === 1) return ["Core Idea rating (Outline Generator)", "Checklist Gate 1–2 (chưa có)"]
  if (gate === 2) return ["Outline review (MD structure)", "Checklist Gate 1–2 (chưa có)"]
  return ["Universal QC", ...step4ChecklistDocs(ctx.files, ctx.config, article ?? {}).map(d => d.name)]
}

function HistoryTab({ ctx, a }: { ctx: Ctx; a: CrmArticle }) {
  const { tr, language } = useI18n()
  const x = a.a, t = ctx.settings.threshold
  const runs: Array<{ g: number; at?: string | null; options: Array<{ id: string; out: ReactNode; met: string; score: number | null }>; selectedId?: string }> = []
  if (x.coreIdeaSuggestions?.length) runs.push({ g: 1, at: x.coreIdeaScannedAt, selectedId: x.selectedCoreIdeaId, options: x.coreIdeaSuggestions.map(i => ({ id: i.id, out: <>{i.title} <span className="muted">· {i.angleLabel}</span></>, met: "—", score: Math.round((i.rating?.overall ?? 0) * 10) })) })
  if (x.outline?.length) runs.push({ g: 2, at: x.outlineScannedAt, selectedId: "outline", options: [{ id: "outline", out: <>{x.outlineStructure?.name ?? "Outline"} <span className="muted">· {x.outline.filter(s => s.level === "h2").length} H2</span></>, met: "—", score: null }] })
  if (x.draft?.trim()) runs.push({ g: 3, at: x.draftScannedAt, selectedId: "draft", options: [{ id: "draft", out: <>Draft A <span className="muted">· {x.draft.split(/\s+/).filter(Boolean).length} words</span></>, met: x.qualityReport ? `${x.qualityReport.checks.filter(c => c.status === "pass").length}/${x.qualityReport.checks.length}` : "—", score: a.score }] })
  if (!runs.length) return <div className="empty-state"><I n="history" /><h3>{tr("Chưa có gate nào xong", "No gate finished yet")}</h3></div>
  return <>{runs.map(run => {
    const G = GATES[run.g - 1], files = stepFiles(ctx, G.step)
    return <div key={run.g} className="widget" style={{ marginBottom: 12 }}>
      <h4><Tag c={G.color}>{G.label}</Tag><span style={{ marginLeft: "auto", color: "var(--f3)", fontWeight: 400 }}>{fmtTime(run.at, language)}</span>{run.options.length > 1 ? <Tag c="green">{run.options.length} options</Tag> : <Tag c="gray">1 option</Tag>}</h4>
      <div className="frow"><div className="flabel"><I n="package" />Executor</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{files.length ? files.map(f => <Tag key={f.id} c="blue">{f.name}</Tag>) : <span className="empty">—</span>}</div></div>
      <div className="frow"><div className="flabel"><I n="checklist" />Reviewer</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{reviewerPackage(ctx, run.g, x).map(d => <Tag key={d} c="purple">{d}</Tag>)}</div></div>
      <div className="frow"><div className="flabel"><I n="truck-delivery" />Retrieved</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{files.map(f => <span key={f.id} className="rchip"><I n="file-description" />{f.name}</span>)}</div></div>
      <table className="tbl" style={{ border: "1px solid var(--b2)", borderRadius: 6 }}><thead><tr><th style={{ position: "static" }}>Option</th><th style={{ position: "static" }}>Output</th><th style={{ position: "static" }}>Criteria</th><th style={{ position: "static" }}>Score</th></tr></thead><tbody>
        {run.options.map((o, i) => <tr key={o.id} className={o.id === run.selectedId ? "sel" : ""}><td><b>{"ABCDEFGH"[i] ?? i + 1}</b>{o.id === run.selectedId && <> <Tag c="green">selected</Tag></>}</td><td style={{ maxWidth: 360 }}>{o.out}</td><td className="num">{o.met}</td><td><ScoreTag s={o.score} t={t} /></td></tr>)}
      </tbody></table>
    </div>
  })}</>
}

function TimelineTab({ ctx, a }: { ctx: Ctx; a: CrmArticle }) {
  const { tr } = useI18n()
  const ago = useAgo()
  const x = a.a, plan = ctx.plans.find(p => p.id === a.planId), batch = ctx.batches.find(b => b.id === a.batchId)
  const ev: Array<{ icon: string; who: string; what: ReactNode; at?: string | null }> = [{ icon: "plus", who: "Content Operator", what: <>{tr("thêm topic vào", "added topic to")} <b>{plan?.name ?? tr("bài lẻ", "single article")}</b></>, at: x.createdAt }]
  if (x.batchStartedAt) ev.push({ icon: "player-play", who: "Pipeline", what: <>{tr("bắt đầu", "started")} <b>Batch {batch?.idx}</b></>, at: x.batchStartedAt })
  if (x.coreIdeaScannedAt) ev.push({ icon: GATES[0].icon, who: "Reviewer Agent", what: <>{x.selectedCoreIdeaId ? tr("chọn ý tưởng ở", "selected an idea at") : tr("tạo option ở", "drafted options at")} <Tag c={GATES[0].color}>{GATES[0].label}</Tag></>, at: x.coreIdeaScannedAt })
  if (x.outlineScannedAt) ev.push({ icon: GATES[1].icon, who: "Executor Agent", what: <>{tr("tạo outline ở", "produced the outline at")} <Tag c={GATES[1].color}>{GATES[1].label}</Tag></>, at: x.outlineScannedAt })
  if (x.draftScannedAt) ev.push({ icon: GATES[2].icon, who: "Executor Agent", what: <>{tr("viết bài ở", "wrote the article at")} <Tag c={GATES[2].color}>{GATES[2].label}</Tag></>, at: x.draftScannedAt })
  if (x.qualityReport?.checkedAt) ev.push({ icon: "shield-check", who: "Reviewer Agent", what: <>{tr("chấm AI Review", "scored AI Review")} <ScoreTag s={a.score} t={ctx.settings.threshold} /></>, at: x.qualityReport.checkedAt })
  if (a.human.status !== "not") ev.push({ icon: "user-check", who: person(a.human.reviewer), what: <>{tr("đánh dấu", "marked")} <HumanTag h={a.human.status} />{a.human.comment && <> · <span style={{ color: "var(--f3)" }}>{a.human.comment}</span></>}</>, at: a.human.at })
  if (x.batchError) ev.push({ icon: "alert-triangle", who: "Pipeline", what: <span style={{ color: "var(--danger)" }}>{x.batchError}</span>, at: x.updatedAt })
  ev.sort((p, q) => String(q.at).localeCompare(String(p.at)))
  return <div className="tl">{ev.map((e, i) => <div key={i} className="tl-item"><span className="dot"><I n={e.icon} /></span><span><b>{e.who}</b> {e.what}</span><span className="when">{ago(e.at)}</span></div>)}</div>
}

const ITEM_TYPE = { "comparison-seo": ["blue", "Comparison"], "editorial-originality": ["pink", "Editorial"], "needs-review": ["orange", "Needs review"] } as const
/** Every topic of the plan in plan order: its article when one exists, otherwise a not-started row. */
function PlanTopics({ ctx, p }: { ctx: Ctx; p: CrmPlan }) {
  const { tr } = useI18n()
  const items = p.plan.items ?? []
  const byItem = new Map(p.articles.map(a => [a.a.contentPlanItemId, a]))
  const pending = pendingItems(p)
  const orphans = p.articles.filter(a => !items.some(i => i.id === a.a.contentPlanItemId))
  const article = (a: CrmArticle) => <div key={a.id} className="list-row" role="link" tabIndex={0} onClick={() => go(`#/object/articles/${enc(a.id)}`)} onKeyDown={e => { if (e.key === "Enter") go(`#/object/articles/${enc(a.id)}`) }}><TypeTag t={a.type} /><span className="grow">{a.title}</span><GateBar a={a} /><StatusTag k={a.status} /></div>
  return <div>
    {pending.length > 0 && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "var(--f3)" }}>
      <I n="info-circle" /><span className="grow">{tr(`${pending.length} topic chưa chạy`, `${pending.length} topics not started`)} · Comparison {pending.filter(i => i.type === "comparison-seo").length} · Editorial {pending.filter(i => i.type !== "comparison-seo").length}</span>
      {ctx.can("plans") && <button className="btn primary" onClick={() => ctx.setPanel({ kind: "run-items", id: p.id })}><I n="player-play" />{tr("Chạy topic chưa xử lý", "Run unprocessed topics")}</button>}
    </div>}
    {items.map(item => { const a = byItem.get(item.id); if (a) return article(a); const [c, l] = ITEM_TYPE[item.type] ?? ITEM_TYPE["needs-review"]
      return <div key={item.id} className="list-row" style={{ cursor: "default" }}><Tag c={c}>{l}</Tag><span className="grow" style={{ color: "var(--f2)" }}>{item.title}{item.keywords?.length ? <span className="muted" style={{ color: "var(--f3)" }}> · {item.keywords.slice(0, 3).join(", ")}</span> : null}</span><Tag c="gray">{item.status === "archived" ? "Archived" : tr("Chưa chạy", "Not started")}</Tag></div> })}
    {orphans.map(article)}
    {!items.length && !orphans.length && <div className="empty-state"><I n="file-text" /><h3>{tr("Plan chưa có topic", "This plan has no topics")}</h3></div>}
  </div>
}

function PlanShow({ ctx, id }: { ctx: Ctx; id: string }) {
  const { tr } = useI18n()
  const ago = useAgo()
  const p = ctx.plans.find(x => x.id === id)
  // A plan without batches opens on its topics, where "Run unprocessed topics" lives.
  const [tab, setTab] = useState(() => p && ctx.batches.some(b => b.planId === p.id) ? "batches" : "articles")
  if (!p) return <NotFound t="Plan not found" />
  const st = planStats(p.articles), bs = ctx.batches.filter(b => b.planId === p.id)
  const archived = p.plan.status === "archived"
  // Plans with articles can only be archived (history is kept); empty plans can be deleted.
  const removePlan = async (eventTimeStamp: number) => {
    try {
      if (p.articles.length) {
        const next = await trackHandoff(eventTimeStamp, () => updateContentPlanStatus(p.id, archived ? "active" : "archived", ctx.config.railwayUrl))
        ctx.onContentPlansChange([next])
        toast(archived ? tr("Đã bỏ lưu trữ plan", "Plan restored") : tr("Đã lưu trữ plan", "Plan archived"))
      } else {
        if (!window.confirm(tr(`Xoá vĩnh viễn Content Plan "${p.name}"? Thao tác này không thể hoàn tác.`, `Permanently delete the Content Plan "${p.name}"? This cannot be undone.`))) return
        // Start after the confirm dialog so think time is not counted as click latency.
        await trackHandoff(performance.now(), () => deleteContentPlan(p.id, ctx.config.railwayUrl))
        ctx.onContentPlansChange([], p.id)
        go("#/objects/plans")
        toast(tr("Đã xoá plan", "Plan deleted"))
      }
    } catch (err) { toastErr(err) }
  }
  const paused = bs.length > 0 && bs.some(b => b.paused) && !bs.some(b => b.status === "running" && !b.paused)
  const togglePause = async (eventTimeStamp: number) => {
    try {
      await trackHandoff(eventTimeStamp, async () => { for (const b of bs) if (b.status !== "completed") await (paused ? db.startBatch(b.id) : db.pauseBatch(b.id)) })
      toast(paused ? tr("Đã tiếp tục", "Resumed") : tr("Đã tạm dừng", "Paused"))
    } catch (err) { toastErr(err) }
  }
  const left = <><div className="rec-head"><Av name={p.name} xl /><h1>{p.name}</h1><div className="sub">{tr("Tạo", "Added")} {ago(p.created)}</div></div><div className="fields">
    <Frow icon="progress-check" label="Status">{archived ? <Tag c="gray">{tr("Đã lưu trữ", "Archived")}</Tag> : paused ? <Tag c="orange">{tr("Tạm dừng", "Paused")}</Tag> : st.n && st.c === st.n ? <Tag c="green">{tr("Xong", "Done")}</Tag> : st.n ? <Tag c="blue">{tr("Đang chạy", "Running")}</Tag> : <Tag c="gray">{tr("Chưa chạy", "Not started")}</Tag>}</Frow>
    <Frow icon="file-text" label="Articles">{st.n} · <span style={{ color: "var(--c-green)" }}>{st.c} AI Approved</span></Frow>
    <Frow icon="alert-triangle" label="Failed">{String(st.f)}</Frow>
    <Frow icon="list" label="Topics">{String(p.plan.totalArticles)}</Frow>
    <Frow icon="stack-2" label="Batches">{String(bs.length)}</Frow>
    <Frow icon="layout-rows" label="Per batch">{String(p.perBatch)}</Frow>
    <Frow icon="arrows-split" label="Max parallel">{String(ctx.settings.maxParallel)}</Frow>
  </div></>
  return <ShowShell crumbs={<><a className="crumb" href="#/objects/plans">Content Plans</a><span className="crumb">/</span>{p.name}</>}
    actions={<>{bs.length > 0 && <button className="btn" aria-label={paused ? tr("Tiếp tục", "Resume") : tr("Tạm dừng", "Pause")} onClick={e => void togglePause(e.timeStamp)}><I n={paused ? "player-play" : "player-pause"} /><span>{paused ? tr("Tiếp tục", "Resume") : tr("Tạm dừng", "Pause")}</span></button>}
      {ctx.can("plans") && (p.articles.length
        ? <button className="btn" aria-label={archived ? tr("Bỏ lưu trữ", "Restore") : tr("Lưu trữ", "Archive")} onClick={e => void removePlan(e.timeStamp)}><I n={archived ? "archive-off" : "archive"} /><span>{archived ? tr("Bỏ lưu trữ", "Restore") : tr("Lưu trữ", "Archive")}</span></button>
        : <button className="icon-btn" aria-label={tr("Xoá plan", "Delete plan")} onClick={e => void removePlan(e.timeStamp)}><I n="trash" /></button>)}</>}
    left={left} tabs={[["batches", "stack-2", "Batches", bs.length], ["articles", "file-text", "Articles", Math.max(st.n, (p.plan.items ?? []).length)]]} tab={tab} setTab={setTab}>
    {tab === "batches" ? <>
      <p style={{ color: "var(--f3)", margin: "0 0 10px" }}><I n="info-circle" /> {tr("Mỗi batch chạy tối đa", "Each batch runs at most")} {ctx.settings.maxParallel} {tr("bài cùng lúc.", "articles at a time.")}</p>
      {bs.length ? <table className="tbl" style={{ border: "1px solid var(--b2)", borderRadius: 6 }}><thead><tr><th style={{ position: "static" }}>Batch</th><th style={{ position: "static" }}>Schedule</th><th style={{ position: "static" }}>Status</th><th style={{ position: "static" }}>AI Approved</th></tr></thead><tbody>
        {bs.map(b => <tr key={b.id} tabIndex={0} style={{ cursor: "pointer" }} onClick={() => go(`#/object/batches/${enc(b.id)}`)} onKeyDown={e => { if (e.key === "Enter") go(`#/object/batches/${enc(b.id)}`) }}><td><span className="rchip"><I n="stack-2" />Batch {b.idx}</span></td><td>{fmtTime(b.schedule)}</td><td>{b.paused ? <Tag c="orange">Paused</Tag> : <StatusTag k={b.status} />}</td><td>{b.done}/{b.articles.length}</td></tr>)}
      </tbody></table> : <div className="empty-state"><I n="stack-2" /><h3>{tr("Chưa có batch", "No batches yet")}</h3></div>}
    </> : <PlanTopics ctx={ctx} p={p} />}
  </ShowShell>
}

function BatchShow({ ctx, id }: { ctx: Ctx; id: string }) {
  const { tr } = useI18n()
  const b = ctx.batches.find(x => x.id === id)
  if (!b) return <NotFound t="Batch not found" />
  const p = ctx.plans.find(x => x.id === b.planId)
  const running = b.articles.some(a => a.a.batchStatus === "running")
  const control = async (eventTimeStamp: number) => { try { await trackHandoff(eventTimeStamp, () => running ? db.pauseBatch(b.id) : db.startBatch(b.id)); toast(running ? "Paused" : "Running") } catch (err) { toastErr(err) } }
  const zip = () => { const blob = buildBatchZip(b.articles.map(a => a.a)); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `batch-${b.idx}.zip`; link.click(); URL.revokeObjectURL(url) }
  const left = <><div className="rec-head"><span className="av xl" style={{ background: "#7948af" }}><I n="stack-2" /></span><h1>Batch {b.idx}</h1><div className="sub">{p?.name}</div></div><div className="fields">
    <Frow icon="progress-check" label="Status">{b.paused ? <Tag c="orange">Paused</Tag> : <StatusTag k={b.status} />}</Frow>
    <Frow icon="list-details" label="Content Plan"><PlanChip ctx={ctx} id={b.planId} /></Frow>
    <Frow icon="calendar-event" label="Schedule">{fmtTime(b.schedule)}</Frow>
    <Frow icon="circle-check" label="AI Approved">{`${b.done}/${b.articles.length}`}</Frow>
  </div><p style={{ color: "var(--f3)", fontSize: 12 }}>{tr("Mỗi bài chạy độc lập; output được chọn ở gate trước là input duy nhất của gate sau. Retry chỉ chạy lại từ gate bị lỗi.", "Each article runs independently; a gate's selected output is the only input to the next. Retry re-runs only from the failed gate.")}</p></>
  return <ShowShell crumbs={<><a className="crumb" href="#/objects/batches">Batches</a><span className="crumb">/</span>{p?.name} · Batch {b.idx}</>}
    actions={<>{b.status !== "completed" && <button className="btn" aria-label={running ? tr("Tạm dừng", "Pause") : tr("Chạy", "Run")} onClick={e => void control(e.timeStamp)}><I n={running ? "player-pause" : "player-play"} /><span>{running ? tr("Tạm dừng", "Pause") : tr("Chạy", "Run")}</span></button>}<button className="btn" aria-label="ZIP" onClick={zip}><I n="download" /><span>ZIP</span></button>{ctx.isAdmin && <button className="icon-btn" aria-label={tr("Xoá batch", "Delete batch")} onClick={() => ctx.onDeleteArticle(b.articles[0].a, true)}><I n="trash" /></button>}</>}
    left={left} tabs={[["articles", "file-text", "Articles", b.articles.length]]} tab="articles" setTab={() => {}}>
    <div>{b.articles.map(a => <div key={a.id} className="list-row" role="link" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" && e.target === e.currentTarget) go(`#/object/articles/${enc(a.id)}`) }} onClick={() => go(`#/object/articles/${enc(a.id)}`)} style={{ height: "auto", minHeight: 48, padding: "8px 12px" }}>
      <span className="grow"><b style={{ fontWeight: 500 }}>{a.title}</b><br /><span style={{ color: "var(--f3)", fontSize: 12 }}>{a.keyword}</span></span><GateBar a={a} /><StatusTag k={a.status} /><RetryButton ctx={ctx} a={a} />
    </div>)}</div>
  </ShowShell>
}

/* ─── side panels ──────────────────────────────────────────────────────── */

function SidePanel({ ctx, title, icon, extra, children }: { ctx: Ctx; title: ReactNode; icon: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return <>
    <div className="sp-overlay" onClick={() => { if (confirmDiscard()) ctx.setPanel(null) }} />
    <div className="sp" role="dialog" aria-label={typeof title === "string" ? title : undefined}>
      <div className="sp-head"><span className="t">{icon}{title}</span>{extra}<button className="icon-btn" aria-label="Close" onClick={() => { if (confirmDiscard()) ctx.setPanel(null) }}><I n="x" /></button></div>
      <div className="sp-body">{children}</div>
    </div>
  </>
}

/** Split plan topics into batches by type and start them. needs-review topics run as editorial so none is dropped. */
async function startPlanItems(ctx: Ctx, plan: ContentPlan, items: ContentPlanItem[], perBatch: number, structure: OutlineStructureSnapshot, onBatch: (n: number) => void) {
  const byType: Array<["comparison-seo" | "editorial-originality", ContentPlanItem[]]> = [["comparison-seo", items.filter(i => i.type === "comparison-seo")], ["editorial-originality", items.filter(i => i.type !== "comparison-seo")]]
  let made = 0
  for (const [type, group] of byType)
    for (let i = 0; i < group.length; i += perBatch) {
      const chunk = group.slice(i, i + perBatch)
      onBatch(++made)
      await ctx.onCreate(type, plan, chunk, ([5, 10, 15, 20].find(n => n >= chunk.length) ?? 20) as 5 | 10 | 15 | 20, structure, { forceBatch: true, select: false })
    }
  return made
}

/** Start the topics of an existing plan that have no article yet. */
function RunItemsPanel({ ctx, planId }: { ctx: Ctx; planId: string }) {
  const { tr } = useI18n()
  const p = ctx.plans.find(x => x.id === planId)
  const [per, setPer] = useState(ctx.settings.perBatch)
  const [structure, setStructure] = useState<OutlineStructureSnapshot | null>(null)
  const [busy, setBusy] = useState("")
  if (!p) return null
  const pending = pendingItems(p)
  const perBatch = Math.max(1, Math.min(20, per || 1))
  const count = (t: ContentPlanItem["type"]) => pending.filter(i => i.type === t).length
  const batches = Math.ceil(count("comparison-seo") / perBatch) + Math.ceil((pending.length - count("comparison-seo")) / perBatch)
  const run = async (eventTimeStamp: number) => {
    if (!structure) return toast(tr("Chọn cấu trúc outline trước khi chạy.", "Choose an outline structure first."))
    setBusy(tr("Đang tạo batch…", "Creating batches…"))
    try {
      await trackHandoff(eventTimeStamp, () => startPlanItems(ctx, p.plan, pending, perBatch, structure, n => setBusy(`${tr("Đang tạo batch", "Creating batch")} ${n}…`)))
      ctx.setPanel(null)
      toast(tr(`Đã bắt đầu ${pending.length} topic`, `Started ${pending.length} topics`))
    } catch (err) { toastErr(err) } finally { setBusy("") }
  }
  return <SidePanel ctx={ctx} title={tr("Chạy topic chưa xử lý", "Run unprocessed topics")} icon={<I n="player-play" />}>
    <div className="sp-title">{p.name}</div>
    <div className="fields" style={{ paddingTop: 0 }}>
      <div className="frow"><div className="flabel"><I n="list" />Topics</div><div className="fval">{pending.length} · <Tag c="blue">Comparison {count("comparison-seo")}</Tag>&nbsp;<Tag c="pink">Editorial {count("editorial-originality")}</Tag>{count("needs-review") > 0 && <>&nbsp;<Tag c="orange">Needs review {count("needs-review")}</Tag></>}</div></div>
      <div className="frow"><div className="flabel"><I n="layout-rows" />Per batch</div><div className="fval"><input aria-label="Per batch" type="number" min={1} max={20} value={per} onChange={e => setPer(+e.target.value)} /></div></div>
      <div className="frow"><div className="flabel"><I n="stack-2" />Batches</div><div className="fval"><b>{batches} batch</b></div></div>
    </div>
    {pending.length > count("comparison-seo") && <div style={{ color: "var(--f3)", margin: "4px 0 8px" }}>{tr("Bài Editorial (kể cả \"Needs review\") chạy G1–G2 rồi dừng chờ người duyệt outline trong Chế độ thủ công, sau đó mới viết draft.", "Editorial articles (including \"Needs review\") run G1–G2, then wait for a person to approve the outline in Manual mode before drafting.")}</div>}
    <div style={{ margin: "4px 0 12px" }}><StructureSelect files={ctx.files} allowedIds={ctx.config.stepConfigs[3]?.fileAccess?.rules ?? []} value={structure} onChange={setStructure} disabled={Boolean(busy)} /></div>
    <button className="btn primary lg" style={{ width: "100%", justifyContent: "center" }} disabled={Boolean(busy) || !pending.length} onClick={e => void run(e.timeStamp)}><I n={busy ? "loader-2" : "player-play"} />{busy || "Generate"}</button>
  </SidePanel>
}

const pendingItems = (p: CrmPlan) => { const used = new Set(p.articles.map(a => a.a.contentPlanItemId)); return (p.plan.items ?? []).filter(i => !used.has(i.id) && i.status !== "archived") }

function AddPlanPanel({ ctx }: { ctx: Ctx }) {
  const { tr } = useI18n()
  const [name, setName] = useState("")
  const [per, setPer] = useState(ctx.settings.perBatch)
  const [par, setPar] = useState(ctx.settings.maxParallel)
  const [topics, setTopics] = useState("")
  const [source, setSource] = useState<"paste" | "file" | "google_doc" | "google_sheet">("paste")
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState("")
  const [structure, setStructure] = useState<OutlineStructureSnapshot | null>(null)
  const [busy, setBusy] = useState("")
  const nameRef = useRef<HTMLInputElement>(null)
  const importedRef = useRef<ContentPlan | null>(null)
  useEffect(() => nameRef.current?.focus(), [])
  const lines = topics.split("\n").map(t => t.trim()).filter(Boolean)
  const perBatch = Math.max(1, Math.min(20, per || 1))
  const create = async (eventTimeStamp: number) => {
    if (source === "paste" && !lines.length) return toast(tr("Cần ít nhất một topic", "At least one topic is required"))
    if (source === "file" && !file) return toast(tr("Chọn file Content Plan", "Choose a Content Plan file"))
    if (source.startsWith("google_") && !url.trim()) return toast(tr("Dán link Google", "Paste the Google link"))
    if (!structure) return toast(tr("Chọn cấu trúc outline trước khi chạy.", "Choose an outline structure first."))
    setBusy(tr("Đang import plan…", "Importing plan…"))
    try {
      const planId = await trackHandoff(eventTimeStamp, async () => {
      const railway = ctx.config.railwayUrl
      const planName = name.trim() || file?.name.replace(/\.[^.]+$/, "") || `Content Plan ${new Date().toLocaleDateString()}`
      const imported = importedRef.current = await importContentPlan(source === "file" ? { name: planName, sourceType: "file", file: file! } : source === "paste" ? { name: planName, sourceType: "paste", content: lines.join("\n") } : { name: planName, sourceType: source, url: url.trim() }, railway)
      ctx.onContentPlansChange([imported])
      setBusy(tr("Đang phân loại article type…", "Classifying article types…"))
      const plan = await classifyContentPlan(imported.id, railway)
      ctx.onContentPlansChange([plan])
      if (ctx.isAdmin && par !== ctx.settings.maxParallel) await ctx.onSaveConfig({ ...ctx.config, pipeline: { ...ctx.settings, maxParallel: Math.max(1, Math.min(5, par)) } }, ctx.files, false)
      const items = plan.items ?? []
      if (!items.length) throw new Error(tr("Không tìm thấy topic nào trong Content Plan này.", "No topics were found in this Content Plan."))
      await startPlanItems(ctx, plan, items, perBatch, structure, n => setBusy(`${tr("Đang tạo batch", "Creating batch")} ${n}…`))
      return plan.id
      })
      ctx.setPanel(null)
      go(`#/object/plans/${planId}`)
      toast(tr("Đã tạo plan và bắt đầu chạy", "Plan created and running"))
    } catch (err) {
      // The plan was already saved: don't let a second Generate import a duplicate. Finish it from the plan page.
      if (importedRef.current) {
        const planId = importedRef.current.id
        importedRef.current = null
        ctx.setPanel(null)
        go(`#/object/plans/${enc(planId)}`)
        toast(`${errText(err)} — ${tr("Plan đã được lưu; dùng \"Chạy topic chưa xử lý\" để chạy tiếp.", "The plan was saved; use \"Run unprocessed topics\" to continue.")}`, "error")
      } else toastErr(err)
    } finally { setBusy("") }
  }
  return <SidePanel ctx={ctx} title="Add Plan" icon={<I n="list-details" />}>
    <input ref={nameRef} className="sp-title" aria-label={tr("Tên Content Plan", "Content Plan name")} placeholder={tr("Tên Content Plan", "Content Plan name")} value={name} onChange={e => setName(e.target.value)} />
    <div className="fields" style={{ paddingTop: 0 }}>
      <div className="frow"><div className="flabel"><I n="layout-rows" />Per batch</div><div className="fval"><input aria-label="Per batch" type="number" min={1} max={20} value={per} onChange={e => setPer(+e.target.value)} /></div></div>
      {ctx.isAdmin && <div className="frow"><div className="flabel"><I n="arrows-split" />Max parallel</div><div className="fval"><input aria-label="Max parallel" type="number" min={1} max={5} value={par} onChange={e => setPar(+e.target.value)} /></div></div>}
      <div className="frow"><div className="flabel"><I n="stack-2" />Batches</div><div className="fval">{source !== "paste" ? <span className="empty">{tr("tính sau khi đọc và phân loại plan", "counted after the plan is read and classified")}</span> : lines.length ? <>{lines.length} topic → <b>&nbsp;≈ {Math.ceil(lines.length / perBatch)} batch</b>&nbsp;<span className="empty">{tr("(chia theo type sau khi phân loại)", "(split by type after classification)")}</span></> : <span className="empty">—</span>}</div></div>
    </div>
    <div style={{ margin: "4px 0 12px" }}><StructureSelect files={ctx.files} allowedIds={ctx.config.stepConfigs[3]?.fileAccess?.rules ?? []} value={structure} onChange={setStructure} disabled={Boolean(busy)} /></div>
    <div style={{ borderTop: "1px solid var(--b2)", margin: "8px 0 12px" }} />
    <div role="tablist" aria-label={tr("Nguồn Content Plan", "Content Plan source")} style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
      {([["paste", "clipboard-text", tr("Dán topic", "Paste topics")], ["file", "upload", "File"], ["google_doc", "file-text", "Google Doc"], ["google_sheet", "table", "Google Sheet"]] as const).map(([id, icon, label]) => <button key={id} role="tab" aria-selected={source === id} className={`btn${source === id ? " primary" : ""}`} disabled={Boolean(busy)} onClick={() => setSource(id)}><I n={icon} />{label}</button>)}
    </div>
    {source === "file" && <label className="box" style={{ display: "block", padding: 20, textAlign: "center", borderStyle: "dashed", background: "var(--bg2)", cursor: "pointer", color: "var(--f2)", marginBottom: 12 }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); setFile(e.dataTransfer.files[0] ?? null) }}>
      <I n="upload" s={{ fontSize: 22, color: "var(--f3)" }} /><div style={{ marginTop: 6 }}>{file ? file.name : tr("Chọn hoặc kéo thả file Content Plan", "Choose or drop a Content Plan file")}</div>
      <div style={{ color: "var(--f3)", fontSize: 12, marginTop: 2 }}>DOCX · PDF · XLSX · CSV · MD · TXT</div>
      <input type="file" hidden aria-label={tr("File Content Plan", "Content Plan file")} accept=".docx,.pdf,.xlsx,.csv,.md,.txt,.tsv,.json" onChange={e => setFile(e.target.files?.[0] ?? null)} />
    </label>}
    {source.startsWith("google_") && <div style={{ marginBottom: 12 }}><input className="inp" aria-label={tr("Link Google", "Google link")} value={url} onChange={e => setUrl(e.target.value)} placeholder={source === "google_doc" ? "https://docs.google.com/document/d/..." : "https://docs.google.com/spreadsheets/d/..."} /><div style={{ color: "var(--f3)", fontSize: 12, marginTop: 4 }}>{tr("Bật quyền \"Anyone with the link can view\".", "Turn on \"Anyone with the link can view\".")}</div></div>}
    {source === "paste" && <textarea aria-label="Topics" value={topics} onChange={e => setTopics(e.target.value)} placeholder={tr("Mỗi dòng một topic (hướng chủ đề, chưa có title). Title được chọn ở G1; article type được phân loại tự động.", "One topic per line (a direction, not a title). The title is chosen at G1; article type is classified automatically.")} />}
    <button className="btn primary lg" style={{ width: "100%", justifyContent: "center" }} disabled={Boolean(busy)} onClick={e => void create(e.timeStamp)}><I n={busy ? "loader-2" : "player-play"} />{busy || "Generate"}</button>
  </SidePanel>
}

function ReviewPanel({ ctx, id }: { ctx: Ctx; id: string }) {
  const { tr } = useI18n()
  const ago = useAgo()
  const [comment, setComment] = useState("")
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { markUnsaved("review-comment", Boolean(comment.trim())); return () => markUnsaved("review-comment", false) }, [comment])
  const a = ctx.list.find(x => x.id === id)
  if (!a) return null
  const checks = a.a.qualityReport?.checks ?? [], failed = checks.filter(c => c.status === "fail")
  const save = async (status: "approved" | "needs_revision", eventTimeStamp: number) => {
    if (status === "needs_revision" && !comment.trim()) { toast(tr("Cần nhập nhận xét cho Request Revision", "A comment is required for Request Revision")); ref.current?.focus(); return }
    const ok = await trackHandoff(eventTimeStamp, () => ctx.onUpdateArticle(a.id, { humanReview: { status, comment: comment.trim() || (status === "approved" ? tr("Đạt.", "Approved.") : undefined), reviewer: ctx.user.email, reviewedAt: new Date().toISOString() } }))
    if (ok) { markUnsaved("review-comment", false); ctx.setPanel(null); toast(status === "approved" ? tr("Đã duyệt bài", "Approved") : tr("Đã yêu cầu sửa. Mở bài › Chế độ thủ công › Mở lại bài để sửa.", "Revision requested. Open the article › Manual mode › Reopen to edit.")) }
  }
  const markApproved = async (eventTimeStamp: number) => {
    const next = a.a.approvedArticle ? null : { by: ctx.user.email, at: new Date().toISOString() }
    if (await trackHandoff(eventTimeStamp, () => ctx.onUpdateArticle(a.id, { approvedArticle: next }))) toast(next ? tr("Đã thêm vào Approved Articles", "Added to Approved Articles") : tr("Đã bỏ khỏi Approved Articles", "Removed from Approved Articles"))
  }
  return <SidePanel ctx={ctx} title="Review" icon={<I n="checklist" />} extra={<a className="icon-btn" href={`#/object/articles/${enc(a.id)}`} title="Open article"><I n="arrow-up-right" /></a>}>
    <div className="sp-title" style={{ paddingBottom: 4 }}>{a.title}</div><div style={{ color: "var(--f3)", marginBottom: 12 }}>{a.keyword}</div>
    <div className="fields" style={{ paddingTop: 0 }}>
      <div className="frow"><div className="flabel"><I n="gauge" />AI score</div><div className="fval"><ScoreTag s={a.score} t={ctx.settings.threshold} />&nbsp;<span style={{ color: "var(--f3)" }}>{checks.filter(c => c.status === "pass").length}/{checks.length}</span></div></div>
      {QC_GROUPS.filter(g => checks.some(c => qcGroupOf(c.id) === g.key)).map(g => { const it = checks.filter(c => qcGroupOf(c.id) === g.key), ok = it.filter(c => c.status === "pass").length; return <div key={g.key} className="frow"><div className="flabel"><I n="list-check" />{tr(g.vi, g.en)}</div><div className="fval"><Tag c={ok === it.length ? "green" : "orange"}>{ok}/{it.length}</Tag></div></div> })}
      <div className="frow"><div className="flabel"><I n="user-check" />Human review</div><div className="fval"><HumanTag h={a.human.status} />{a.human.reviewer && <>&nbsp;<span style={{ color: "var(--f3)" }}>{person(a.human.reviewer)}</span></>}</div></div>
      <div className="frow"><div className="flabel"><I n="list-details" />Content Plan</div><div className="fval"><PlanChip ctx={ctx} id={a.planId} /></div></div>
    </div>
    {failed.length > 0 && <><div className="fsec"><I n="x" />&nbsp;{tr("Tiêu chí chưa đạt", "Criteria not met")}</div>{failed.map(c => <div key={c.id} className="list-row" style={{ height: "auto", padding: "8px 12px", cursor: "default" }}><span className="grow" style={{ whiteSpace: "normal" }}><b style={{ fontWeight: 500 }}>{tr(QC_LABELS_VI[c.id] ?? c.label, c.label)}</b><br /><span style={{ color: "var(--f3)" }}>{c.reason}</span></span><Tag c="red">Fail</Tag></div>)}</>}
    {a.human.comment && <><div className="fsec"><I n="message-2" />&nbsp;{tr("Nhận xét trước", "Previous comment")}</div><div className="note-card" style={{ height: "auto", cursor: "default" }}><p>{a.human.comment}</p><div className="meta">{person(a.human.reviewer)} · {ago(a.human.at)}</div></div></>}
    <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", color: "var(--f2)" }}>{tr("Xem bài", "Read article")}</summary><article className="crm-draft" style={{ marginTop: 8 }} dangerouslySetInnerHTML={{ __html: markdownToHtml(readable(a.a.draft)) }} /></details>
    <div style={{ borderTop: "1px solid var(--b2)", margin: "16px 0 12px" }} />
    <textarea ref={ref} aria-label={tr("Nhận xét", "Comment")} style={{ minHeight: 110 }} value={comment} onChange={e => setComment(e.target.value)} placeholder={tr("Nhận xét (bắt buộc khi Request Revision)…", "Comment (required for Request Revision)…")} />
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}><button className="btn primary" onClick={e => void save("approved", e.timeStamp)}><I n="check" />Approve</button><button className="btn" onClick={e => void save("needs_revision", e.timeStamp)}><I n="message-2" />Request Revision</button></div>
    {ctx.can("approveArticles") && <div className="box" style={{ marginTop: 12 }}><div className="box-row"><div className="grow">Approved Article<div className="s">{tr("Đánh dấu bài mẫu (chưa nạp vào G2/G3)", "Mark as an example (not yet fed to G2/G3)")}</div></div><button role="switch" aria-checked={Boolean(a.a.approvedArticle)} aria-label="Approved Article" className={`toggle${a.a.approvedArticle ? " on" : ""}`} onClick={e => void markApproved(e.timeStamp)} /></div></div>}
    <p style={{ color: "var(--f4)", fontSize: 12 }}>{tr("Request Revision chỉ ghi lại feedback, không gửi bài lại cho AI.", "Request Revision only records feedback; it does not send the article back to the AI.")}</p>
    {a.human.status === "revision" && ctx.can("manual") && <button className="btn" onClick={() => { if (confirmDiscard()) { ctx.setPanel(null); go(`#/object/articles/${enc(a.id)}?tab=manual`) } }}><I n="adjustments" />{tr("Sửa trong Chế độ thủ công (Mở lại bài)", "Fix in Manual mode (Reopen)")}</button>}
  </SidePanel>
}

function DocPanel({ ctx, id }: { ctx: Ctx; id: string }) {
  const { tr } = useI18n()
  const d = ctx.docs.find(x => x.id === id)
  if (!d) return null
  const [l, c] = docStatus(d)
  const flip = async (g: number, eventTimeStamp: number) => {
    if (!ctx.can("settings")) return toast(tr("Chỉ Admin sửa được Shipper", "Only Admin can edit the Shipper"))
    if (!d.file) return toast(tr("Tài liệu chưa có trong Storage", "This document is not in Storage yet"))
    try { const file = d.file; await trackHandoff(eventTimeStamp, () => ctx.onSaveConfig(toggleShip(ctx.config, file, g), ctx.files, false)); toast(tr("Đã lưu", "Saved")) } catch (err) { toastErr(err) }
  }
  // Per-file server calls: a stale document list in this tab can never overwrite documents added elsewhere.
  const saveFile = async (file: DocumentFile) => {
    const saved = await trackHandoff(performance.now(), () => db.updateFileMetadata(file.id, file.knowledgeMetadata!))
    ctx.onFilesSynced(ctx.files.map(f => f.id === saved.id ? saved : f))
  }
  const deleteFile = async () => {
    const result = await trackHandoff(performance.now(), () => db.deleteFile(id))
    ctx.onFilesSynced(result.files, result.config)
    ctx.setPanel(null)
    toast(tr("Đã xoá tài liệu", "Document deleted"))
  }
  return <SidePanel ctx={ctx} title="Document" icon={<I n="file-description" />}>
    <div className="sp-title">{d.name}</div>
    <div className="fields" style={{ paddingTop: 0 }}>
      <div className="frow"><div className="flabel"><I n="folder" />Group</div><div className="fval">{d.g}</div></div>
      <div className="frow"><div className="flabel"><I n="progress-check" />Status</div><div className="fval"><Tag c={c}>{l}</Tag></div></div>
      <div className="frow"><div className="flabel"><I n="notes" />Note</div><div className="fval">{d.note || <span className="empty">Empty</span>}</div></div>
    </div>
    <div className="fsec"><I n="git-merge" />&nbsp;Used at (Shipper)</div>
    <div className="box">{[1, 2, 3].map(g => <div key={g} className="box-row"><div className="grow">{GATES[g - 1].label}</div><button role="switch" aria-checked={d.used.includes(g)} aria-label={GATES[g - 1].label} className={`toggle${d.used.includes(g) ? " on" : ""}`} onClick={e => void flip(g, e.timeStamp)} /></div>)}</div>
    <div className="fsec"><I n="category" />&nbsp;Applies to types</div><div>{d.types.map(t => <span key={t}><TypeTag t={t} /> </span>)}</div>
    {d.file ? <DocDetails key={d.file.id} file={d.file} railwayUrl={ctx.config.railwayUrl} canEdit={ctx.isAdmin} onSave={saveFile} onDelete={deleteFile} />
      : d.st === "missing" && ctx.isAdmin && d.id !== "approved-articles" && <button className="btn primary" style={{ marginTop: 14 }} onClick={() => ctx.setPanel({ kind: "add-doc" })}><I n="upload" />{tr("Thêm tài liệu này", "Add this document")}</button>}
  </SidePanel>
}

function AddDocPanel({ ctx }: { ctx: Ctx }) {
  const { tr } = useI18n()
  if (!ctx.isAdmin) return null
  // Upload/import already stored each record on the server's list; reload that list instead of re-posting ours.
  const onAdded = async (_docs: DocumentFile[]) => ctx.onFilesSynced(await db.fetchFiles())
  return <SidePanel ctx={ctx} title={tr("Thêm tài liệu", "Add document")} icon={<I n="upload" />}><AddDocForm railwayUrl={ctx.config.railwayUrl} onAdded={onAdded} /></SidePanel>
}

/* ─── command menu ─────────────────────────────────────────────────────── */

function CommandMenu({ ctx }: { ctx: Ctx }) {
  const { tr, toggleLanguage } = useI18n()
  const [q, setQ] = useState("")
  const [idx, setIdx] = useState(0)
  const m = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase().trim())
  type Item = { label: string; run: () => void; icon?: string; av?: ReactNode; hint?: string }
  const groups: Array<[string, Item[]]> = []
  if (q) {
    const as = ctx.list.filter(a => m(a.title) || m(a.keyword)).slice(0, 6).map(a => ({ label: a.title, run: () => go(`#/object/articles/${enc(a.id)}`), av: <Av name={a.title} />, hint: STATUS[a.status][0] }))
    const ps = ctx.plans.filter(p => m(p.name)).map(p => ({ label: p.name, run: () => go(`#/object/plans/${p.id}`), av: <Av name={p.name} />, hint: `${planStats(p.articles).c}/${p.articles.length}` }))
    if (as.length) groups.push(["Articles", as])
    if (ps.length) groups.push(["Content Plans", ps])
  }
  const act: Item[] = [{ label: "Add Plan", run: () => ctx.setPanel({ kind: "plan" }), icon: "plus" }, { label: "Toggle dark mode", run: () => ctx.onThemeChange(ctx.themePreference === "dark" ? "light" : "dark"), icon: "moon" }, { label: "Switch language (vi/en)", run: toggleLanguage, icon: "world" }].filter(x => m(x.label))
  const nav: Item[] = ([["Go to Articles", "#/objects/articles", "file-text"], ["Go to Content Plans", "#/objects/plans", "list-details"], ["Go to Batches", "#/objects/batches", "stack-2"], ["Go to Review Workspace", "#/objects/reviews", "checklist"], ["Go to Storage", "#/objects/storage", "folders"], ["Go to 3-gate pipeline", "#/workflows", "settings-automation"], ["Go to Dashboards", "#/dashboards", "layout-dashboard"], ["Go to Settings", ctx.can("settings") ? "#/settings/pipeline" : "#/settings/experience", "settings"]] as const).filter(n => m(n[0]) && (n[1] !== "#/objects/storage" || ctx.can("storage"))).map(([label, h, icon]) => ({ label, run: () => go(h), icon }))
  if (act.length) groups.push(["Actions", act])
  if (nav.length) groups.push(["Navigate", nav])
  const flat = groups.flatMap(g => g[1])
  // Actions like Add Plan open another panel, so close first and then run.
  const run = (k: number) => { const item = flat[k]; if (!item) return; ctx.setPanel(null); item.run() }
  let k = 0
  return <div className="cmd-overlay" onClick={e => { if (e.target === e.currentTarget) ctx.setPanel(null) }}>
    <div className="cmd" role="dialog" aria-label={tr("Tìm kiếm", "Search")}>
      <input autoFocus aria-label={tr("Tìm kiếm", "Search")} placeholder={tr("Tìm bài viết, plan, trang và hành động…", "Search articles, plans, pages and actions…")} value={q} onChange={e => { setQ(e.target.value); setIdx(0) }}
        onKeyDown={e => { if (e.key === "ArrowDown") { setIdx(i => Math.min(i + 1, flat.length - 1)); e.preventDefault() } if (e.key === "ArrowUp") { setIdx(i => Math.max(i - 1, 0)); e.preventDefault() } if (e.key === "Enter") run(idx); if (e.key === "Escape") ctx.setPanel(null) }} />
      <div className="cmd-list">{groups.length ? groups.map(([g, items]) => <div key={g}><div className="cmd-grp">{g}</div>{items.map(item => { const n = k++; return <button key={n} className={`cmd-item${n === idx ? " on" : ""}`} onMouseEnter={() => setIdx(n)} onClick={() => run(n)}>{item.av ?? <I n={item.icon!} />}{item.label}{item.hint && <span className="hint">{item.hint}</span>}</button> })}</div>) : <div className="empty-state" style={{ padding: 30 }}>No results</div>}</div>
    </div>
  </div>
}

/* ─── 3-gate pipeline (workflow canvas) ────────────────────────────────── */

function steps(ctx: Ctx) {
  const s = ctx.settings
  return [
    { kind: "Trigger", icon: "bolt", color: "blue", label: "Plan is added", detail: "Content Operator · Add Plan" },
    { kind: "Action", icon: "stack-2", color: "orange", label: "Auto split batches", detail: `${s.perBatch}/batch · max ${s.maxParallel} parallel` },
    ...[1, 2, 3].map(g => ({ kind: "Gate " + g, icon: GATES[g - 1].icon, color: GATES[g - 1].color, label: GATES[g - 1].label, detail: `Executor × ${g === 1 ? "N" : 1} → Reviewer → ≥ ${s.threshold}%`, gate: g })),
    { kind: "Approval", icon: "shield-check", color: "yellow", label: "AI Approval", detail: `Universal QC ≥ ${s.threshold}%`, gate: 4 },
    { kind: "Parallel", icon: "user-check", color: "green", label: "Human review (sampled)", detail: `${s.reviewSample}% · Approve | Needs Revision` },
    { kind: "Output", icon: "brand-google-drive", color: "gray", label: "Copy to Docs", detail: "Heading · table · link", gate: 5 },
  ] as Array<{ kind: string; icon: string; color: string; label: string; detail: string; gate?: number }>
}
function PipelineCanvas({ ctx }: { ctx: Ctx }) {
  const { tr } = useI18n()
  const open = ctx.panel?.kind === "step" ? ctx.panel.i : null
  return <>
    <Header title={<><span className="nav-ico" style={{ background: "#307f52" }}><I n="settings-automation" s={{ fontSize: 11 }} /></span>{tr("Quy trình 3 gate", "3-gate pipeline")}</>}
      actions={<span style={{ display: "flex", gap: 4, alignItems: "center" }}>{GATES.map(g => <Tag key={g.id} c={g.color}>{g.short} · {ctx.list.filter(a => a.status === "running" && a.gate === g.id).length}</Tag>)}</span>} />
    <div className="card"><div className="canvas">
      {steps(ctx).map((s, i) => <div key={i} style={{ display: "contents" }}>
        {i > 0 && <div className="wline" />}
        <div className={`wnode${open === i ? " on" : ""}`} role="button" tabIndex={0} onClick={() => ctx.setPanel({ kind: "step", i })} onKeyDown={e => { if (e.key === "Enter") ctx.setPanel({ kind: "step", i }) }}>
          <span className={`wi t-${s.color}`}><I n={s.icon} /></span>
          <div><div className="wk">{s.kind}</div><div className="wn">{s.label}</div><div style={{ color: "var(--f3)", fontSize: 12 }}>{s.detail}</div></div>
        </div>
      </div>)}
      <div style={{ marginTop: 16, color: "var(--f3)", fontSize: 12 }}><I n="alert-triangle" /> {tr("Gate không có option đạt sau vòng sửa → Failed (No-pass) → Retry từ gate đó", "No passing option after revision → Failed (No-pass) → Retry from that gate")}</div>
    </div></div>
  </>
}
function StepPanel({ ctx, i }: { ctx: Ctx; i: number }) {
  const { tr } = useI18n()
  const s = steps(ctx)[i], st = ctx.settings
  const gate = s.gate && s.gate <= 3 ? s.gate : null
  const exec = gate ? stepFiles(ctx, GATES[gate - 1].step).map(f => f.name) : []
  const info: Record<number, string> = {
    0: tr("Content Plan gồm danh sách topic, keyword, loại bài và internal link gợi ý.", "A Content Plan lists topics, keywords, article type and suggested internal links."),
    1: tr("Mỗi bài chạy độc lập. Mỗi batch chạy tối đa maxParallel bài cùng lúc.", "Each article runs independently; each batch runs up to maxParallel articles at a time."),
    6: tr("Không chặn việc bài hoàn thành. Request Revision chỉ ghi feedback.", "Never blocks completion. Request Revision only records feedback."),
    7: tr("Copy giữ heading, bảng và link để dán vào Google Docs.", "Copy keeps headings, tables and links for Google Docs."),
  }
  const body = gate ? <>
    <div className="fsec"><I n="package" />&nbsp;Executor package</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{exec.length ? exec.map(d => <Tag key={d} c="blue">{d}</Tag>) : <span style={{ color: "var(--f4)" }}>{tr("Chưa cấp tài liệu nào", "No documents shipped")}</span>}</div>
    <div className="fsec"><I n="checklist" />&nbsp;Reviewer package</div><div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{reviewerPackage(ctx, gate).map(d => <Tag key={d} c="purple">{d}</Tag>)}</div>
    <div className="fsec"><I n="adjustments" />&nbsp;Rules</div>
    <div className="box">
      <div className="box-row"><div className="grow">Options<div className="s">{gate === 1 ? tr("Core Idea có chấm điểm", "Scored core ideas") : tr(`Đề xuất ${st.options}, hiện tạo 1`, `Proposed ${st.options}, currently 1`)}</div></div>{gate === 1 ? "N" : 1}</div>
      <div className="box-row"><div className="grow">Threshold<div className="s">{tr("chưa chốt", "not final")}</div></div>{st.threshold}%</div>
      <div className="box-row"><div className="grow">Revision rounds<div className="s">{tr("chưa bật", "not active")}</div></div>{st.revisionRounds}</div>
      <div className="box-row"><div className="grow">No-pass Logic<div className="s">{tr("chưa chốt", "not final")}</div></div>{st.noPass}</div>
    </div>
  </> : s.gate === 4 ? <>
    <div className="fsec"><I n="list-check" />&nbsp;Checklist</div>
    {QC_GROUPS.map(g => <div key={g.key} className="frow"><Tag c="gray">{tr(g.vi, g.en)}</Tag></div>)}
    <p style={{ color: "var(--f3)" }}>{tr("Điểm = pass 1, warning 0,5, fail 0. Trượt dẫn chứng là chặn cứng.", "Score = pass 1, warning 0.5, fail 0. Unsupported evidence is a hard block.")}</p>
  </> : <p>{info[i]}</p>
  return <SidePanel ctx={ctx} title={s.label} icon={<span className={`av t-${s.color}`} style={{ width: 20, height: 20 }}><I n={s.icon} /></span>}>
    {body}{ctx.can("settings") && <a className="btn" style={{ marginTop: 16 }} href="#/settings/pipeline"><I n="settings" />{tr("Chỉnh trong Settings", "Edit in Settings")}</a>}
  </SidePanel>
}

/* ─── dashboard ────────────────────────────────────────────────────────── */

function Dashboard({ ctx }: { ctx: Ctx }) {
  const { tr, language } = useI18n()
  const all = ctx.list, done = all.filter(a => a.status === "completed"), scored = all.filter(a => a.score != null)
  const firstPass = scored.length ? Math.round(scored.filter(a => a.status === "completed").length / scored.length * 100) : 0
  const Kpi = ({ icon, label, v, sub }: { icon: string; label: string; v: ReactNode; sub: ReactNode }) => <div className="widget"><h4><I n={icon} />{label}</h4><div className="kpi">{v}</div><div className="kpi-sub">{sub}</div></div>
  const byCol = COLS.map(c => ({ ...c, v: all.filter(c.test).length })), max = Math.max(1, ...byCol.map(c => c.v))
  const hs = (Object.keys(HUMAN) as HumanStatus[]).map(k => done.filter(a => a.human.status === k).length), tot = Math.max(1, done.length), hcol = ["var(--c-gray)", "var(--c-green)", "var(--c-orange)"]
  let acc = 0
  const grad = hs.map((n, i) => { const a0 = acc; acc += n / tot * 360; return `${hcol[i]} ${a0}deg ${acc}deg` }).join(",")
  const secAvg = QC_GROUPS.map(g => { const r = scored.map(a => { const it = (a.a.qualityReport?.checks ?? []).filter(c => qcGroupOf(c.id) === g.key); return it.length ? it.filter(c => c.status === "pass").length / it.length : null }).filter((v): v is number => v != null); return [language === "vi" ? g.vi : g.en, r.length ? Math.round(r.reduce((x, y) => x + y, 0) / r.length * 100) : 0] as const })
  return <>
    <Header title={<><span className="nav-ico" style={{ background: "#b23887" }}><I n="layout-dashboard" s={{ fontSize: 11 }} /></span>Dashboards<span className="crumb">/</span>Pipeline overview</>} />
    <div className="card"><div className="dash">
      <Kpi icon="file-text" label="Articles" v={all.length} sub={`${ctx.plans.length} plans · ${ctx.batches.length} batches`} />
      <Kpi icon="circle-check" label="AI Approved" v={done.length} sub={`${all.filter(a => a.status === "running").length} running`} />
      <Kpi icon="target-arrow" label={tr("Tỉ lệ AI Approved", "AI Approval rate")} v={firstPass + "%"} sub={tr("Bài đạt / bài đã chấm (chưa tách lần chấm đầu)", "Approved / scored (first pass not tracked yet)")} />
      <Kpi icon="alert-triangle" label="Failed (No-pass)" v={all.filter(a => a.status === "failed").length} sub={tr("Retry từ gate bị lỗi", "Retry from the failed gate")} />
      <div className="widget w2"><h4><I n="chart-bar" />Articles by gate</h4>{byCol.map(c => <div key={c.key} className="hbar"><span className="lbl">{c.key === "completed" ? "Completed" : c.key === "failed" ? "Failed" : c.key === "queued" ? "Queued" : c.key}</span><span className="track"><span className="fill" style={{ display: "block", width: `${c.v / max * 100}%`, background: `var(--c-${c.color})` }} /></span><span className="v">{c.v}</span></div>)}</div>
      <div className="widget w2"><h4><I n="chart-donut" />Human review (sampled)</h4><div style={{ display: "flex", alignItems: "center", gap: 24 }}><div className="donut" style={{ background: `conic-gradient(${done.length ? grad : "var(--bg3) 0 360deg"})` }} /><div className="legend">{(Object.keys(HUMAN) as HumanStatus[]).map((k, i) => <div key={k}><span style={{ background: hcol[i] }} />{HUMAN[k][0]} · {hs[i]}</div>)}</div></div></div>
      <div className="widget w2"><h4><I n="list-check" />Average pass rate by checklist</h4>{secAvg.map(([s, v]) => <div key={s} className="hbar"><span className="lbl" title={s}>{s}</span><span className="track"><span className="fill" style={{ display: "block", width: `${v}%`, background: "var(--accent)" }} /></span><span className="v">{v}%</span></div>)}</div>
      <div className="widget w2"><h4><I n="trophy" />Top AI scores</h4>{[...done].filter(a => a.score != null).sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, 5).map(a => <div key={a.id} className="frow"><a className="rchip" href={`#/object/articles/${enc(a.id)}`}><Av name={a.title} />{a.title}</a><span style={{ marginLeft: "auto" }}><ScoreTag s={a.score} t={ctx.settings.threshold} /></span></div>)}{!done.length && <span style={{ color: "var(--f4)" }}>—</span>}</div>
    </div></div>
  </>
}

/* ─── settings ─────────────────────────────────────────────────────────── */

function SettingsNav({ ctx, p }: { ctx: Ctx; p: string }) {
  const { tr } = useI18n()
  const it = (k: string, icon: string, l: string) => <a key={k} className={`nav-item${p === k ? " on" : ""}`} href={`#/settings/${k}`}><I n={icon} /><span>{l}</span></a>
  return <nav className="nav" aria-label={tr("Điều hướng chính", "Main navigation")}>
    <a className="nav-item" href="#/objects/articles"><I n="chevron-left" /><span>Exit Settings</span></a>
    <div className="nav-sec">User</div>{it("experience", "color-swatch", "Experience")}{it("roles", "lock", "Roles")}
    {ctx.can("settings") && <><div className="nav-sec">Pipeline</div>{it("pipeline", "git-merge", "Pipeline")}{it("shipper", "truck-delivery", "Shipper")}{it("workflow-ai", "robot", "Workflow AI")}{it("models", "cpu", "AI Models")}</>}
    <div className="nav-foot"><button className="nav-item" onClick={ctx.onSignOut}><I n="logout" /><span>Logout</span></button></div>
  </nav>
}
const Sec = ({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) => <section><h2>{title}</h2>{desc ? <p className="desc">{desc}</p> : <div style={{ height: 12 }} />}{children}</section>

function SettingsPage({ ctx, p }: { ctx: Ctx; p: string }) {
  const { tr, language, setLanguage } = useI18n()
  const admin = ["pipeline", "shipper", "workflow-ai", "models"]
  if (admin.includes(p) && !ctx.can("settings")) return <Forbidden />
  const titles: Record<string, string> = { experience: "Experience", roles: "Roles", pipeline: "Pipeline", shipper: "Shipper", "workflow-ai": "Workflow AI", models: "AI Models" }
  const st = ctx.settings
  const savePipeline = async (patch: Partial<PipelineSettings>) => { try { await trackHandoff(performance.now(), () => ctx.onSaveConfig({ ...ctx.config, pipeline: { ...st, ...patch } }, ctx.files, false)); toast(tr("Đã lưu", "Saved")) } catch (err) { toastErr(err) } }
  const numField = (k: keyof PipelineSettings, label: string, min: number, max: number) =>
    <label className="fl">{label}<input className="inp" type="number" min={min} max={max} defaultValue={Number(st[k])} onBlur={e => { const v = Math.max(min, Math.min(max, +e.target.value || min)); e.target.value = String(v); if (v !== st[k]) void savePipeline({ [k]: v }) }} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }} /></label>
  let body: ReactNode
  if (p === "experience") {
    const card = (k: ThemePreference, l: string, bg: string, fg: string) => <button key={k} className={`theme-card${ctx.themePreference === k ? " on" : ""}`} onClick={() => ctx.onThemeChange(k)}><div className="pv" style={{ background: bg }}><i style={{ width: "60%", background: fg }} /><i style={{ width: "80%", background: fg, opacity: .5 }} /><i style={{ width: "40%", background: fg, opacity: .5 }} /></div>{l}</button>
    body = <>
      <Sec title={tr("Giao diện", "Appearance")} desc={tr("Chọn giao diện sáng, tối hoặc theo hệ thống", "Choose how the app looks")}><div className="theme-cards">{card("light", tr("Sáng", "Light"), "#fff", "#ccc")}{card("dark", tr("Tối", "Dark"), "#1b1b1b", "#555")}{card("system", tr("Theo hệ thống", "System settings"), "linear-gradient(90deg,#fff 50%,#1b1b1b 50%)", "#888")}</div></Sec>
      <Sec title={tr("Ngôn ngữ", "Language")} desc={tr("Chọn ngôn ngữ hiển thị", "Select your preferred language")}><select className="inp" style={{ maxWidth: 300 }} value={language} onChange={e => setLanguage(e.target.value as typeof language)}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></Sec>
    </>
  }
  if (p === "roles") body = <Sec title="All roles" desc={tr("Vai trò do Admin cấp trong hệ thống. Reviewer chưa tách riêng: mọi tài khoản đều review được.", "Roles are assigned by an admin. Reviewer is not separate yet: every account can review.")}><div className="box">{(Object.keys(ROLES) as Array<keyof typeof ROLES>).map(k => {
    const r = ROLES[k], current = (ctx.isAdmin ? "admin" : "operator") === k
    return <div key={k} className="box-row"><I n={k === "admin" ? "lock-open" : k === "reviewer" ? "checklist" : "user"} /><div className="grow">{r.name}<div className="s">{r.desc}</div></div>{current ? <Tag c="blue">Current</Tag> : k === "reviewer" ? <Tag c="orange">{tr("chưa có", "not yet")}</Tag> : null}</div>
  })}</div></Sec>
  if (p === "pipeline") body = <>
    <Sec title="Scoring" desc={tr("Score là tỉ lệ % tiêu chí đạt (warning tính nửa). Các giá trị dưới đây chưa chốt.", "Score is the % of criteria met (warnings count half). Values below are not final.")}><div className="row2">{numField("threshold", "Threshold (%)", 50, 100)}{numField("options", tr("Options per gate (chưa bật ở G2, G3)", "Options per gate (not active for G2, G3)"), 1, 5)}{numField("revisionRounds", tr("Max revision rounds (chưa bật)", "Max revision rounds (not active)"), 0, 3)}</div></Sec>
    <Sec title="Batches" desc={tr("Áp dụng cho plan mới.", "Applies to new plans.")}><div className="row2">{numField("perBatch", "Articles per batch", 1, 20)}{numField("maxParallel", tr("Bài chạy song song (toàn hệ thống)", "Parallel articles (all batches)"), 1, 5)}{numField("reviewSample", "Random review (%)", 0, 100)}</div></Sec>
    <Sec title="No-pass Logic" desc={tr("Khi không option nào đạt, kể cả sau vòng sửa. Chưa bật: hiện bài trượt AI Review được đánh dấu Failed.", "When no option passes, even after revision. Not active: articles failing AI Review are marked Failed.")}><select className="inp" style={{ maxWidth: 420 }} value={st.noPass} onChange={e => void savePipeline({ noPass: e.target.value as PipelineSettings["noPass"] })}><option value="fail">{tr("Dừng ở Failed và chờ người xử lý", "Stop at Failed and wait for a person")}</option><option value="best-flagged">{tr("Lấy option tốt nhất, gắn cờ cảnh báo", "Take the best option with a warning flag")}</option></select></Sec>
    <Sec title="Capacity" desc={tr("Mục tiêu 30 bài/ngày.", "Target: 30 articles/day.")}><div className="box"><div className="box-row"><div className="grow">T = 24h<div className="s">c = {st.maxParallel}</div></div>≤ {Math.round(st.maxParallel * 24 * 60 / 30)} min / article</div><div className="box-row"><div className="grow">T = 8h<div className="s">c = {st.maxParallel}</div></div>≤ {Math.round(st.maxParallel * 8 * 60 / 30)} min / article</div></div></Sec>
  </>
  if (p === "shipper") body = <Sec title="Shipper mapping" desc={tr("Gate nào lấy tài liệu nào. Không bao giờ nạp cả thư viện.", "Which gate gets which documents. Never the whole library.")}><div className="box"><table className="tbl" style={{ width: "100%" }}><thead><tr><th style={{ position: "static" }}>Document</th>{["G1", "G2", "G3"].map(g => <th key={g} style={{ position: "static", textAlign: "center" }}>{g}</th>)}</tr></thead><tbody>
    {ctx.docs.filter(d => d.file).map(d => <tr key={d.id}><td>{d.name} <span className="muted">· {d.g}</span></td>{[1, 2, 3].map(g => <td key={g} style={{ textAlign: "center" }}><button role="switch" aria-checked={d.used.includes(g)} aria-label={`${d.name} G${g}`} className={`toggle${d.used.includes(g) ? " on" : ""}`} style={{ display: "inline-block" }} onClick={e => void trackHandoff(e.timeStamp, () => ctx.onSaveConfig(toggleShip(ctx.config, d.file!, g), ctx.files, false)).then(() => toast(tr("Đã lưu", "Saved"))).catch(err => toastErr(err))} /></td>)}</tr>)}
  </tbody></table></div></Sec>
  if (["workflow-ai", "models"].includes(p)) body = <EmbeddedSettings ctx={ctx} p={p} />
  if (!body) body = <div className="empty-state"><I n="ghost" /><h3>Page not found</h3></div>
  return <>
    <Header title={<><I n="settings" /><span className="crumb">Settings</span><span className="crumb">/</span>{titles[p] ?? ""}</>} />
    <div className="card"><div className="set"><div className="set-inner"><h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{titles[p] ?? ""}</h1>{body}</div></div></div>
  </>
}

/** The existing configuration editors, saved through the same handler as the classic settings dialog. */
function EmbeddedSettings({ ctx, p }: { ctx: Ctx; p: string }) {
  const { tr } = useI18n()
  const [config, setConfig] = useState(ctx.config)
  const files = ctx.files
  const [saving, setSaving] = useState(false)
  const dirty = config !== ctx.config
  useEffect(() => { markUnsaved("settings", dirty); return () => markUnsaved("settings", false) }, [dirty])
  const save = async (eventTimeStamp: number) => { setSaving(true); try { await trackHandoff(eventTimeStamp, () => ctx.onSaveConfig(config, files, false)); toast(tr("Đã lưu", "Saved")) } catch (err) { toastErr(err) } finally { setSaving(false) } }
  return <>
    {p === "workflow-ai" && <WorkflowAiSettings config={config} files={files} articles={ctx.articles} onChange={setConfig} />}
    {p === "models" && <ModelsSettings config={config} onChange={setConfig} />}
    {p === "workflow-ai" && <WorkflowRules config={config} files={files} onChange={setConfig} />}
    {["workflow-ai", "models"].includes(p) && <div style={{ position: "sticky", bottom: 0, display: "flex", justifyContent: "flex-end", padding: "12px 0", background: "var(--bg1)" }}>
      <button className="btn primary" disabled={!dirty || saving} onClick={e => void save(e.timeStamp)}><I n="device-floppy" />{saving ? tr("Đang lưu…", "Saving…") : tr("Lưu thay đổi", "Save changes")}</button>
    </div>}
  </>
}
