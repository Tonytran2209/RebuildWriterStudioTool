import type { AIModel } from '../types';
import { Monitor } from 'lucide-react';
import { useI18n } from '../lib/i18n';

type SyncStatus = 'idle' | 'loading' | 'saving' | 'error';

interface Props {
  currentStep: number;
  onStepChange: (step: number) => void;
  currentModel?: AIModel;
  syncStatus?: SyncStatus;
  canAccessStep?: (step: 2 | 3 | 4) => { allowed: boolean; reason: string };
  articleTitle?: string;
}

const SYNC_INDICATOR: Record<string, { dot: string; label: string }> = {
  idle: { dot: 'bg-emerald-500', label: 'Đã lưu' },
  saving: { dot: 'bg-amber-400 animate-pulse', label: 'Đang lưu...' },
  error: { dot: 'bg-red-400', label: 'Lỗi lưu' },
  loading: { dot: 'bg-blue-400 animate-pulse', label: 'Đang tải...' },
};

export default function StepNav({ currentModel, syncStatus = 'idle', articleTitle }: Props) {
  const sync = SYNC_INDICATOR[syncStatus];
  const { tr } = useI18n();
  return (
    <header className="minimal-step-nav relative bg-white border-b border-slate-200/80 px-2.5 md:px-5 py-2 md:py-3 flex items-center justify-between gap-2 shrink-0 z-10">
      <section className="article-header-title min-w-0">
        <div className="truncate text-sm font-medium text-slate-800">{articleTitle || tr('Bài viết mới', 'New article')}</div>
        <div className="text-[10px] text-slate-400">{tr('Article workspace', 'Article workspace')}</div>
      </section>

      {/* Right status */}
      <div className="flex items-center gap-2 md:space-x-3 text-xs shrink-0">
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
    </header>
  );
}
