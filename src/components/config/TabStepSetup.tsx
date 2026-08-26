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
    stepConfigs: { ...config.stepConfigs, [step]: { ...config.stepConfigs[step], modelId, fileAccess: { kb: readyKb.map(f => f.id), action: [], rules: readySkills.map(f => f.id) } } },
  });
  const updateDraftWordLimit = (value: number) => onChange({
    ...config,
    stepConfigs: { ...config.stepConfigs, 4: { ...config.stepConfigs[4], maxDraftWords: Math.min(10000, Math.max(800, value || 1500)) } },
  });

  return <div className="settings-stack space-y-4">
    <div className={`settings-status rounded-2xl border p-3.5 flex items-center gap-3 ${backendOk ? 'bg-emerald-50 border-emerald-200' : backendOk === false ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
      <span className={`w-2.5 h-2.5 rounded-full ${backendOk ? 'bg-emerald-500' : backendOk === false ? 'bg-red-500' : 'bg-slate-300 animate-pulse'}`} />
      <div><p className="text-xs font-bold text-slate-800">{backendOk ? tr('AI Backend đang hoạt động', 'AI Backend is online') : backendOk === false ? tr('Không kết nối được AI backend', 'Cannot connect to AI backend') : tr('Đang kiểm tra kết nối…', 'Checking connection…')}</p><p className="text-[10px] text-slate-400">{config.railwayUrl || RAILWAY_URL}</p></div>
    </div>
    <div className="settings-section rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
      <p className="text-xs font-bold text-indigo-900">{tr('Kho kiến thức chung cho toàn bộ workflow', 'Shared knowledge for the entire workflow')}</p>
      <p className="mt-1 text-[11px] text-indigo-700">{tr('Mọi step tự động đọc toàn bộ KB và Skills đã nạp. Content Plan được nhập riêng khi bắt đầu từng activity.', 'Every step automatically reads all loaded KB and Skills. A Content Plan is provided separately for each activity.')}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white p-3 border border-indigo-100"><div className="text-lg font-bold text-indigo-700">{readyKb.length}</div><div className="text-[10px] font-semibold text-slate-500">Knowledge Base</div><div className="mt-1 text-[9px] text-slate-400 line-clamp-2">{readyKb.map(f => f.name).join(', ') || tr('Chưa có dữ liệu', 'No data loaded')}</div></div>
        <div className="rounded-xl bg-white p-3 border border-amber-100"><div className="text-lg font-bold text-amber-700">{readySkills.length}</div><div className="text-[10px] font-semibold text-slate-500">Skills & Rules</div><div className="mt-1 text-[9px] text-slate-400 line-clamp-2">{readySkills.map(f => f.name).join(', ') || tr('Chưa có dữ liệu', 'No data loaded')}</div></div>
      </div>
    </div>
    {workflowSteps.map((step, index) => { const calls = usageSummary[String(step)] ?? []; const totalTokens = calls.reduce((sum, call) => sum + Number(call.totalTokens ?? 0), 0); return <div key={step} className="settings-row rounded-2xl border border-slate-200 bg-slate-50 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">{index + 1}</span><span className="text-xs font-bold text-slate-800">{language === 'vi' ? ({2:'Ý tưởng cốt lõi & Góc tiếp cận',3:'Dàn bài nháp',4:'Bản nháp & Kiểm tra'} as Record<number,string>)[step] : ({2:'Core Idea & Angle',3:'Draft Outline',4:'First Draft & Audit'} as Record<number,string>)[step]}</span></div></div>
      <div className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-right"><div className="text-xs font-bold text-slate-800">{totalTokens.toLocaleString()} tokens</div><div className="text-[9px] text-slate-400">{calls.length} AI calls</div></div>
      <select value={config.stepConfigs[step]?.modelId ?? ''} onChange={event => updateStepModel(step, event.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 min-w-52"><option value="">— {tr('Chọn model', 'Select model')} —</option>{enabledModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select>
      {step === 4 && <label className="min-w-44"><span className="mb-1 block text-[9px] font-medium text-slate-500">{tr('Giới hạn số từ tiếng Anh', 'English word limit')}</span><input type="number" min={800} max={10000} step={100} value={Math.max(800, config.stepConfigs[4]?.maxDraftWords ?? config.stepConfigs[4]?.maxDraftCharacters ?? 1500)} onChange={event => updateDraftWordLimit(Number(event.target.value))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700" /><span className="mt-1 block text-[9px] text-slate-400">{tr('Tối thiểu 800 từ; draft chỉ lưu khi SEO checklist đạt 100%', 'Minimum 800 words; drafts save only when the SEO checklist reaches 100%')}</span></label>}
    </div>; })}
  </div>;
}
