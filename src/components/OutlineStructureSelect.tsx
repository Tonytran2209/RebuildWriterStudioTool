import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ListTree } from 'lucide-react';
import type { OutlineStructureSnapshot } from '../../shared/outlineStructures';
import { readOutlineStructures } from '../../shared/outlineStructures';
import type { DocumentFile } from '../types';
import { useI18n } from '../lib/i18n';
interface Props { files: DocumentFile[]; allowedIds?: string[]; value?: OutlineStructureSnapshot | null; onChange: (value: OutlineStructureSnapshot) => void; disabled?: boolean }
export default function OutlineStructureSelect({ files, allowedIds, value, onChange, disabled }: Props) {
  const { tr } = useI18n();
  const { structures, errors } = readOutlineStructures(files, allowedIds);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const key = (s: OutlineStructureSnapshot) => `${s.sourceId}:${s.id}:${s.sourceHash}`;
  const historical = value && !structures.some(s => key(s) === key(value));
  const choices = historical ? [value, ...structures] : structures;
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const selected = choices.findIndex(s => value && key(s) === key(value));
    options.current[Math.max(0, selected)]?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div ref={root} className={`outline-picker ${value ? 'has-selection' : 'needs-selection'}`} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
    <div className="outline-picker-heading">
      <span className="outline-picker-icon" aria-hidden="true"><ListTree size={19} /></span>
      <div><h3 id={`${id}-label`}>{tr('Chọn cấu trúc outline', 'Choose an outline structure')}</h3><p id={`${id}-help`}>{tr('Bắt buộc trước khi tạo outline. Lựa chọn này định hướng bố cục bài viết.', 'Required before generating an outline. This choice guides the article layout.')}</p></div>
      <span className="outline-picker-badge">{value ? <><Check size={13} aria-hidden="true" />{tr('Đã chọn', 'Selected')}</> : tr('Bắt buộc', 'Required')}</span>
    </div>
    <button ref={trigger} type="button" className="outline-picker-trigger" disabled={disabled || !choices.length} aria-labelledby={`${id}-label ${id}-value`} aria-describedby={`${id}-help`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} onClick={() => setOpen(!open)} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}>
      <span><span id={`${id}-value`} className="outline-picker-value">{value?.name ?? tr('Chọn dạng cấu trúc phù hợp…', 'Select the right structure…')}</span><span className="outline-picker-trigger-hint">{value ? tr('Đổi cấu trúc', 'Change structure') : tr('Xem các lựa chọn và cách sử dụng', 'Explore options and when to use them')}</span></span>
      <ChevronDown size={18} aria-hidden="true" className={open ? 'is-open' : ''} />
    </button>
    {open && <div className="outline-picker-menu"><div className="outline-picker-menu-heading">{tr('Chọn bố cục cho bài viết', 'Choose your article layout')}<span>{choices.length} {tr('lựa chọn', 'options')}</span></div>
      <div id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="outline-picker-options" onKeyDown={e => {
        if (e.key === 'Tab') { setOpen(false); trigger.current?.focus(); return; }
        const index = options.current.indexOf(document.activeElement as HTMLButtonElement);
        let next = index;
        if (e.key === 'ArrowDown') next = (index + 1) % choices.length;
        else if (e.key === 'ArrowUp') next = (index - 1 + choices.length) % choices.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = choices.length - 1;
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
        else return;
        e.preventDefault(); options.current[next]?.focus();
      }}>
        {choices.map((choice, index) => <button ref={node => { options.current[index] = node; }} key={key(choice)} type="button" role="option" tabIndex={-1} aria-selected={Boolean(value && key(value) === key(choice))} className="outline-picker-option" onClick={() => { onChange(choice); close(); }}>
          <span className="outline-picker-option-mark" aria-hidden="true">{value && key(value) === key(choice) && <Check size={14} />}</span>
          <span><strong>{choice.name}</strong><span className="outline-picker-option-description">{choice.useWhen || choice.description}</span>{historical && index === 0 && <small>{tr('Phiên bản đã lưu cho bài này', 'Saved version for this article')}</small>}</span>
        </button>)}
      </div>
    </div>}
    {!value && choices.length > 0 && <p className="outline-picker-notice" role="status">{tr('Chưa chọn cấu trúc — chọn một lựa chọn để mở nút tạo outline.', 'No structure selected — choose one to enable outline generation.')}</p>}
    {value && <div className="outline-picker-summary"><p>{value.description}</p>{value.useWhen !== value.description && <p>{value.useWhen}</p>}<details><summary>{tr('Nguồn hướng dẫn', 'Instruction source')}: {value.sourceName}</summary><p>{value.id} · {value.sourceHash}{historical ? ` · ${tr('Phiên bản đã lưu', 'Saved version')}` : ''}</p></details></div>}
    {!structures.length && !value && <p className="outline-picker-notice" role="status">{tr('Chưa có cấu trúc khả dụng. Kiểm tra file outline generator trong Skills & Rules và quyền truy cập của Draft Outline.', 'No structures available. Check the outline generator file in Skills & Rules and Draft Outline access.')}</p>}
    {errors.map(error => <p key={error} role="alert" className="outline-picker-notice">{error}</p>)}
  </div>;
}
