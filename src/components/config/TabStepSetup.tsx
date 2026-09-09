import { useEffect, useState } from 'react';
import { Bot, Database, FileText, Gauge } from 'lucide-react';
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

  return <div className="settings-stack space-y-8">
    <section>
      <h2 className="mb-3 text-sm font-medium text-slate-800">{tr('Hệ thống', 'System')}</h2>
      <div className="settings-preference-group divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Bot className="app-icon shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-800">{tr('AI Backend', 'AI backend')}</p><p className="mt-0.5 truncate text-xs text-slate-400">{config.railwayUrl || RAILWAY_URL}</p></div>
          <span className={`inline-flex items-center gap-1.5 text-xs ${backendOk ? 'text-emerald-600' : backendOk === false ? 'text-red-600' : 'text-slate-400'}`}><span className={`h-2 w-2 rounded-full ${backendOk ? 'bg-emerald-500' : backendOk === false ? 'bg-red-500' : 'animate-pulse bg-slate-300'}`} />{backendOk ? tr('Online', 'Online') : backendOk === false ? tr('Mất kết nối', 'Offline') : tr('Đang kiểm tra', 'Checking')}</span>
        </div>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Database className="app-icon shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-800">Knowledge Base</p><p className="mt-0.5 truncate text-xs text-slate-400">{readyKb.map(file => file.name).join(', ') || tr('Chưa có dữ liệu', 'No data loaded')}</p></div>
          <span className="text-sm font-medium text-slate-600">{readyKb.length}</span>
        </div>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <FileText className="app-icon shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-800">Skills & Rules</p><p className="mt-0.5 truncate text-xs text-slate-400">{readySkills.map(file => file.name).join(', ') || tr('Chưa có dữ liệu', 'No data loaded')}</p></div>
          <span className="text-sm font-medium text-slate-600">{readySkills.length}</span>
        </div>
      </div>
    </section>

    <section>
      <h2 className="mb-1 text-sm font-medium text-slate-800">{tr('Model theo workflow', 'Workflow models')}</h2>
      <p className="mb-3 text-xs leading-5 text-slate-400">{tr('Chọn model cho từng bước và theo dõi usage đã ghi nhận.', 'Choose a model for each step and review recorded usage.')}</p>
      <div className="settings-preference-group divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {workflowSteps.map((step, index) => {
          const calls = usageSummary[String(step)] ?? [];
          const totalTokens = calls.reduce((sum, call) => sum + Number(call.totalTokens ?? 0), 0);
          const title = language === 'vi' ? ({2:'Article Spec & Định hướng',3:'Dàn bài nháp',4:'Bản nháp & Kiểm tra'} as Record<number,string>)[step] : ({2:'Article Spec & Direction',3:'Draft Outline',4:'First Draft & Audit'} as Record<number,string>)[step];
          return <div key={step} className="settings-preference-row flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-medium text-slate-600">{index + 1}</span><div className="min-w-0"><p className="text-sm font-medium text-slate-800">{title}</p><p className="mt-0.5 text-xs text-slate-400">{totalTokens.toLocaleString()} tokens · {calls.length} AI calls</p></div></div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select aria-label={`${title} model`} value={config.stepConfigs[step]?.modelId ?? ''} onChange={event => updateStepModel(step, event.target.value)} className="h-10 min-w-52 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"><option value="">— {tr('Chọn model', 'Select model')} —</option>{enabledModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select>
              {step === 4 && <label className="flex items-center gap-2"><Gauge className="app-icon shrink-0 text-slate-400" aria-hidden="true" /><span className="sr-only">{tr('Giới hạn số từ tiếng Anh', 'English word limit')}</span><input aria-label={tr('Giới hạn số từ tiếng Anh', 'English word limit')} type="number" min={800} max={10000} step={100} value={Math.max(800, config.stepConfigs[4]?.maxDraftWords ?? config.stepConfigs[4]?.maxDraftCharacters ?? 1500)} onChange={event => updateDraftWordLimit(Number(event.target.value))} className="h-10 w-28 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700" /><span className="text-xs text-slate-400">words</span></label>}
            </div>
          </div>;
        })}
      </div>
    </section>
  </div>;
}
