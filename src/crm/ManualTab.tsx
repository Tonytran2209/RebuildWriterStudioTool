import { useEffect, useState } from "react"
import type { AppConfig, Article, DocumentFile, PipelineSettings } from "../types"
import type { RerunGate } from "../lib/pipeline"
import { useI18n } from "../lib/i18n"
import { isArticleCompleted } from "../lib/workflowGuards"
import { isLegacyArticle } from "../lib/legacyCompatibility"
import StructureSelect from "./StructureSelect"
import StepLog from "./StepLog"
import { selectIdeaPatch } from "./model"
import { I, errText, toast, trackHandoff } from "./ui"

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

/** Demo "Chế độ thủ công" (pipeline-crm.html manualTab) on the real article: edits save, regenerations run through the pipeline. */
export default function ManualTab({ article: a, settings, files, config, onUpdateArticle, onRerun, onToggleComplete, onMigrateLegacy }: Props) {
  const { tr } = useI18n()
  const [draft, setDraft] = useState(a.draft ?? "")
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<RerunGate | null>(null)
  useEffect(() => setDraft(a.draft ?? ""), [a.id, a.draft])

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
    catch (err) { toast(errText(err)) }
    finally { setBusy(null) }
  }
  const pick = async (id: string) => {
    if (locked || id === a.selectedCoreIdeaId) return
    if ((outline.length || a.draft?.trim()) && !window.confirm(tr("Đổi ý tưởng sẽ xoá outline và draft hiện tại. Tiếp tục?", "Changing the idea clears the current outline and draft. Continue?"))) return
    if (await onUpdateArticle(a.id, selectIdeaPatch(a, id))) toast(tr("Đã chọn ý tưởng. Bấm Tạo lại G2 để viết outline mới.", "Idea selected. Use Regenerate G2 to write a new outline."))
  }
  const saveDraft = async () => {
    if (locked || draft === (a.draft ?? "")) return
    // Edited text needs a fresh AI review before it can be approved again.
    if (await onUpdateArticle(a.id, { draft, qualityReport: null, semanticReviewChecks: null, semanticReviewFingerprint: null })) toast(tr("Đã lưu draft. Bấm Chấm lại AI để có điểm mới.", "Draft saved. Use Re-check AI for a new score."))
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
    {ideas.length ? ideas.map(o => <div key={o.id} className="list-row" role="radio" aria-checked={a.selectedCoreIdeaId === o.id} tabIndex={0} onClick={() => void pick(o.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void pick(o.id) } }} style={{ background: a.selectedCoreIdeaId === o.id ? "var(--accent-bg)" : undefined, cursor: locked ? "default" : "pointer" }}>
      <input type="radio" tabIndex={-1} readOnly checked={a.selectedCoreIdeaId === o.id} aria-hidden="true" /><span className="grow">{o.title}{o.angleLabel && <span className="muted" style={{ color: "var(--f3)" }}> · {o.angleLabel}</span>}</span>
      <span className={`tag t-${(o.rating?.overall ?? 0) * 10 >= settings.threshold ? "green" : "gray"}`}>{(o.rating?.overall ?? 0).toFixed(1)}</span>
    </div>) : <p className="muted" style={{ color: "var(--f3)" }}>{running ? tr("Đang tạo ý tưởng…", "Generating ideas…") : tr("Chưa có ý tưởng. Bấm Tạo lại G1.", "No ideas yet. Use Regenerate G1.")}</p>}
    <StepLog article={a} step={2} />

    <div className="fsec"><I n="list-tree" />&nbsp;{tr("Bước 2 — Dàn bài nháp", "Step 2 — Draft outline")}{a.outlineStructure && <span className="tag t-gray" style={{ marginLeft: 8 }}>{a.outlineStructure.name}</span>}{btn(2, tr("Tạo lại G2", "Regenerate G2"), outline.length ? tr("Tạo lại G2 sẽ xoá outline và draft hiện tại. Tiếp tục?", "Regenerating G2 clears the outline and draft. Continue?") : undefined, !a.selectedCoreIdeaId || !a.outlineStructure)}</div>
    {(!a.outlineStructure || !outline.length) && !locked && <div style={{ marginBottom: 8 }}><StructureSelect files={files} allowedIds={config.stepConfigs[3]?.fileAccess?.rules ?? []} value={a.outlineStructure ?? null} onChange={value => void onUpdateArticle(a.id, { outlineStructure: value })} /></div>}
    {outline.length ? outline.map(s => <div key={s.id}>
      <div className="list-row" style={{ paddingLeft: s.level === "h3" ? 36 : 12 }} onClick={() => setOpen(open === s.id ? null : s.id)} role="button" tabIndex={0} aria-expanded={open === s.id} onKeyDown={e => { if (e.key === "Enter") setOpen(open === s.id ? null : s.id) }}>
        <span className="tag t-gray">{s.level.toUpperCase()}</span><span className="grow">{s.heading}</span><I n={open === s.id ? "chevron-up" : "chevron-down"} />
      </div>
      {open === s.id && <div style={{ border: "1px solid var(--b2)", borderTop: 0, padding: "8px 12px 10px", paddingLeft: s.level === "h3" ? 60 : 36, color: "var(--f2)", lineHeight: 1.5 }}>{s.notes || <span className="empty" style={{ color: "var(--f4)" }}>Empty</span>}{s.keywords?.length ? <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>{s.keywords.map(k => <span key={k} className="tag t-blue">{k}</span>)}</div> : null}</div>}
    </div>) : <p className="muted" style={{ color: "var(--f3)" }}>{tr("Chưa có outline.", "No outline yet.")}</p>}
    <StepLog article={a} step={3} />

    <div className="fsec"><I n="file-text" />&nbsp;{tr("Bước 3 — Bản nháp & Kiểm tra", "Step 3 — Draft & QC")}{btn(4, tr("Chấm lại AI", "Re-check AI"), undefined, !a.draft?.trim() || !outline.length)}{btn(3, tr("Tạo lại Draft", "Regenerate draft"), a.draft?.trim() ? tr("Tạo lại Draft sẽ thay bản nháp hiện tại. Tiếp tục?", "Regenerating replaces the current draft. Continue?") : undefined, !outline.length)}</div>
    <textarea className="inp" aria-label={tr("Bản nháp", "Draft")} style={{ height: 320, padding: 10, lineHeight: 1.6, fontFamily: "inherit" }} disabled={locked} value={draft} onChange={e => setDraft(e.target.value)} placeholder={tr("Bắt đầu viết thủ công…", "Start writing manually…")} />
    {draft !== (a.draft ?? "") && !locked && <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}><button className="btn" onClick={() => setDraft(a.draft ?? "")}>{tr("Huỷ", "Discard")}</button><button className="btn primary" onClick={() => void saveDraft()}><I n="device-floppy" />{tr("Lưu draft", "Save draft")}</button></div>}
    <StepLog article={a} step={4} />
  </>
}
