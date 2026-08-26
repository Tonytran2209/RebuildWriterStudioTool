import { useState } from "react"
import type { ReactNode } from "react"
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
const Icon = ({ children }: { children: ReactNode }) => (
  <span className="sidebar-line-icon" aria-hidden="true">
    {children}
  </span>
)

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
            <Icon>⌕</Icon>
          </button>
          <button
            onClick={() => setOpen((value) => !value)}
            className="sidebar-icon-button md:hidden"
            aria-label={tr("Mở menu", "Open menu")}
          >
            <Icon>☰</Icon>
          </button>
        </div>
      </div>
      <nav className="space-y-1 px-2 py-2 text-[13px]">
        <button onClick={onNewArticle} className="sidebar-nav">
          <Icon>✎</Icon>
          {tr("Activity mới", "New activity")}
          <span className="ml-auto text-[#777]">⊕</span>
        </button>
        <button
          onClick={onOpenContentPlans ?? onNewArticle}
          className="sidebar-nav"
        >
          <Icon>▦</Icon>Content Plan history
        </button>
        <button onClick={() => setOpen(true)} className="sidebar-nav">
          <Icon>◷</Icon>
          {tr("Bài đã tạo", "Recents")}
        </button>
      </nav>
      <div className="mx-3 my-2 h-px bg-[#2c2c2c]" />
      <div className="px-3">
        <div className="text-[11px] font-semibold text-[#777]">Recents</div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={tr("Tìm bài viết…", "Search articles…")}
          className="mt-2 w-full rounded-lg border border-[#333] bg-[#191919] px-2.5 py-2 text-[11px] text-[#ddd] outline-none placeholder:text-[#666]"
        />
      </div>
      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-3">
        {recent.map((article) => {
          const active = article.id === activeArticleId
          return (
            <div
              key={article.id}
              className={`group rounded-lg ${
                active
                  ? "bg-[#e4e4e1] ring-1 ring-[#d3d3cf]"
                  : "hover:bg-[#e8e8e5]"
              }`}
            >
              <button
                onClick={() => onSelectArticle(article.id)}
                className="w-full px-2.5 py-2 text-left"
              >
                <div
                  className={`truncate text-[12px] ${
                    active ? "text-[#262626]" : "text-[#555]"
                  }`}
                >
                  {article.topic || article.title}
                </div>
                <div className="mt-0.5 text-[9px] text-[#84847f]">
                  {article.contentPlanVersion
                    ? `Content Plan v${article.contentPlanVersion} · `
                    : ""}
                  {article.batchStatus ?? `Step ${article.currentStep}/4`}
                </div>
              </button>
              <button
                disabled={deletingArticleId === article.id}
                onClick={() => onDeleteArticle(article)}
                className="hidden group-hover:block px-2.5 pb-2 text-[9px] text-[#777] hover:text-red-600"
              >
                {tr("Xóa", "Delete")}
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
          <span className="ui-globe" aria-hidden="true" />
          {language === "vi" ? "Tiếng Việt" : "English"}
          <span className="ml-auto text-[#777]">⌄</span>
        </button>
        <button onClick={onOpenConfig} className="sidebar-nav">
          <Icon>
            <span className="settings-icon-glyph">⚙</span>
          </Icon>
          {tr("Cài đặt", "Settings")}
        </button>
      </div>
    </aside>
  )
}
