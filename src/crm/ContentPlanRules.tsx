import { useState, type ReactNode } from "react"
import type { AppConfig, ContentPlan } from "../types"
import { CONTENT_PLAN_LIMITS, DEFAULT_CONTENT_PLAN_SETTINGS, normalizeContentPlanSettings, type ContentPlanSettings } from "../../shared/contentPlanSettings"
import { previewPlanRules, reapplyPlanRules, type RulesPreview } from "../lib/contentPlans"
import { useI18n } from "../lib/i18n"
import { I, toast, toastErr, trackHandoff } from "./ui"

const TYPE: Record<string, [string, string]> = { "comparison-seo": ["blue", "Comparison"], "editorial-originality": ["pink", "Editorial"], "needs-review": ["orange", "Needs review"] }
const same = (a: ContentPlanSettings, b: ContentPlanSettings) => JSON.stringify(a) === JSON.stringify(b)

/** Word list edited as tags: Enter or comma adds, × removes. */
function Chips({ label, color, values, onChange }: { label: string; color: string; values: string[]; onChange: (values: string[]) => void }) {
  const { tr } = useI18n()
  const [text, setText] = useState("")
  const add = () => {
    const value = text.replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, CONTENT_PLAN_LIMITS.phraseChars)
    if (value && !values.includes(value) && values.length < CONTENT_PLAN_LIMITS.listItems) onChange([...values, value])
    setText("")
  }
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
    {values.map(v => <span key={v} className={`tag t-${color}`} style={{ whiteSpace: "nowrap" }}>{v}<button type="button" aria-label={`${tr("Xoá", "Remove")} ${v}`} onClick={() => onChange(values.filter(x => x !== v))} style={{ border: 0, background: "none", color: "inherit", padding: 0, marginLeft: 4, cursor: "pointer", display: "inline-flex" }}><I n="x" /></button></span>)}
    <input className="inp" style={{ width: 120, height: 24 }} aria-label={`${label}: ${tr("thêm", "add")}`} placeholder={tr("+ thêm", "+ add")} value={text} onChange={e => setText(e.target.value)} onBlur={add} onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add() } }} />
  </div>
}

type Props = { config: AppConfig; saved: AppConfig; plans: ContentPlan[]; onChange: (config: AppConfig) => void; onPlan: (plan: ContentPlan) => void }

/** Settings › Workflow AI › Content Plan classification: the rules admins can change without code. */
export default function ContentPlanRules({ config, saved, plans, onChange, onPlan }: Props) {
  const { tr } = useI18n()
  const s = normalizeContentPlanSettings(config.contentPlan)
  const unsaved = !same(s, normalizeContentPlanSettings(saved.contentPlan))
  const set = (patch: Partial<ContentPlanSettings>) => onChange({ ...config, contentPlan: { ...s, ...patch } })
  const ready = plans.filter(p => p.status !== "processing" && p.items?.length)
  const [planId, setPlanId] = useState("")
  const [preview, setPreview] = useState<{ planId: string; result: RulesPreview } | null>(null)
  const [busy, setBusy] = useState<"" | "preview" | "apply">("")
  const plan = ready.find(p => p.id === (planId || ready[0]?.id))
  const runPreview = async (eventTimeStamp: number) => {
    if (!plan) return
    setBusy("preview")
    try { setPreview({ planId: plan.id, result: await trackHandoff(eventTimeStamp, () => previewPlanRules(plan.id, s, config.railwayUrl)) }) } catch (err) { toastErr(err) } finally { setBusy("") }
  }
  const apply = async (eventTimeStamp: number) => {
    if (!plan) return
    setBusy("apply")
    try { onPlan(await trackHandoff(eventTimeStamp, () => reapplyPlanRules(plan.id, config.railwayUrl))); setPreview(null); toast(tr("Đã áp dụng rule cho plan", "Rules applied to the plan")) } catch (err) { toastErr(err) } finally { setBusy("") }
  }
  const r = preview?.planId === plan?.id ? preview?.result : null
  const counts = (c: RulesPreview["before"]) => `${c.total} topic · C ${c.comparison} · E ${c.editorial}${c.review ? ` · R ${c.review}` : ""}`
  const row = (icon: string, title: string, hint: string, control: ReactNode, wide = true) => <div className="box-row" style={{ flexWrap: "wrap", alignItems: wide ? "flex-start" : "center" }}>
    <I n={icon} /><div className="grow" style={{ minWidth: 220 }}>{title}<div className="s">{hint}</div>{wide && control}</div>{!wide && control}
  </div>
  return <section>
    <h2>{tr("Phân loại Content Plan", "Content Plan classification")}</h2>
    <p className="desc">{tr("Cách tool tách topic và xếp Comparison / Editorial. Thứ tự quyết định nhóm: heading của mục → cụm từ trong tiêu đề → AI. Đổi heading, cụm từ, gộp trùng hoặc Needs review không cần gọi lại AI.", "How topics are picked and sorted into Comparison / Editorial. Group order: section heading → title wording → AI. Heading, wording, duplicate and Needs review changes need no new AI call.")}</p>
    <div className="box">
      {row("heading", tr("Heading → Comparison", "Heading → Comparison"), tr("Heading chứa từ này thì các topic bên dưới là Comparison.", "Topics under a heading with one of these words are Comparison."), <Chips label="Heading Comparison" color="blue" values={s.comparisonHeadings} onChange={v => set({ comparisonHeadings: v })} />)}
      {row("heading", tr("Heading → Editorial", "Heading → Editorial"), tr("Heading chứa từ này thì các topic bên dưới là Editorial.", "Topics under a heading with one of these words are Editorial."), <Chips label="Heading Editorial" color="pink" values={s.editorialHeadings} onChange={v => set({ editorialHeadings: v })} />)}
      {row("text-caption", tr("Tiêu đề → Comparison", "Title → Comparison"), tr("Khớp nguyên từ. ^ ở đầu = tiêu đề bắt đầu bằng cụm đó; # = một số bất kỳ; * = chữ bất kỳ (compar* khớp comparison, comparing).", "Whole words. ^ first = the title starts with it; # = any number; * = any letters (compar* matches comparison, comparing)."), <Chips label={tr("Tiêu đề Comparison", "Title Comparison")} color="blue" values={s.comparisonPhrases} onChange={v => set({ comparisonPhrases: v })} />)}
      {row("text-caption", tr("Tiêu đề → Editorial", "Title → Editorial"), tr("Thắng cụm Comparison, trừ tiêu đề có \"vs\".", "Beats Comparison wording, except titles with \"vs\"."), <Chips label={tr("Tiêu đề Editorial", "Title Editorial")} color="pink" values={s.editorialPhrases} onChange={v => set({ editorialPhrases: v })} />)}
      {row("copy", tr("Gộp topic trùng", "Merge duplicate topics"), tr("Một topic có trong hai danh sách (rút gọn hoặc đổi chữ ít) chỉ tạo một bài.", "A topic listed twice (shortened or slightly reworded) becomes one article."), <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <button role="switch" aria-checked={s.mergeDuplicates} aria-label={tr("Gộp topic trùng", "Merge duplicate topics")} className={`toggle${s.mergeDuplicates ? " on" : ""}`} onClick={() => set({ mergeDuplicates: !s.mergeDuplicates })} />
        <select className="inp" style={{ width: 110 }} aria-label={tr("Độ nhạy gộp trùng", "Duplicate sensitivity")} disabled={!s.mergeDuplicates} value={s.duplicateSensitivity} onChange={e => set({ duplicateSensitivity: e.target.value as ContentPlanSettings["duplicateSensitivity"] })}>
          <option value="strict">{tr("Chặt", "Strict")}</option><option value="normal">{tr("Vừa", "Normal")}</option><option value="loose">{tr("Lỏng", "Loose")}</option>
        </select></span>, false)}
      {row("help-circle", "Needs review", tr("Topic AI không chắc nhóm.", "Topics the AI is unsure about."), <select className="inp" style={{ width: 210 }} aria-label="Needs review" value={s.needsReview} onChange={e => set({ needsReview: e.target.value as ContentPlanSettings["needsReview"] })}>
        <option value="keep">{tr("Giữ Needs review (chạy như Editorial)", "Keep Needs review (runs as Editorial)")}</option><option value="editorial">{tr("Xếp vào Editorial", "Make Editorial")}</option><option value="comparison">{tr("Xếp vào Comparison", "Make Comparison")}</option>
      </select>, false)}
      {row("gauge", tr("Giới hạn AI / plan / ngày", "AI calls / plan / day"), tr("Số lần gọi AI tính phí tối đa cho một plan trong ngày.", "Most paid AI calls for one plan per day."), <input className="inp" type="number" style={{ width: 80 }} aria-label={tr("Giới hạn AI / plan / ngày", "AI calls / plan / day")} min={CONTENT_PLAN_LIMITS.minDaily} max={CONTENT_PLAN_LIMITS.maxDaily} value={s.dailyAiLimit} onChange={e => set({ dailyAiLimit: Number(e.target.value) })} />, false)}
      {row("sparkles", tr("Định nghĩa nhóm cho AI", "Group definitions for the AI"), tr("Chỉ dùng cho topic heading và cụm từ không quyết được. Đổi phần này sẽ gọi lại AI ở lần phân loại sau.", "Used only where headings and wording do not decide. Changing this calls the AI again next time."), <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
        <input className="inp" aria-label={tr("Định nghĩa Comparison", "Comparison definition")} maxLength={CONTENT_PLAN_LIMITS.definitionChars} value={s.comparisonDefinition} onChange={e => set({ comparisonDefinition: e.target.value })} />
        <input className="inp" aria-label={tr("Định nghĩa Editorial", "Editorial definition")} maxLength={CONTENT_PLAN_LIMITS.definitionChars} value={s.editorialDefinition} onChange={e => set({ editorialDefinition: e.target.value })} />
      </div>)}
      {row("notes", tr("Hướng dẫn thêm cho AI", "Extra notes for the AI"), tr("Dòng nào là topic, dòng nào không. Ví dụ: \"Không lấy dòng bắt đầu bằng Note\". Đổi phần này sẽ gọi lại AI.", "Which lines are topics. E.g. \"Skip lines starting with Note\". Changing this calls the AI again."), <textarea className="inp" style={{ marginTop: 6, minHeight: 72, width: "100%" }} aria-label={tr("Hướng dẫn thêm cho AI", "Extra notes for the AI")} maxLength={CONTENT_PLAN_LIMITS.instructionChars} value={s.extraInstructions} onChange={e => set({ extraInstructions: e.target.value })} />)}
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
      <select className="inp" style={{ width: 240 }} aria-label={tr("Plan để thử", "Plan to try")} value={plan?.id ?? ""} onChange={e => setPlanId(e.target.value)} disabled={!ready.length}>
        {ready.length ? ready.map(p => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">{tr("Chưa có plan đã phân loại", "No classified plan yet")}</option>}
      </select>
      <button className="btn" disabled={!plan || Boolean(busy)} onClick={e => void runPreview(e.timeStamp)}><I n="eye" />{busy === "preview" ? tr("Đang thử…", "Trying…") : tr("Thử trên plan", "Try on plan")}</button>
      <button className="btn ghost" disabled={same(s, DEFAULT_CONTENT_PLAN_SETTINGS)} onClick={() => onChange({ ...config, contentPlan: { ...DEFAULT_CONTENT_PLAN_SETTINGS } })}><I n="restore" />{tr("Về mặc định", "Reset to defaults")}</button>
    </div>
    {r && plan && <div className="box" style={{ marginTop: 12 }} aria-label={tr("Kết quả thử", "Preview")}>
      <div className="box-row" style={{ flexWrap: "wrap" }}><I n="arrows-diff" /><div className="grow" style={{ minWidth: 220 }}>{counts(r.before)} → <b>{counts(r.after)}</b>
        <div className="s">{r.changed.length || r.added.length || r.removed.length ? tr(`${r.changed.length} đổi nhóm · ${r.added.length} thêm · ${r.removed.length} bị gộp/bỏ. Không gọi AI; nhóm đã sửa tay sẽ bị ghi đè.`, `${r.changed.length} regrouped · ${r.added.length} added · ${r.removed.length} merged/removed. No AI call; manual group edits are overwritten.`) : tr("Không có thay đổi.", "No changes.")}</div></div>
        <button className="btn primary" disabled={unsaved || Boolean(busy) || !(r.changed.length || r.added.length || r.removed.length)} title={unsaved ? tr("Lưu thay đổi trước khi áp dụng", "Save changes before applying") : undefined} onClick={e => void apply(e.timeStamp)}><I n="check" />{busy === "apply" ? tr("Đang áp dụng…", "Applying…") : tr("Áp dụng cho plan này", "Apply to this plan")}</button>
      </div>
      {unsaved && <div className="box-row" style={{ color: "var(--f3)" }}><I n="info-circle" /><div className="grow">{tr("Đây là bản thử với thiết lập chưa lưu. Bấm Lưu thay đổi rồi mới áp dụng được.", "This preview uses unsaved settings. Save changes to apply them.")}</div></div>}
      {r.changed.slice(0, 30).map(c => <div key={c.id} className="box-row"><span className={`tag t-${TYPE[c.from]?.[0] ?? "gray"}`}>{TYPE[c.from]?.[1] ?? c.from}</span><I n="arrow-right" /><span className={`tag t-${TYPE[c.to]?.[0] ?? "gray"}`}>{TYPE[c.to]?.[1] ?? c.to}</span><div className="grow">{c.title}</div></div>)}
      {r.added.slice(0, 15).map(t => <div key={`a-${t}`} className="box-row"><span className="tag t-green">{tr("Thêm", "Added")}</span><div className="grow">{t}</div></div>)}
      {r.removed.slice(0, 15).map(t => <div key={`r-${t}`} className="box-row"><span className="tag t-gray">{tr("Gộp/bỏ", "Merged")}</span><div className="grow">{t}</div></div>)}
    </div>}
  </section>
}
