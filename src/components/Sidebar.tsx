import { useEffect, useRef, useState } from "react"
import { Archive, ChevronDown, CircleCheck, Clock3, FileText, Globe2, LoaderCircle, LogOut, Mail, Menu, PenLine, PlusCircle, Search, Settings, Trash2 } from "lucide-react"
import type { Article } from "../types"
import { useI18n } from "../lib/i18n"
import BrandMark from "./BrandMark"
import { isLegacyArticle } from "../lib/legacyCompatibility"
import type { ThemePreference } from "../lib/theme"

interface Props {
  articles: Article[]
  activeArticleId: string | null
  onSelectArticle: (id: string) => void
  onNewArticle: () => void
  onOpenContentPlans?: () => void
  onOpenConfig: () => void
  canManageSettings: boolean
  currentUser: { email: string; role: "user" | "admin" }
  themePreference: ThemePreference
  onThemeChange: (preference: ThemePreference) => void
  onSignOut: () => void
  onSignOutAll?: () => void
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
  canManageSettings,
  currentUser,
  themePreference,
  onThemeChange,
  onSignOut,
  onSignOutAll,
  onDeleteArticle,
  deletingArticleId,
}: Props) {
  const { language, toggleLanguage, tr } = useI18n()
  const [open, setOpen] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [search, setSearch] = useState("")
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const accountName = currentUser.email.split("@")[0] || currentUser.email
  const avatarText = accountName.slice(0, 2).toUpperCase()
  useEffect(() => {
    const closeProfileMenu = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileMenuOpen(false)
    }
    document.addEventListener("mousedown", closeProfileMenu)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("mousedown", closeProfileMenu)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [])
  const recent = Array.from(
    articles.reduce((groups, article) => {
      const key = article.activityKind === "batch" && article.activityId
        ? `batch:${article.activityId}`
        : `article:${article.id}`
      const group = groups.get(key)
      if (group) group.push(article)
      else groups.set(key, [article])
      return groups
    }, new Map<string, Article[]>()),
  )
    .map(([key, group]) => ({ key, articles: group, article: group[0] }))
    .filter(({ articles: group }) => group.some((article) => (article.topic || article.title).toLowerCase().includes(search.toLowerCase())))
  return (
    <aside
      aria-label={tr("Điều hướng Writer Studio", "Writer Studio navigation")}
      data-open={open}
      className={`writer-sidebar ${
        open ? "max-md:h-[65dvh]" : "max-md:h-14"
      } w-full md:w-[252px] shrink-0 min-h-0 overflow-hidden border-b md:border-b-0 md:border-r border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] transition-all flex flex-col`}
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <button onClick={onNewArticle} className="flex items-center gap-2 text-sm font-semibold text-[var(--ui-text)]">
          <BrandMark />
          Writer Studio
        </button>
        <div className="flex gap-1">
          <button
            onClick={() => {
              setShowSearch((value) => !value)
              if (showSearch) setSearch("")
            }}
            className="sidebar-icon-button"
            aria-label={tr("Tìm kiếm", "Search")}
          >
            <Search className="app-icon" aria-hidden="true" />
          </button>
          <button
            onClick={() => setOpen((value) => !value)}
            className="sidebar-icon-button md:hidden"
            aria-label={tr("Mở menu", "Open menu")}
            aria-expanded={open}
            aria-controls="writer-sidebar-content"
          >
            <Menu className="app-icon" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div id="writer-sidebar-content" className="flex min-h-0 flex-1 flex-col">
      <nav className="space-y-1 px-2 py-2 text-[13px] font-medium" aria-label={tr("Điều hướng chính", "Main navigation")}>
        <button onClick={onNewArticle} className="sidebar-nav">
          <PenLine className="app-icon" aria-hidden="true" />
          {tr("Activity mới", "New activity")}
          <PlusCircle className="app-icon ml-auto text-[var(--ui-secondary)]" aria-hidden="true" />
        </button>
        <button
          onClick={onOpenContentPlans ?? onNewArticle}
          className="sidebar-nav"
        >
          <FileText className="app-icon" aria-hidden="true" />Content Plan history
        </button>
      </nav>
      <div className="mx-3 my-2 h-px bg-[var(--ui-hover)]" />
      <div className="px-3 pb-1">
        <div className="flex items-center gap-2 px-1 text-[12px] font-medium text-[var(--ui-secondary)]">
          <Clock3 className="app-icon" aria-hidden="true" />
          <span>{tr("Bài đã tạo", "Recents")}</span>
        </div>
        {showSearch && (
          <input
            autoFocus
            aria-label={tr("Tìm bài viết", "Search articles")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tr("Tìm bài viết…", "Search articles…")}
            className="mt-2 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-control)] px-2.5 py-1.5 text-[11px] text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-secondary)]"
          />
        )}
      </div>
      <div className="sidebar-recent-list min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {recent.map(({ key, article, articles: groupArticles }) => {
          const isBatch = groupArticles.length > 1 || article.activityKind === "batch"
          const active = groupArticles.some((item) => item.id === activeArticleId)
          const batchComplete = isBatch && groupArticles.every((item) => item.batchStatus === "completed" || Boolean(item.draft?.trim()))
          const batchWorking = isBatch && !batchComplete && groupArticles.some((item) => !["failed", "paused"].includes(item.batchStatus ?? "queued"))
          const singleComplete = !isBatch && (article.status === "done" || Boolean(article.completedAt))
          const legacy = !isBatch && isLegacyArticle(article)
          const label = isBatch
            ? `${article.activityType === "editorial-originality" ? "Editorial / Originality" : "Comparison / SEO"} · ${groupArticles.length} ${tr("bài", "articles")}`
            : article.topic || article.title
          return (
            <div
              key={key}
              className={`sidebar-recent-card group relative rounded-lg border ${
                active
                  ? "border-[var(--ui-border)] bg-[var(--ui-selected)]"
                  : "border-transparent hover:border-[var(--ui-border)] hover:bg-[var(--ui-hover)]"
              }`}
            >
              <button
                onClick={() => onSelectArticle(article.id)}
                aria-current={active ? "page" : undefined}
                title={label}
                className="flex h-9 w-full items-center px-2.5 pr-9 text-left"
              >
                {legacy && <Archive className="app-icon mr-2 shrink-0 text-[var(--ui-secondary)]" aria-label={tr("Bài lưu trữ cũ", "Legacy archive")} />}
                <div
                  className={`truncate text-[13px] leading-5 ${
                    active ? "font-semibold text-[var(--ui-text)]" : "font-medium text-[var(--ui-text)]"
                  }`}
                >
                  {label}
                </div>
              </button>
              {batchWorking && <LoaderCircle className="app-icon absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-[var(--ui-secondary)] transition-opacity group-hover:opacity-0" aria-label={tr("Đang tạo bài", "Generating articles")} />}
              {(batchComplete || singleComplete) && <CircleCheck className="app-icon absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-400 transition-opacity group-hover:opacity-0" aria-label={tr("Đã hoàn tất", "Completed")} />}
              <button
                disabled={deletingArticleId === article.id}
                onClick={(event) => { event.stopPropagation(); onDeleteArticle(article) }}
                className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[var(--ui-secondary)] opacity-0 transition-all hover:bg-[var(--ui-hover)] hover:text-red-400 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 disabled:opacity-30"
                aria-label={tr("Xóa bài viết", "Delete article")}
              >
                <Trash2 className="app-icon" aria-hidden="true" />
              </button>
            </div>
          )
        })}
        {!recent.length && (
          <div className="px-2 py-8 text-center text-[11px] text-[var(--ui-secondary)]">
            {tr("Chưa có bài viết", "No recent articles")}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-[var(--ui-border)] p-2">
        <button onClick={toggleLanguage} className="sidebar-nav">
          <Globe2 className="app-icon" aria-hidden="true" />
          {language === "vi" ? "Tiếng Việt" : "English"}
          <ChevronDown className="app-icon ml-auto text-[var(--ui-secondary)]" aria-hidden="true" />
        </button>
        <div ref={profileMenuRef} className="relative mt-1">
          {profileMenuOpen && <div className="writer-profile-popover absolute bottom-[calc(100%+8px)] left-0 z-30 w-[236px] overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-control)] p-1.5 shadow-2xl shadow-black/40">
            <div className="flex items-center gap-3 px-2.5 py-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ui-selected)] text-[11px] font-semibold text-[var(--ui-text)]">{avatarText}</div>
              <div className="min-w-0"><p className="truncate text-sm font-medium text-[var(--ui-text)]">{accountName}</p><p className="text-xs text-[var(--ui-secondary)]">{currentUser.role === "admin" ? "Admin" : "User"}</p></div>
            </div>
            <div className="mx-1 my-1 h-px bg-[var(--ui-border)]" />
            <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-[var(--ui-secondary)]"><Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{currentUser.email}</span></div>
            <fieldset className="writer-theme-options mx-1 my-2 rounded-lg border border-[var(--ui-border)] p-2">
              <legend className="px-1 text-xs text-[var(--ui-muted)]">{tr("Giao diện", "Appearance")}</legend>
              {(["light", "dark", "system"] as const).map(option => <label key={option} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-xs hover:bg-[var(--ui-hover)]">
                <input type="radio" name="writer-theme" value={option} checked={themePreference === option} onChange={() => onThemeChange(option)} />
                {option === "light" ? tr("Sáng", "Light") : option === "dark" ? tr("Tối", "Dark") : tr("Theo hệ thống", "System")}
              </label>)}
            </fieldset>
            {canManageSettings && <button onClick={() => { setProfileMenuOpen(false); onOpenConfig() }} className="sidebar-nav mt-1 w-full"><Settings className="app-icon" aria-hidden="true" />{tr("Cài đặt", "Settings")}</button>}
            <button onClick={onSignOut} className="sidebar-nav mt-1 w-full text-red-300 hover:text-red-200"><LogOut className="app-icon" aria-hidden="true" />{tr("Đăng xuất", "Sign out")}</button>
            {onSignOutAll && <button onClick={onSignOutAll} className="sidebar-nav mt-1 w-full text-red-300 hover:text-red-200"><LogOut className="app-icon" aria-hidden="true" />{tr("Đăng xuất mọi thiết bị", "Sign out all devices")}</button>}
          </div>}
          <button onClick={() => setProfileMenuOpen((value) => !value)} aria-haspopup="true" aria-expanded={profileMenuOpen} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-[var(--ui-hover)]">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ui-selected)] text-[10px] font-semibold text-[var(--ui-text)]">{avatarText}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium text-[var(--ui-text)]">{accountName}</p><p className="truncate text-[11px] text-[var(--ui-secondary)]">{currentUser.email}</p></div>
            <ChevronDown className={`app-icon shrink-0 text-[var(--ui-secondary)] transition-transform ${profileMenuOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </div>
      </div>
      </div>
    </aside>
  )
}
