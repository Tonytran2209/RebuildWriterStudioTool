import type { Article, AppConfig, DocumentFile, WebsiteContentRecord } from "../types"

const AUTH_STORAGE_KEY = "writer:auth-session"

// "user" is the Content Operator role.
export type UserRole = "user" | "reviewer" | "admin"
export interface AuthSession {
  authProvider?: "supabase" | "postgres"
  accessToken: string
  refreshToken?: string
  expiresAt: number | null
  user: { id: string; email: string; role: UserRole }
}

let memorySession: AuthSession | null = null
function saveSession(session: AuthSession) {
  memorySession = session
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session.authProvider === "postgres"
    ? { authProvider: "postgres", user: session.user, expiresAt: null, accessToken: "" }
    : session))
}
function readStoredAuthSession(): AuthSession | null {
  if (memorySession?.authProvider === "postgres") return memorySession
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as AuthSession
    if ((!session.accessToken && session.authProvider !== "postgres") || !session.user?.role) {
      localStorage.removeItem(AUTH_STORAGE_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

export function getAuthSession(): AuthSession | null {
  const session = readStoredAuthSession()
  if (!session?.accessToken) return null
  return session?.expiresAt && session.expiresAt * 1000 <= Date.now() ? null : session
}

export function hasRefreshableAuthSession(): boolean {
  const session = readStoredAuthSession()
  return Boolean(session?.refreshToken || session?.authProvider === "postgres")
}

export function clearAuthSession() {
  memorySession = null
  localStorage.removeItem(AUTH_STORAGE_KEY)
  window.dispatchEvent(new Event("writer:auth-expired"))
}
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key === AUTH_STORAGE_KEY && !event.newValue) {
    memorySession = null
    window.dispatchEvent(new Event("writer:auth-expired"))
  }
})

function resolveRailwayUrl(explicitUrl?: string): string {
  const saved =
    typeof window !== "undefined"
      ? localStorage.getItem("writer:railwayUrl")
      : null
  const sameOrigin = typeof window !== "undefined" ? window.location.origin : ""
  const url = explicitUrl?.trim() || saved?.trim() || sameOrigin
  if (!url) throw new Error("Chưa cấu hình Railway URL.")
  return url.replace(/\/$/, "")
}

let refreshInFlight: Promise<AuthSession | null> | null = null

export async function refreshStoredAuthSession(railwayUrl?: string): Promise<AuthSession | null> {
  const current = readStoredAuthSession()
  if (!current?.refreshToken && current?.authProvider !== "postgres") return null
  if (!refreshInFlight) {
    const fetchRefresh = () => fetch(`${resolveRailwayUrl(railwayUrl)}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    })
    // Serialize cookie rotation across tabs when the Web Locks API is available.
    const response: Promise<Response> = (async () =>
      current.authProvider === "postgres" && typeof navigator !== "undefined" && navigator.locks
        ? await navigator.locks.request("writer-auth-refresh", async () => await fetchRefresh())
        : await fetchRefresh())()
    refreshInFlight = response
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as AuthSession & { error?: string }
        if (!response.ok || !payload.accessToken) throw new Error(payload.error || "Không thể làm mới phiên đăng nhập.")
        saveSession(payload)
        return payload
      })
      .catch(() => {
        clearAuthSession()
        return null
      })
      .finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

// Use this for Railway endpoints that return non-JSON payloads or need custom
// response handling. It keeps direct API callers under the same auth contract
// as the typed helpers below.
export async function authenticatedRailwayFetch(
  path: string,
  init?: RequestInit,
  railwayUrl?: string,
): Promise<Response> {
  let session = getAuthSession()
  if (!session) session = await refreshStoredAuthSession(railwayUrl)
  const request = (token?: string) => {
    const headers = new Headers(init?.headers)
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`)
    }
    return fetch(`${resolveRailwayUrl(railwayUrl)}${path}`, { ...init, headers, credentials: "include" })
  }
  let response = await request(session?.accessToken)
  if (response.status !== 401 || path === "/api/auth/refresh") return response
  session = await refreshStoredAuthSession(railwayUrl)
  return session ? request(session.accessToken) : response
}

async function railwayRequest<T>(
  path: string,
  init?: RequestInit,
  railwayUrl?: string,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase()
  const maxAttempts = method === "GET" ? 3 : 1
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response
    try {
      response = await authenticatedRailwayFetch(path, init, railwayUrl)
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * 750))
      continue
    }

    const payload = await response
      .json()
      .catch(() => ({ error: response.statusText }))
    const transient = [502, 503, 504].includes(response.status)

    if (response.ok) return payload as T
    if (!transient || attempt === maxAttempts) {
      throw Object.assign(new Error(payload.error || `Railway error ${response.status}`), { status: response.status, code: payload.code })
    }
    lastError = new Error(payload.error || `Railway error ${response.status}`)

    await new Promise((resolve) => setTimeout(resolve, attempt * 750))
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Không thể kết nối Railway.")
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const session = await railwayRequest<AuthSession>(
    "/api/auth/login",
    jsonRequest("POST", { email, password }),
  )
  saveSession(session)
  return session
}

export async function logout(all = false) {
  if (refreshInFlight) await refreshInFlight
  const session = readStoredAuthSession()
  if (session?.authProvider === "postgres") {
    const response = await authenticatedRailwayFetch(all ? "/api/auth/logout-all" : "/api/auth/logout", jsonRequest("POST", {}))
    if (!response.ok) throw new Error("Không thể thu hồi phiên đăng nhập. Vui lòng thử lại.")
  }
  clearAuthSession()
}

export async function verifyEmail(token: string): Promise<string> {
  return (await railwayRequest<{ message: string }>("/api/auth/verify-email", jsonRequest("POST", { token }))).message
}
export async function authOptions() {
  return railwayRequest<{ provider: string; allowSignup: boolean; passwordMin: number }>("/api/auth/config")
}
export async function resendVerification(email: string): Promise<string> {
  return (await railwayRequest<{ message: string }>("/api/auth/resend-verification", jsonRequest("POST", { email }))).message
}

export async function signUp(email: string, password: string): Promise<string> {
  const result = await railwayRequest<{ message: string }>(
    "/api/auth/signup",
    jsonRequest("POST", { email, password }),
  )
  return result.message
}

export async function requestPasswordReset(email: string): Promise<string> {
  const result = await railwayRequest<{ message: string }>(
    "/api/auth/forgot-password",
    jsonRequest("POST", { email }),
  )
  return result.message
}

export async function resetPassword(accessToken: string, password: string): Promise<string> {
  const result = await railwayRequest<{ message: string }>(
    "/api/auth/reset-password",
    { ...jsonRequest("POST", { password }), headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } },
  )
  return result.message
}

// ── Articles ──────────────────────────────────────────────────────────────────

export async function fetchArticles(): Promise<Article[]> {
  return railwayRequest<Article[]>("/api/articles")
}

export async function saveArticle(article: Article): Promise<Article> {
  const result = await railwayRequest<{ article: Article }>(
    "/api/articles",
    jsonRequest("POST", article),
  )
  return result.article
}

export async function updateArticle(
  id: string,
  updates: Partial<Article>,
): Promise<Article> {
  const result = await railwayRequest<{ article: Article }>(
    `/api/articles/${encodeURIComponent(id)}`,
    jsonRequest("PUT", updates),
  )
  return result.article
}

export async function deleteArticle(id: string): Promise<void> {
  await railwayRequest(`/api/articles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function deleteBatch(activityId: string): Promise<void> {
  await railwayRequest(`/api/batches/${encodeURIComponent(activityId)}`, {
    method: "DELETE",
  })
}

export async function migrateLegacyArticle(id: string): Promise<Article> {
  const result = await railwayRequest<{ article: Article }>(
    `/api/articles/${encodeURIComponent(id)}/migrate-legacy`,
    { method: "POST" },
  )
  return result.article
}

const flTelemetry = () => (typeof window !== "undefined" ? (window as any).FLTelemetry : undefined)
const trackedBatchIds = new Set<string>()

export async function startBatch(activityId: string): Promise<void> {
  trackedBatchIds.add(activityId)
  flTelemetry()?.taskSubmit?.("Writer article", "batch_generation")
  try {
    await railwayRequest(`/api/batches/${encodeURIComponent(activityId)}/start`, {
      method: "POST",
    })
  } catch (err: any) {
    trackedBatchIds.delete(activityId)
    flTelemetry()?.taskError?.("Writer article", err?.message)
    throw err
  }
}

export async function pauseBatch(activityId: string): Promise<void> {
  await railwayRequest(`/api/batches/${encodeURIComponent(activityId)}/pause`, {
    method: "POST",
  })
}

export async function retryBatchArticle(
  activityId: string,
  articleId: string,
): Promise<Article> {
  trackedBatchIds.add(activityId)
  flTelemetry()?.taskSubmit?.("Writer article", "retry_article")
  try {
    const result = await railwayRequest<{ article: Article }>(
      `/api/batches/${encodeURIComponent(activityId)}/retry/${encodeURIComponent(articleId)}`,
      { method: "POST" },
    )
    return result.article
  } catch (err: any) {
    trackedBatchIds.delete(activityId)
    flTelemetry()?.taskError?.("Writer article", err?.message)
    throw err
  }
}

export async function fetchBatchStatus(activityIds: string[]): Promise<Article[]> {
  return (await railwayRequest<{ articles: Article[] }>(`/api/batch-status?ids=${activityIds.map(encodeURIComponent).join(",")}`)).articles
}

export async function fetchBatch(
  activityId: string,
): Promise<{ batch: Record<string, unknown> | null; articles: Article[] }> {
  const res = await railwayRequest<{ batch: Record<string, unknown> | null; articles: Article[] }>(
    `/api/batches/${encodeURIComponent(activityId)}`,
  )
  if (trackedBatchIds.has(activityId)) {
    const batchStatus = String(res.batch?.status || "")
    if (batchStatus === "completed") {
      trackedBatchIds.delete(activityId)
      flTelemetry()?.taskComplete?.("Writer article")
    } else if (batchStatus === "failed") {
      trackedBatchIds.delete(activityId)
      flTelemetry()?.taskError?.("Writer article", String(res.batch?.error || "Batch failed"))
    }
  }
  return res
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function fetchConfig(): Promise<AppConfig | null> {
  return railwayRequest<AppConfig | null>("/api/config")
}

/** Saves settings; the server rejects a save built on an older revision (409 CONFIG_CONFLICT). Returns the new revision. */
export async function saveConfig(config: AppConfig): Promise<number | undefined> {
  // Website Inventory is saved per record; never send the snapshot held in config.
  const { websiteInventory: _inventory, ...rest } = config
  const result = await railwayRequest<{ revision?: number }>(
    "/api/config",
    jsonRequest("POST", rest),
    config.railwayUrl,
  )
  return result?.revision
}

export async function scanWebsiteUrl(
  url: string,
  railwayUrl?: string,
  aiSummary = true,
): Promise<import("../types").WebsiteContentRecord> {
  const result = await railwayRequest<{
    record: import("../types").WebsiteContentRecord
  }>("/api/website-inventory/scan", jsonRequest("POST", { url, aiSummary }), railwayUrl)
  return result.record
}

export interface WebsiteInventoryBatchJob {
  id: string
  status: "queued" | "running" | "complete" | "failed" | "cancelled"
  total: number
  done: number
  failed: number
  summaryLimitReached: boolean
  recentRecords: WebsiteContentRecord[]
  error?: string
}

export async function startWebsiteInventoryBatch(
  urls: string[],
  railwayUrl?: string,
  aiSummary = true,
): Promise<WebsiteInventoryBatchJob> {
  const result = await railwayRequest<{ job: WebsiteInventoryBatchJob }>(
    "/api/website-inventory/batches",
    jsonRequest("POST", { urls, aiSummary }),
    railwayUrl,
  )
  return result.job
}

export async function fetchWebsiteInventoryBatch(
  id: string,
  railwayUrl?: string,
): Promise<WebsiteInventoryBatchJob> {
  const result = await railwayRequest<{ job: WebsiteInventoryBatchJob }>(
    `/api/website-inventory/batches/${encodeURIComponent(id)}`,
    undefined,
    railwayUrl,
  )
  return result.job
}

export async function cancelWebsiteInventoryBatch(
  id: string,
  railwayUrl?: string,
): Promise<WebsiteInventoryBatchJob> {
  const result = await railwayRequest<{ job: WebsiteInventoryBatchJob }>(
    `/api/website-inventory/batches/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    railwayUrl,
  )
  return result.job
}

export async function cancelAllWebsiteInventoryBatches(
  railwayUrl?: string,
): Promise<number> {
  const result = await railwayRequest<{ cancelled: number }>(
    "/api/website-inventory/batches",
    { method: "DELETE" },
    railwayUrl,
  )
  return result.cancelled
}

export async function fetchWebsiteInventory(
  railwayUrl?: string,
): Promise<WebsiteContentRecord[]> {
  const result = await railwayRequest<{ records: WebsiteContentRecord[] }>(
    "/api/website-inventory",
    undefined,
    railwayUrl,
  )
  return result.records
}

export async function updateWebsiteInventoryRecord(
  id: string,
  updates: Partial<WebsiteContentRecord>,
  railwayUrl?: string,
): Promise<WebsiteContentRecord> {
  const result = await railwayRequest<{ record: WebsiteContentRecord }>(
    `/api/website-inventory/${encodeURIComponent(id)}`,
    jsonRequest("PATCH", updates),
    railwayUrl,
  )
  return result.record
}

export async function deleteWebsiteInventoryRecord(
  id: string,
  railwayUrl?: string,
): Promise<void> {
  await railwayRequest(`/api/website-inventory/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }, railwayUrl)
}

// ── Files ─────────────────────────────────────────────────────────────────────

export async function fetchFiles(): Promise<DocumentFile[]> {
  return railwayRequest<DocumentFile[]>("/api/files")
}

export async function updateFileGroup(id: string, storageGroup: string): Promise<DocumentFile> {
  return (await railwayRequest<{ file: DocumentFile }>(`/api/files/${encodeURIComponent(id)}`, jsonRequest("PATCH", { storageGroup }))).file
}

export async function updateFileMetadata(id: string, knowledgeMetadata: NonNullable<DocumentFile["knowledgeMetadata"]>): Promise<DocumentFile> {
  return (await railwayRequest<{ file: DocumentFile }>(`/api/files/${encodeURIComponent(id)}`, jsonRequest("PATCH", { knowledgeMetadata }))).file
}

/** Deletes one document; the server also removes it from every gate's Shipper access and returns both. */
export async function deleteFile(id: string): Promise<{ files: DocumentFile[]; config: AppConfig }> {
  return railwayRequest(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export async function saveFiles(
  files: DocumentFile[],
  railwayUrl: string,
): Promise<void> {
  await railwayRequest("/api/files", jsonRequest("POST", files), railwayUrl)
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

// ── Railway health check ───────────────────────────────────────────────────────

export interface BackendStatus {
  ok: boolean
  latencyMs?: number
  providers?: Record<string, boolean>
  seoResearch?: boolean
  databaseProvider?: string
  storageProvider?: string
  /** From /health/dependencies; undefined when that check could not run. */
  dependencies?: { status: string; databaseConnected?: boolean; authConnected?: boolean | null; relationalContentPlans?: boolean; threeStageSessions?: boolean }
}

/** Liveness (/health) plus dependency diagnostics (/health/dependencies) of the Railway backend. */
export async function pingRailway(url: string): Promise<BackendStatus> {
  const base = url.replace(/\/$/, "")
  try {
    const started = performance.now()
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })
    const latencyMs = Math.round(performance.now() - started)
    if (!res.ok) return { ok: false }
    const data = await res.json()
    // 503 still carries the JSON body describing what is degraded.
    const dependencies = await fetch(`${base}/health/dependencies`, { signal: AbortSignal.timeout(8000) })
      .then(r => r.json()).catch(() => undefined)
    return { ok: true, latencyMs, providers: data.providers, seoResearch: Boolean(data.seoResearch), databaseProvider: data.databaseProvider, storageProvider: data.storageProvider, dependencies }
  } catch {
    return { ok: false }
  }
}

export interface ArticleStageVersion {
  id: string
  stage: string
  revision_number: number
  created_at?: string
  output_snapshot?: { generationId?: string; generatedAt?: string; markdown?: string; sections?: Article["outline"] }
}
export async function getArticleStages(id: string): Promise<ArticleStageVersion[]> {
  const result = await railwayRequest<{ stages: ArticleStageVersion[] }>(`/api/articles/${encodeURIComponent(id)}/stages`)
  return Array.isArray(result.stages) ? result.stages : []
}

/** Regenerate an article from a gate (1 Core Idea, 2 Outline, 3 Draft, 4 AI review) through the batch runner. */
export async function rerunArticle(id: string, gate: 1 | 2 | 3 | 4): Promise<Article> {
  flTelemetry()?.taskSubmit?.("Writer article", `rerun_gate_${gate}`)
  try {
    const result = await railwayRequest<{ article: Article }>(
      `/api/articles/${encodeURIComponent(id)}/rerun`,
      jsonRequest("POST", { gate }),
    )
    const st = String(result.article?.batchStatus || "")
    if (st === "failed") {
      flTelemetry()?.taskError?.("Writer article", "Rerun failed")
    } else if (st !== "running" && st !== "queued") {
      flTelemetry()?.taskComplete?.("Writer article")
    } else if (result.article?.activityId) {
      trackedBatchIds.add(result.article.activityId)
    }
    return result.article
  } catch (err: any) {
    flTelemetry()?.taskError?.("Writer article", err?.message)
    throw err
  }
}
