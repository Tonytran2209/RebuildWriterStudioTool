import type { AIProcessTraceEvent } from '../../types';
import { useI18n } from '../../lib/i18n';

export default function ProcessTrace({ events }: { events?: AIProcessTraceEvent[] }) {
  const { tr } = useI18n();
  if (!events?.length) return null;
  return (
    <details open className="rounded-xl border border-violet-200 bg-violet-50/50 overflow-hidden">
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3">
        <div><div className="text-[10px] font-bold uppercase tracking-wider text-violet-800">{tr('Nhật ký hành động AI có thể kiểm chứng', 'Verifiable AI action log')}</div><p className="text-[10px] text-violet-600 mt-0.5">{tr('Hiển thị các bước hệ thống thực sự chạy; không phải chain-of-thought nội bộ.', 'Shows observable system actions, not private chain-of-thought.')}</p></div>
        <span className="rounded-full bg-white border border-violet-200 px-2 py-1 text-[10px] font-bold text-violet-700">{events.length} stages</span>
      </summary>
      <div className="border-t border-violet-100 divide-y divide-violet-100">
        {events.map((event, index) => (
          <div key={event.id} className="p-4 bg-white/60">
            <div className="flex items-start gap-3">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${event.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : event.status === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{index + 1}</span>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b className="text-xs text-slate-800">{event.title}</b><span className="text-[9px] uppercase tracking-wider text-slate-400">{event.stage}</span></div><p className="text-[10px] text-slate-600 leading-relaxed mt-1 whitespace-pre-wrap">{event.detail}</p>
                {event.facts && <div className="flex flex-wrap gap-1.5 mt-2">{Object.entries(event.facts).map(([key, value]) => <span key={key} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[9px] text-slate-600"><b>{key}:</b> {String(value ?? 'n/a')}</span>)}</div>}
                {(event.sources?.length ?? 0) > 0 && <div className="flex flex-wrap gap-2 mt-2">{event.sources?.map((url, sourceIndex) => <a key={`${url}-${sourceIndex}`} href={url} target="_blank" rel="noreferrer" className="text-[9px] text-violet-700 underline hover:text-violet-900">Source {sourceIndex + 1}</a>)}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
