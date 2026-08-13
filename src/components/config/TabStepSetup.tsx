import { useState, useEffect } from 'react';
import type { AppConfig, DocumentFile } from '../../types';
import { STEP_LABELS } from '../../lib/defaultData';
import { pingRailway } from '../../lib/db';
import { isActionSourceReady, isDocumentReady } from '../../lib/documentStatus';
import { useI18n } from '../../lib/i18n';

interface Props {
  config: AppConfig;
  files: DocumentFile[];
  onChange: (config: AppConfig) => void;
}

const CATEGORY_META = {
  kb:     { label: 'Knowledge Base',     color: 'text-indigo-600',  border: 'border-indigo-100',  bg: 'bg-indigo-50/40' },
  action: { label: 'Action Plan',        color: 'text-emerald-600', border: 'border-emerald-100', bg: 'bg-emerald-50/40' },
  rules:  { label: 'Rules & Guidelines', color: 'text-amber-600',   border: 'border-amber-100',   bg: 'bg-amber-50/40' },
};

const RAILWAY_URL = 'https://rebuildwriterstudiotool-production.up.railway.app';

const PROVIDER_META: Record<string, { icon: string; name: string; color: string }> = {
  anthropic: { icon: '◆', name: 'Anthropic', color: 'text-violet-600' },
  openai:    { icon: '⬡', name: 'OpenAI',    color: 'text-emerald-600' },
  google:    { icon: '◉', name: 'Google',    color: 'text-blue-600' },
  mistral:   { icon: '▲', name: 'Mistral',   color: 'text-orange-600' },
  groq:      { icon: '⚡', name: 'Groq',     color: 'text-amber-600' },
};

export default function TabStepSetup({ config, files, onChange }: Props) {
  const { language, tr } = useI18n();
  const [providers, setProviders] = useState<Record<string, boolean> | null>(null);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [seoResearchOk, setSeoResearchOk] = useState<boolean | null>(null);
  const enabledModels = config.models.filter(m => m.enabled);
  const actionSources = config.actionSources ?? [];
  const invalidDocumentCount = files.filter(file => !isDocumentReady(file)).length;
  const invalidActionCount = actionSources.filter(source => !isActionSourceReady(source)).length;

  useEffect(() => {
    pingRailway(RAILWAY_URL).then(result => {
      setBackendOk(result.ok);
      setSeoResearchOk(result.ok ? Boolean(result.seoResearch) : null);
      if (result.ok) setProviders(result.providers ?? null);
    });
  }, []);

  const updateStepModel = (step: number, modelId: string) => {
    onChange({
      ...config,
      stepConfigs: {
        ...config.stepConfigs,
        [step]: { ...config.stepConfigs[step], modelId },
      },
    });
  };

  const toggleItem = (step: number, category: 'kb' | 'action' | 'rules', itemId: string) => {
    const current = config.stepConfigs[step]?.fileAccess?.[category] ?? [];
    const updated = current.includes(itemId)
      ? current.filter(id => id !== itemId)
      : [...current, itemId];
    onChange({
      ...config,
      stepConfigs: {
        ...config.stepConfigs,
        [step]: {
          ...config.stepConfigs[step],
          fileAccess: { ...config.stepConfigs[step]?.fileAccess, [category]: updated },
        },
      },
    });
  };

  const updatePromptRule = (step: number, category: 'kb' | 'action' | 'rules', rule: string) => {
    const stepConfig = config.stepConfigs[step] ?? { modelId: '', fileAccess: { kb: [], action: [], rules: [] } };
    onChange({
      ...config,
      stepConfigs: {
        ...config.stepConfigs,
        [step]: {
          ...stepConfig,
          categoryPromptRules: {
            ...stepConfig.categoryPromptRules,
            [category]: rule,
          },
        },
      },
    });
  };

  const getPromptRule = (step: number, category: 'kb' | 'action' | 'rules') => {
    const stepConfig = config.stepConfigs[step];
    const current = stepConfig?.categoryPromptRules?.[category];
    if (current !== undefined) return current;
    return Object.values(stepConfig?.documentPromptRules?.[category] ?? {})
      .map(rule => rule.trim())
      .filter(Boolean)
      .filter((rule, index, rules) => rules.indexOf(rule) === index)
      .join('\n\n');
  };

  return (
    <div className="space-y-4">
      {/* Backend status bar */}
      <div className={`rounded-2xl p-3.5 flex items-center gap-3 border ${
        backendOk === null  ? 'bg-slate-50 border-slate-200' :
        backendOk           ? 'bg-emerald-50 border-emerald-200' :
                              'bg-red-50 border-red-200'
      }`}>
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
          backendOk === null ? 'bg-slate-300 animate-pulse' :
          backendOk          ? 'bg-emerald-500' : 'bg-red-500'
        }`} />
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-bold ${
            backendOk === null ? 'text-slate-500' :
            backendOk          ? 'text-emerald-800' : 'text-red-700'
          }`}>
            {backendOk === null ? tr('Đang kiểm tra kết nối AI backend...', 'Checking AI backend...') :
             backendOk          ? tr('AI Backend đang hoạt động', 'AI Backend is online') :
                                  tr('Không kết nối được AI backend', 'Cannot connect to AI backend')}
          </p>
          <p className="text-[10px] text-slate-400 font-mono truncate">{RAILWAY_URL}</p>
        </div>
        {backendOk && providers && (
          <div className="flex items-center gap-1.5 shrink-0">
            {Object.entries(PROVIDER_META).map(([id, meta]) => {
              const active = providers[id] ?? false;
              return (
                <span key={id} title={`${meta.name}: ${active ? 'Sẵn sàng' : 'Chưa có API key'}`}
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border ${
                    active ? `bg-white border-slate-200 ${meta.color}` : 'bg-slate-100 border-transparent text-slate-300'
                  }`}>
                  {meta.icon}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {backendOk && seoResearchOk === false && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <b>OpenAI Web Search chưa sẵn sàng:</b> Step 2 cần <code>OPENAI_API_KEY</code> đang dùng cho OpenAI provider.
        </div>
      )}

      {/* Info */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-3.5 flex items-start gap-2.5">
        <svg className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-indigo-900">
          {tr('Mỗi Step có thể dùng một ', 'Each step can use its own ')}<strong>AI Model</strong>{tr(' và được cấp quyền đọc tài liệu cụ thể từ 3 kho KB / Action Plan / Rules. Mỗi phân vùng có một prompting rule chung áp dụng cho toàn bộ tài liệu được chọn trong phân vùng đó.', ' and receive access to specific documents from KB / Action Plan / Rules. Each category has one shared prompting rule for all selected documents in that category.')}
        </p>
      </div>

      {enabledModels.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-[11px] text-amber-800 flex items-center gap-2">
          <span>⚠️</span>
          <span>{tr('Chưa có model nào được bật. Vào tab Quản lý AI Models để kích hoạt.', 'No models are enabled. Open AI Model management to activate one.')}</span>
        </div>
      )}

      {(invalidDocumentCount > 0 || invalidActionCount > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-[11px] text-red-800 flex items-start gap-2">
          <span>⚠️</span>
          <span>
            Có {invalidDocumentCount + invalidActionCount} bản ghi chỉ có tên file nhưng không có nội dung trong Supabase.
            Các mục này đã bị vô hiệu hóa và sẽ không được cấp cho AI. Hãy xóa rồi tải lại file.
          </span>
        </div>
      )}

      {/* Step cards */}
      {[1, 2, 3, 4].map(step => {
        const stepCfg = config.stepConfigs[step] ?? { modelId: '', fileAccess: { kb: [], action: [], rules: [] } };
        const kbFiles    = files.filter(f => f.category === 'kb');
        const rulesFiles = files.filter(f => f.category === 'rules');

        return (
          <div key={step} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/70 pb-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">{step}</span>
                <span className="text-xs font-bold text-slate-800">{tr('Bước', 'Step')} {step}: {language === 'vi' ? STEP_LABELS[step] : ({ 1: 'Content Type', 2: 'Core Idea & Angle', 3: 'Draft Outline', 4: 'First Draft & Audit' } as Record<number, string>)[step]}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 font-medium">AI Model:</span>
                <select
                  value={stepCfg.modelId}
                  onChange={e => updateStepModel(step, e.target.value)}
                  className="min-w-0 flex-1 bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 font-semibold outline-none focus:ring-2 focus:ring-slate-800 transition-all"
                >
                  <option value="">— {tr('Chọn model', 'Select model')} —</option>
                  {enabledModels.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{tr('Tài liệu được cấp phép:', 'Authorized documents:')}</span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">

                {/* KB */}
                <div className={`p-3 rounded-xl border ${CATEGORY_META.kb.border} ${CATEGORY_META.kb.bg} space-y-1.5`}>
                  <span className={`text-[10px] font-bold block border-b border-current/20 pb-1 ${CATEGORY_META.kb.color}`}>Knowledge Base</span>
                  {kbFiles.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic">{tr('Chưa có file', 'No files')}</p>
                  ) : kbFiles.map(f => {
                    const selected = stepCfg.fileAccess?.kb ?? [];
                    const ready = isDocumentReady(f);
                    return (
                        <label key={f.id} className={`flex items-center gap-1.5 ${ready ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                          <input type="checkbox" checked={ready && selected.includes(f.id)} disabled={!ready} onChange={() => toggleItem(step, 'kb', f.id)} className="rounded border-slate-300 text-slate-900 focus:ring-slate-800 w-3 h-3" />
                          <span className="text-[10px] text-slate-700 truncate">{f.name}</span>
                          {!ready && <span className="text-[8px] font-bold text-red-600 shrink-0">{tr('THIẾU DỮ LIỆU', 'MISSING DATA')}</span>}
                        </label>
                    );
                  })}
                  <textarea value={getPromptRule(step, 'kb')} onChange={e => updatePromptRule(step, 'kb', e.target.value)} rows={3} placeholder={tr('Rule chung để AI đọc và sử dụng toàn bộ Knowledge Base…', 'Shared rule for reading and using all Knowledge Base documents…')} aria-label={tr('Prompting rule cho Knowledge Base', 'Prompting rule for Knowledge Base')} className="w-full resize-y rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-[10px] text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>

                {/* Action Plan — dùng actionSources từ config */}
                <div className={`p-3 rounded-xl border ${CATEGORY_META.action.border} ${CATEGORY_META.action.bg} space-y-1.5`}>
                  <span className={`text-[10px] font-bold block border-b border-current/20 pb-1 ${CATEGORY_META.action.color}`}>Action Plan</span>
                  {actionSources.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic">{tr('Chưa có nguồn dữ liệu', 'No data sources')}</p>
                  ) : actionSources.map(s => {
                    const selected = stepCfg.fileAccess?.action ?? [];
                    const ready = isActionSourceReady(s);
                    const icons: Record<string, string> = {
                      file: '📁', paste: '📋', url: '🔗', gsheet: '📊', manual: '✏️', supabase: '🗄️', airtable: '🔌',
                    };
                    return (
                        <label key={s.id} className={`flex items-center gap-1.5 ${ready ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                          <input type="checkbox" checked={ready && selected.includes(s.id)} disabled={!ready} onChange={() => toggleItem(step, 'action', s.id)} className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-3 h-3" />
                          <span className="text-[9px] shrink-0">{icons[s.sourceType] ?? '📄'}</span>
                          <span className="text-[10px] text-slate-700 truncate">{s.name}</span>
                          {!ready && <span className="text-[8px] font-bold text-red-600 shrink-0">{tr('THIẾU DỮ LIỆU', 'MISSING DATA')}</span>}
                        </label>
                    );
                  })}
                  <textarea value={getPromptRule(step, 'action')} onChange={e => updatePromptRule(step, 'action', e.target.value)} rows={3} placeholder={tr('Rule chung để AI đọc và sử dụng toàn bộ Action Plan…', 'Shared rule for reading and using all Action Plan documents…')} aria-label={tr('Prompting rule cho Action Plan', 'Prompting rule for Action Plan')} className="w-full resize-y rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-[10px] text-slate-700 outline-none focus:ring-2 focus:ring-emerald-300" />
                </div>

                {/* Rules */}
                <div className={`p-3 rounded-xl border ${CATEGORY_META.rules.border} ${CATEGORY_META.rules.bg} space-y-1.5`}>
                  <span className={`text-[10px] font-bold block border-b border-current/20 pb-1 ${CATEGORY_META.rules.color}`}>Rules & Guidelines</span>
                  {rulesFiles.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic">{tr('Chưa có file', 'No files')}</p>
                  ) : rulesFiles.map(f => {
                    const selected = stepCfg.fileAccess?.rules ?? [];
                    const ready = isDocumentReady(f);
                    return (
                        <label key={f.id} className={`flex items-center gap-1.5 ${ready ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                          <input type="checkbox" checked={ready && selected.includes(f.id)} disabled={!ready} onChange={() => toggleItem(step, 'rules', f.id)} className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 w-3 h-3" />
                          <span className="text-[10px] text-slate-700 truncate">{f.name}</span>
                          {!ready && <span className="text-[8px] font-bold text-red-600 shrink-0">{tr('THIẾU DỮ LIỆU', 'MISSING DATA')}</span>}
                        </label>
                    );
                  })}
                  <textarea value={getPromptRule(step, 'rules')} onChange={e => updatePromptRule(step, 'rules', e.target.value)} rows={3} placeholder={tr('Rule chung để AI đọc và áp dụng toàn bộ Rules…', 'Shared rule for reading and applying all Rules documents…')} aria-label={tr('Prompting rule cho Rules', 'Prompting rule for Rules')} className="w-full resize-y rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-[10px] text-slate-700 outline-none focus:ring-2 focus:ring-amber-300" />
                </div>

              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
