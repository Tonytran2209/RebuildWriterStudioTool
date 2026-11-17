import type { OutlineStructureSnapshot } from "../../shared/outlineStructures"
import { readOutlineStructures } from "../../shared/outlineStructures"
import type { DocumentFile } from "../types"
import { useI18n } from "../lib/i18n"
import { I } from "./ui"

type Props = { files: DocumentFile[]; allowedIds?: string[]; value?: OutlineStructureSnapshot | null; onChange: (value: OutlineStructureSnapshot) => void; disabled?: boolean }

/** Outline structure picker in the demo's form vocabulary (frow + select.inp). */
export default function StructureSelect({ files, allowedIds, value, onChange, disabled }: Props) {
  const { tr } = useI18n()
  const { structures, errors } = readOutlineStructures(files, allowedIds)
  const key = (s: OutlineStructureSnapshot) => `${s.sourceId}:${s.id}:${s.sourceHash}`
  const historical = value && !structures.some(s => key(s) === key(value))
  const choices = historical ? [value, ...structures] : structures
  return <div>
    <div className="frow"><div className="flabel"><I n="list-tree" />{tr("Cấu trúc", "Structure")}</div>
      <div className="fval"><select aria-label={tr("Cấu trúc outline", "Outline structure")} value={value ? key(value) : ""} disabled={disabled || !choices.length} onChange={e => { const s = choices.find(c => key(c) === e.target.value); if (s) onChange(s) }}>
        {!value && <option value="" disabled>{tr("Chọn cấu trúc (bắt buộc)…", "Choose a structure (required)…")}</option>}
        {choices.map((s, i) => <option key={key(s)} value={key(s)}>{s.name}{historical && i === 0 ? ` · ${tr("bản đã lưu", "saved version")}` : ""}</option>)}
      </select></div>
    </div>
    {value && <div style={{ color: "var(--f3)", lineHeight: 1.5, padding: "2px 0 4px 128px" }}>{value.useWhen || value.description}</div>}
    {!choices.length && <div style={{ color: "var(--c-orange, var(--f3))", padding: "2px 0 4px 128px" }} role="status">{tr("Chưa có cấu trúc. Kiểm tra file outline generator trong Skills & Rules và quyền truy cập của Draft Outline.", "No structures available. Check the outline generator file in Skills & Rules and Draft Outline access.")}</div>}
    {errors.map(error => <div key={error} role="alert" style={{ color: "var(--c-red, var(--f3))", padding: "2px 0 4px 128px" }}>{error}</div>)}
  </div>
}
