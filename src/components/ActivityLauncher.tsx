import { useMemo, useState } from 'react';
import type { ContentPlanItem } from '../types';
import { useI18n } from '../lib/i18n';

interface Props {
  onCreate: (type: ContentPlanItem['type'], plan: string, items: ContentPlanItem[], batchSize?: 5 | 10 | 15 | 20) => Promise<void>;
  onOpenConfig: () => void;
}

function classifyPlan(plan: string): ContentPlanItem[] {
  return plan.split(/\r?\n/).map(line => line.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean).map((line, index) => {
    const comparison = /\b(vs\.?|versus|compare|comparison|best|top\s+\d+|alternative|review|pricing)\b|so sánh|đánh giá|tốt nhất|thay thế/i.test(line);
    const title = line.split(/[|\t;]/)[0].trim();
    const keywords = line.split(/[|\t;]/).slice(1).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
    return { id: `plan-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`, title, keywords, type: comparison ? 'comparison-seo' : 'editorial-originality', sourceLine: line };
  });
}

export default function ActivityLauncher({ onCreate, onOpenConfig }: Props) {
  const { tr } = useI18n();
  const [plan, setPlan] = useState('');
  const [activeType, setActiveType] = useState<ContentPlanItem['type']>('comparison-seo');
  const [selected, setSelected] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState<5 | 10 | 15 | 20>(5);
  const [saving, setSaving] = useState(false);
  const items = useMemo(() => classifyPlan(plan), [plan]);
  const visible = items.filter(item => item.type === activeType);
  const chosen = visible.filter(item => selected.includes(item.id));

  const start = async () => {
    const target = activeType === 'comparison-seo' ? chosen.slice(0, batchSize) : chosen.slice(0, 1);
    if (!target.length) return;
    setSaving(true);
    try { await onCreate(activeType, plan, target, activeType === 'comparison-seo' ? batchSize : undefined); }
    finally { setSaving(false); }
  };

  return <div className="flex-1 overflow-y-auto p-4 md:p-8">
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[.2em] text-indigo-600">Writer Studio</p><h1 className="mt-1 text-2xl font-bold text-slate-900">{tr('Bắt đầu một content activity', 'Start a content activity')}</h1><p className="mt-2 text-sm text-slate-500">{tr('Nhập Content Plan cho đợt hiện tại. Tool sẽ phân loại từng bài vào hai workflow.', 'Paste the Content Plan for this run. Each article is classified into one of two workflows.')}</p></div><button onClick={onOpenConfig} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">{tr('KB & Skills', 'KB & Skills')}</button></div>
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><label className="text-xs font-bold text-slate-700">Content Plan / Action Plan</label><textarea value={plan} onChange={event => { setPlan(event.target.value); setSelected([]); }} rows={7} placeholder={tr('Mỗi bài một dòng. Có thể thêm keywords sau dấu |', 'One article per line. Add keywords after | if needed.')} className="mt-2 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:ring-2 focus:ring-indigo-300"/><div className="mt-2 text-[11px] text-slate-400">{items.length} {tr('bài đã được trích xuất', 'items extracted')}</div></div>
      <div className="grid grid-cols-2 gap-3">{(['comparison-seo','editorial-originality'] as const).map(type => <button key={type} onClick={() => { setActiveType(type); setSelected([]); }} className={`rounded-2xl border p-4 text-left transition ${activeType === type ? 'border-slate-900 bg-slate-900 text-white shadow-lg' : 'border-slate-200 bg-white text-slate-700'}`}><div className="text-sm font-bold">{type === 'comparison-seo' ? 'Comparison / SEO' : 'Editorial / Originality'}</div><div className={`mt-1 text-[11px] ${activeType === type ? 'text-slate-300' : 'text-slate-400'}`}>{type === 'comparison-seo' ? tr('Tạo hàng loạt theo pipeline 4 bước', 'Batch generation through the 4-step pipeline') : tr('Chạy và kiểm soát từng bài qua 4 bước', 'Run and review one article through all 4 steps')}</div></button>)}</div>
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-sm font-bold text-slate-800">{activeType === 'comparison-seo' ? 'Comparison / SEO' : 'Editorial / Originality'} <span className="text-slate-400">({visible.length})</span></h2>{activeType === 'comparison-seo' && <div className="flex gap-1">{([5,10,15,20] as const).map(size => <button key={size} onClick={() => setBatchSize(size)} className={`h-7 min-w-8 rounded-lg text-[10px] font-bold ${batchSize === size ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{size}</button>)}</div>}</div><div className="mt-3 max-h-72 overflow-y-auto space-y-2">{visible.map(item => <label key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 cursor-pointer"><input type={activeType === 'comparison-seo' ? 'checkbox' : 'radio'} name="plan-item" checked={selected.includes(item.id)} onChange={() => setSelected(current => activeType === 'comparison-seo' ? current.includes(item.id) ? current.filter(id => id !== item.id) : current.length < batchSize ? [...current,item.id] : current : [item.id])}/><div className="min-w-0"><div className="text-xs font-semibold text-slate-800">{item.title}</div><div className="truncate text-[10px] text-slate-400">{item.sourceLine}</div></div></label>)}{!visible.length && <div className="py-8 text-center text-xs text-slate-400">{tr('Nhập Content Plan để xem danh sách được phân loại.', 'Paste a Content Plan to see classified items.')}</div>}</div><button disabled={!chosen.length || saving} onClick={start} className="mt-4 w-full rounded-2xl bg-slate-900 py-3 text-sm font-bold text-white disabled:opacity-40">{saving ? tr('Đang lưu activity…', 'Saving activity…') : activeType === 'comparison-seo' ? `${tr('Tạo batch', 'Create batch')} (${Math.min(chosen.length,batchSize)})` : tr('Bắt đầu workflow 4 bước', 'Start 4-step workflow')}</button></div>
    </div>
  </div>;
}
