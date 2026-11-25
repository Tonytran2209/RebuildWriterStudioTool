import { useEffect, useState, type ReactNode } from "react"
import type { AppConfig, ContentPlan } from "../types"
import { CLASSIFIER_ANSWER_FORMAT, CONTENT_PLAN_LIMITS, DEFAULT_CONTENT_PLAN_SETTINGS as D, normalizeContentPlanSettings, type ContentPlanSettings } from "../../shared/contentPlanSettings"
import { previewPlanRules, reapplyPlanRules, type RulesPreview } from "../lib/contentPlans"
import { useI18n } from "../lib/i18n"
import { I, toast, toastErr, trackHandoff } from "./ui"

const TYPE: Record<string, [string, string]> = { "comparison-seo": ["blue", "Comparison"], "editorial-originality": ["pink", "Editorial"], "needs-review": ["orange", "Needs review"] }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 1.55 }

/** Comma-separated words, saved when the field loses focus so typing a comma does not jump. */
function Words({ label, color, values, onChange }: { label: string; color: string; values: string[]; onChange: (values: string[]) => void }) {
  const [text, setText] = useState(values.join(", "))
  useEffect(() => setText(values.join(", ")), [values.join("\n")])
  return <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 6 }}>
    <span className={`tag t-${color}`} style={{ flexShrink: 0, minWidth: 86, justifyContent: "center", marginTop: 6 }}>{label}</span>
    <textarea className="inp" rows={Math.min(4, Math.max(1, Math.ceil(text.length / 60)))} style={{ flex: 1, minWidth: 0, minHeight: 0, height: "auto", lineHeight: 1.5, padding: "5px 8px", resize: "vertical" }} aria-label={label} value={text} onChange={e => setText(e.target.value)} onBlur={() => onChange(text.split(","))} />
  </label>
}

type Props = { config: AppConfig; saved: AppConfig; plans: ContentPlan[]; onChange: (config: AppConfig) => void; onPlan: (plan: ContentPlan) => void }
type Toggle = "useHeadings" | "useTitleWords" | "mergeDuplicates" | "keepNeedsReview"

/** Settings › Workflow AI › Content Plan classification: the prompt the AI gets, then on/off rules applied to its answer. */
export default function ContentPlanRules({ config, saved, plans, onChange, onPlan }: Props) {
  const { tr } = useI18n()
  const s = normalizeContentPlanSettings(config.contentPlan)
  const savedSettings = normalizeContentPlanSettings(saved.contentPlan)
  const unsaved = !same(s, savedSettings)
  const promptChanged = s.rulesPrompt !== savedSettings.rulesPrompt || s.systemPrompt !== savedSettings.systemPrompt
  const promptEdited = s.rulesPrompt !== D.rulesPrompt || s.systemPrompt !== D.systemPrompt
  // Prompts stay as typed; an emptied box falls back to the original prompt only when read.
  const set = (patch: Partial<ContentPlanSettings>) => onChange({ ...config, contentPlan: { ...s, ...(config.contentPlan ?? {}), ...patch } })
  const raw = (key: "systemPrompt" | "rulesPrompt") => String(config.contentPlan?.[key] ?? s[key])
  const ready = plans.filter(p => p.status !== "processing" && p.items?.length)
  const [planId, setPlanId] = useState("")
  const [words, setWords] = useState<Toggle | "">("")
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
    try { onPlan(await trackHandoff(eventTimeStamp, () => reapplyPlanRules(plan.id, config.railwayUrl))); setPreview(null); toast(tr("Đã áp dụng quy tắc cho plan", "Rules applied to the plan")) } catch (err) { toastErr(err) } finally { setBusy("") }
  }
  const r = preview?.planId === plan?.id ? preview?.result : null
  const counts = (c: RulesPreview["before"]) => `${c.total} · C ${c.comparison} · E ${c.editorial}${c.review ? ` · R ${c.review}` : ""}`
  const lists: Partial<Record<Toggle, ["comparisonHeadings" | "comparisonPhrases", "editorialHeadings" | "editorialPhrases"]>> = { useHeadings: ["comparisonHeadings", "editorialHeadings"], useTitleWords: ["comparisonPhrases", "editorialPhrases"] }
  const rule = (key: Toggle, title: string, tip: string, extra?: ReactNode) => {
    const list = lists[key], open = words === key && s[key]
    return <div className="box-row" style={{ flexWrap: "wrap" }}>
      <span className="grow" title={tip} style={{ minWidth: 120 }}>{title}</span>
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        {list && s[key] && <button className="btn ghost" aria-expanded={open} aria-label={`${tr("Sửa từ", "Edit words")}: ${title}`} onClick={() => setWords(open ? "" : key)}><I n={open ? "chevron-up" : "pencil"} />{tr("Sửa từ", "Edit words")}</button>}
        {s[key] && extra}
        <button role="switch" aria-checked={s[key]} aria-label={title} title={tip} className={`toggle${s[key] ? " on" : ""}`} onClick={() => set({ [key]: !s[key] })} />
      </span>
      {open && list && <div style={{ flexBasis: "100%" }}>
        <Words label="Comparison" color="blue" values={s[list[0]]} onChange={v => set({ [list[0]]: v })} />
        <Words label="Editorial" color="pink" values={s[list[1]]} onChange={v => set({ [list[1]]: v })} />
        <div className="s" style={{ marginTop: 4 }}>{tr("Cách nhau bằng dấu phẩy · ^ = ở đầu · # = số · * = chữ bất kỳ", "Comma-separated · ^ = at the start · # = number · * = any letters")}</div>
      </div>}
    </div>
  }
  return <section>
    <h2>{tr("Phân loại Content Plan", "Content Plan classification")}</h2>
    <p className="desc">{tr("AI đọc file theo prompt, sau đó các quy tắc đang bật được áp lên kết quả.", "The AI reads the file with the prompt, then the enabled rules are applied to its answer.")}</p>

    <div className="box">
      <div className="box-row"><I n="message-code" /><span className="grow">{tr("Prompt phân loại", "Classification prompt")}{promptEdited && <> <span className="tag t-orange">{tr("Đã sửa", "Edited")}</span></>}</span>
        <button className="btn ghost" disabled={!promptEdited} onClick={() => set({ systemPrompt: D.systemPrompt, rulesPrompt: D.rulesPrompt })}><I n="restore" />{tr("Khôi phục gốc", "Restore original")}</button></div>
      <div className="box-row" style={{ display: "block" }}>
        <textarea className="inp" style={{ ...mono, width: "100%", minHeight: 220, height: "auto", resize: "vertical" }} aria-label={tr("Prompt phân loại", "Classification prompt")} maxLength={CONTENT_PLAN_LIMITS.rulesChars} value={raw("rulesPrompt")} onChange={e => set({ rulesPrompt: e.target.value })} />
        <details style={{ marginTop: 8 }}>
          <summary className="s" style={{ cursor: "pointer" }}>{tr("Nâng cao: system prompt và phần tool tự thêm", "Advanced: system prompt and the part the tool adds")}</summary>
          <textarea className="inp" style={{ ...mono, width: "100%", minHeight: 88, height: "auto", resize: "vertical", marginTop: 8 }} aria-label="System prompt" maxLength={CONTENT_PLAN_LIMITS.systemChars} value={raw("systemPrompt")} onChange={e => set({ systemPrompt: e.target.value })} />
          <pre aria-label={tr("Phần cố định", "Fixed part")} title={tr("Không sửa được, để tool đọc được câu trả lời", "Not editable, so the tool can read the answer")} style={{ ...mono, margin: "8px 0 0", padding: "8px 10px", borderRadius: 6, background: "var(--bg3)", color: "var(--f3)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}><I n="lock" /> {CLASSIFIER_ANSWER_FORMAT}{"\n"}{tr("<các dòng của file, đánh số>", "<the file's numbered lines>")}</pre>
        </details>
      </div>
    </div>

    <div className="box" style={{ marginTop: 12 }}>
      {rule("useHeadings", tr("Xếp nhóm theo heading", "Group by heading"), tr("Topic dưới heading có từ khoá thì theo nhóm đó, thắng nhóm AI đoán.", "Topics under a heading with a keyword take its group, over the AI's guess."))}
      {rule("useTitleWords", tr("Xếp nhóm theo từ trong tiêu đề", "Group by title words"), tr("Tiêu đề có từ khoá thì theo nhóm đó, thắng nhóm AI đoán. Tắt cả hai quy tắc này để AI quyết định theo prompt.", "Titles with a keyword take its group, over the AI's guess. Turn both off to let the prompt decide."))}
      {rule("mergeDuplicates", tr("Gộp topic trùng", "Merge duplicates"), tr("Topic lặp lại (rút gọn hoặc đổi chữ ít) chỉ tạo một bài.", "A repeated topic (shortened or slightly reworded) becomes one article."),
        <select className="inp" style={{ width: 96 }} aria-label={tr("Độ nhạy gộp trùng", "Duplicate sensitivity")} value={s.duplicateSensitivity} onChange={e => set({ duplicateSensitivity: e.target.value as ContentPlanSettings["duplicateSensitivity"] })}>
          <option value="strict">{tr("Chặt", "Strict")}</option><option value="normal">{tr("Vừa", "Normal")}</option><option value="loose">{tr("Lỏng", "Loose")}</option>
        </select>)}
      {rule("keepNeedsReview", tr("Giữ nhãn Needs review", "Keep Needs review"), tr("Topic AI không chắc giữ nhãn Needs review. Tắt: xếp vào Editorial.", "Topics the AI is unsure about keep Needs review. Off: they become Editorial."))}
    </div>

    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
      <select className="inp" style={{ width: 220 }} aria-label={tr("Plan để thử", "Plan to try")} value={plan?.id ?? ""} onChange={e => setPlanId(e.target.value)} disabled={!ready.length}>
        {ready.length ? ready.map(p => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">{tr("Chưa có plan đã phân loại", "No classified plan yet")}</option>}
      </select>
      <button className="btn" disabled={!plan || Boolean(busy)} title={tr("Không gọi AI. Prompt mới chỉ áp dụng khi Phân loại lại plan.", "No AI call. A new prompt applies only on Reclassify.")} onClick={e => void runPreview(e.timeStamp)}><I n="eye" />{busy === "preview" ? tr("Đang thử…", "Trying…") : tr("Thử trên plan", "Try on plan")}</button>
      <button className="btn ghost" disabled={same(s, D)} onClick={() => onChange({ ...config, contentPlan: { ...D } })}><I n="restore" />{tr("Về mặc định", "Reset")}</button>
    </div>
    {promptChanged && <div className="s" style={{ marginTop: 6 }}><I n="info-circle" /> {tr("Prompt mới áp dụng khi lưu rồi Phân loại lại plan.", "A new prompt applies after saving and Reclassify.")}</div>}
    {r && plan && <div className="box" style={{ marginTop: 12 }} aria-label={tr("Kết quả thử", "Preview")}>
      <div className="box-row" style={{ flexWrap: "wrap" }}><I n="arrows-diff" /><div className="grow" style={{ minWidth: 200 }}>{counts(r.before)} → <b>{counts(r.after)}</b>
        <div className="s">{r.changed.length || r.added.length || r.removed.length ? tr(`${r.changed.length} đổi nhóm · ${r.added.length} thêm · ${r.removed.length} gộp/bỏ`, `${r.changed.length} regrouped · ${r.added.length} added · ${r.removed.length} merged`) : tr("Không có thay đổi", "No changes")}</div></div>
        <button className="btn primary" disabled={unsaved || Boolean(busy) || !(r.changed.length || r.added.length || r.removed.length)} title={unsaved ? tr("Lưu thay đổi trước khi áp dụng", "Save changes before applying") : tr("Nhóm đã sửa tay sẽ bị ghi đè", "Manual group edits are overwritten")} onClick={e => void apply(e.timeStamp)}><I n="check" />{busy === "apply" ? tr("Đang áp dụng…", "Applying…") : unsaved ? tr("Lưu trước khi áp dụng", "Save to apply") : tr("Áp dụng cho plan này", "Apply to this plan")}</button>
      </div>
      {r.changed.slice(0, 30).map(c => <div key={c.id} className="box-row"><span className={`tag t-${TYPE[c.from]?.[0] ?? "gray"}`}>{TYPE[c.from]?.[1] ?? c.from}</span><I n="arrow-right" /><span className={`tag t-${TYPE[c.to]?.[0] ?? "gray"}`}>{TYPE[c.to]?.[1] ?? c.to}</span><div className="grow">{c.title}</div></div>)}
      {r.added.slice(0, 15).map(t => <div key={`a-${t}`} className="box-row"><span className="tag t-green">{tr("Thêm", "Added")}</span><div className="grow">{t}</div></div>)}
      {r.removed.slice(0, 15).map(t => <div key={`r-${t}`} className="box-row"><span className="tag t-gray">{tr("Gộp/bỏ", "Merged")}</span><div className="grow">{t}</div></div>)}
    </div>}
  </section>
}
