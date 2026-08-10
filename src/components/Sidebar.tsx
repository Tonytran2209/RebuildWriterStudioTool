import { useState } from 'react';
import type { Article } from '../types';
import { STEP_LABELS } from '../lib/defaultData';
import { useI18n } from '../lib/i18n';

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-slate-300',
  in_progress: 'bg-amber-400',
  review: 'bg-blue-400',
  done: 'bg-emerald-500',
};

const STATUS_LABELS: Record<string, string> = {
  planning: 'Lên kế hoạch',
  in_progress: 'Đang viết',
  review: 'Đang review',
  done: 'Hoàn thành',
};

interface Props {
  articles: Article[];
  activeArticleId: string | null;
  onSelectArticle: (id: string) => void;
  onNewArticle: () => void;
  onOpenConfig: () => void;
  onToggleComplete: (article: Article) => void;
  completionSavingId: string | null;
  onDeleteArticle: (article: Article) => void;
  deletingArticleId: string | null;
}

export default function Sidebar({ articles, activeArticleId, onSelectArticle, onNewArticle, onOpenConfig, onToggleComplete, completionSavingId, onDeleteArticle, deletingArticleId }: Props) {
  const [search, setSearch] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const { language, toggleLanguage, tr } = useI18n();
  const statusLabels = language === 'vi' ? STATUS_LABELS : {
    planning: 'Planning', in_progress: 'Writing', review: 'Review', done: 'Completed',
  };
  const stepLabels = language === 'vi' ? STEP_LABELS : {
    1: 'Content Type', 2: 'Core Idea & Angle', 3: 'Draft Outline', 4: 'First Draft & Audit',
  };

  const filtered = articles.filter(article => {
    const displayTitle = article.topic?.trim() || article.title;
    return displayTitle.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <aside className="w-full md:w-72 bg-[#ebedf3] border-b md:border-b-0 md:border-r border-slate-200/80 p-3 flex flex-col shrink-0 h-auto md:h-full max-h-[52dvh] md:max-h-none">
      {/* Header */}
      <div className={`space-y-3 ${mobileOpen ? 'mb-4' : 'mb-0'} md:mb-4`}>
        <div className="flex items-center justify-between px-1 pt-1">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-xs">W</div>
            <span className="hidden min-[360px]:inline font-bold text-sm text-slate-800">Writer Studio</span>
          </div>
          <button
            onClick={onOpenConfig}
            title={tr('Cấu hình', 'Settings')}
            className="w-8 h-8 rounded-xl bg-white text-slate-500 hover:text-indigo-600 border border-slate-200/80 flex items-center justify-center transition-all shadow-sm"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={toggleLanguage}
            title={tr('Chuyển sang tiếng Anh', 'Switch to Vietnamese')}
            className="h-8 min-w-8 rounded-xl bg-white border border-slate-200/80 px-2 text-[10px] font-bold text-indigo-600 shadow-sm"
          >
            {language === 'vi' ? 'EN' : 'VI'}
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(open => !open)}
            className="md:hidden h-8 rounded-xl bg-white border border-slate-200/80 px-3 text-[11px] font-semibold text-slate-600 shadow-sm"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? tr('Thu gọn', 'Collapse') : `${tr('Bài viết', 'Articles')} (${articles.length})`}
          </button>
        </div>

        <button
          onClick={() => {
            onNewArticle();
            setMobileOpen(false);
          }}
          className={`${mobileOpen ? 'flex' : 'hidden'} md:flex w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs py-2.5 px-4 rounded-2xl shadow-sm transition-all items-center justify-center space-x-2`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          <span>{tr('Tạo bài viết mới', 'New article')}</span>
        </button>

        <div className={`${mobileOpen ? 'block' : 'hidden'} md:block relative`}>
          <svg className="w-3 h-3 absolute left-3 top-2.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tr('Tìm kiếm bài viết...', 'Search articles...')}
            className="w-full bg-white border border-slate-200/80 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-slate-800 transition-all placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Article list */}
      <div className={`${mobileOpen ? 'block' : 'hidden'} md:block flex-1 overflow-y-auto space-y-1.5 pr-0.5 min-h-0`}>
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-2">
          {tr('Bài viết', 'Articles')} ({filtered.length})
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-8 text-xs text-slate-400">
            {tr('Không tìm thấy bài viết', 'No articles found')}
          </div>
        )}

        {filtered.map(article => {
          const displayTitle = article.topic?.trim() || article.title;
          const isActive = activeArticleId === article.id;
          const isSavingCompletion = completionSavingId === article.id;
          const isDeleting = deletingArticleId === article.id;

          return (
            <div
              key={article.id}
              className={`w-full overflow-hidden rounded-2xl border transition-all ${
                isActive
                  ? 'bg-slate-900 border-slate-800 shadow-md'
                  : 'bg-white border-slate-200/80 shadow-sm hover:border-slate-300 hover:shadow'
              }`}
            >
              <button
                onClick={() => {
                  onSelectArticle(article.id);
                  setMobileOpen(false);
                }}
                className="w-full text-left p-3 space-y-1.5"
              >
                <div className="flex justify-between items-start gap-2">
                  <h4 className={`text-xs font-bold line-clamp-2 leading-snug ${isActive ? 'text-white' : 'text-slate-800'}`}>
                    {displayTitle}
                  </h4>
                  <span className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${STATUS_COLORS[article.status]}`} />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span className={`font-medium ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>
                    {tr('Bước', 'Step')} {article.currentStep}/4 — {stepLabels[article.currentStep]}
                  </span>
                  <span>{statusLabels[article.status]}</span>
                </div>
              </button>
              <div className={`flex items-center gap-2 border-t px-2.5 py-2 ${isActive ? 'border-slate-700' : 'border-slate-100'}`}>
                <button
                  type="button"
                  disabled={isSavingCompletion || isDeleting}
                  onClick={() => onToggleComplete(article)}
                  title={article.status === 'done' ? 'Mở lại bài viết' : 'Đánh dấu hoàn thành'}
                  aria-label={article.status === 'done' ? `Mở lại ${displayTitle}` : `Đánh dấu ${displayTitle} hoàn thành`}
                  className={`min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                    article.status === 'done'
                      ? 'bg-emerald-500 border-emerald-400 text-white hover:bg-emerald-600'
                      : isActive
                        ? 'bg-slate-800 border-slate-600 text-slate-200 hover:border-emerald-400 hover:text-white'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-emerald-400 hover:text-emerald-700'
                  }`}
                >
                  {isSavingCompletion ? tr('Đang lưu…', 'Saving…') : article.status === 'done' ? tr('✓ Mở lại', '✓ Reopen') : tr('○ Đánh dấu xong', '○ Mark complete')}
                </button>
                <button
                  type="button"
                  disabled={isDeleting || isSavingCompletion}
                  onClick={() => onDeleteArticle(article)}
              title={tr('Xoá bài viết khỏi Supabase', 'Delete article from Supabase')}
                  aria-label={`Xoá ${displayTitle} khỏi Supabase`}
                  className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                    isActive
                      ? 'bg-slate-800 border-slate-600 text-slate-300 hover:border-red-400 hover:text-red-300'
                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600'
                  }`}
                >
                  {isDeleting ? tr('Đang xoá…', 'Deleting…') : tr('Xoá', 'Delete')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer config button */}
      <div className={`${mobileOpen ? 'block' : 'hidden'} md:block pt-3 border-t border-slate-200/80 mt-3`}>
        <button
          onClick={onOpenConfig}
          className="w-full bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold py-2 px-3 rounded-xl transition-all border border-slate-200/80 flex items-center justify-between"
        >
          <div className="flex items-center space-x-2">
            <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
            </svg>
            <span>{tr('Cấu hình Model & Rules DB', 'Model & Rules DB settings')}</span>
          </div>
          <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
