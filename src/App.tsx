import type { OutlineStructureSnapshot } from '../shared/outlineStructures';
import { useState, useEffect, useCallback, useRef } from "react"
import type {
  Article,
  AppConfig,
  ContentPlan,
  ContentPlanItem,
  DocumentFile,
} from "./types"
import { DEFAULT_CONFIG, mergeWithLatestModelCatalog } from "./lib/defaultData"
import * as db from "./lib/db"
import { fetchContentPlans } from "./lib/contentPlans"
import BrandMark from "./components/BrandMark"
import { notifyWorkspace } from "./components/workspace/WorkspaceNotification"
import { useI18n } from "./lib/i18n"
import LoginScreen from "./components/LoginScreen"
import { isArticleCompleted } from "./lib/workflowGuards"
import { isLegacyArticle } from "./lib/legacyCompatibility"
import { useThemePreference } from "./lib/theme"
import type { RerunGate } from "./lib/pipeline"
import CrmApp, { CrmToastHost } from "./crm/CrmApp"

function generateId() {
  return `art-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function createNewArticle(): Article {
  return {
    id: generateId(),
    title: "Bài viết mới",
    currentStep: 1,
    status: "planning",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function hasPasswordRecoveryLink() {
  if (typeof window === "undefined") return false
  return ["recovery", "verification"].includes(new URLSearchParams(window.location.hash.slice(1)).get("type") ?? "")
}

type SyncStatus = "idle" | "loading" | "saving" | "error"
type ArticleUpdateOptions = { silent?: boolean }


export default function App() {
  const { tr } = useI18n()
  const { preference: themePreference, setPreference: setThemePreference, theme } = useThemePreference()
  const [authSession, setAuthSession] = useState<db.AuthSession | null>(() => {
    if (hasPasswordRecoveryLink()) {
      db.clearAuthSession()
      return null
    }
    return db.getAuthSession()
  })
  const [restoringSession, setRestoringSession] = useState(() =>
    !authSession && !hasPasswordRecoveryLink() && db.hasRefreshableAuthSession(),
  )
  const [articles, setArticles] = useState<Article[]>([])
  useEffect(() => {
    if (!restoringSession) return
    let active = true
    void db.refreshStoredAuthSession().then(session => {
      if (!active) return
      if (session) {
        setSyncStatus("loading")
        setAuthSession(session)
      }
      setRestoringSession(false)
    })
    return () => { active = false }
  }, [restoringSession])

  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [contentPlans, setContentPlans] = useState<ContentPlan[]>([])
  const campaignRevision = useRef(0)
  const campaignScope = `${authSession?.user.id ?? ""}:${config.railwayUrl}`
  const campaignScopeRef = useRef(campaignScope)
  campaignScopeRef.current = campaignScope
  const receiveContentPlans = useCallback((plans: ContentPlan[], removedId?: string) => {
    campaignRevision.current++
    setContentPlans(current => [...plans, ...current.filter(plan => plan.id !== removedId && !plans.some(next => next.id === plan.id))])
  }, [])
  useEffect(() => {
    let active = true
    const revision = ++campaignRevision.current
    setContentPlans([])
    if (authSession) void fetchContentPlans(config.railwayUrl).then(plans => {
      if (active && revision === campaignRevision.current) setContentPlans(plans)
    }).catch(() => { /* Article navigation remains available without metadata. */ })
    return () => { active = false }
  }, [campaignScope])
  const [files, setFiles] = useState<DocumentFile[]>([])

  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading")
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null)
  const [articleActionError, setArticleActionError] = useState<string | null>(
    null,
  )
  useEffect(() => {
    if (articleActionError) notifyWorkspace(articleActionError, "error")
  }, [articleActionError])
  const [completionSavingId, setCompletionSavingId] = useState<string | null>(
    null,
  )

  const [deletingArticleId, setDeletingArticleId] = useState<string | null>(
    null,
  )
  const [migratingLegacyId, setMigratingLegacyId] = useState<string | null>(null)
  const articleMutationQueues = useRef(new Map<string, Promise<void>>())
  const failedArticleMutations = useRef(new Set<string>())
  const deletingOrDeletedIds = useRef(new Set<string>())
  const articlesRef = useRef<Article[]>([])
  articlesRef.current = articles

  const enqueueArticleMutation = useCallback(
    (articleId: string, operation: () => Promise<Article>): Promise<Article> => {
      const currentQueue = articleMutationQueues.current.get(articleId) ?? Promise.resolve()
      const result = currentQueue.then(operation, operation)
      const settled = result.then(
        () => undefined,
        () => undefined,
      )
      articleMutationQueues.current.set(articleId, settled)
      void settled.then(() => {
        if (articleMutationQueues.current.get(articleId) === settled)
          articleMutationQueues.current.delete(articleId)
      })
      return result
    },
    [],
  )

  const waitForArticleMutations = useCallback((articleId: string) =>
    articleMutationQueues.current.get(articleId) ?? Promise.resolve(), [])


  // Load all data from Supabase / Railway on mount
  useEffect(() => {
    const expired = () => { setAuthSession(null); setArticles([]); setFiles([]) }
    window.addEventListener("writer:auth-expired", expired)
    return () => window.removeEventListener("writer:auth-expired", expired)
  }, [])
  useEffect(() => {
    if (!authSession) {
      setSyncStatus("idle")
      return
    }
    const load = async () => {
      setSyncStatus("loading")
      setInitialLoadError(null)
      let loaded = false
      try {
        const [remoteArticles, remoteConfig, remoteFiles] = await Promise.all([
          db.fetchArticles(),
          db.fetchConfig(),
          db.fetchFiles(),
        ])

        if (remoteArticles?.length) {
          setArticles(remoteArticles.map((item) => isLegacyArticle(item)
            ? { ...item, legacyReadOnly: true }
            : item))
        }
        if (remoteConfig) {
          setConfig(mergeWithLatestModelCatalog(remoteConfig))
          // Restore railwayUrl to localStorage for aiService
          if (remoteConfig.railwayUrl) {
            localStorage.setItem("writer:railwayUrl", remoteConfig.railwayUrl)
          }
        }
        if (remoteFiles?.length) setFiles(remoteFiles)
        loaded = true
      } catch (error: unknown) {
        setInitialLoadError(
          error instanceof Error ? error.message : String(error),
        )
        setSyncStatus("error")
      } finally {
        if (loaded) setSyncStatus("idle")
      }
    }
    load()
  }, [authSession])


  const handleUpdateArticle = useCallback(
    (id: string, updates: Partial<Article>, options: ArticleUpdateOptions = {}) => {
      const previous = articlesRef.current.find((article) => article.id === id)
      if (deletingOrDeletedIds.current.has(id)) return Promise.resolve(false)
      if (previous && isArticleCompleted(previous) && Object.keys(updates).some(key => key !== "currentStep" && key !== "humanReview" && key !== "approvedArticle")) return Promise.resolve(false)
      setArticles((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, ...updates, updatedAt: new Date().toISOString() }
            : a,
        ),
      )
      if (!options.silent) setSyncStatus("saving")
      return enqueueArticleMutation(id, () => db.updateArticle(id, updates))
        .then(() => {
          failedArticleMutations.current.delete(id)
          if (!options.silent) setSyncStatus("idle")
          return true
        })
        .catch((error: unknown) => {
          failedArticleMutations.current.add(id)
          if (previous) {
            setArticles((current) => current.map((article) => {
              if (article.id !== id) return article
              const rollback = Object.fromEntries(
                Object.entries(updates)
                  .filter(([key, value]) => Object.is((article as unknown as Record<string, unknown>)[key], value))
                  .map(([key]) => [key, (previous as unknown as Record<string, unknown>)[key]]),
              ) as Partial<Article>
              return { ...article, ...rollback }
            }))
          }
          setArticleActionError(
            `Không đồng bộ được bài viết với Supabase: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
          setSyncStatus("error")
          return false
        })
    },
    [enqueueArticleMutation],
  )

  const handleCreateActivity = async (
    type: "comparison-seo" | "editorial-originality",
    plan: ContentPlan,
    items: ContentPlanItem[],
    batchSize?: 5 | 10 | 15 | 20,
    outlineStructure?: OutlineStructureSnapshot,
    options: { forceBatch?: boolean; select?: boolean } = {},
  ) => {
    const activityId = `activity-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    // The CRM pipeline runs every topic as a batch, including a one-topic plan.
    const isBatch = items.length > 1 || Boolean(options.forceBatch)
    setArticleActionError(null)
    setSyncStatus("saving")
    const saved: Article[] = []
    try {
      const records = items.map((item, index): Article => {
        const snapshot = {
          id: item.id,
          label: item.title,
          description: item.sourceLine,
          keywords: item.keywords,
          typeGroup: type === "comparison-seo" ? "A" as const : "C" as const,
          wave: "Current activity",
          timeframe: new Date().toISOString().slice(0, 10),
          contentPlanEvidence: item.sourceLine,
          scheduleEvidence: item.sourceLine,
        }
        return {
          ...createNewArticle(),
          id: `art-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
          title: item.title,
          topic: item.title,
          keywords: item.keywords.join(", "),
          activityType: type,
          activityKind: isBatch ? "batch" : "single",
          activityId,
          contentPlanId: plan.id,
          contentPlanVersion: plan.version,
          contentPlanInput: (plan.sources ?? [])
            .map((source) => source.extractedContent)
            .join("\n\n---\n\n"),
          contentPlanSourceItemId: item.id,
          contentPlanItemId: item.id,
          batchSize,
          outlineStructure: isBatch ? outlineStructure : undefined,
          batchStatus: isBatch ? "queued" : undefined,
          contentType:
            type === "comparison-seo"
              ? "Comparison / SEO"
              : "Editorial / Originality",
          selectedContentTypeSuggestionId: item.id,
          selectedContentTypeSnapshot: snapshot,
          contentTypeSuggestions: [snapshot],
          currentStep: 2,
        }
      })
      for (const record of records)
        saved.push(await enqueueArticleMutation(record.id, () => db.saveArticle(record)))
      setArticles((current) => [...saved, ...current])
      if (isBatch) await db.startBatch(activityId)
      setSyncStatus("idle")
    } catch (error: unknown) {
      if (saved.length) {
        const createdActivityId = saved[0]?.activityId
        if (createdActivityId && saved[0]?.activityKind === "batch")
          await db.deleteBatch(createdActivityId).catch(() => undefined)
        else
          await Promise.allSettled(saved.map((item) => db.deleteArticle(item.id)))
      }
      setArticleActionError(
        `Không tạo được activity trong Supabase: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      setSyncStatus("error")      // The CRM Add Plan flow must stop and report instead of announcing success.
      throw error
    }
  }


  const handleToggleComplete = useCallback(
    async (target: Article) => {
      if (completionSavingId) return
      const isDone = isArticleCompleted(target)
      const updates: Partial<Article> = isDone
        ? { status: "review", completedAt: null }
        : {
            status: "done",
            currentStep: 4,
            completedAt: new Date().toISOString(),
          }

      setArticleActionError(null)
      setCompletionSavingId(target.id)
      setSyncStatus("saving")
      try {
        const savedArticle = await enqueueArticleMutation(target.id, () =>
          db.updateArticle(target.id, updates),
        )
        setArticles((prev) =>
          prev.map((item) => (item.id === target.id ? savedArticle : item)),
        )
        setSyncStatus("idle")
        notifyWorkspace(isDone ? "Đã mở lại bài viết." : "Đã đánh dấu bài viết hoàn thành.", "success")
      } catch (error: unknown) {
        setArticleActionError(
          `Không lưu được trạng thái bài viết vào Supabase: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        setSyncStatus("error")
      } finally {
        setCompletionSavingId(null)
      }
    },
    [completionSavingId, enqueueArticleMutation],
  )


  const handleMigrateLegacy = useCallback(async (target: Article) => {
    if (migratingLegacyId) return
    setMigratingLegacyId(target.id)
    setArticleActionError(null)
    try {
      const copy = await db.migrateLegacyArticle(target.id)
      setArticles((current) => [copy, ...current])
      window.location.hash = `/object/articles/${encodeURIComponent(copy.id)}`
    } catch (error) {
      setArticleActionError(
        `${tr("Không tạo được bản workflow mới", "Could not create current-workflow copy")}: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      setMigratingLegacyId(null)
    }
  }, [migratingLegacyId, tr])


  const handleDeleteArticle = useCallback(
    async (target: Article, deleteGroup = false) => {
      if (deletingArticleId || deletingOrDeletedIds.current.has(target.id)) return
      const targets =
        deleteGroup && target.activityId
          ? articles.filter((item) => item.activityId === target.activityId)
          : [target]
      const confirmed = window.confirm(
        deleteGroup
          ? `Xoá vĩnh viễn batch gồm ${targets.length} bài khỏi Supabase? Thao tác này không thể hoàn tác.`
          : isLegacyArticle(target)
            ? `Xoá vĩnh viễn bài legacy “${target.title || target.topic}” khỏi cả kho lưu trữ cũ và Supabase? Thao tác này không thể hoàn tác.`
            : `Xoá vĩnh viễn bài viết “${target.title}” khỏi Supabase? Thao tác này không thể hoàn tác.`,
      )
      if (!confirmed) return

      setArticleActionError(null)
      setDeletingArticleId(target.id)
      setSyncStatus("saving")
      const targetIds = new Set(targets.map(item => item.id))
      targetIds.forEach(id => deletingOrDeletedIds.current.add(id))
      try {
        // Finish any content save already queued before deleting the database record.
        await Promise.all(targets.map((item) => waitForArticleMutations(item.id)))
        if (deleteGroup && target.activityId)
          await db.deleteBatch(target.activityId)
        else
          await db.deleteArticle(target.id)
        setArticles(current => current.filter(item => !targetIds.has(item.id)))
        setSyncStatus("idle")
        notifyWorkspace(deleteGroup ? `Đã xóa batch gồm ${targets.length} bài.` : "Đã xóa bài viết.", "success")
      } catch (error: unknown) {
        targetIds.forEach(id => deletingOrDeletedIds.current.delete(id))
        setArticleActionError(
          `Không xoá được bài viết khỏi Supabase: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        setSyncStatus("error")
      } finally {
        setDeletingArticleId(null)
      }
    },
    [articles, deletingArticleId, waitForArticleMutations],
  )

  const handleSaveConfig = async (
    newConfig: AppConfig,
    newFiles: DocumentFile[],
    filesChanged: boolean,
  ) => {
    setConfig(newConfig)
    setFiles(newFiles)
    if (newConfig.railwayUrl)
      localStorage.setItem("writer:railwayUrl", newConfig.railwayUrl)
    setSyncStatus("saving")
    try {
      await Promise.all([
        db.saveConfig(newConfig),
        filesChanged ? db.saveFiles(newFiles, newConfig.railwayUrl) : Promise.resolve(),
      ])
      setSyncStatus("idle")
    } catch (error) {
      setSyncStatus("error")
      throw error
    }
  }


  const activeBatchIds = Array.from(new Set(
    articles
      .filter((item) => item.activityKind === "batch" && item.activityId && !["completed", "failed"].includes(item.batchStatus ?? "queued"))
      .map((item) => item.activityId as string),
  )).sort().join(",")

  useEffect(() => {
    const activityIds = activeBatchIds.split(",").filter(Boolean)
    if (!activityIds.length) return
    let stopped = false
    const refresh = async () => {
      try {
        const results = await Promise.all(activityIds.map((activityId) => db.fetchBatch(activityId)))
        if (stopped) return
        setArticles((current) => {
          const remoteArticles = results.flatMap((result) => result.articles)
          const remoteById = new Map(remoteArticles.map((item) => [item.id, item]))
          const currentIds = new Set(current.map((item) => item.id))
          let changed = false
          const merged = current.map((item) => {
            const remote = remoteById.get(item.id)
            if (!remote || remote.updatedAt === item.updatedAt) return item
            changed = true
            return remote
          })
          const added = remoteArticles.filter((item) => !currentIds.has(item.id) && !deletingOrDeletedIds.current.has(item.id))
          if (added.length) changed = true
          return changed ? [...added, ...merged] : current
        })
      } catch {
        /* retain the last durable snapshot while Railway reconnects */
      }
    }
    refresh()
    const timer = window.setInterval(refresh, 2500)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [activeBatchIds])

  const retryBatchArticle = async (activityId: string, id: string) => {
    const previous = articlesRef.current.find((item) => item.id === id)
    setArticles((current) =>
      current.map((item) => item.id === id
        ? {
            ...item,
            batchStatus: "queued",
            batchError: null,
            updatedAt: new Date().toISOString(),
          }
        : item),
    )
    try {
      const queued = await db.retryBatchArticle(activityId, id)
      setArticles((current) =>
        current.map((item) => item.id === queued.id ? queued : item),
      )
    } catch (error) {
      if (previous)
        setArticles((current) =>
          current.map((item) => item.id === id ? previous : item),
        )
      throw error
    }
  }


  const handleRerun = async (target: Article, gate: RerunGate) => {
    await waitForArticleMutations(target.id)
    const queued = await db.rerunArticle(target.id, gate)
    setArticles((current) => current.map((item) => item.id === queued.id ? queued : item))
  }
  const signOut = () => { void db.logout().then(() => { setAuthSession(null); setArticles([]); setFiles([]) }).catch(error => notifyWorkspace(error.message, "error")) }


  // ── Loading screen ──
  if (!authSession && !restoringSession) {
    return <LoginScreen
      onLogin={async (email, password) => setAuthSession(await db.login(email, password))}
      onSignUp={db.signUp}
      onForgotPassword={db.requestPasswordReset}
      onResetPassword={db.resetPassword}
    />
  }

  if (restoringSession || syncStatus === "loading") {
    return (
      <div className={`${theme === "dark" ? "codex-dark" : "writer-light"} h-dvh flex items-center justify-center bg-[var(--ui-bg)]`}>
        <div className="text-center space-y-3">
          <BrandMark className="mx-auto h-10 w-10" />
          <div className="text-sm font-medium text-[var(--ui-text)]">
            {tr("Đang tải Writer Studio...", "Loading Writer Studio...")}
          </div>
          <div className="w-40 h-1 bg-[#222] rounded-full overflow-hidden mx-auto">
            <div className="h-full bg-[#9ca3af] rounded-full w-3/5 animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (!authSession) return null

  if (initialLoadError) {
    return (
      <div className={`${theme === "dark" ? "codex-dark" : "writer-light"} h-dvh flex items-center justify-center bg-[var(--ui-bg)] p-4 sm:p-6`}>
        <div className="max-w-md w-full bg-[var(--ui-surface)] border border-[var(--ui-border)] rounded-2xl p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl border border-red-900/50 bg-red-950/30 text-red-400 flex items-center justify-center text-xl mx-auto">
            !
          </div>
          <div>
            <h1 className="text-base font-medium text-[#e5e5e5]">
              {tr(
                "Không tải được dữ liệu từ Railway / Supabase",
                "Could not load data from Railway / Supabase",
              )}
            </h1>
            <p className="text-xs text-[#9ca3af] mt-2 leading-relaxed">
              {tr(
                "Ứng dụng đã khóa thao tác lưu để tránh ghi đè database bằng dữ liệu rỗng.",
                "Saving is locked to prevent overwriting the database with empty data.",
              )}
            </p>
          </div>
          <div className="bg-red-950/25 border border-red-900/50 rounded-xl px-3 py-2 text-[11px] text-red-300 font-mono break-words">
            {initialLoadError}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="bg-neutral-200 hover:bg-white text-[#141414] font-medium text-sm py-2.5 px-5 rounded-xl transition-all"
          >
            {tr("Thử tải lại", "Try again")}
          </button>
        </div>
      </div>
    )
  }


  return (
    <div className={`${theme === "dark" ? "codex-dark" : "writer-light"} writer-app h-dvh overflow-hidden bg-[var(--ui-bg)]`}>
      <CrmToastHost />
      <CrmApp
        user={authSession.user}
        articles={articles}
        contentPlans={contentPlans}
        files={files}
        config={config}
        onUpdateArticle={(id, updates) => handleUpdateArticle(id, updates)}
        onDeleteArticle={(target, batch) => void handleDeleteArticle(target, batch)}
        onRetry={(target) => retryBatchArticle(target.activityId ?? "", target.id)}
        onRerun={handleRerun}
        onToggleComplete={(target) => void handleToggleComplete(target)}
        onMigrateLegacy={(target) => void handleMigrateLegacy(target)}
        onCreate={handleCreateActivity}
        onContentPlansChange={(plans) => receiveContentPlans(plans)}
        onSaveConfig={handleSaveConfig}
        onSignOut={signOut}
        themePreference={themePreference}
        onThemeChange={setThemePreference}
      />
    </div>
  )
}
