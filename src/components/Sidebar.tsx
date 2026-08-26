import { useState } from "react"
import { ChevronDown, Clock3, FileText, Globe2, Menu, PenLine, PlusCircle, Search, Settings, Trash2 } from "lucide-react"
import type { Article } from "../types"
import { useI18n } from "../lib/i18n"
import BrandMark from "./BrandMark"

interface Props {
  articles: Article[]
  activeArticleId: string | null
  onSelectArticle: (id: string) => void
  onNewArticle: () => void
  onOpenContentPlans?: () => void
  onOpenConfig: () => void
  onToggleComplete: (article: Article) => void
  completionSavingId: string | null
  onDeleteArticle: (article: Article) => void
  deletingArticleId: string | null
}
export default function Sidebar({
  articles,
  activeArticleId,
  onSelectArticle,
  onNewArticle,
  onOpenContentPlans,
  onOpenConfig,
  onDeleteArticle,
  deletingArticleId,
}: Props) {
  const { language, toggleLanguage, tr } = useI18n()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const recent = articles
    .filter((article) =>
      (article.topic || article.title)
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .slice(0, 12)
  return (
    <aside
      className={`writer-sidebar ${
        open ? "max-md:h-[65dvh]" : "max-md:h-14"
      } w-full md:w-[252px] shrink-0 overflow-hidden border-b md:border-b-0 md:border-r border-[#2b2b2b] bg-[#202020] text-[#c8c8c8] transition-all flex flex-col`}
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <button onClick={onNewArticle} className="flex items-center gap-2 text-sm font-semibold text-[#e7e7e7]">
          <BrandMark />
          Writer Studio
        </button>
        <div className="flex gap-1">
          <button
            onClick={() => setSearch((value) => (value ? "" : value))}
            className="sidebar-icon-button"
            aria-label={tr("Tìm kiếm", "Search")}
          >
            <Search className="app-icon" aria-hidden="true" />
          </button>
          <button
            onClick={() => setOpen((value) => !value)}
            className="sidebar-icon-button md:hidden"
            aria-label={tr("Mở menu", "Open menu")}
          >
            <Menu className="app-icon" aria-hidden="true" />
          </button>
        </div>
      </div>
      <nav className="space-y-1 px-2 py-2 text-[13px] font-medium">
        <button onClick={onNewArticle} className="sidebar-nav">
          <PenLine className="app-icon" aria-hidden="true" />
          {tr("Activity mới", "New activity")}
          <PlusCircle className="app-icon ml-auto text-[#777]" aria-hidden="true" />
        </button>
        <button
          onClick={onOpenContentPlans ?? onNewArticle}
          className="sidebar-nav"
        >
          <FileText className="app-icon" aria-hidden="true" />Content Plan history
        </button>
        <button onClick={() => setOpen(true)} className="sidebar-nav">
          <Clock3 className="app-icon" aria-hidden="true" />
          {tr("Bài đã tạo", "Recents")}
        </button>
      </nav>
      <div className="mx-3 my-2 h-px bg-[#2c2c2c]" />
      <div className="px-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#777]">Recents</div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={tr("Tìm bài viết…", "Search articles…")}
          className="mt-2 w-full rounded-lg border border-[#333] bg-[#191919] px-2.5 py-2 text-[11px] text-[#ddd] outline-none placeholder:text-[#666]"
        />
      </div>
      <div className="sidebar-recent-list mt-2 flex-1 space-y-1.5 overflow-y-auto px-2 pb-3">
        {recent.map((article) => {
          const active = article.id === activeArticleId
          return (
            <div
              key={article.id}
              className={`sidebar-recent-card group relative rounded-lg border ${
                active
                  ? "border-[#d3d3cf] bg-[#e4e4e1]"
                  : "border-transparent hover:border-[#deded9] hover:bg-[#e8e8e5]"
              }`}
            >
              <button
                onClick={() => onSelectArticle(article.id)}
                className="w-full px-2.5 py-2.5 pr-9 text-left"
              >
                <div
                  className={`truncate text-[12.5px] leading-4 ${
                    active ? "font-semibold text-[#242422]" : "font-medium text-[#444440]"
                  }`}
                >
                  {article.topic || article.title}
                </div>
                <div className="mt-1 text-[10px] font-normal leading-3.5 text-[#888882]">
                  {article.contentPlanVersion
                    ? `Content Plan v${article.contentPlanVersion} · `
                    : ""}
                  {article.batchStatus ?? `Step ${article.currentStep}/4`}
                </div>
              </button>
              <button
                disabled={deletingArticleId === article.id}
                onClick={() => onDeleteArticle(article)}
                className="absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-md text-[#8b8b85] opacity-0 transition-opacity hover:bg-white/70 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
                aria-label={tr("Xóa bài viết", "Delete article")}
              >
                <Trash2 className="app-icon" aria-hidden="true" />
              </button>
            </div>
          )
        })}
        {!recent.length && (
          <div className="px-2 py-8 text-center text-[11px] text-[#626262]">
            {tr("Chưa có bài viết", "No recent articles")}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-[#2c2c2c] p-2">
        <button onClick={toggleLanguage} className="sidebar-nav">
          <Globe2 className="app-icon" aria-hidden="true" />
          {language === "vi" ? "Tiếng Việt" : "English"}
          <ChevronDown className="app-icon ml-auto text-[#777]" aria-hidden="true" />
        </button>
        <button onClick={onOpenConfig} className="sidebar-nav">
          <Settings className="app-icon" aria-hidden="true" />
          {tr("Cài đặt", "Settings")}
        </button>
      </div>
    </aside>
  )
}
