import { useState } from 'react';
import type { AppConfig, AIModel, AIProvider } from '../../types';
import { PROVIDER_LABELS } from '../../lib/defaultData';
import { useI18n } from '../../lib/i18n';

interface Props {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
}

const SPEED_LABELS = { fast: 'Nhanh', medium: 'Trung bình', slow: 'Chậm' };
const SPEED_COLORS = { fast: 'text-emerald-600', medium: 'text-amber-600', slow: 'text-slate-500' };

const API_KEY_NAMES: Record<AIProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  together: 'TOGETHER_API_KEY',
  groq: 'GROQ_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

export default function TabModels({ config, onChange }: Props) {
  const { language, tr } = useI18n();
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeyFor, setShowKeyFor] = useState<string | null>(null);

  const toggleModel = (modelId: string) => {
    onChange({
      ...config,
      models: config.models.map(m => m.id === modelId ? { ...m, enabled: !m.enabled } : m),
    });
  };

  const updatePricing = (modelId: string, field: 'inputUsdPerMillion' | 'cachedInputUsdPerMillion' | 'outputUsdPerMillion', value: string) => {
    const numberValue = Number(value);
    onChange({
      ...config,
      models: config.models.map(model => model.id === modelId ? {
        ...model,
        pricing: {
          ...model.pricing,
          inputUsdPerMillion: model.pricing?.inputUsdPerMillion ?? 0,
          outputUsdPerMillion: model.pricing?.outputUsdPerMillion ?? 0,
          [field]: Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : 0,
        },
      } : model),
    });
  };

  // Group by provider
  const byProvider: Record<string, AIModel[]> = {};
  config.models.forEach(m => {
    if (!byProvider[m.provider]) byProvider[m.provider] = [];
    byProvider[m.provider].push(m);
  });

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xs font-bold text-slate-800">{tr('Tích hợp & Kích hoạt Model AI', 'AI Model Integration & Activation')}</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">{tr('Bật/tắt Model để hiển thị trong menu phân quyền từng Step', 'Enable models for use in each step')}</p>
        </div>
      </div>

      {Object.entries(byProvider).map(([provider, models]) => {
        const provMeta = PROVIDER_LABELS[provider];
        const anyEnabled = models.some(m => m.enabled);
        return (
          <div key={provider} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            {/* Provider header */}
            <div className="flex items-center justify-between border-b border-slate-200/60 pb-2.5">
              <div className="flex items-center gap-2">
                <span className={`text-base ${provMeta?.color || 'text-slate-700'}`}>{provMeta?.icon}</span>
                <span className="text-xs font-bold text-slate-800">{provMeta?.label || provider}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${anyEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {anyEnabled ? 'Active' : 'Inactive'}
                </span>
                <button
                  onClick={() => setShowKeyFor(showKeyFor === provider ? null : provider)}
                  className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 border border-indigo-200 hover:border-indigo-400 px-2 py-0.5 rounded-md transition-all"
                >
                  {showKeyFor === provider ? tr('Ẩn', 'Hide') : 'API Key'}
                </button>
              </div>
            </div>

            {/* API key input */}
            {showKeyFor === provider && (
              <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                  {API_KEY_NAMES[provider as AIProvider]} (lưu trong Railway env)
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="password"
                    value={apiKeys[provider] || ''}
                    onChange={e => setApiKeys(k => ({ ...k, [provider]: e.target.value }))}
                    placeholder="sk-••••••••••••••••••••••••"
                    className="flex-1 font-mono bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-slate-800"
                  />
                  <button className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl transition-all">
                    {tr('Lưu vào Railway', 'Save to Railway')}
                  </button>
                </div>
                <p className="text-[10px] text-slate-400">{tr('API Key được mã hóa và lưu an toàn trong biến môi trường Railway.', 'API keys are encrypted and stored in Railway environment variables.')}</p>
              </div>
            )}

            {/* Models grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {models.map(model => (
                <div key={model.id} className="flex items-start justify-between bg-white p-3 rounded-xl border border-slate-200 gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <h4 className="text-xs font-bold text-slate-800 truncate">{model.name}</h4>
                      {model.enabled && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 leading-snug">{language === 'vi' ? model.description : `${model.name} for Step-based AI content workflows.`}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{model.contextWindow}</span>
                      <span className={`text-[10px] font-semibold ${SPEED_COLORS[model.speed]}`}>{language === 'vi' ? SPEED_LABELS[model.speed] : ({ fast: 'Fast', medium: 'Medium', slow: 'Slow' } as const)[model.speed]}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 mt-2">
                      <label className="text-[9px] text-slate-500">
                        Input $/1M
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={model.pricing?.inputUsdPerMillion ?? ''}
                          onChange={event => updatePricing(model.id, 'inputUsdPerMillion', event.target.value)}
                          placeholder="N/A"
                          className="mt-0.5 w-full rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 font-mono text-[9px] outline-none"
                        />
                      </label>
                      <label className="text-[9px] text-slate-500">
                        Cache $/1M
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={model.pricing?.cachedInputUsdPerMillion ?? ''}
                          onChange={event => updatePricing(model.id, 'cachedInputUsdPerMillion', event.target.value)}
                          placeholder="= input"
                          className="mt-0.5 w-full rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 font-mono text-[9px] outline-none"
                        />
                      </label>
                      <label className="text-[9px] text-slate-500">
                        Output $/1M
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={model.pricing?.outputUsdPerMillion ?? ''}
                          onChange={event => updatePricing(model.id, 'outputUsdPerMillion', event.target.value)}
                          placeholder="N/A"
                          className="mt-0.5 w-full rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 font-mono text-[9px] outline-none"
                        />
                      </label>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      checked={model.enabled}
                      onChange={() => toggleModel(model.id)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate-900" />
                  </label>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
