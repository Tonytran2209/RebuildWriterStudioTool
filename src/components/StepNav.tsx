import { STEP_LABELS } from '../lib/defaultData';
import type { AIModel } from '../types';

type SyncStatus = 'idle' | 'loading' | 'saving' | 'error';

interface Props {
  currentStep: number;
  onStepChange: (step: number) => void;
  currentModel?: AIModel;
  syncStatus?: SyncStatus;
}

const STEP_ICONS = ['◐', '◑', '◒', '◓'];

const SYNC_INDICATOR: Record<string, { dot: string; label: string }> = {
  idle: { dot: 'bg-emerald-500', label: 'Đã lưu' },
  saving: { dot: 'bg-amber-400 animate-pulse', label: 'Đang lưu...' },
  error: { dot: 'bg-red-400', label: 'Lỗi lưu' },
  loading: { dot: 'bg-blue-400 animate-pulse', label: 'Đang tải...' },
};

export default function StepNav({ currentStep, onStepChange, currentModel, syncStatus = 'idle' }: Props) {
  const sync = SYNC_INDICATOR[syncStatus];
  return (
    <header className="bg-white border-b border-slate-200/80 px-2.5 md:px-5 py-2 md:py-3 flex items-center justify-between gap-2 shrink-0 shadow-sm z-10">
      {/* Step tabs */}
      <div className="bg-[#eaedf3] p-1 rounded-xl md:rounded-2xl flex items-center gap-0.5 md:space-x-1 shadow-sm min-w-0">
        {[1, 2, 3, 4].map(step => {
          const active = currentStep === step;
          return (
            <button
              key={step}
              onClick={() => onStepChange(step)}
              className={`px-1.5 sm:px-2 md:px-3.5 py-1.5 md:py-2 text-xs font-semibold rounded-lg md:rounded-xl transition-all flex items-center space-x-2 ${
                active
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold transition-all ${
                active ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500'
              }`}>
                {step}
              </span>
              <span className="hidden sm:block">{STEP_LABELS[step]}</span>
            </button>
          );
        })}
      </div>

      {/* Right status */}
      <div className="flex items-center gap-2 md:space-x-3 text-xs shrink-0">
        {currentModel && (
          <span className="hidden sm:flex bg-indigo-50 border border-indigo-100 text-indigo-700 font-medium px-2.5 py-1.5 rounded-xl items-center space-x-1.5 max-w-40">
            <svg className="w-3 h-3 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
            </svg>
            <span className="truncate">{currentModel.name}</span>
          </span>
        )}
        <div className="flex items-center space-x-1.5">
          <span className={`w-2 h-2 rounded-full ${sync.dot}`} />
          <span className="hidden min-[390px]:inline font-medium text-[11px] text-slate-500">{sync.label}</span>
        </div>
      </div>
    </header>
  );
}
