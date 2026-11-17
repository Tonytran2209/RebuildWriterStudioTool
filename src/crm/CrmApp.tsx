import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  BarChart3, Boxes, CheckCircle2, ChevronRight, ClipboardCheck, Command, Copy, FileText, FolderKanban, GitBranch,
  History, KanbanSquare, LayoutList, LogOut, Menu, Monitor, Moon, Plus, RotateCcw, Search, Settings, Sparkles, Sun,
  Trash2, Undo2, Workflow, X,
} from "lucide-react"
import type { AppConfig, Article, ContentPlan, DocumentFile, PipelineSettings } from "../types"
import type { ThemePreference } from "../lib/theme"
import { useI18n } from "../lib/i18n"
import { markdownToHtml, normalizeDraftOutput } from "../lib/draftExport"
import { isLegacyArticle } from "../lib/legacyCompatibility"
import {
  PIPELINE_STAGES, aiApproval, articleStage, firstPassApprovalRate, humanReviewStatus, inReviewSample, pipelineSettings,
  type PipelineStage,
} from "../lib/pipeline"
import { notifyWorkspace } from "../components/workspace/WorkspaceNotification"
import "./crm.css"

type View = "articles" | "plans" | "batches" | "review" | "storage" | "workflow" | "dashboard" | "settings" | "new" | "article" | "plan" | "batch"
type Route = { view: View; id?: string }
const VIEWS: View[] = ["articles", "plans", "batches", "review", "storage", "workflow", "dashboard", "settings", "new", "article", "plan", "batch"]

function parseRoute(hash: string): Route {
  const [view, id] = hash.replace(/^#\/?/, "").split("/")
  return VIEWS.includes(view as View) ? { view: view as View, id: id ? decodeURIComponent(id) : undefined } : { view: "articles" }
}
const go = (view: View, id?: string) => { window.location.hash = `/${view}${id ? `/${encodeURIComponent(id)}` : ""}` }

type Props = {
  user: { email: string; role: "user" | "admin" }
  articles: Article[]
  contentPlans: ContentPlan[]
  files: DocumentFile[]
  config: AppConfig
  activeId: string | null
  onSelectArticle: (id: string | null) => void
  onUpdateArticle: (id: string, updates: Partial<Article>) => Promise<boolean>
  onToggleComplete: (article: Article) => void
  completionSavingId: string | null
  onDeleteArticle: (article: Article, batch?: boolean) => void
  onRetry: (article: Article) => Promise<void>
  onSavePipeline: (pipeline: PipelineSettings) => Promise<void>
  onOpenAdvancedSettings: () => void
  onSwitchClassic: () => void
  onSignOut: () => void
  themePreference: ThemePreference
  onThemeChange: (preference: ThemePreference) => void
  renderManual: () => ReactNode
  renderBatch: (activityId: string, onOpen: (id: string) => void) => ReactNode
  renderLauncher: () => ReactNode
}

const STAGE_META: Record<PipelineStage, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "t-gray" },
  g1: { label: "G1 Research/Topic", tone: "t-sky" },
  g2: { label: "G2 Outline", tone: "t-purple" },
  g3: { label: "G3 Final Article", tone: "t-blue" },
  ai: { label: "AI Approval", tone: "t-orange" },
  failed: { label: "Failed", tone: "t-red" },
  completed: { label: "Completed", tone: "t-green" },
}
const GATE_ORDER: PipelineStage[] = ["g1", "g2", "g3", "ai"]

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"
const titleOf = (article: Article) => article.title?.trim() || article.topic || "Bài viết"

function StageTag({ stage }: { stage: PipelineStage }) {
  return <span className={`tag ${STAGE_META[stage].tone}`}>{STAGE_META[stage].label}</span>
}
function GateBar({ article }: { article: Article }) {
  const stage = articleStage(article)
  // A failed article stops at the gate its saved data reached.
  const reached = stage === "failed" ? articleStage({ ...article, batchStatus: undefined }) : stage
  const at = reached === "completed" ? 4 : Math.max(0, GATE_ORDER.indexOf(reached))
  return <span className="gbar" aria-hidden="true">{GATE_ORDER.map((gate, index) =>
    <i key={gate} className={index < at ? "done" : index === at ? (stage === "failed" ? "fail" : "now") : ""} />)}</span>
}

export default function CrmApp(props: Props) {
  const { tr } = useI18n()
  const { articles, contentPlans, files, config, user } = props
  const isAdmin = user.role === "admin"
  const settings = pipelineSettings(config)
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const [navOpen, setNavOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)

  useEffect(() => {
    const onHash = () => { setRoute(parseRoute(window.location.hash)); setNavOpen(false) }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCmdOpen(open => !open) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  // Manual mode and completion in App act on the active article, so the record route drives it.
  useEffect(() => {
    if (route.view === "article" && route.id && route.id !== props.activeId) props.onSelectArticle(route.id)
  }, [route.view, route.id, props.activeId])
  // After Add Plan creates records, App selects the first one: follow it to its batch or record.
  const [launchedFrom, setLaunchedFrom] = useState<string | null>(null)
  useEffect(() => { if (route.view === "new") setLaunchedFrom(props.activeId ?? "") }, [route.view])
  useEffect(() => {
    if (route.view !== "new" || launchedFrom === null || !props.activeId || props.activeId === launchedFrom) return
    const created = articles.find(item => item.id === props.activeId)
    if (created?.activityKind === "batch" && created.activityId) go("batch", created.activityId)
    else go("article", props.activeId)
  }, [props.activeId, route.view, launchedFrom])

  const planName = useMemo(() => new Map(contentPlans.map(plan => [plan.id, plan.name])), [contentPlans])
  const batches = useMemo(() => {
    const groups = new Map<string, Article[]>()
    for (const article of articles) if (article.activityKind === "batch" && article.activityId)
      groups.set(article.activityId, [...(groups.get(article.activityId) ?? []), article])
    return [...groups.entries()].map(([id, items]) => ({
      id, items,
      plan: items[0]?.contentPlanId ? planName.get(items[0].contentPlanId) ?? "" : "",
      createdAt: items.reduce((min, item) => item.createdAt < min ? item.createdAt : min, items[0].createdAt),
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [articles, planName])
  const reviewQueue = articles.filter(article => article.draft?.trim() && !isLegacyArticle(article))

  const nav: Array<{ view: View; label: string; icon: ReactNode; count?: number; admin?: boolean }> = [
    { view: "articles", label: tr("Bài viết", "Articles"), icon: <FileText size={16} />, count: articles.length },
    { view: "plans", label: "Content Plans", icon: <FolderKanban size={16} />, count: contentPlans.length },
    { view: "batches", label: "Batches", icon: <Boxes size={16} />, count: batches.length },
    { view: "review", label: "Review Workspace", icon: <ClipboardCheck size={16} />, count: reviewQueue.filter(a => humanReviewStatus(a) === "not_reviewed").length },
    { view: "storage", label: "Storage", icon: <LayoutList size={16} />, admin: true },
    { view: "workflow", label: tr("Quy trình 3 gate", "3-gate workflow"), icon: <Workflow size={16} /> },
    { view: "dashboard", label: "Dashboard", icon: <BarChart3 size={16} /> },
  ]
  const activeNav: View = route.view === "article" ? "articles" : route.view === "plan" ? "plans" : route.view === "batch" ? "batches" : route.view
  const article = route.view === "article" ? articles.find(item => item.id === route.id) : undefined

  let content: ReactNode
  switch (route.view) {
    case "article": content = article
      ? <ArticleRecord {...props} article={article} settings={settings} planName={planName} />
      : <Missing label={tr("Không tìm thấy bài viết.", "Article not found.")} />; break
    case "plans": content = <PlansView plans={contentPlans} articles={articles} settings={settings} />; break
    case "plan": content = <PlanRecord plan={contentPlans.find(plan => plan.id === route.id)} articles={articles.filter(a => a.contentPlanId === route.id)} settings={settings} />; break
    case "batches": content = <BatchesView batches={batches} settings={settings} />; break
    case "batch": content = <Page crumbs={[["Batches", "batches"]]} title={batches.find(b => b.id === route.id)?.plan || route.id || ""}>
      <div className="card"><div className="embed">{route.id && props.renderBatch(route.id, id => go("article", id))}</div></div>
    </Page>; break
    case "review": content = <ReviewView {...props} queue={reviewQueue} settings={settings} planName={planName} />; break
    case "storage": content = <StorageView files={files} config={config} isAdmin={isAdmin} onManage={props.onOpenAdvancedSettings} />; break
    case "workflow": content = <WorkflowView config={config} files={files} settings={settings} />; break
    case "dashboard": content = <DashboardView articles={articles} settings={settings} />; break
    case "settings": content = <SettingsView {...props} settings={settings} isAdmin={isAdmin} />; break
    case "new": content = <Page title={tr("Thêm Plan", "Add Plan")}><div className="card"><div className="embed">{props.renderLauncher()}</div></div></Page>; break
    default: content = <ArticlesView articles={articles} settings={settings} planName={planName} onRetry={props.onRetry} />
  }

  return (
    <div className={`crm${navOpen ? " nav-open" : ""}`}>
      <nav className="nav" aria-label={tr("Điều hướng chính", "Main navigation")}>
        <div className="ws"><Sparkles size={16} /> Writer Studio</div>
        <button className="nav-item" onClick={() => setCmdOpen(true)}><Search size={16} /> {tr("Tìm kiếm", "Search")}<span className="kbd">⌘K</span></button>
        <button className={`nav-item${route.view === "new" ? " on" : ""}`} onClick={() => go("new")}><Plus size={16} /> {tr("Thêm Plan", "Add Plan")}</button>
        <div className="nav-sec">{tr("Dữ liệu", "Records")}</div>
        {nav.filter(item => !item.admin || isAdmin).map(item =>
          <button key={item.view} className={`nav-item${activeNav === item.view ? " on" : ""}`} aria-current={activeNav === item.view ? "page" : undefined} onClick={() => go(item.view)}>
            {item.icon} {item.label}{item.count !== undefined && <span className="n">{item.count}</span>}
          </button>)}
        <div className="nav-foot">
          <button className={`nav-item${route.view === "settings" ? " on" : ""}`} onClick={() => go("settings")}><Settings size={16} /> {tr("Cài đặt", "Settings")}</button>
          <button className="nav-item" onClick={props.onSwitchClassic}><Undo2 size={16} /> {tr("Giao diện cũ", "Classic UI")}</button>
          <button className="nav-item" onClick={props.onSignOut} title={user.email}><LogOut size={16} /> {tr("Đăng xuất", "Sign out")}</button>
        </div>
      </nav>
      <div className="page">
        <button className="btn ghost menu-btn" style={{ alignSelf: "flex-start" }} aria-label={tr("Mở menu", "Open menu")} onClick={() => setNavOpen(true)}><Menu size={16} /></button>
        {content}
      </div>
      {navOpen && <div className="nav-scrim" aria-hidden="true" onClick={() => setNavOpen(false)} />}
      {cmdOpen && <CommandMenu {...props} onClose={() => setCmdOpen(false)} />}
    </div>
  )
}

function Page({ title, crumbs = [], actions, children }: { title: ReactNode; crumbs?: Array<[string, View]>; actions?: ReactNode; children: ReactNode }) {
  return <>
    <header className="ph">
      <div className="ph-title">
        {crumbs.map(([label, view]) => <span key={view} style={{ display: "contents" }}><button className="crumb" onClick={() => go(view)}>{label}</button><ChevronRight size={14} className="muted" /></span>)}
        <b>{title}</b>
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </header>
    {children}
  </>
}
function Missing({ label }: { label: string }) {
  return <Page title="—"><div className="card"><div className="empty-state"><h3>{label}</h3></div></div></Page>
}

function AiTag({ article, settings }: { article: Article; settings: PipelineSettings }) {
  const { tr } = useI18n()
  const result = aiApproval(article, settings)
  if (result.state === "pending") return <span className="tag t-gray">{tr("Chưa chấm", "Not scored")}</span>
  return <span className={`tag ${result.state === "approved" ? "t-green" : "t-red"}`} title={result.hardBlocked ? tr("Có lỗi chặn cứng (dẫn chứng)", "Hard block (evidence)") : undefined}>
    {result.state === "approved" ? tr("AI duyệt", "AI approved") : tr("Chưa đạt", "Below")} · {result.score}%
  </span>
}
function HumanTag({ article }: { article: Article }) {
  const { tr } = useI18n()
  const status = humanReviewStatus(article)
  if (status === "approved") return <span className="tag t-green">Approved</span>
  if (status === "needs_revision") return <span className="tag t-orange">Needs Revision</span>
  return <span className="tag t-gray">{tr("Chưa review", "Not Reviewed")}</span>
}

/* ─── Articles ─────────────────────────────────────────────────────────── */

function ArticlesView({ articles, settings, planName, onRetry }: { articles: Article[]; settings: PipelineSettings; planName: Map<string, string>; onRetry: (a: Article) => Promise<void> }) {
  const { tr } = useI18n()
  const [mode, setMode] = useState<"table" | "kanban">(() => { try { return localStorage.getItem("writer:crm-articles") === "kanban" ? "kanban" : "table" } catch { return "table" } })
  const [query, setQuery] = useState("")
  const [plan, setPlan] = useState("")
  const [sort, setSort] = useState<{ key: "title" | "updated" | "score"; dir: 1 | -1 }>({ key: "updated", dir: -1 })
  useEffect(() => { try { localStorage.setItem("writer:crm-articles", mode) } catch { /* per-viewer convenience only */ } }, [mode])
  const plans = [...new Set(articles.map(a => a.contentPlanId).filter(Boolean) as string[])]
  const rows = articles
    .filter(a => (!plan || a.contentPlanId === plan) && titleOf(a).toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => sort.dir * (sort.key === "title" ? titleOf(a).localeCompare(titleOf(b))
      : sort.key === "score" ? (aiApproval(a, settings).score ?? -1) - (aiApproval(b, settings).score ?? -1)
      : a.updatedAt.localeCompare(b.updatedAt)))
  const sortBy = (key: typeof sort.key) => setSort(current => ({ key, dir: current.key === key ? (current.dir === 1 ? -1 : 1) : 1 }))
  const arrow = (key: typeof sort.key) => sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""

  return <Page title={tr("Bài viết", "Articles")} actions={<button className="btn primary" onClick={() => go("new")}><Plus size={14} /><span>{tr("Thêm Plan", "Add Plan")}</span></button>}>
    <div className="card">
      <div className="vbar">
        <div className="seg" role="group" aria-label={tr("Kiểu xem", "View")}>
          <button className={mode === "table" ? "on" : ""} aria-pressed={mode === "table"} onClick={() => setMode("table")}><LayoutList size={14} /> Table</button>
          <button className={mode === "kanban" ? "on" : ""} aria-pressed={mode === "kanban"} onClick={() => setMode("kanban")}><KanbanSquare size={14} /> Kanban</button>
        </div>
        <span className="count">{rows.length}</span>
        <span className="grow" />
        <Search size={14} className="muted" />
        <input aria-label={tr("Tìm bài viết", "Search articles")} placeholder={tr("Tìm bài viết…", "Search…")} value={query} onChange={e => setQuery(e.target.value)} />
        <select aria-label="Plan" value={plan} onChange={e => setPlan(e.target.value)}>
          <option value="">{tr("Mọi plan", "All plans")}</option>
          {plans.map(id => <option key={id} value={id}>{planName.get(id) ?? id}</option>)}
        </select>
      </div>
      {!articles.length ? <div className="empty-state"><FileText size={36} /><h3>{tr("Chưa có bài viết", "No articles yet")}</h3><button className="btn primary" onClick={() => go("new")}>{tr("Thêm Plan", "Add Plan")}</button></div>
        : mode === "kanban" ? <div className="kb">
          {PIPELINE_STAGES.map(stage => {
            const cards = rows.filter(a => articleStage(a) === stage)
            return <section key={stage} className="kcol" aria-label={STAGE_META[stage].label}>
              <div className="khead"><StageTag stage={stage} /><span className="n">{cards.length}</span></div>
              {cards.map(a => <div key={a.id} className="kcard">
                <button className="kt" style={{ textAlign: "left" }} onClick={() => go("article", a.id)}>{titleOf(a)}</button>
                <div className="kf"><AiTag article={a} settings={settings} /><HumanTag article={a} /></div>
                {a.contentPlanId && <div className="kf muted">{planName.get(a.contentPlanId) ?? ""}</div>}
                {stage === "failed" && a.activityId && <button className="btn" onClick={() => void onRetry(a).catch(error => notifyWorkspace(error.message, "error"))}><RotateCcw size={14} /> Retry</button>}
              </div>)}
            </section>
          })}
        </div>
        : <div className="tbl-wrap"><table className="tbl">
          <thead><tr>
            <th className="first"><button onClick={() => sortBy("title")}>{tr("Bài viết", "Article")}{arrow("title")}</button></th>
            <th>Gate</th>
            <th><button onClick={() => sortBy("score")}>AI Approval{arrow("score")}</button></th>
            <th>Human review</th><th>Plan</th>
            <th><button onClick={() => sortBy("updated")}>{tr("Cập nhật", "Updated")}{arrow("updated")}</button></th>
          </tr></thead>
          <tbody>{rows.map(a => { const stage = articleStage(a); return <tr key={a.id} onClick={() => go("article", a.id)}>
            <td className="first"><a href={`#/article/${encodeURIComponent(a.id)}`} onClick={e => e.stopPropagation()}>{titleOf(a)}</a></td>
            <td><GateBar article={a} /> <StageTag stage={stage} /></td>
            <td><AiTag article={a} settings={settings} /></td>
            <td><HumanTag article={a} /></td>
            <td className="muted">{a.contentPlanId ? planName.get(a.contentPlanId) ?? "" : tr("Bài lẻ", "Single")}</td>
            <td className="muted">{fmt(a.updatedAt)}</td>
          </tr> })}</tbody>
        </table></div>}
    </div>
  </Page>
}

async function copyToDocs(article: Article) {
  const markdown = normalizeDraftOutput(article.draft ?? "")
  if (navigator.clipboard.write && typeof ClipboardItem !== "undefined")
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([markdownToHtml(markdown)], { type: "text/html" }),
      "text/plain": new Blob([markdown], { type: "text/plain" }),
    })])
  else await navigator.clipboard.writeText(markdown)
}

function ArticleRecord(props: Props & { article: Article; settings: PipelineSettings; planName: Map<string, string> }) {
  const { tr } = useI18n()
  const { article, settings, planName } = props
  const stage = articleStage(article)
  const approval = aiApproval(article, settings)
  const legacy = isLegacyArticle(article)
  const [tab, setTab] = useState<"final" | "review" | "history" | "manual">(article.draft?.trim() && !legacy ? "final" : "manual")
  useEffect(() => { setTab(article.draft?.trim() && !legacy ? "final" : "manual") }, [article.id])
  const ready = props.activeId === article.id
  const completed = stage === "completed"

  const field = (label: string, value: ReactNode) => <div className="frow"><span className="flabel">{label}</span><span className="fval">{value}</span></div>
  return <Page crumbs={[[tr("Bài viết", "Articles"), "articles"]]} title={titleOf(article)} actions={<>
    {article.draft?.trim() && <button className="btn" onClick={() => void copyToDocs(article).then(() => notifyWorkspace(tr("Đã copy, dán vào Google Docs.", "Copied — paste into Google Docs."), "success")).catch(error => notifyWorkspace(error.message, "error"))}><Copy size={14} /><span>Copy to Docs</span></button>}
    {(stage === "ai" || completed) && !legacy && <button className="btn primary" disabled={!ready || props.completionSavingId === article.id} title={!completed && approval.state !== "approved" ? tr("AI chưa duyệt — vẫn có thể hoàn thành thủ công.", "AI has not approved — you can still complete manually.") : undefined} onClick={() => props.onToggleComplete(article)}>
      <CheckCircle2 size={14} /><span>{completed ? tr("Mở lại", "Reopen") : tr("Hoàn thành", "Complete")}</span>
    </button>}
    <button className="btn ghost danger" aria-label={tr("Xoá bài viết", "Delete article")} onClick={() => props.onDeleteArticle(article)}><Trash2 size={14} /></button>
  </>}>
    <div className="card"><div className="show">
      <aside className="show-left">
        <div className="rec-head"><div className="av-xl"><FileText size={20} /></div><h1>{titleOf(article)}</h1><div className="sub">{tr("Tạo", "Created")} {fmt(article.createdAt)}</div></div>
        <div className="fields">
          <div className="fsec">Pipeline</div>
          {field("Gate", <><GateBar article={article} /> <StageTag stage={stage} /></>)}
          {field("AI Approval", <AiTag article={article} settings={settings} />)}
          {field("Human review", <HumanTag article={article} />)}
          {field(tr("Ngưỡng", "Threshold"), `${settings.threshold}%`)}
          <div className="fsec">{tr("Thông tin", "Details")}</div>
          {field("Plan", article.contentPlanId ? <a className="link" href={`#/plan/${encodeURIComponent(article.contentPlanId)}`}>{planName.get(article.contentPlanId) ?? "Plan"}</a> : <span className="muted">{tr("Bài lẻ", "Single")}</span>)}
          {field("Batch", article.activityKind === "batch" && article.activityId ? <a className="link" href={`#/batch/${encodeURIComponent(article.activityId)}`}>{tr("Mở batch", "Open batch")}</a> : <span className="muted">—</span>)}
          {field("Keyword", article.articleSpec?.primaryQuery || article.keywords || "—")}
          {field(tr("Loại bài", "Type"), article.activityType === "editorial-originality" ? "Editorial" : article.activityType ? "Comparison SEO" : "—")}
          {field(tr("Cập nhật", "Updated"), fmt(article.updatedAt))}
          {article.batchError && field(tr("Lỗi", "Error"), <span className="tag t-red" title={article.batchError}>{article.batchError}</span>)}
        </div>
      </aside>
      <section className="show-right">
        <div className="tabs" role="tablist">
          {([["final", "Final Article"], ["review", "AI Review"], ["history", "Generation History"], ["manual", tr("Chế độ thủ công", "Manual mode")]] as const).map(([key, label]) =>
            <button key={key} role="tab" aria-selected={tab === key} className={`tab${tab === key ? " on" : ""}`} onClick={() => setTab(key)}>
              {label}{key === "review" && approval.failed.length > 0 && <span className="n">{approval.failed.length}</span>}
            </button>)}
        </div>
        {tab === "final" && <div className="tab-body">{article.draft?.trim()
          ? <article className="reading draft-prose draft-rendered" dangerouslySetInnerHTML={{ __html: markdownToHtml(normalizeDraftOutput(article.draft)) }} />
          : <div className="empty-state"><h3>{tr("Chưa có bài hoàn chỉnh", "No final article yet")}</h3><p>{tr("Bài sẽ hiện ở đây khi qua Gate 3.", "It appears here after Gate 3.")}</p></div>}</div>}
        {tab === "review" && <div className="tab-body"><div className="reading"><AiReviewPanel article={article} settings={settings} /></div></div>}
        {tab === "history" && <div className="tab-body"><div className="reading"><Timeline article={article} /></div></div>}
        {tab === "manual" && <div className="tab-body flush"><div className="embed">{ready ? props.renderManual() : <div className="empty-state">{tr("Đang mở…", "Opening…")}</div>}</div></div>}
      </section>
    </div></div>
  </Page>
}

function AiReviewPanel({ article, settings }: { article: Article; settings: PipelineSettings }) {
  const { tr } = useI18n()
  const approval = aiApproval(article, settings)
  const checks = [...(article.qualityReport?.checks ?? [])].sort((a, b) => ["fail", "warning", "pass"].indexOf(a.status) - ["fail", "warning", "pass"].indexOf(b.status))
  if (approval.state === "pending") return <div className="empty-state"><h3>{tr("Chưa có kết quả AI Review", "No AI review yet")}</h3><p>{tr("Chạy QC ở Gate 3 (Chế độ thủ công → Draft) để chấm điểm.", "Run QC in Gate 3 (Manual mode → Draft) to score.")}</p></div>
  return <>
    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
      <div className="score">{approval.score}%</div>
      <div><AiTag article={article} settings={settings} /><div className="muted" style={{ marginTop: 4 }}>{tr("Ngưỡng", "Threshold")} {settings.threshold}% · {checks.length} {tr("tiêu chí", "criteria")} · {fmt(article.qualityReport?.checkedAt)}</div></div>
    </div>
    {approval.hardBlocked && <p className="note">{tr("Có tiêu chí chặn cứng bị trượt (dẫn chứng không được hỗ trợ) nên bài không được AI duyệt dù điểm cao.", "A hard-block criterion failed (unsupported evidence), so AI does not approve regardless of score.")}</p>}
    {checks.map(check => <div key={check.id} className="qc-row">
      <span className={`tag ${check.status === "pass" ? "t-green" : check.status === "warning" ? "t-yellow" : "t-red"}`}>{check.status === "pass" ? "Pass" : check.status === "warning" ? "Warn" : "Fail"}</span>
      <div className="grow"><b style={{ fontWeight: 500 }}>{check.label}</b>{check.status !== "pass" && <p>{check.reason}</p>}{check.recommendedAction && check.status !== "pass" && <p className="muted">{check.recommendedAction}</p>}</div>
    </div>)}
  </>
}

function Timeline({ article }: { article: Article }) {
  const { tr } = useI18n()
  const usage = Object.values(article.aiUsageByStep ?? {}).flat()
  const cost = usage.reduce((sum, call) => sum + (call?.costUsd ?? 0), 0)
  const events = ([
    [article.createdAt, tr("Tạo bài", "Created")],
    [article.coreIdeaScannedAt, "G1 · Core Idea"],
    [article.outlineScannedAt, "G2 · Outline"],
    [article.draftScannedAt, "G3 · Final Article"],
    [article.qualityReport?.checkedAt, "AI Review"],
    [article.humanReview?.reviewedAt, `Human review · ${article.humanReview?.status === "approved" ? "Approved" : "Needs Revision"}${article.humanReview?.comment ? ` — ${article.humanReview.comment}` : ""}`],
    [article.completedAt, "Completed"],
  ] as Array<[string | null | undefined, string]>).filter(([when]) => when).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return <>
    <p className="muted" style={{ marginTop: 0 }}>{usage.length} {tr("lượt gọi AI", "AI calls")}{cost ? ` · $${cost.toFixed(3)}` : ""} · {article.coreIdeaSuggestions?.length ?? 0} {tr("option ở G1", "G1 options")}</p>
    <div className="tl">{events.map(([when, label], index) => <div key={index} className="tl-item"><span className="dot"><History size={12} /></span><b>{label}</b><span className="when">{fmt(when)}</span></div>)}</div>
  </>
}

/* ─── Plans & batches ──────────────────────────────────────────────────── */

function progress(items: Article[], settings: PipelineSettings) {
  const done = items.filter(a => articleStage(a) === "completed").length
  return { done, total: items.length, failed: items.filter(a => articleStage(a) === "failed").length, rate: firstPassApprovalRate(items, settings) }
}

function PlansView({ plans, articles, settings }: { plans: ContentPlan[]; articles: Article[]; settings: PipelineSettings }) {
  const { tr } = useI18n()
  return <Page title="Content Plans" actions={<button className="btn primary" onClick={() => go("new")}><Plus size={14} /><span>{tr("Thêm Plan", "Add Plan")}</span></button>}>
    <div className="card">{!plans.length ? <div className="empty-state"><FolderKanban size={36} /><h3>{tr("Chưa có Content Plan", "No content plans")}</h3></div>
      : <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th className="first">Plan</th><th>{tr("Trạng thái", "Status")}</th><th>{tr("Topic", "Topics")}</th><th>{tr("Đã tạo bài", "Articles")}</th><th>Completed</th><th>First-pass</th><th>{tr("Cập nhật", "Updated")}</th></tr></thead>
        <tbody>{plans.map(plan => { const items = articles.filter(a => a.contentPlanId === plan.id); const p = progress(items, settings)
          return <tr key={plan.id} onClick={() => go("plan", plan.id)}>
            <td className="first">{plan.name}</td><td><span className="tag t-gray">{plan.status}</span></td>
            <td className="num">{plan.totalArticles}</td><td className="num">{items.length}</td><td className="num">{p.done}/{p.total}</td>
            <td className="num">{p.rate === null ? "—" : `${p.rate}%`}</td><td className="muted">{fmt(plan.updatedAt)}</td>
          </tr> })}</tbody>
      </table></div>}</div>
  </Page>
}

function PlanRecord({ plan, articles, settings }: { plan?: ContentPlan; articles: Article[]; settings: PipelineSettings }) {
  const { tr } = useI18n()
  if (!plan) return <Missing label={tr("Không tìm thấy plan.", "Plan not found.")} />
  const p = progress(articles, settings)
  return <Page crumbs={[["Content Plans", "plans"]]} title={plan.name}>
    <div className="card">
      <div className="vbar"><span>{p.done}/{p.total} completed</span><span className="muted">· {p.failed} failed · First-pass {p.rate === null ? "—" : `${p.rate}%`}</span></div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th className="first">{tr("Bài viết", "Article")}</th><th>Gate</th><th>AI Approval</th><th>Human review</th><th>{tr("Cập nhật", "Updated")}</th></tr></thead>
        <tbody>{articles.map(a => { const stage = articleStage(a); return <tr key={a.id} onClick={() => go("article", a.id)}>
          <td className="first">{titleOf(a)}</td><td><GateBar article={a} /> <StageTag stage={stage} /></td>
          <td><AiTag article={a} settings={settings} /></td><td><HumanTag article={a} /></td><td className="muted">{fmt(a.updatedAt)}</td>
        </tr> })}</tbody>
      </table></div>
    </div>
  </Page>
}

function BatchesView({ batches, settings }: { batches: Array<{ id: string; items: Article[]; plan: string; createdAt: string }>; settings: PipelineSettings }) {
  const { tr } = useI18n()
  return <Page title="Batches">
    <div className="card">{!batches.length ? <div className="empty-state"><Boxes size={36} /><h3>{tr("Chưa có batch", "No batches")}</h3></div>
      : <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th className="first">Batch</th><th>{tr("Trạng thái", "Status")}</th><th>{tr("Tiến độ", "Progress")}</th><th>Failed</th><th>First-pass</th><th>{tr("Tạo lúc", "Created")}</th></tr></thead>
        <tbody>{batches.map(batch => { const p = progress(batch.items, settings)
          const running = batch.items.some(a => a.batchStatus === "running"), paused = batch.items.some(a => a.batchStatus === "paused")
          return <tr key={batch.id} onClick={() => go("batch", batch.id)}>
            <td className="first">{batch.plan || batch.id}</td>
            <td><span className={`tag ${running ? "t-blue" : paused ? "t-yellow" : p.done === p.total ? "t-green" : "t-gray"}`}>{running ? "Running" : paused ? "Paused" : p.done === p.total ? "Done" : "Queued"}</span></td>
            <td className="num">{p.done}/{p.total}</td><td className="num">{p.failed}</td>
            <td className="num">{p.rate === null ? "—" : `${p.rate}%`}</td><td className="muted">{fmt(batch.createdAt)}</td>
          </tr> })}</tbody>
      </table></div>}</div>
  </Page>
}

/* ─── Review workspace ─────────────────────────────────────────────────── */

function ReviewView(props: Props & { queue: Article[]; settings: PipelineSettings; planName: Map<string, string> }) {
  const { tr } = useI18n()
  const { queue, settings, planName } = props
  const [filter, setFilter] = useState<"all" | "not_reviewed" | "approved" | "needs_revision">("not_reviewed")
  const [sampleOnly, setSampleOnly] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const rows = queue.filter(a => (filter === "all" || humanReviewStatus(a) === filter) && (!sampleOnly || inReviewSample(a.id, settings.reviewSample)))
  const open = queue.find(a => a.id === openId)
  return <Page title="Review Workspace">
    <div className="card">
      <div className="vbar">
        <div className="seg" role="group" aria-label={tr("Lọc", "Filter")}>
          {([["not_reviewed", tr("Chưa review", "Not Reviewed")], ["needs_revision", "Needs Revision"], ["approved", "Approved"], ["all", tr("Tất cả", "All")]] as const).map(([key, label]) =>
            <button key={key} className={filter === key ? "on" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={sampleOnly} onChange={e => setSampleOnly(e.target.checked)} style={{ width: 14 }} /> {tr("Chỉ mẫu ngẫu nhiên", "Random sample only")} ({settings.reviewSample}%)</label>
        <span className="grow" /><span className="count">{rows.length}</span>
      </div>
      {!rows.length ? <div className="empty-state"><ClipboardCheck size={36} /><h3>{tr("Không có bài cần review", "Nothing to review")}</h3></div>
        : <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th className="first">{tr("Bài viết", "Article")}</th><th>AI Approval</th><th>Human review</th><th>Plan</th><th>Reviewer</th><th>{tr("Ngày", "Date")}</th></tr></thead>
          <tbody>{rows.map(a => <tr key={a.id} onClick={() => setOpenId(a.id)}>
            <td className="first">{titleOf(a)}</td><td><AiTag article={a} settings={settings} /></td><td><HumanTag article={a} /></td>
            <td className="muted">{a.contentPlanId ? planName.get(a.contentPlanId) ?? "" : "—"}</td>
            <td className="muted">{a.humanReview?.reviewer ?? "—"}</td><td className="muted">{fmt(a.humanReview?.reviewedAt ?? a.draftScannedAt ?? a.updatedAt)}</td>
          </tr>)}</tbody>
        </table></div>}
    </div>
    {open && <ReviewPanel {...props} article={open} onClose={() => setOpenId(null)} />}
  </Page>
}

function ReviewPanel(props: Props & { article: Article; settings: PipelineSettings; onClose: () => void }) {
  const { tr } = useI18n()
  const { article, settings, onClose } = props
  const [comment, setComment] = useState(article.humanReview?.comment ?? "")
  const [saving, setSaving] = useState(false)
  useEffect(() => { setComment(article.humanReview?.comment ?? "") }, [article.id])
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey) }, [onClose])
  const save = async (status: "approved" | "needs_revision") => {
    if (status === "needs_revision" && !comment.trim()) return notifyWorkspace(tr("Cần ghi nhận xét khi yêu cầu sửa.", "A comment is required to request revision."), "error")
    setSaving(true)
    const ok = await props.onUpdateArticle(article.id, { humanReview: { status, comment: comment.trim() || undefined, reviewer: props.user.email, reviewedAt: new Date().toISOString() } })
    setSaving(false)
    if (ok) { notifyWorkspace(status === "approved" ? "Approved" : "Needs Revision", "success"); onClose() }
  }
  return <>
    <div className="crm-sp-overlay" onClick={onClose} />
    <aside className="sp" role="dialog" aria-label={titleOf(article)}>
      <div className="sp-head"><span className="t">{titleOf(article)}</span><AiTag article={article} settings={settings} /><button className="btn ghost" aria-label={tr("Đóng", "Close")} onClick={onClose}><X size={14} /></button></div>
      <div className="sp-body"><article className="draft-prose draft-rendered" dangerouslySetInnerHTML={{ __html: markdownToHtml(normalizeDraftOutput(article.draft ?? "")) }} /></div>
      <div className="sp-foot">
        <label className="fl">{tr("Nhận xét (bắt buộc khi yêu cầu sửa)", "Comment (required for revision)")}<textarea className="inp" value={comment} onChange={e => setComment(e.target.value)} /></label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => go("article", article.id)}>{tr("Mở bài", "Open")}</button>
          <button className="btn" disabled={saving} onClick={() => void save("needs_revision")}>Request Revision</button>
          <button className="btn primary" disabled={saving} onClick={() => void save("approved")}>Approve</button>
        </div>
      </div>
    </aside>
  </>
}

/* ─── Storage & workflow ───────────────────────────────────────────────── */

const GATE_STEPS: Array<[2 | 3 | 4, string]> = [[2, "G1"], [3, "G2"], [4, "G3"]]
const STORAGE_GAPS = ["Checklist Gate 1–2", "Quy tắc chỉnh sửa", "Vocabulary Library", "Writing Patterns (bản duyệt)", "Approved Articles"]

function usedAt(file: DocumentFile, config: AppConfig) {
  return GATE_STEPS.filter(([step]) => { const access = config.stepConfigs[step]?.fileAccess; return access?.kb?.includes(file.id) || access?.rules?.includes(file.id) }).map(([, gate]) => gate)
}

function StorageView({ files, config, isAdmin, onManage }: { files: DocumentFile[]; config: AppConfig; isAdmin: boolean; onManage: () => void }) {
  const { tr } = useI18n()
  const groups: Array<[string, DocumentFile[]]> = [["Knowledge Base", files.filter(f => f.category === "kb")], ["Skills & Rules", files.filter(f => f.category === "rules")]]
  return <Page title="Storage" actions={isAdmin && <button className="btn" onClick={onManage}><Settings size={14} /><span>{tr("Quản lý tài liệu", "Manage documents")}</span></button>}>
    <div className="card">
      <div className="vbar"><span className="muted">{tr("Còn thiếu:", "Open gaps:")}</span>{STORAGE_GAPS.map(gap => <span key={gap} className="tag t-yellow">{gap}</span>)}</div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th className="first">{tr("Tài liệu", "Document")}</th><th>Used at</th><th>{tr("Loại file", "Type")}</th><th>{tr("Cập nhật", "Updated")}</th></tr></thead>
        <tbody>{groups.map(([label, items]) => <FragmentRows key={label} label={`${label} · ${items.length}`}>
          {items.map(file => { const gates = usedAt(file, config); return <tr key={file.id} style={{ cursor: "default" }}>
            <td className="first">{file.name}</td>
            <td>{gates.length ? gates.map(g => <span key={g} className="tag t-blue" style={{ marginRight: 4 }}>{g}</span>) : <span className="muted">{tr("Chưa cấp cho gate nào", "Not shipped")}</span>}</td>
            <td className="muted">{file.fileType}</td><td className="muted">{file.contentUpdatedAt ? fmt(file.contentUpdatedAt) : file.uploadedAt}</td>
          </tr> })}
        </FragmentRows>)}</tbody>
      </table></div>
    </div>
  </Page>
}
function FragmentRows({ label, children }: { label: string; children: ReactNode }) {
  return <><tr className="grp"><td colSpan={4}>{label}</td></tr>{children}</>
}

function WorkflowView({ config, files, settings }: { config: AppConfig; files: DocumentFile[]; settings: PipelineSettings }) {
  const { tr } = useI18n()
  const [open, setOpen] = useState<string | null>(null)
  const model = (step: number) => config.models.find(m => m.id === config.stepConfigs[step]?.modelId)?.name ?? "—"
  const docs = (step: number) => { const access = config.stepConfigs[step]?.fileAccess; return files.filter(f => access?.kb?.includes(f.id) || access?.rules?.includes(f.id)) }
  const nodes: Array<{ key: string; kind: string; name: string; detail: string; step?: number }> = [
    { key: "plan", kind: "Trigger", name: "Add Plan", detail: tr("Import topic từ Content Plan", "Import topics from a content plan") },
    { key: "batch", kind: "Scheduler", name: "Auto Split Batches", detail: tr(`Batch theo cỡ chọn khi tạo · ${settings.maxParallel} bài song song`, `Batch size chosen at creation · ${settings.maxParallel} in parallel`) },
    { key: "g1", kind: "Gate 1", name: "Research/Topic", detail: `${model(2)} · ${docs(2).length} ${tr("tài liệu", "docs")}`, step: 2 },
    { key: "g2", kind: "Gate 2", name: "Outline", detail: `${model(3)} · ${docs(3).length} ${tr("tài liệu", "docs")}`, step: 3 },
    { key: "g3", kind: "Gate 3", name: "Final Article", detail: `${model(4)} · ${docs(4).length} ${tr("tài liệu", "docs")}`, step: 4 },
    { key: "ai", kind: "Reviewer", name: "AI Approval", detail: `Universal QC · ${tr("ngưỡng", "threshold")} ${settings.threshold}%` },
    { key: "human", kind: "Human", name: "Human review", detail: tr(`Song song, không chặn · mẫu ${settings.reviewSample}%`, `Parallel, non-blocking · ${settings.reviewSample}% sample`) },
  ]
  const node = nodes.find(n => n.key === open)
  return <Page title={tr("Quy trình 3 gate", "3-gate workflow")}>
    <div className="card"><div className="canvas">
      {nodes.map((n, index) => <div key={n.key} style={{ display: "contents" }}>
        {index > 0 && <div className="wline" />}
        <button className={`wnode${open === n.key ? " on" : ""}`} onClick={() => setOpen(open === n.key ? null : n.key)}>
          <span className="wi">{n.step ? <GitBranch size={16} /> : <Command size={16} />}</span>
          <span><span className="wk">{n.kind}</span><br /><span className="wn">{n.name}</span><br /><span className="muted">{n.detail}</span></span>
        </button>
      </div>)}
      {node && <div className="note" style={{ marginTop: 24, maxWidth: 520 }}>
        <b style={{ fontWeight: 600 }}>{node.kind} · {node.name}</b>
        {node.step ? <>
          <p style={{ margin: "6px 0" }}>{tr("Executor package (Shipper):", "Executor package (Shipper):")} {docs(node.step).map(f => f.name).join(", ") || "—"}</p>
          <p style={{ margin: 0 }} className="muted">{tr(`Đề xuất ${settings.options} option/gate, ${settings.revisionRounds} vòng sửa. Bản chạy thử hiện tạo option theo cách của Writer Studio (G1 nhiều ý tưởng có điểm; G2, G3 một bản).`, `Proposed ${settings.options} options/gate, ${settings.revisionRounds} revision round. The trial currently generates options the existing way (G1 scored ideas; G2, G3 single output).`)}</p>
        </> : <p style={{ margin: "6px 0 0" }}>{node.detail}</p>}
      </div>}
    </div></div>
  </Page>
}

/* ─── Dashboard ────────────────────────────────────────────────────────── */

function DashboardView({ articles, settings }: { articles: Article[]; settings: PipelineSettings }) {
  const { tr } = useI18n()
  const rate = firstPassApprovalRate(articles, settings)
  const byStage = PIPELINE_STAGES.map(stage => [STAGE_META[stage].label, articles.filter(a => articleStage(a) === stage).length] as const)
  const reviewed = articles.filter(a => a.draft?.trim())
  const human = [["Not Reviewed", reviewed.filter(a => humanReviewStatus(a) === "not_reviewed").length], ["Approved", reviewed.filter(a => humanReviewStatus(a) === "approved").length], ["Needs Revision", reviewed.filter(a => humanReviewStatus(a) === "needs_revision").length]] as const
  const failCounts = new Map<string, number>()
  for (const a of articles) for (const check of a.qualityReport?.checks ?? []) if (check.status === "fail") failCounts.set(check.label, (failCounts.get(check.label) ?? 0) + 1)
  const topFails = [...failCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  const cost = articles.reduce((sum, a) => sum + Object.values(a.aiUsageByStep ?? {}).flat().reduce((s, call) => s + (call?.costUsd ?? 0), 0), 0)
  const bars = (rows: ReadonlyArray<readonly [string, number]>) => { const max = Math.max(1, ...rows.map(([, v]) => v)); return rows.map(([label, value]) =>
    <div key={label} className="hbar"><span className="lbl" title={label}>{label}</span><span className="track"><span className="fill" style={{ width: `${(value / max) * 100}%`, display: "block" }} /></span><span className="v">{value}</span></div>) }
  return <Page title="Dashboard">
    <div className="card"><div className="dash">
      <div className="widget"><h4>First-pass Approval Rate</h4><div className="kpi">{rate === null ? "—" : `${rate}%`}</div><div className="kpi-sub">{tr("Ngưỡng", "Threshold")} {settings.threshold}%</div></div>
      <div className="widget"><h4>{tr("Tổng bài", "Articles")}</h4><div className="kpi">{articles.length}</div><div className="kpi-sub">{byStage.find(([l]) => l === "Completed")?.[1]} completed</div></div>
      <div className="widget"><h4>Needs Revision</h4><div className="kpi">{human[2][1]}</div><div className="kpi-sub">{human[1][1]} approved</div></div>
      <div className="widget"><h4>{tr("Chi phí AI", "AI cost")}</h4><div className="kpi">${cost.toFixed(2)}</div><div className="kpi-sub">{tr("theo usage đã ghi", "from recorded usage")}</div></div>
      <div className="widget w2"><h4>{tr("Bài theo gate", "Articles by gate")}</h4>{bars(byStage)}</div>
      <div className="widget w2"><h4>Human review</h4>{bars(human)}</div>
      <div className="widget w4"><h4>{tr("Tiêu chí trượt nhiều nhất", "Most failed criteria")}</h4>{topFails.length ? bars(topFails) : <span className="muted">{tr("Chưa có dữ liệu", "No data yet")}</span>}</div>
    </div></div>
  </Page>
}

/* ─── Settings ─────────────────────────────────────────────────────────── */

function SettingsView(props: Props & { settings: PipelineSettings; isAdmin: boolean }) {
  const { tr } = useI18n()
  const [draft, setDraft] = useState(props.settings)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDraft(props.settings) }, [JSON.stringify(props.settings)])
  const num = (key: keyof PipelineSettings, label: string, min: number, max: number, hint?: string) =>
    <label className="fl">{label}<input className="inp" type="number" min={min} max={max} disabled={!props.isAdmin} value={Number(draft[key])}
      onChange={e => setDraft(d => ({ ...d, [key]: Math.max(min, Math.min(max, Number(e.target.value) || min)) }))} />{hint && <span>{hint}</span>}</label>
  const save = async () => {
    setSaving(true)
    try { await props.onSavePipeline(draft); notifyWorkspace(tr("Đã lưu cài đặt pipeline.", "Pipeline settings saved."), "success") }
    catch (error) { notifyWorkspace(error instanceof Error ? error.message : String(error), "error") }
    finally { setSaving(false) }
  }
  const themes: Array<[ThemePreference, string, ReactNode]> = [["light", "Light", <Sun size={14} />], ["dark", "Dark", <Moon size={14} />], ["system", "System", <Monitor size={14} />]]
  return <Page title={tr("Cài đặt", "Settings")}>
    <div className="card"><div className="set"><div className="set-inner">
      <section>
        <h2>Experience</h2><p className="desc">{tr("Giao diện", "Appearance")}</p>
        <div className="seg" role="group">{themes.map(([key, label, icon]) => <button key={key} className={props.themePreference === key ? "on" : ""} aria-pressed={props.themePreference === key} onClick={() => props.onThemeChange(key)}>{icon} {label}</button>)}</div>
      </section>
      <section>
        <h2>Pipeline</h2>
        <p className="desc">{tr("Giá trị tạm cho bản chạy thử (spec mục 8). Đổi khi team chốt.", "Provisional trial values (spec §8). Change when the team decides.")}{!props.isAdmin && ` ${tr("Chỉ Admin được sửa.", "Admins only.")}`}</p>
        <div className="grid2">
          {num("threshold", tr("Ngưỡng AI Approval (%)", "AI approval threshold (%)"), 50, 100, tr("Đang áp dụng", "Active"))}
          {num("maxParallel", tr("Bài chạy song song trong batch", "Articles in parallel per batch"), 1, 5, tr("Đang áp dụng", "Active"))}
          {num("reviewSample", tr("Tỉ lệ review ngẫu nhiên (%)", "Random review rate (%)"), 0, 100, tr("Đang áp dụng", "Active"))}
          {num("perBatch", tr("Số bài mỗi batch (đề xuất)", "Articles per batch (proposed)"), 1, 20, tr("Hiện chọn khi tạo batch", "Chosen when creating a batch"))}
          {num("options", tr("Số option mỗi gate (đề xuất)", "Options per gate (proposed)"), 1, 5, tr("Chưa bật ở G2, G3", "Not active for G2, G3 yet"))}
          {num("revisionRounds", tr("Số vòng sửa (đề xuất)", "Revision rounds (proposed)"), 0, 3, tr("Chưa bật", "Not active yet"))}
          <label className="fl">No-pass Logic<select className="inp" disabled={!props.isAdmin} value={draft.noPass} onChange={e => setDraft(d => ({ ...d, noPass: e.target.value as PipelineSettings["noPass"] }))}>
            <option value="best-flagged">{tr("Lấy option tốt nhất, gắn cờ", "Take best option, flag it")}</option>
            <option value="fail">{tr("Dừng ở Failed, chờ người", "Stop as Failed, wait for a person")}</option>
          </select><span>{tr("Chưa bật", "Not active yet")}</span></label>
        </div>
        {props.isAdmin && <div style={{ marginTop: 12 }}><button className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? tr("Đang lưu…", "Saving…") : tr("Lưu", "Save")}</button></div>}
      </section>
      {props.isAdmin && <section>
        <h2>{tr("Nâng cao", "Advanced")}</h2><p className="desc">Workflow AI, AI Models, Knowledge & Rules, Worker tạo ảnh, Image Styles</p>
        <button className="btn" onClick={props.onOpenAdvancedSettings}><Settings size={14} /> {tr("Mở cài đặt nâng cao", "Open advanced settings")}</button>
      </section>}
    </div></div></div>
  </Page>
}

/* ─── Command menu ─────────────────────────────────────────────────────── */

function CommandMenu(props: Props & { onClose: () => void }) {
  const { tr } = useI18n()
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const q = query.trim().toLowerCase()
  const items: Array<{ group: string; label: string; hint?: string; run: () => void }> = [
    { group: tr("Thao tác", "Actions"), label: tr("Thêm Plan", "Add Plan"), run: () => go("new") },
    ...(["articles", "plans", "batches", "review", "workflow", "dashboard", "settings"] as View[]).map(view => ({ group: tr("Đi tới", "Go to"), label: view[0].toUpperCase() + view.slice(1), run: () => go(view) })),
    { group: tr("Thao tác", "Actions"), label: tr("Đổi theme sáng/tối", "Toggle theme"), run: () => props.onThemeChange(props.themePreference === "dark" ? "light" : "dark") },
    { group: tr("Thao tác", "Actions"), label: tr("Chuyển sang giao diện cũ", "Switch to classic UI"), run: props.onSwitchClassic },
    ...props.articles.map(a => ({ group: tr("Bài viết", "Articles"), label: titleOf(a), hint: STAGE_META[articleStage(a)].label, run: () => go("article", a.id) })),
    ...props.contentPlans.map(p => ({ group: "Plans", label: p.name, run: () => go("plan", p.id) })),
  ].filter(item => !q || item.label.toLowerCase().includes(q)).slice(0, 40)
  useEffect(() => setIndex(0), [query])
  const run = (i: number) => { items[i]?.run(); props.onClose() }
  return <div className="cmd-overlay" onClick={props.onClose}>
    <div className="cmd" role="dialog" aria-label={tr("Tìm kiếm", "Search")} onClick={e => e.stopPropagation()}>
      <input autoFocus placeholder={tr("Tìm bài, plan hoặc thao tác…", "Search articles, plans or actions…")} value={query} onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === "Escape") props.onClose(); if (e.key === "ArrowDown") { e.preventDefault(); setIndex(i => Math.min(items.length - 1, i + 1)) } if (e.key === "ArrowUp") { e.preventDefault(); setIndex(i => Math.max(0, i - 1)) } if (e.key === "Enter") run(index) }} />
      <div className="cmd-list" role="listbox">{items.map((item, i) => <div key={i}>
        {(i === 0 || items[i - 1].group !== item.group) && <div className="cmd-grp">{item.group}</div>}
        <button role="option" aria-selected={i === index} className={`cmd-item${i === index ? " on" : ""}`} onMouseEnter={() => setIndex(i)} onClick={() => run(i)}>{item.label}{item.hint && <span className="hint">{item.hint}</span>}</button>
      </div>)}{!items.length && <div className="cmd-grp">{tr("Không có kết quả", "No results")}</div>}</div>
    </div>
  </div>
}
