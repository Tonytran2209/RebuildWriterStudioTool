import { useEffect, useRef, useState } from "react"
import type { AppConfig, Article, DocumentFile, PipelineSettings } from "../types"
import type { RerunGate } from "../lib/pipeline"
import { useI18n } from "../lib/i18n"
import { isArticleCompleted } from "../lib/workflowGuards"
import { isLegacyArticle } from "../lib/legacyCompatibility"
import StructureSelect from "./StructureSelect"
import StepLog from "./StepLog"
import { selectIdeaPatch } from "./model"
import { gateReviewState } from "../lib/gateReview"
import { seoMetadataOf } from "../lib/specMaps"
import { writerBriefMarkdown } from "../lib/writerBrief"
import { I, markUnsaved, toast, toastErr, trackHandoff } from "./ui"

type Props = {
  article: Article
  settings: PipelineSettings
  files: DocumentFile[]
  config: AppConfig
  onUpdateArticle: (id: string, updates: Partial<Article>) => Promise<boolean>
  onRerun: (article: Article, gate: RerunGate) => Promise<void>
  onToggleComplete: (article: Article) => void
  onMigrateLegacy: (article: Article) => void
}

/** G1 research shown under the Gate: overlap warning, competitor analysis and the Spec's information-gain fields. */
function ResearchBox({ article }: { article: Article }) {
  const { tr } = useI18n()
  const spec = article.articleSpec
  const matches = article.cannibalisation?.matches ?? []
  const analysis = article.competitorAnalysis
  const gain: Array<[string, string[] | undefined]> = [
    [tr("Câu hỏi người đọc", "Reader questions"), spec?.questions],
    [tr("Khoảng trống của đối thủ", "Competitor gaps"), spec?.contentGaps],
    [tr("Điểm khác biệt của thương hiệu", "Brand information gain"), spec?.informationGain],
    [tr("Câu đáng được trích dẫn", "Citation targets"), spec?.citationTargets],
    ["Entities", spec?.entityMap?.length ? spec.entityMap.map(e => `${e.name}${e.attributes.length ? ` (${e.attributes.join("; ")})` : ""}${e.related.length ? ` → ${e.related.join(", ")}` : ""}`) : spec?.entities],
    [tr("Tài sản thương hiệu nên xuất hiện", "Brand assets to show"), spec?.brandAssets?.map(b => b.use ? `${b.asset}: ${b.use}` : b.asset)],
    [tr("Nguồn & thực thể của câu trích dẫn", "Citation sources"), spec?.citations?.map(c => `“${c.statement}”${c.source ? ` · ${c.source}` : ""}${c.entity ? ` · ${c.entity}` : ""}`)],
  ]
  const shown = gain.filter(([, items]) => items?.length)
  if (!matches.length && !analysis && !shown.length && !spec?.pageType) return null
  return <div className="box" style={{ margin: "8px 0" }}>
    {matches.length > 0 && <div className="box-row" style={{ alignItems: "flex-start" }}>
      <I n="alert-triangle" /><div className="grow">{tr("Có thể trùng keyword với nội dung đã có", "May overlap existing content")}
        {matches.map(m => <div key={`${m.kind}-${m.id}`} className="s">{m.kind === "page" ? "Website" : tr("Bài", "Article")}: {m.url ? <a href={m.url} target="_blank" rel="noreferrer">{m.title}</a> : m.title} · “{m.keyword}” · {Math.round(m.score * 100)}%</div>)}
      </div><span className="tag t-orange">{tr("Cảnh báo", "Warning")}</span>
    </div>}
    {analysis && <div className="box-row" style={{ alignItems: "flex-start" }}>
      <I n="users" /><div className="grow">{tr("Phân tích đối thủ", "Competitor analysis")}
        <div className="s">{analysis.status === "error" ? analysis.error : `${analysis.pages.filter(p => p.status === "analyzed").length}/${analysis.pages.length} ${tr("trang đã phân tích", "pages analysed")}`}</div>
        {analysis.status === "done" && <details style={{ marginTop: 4 }}><summary className="s" style={{ cursor: "pointer" }}>{tr("Xem chi tiết", "Details")}</summary>
          {analysis.summary?.commonSections.length ? <div className="s" style={{ marginTop: 4 }}><b>{tr("Đối thủ đều có", "Most pages cover")}:</b> {analysis.summary.commonSections.join(" · ")}</div> : null}
          {analysis.summary?.contentGaps.length ? <div className="s"><b>{tr("Khoảng trống", "Gaps")}:</b> {analysis.summary.contentGaps.join(" · ")}</div> : null}
          {analysis.pages.map(p => <div key={p.url} className="s" style={{ marginTop: 4 }}><a href={p.url} target="_blank" rel="noreferrer">{p.title || p.url}</a>{p.status === "analyzed" ? ` · ${p.pageType ?? ""}${p.wordCount ? ` · ${p.wordCount} ${tr("từ", "words")}` : ""}` : ` · ${tr("không đọc được", "not readable")}${p.error ? `: ${p.error}` : ""}`}</div>)}
        </details>}
      </div><span className={`tag t-${analysis.status === "done" ? "green" : "red"}`}>{analysis.status === "done" ? tr("Xong", "Done") : tr("Lỗi", "Failed")}</span>
    </div>}
    {(spec?.pageType || shown.length > 0) && <div className="box-row" style={{ alignItems: "flex-start" }}>
      <I n="bulb" /><div className="grow">{tr("Information gain trong Article Spec", "Information gain in the Article Spec")}{spec?.pageType && <span className="s"> · {tr("Page type", "Page type")}: {spec.pageType}</span>}
        {spec?.pageTypeReason && <div className="s"><b>{tr("Lý do chọn page type", "Why this page type")}:</b> {spec.pageTypeReason}</div>}
        {shown.map(([label, items]) => <div key={label} className="s"><b>{label}:</b> {items!.join(" · ")}</div>)}
      </div>
    </div>}
  </div>
}

/** SEO metadata (title from the draft H1, G1 meta description, slug, schema) and the Writer Brief download. */
function SeoBriefBox({ article }: { article: Article }) {
  const { tr } = useI18n()
  const meta = seoMetadataOf(article)
  if (!meta) return null
  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => toast(tr("Đã copy", "Copied")), () => toastErr(new Error(tr("Không copy được", "Copy failed"))))
  const download = () => {
    const url = URL.createObjectURL(new Blob([writerBriefMarkdown(article)], { type: "text/markdown;charset=utf-8" }))
    const link = document.createElement("a"); link.href = url; link.download = `writer-brief-${meta.slug || "article"}.md`; link.click(); URL.revokeObjectURL(url)
  }
  const row = (icon: string, label: string, value: string, note?: string, warn?: boolean) => <div className="frow"><div className="flabel"><I n={icon} />{label}</div><div className="fval" style={{ whiteSpace: "normal" }}>{value || <span className="empty" style={{ color: "var(--f4)" }}>—</span>}{note && <span className={warn ? "tag t-orange" : "muted"} style={warn ? { marginLeft: 6 } : { color: "var(--f3)" }}>{warn ? note : ` · ${note}`}</span>}{value && <button className="icon-btn" aria-label={`Copy ${label}`} onClick={() => copy(value)}><I n="copy" /></button>}</div></div>
  return <>
    <div className="fsec"><I n="tags" />&nbsp;SEO Metadata<span className="grow" /><button className="btn" onClick={download}><I n="download" />{tr("Tải Writer Brief", "Download Writer Brief")}</button></div>
    <div className="fields" style={{ paddingTop: 0 }}>
      {row("heading", "Title", meta.title, `${meta.titleLength}/60`, meta.titleLength > 60)}
      {row("align-left", "Meta description", meta.metaDescription, meta.metaDescription ? `${meta.metaLength}/160` : tr("Spec cũ, chạy lại G1 để có", "older Spec; rerun G1"), meta.metaLength > 160)}
      {row("link", "Slug", `/${meta.slug}`)}
      {row("code", "Schema", meta.schemaTypes.join(", "), article.articleSpec?.schemaTypes?.length ? undefined : tr("gợi ý theo page type", "from the page type"))}
    </div>
  </>
}

/** G1/G2 AI self-review result (Settings › Workflow rules): shown under the Gate, never blocks it. */
function GateReviewBox({ article, step }: { article: Article; step: 2 | 3 }) {
  const { tr } = useI18n()
  const state = gateReviewState(article, step)
  if (!state) return null
  const { review, stale } = state
  const color = review.status === "pass" ? "green" : review.status === "warning" ? "orange" : "red"
  const label = review.status === "error" ? tr("Tự duyệt lỗi", "Self-review failed") : review.status === "pass" ? tr("Đạt Standards", "Meets Standards") : review.status === "warning" ? tr("Có cảnh báo", "Warnings") : tr("Còn lỗi", "Issues left")
  const issues = review.checks.filter(check => check.status !== "pass")
  return <div className="box" style={{ margin: "8px 0" }}>
    <div className="box-row" style={{ flexWrap: "wrap" }}>
      <I n="list-check" /><span className="grow">{tr("AI tự duyệt theo Standards", "AI self-review against Standards")}<span className="s"> · {review.standards.join(", ")}{review.rounds ? ` · ${tr(`đã sửa ${review.rounds} lượt`, `${review.rounds} fix round(s)`)}` : ""}</span></span>
      {stale && <span className="tag t-gray" title={tr("Nội dung đã đổi sau lần duyệt này.", "The output changed after this review.")}>{tr("Đã cũ", "Stale")}</span>}
      <span className={`tag t-${color}`}>{label}</span>
    </div>
    {review.error && <div className="box-row"><span className="s" style={{ color: "var(--danger)" }}>{review.error}</span></div>}
    {issues.map((check, i) => <div key={i} className="box-row" style={{ alignItems: "flex-start" }}>
      <span className={`tag t-${check.status === "fail" ? "red" : "orange"}`}>{check.status === "fail" ? "FAIL" : "WARN"}</span>
      <div className="grow">{check.item}<div className="s">{check.reason}{check.location ? ` · ${check.location}` : ""}</div></div>
    </div>)}
  </div>
}

/** Demo "Chế độ thủ công" (pipeline-crm.html manualTab) on the real article: edits save, regenerations run through the pipeline. */
export default function ManualTab({ article: a, settings, files, config, onUpdateArticle, onRerun, onToggleComplete, onMigrateLegacy }: Props) {
  const { tr } = useI18n()
  const [draft, setDraft] = useState(a.draft ?? "")
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<RerunGate | null>(null)
  // Take a newer server draft only while there are no local edits (polling must not wipe typing).
  const serverDraft = useRef(a.draft ?? "")
  useEffect(() => {
    setDraft(current => current === serverDraft.current ? a.draft ?? "" : current)
    serverDraft.current = a.draft ?? ""
  }, [a.id, a.draft])
  const dirty = draft !== (a.draft ?? "")
  useEffect(() => { markUnsaved(`draft:${a.id}`, dirty); return () => markUnsaved(`draft:${a.id}`, false) }, [a.id, dirty])

  if (isLegacyArticle(a)) return <div className="empty-state"><I n="archive" /><h3>{tr("Bài theo quy trình cũ", "Legacy article")}</h3><span>{a.legacyReason || tr("Bài này được tạo trước khi có pipeline 3 gate và chỉ đọc được.", "This article predates the 3-gate pipeline and is read-only.")}</span><button className="btn primary" onClick={() => onMigrateLegacy(a)}><I n="copy" />{tr("Tạo bản theo quy trình mới", "Copy into the new workflow")}</button></div>

  const completed = isArticleCompleted(a)
  const running = a.batchStatus === "running" || a.batchStatus === "queued"
  const locked = completed || running
  const ideas = a.coreIdeaSuggestions ?? []
  const outline = a.outline ?? []
  const rerun = async (gate: RerunGate, eventTimeStamp: number, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(gate)
    try { await trackHandoff(eventTimeStamp, () => onRerun(a, gate)); toast(tr(`Đã gửi pipeline chạy lại từ ${gate === 4 ? "AI Review" : "G" + gate}`, `Pipeline re-running from ${gate === 4 ? "AI Review" : "G" + gate}`)) }
    catch (err) { toastErr(err) }
    finally { setBusy(null) }
  }
  // Editorial is supervised: a person approves the outline, then G3 runs through the pipeline.
  const approveOutline = async (eventTimeStamp: number) => {
    setBusy(3)
    try {
      await trackHandoff(eventTimeStamp, async () => {
        const ok = await onUpdateArticle(a.id, { editorialApproval: { status: "approved", approvedAt: new Date().toISOString(), outlineFingerprint: JSON.stringify(outline.map(section => section.heading)) } })
        if (!ok) throw new Error(tr("Không lưu được phê duyệt.", "Could not save the approval."))
        await onRerun(a, 3)
      })
      toast(tr("Đã duyệt outline. Pipeline đang viết draft.", "Outline approved. The pipeline is writing the draft."))
    } catch (err) { toastErr(err) } finally { setBusy(null) }
  }
  const pick = async (id: string) => {
    if (locked || id === a.selectedCoreIdeaId) return
    if ((outline.length || a.draft?.trim()) && !window.confirm(tr("Đổi ý tưởng sẽ xoá outline và draft hiện tại. Tiếp tục?", "Changing the idea clears the current outline and draft. Continue?"))) return
    if (await onUpdateArticle(a.id, selectIdeaPatch(a, id))) toast(tr("Đã chọn ý tưởng. Bấm Tạo lại G2 để viết outline mới.", "Idea selected. Use Regenerate G2 to write a new outline."))
  }
  const saveDraft = async (eventTimeStamp: number) => {
    if (locked || draft === (a.draft ?? "")) return
    // Edited text needs a fresh AI review before it can be approved again.
    if (await trackHandoff(eventTimeStamp, () => onUpdateArticle(a.id, { draft, qualityReport: null, semanticReviewChecks: null, semanticReviewFingerprint: null }))) toast(tr("Đã lưu draft. Bấm Chấm lại AI để có điểm mới.", "Draft saved. Use Re-check AI for a new score."))
  }
  const btn = (gate: RerunGate, label: string, confirmText?: string, disabled = false) =>
    <button className="btn" style={{ marginLeft: gate === 4 || gate === 1 || gate === 2 ? "auto" : 6 }} disabled={locked || busy !== null || disabled} onClick={e => void rerun(gate, e.timeStamp, confirmText)}><I n={busy === gate ? "loader-2" : "refresh"} />{label}</button>

  return <>
    <div style={{ background: "var(--accent-bg)", color: "var(--accent)", borderRadius: 6, padding: "8px 12px", marginBottom: 16 }}>
      <I n="info-circle" /> {running ? tr("Pipeline đang chạy bài này. Các thao tác mở lại khi lượt chạy xong.", "The pipeline is running this article. Actions unlock when the run ends.")
        : completed ? tr("Bài đã được đánh dấu hoàn thành. Mở lại để chỉnh sửa hoặc chạy lại.", "This article is marked complete. Reopen it to edit or re-run.")
        : tr("Sửa ý tưởng, outline hoặc draft rồi lưu; các nút Tạo lại gửi bài cho pipeline chạy lại từ gate đó.", "Edit the idea, outline or draft; Regenerate sends the article back to the pipeline from that gate.")}
      {completed && <button className="btn" style={{ marginLeft: 8 }} onClick={() => onToggleComplete(a)}><I n="lock-open" />{tr("Mở lại bài", "Reopen")}</button>}
    </div>

    <div className="fsec"><I n="bulb" />&nbsp;{tr("Bước 1 — Article Spec & Hướng nội dung", "Step 1 — Article Spec & direction")}{btn(1, tr("Tạo lại G1", "Regenerate G1"), tr("Tạo lại G1 sẽ xoá ý tưởng, outline và draft hiện tại. Tiếp tục?", "Regenerating G1 clears the ideas, outline and draft. Continue?"))}</div>
    {a.articleSpec && <div className="frow" style={{ marginBottom: 6 }}><div className="flabel"><I n="key" />Keyword</div><div className="fval">{a.articleSpec.primaryQuery}<span className="muted" style={{ color: "var(--f3)" }}>&nbsp;· {a.articleSpec.primaryIntent}</span></div></div>}
    {ideas.length ? ideas.map((o, i) => <div key={o.id} className="list-row plog-in" role="radio" aria-checked={a.selectedCoreIdeaId === o.id} tabIndex={0} onClick={() => void pick(o.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void pick(o.id) } }} style={{ animationDelay: `${i * 90}ms`, background: a.selectedCoreIdeaId === o.id ? "var(--accent-bg)" : undefined, cursor: locked ? "default" : "pointer" }}>
      <input type="radio" tabIndex={-1} readOnly checked={a.selectedCoreIdeaId === o.id} aria-hidden="true" /><span className="grow">{o.title}{o.angleLabel && <span className="muted" style={{ color: "var(--f3)" }}> · {o.angleLabel}</span>}</span>
      <span className={`tag t-${(o.rating?.overall ?? 0) * 10 >= settings.threshold ? "green" : "gray"}`}>{(o.rating?.overall ?? 0).toFixed(1)}</span>
    </div>) : <p className="muted" style={{ color: "var(--f3)" }}>{running ? <><I n="loader-2" /> {tr("AI đang tạo ý tưởng…", "AI is generating ideas…")}</> : tr("Chưa có ý tưởng. Bấm Tạo lại G1.", "No ideas yet. Use Regenerate G1.")}</p>}
    <StepLog article={a} step={2} />
    <ResearchBox article={a} />
    <GateReviewBox article={a} step={2} />

    <div className="fsec"><I n="list-tree" />&nbsp;{tr("Bước 2 — Dàn bài nháp", "Step 2 — Draft outline")}{a.outlineStructure && <span className="tag t-gray" style={{ marginLeft: 8 }}>{a.outlineStructure.name}</span>}{btn(2, tr("Tạo lại G2", "Regenerate G2"), outline.length ? tr("Tạo lại G2 sẽ xoá outline và draft hiện tại. Tiếp tục?", "Regenerating G2 clears the outline and draft. Continue?") : undefined, !a.selectedCoreIdeaId || !a.outlineStructure)}</div>
    {a.batchStatus === "awaiting_approval" && <div className="plog-in" role="status" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "var(--c-orange-bg)", color: "var(--c-orange)", borderRadius: 6, padding: "8px 12px", marginBottom: 8 }}>
      <I n="user-check" /><span className="grow">{tr("Bài Editorial: kiểm tra outline bên dưới. Duyệt để pipeline viết draft, hoặc Tạo lại G2.", "Editorial article: check the outline below. Approve it to let the pipeline write the draft, or Regenerate G2.")}</span>
      <button className="btn primary" disabled={busy !== null || !outline.length} onClick={e => void approveOutline(e.timeStamp)}><I n={busy === 3 ? "loader-2" : "check"} />{tr("Duyệt outline & viết draft", "Approve outline & write draft")}</button>
    </div>}
    {(!a.outlineStructure || !outline.length) && !locked && <div style={{ marginBottom: 8 }}><StructureSelect files={files} allowedIds={config.stepConfigs[3]?.fileAccess?.rules ?? []} value={a.outlineStructure ?? null} onChange={value => void onUpdateArticle(a.id, { outlineStructure: value })} /></div>}
    {outline.length ? outline.map((s, i) => <div key={s.id} className="plog-in" style={{ animationDelay: `${Math.min(i, 12) * 60}ms` }}>
      <div className="list-row" style={{ paddingLeft: s.level === "h3" ? 36 : 12 }} onClick={() => setOpen(open === s.id ? null : s.id)} role="button" tabIndex={0} aria-expanded={open === s.id} onKeyDown={e => { if (e.key === "Enter") setOpen(open === s.id ? null : s.id) }}>
        <span className="tag t-gray">{s.level.toUpperCase()}</span><span className="grow">{s.heading}</span><I n={open === s.id ? "chevron-up" : "chevron-down"} />
      </div>
      {open === s.id && <div style={{ border: "1px solid var(--b2)", borderTop: 0, padding: "8px 12px 10px", paddingLeft: s.level === "h3" ? 60 : 36, color: "var(--f2)", lineHeight: 1.5 }}>{s.notes || <span className="empty" style={{ color: "var(--f4)" }}>Empty</span>}{s.keywords?.length ? <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>{s.keywords.map(k => <span key={k} className="tag t-blue">{k}</span>)}</div> : null}</div>}
    </div>) : <p className="muted" style={{ color: "var(--f3)" }}>{running && a.selectedCoreIdeaId ? <><I n="loader-2" /> {tr("AI đang lập outline…", "AI is writing the outline…")}</> : tr("Chưa có outline.", "No outline yet.")}</p>}
    <StepLog article={a} step={3} />
    <GateReviewBox article={a} step={3} />

    <div className="fsec"><I n="file-text" />&nbsp;{tr("Bước 3 — Bản nháp & Kiểm tra", "Step 3 — Draft & QC")}{btn(4, tr("Chấm lại AI", "Re-check AI"), undefined, !a.draft?.trim() || !outline.length)}{btn(3, tr("Tạo lại Draft", "Regenerate draft"), a.draft?.trim() ? tr("Tạo lại Draft sẽ thay bản nháp hiện tại. Tiếp tục?", "Regenerating replaces the current draft. Continue?") : undefined, !outline.length)}</div>
    {running && !a.draft?.trim() && outline.length > 0 && <p className="muted" style={{ color: "var(--accent)", margin: "0 0 6px" }}><I n="loader-2" /> {tr("AI đang viết draft…", "AI is writing the draft…")}</p>}
    <textarea key={a.draft?.trim() ? "draft" : "empty"} className="inp plog-in" aria-label={tr("Bản nháp", "Draft")} style={{ height: 320, padding: 10, lineHeight: 1.6, fontFamily: "inherit" }} disabled={locked} value={draft} onChange={e => setDraft(e.target.value)} placeholder={tr("Bắt đầu viết thủ công…", "Start writing manually…")} />
    {draft !== (a.draft ?? "") && !locked && <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}><button className="btn" onClick={() => setDraft(a.draft ?? "")}>{tr("Huỷ", "Discard")}</button><button className="btn primary" onClick={e => void saveDraft(e.timeStamp)}><I n="device-floppy" />{tr("Lưu draft", "Save draft")}</button></div>}
    <StepLog article={a} step={4} />
    <SeoBriefBox article={a} />
  </>
}
