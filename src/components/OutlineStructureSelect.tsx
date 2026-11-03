import type { OutlineStructureSnapshot } from '../../shared/outlineStructures';
import { readOutlineStructures } from '../../shared/outlineStructures';
import type { DocumentFile } from '../types';
import { useI18n } from '../lib/i18n';
interface Props { files: DocumentFile[]; allowedIds?: string[]; value?: OutlineStructureSnapshot | null; onChange: (value: OutlineStructureSnapshot) => void; disabled?: boolean }
export default function OutlineStructureSelect({ files, allowedIds, value, onChange, disabled }: Props) {
  const { tr } = useI18n();
  const { structures, errors } = readOutlineStructures(files, allowedIds);
  const key = (s: OutlineStructureSnapshot) => `${s.sourceId}:${s.id}:${s.sourceHash}`;
  const historical = value && !structures.some(s => key(s) === key(value));
  return <div className="space-y-2 rounded-xl border border-[var(--ui-border)] p-3">
    <label className="block text-sm">{tr('Cấu trúc outline', 'Outline structure')}
      <select aria-label={tr('Cấu trúc outline', 'Outline structure')} disabled={disabled} value={value ? key(value) : ''} onChange={e => { const selected = structures.find(s => key(s) === e.target.value); if (selected) onChange(selected); }} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-control)] px-3 text-sm">
        <option value="">{tr('Chọn cấu trúc từ Skills & Rules', 'Select a structure from Skills & Rules')}</option>
        {historical && <option value={key(value)}>{value.name} — {tr('bản đã lưu', 'saved version')}</option>}
        {structures.map(s => <option key={key(s)} value={key(s)}>{s.name} — {s.sourceName}</option>)}
      </select>
    </label>
    {value && <p className="text-xs text-[var(--ui-secondary)]">{value.description}{value.useWhen !== value.description && <><br />{value.useWhen}</>}<br />{tr('Nguồn', 'Source')}: {value.sourceName} · {value.id} · {value.sourceHash}</p>}
    {!structures.length && <p role="status" className="text-xs">{tr('Chưa có cấu trúc hợp lệ. Nạp 02-outline-generator.md hoặc MD có khối outline-structures vào Skills & Rules và cấp quyền cho Draft Outline.', 'No valid structures. Upload 02-outline-generator.md or a .md file with an outline-structures block to Skills & Rules and grant Draft Outline access.')}</p>}
    {errors.map(error => <p key={error} role="alert" className="text-xs text-amber-600">{error}</p>)}
  </div>;
}
