import type { AppConfig } from "../types"
import { PLAN_CLASSIFICATION_DEFAULTS, planClassificationSettings, type PlanClassificationSettings } from "../../shared/planClassification"
import { useI18n } from "../lib/i18n"


export function PlanClassificationSettingsEditor({ config, onChange }: { config: AppConfig; onChange: (value: AppConfig) => void }) {
  const { tr } = useI18n()
  const settings = config.planClassification ?? PLAN_CLASSIFICATION_DEFAULTS
  const update = (patch: Partial<PlanClassificationSettings>) => onChange({ ...config, planClassification: { ...settings, ...patch } })
  const fields = [
    ["systemPrompt", tr("System prompt", "System prompt")],
    ["extractionPrompt", tr("Quy tắc nhận diện topic bài viết", "Article topic extraction rules")],
    ["comparisonRule", "comparison-seo"],
    ["editorialRule", "editorial-originality"],
    ["resultPrompt", tr("Chỉ dẫn bổ sung cho danh sách topic", "Additional instructions for the topic list")],
  ] as const
  return <section><h2>{tr("Quy tắc phân loại Content Plan", "Content Plan classification rules")}</h2><p className="desc">{tr("Áp dụng cho các lần phân loại mới sau khi lưu. Chọn model ở mục Phân loại Content Plan phía trên.", "Applies to new classifications after saving. Select the model under Content Plan classification above.")}</p>
    <div className="box">
      <label className="box-row"><span className="grow">{tr("Chia theo Wave (splitByWave)", "Split by Wave (splitByWave)")}<span className="s" style={{ display: "block" }}>{tr("Nhận heading Wave có tháng hoặc quý. Phần đầu tài liệu đứng riêng; mỗi Wave có một lượt AI nếu còn dòng chưa có nhãn.", "Recognizes Wave headings with a month or quarter. The preamble is separate; each Wave with unlabeled content gets its own AI request.")}</span></span><input type="checkbox" checked={settings.splitByWave} onChange={e => update({ splitByWave: e.target.checked })} /></label>
      <label className="box-row"><span className="grow">{tr("Ưu tiên nhãn đầu dòng", "Honor explicit row labels")}<span className="s" style={{ display: "block" }}>[comparison-seo]: Title | keyword 1, keyword 2</span></span><input type="checkbox" checked={settings.recognizeLabels} onChange={e => update({ recognizeLabels: e.target.checked })} /></label>
      <label className="box-row"><span className="grow">{tr("Confidence tối thiểu để gán nhóm", "Minimum confidence for assigning a group")}</span><input className="inp" style={{ width: 96 }} type="number" min={0} max={1} step={0.01} value={settings.confidenceThreshold} onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) update({ confidenceThreshold: Math.max(0, Math.min(1, e.target.valueAsNumber)) }) }} /></label>
      {fields.map(([key, label]) => <label key={key} className="box-row" style={{ display: "grid", gap: 6 }}>
        {label}<textarea className="inp" rows={3} style={{ width: "100%", height: "auto" }} maxLength={8000} value={settings[key]} onChange={e => update({ [key]: e.target.value })} />
      </label>)}
      <div className="box-row" style={{ flexWrap: "wrap" }}>
        <span className="grow s">{tr("Đầu ra dùng schema topic của Writer Studio. Backend kiểm tra trích dẫn nguồn, loại trùng và chuyển topic dưới ngưỡng sang Needs review.", "Output uses Writer Studio’s topic schema. The backend validates source quotes, removes duplicates, and sends low-confidence topics to Needs review.")}</span>
        <button type="button" className="btn" onClick={() => onChange({ ...config, planClassification: planClassificationSettings() })}>{tr("Khôi phục mặc định", "Restore defaults")}</button>
      </div>
    </div>
  </section>
}
