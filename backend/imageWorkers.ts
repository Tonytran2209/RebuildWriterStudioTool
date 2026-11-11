import { createHash, randomBytes, randomUUID } from "node:crypto"
import { Router, type Request, type Response } from "express"
import { database, provider } from "./postgres.ts"
import { downloadDocumentBinary, uploadDocumentBinary, deleteDocumentBinaries, kvGet } from "./supabase.ts"
import { isArticleCompleted } from "../src/lib/workflowGuards.ts"
import type { Article } from "../src/types/index.ts"
import { ARTICLE_JOB, batchStepLabels } from "./batchSteps.ts"
import type { QueryConfig } from "pg"
import type { ParentRun } from "./jobHistory.ts"

const workers = "writer_studio.image_workers"
const jobs = "writer_studio.image_worker_jobs"
const runs = "writer_studio.image_worker_runs"
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value)
const digest = (value: string) => createHash("sha256").update(value).digest("hex")
const owner = (req: Request) => (req as Request & { auth: { userId: string } }).auth.userId
const workerColumns = `id, name, agent, preferred, (last_seen > now() - interval '30 seconds') AS online,
  EXISTS (SELECT 1 FROM ${jobs} j WHERE j.worker_id=w.id AND j.status='running' AND j.lease_until > now()) AS busy`
const jobColumns = "id, suggestion_id, worker_id, status, error_code"
const publicJobColumns = `id, suggestion_id, worker_id,
  CASE WHEN status='running' AND lease_until <= now() THEN 'queued' ELSE status END AS status, error_code`

export function imageAnchor(article: Article, suggestionId: string) {
  const suggestion = article.imageSuggestions?.find(item => item.id === suggestionId && item.status === "approved" && item.evidenceSafe)
  const section = article.outline?.find(item => item.id === suggestion?.afterSectionId && item.heading === suggestion.afterHeading)
  if (!suggestion || !section || !article.draft) return null
  const headings = [...article.draft.matchAll(/^#{2,3}[ \t]+(.+?)[ \t]*\r?$/gm)]
  const matching = headings.filter(item => item[1].trim() === section.heading.trim())
  if (matching.length !== 1) return null
  const heading = matching[0]
  const body = article.draft.slice(heading.index! + heading[0].length, headings[headings.indexOf(heading) + 1]?.index)
  const marker = `(image-placeholder://${suggestionId})`
  if (!body.includes(marker) || article.draft.split(marker).length !== 2) return null
  const prose = body.split(/\r?\n/).filter(line => !line.includes(marker)).join("\n").trim()
  return {
    anchor: digest(JSON.stringify([section.id, section.heading, prose, suggestion.brief, suggestion.altText])),
    input: { title: article.title, heading: section.heading, excerpt: prose.slice(0, 6000), brief: suggestion.brief, altText: suggestion.altText, type: suggestion.type },
  }
}

export function imageRunRows(rows: ParentRun[], limit: number) {
  return { runs: rows.slice(0, limit), complete: rows.length <= limit }
}

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
const queryDatabase: Query = (sql, params) => database().query(sql, params)
const queryMonitoring: Query = (text, values) => {
  const config: QueryConfig & { query_timeout: number } = { text, values, query_timeout: 2500 }
  return database().query(config)
}

export async function readImageWorkerRuns(query: Query = queryMonitoring) {
  if (query === queryMonitoring && provider() !== "postgres") return imageRunRows([], 0)
  const { rows } = await query(`SELECT id::text AS "runId", parent_run_id AS "parentRunId",
    job, 'Writer article' AS parent, '1 image' AS workload,
    CASE WHEN status='running' AND started_at < now() - interval '15 minutes' THEN 'failed' ELSE status END AS status,
    started_at AS "startedAt", CASE WHEN status='running' AND started_at < now() - interval '15 minutes'
      THEN started_at + interval '15 minutes' ELSE ended_at END AS "endedAt",
    CASE WHEN status='running' AND started_at < now() - interval '15 minutes' THEN 'LEASE_EXPIRED' ELSE error_code END AS "errorCode" FROM ${runs}
    WHERE COALESCE(ended_at,started_at) >= now() - interval '61 days'
    ORDER BY COALESCE(ended_at,started_at) DESC LIMIT 501`)
  return imageRunRows(rows, 500)
}

export function createImageWorkers(deps = {
  query: queryDatabase,
  loadArticle: (id: string) => kvGet<Article>(`writer:article:${id}`),
  upload: uploadDocumentBinary,
  download: downloadDocumentBinary,
  remove: deleteDocumentBinaries,
  available: () => provider() === "postgres" && process.env.WRITER_MAINTENANCE_MODE !== "true",
}) {
  const { query, loadArticle, upload, download, remove, available } = deps
  const writeMonitoring = query === queryDatabase ? queryMonitoring : query
  async function recordRun(id: string, parentId: string, job: string, startedAt: string, status: ParentRun["status"], error: string | null = null) {
    try {
      await writeMonitoring(`INSERT INTO ${runs} (id,parent_run_id,job,started_at,ended_at,status,error_code)
        VALUES ($1,$2,$3,$4,CASE WHEN $5='running' THEN NULL ELSE now() END,$5,$6)
        ON CONFLICT (id) DO UPDATE SET ended_at=excluded.ended_at,status=excluded.status,error_code=excluded.error_code
        WHERE image_worker_runs.status='running'`, [id, parentId, job, startedAt, status, error])
    } catch { /* Monitoring must not fail the operation. */ }
  }

  async function parentRun(article: Article) {
    if (article.activityKind !== "batch") return `single:${article.id}`
    const { rows } = await query("SELECT id FROM writer_studio.batch_job_items WHERE article_id=$1 AND batch_job_id=$2", [article.id, article.activityId]).catch(() => ({rows: []}))
    return rows[0]?.id ?? `single:${article.id}`
  }

  function endpoint(fn: (req: Request, res: Response) => Promise<unknown>) {
    return async (req: Request, res: Response) => {
      if (!available())
        return res.status(503).json({ error: "Image Workers requires an available PostgreSQL workspace." })
      try { await fn(req, res) }
      catch (error) {
        const code = (error as { code?: string }).code
        if (code === "42P01") return res.status(503).json({ error: "Apply migration 003_image_workers.sql to enable Image Workers." })
        if (code === "23505") return res.status(409).json({ error: "This suggestion already has an active image." })
        console.error("[image-worker]", code ?? "INTERNAL")
        res.status(500).json({ error: "Image Worker operation failed." })
      }
    }
  }

  async function expireRun(lease: string) {
    await writeMonitoring(`UPDATE ${runs} SET status='failed',ended_at=now(),error_code='LEASE_EXPIRED'
      WHERE id=$1 AND status='running'`, [lease]).catch(() => {})
  }

  async function worker(req: Request) {
    const token = req.get("authorization")?.match(/^Bearer ([0-9a-f-]+)\.([a-f0-9]{64})$/i)
    if (!token || !uuid.test(token[1])) return null
    const { rows } = await query(`UPDATE ${workers} SET last_seen=now()
      WHERE id=$1 AND secret_hash=$2 AND NOT revoked RETURNING id,agent`, [token[1], digest(token[2])])
    return rows[0] ?? null
  }

  const imageWorkerApi = Router()
  imageWorkerApi.get("/workers", endpoint(async (req, res) => {
    const { rows } = await query(`SELECT ${workerColumns} FROM ${workers} w WHERE owner_id=$1 AND NOT revoked ORDER BY name`, [owner(req)])
    res.json(rows)
  }))
  imageWorkerApi.post("/workers", endpoint(async (req, res) => {
    const { name, agent } = req.body ?? {}
    if (typeof name !== "string" || !name.trim() || name.length > 80 || !["claude", "codex"].includes(agent))
      return res.status(400).json({ error: "Enter a worker name and select Claude or Codex." })
    const id = randomUUID()
    const secret = randomBytes(32).toString("hex")
    await query(`INSERT INTO ${workers} (id,owner_id,name,agent,secret_hash) VALUES ($1,$2,$3,$4,$5)`,
      [id, owner(req), name.trim(), agent, digest(secret)])
    res.set("Cache-Control", "no-store").status(201).json({ token: `${id}.${secret}` })
  }))
  imageWorkerApi.patch("/workers/:id", endpoint(async (req, res) => {
    if (!isUuid(req.params.id) || !["default", "revoke"].includes(req.body?.action)) return res.sendStatus(400)
    const userId = owner(req)
    if (req.body.action === "default") {
      await query(`UPDATE ${workers} SET preferred=(id=$2) WHERE owner_id=$1 AND NOT revoked
        AND EXISTS (SELECT 1 FROM ${workers} WHERE owner_id=$1 AND id=$2 AND NOT revoked)`, [userId, req.params.id])
    } else {
      await query(`UPDATE ${workers} SET revoked=true,preferred=false WHERE owner_id=$1 AND id=$2`, [userId, req.params.id])
    }
    res.json({ ok: true })
  }))

  imageWorkerApi.get("/articles/:articleId/jobs", endpoint(async (req, res) => {
    const { rows } = await query(`SELECT DISTINCT ON (suggestion_id) ${publicJobColumns} FROM ${jobs}
      WHERE article_id=$1 AND (owner_id=$2 OR status='inserted') ORDER BY suggestion_id,created_at DESC`, [req.params.articleId, owner(req)])
    res.json(rows)
  }))
  imageWorkerApi.post("/articles/:articleId/jobs", endpoint(async (req, res) => {
    const { workerId, suggestionId } = req.body ?? {}
    if (typeof workerId !== "string" || !uuid.test(workerId) || typeof suggestionId !== "string") return res.sendStatus(400)
    const article = await loadArticle(String(req.params.articleId))
    const placement = article && !isArticleCompleted(article) && imageAnchor(article, suggestionId)
    if (!placement) return res.status(409).json({ error: "Approve the image placement in the current draft first." })
    const { rows } = await query(`INSERT INTO ${jobs}
      (id,owner_id,worker_id,article_id,suggestion_id,anchor,input)
      SELECT $1,$2,id,$4,$5,$6,$7 FROM ${workers} WHERE id=$3 AND owner_id=$2 AND NOT revoked
      RETURNING ${jobColumns}`, [randomUUID(), owner(req), workerId, article.id, suggestionId, placement.anchor, placement.input])
    if (!rows.length) return res.sendStatus(404)
    res.status(202).json(rows[0])
  }))
  imageWorkerApi.patch("/jobs/:id/worker", endpoint(async (req, res) => {
    const id = req.params.id
    const { workerId } = req.body ?? {}
    if (!isUuid(id) || typeof workerId !== "string" || !uuid.test(workerId)) return res.sendStatus(400)
    const { rows } = await query(`UPDATE ${jobs} SET worker_id=$3,status='queued',lease=NULL,lease_until=NULL
      WHERE id=$1 AND owner_id=$2 AND (status='queued' OR (status='running' AND lease_until <= now()))
      AND EXISTS (SELECT 1 FROM ${workers} WHERE id=$3 AND owner_id=$2 AND NOT revoked)
      RETURNING ${jobColumns}`, [id, owner(req), workerId])
    if (!rows.length) return res.status(409).json({ error: "Only waiting jobs can switch workers." })
    res.json(rows[0])
  }))
  imageWorkerApi.delete("/jobs/:id", endpoint(async (req, res) => {
    if (!isUuid(req.params.id)) return res.sendStatus(404)
    const { rows } = await query(`UPDATE ${jobs} SET status='failed',error_code='DISCARDED'
      WHERE id=$1 AND owner_id=$2 AND status='ready' RETURNING ${jobColumns},asset_path`, [req.params.id,owner(req)])
    if (!rows.length) return res.sendStatus(409)
    if (rows[0].asset_path) await remove([rows[0].asset_path]).catch(() => {})
    res.json(jobView(rows[0]))
  }))
  imageWorkerApi.get("/jobs/:id/asset", endpoint(async (req, res) => {
    if (!isUuid(req.params.id)) return res.sendStatus(404)
    const { rows } = await query(`SELECT asset_path,mime FROM ${jobs}
      WHERE id=$1 AND (status='inserted' OR (owner_id=$2 AND status='ready'))`, [req.params.id, owner(req)])
    const asset = rows[0]
    if (!asset?.asset_path) return res.sendStatus(404)
    const file = await download(asset.asset_path)
    res.set("Cache-Control", "private, no-store").set("X-Content-Type-Options", "nosniff").type(asset.mime).send(Buffer.from(await file.arrayBuffer()))
  }))
  imageWorkerApi.post("/jobs/:id/insert", endpoint(async (req, res) => {
    if (!isUuid(req.params.id)) return res.sendStatus(404)
    const { rows } = await query(`SELECT * FROM ${jobs} WHERE id=$1 AND owner_id=$2 AND status IN ('ready','inserted')`, [req.params.id, owner(req)])
    const job = rows[0]
    if (!job) return res.sendStatus(404)
    if (job.status === "inserted") return res.json(jobView(job))
    const startedAt = new Date().toISOString()
    const runId = randomUUID()
    const article = await loadArticle(job.article_id)
    if (!article || isArticleCompleted(article) || imageAnchor(article, job.suggestion_id)?.anchor !== job.anchor) {
      if (article) await recordRun(runId, await parentRun(article), batchStepLabels.imageInsert, startedAt, "failed", "DRAFT_CHANGED")
      return res.status(409).json({ error: "The draft or placement changed. Generate a fresh suggestion." })
    }
    const { rows: updated } = await query(`UPDATE ${jobs} SET status='inserted' WHERE id=$1 AND status='ready' RETURNING ${jobColumns}`, [job.id])
    if (updated.length) {
      await recordRun(runId, await parentRun(article), batchStepLabels.imageInsert, startedAt, "success")
      return res.json(updated[0])
    }
    const existing = await query(`SELECT ${jobColumns} FROM ${jobs} WHERE id=$1 AND status='inserted'`, [job.id])
    if (!existing.rows.length) {
      await recordRun(runId, await parentRun(article), batchStepLabels.imageInsert, startedAt, "failed", "IMAGE_CHANGED")
      return res.status(409).json({ error: "This image is no longer ready to insert." })
    }
    res.json(existing.rows[0])
  }))

  function jobView(job: Record<string, unknown>) {
    return { id: job.id, suggestion_id: job.suggestion_id, worker_id: job.worker_id, status: job.status, error_code: job.error_code }
  }

  const imageWorkerRunner = Router()
  imageWorkerRunner.post("/heartbeat", endpoint(async (req, res) => {
    if (!await worker(req)) return res.sendStatus(401)
    res.sendStatus(204)
  }))
  imageWorkerRunner.post("/claim", endpoint(async (req, res) => {
    const current = await worker(req)
    if (!current) return res.sendStatus(401)
    const lease = randomUUID()
    const { rows } = await query(`WITH next AS (
      SELECT id,lease FROM ${jobs} WHERE worker_id=$1 AND (status='queued' OR (status='running' AND lease_until <= now()))
      AND EXISTS (SELECT 1 FROM ${workers} WHERE id=$1 AND NOT revoked)
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE ${jobs} AS j SET status='running',lease=$2,lease_until=now()+interval '15 minutes',processing_started_at=NULL
      FROM next WHERE j.id=next.id RETURNING j.id,j.article_id,j.input,next.lease AS previous_lease`, [current.id, lease])
    const job = rows[0]
    if (!job) return res.sendStatus(204)
    if (job.previous_lease) await expireRun(job.previous_lease)
    res.json({ id: job.id, lease, agent: current.agent, input: job.input })
  }))
  imageWorkerRunner.post("/jobs/:id/start", endpoint(async (req, res) => {
    const current = await worker(req)
    const lease = req.body?.lease
    if (!current) return res.sendStatus(401)
    if (!isUuid(req.params.id) || typeof lease !== "string" || !uuid.test(lease)) return res.sendStatus(400)
    const { rows } = await query(`SELECT article_id,suggestion_id,anchor FROM ${jobs}
      WHERE id=$1 AND worker_id=$2 AND lease=$3 AND status='running' AND lease_until > now()`, [req.params.id,current.id,lease])
    if (!rows.length) return res.sendStatus(409)
    const article = await loadArticle(rows[0].article_id)
    if (!article || isArticleCompleted(article) || imageAnchor(article, rows[0].suggestion_id)?.anchor !== rows[0].anchor) {
      await query(`UPDATE ${jobs} SET status='failed',error_code='DRAFT_CHANGED' WHERE id=$1 AND lease=$2 AND status='running'`, [req.params.id, lease])
      return res.sendStatus(409)
    }
    const parent = await parentRun(article)
    const { rows: acknowledged } = await query(`UPDATE ${jobs}
      SET processing_started_at=COALESCE(processing_started_at, now())
      WHERE id=$1 AND lease=$2 AND status='running' AND lease_until > now() RETURNING processing_started_at`, [req.params.id,lease])
    if (!acknowledged.length) return res.sendStatus(409)
    await recordRun(lease, parent, batchStepLabels.imageGenerate, acknowledged[0].processing_started_at, "running")
    res.json({ ok: true })
  }))
  imageWorkerRunner.post("/jobs/:id/result", endpoint(async (req, res) => {
    const current = await worker(req)
    const { lease, image, failed } = req.body ?? {}
    if (!current) return res.sendStatus(401)
    if (!isUuid(req.params.id) || typeof lease !== "string" || !uuid.test(lease)) return res.sendStatus(400)
    const { rows } = await query(`SELECT * FROM ${jobs} WHERE id=$1 AND worker_id=$2 AND lease=$3`, [req.params.id,current.id,lease])
    const job = rows[0]
    if (!job) return res.sendStatus(409)
    if (job.status !== "running") return res.json({ ok: true })
    if (!job.processing_started_at || Date.parse(job.lease_until) <= Date.now()) return res.sendStatus(409)
    const bytes = typeof image === "string" && image.length <= 8_000_000 ? Buffer.from(image, "base64") : null
    const mime = bytes?.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex")) ? "image/png"
      : bytes?.subarray(0,3).equals(Buffer.from("ffd8ff","hex")) ? "image/jpeg"
      : bytes?.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP" ? "image/webp" : null
    const valid = !failed && Boolean(mime)
    const asset = valid ? `image-workers/${job.id}/${randomUUID()}` : null
    if (asset && bytes && mime) await upload(asset, bytes, mime)
    let written = false
    try {
      const result = await query(`UPDATE ${jobs} SET status=$4,asset_path=$5,mime=$6,error_code=$7,input='{}'::jsonb
        WHERE id=$1 AND worker_id=$2 AND lease=$3 AND status='running' AND lease_until > now()
        AND EXISTS (SELECT 1 FROM ${workers} WHERE id=$2 AND NOT revoked)`,
      [job.id,current.id,lease,valid ? "ready" : "failed",asset,valid ? mime : null,valid ? null : "RENDER_FAILED"])
      written = Boolean(result.rowCount)
    } finally {
      if (asset && !written) await remove([asset]).catch(() => {})
    }
    if (!written) return res.sendStatus(409)
    const article = await loadArticle(job.article_id).catch(() => null)
    const parent = article ? await parentRun(article).catch(() => `single:${job.article_id}`) : `single:${job.article_id}`
    await recordRun(lease, parent, batchStepLabels.imageGenerate, job.processing_started_at, valid ? "success" : "failed", valid ? null : "RENDER_FAILED")
    res.json({ ok: true })
  }))
  return { imageWorkerApi, imageWorkerRunner }
}

export const { imageWorkerApi, imageWorkerRunner } = createImageWorkers()
