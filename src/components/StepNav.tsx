import { useState } from 'react';
import type { AICallUsage, AIModel } from '../types';
import { Monitor } from 'lucide-react';
import { useI18n } from '../lib/i18n';

type SyncStatus = 'idle' | 'loading' | 'saving' | 'error';

interface Props {
  currentStep: number;
  onStepChange: (step: number) => void;
  currentModel?: AIModel;
  syncStatus?: SyncStatus;
  usage?: AICallUsage[];
}

const SYNC_INDICATOR: Record<string, { dot: string; label: string }> = {
  idle: { dot: 'bg-emerald-500', label: 'Đã lưu' },
  saving: { dot: 'bg-amber-400 animate-pulse', label: 'Đang lưu...' },
  error: { dot: 'bg-red-400', label: 'Lỗi lưu' },
  loading: { dot: 'bg-blue-400 animate-pulse', label: 'Đang tải...' },
};

export default function StepNav({ currentStep, onStepChange, currentModel, syncStatus = 'idle', usage = [] }: Props) {
  const sync = SYNC_INDICATOR[syncStatus];
  const latestUsage = usage.at(-1);
  const { language, tr } = useI18n();
  const [showUsage, setShowUsage] = useState(false);
  const workflowSteps = [
    { storageStep: 2, label: tr('Ý tưởng cốt lõi & Góc tiếp cận', 'Core Idea & Angle') },
    { storageStep: 3, label: tr('Dàn bài nháp', 'Draft Outline') },
    { storageStep: 4, label: tr('Bản nháp & Kiểm tra', 'First Draft & Audit') },
  ];
  return (
    <header className="minimal-step-nav relative bg-white border-b border-slate-200/80 px-2.5 md:px-5 py-2 md:py-3 flex items-center justify-between gap-2 shrink-0 z-10">
      {/* Step tabs */}
      <div className="bg-[#eaedf3] p-1 rounded-xl md:rounded-2xl flex items-center gap-0.5 md:space-x-1 shadow-sm min-w-0">
        {workflowSteps.map(({ storageStep, label }, index) => {
          const active = currentStep === storageStep;
          return (
            <button
              key={storageStep}
              onClick={() => onStepChange(storageStep)}
              className={`px-1.5 sm:px-2 md:px-3.5 py-1.5 md:py-2 text-xs font-semibold rounded-lg md:rounded-xl transition-all flex items-center space-x-2 ${
                active
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold transition-all ${
                active ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500'
              }`}>
                {index + 1}
              </span>
              <span className="hidden sm:block">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Right status */}
      <div className="flex items-center gap-2 md:space-x-3 text-xs shrink-0">
        {latestUsage && (
          <button
            type="button"
            onClick={() => setShowUsage(value => !value)}
            className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 px-1.5 sm:px-2.5 py-1 text-[8px] sm:text-[9px] leading-tight text-slate-500"
            title={`Input: ${latestUsage.inputTokens.toLocaleString()} · Output: ${latestUsage.outputTokens.toLocaleString()} · ${latestUsage.costUsd == null ? tr('Chưa cấu hình đơn giá', 'Pricing not configured') : `$${latestUsage.costUsd.toFixed(6)}`}`}
          >
            <span className="font-bold text-slate-700">{latestUsage.totalTokens.toLocaleString()} tokens</span>
            <span>{latestUsage.costUsd == null ? 'USD: N/A' : `$${latestUsage.costUsd.toFixed(6)}`} {latestUsage.cacheHit ? '· cache' : ''}</span>
          </button>
        )}
        {currentModel && (
          <span className="app-model-tag hidden max-w-40 items-center space-x-1.5 rounded-lg border px-2.5 py-1.5 font-medium sm:flex">
            <Monitor className="app-icon" aria-hidden="true" />
            <span className="truncate">{currentModel.name}</span>
          </span>
        )}
        <div className="flex items-center space-x-1.5">
          <span className={`w-2 h-2 rounded-full ${sync.dot}`} />
          <span className="hidden min-[390px]:inline font-medium text-[11px] text-slate-500">{sync.label}</span>
        </div>
      </div>
      {showUsage && usage.length > 0 && (
        <div className="absolute right-2 top-full mt-1 w-[min(22rem,calc(100vw-1rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl z-30">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-800">{tr(`Chi phí API — Bước ${Math.max(1, currentStep - 1)}`, `API usage — Step ${Math.max(1, currentStep - 1)}`)}</span>
            <span className="text-[9px] text-slate-400">{usage.length} calls</span>
          </div>
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {[...usage].reverse().map(item => (
              <div key={item.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl bg-slate-50 px-2.5 py-2 text-[10px]">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-slate-700">{item.model}</div>
                  <div className="text-slate-400">In {item.inputTokens.toLocaleString()}{item.cachedInputTokens ? ` (${item.cachedInputTokens.toLocaleString()} cached)` : ''} · Out {item.outputTokens.toLocaleString()} · Total {item.totalTokens.toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-slate-700">{item.costUsd == null ? 'N/A' : `$${item.costUsd.toFixed(6)}`}</div>
                  <div className="text-[9px] text-slate-400">{item.cacheHit ? 'cache · $0' : new Date(item.calledAt).toLocaleTimeString(language === 'vi' ? 'vi-VN' : 'en-US')}</div>
                </div>
              </div>
            ))}
          </div>
          {usage.some(item => item.costUsd == null) && (
            <p className="mt-2 text-[9px] leading-relaxed text-amber-600">{tr('N/A: model chưa được cấu hình đơn giá input/output trong Quản lý AI Models.', 'N/A: configure input/output pricing for this model in AI Model management.')}</p>
          )}
        </div>
      )}
    </header>
  );
}
