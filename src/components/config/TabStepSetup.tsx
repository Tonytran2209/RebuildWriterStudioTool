import { useState, useEffect } from 'react';
import type { AppConfig, DocumentFile } from '../../types';
import { STEP_LABELS } from '../../lib/defaultData';
import { pingRailway } from '../../lib/db';
import { isActionSourceReady, isDocumentReady } from '../../lib/documentStatus';

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
  const [providers, setProviders] = useState<Record<string, boolean> | null>(null);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const enabledModels = config.models.filter(m => m.enabled);
  const actionSources = config.actionSources ?? [];
  const invalidDocumentCount = files.filter(file => !isDocumentReady(file)).length;
  const invalidActionCount = actionSources.filter(source => !isActionSourceReady(source)).length;

  useEffect(() => {
    pingRailway(RAILWAY_URL).then(result => {
      setBackendOk(result.ok);
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
            {backendOk === null ? 'Đang kiểm tra kết nối AI backend...' :
             backendOk          ? 'AI Backend đang hoạt động' :
                                  'Không kết nối được AI backend'}
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

      {/* Info */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-3.5 flex items-start gap-2.5">
        <svg className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-indigo-900">
          Mỗi Step có thể dùng một <strong>AI Model riêng</strong> và được cấp quyền đọc <strong>tài liệu cụ thể</strong> từ 3 kho KB / Action Plan / Rules.
          Bật models ở tab <em>Quản lý AI Models</em> trước.
        </p>
      </div>

      {enabledModels.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-[11px] text-amber-800 flex items-center gap-2">
          <span>⚠️</span>
          <span>Chưa có model nào được bật. Vào tab <strong>Quản lý AI Models</strong> để kích hoạt.</span>
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
            <div className="flex items-center justify-between border-b border-slate-200/70 pb-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">{step}</span>
                <span className="text-xs font-bold text-slate-800">Step {step}: {STEP_LABELS[step]}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 font-medium">AI Model:</span>
                <select
                  value={stepCfg.modelId}
                  onChange={e => updateStepModel(step, e.target.value)}
                  className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 font-semibold outline-none focus:ring-2 focus:ring-slate-800 transition-all"
                >
                  <option value="">— Chọn model —</option>
                  {enabledModels.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tài liệu được cấp phép:</span>
              <div className="grid grid-cols-3 gap-2 mt-2">

                {/* KB */}
                <div className={`p-3 rounded-xl border ${CATEGORY_META.kb.border} ${CATEGORY_META.kb.bg} space-y-1.5`}>
                  <span className={`text-[10px] font-bold block border-b border-current/20 pb-1 ${CATEGORY_META.kb.color}`}>Knowledge Base</span>
                  {kbFiles.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic">Chưa có file</p>
                  ) : kbFiles.map(f => {
                    const selected = stepCfg.fileAccess?.kb ?? [];
                    const ready = isDocumentReady(f);
                    return (
                      <label key={f.id} className={`flex items-center gap-1.5 ${ready ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                        <input type="checkbox" checked={ready && selected.includes(f.id)} disabled={!ready}
                          onChange={() => toggleItem(step, 'kb', f.id)}
                          className="rounded border-slate-300 text-slate-900 focus:ring-slate-800 w-3 h-3" />
                        <span className="text-[10px] text-slate-700 truncate">{f.name}</span>
                        {!ready && <span className="text-[8px] font-bold text-red-600 shrink-0">THIẾU DỮ LIỆU</span>}
                      </label>
                    );
                  })}
                </div>

                {/* Action Plan — dùng actionSources từ config */}
                <div className={`p-3 rounded-xl border ${CATEGORY_META.action.border} ${CATEGORY_META.action.bg} space-y-1.5`}>
                  <span className={`text-[10px] font-bold block border-b border-current/20 pb-1 ${CATEGORY_META.action.color}`}>Action Plan</span>
                  {actionSources.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic">Chưa có nguồn dữ liệu</p>
                  ) : actionSources.map(s => {
                    const selected = stepCfg.fileAccess?.action ?? [];
                    const ready = isActionSourceReady(s);
                    const icons: Record<string, string> = {
                      file: '📁', paste: '📋', url: '🔗', gsheet: '📊', manual: '✏️', supabase: '🗄️', airtable: '🔌',
                    };
                    return (
                      <label key={s.id} className={`flex items-center gap-1.5 ${ready ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                        <input type="checkbox" checked={ready && selected.includes(s.id)} disabled={!ready}
                          onChange={() => toggleItem(step, 'action', s.id)}
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-3 h-3" />
                        <span className="text-[9px] shrink-0">{icons[s.sourceType] ?? '📄'}</span>
                        <span className="text-[10px] text-slate-700 truncate">{s.name}</span>
                        {!ready && <span className="text-[8px] font-bold text-red-600 shrink-0">THIẾU DỮ LIỆU</span>}
                      </label>
                    );
                  })}
                </div>

                {/* Rules */}
                <div className={`p-3 rounded-xl border ${CATEGORY_META.rules.border} ${CATEGORY_META.rules.bg} space-y-1.5`}>
                  <span className={`text-[10px] font-bold block border-b border-current/20 pb-1 ${CATEGORY_META.rules.color}`}>Rules & Guidelines</span>
                  {rulesFiles.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic">Chưa có file</p>
                  ) : rulesFiles.map(f => {
                    const selected = stepCfg.fileAccess?.rules ?? [];
                    const ready = isDocumentReady(f);
                    return (
                      <label key={f.id} className={`flex items-center gap-1.5 ${ready ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                        <input type="checkbox" checked={ready && selected.includes(f.id)} disabled={!ready}
                          onChange={() => toggleItem(step, 'rules', f.id)}
                          className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 w-3 h-3" />
                        <span className="text-[10px] text-slate-700 truncate">{f.name}</span>
                        {!ready && <span className="text-[8px] font-bold text-red-600 shrink-0">THIẾU DỮ LIỆU</span>}
                      </label>
                    );
                  })}
                </div>

              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
