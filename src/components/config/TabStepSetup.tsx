import { useEffect, useState } from 'react';
import type { AppConfig, Article, DocumentFile } from '../../types';
import { pingRailway } from '../../lib/db';
import { isDocumentReady } from '../../lib/documentStatus';
import { useI18n } from '../../lib/i18n';

interface Props { config: AppConfig; files: DocumentFile[]; articles: Article[]; onChange: (config: AppConfig) => void }
const RAILWAY_URL = 'https://rebuildwriterstudiotool-production.up.railway.app';

export default function TabStepSetup({ config, files, articles, onChange }: Props) {
  const { language, tr } = useI18n();
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const enabledModels = config.models.filter(model => model.enabled);
  const readyKb = files.filter(file => file.category === 'kb' && isDocumentReady(file));
  const readySkills = files.filter(file => file.category === 'rules' && isDocumentReady(file));
  const workflowSteps = [2, 3, 4] as const;
  const usageSummary = Object.fromEntries(workflowSteps.map(step => [String(step), articles.flatMap(article => article.aiUsageByStep?.[step] ?? [])]));

  useEffect(() => { pingRailway(config.railwayUrl || RAILWAY_URL).then(result => setBackendOk(result.ok)); }, [config.railwayUrl]);

  const updateStepModel = (step: number, modelId: string) => onChange({
    ...config,
    stepConfigs: { ...config.stepConfigs, [step]: { ...config.stepConfigs[step], modelId, fileAccess: { kb: readyKb.map(f => f.id), rules: readySkills.map(f => f.id) } } },
  });
  const updateDraftWordLimit = (value: number) => onChange({
    ...config,
    stepConfigs: { ...config.stepConfigs, 4: { ...config.stepConfigs[4], maxDraftWords: Math.min(10000, Math.max(800, value || 1500)) } },
  });

  return <div className="settings-stack space-y-4">
    <div className="settings-status flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <span className={`w-2.5 h-2.5 rounded-full ${backendOk ? 'bg-emerald-500' : backendOk === false ? 'bg-red-500' : 'bg-slate-300 animate-pulse'}`} />
      <div><p className="text-xs font-bold text-slate-800">{backendOk ? tr('AI Backend đang hoạt động', 'AI Backend is online') : backendOk === false ? tr('Không kết nối được AI backend', 'Cannot connect to AI backend') : tr('Đang kiểm tra kết nối…', 'Checking connection…')}</p><p className="text-[10px] text-slate-400">{config.railwayUrl || RAILWAY_URL}</p></div>
    </div>
    <div className="settings-section rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-900">{tr('Nguồn context của workflow', 'Workflow context sources')}</p>
      <p className="mt-1 text-[11px] text-slate-500">{tr('Mỗi step đọc Content Plan hiện tại, Knowledge Base và các guide tham khảo theo Workflow Rules.', 'Each step reads the current Content Plan, Knowledge Base, and reference guides according to Workflow Rules.')}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-base font-medium text-slate-900">{readyKb.length}</div><div className="text-[10px] font-medium text-slate-600">Knowledge Base</div><div className="mt-1 line-clamp-2 text-[9px] text-slate-400">{readyKb.map(f => f.name).join(', ') || tr('Chưa có dữ liệu', 'No data loaded')}</div></div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-base font-medium text-slate-900">{readySkills.length}</div><div className="text-[10px] font-medium text-slate-600">Reference guides</div><div className="mt-1 line-clamp-2 text-[9px] text-slate-400">{readySkills.map(f => f.name).join(', ') || tr('Chưa có dữ liệu', 'No data loaded')}</div></div>
      </div>
    </div>
    {workflowSteps.map((step, index) => { const calls = usageSummary[String(step)] ?? []; const totalTokens = calls.reduce((sum, call) => sum + Number(call.totalTokens ?? 0), 0); return <div key={step} className="settings-row flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2.5"><span className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-[10px] font-medium text-slate-600">{index + 1}</span><span className="text-xs font-medium text-slate-900">{language === 'vi' ? ({2:'Ý tưởng cốt lõi & Góc tiếp cận',3:'Dàn bài nháp',4:'Bản nháp & Kiểm tra'} as Record<number,string>)[step] : ({2:'Core Idea & Angle',3:'Draft Outline',4:'First Draft & Audit'} as Record<number,string>)[step]}</span></div></div>
      <div className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-right"><div className="text-xs font-bold text-slate-800">{totalTokens.toLocaleString()} tokens</div><div className="text-[9px] text-slate-400">{calls.length} AI calls</div></div>
      <select value={config.stepConfigs[step]?.modelId ?? ''} onChange={event => updateStepModel(step, event.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 min-w-52"><option value="">— {tr('Chọn model', 'Select model')} —</option>{enabledModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select>
      {step === 4 && <label className="min-w-44"><span className="mb-1 block text-[9px] font-medium text-slate-500">{tr('Giới hạn số từ tiếng Anh', 'English word limit')}</span><input type="number" min={800} max={10000} step={100} value={Math.max(800, config.stepConfigs[4]?.maxDraftWords ?? config.stepConfigs[4]?.maxDraftCharacters ?? 1500)} onChange={event => updateDraftWordLimit(Number(event.target.value))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700" /><span className="mt-1 block text-[9px] text-slate-400">{tr('Tối thiểu 800 từ; draft chỉ lưu khi SEO checklist đạt 100%', 'Minimum 800 words; drafts save only when the SEO checklist reaches 100%')}</span></label>}
    </div>; })}
  </div>;
}
