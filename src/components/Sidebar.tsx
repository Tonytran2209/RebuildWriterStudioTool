import { useState } from 'react';
import type { Article } from '../types';
import { STEP_LABELS } from '../lib/defaultData';

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
}

export default function Sidebar({ articles, activeArticleId, onSelectArticle, onNewArticle, onOpenConfig }: Props) {
  const [search, setSearch] = useState('');

  const filtered = articles.filter(a =>
    a.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <aside className="w-72 bg-[#ebedf3] border-r border-slate-200/80 p-3 flex flex-col shrink-0 h-full">
      {/* Header */}
      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between px-1 pt-1">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-xs">W</div>
            <span className="font-bold text-sm text-slate-800">Writer Studio</span>
          </div>
          <button
            onClick={onOpenConfig}
            title="Cấu hình"
            className="w-8 h-8 rounded-xl bg-white text-slate-500 hover:text-indigo-600 border border-slate-200/80 flex items-center justify-center transition-all shadow-sm"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </button>
        </div>

        <button
          onClick={onNewArticle}
          className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs py-2.5 px-4 rounded-2xl shadow-sm transition-all flex items-center justify-center space-x-2"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          <span>Tạo bài viết mới</span>
        </button>

        <div className="relative">
          <svg className="w-3 h-3 absolute left-3 top-2.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm kiếm bài viết..."
            className="w-full bg-white border border-slate-200/80 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-slate-800 transition-all placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Article list */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-2">
          Bài viết ({filtered.length})
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-8 text-xs text-slate-400">
            Không tìm thấy bài viết
          </div>
        )}

        {filtered.map(article => (
          <button
            key={article.id}
            onClick={() => onSelectArticle(article.id)}
            className={`w-full text-left rounded-2xl p-3 border transition-all space-y-1.5 ${
              activeArticleId === article.id
                ? 'bg-slate-900 border-slate-800 shadow-md'
                : 'bg-white border-slate-200/80 shadow-sm hover:border-slate-300 hover:shadow'
            }`}
          >
            <div className="flex justify-between items-start gap-2">
              <h4 className={`text-xs font-bold line-clamp-2 leading-snug ${activeArticleId === article.id ? 'text-white' : 'text-slate-800'}`}>
                {article.title}
              </h4>
              <span className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${STATUS_COLORS[article.status]}`} />
            </div>
            <div className={`flex items-center justify-between text-[10px] ${activeArticleId === article.id ? 'text-slate-400' : 'text-slate-400'}`}>
              <span className={`font-medium ${activeArticleId === article.id ? 'text-slate-300' : 'text-slate-500'}`}>
                Step {article.currentStep}/4 — {STEP_LABELS[article.currentStep]}
              </span>
              <span>{STATUS_LABELS[article.status]}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Footer config button */}
      <div className="pt-3 border-t border-slate-200/80 mt-3">
        <button
          onClick={onOpenConfig}
          className="w-full bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold py-2 px-3 rounded-xl transition-all border border-slate-200/80 flex items-center justify-between"
        >
          <div className="flex items-center space-x-2">
            <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
            </svg>
            <span>Cấu hình Model & Rules DB</span>
          </div>
          <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
