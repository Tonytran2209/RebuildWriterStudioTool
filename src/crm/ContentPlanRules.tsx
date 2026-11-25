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

/** Settings › Workflow AI › Content Plan classification: the prompt the AI gets, then the rules applied to its answer. */
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
  const counts = (c: RulesPreview["before"]) => `${c.total} topic · C ${c.comparison} · E ${c.editorial}${c.review ? ` · R ${c.review}` : ""}`
  const toggle = (key: "useHeadings" | "useTitleWords" | "mergeDuplicates" | "keepNeedsReview", title: string, hint: string, body?: ReactNode, extra?: ReactNode) =>
    <div className="box-row" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
      <div className="grow" style={{ minWidth: 220 }}>{title}<div className="s">{hint}</div>{s[key] && body}</div>
      {s[key] && extra}
      <button role="switch" aria-checked={s[key]} aria-label={title} className={`toggle${s[key] ? " on" : ""}`} style={{ marginTop: 2 }} onClick={() => set({ [key]: !s[key] })} />
    </div>
  return <section>
    <h2>{tr("Phân loại Content Plan", "Content Plan classification")}</h2>
    <p className="desc">{tr("AI đọc file theo prompt bên dưới, chọn dòng nào là topic và đoán nhóm. Sau đó các quy tắc bật/tắt được áp lên kết quả của AI.", "The AI reads the file with the prompt below, picks the topic lines and guesses each group. The on/off rules are then applied to its answer.")}</p>

    <div className="box">
      <div className="box-row" style={{ flexWrap: "wrap" }}><I n="message-code" /><div className="grow" style={{ minWidth: 220 }}>{tr("Prompt cho AI", "Prompt for the AI")}{promptEdited && <> <span className="tag t-orange">{tr("Đã sửa", "Edited")}</span></>}<div className="s">{tr("Sửa trực tiếp để đổi cách AI phân tích và phân loại. Lưu xong, plan mới hoặc bấm Phân loại lại sẽ dùng prompt này.", "Edit to change how the AI analyses and groups topics. Once saved, new plans and Reclassify use it.")}</div></div>
        <button className="btn ghost" disabled={!promptEdited} onClick={() => set({ systemPrompt: D.systemPrompt, rulesPrompt: D.rulesPrompt })}><I n="restore" />{tr("Khôi phục prompt gốc", "Restore original prompt")}</button></div>
      <div className="box-row" style={{ display: "block" }}>
        <div className="s" style={{ marginBottom: 4 }}>System prompt</div>
        <textarea className="inp" style={{ ...mono, width: "100%", minHeight: 88, resize: "vertical" }} aria-label="System prompt" maxLength={CONTENT_PLAN_LIMITS.systemChars} value={raw("systemPrompt")} onChange={e => set({ systemPrompt: e.target.value })} />
        <div className="s" style={{ margin: "10px 0 4px", display: "flex", justifyContent: "space-between", gap: 8 }}><span>{tr("Quy tắc phân tích & phân loại", "Analysis & grouping rules")}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{raw("rulesPrompt").length.toLocaleString()} / {CONTENT_PLAN_LIMITS.rulesChars.toLocaleString()}</span></div>
        <textarea className="inp" style={{ ...mono, width: "100%", minHeight: 260, resize: "vertical" }} aria-label={tr("Quy tắc phân tích & phân loại", "Analysis & grouping rules")} maxLength={CONTENT_PLAN_LIMITS.rulesChars} value={raw("rulesPrompt")} onChange={e => set({ rulesPrompt: e.target.value })} />
        <div className="s" style={{ margin: "10px 0 4px" }}><I n="lock" /> {tr("Tool tự thêm vào cuối, không sửa được (để đọc được câu trả lời)", "Always added by the tool, not editable (keeps the answer readable)")}</div>
        <pre aria-label={tr("Phần cố định", "Fixed part")} style={{ ...mono, margin: 0, padding: "8px 10px", borderRadius: 6, background: "var(--bg3)", color: "var(--f2)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{CLASSIFIER_ANSWER_FORMAT}{"\n\n"}{tr("<các dòng của file, đánh số: 12| Tiêu đề…>", "<the file's lines, numbered: 12| Title…>")}</pre>
      </div>
    </div>

    <h3 style={{ fontSize: 13, fontWeight: 600, margin: "18px 0 4px" }}>{tr("Quy tắc áp lên kết quả AI", "Rules applied to the AI's answer")}</h3>
    <p className="desc" style={{ marginTop: 0 }}>{tr("Quy tắc đang bật thắng nhóm AI đoán. Tắt hai quy tắc đầu để AI quyết định nhóm hoàn toàn theo prompt. Đổi các quy tắc này không cần gọi lại AI.", "An enabled rule beats the AI's group. Turn the first two off to let the prompt alone decide groups. Changing these needs no new AI call.")}</p>
    <div className="box">
      {toggle("useHeadings", tr("Xếp nhóm theo heading của file", "Group by the file's headings"), tr("Topic nằm dưới heading có một trong các từ này thuộc nhóm đó. * = chữ bất kỳ (compar* khớp comparison, comparing).", "Topics under a heading with one of these words take that group. * = any letters (compar* matches comparison, comparing)."),
        <><Words label="Comparison" color="blue" values={s.comparisonHeadings} onChange={v => set({ comparisonHeadings: v })} /><Words label="Editorial" color="pink" values={s.editorialHeadings} onChange={v => set({ editorialHeadings: v })} /></>)}
      {toggle("useTitleWords", tr("Xếp nhóm theo từ trong tiêu đề", "Group by words in the title"), tr("Khớp nguyên từ, cách nhau bằng dấu phẩy. ^ ở đầu = tiêu đề bắt đầu bằng từ đó; # = một số. Editorial thắng, trừ tiêu đề có \"vs\".", "Whole words, comma-separated. ^ first = the title starts with it; # = a number. Editorial wins, except titles with \"vs\"."),
        <><Words label="Comparison" color="blue" values={s.comparisonPhrases} onChange={v => set({ comparisonPhrases: v })} /><Words label="Editorial" color="pink" values={s.editorialPhrases} onChange={v => set({ editorialPhrases: v })} /></>)}
      {toggle("mergeDuplicates", tr("Gộp topic trùng", "Merge duplicate topics"), tr("Một topic có trong hai danh sách (rút gọn hoặc đổi chữ ít) chỉ tạo một bài.", "A topic listed twice (shortened or slightly reworded) becomes one article."), undefined,
        <select className="inp" style={{ width: 110 }} aria-label={tr("Độ nhạy gộp trùng", "Duplicate sensitivity")} value={s.duplicateSensitivity} onChange={e => set({ duplicateSensitivity: e.target.value as ContentPlanSettings["duplicateSensitivity"] })}>
          <option value="strict">{tr("Chặt", "Strict")}</option><option value="normal">{tr("Vừa", "Normal")}</option><option value="loose">{tr("Lỏng", "Loose")}</option>
        </select>)}
      {toggle("keepNeedsReview", tr("Giữ nhãn Needs review", "Keep the Needs review label"), tr("Topic AI không chắc nhóm giữ nhãn Needs review để người xem lại (vẫn chạy như Editorial). Tắt: xếp thẳng vào Editorial.", "Topics the AI is unsure about keep Needs review for a person to check (they still run as Editorial). Off: they become Editorial."))}
    </div>

    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
      <select className="inp" style={{ width: 240 }} aria-label={tr("Plan để thử", "Plan to try")} value={plan?.id ?? ""} onChange={e => setPlanId(e.target.value)} disabled={!ready.length}>
        {ready.length ? ready.map(p => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">{tr("Chưa có plan đã phân loại", "No classified plan yet")}</option>}
      </select>
      <button className="btn" disabled={!plan || Boolean(busy)} onClick={e => void runPreview(e.timeStamp)}><I n="eye" />{busy === "preview" ? tr("Đang thử…", "Trying…") : tr("Thử quy tắc trên plan", "Try rules on plan")}</button>
      <button className="btn ghost" disabled={same(s, D)} onClick={() => onChange({ ...config, contentPlan: { ...D } })}><I n="restore" />{tr("Về mặc định", "Reset to defaults")}</button>
    </div>
    {promptChanged && <div className="s" style={{ marginTop: 6, color: "var(--f3)" }}><I n="info-circle" /> {tr("Thử trên plan chỉ tính các quy tắc bật/tắt. Prompt mới có hiệu lực khi lưu rồi bấm Phân loại lại trên plan.", "Trying on a plan covers the on/off rules only. A new prompt takes effect after saving and Reclassify on the plan.")}</div>}
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
