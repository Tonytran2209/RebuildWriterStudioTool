import { createHash, randomBytes, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
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
const styleVersions = "writer_studio.image_style_versions"
const imageStyles = JSON.parse(readFileSync(new URL("../shared/imageStyles.json", import.meta.url), "utf8")) as Array<{
  id: string; name: string; description: string; visualRules: string; referenceImage: string | null;
  referenceSha256: string | null; approved: boolean; version: number
}>
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value)
const digest = (value: string) => createHash("sha256").update(value).digest("hex")
const styleIdPattern = /^[a-z][a-z0-9-]{2,49}$/
const imageMime = (bytes: Buffer) => bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex")) ? "image/png"
  : bytes.subarray(0,3).equals(Buffer.from("ffd8ff","hex")) ? "image/jpeg"
  : bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP" ? "image/webp" : null
function webpDimensions(bytes: Buffer | null): { width: number; height: number } | null {
  if (!bytes || bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null
  const kind = bytes.toString("ascii", 12, 16)
  if (kind === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
  if (kind === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  if (kind === "VP8L" && bytes[20] === 0x2f) return {
    width: 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8)),
    height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)),
  }
  return null
}
const owner = (req: Request) => (req as Request & { auth: { userId: string } }).auth.userId
const workerColumns = `id, name, agent, preferred, (last_seen > now() - interval '30 seconds') AS online,
  EXISTS (SELECT 1 FROM ${jobs} j WHERE j.worker_id=w.id AND j.status='running' AND j.lease_until > now()) AS busy`
const jobColumns = "id, suggestion_id, worker_id, status, error_code, input->>'styleId' AS style_id"
const publicJobColumns = `id, suggestion_id, worker_id,
  CASE WHEN status='running' AND lease_until <= now() THEN 'queued' ELSE status END AS status, error_code,
  input->>'styleId' AS style_id`

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
    job, CASE WHEN job IN ('${batchStepLabels.imageStyleSave}','${batchStepLabels.imageStyleApprove}','${batchStepLabels.imageStyleSync}')
      THEN 'Image style library' ELSE 'Writer article' END AS parent,
    CASE WHEN job IN ('${batchStepLabels.imageStyleSave}','${batchStepLabels.imageStyleApprove}','${batchStepLabels.imageStyleSync}')
      THEN '1 style version' ELSE '1 image' END AS workload,
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
        if (code === "42P01") return res.status(503).json({ error: "Apply the Image Workers database migrations before using this feature." })
        if (code === "23505") return res.status(409).json({ error: "This item already has an active version or image. Refresh and retry." })
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
      WHERE id=$1 AND secret_hash=$2 AND NOT revoked RETURNING id,agent,owner_id`, [token[1], digest(token[2])])
    return rows[0] ?? null
  }

  const imageWorkerApi = Router()
  async function approvedStyles(userId: string) {
    const { rows } = await query(`SELECT DISTINCT ON (style_id) style_id AS id,name,description,version,visual_rules AS "visualRules",
      guide_path AS "guidePath",guide_sha256 AS "guideSha256",reference_path AS "referencePath",
      reference_sha256 AS "referenceSha256",reference_name AS "referenceName",model_family AS "modelFamily"
      FROM ${styleVersions} WHERE owner_id=$1 AND status='approved' ORDER BY style_id,version DESC`, [userId]).catch(error => {
      if (error.code === "42P01") return { rows: [] }; throw error
    })
    return rows
  }
  imageWorkerApi.get("/styles", endpoint(async (req, res) => {
    const custom = await approvedStyles(owner(req))
    res.json([...imageStyles.filter(style => style.approved).map(({ id, name, description, version }) => ({ id, name, description, version })),
      ...custom.map(({ id, name, description, version }) => ({ id, name, description, version }))])
  }))
  imageWorkerApi.get("/styles/manage", endpoint(async (req, res) => {
    const { rows } = await query(`SELECT style_id AS id,version,name,description,visual_rules AS "visualRules",
      model_family AS "modelFamily",status,reference_name AS "referenceName",guide_path IS NOT NULL AS "hasGuide"
      FROM ${styleVersions} WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100`, [owner(req)])
    res.json(rows)
  }))
  imageWorkerApi.post("/styles", endpoint(async (req, res) => {
    const { id, name, description, visualRules, modelFamily, guide, referenceBase64, referenceName } = req.body ?? {}
    if (typeof id !== "string" || !styleIdPattern.test(id) || imageStyles.some(style => style.id === id) ||
      typeof name !== "string" || !name.trim() || name.length > 80 ||
      typeof description !== "string" || description.length > 240 ||
      typeof visualRules !== "string" || !visualRules.trim() || visualRules.length > 2000 ||
      !["sdxl","text-only"].includes(modelFamily) ||
      (guide != null && (typeof guide !== "string" || Buffer.byteLength(guide,"utf8") > 12_000)) ||
      (referenceBase64 != null && (typeof referenceBase64 !== "string" || referenceBase64.length > 6_000_000 ||
        typeof referenceName !== "string" || referenceName.length > 120 || /[/\\]/.test(referenceName) || !/\.(png|jpe?g|webp)$/i.test(referenceName))))
      return res.status(400).json({ error: "Provide a valid style ID, rules, guide and reference image." })
    const reference = referenceBase64 ? Buffer.from(referenceBase64, "base64") : null
    const mime = reference ? imageMime(reference) : null
    if (reference && (!mime || reference.length > 4_000_000 || modelFamily !== "sdxl"))
      return res.status(400).json({ error: "Reference images require an SDXL style and a PNG, JPEG or WebP file under 4 MB." })
    const userId = owner(req)
    const runId = randomUUID(), startedAt = new Date().toISOString(), parentId = `style-library:${digest(userId).slice(0,16)}`
    await recordRun(runId, parentId, batchStepLabels.imageStyleSave, startedAt, "running")
    try {
    const version = Number((await query(`SELECT COALESCE(max(version),0)+1 AS next FROM ${styleVersions} WHERE owner_id=$1 AND style_id=$2`, [userId,id])).rows[0].next)
    const prefix = `image-styles/${digest(userId).slice(0,24)}/${id}/${version}/${randomUUID()}`
    const guidePath = guide ? `${prefix}/guide.md` : null
    const referencePath = reference ? `${prefix}/reference${mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg"}` : null
    const uploaded: string[] = []
    try {
      if (guidePath) { await upload(guidePath, Buffer.from(guide,"utf8"), "text/markdown"); uploaded.push(guidePath) }
      if (referencePath && reference && mime) { await upload(referencePath, reference, mime); uploaded.push(referencePath) }
      await query(`INSERT INTO ${styleVersions} (owner_id,style_id,version,name,description,visual_rules,guide_path,guide_sha256,
        reference_path,reference_sha256,reference_name,model_family)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [userId,id,version,name.trim(),description.trim(),visualRules.trim(),
        guidePath,guide ? digest(guide) : null,referencePath,reference ? createHash("sha256").update(reference).digest("hex") : null,
        reference ? referenceName : null,modelFamily])
    } catch (error) { if (uploaded.length) await remove(uploaded).catch(() => {}); throw error }
    await recordRun(runId, parentId, batchStepLabels.imageStyleSave, startedAt, "success")
    res.status(201).json({ id,version,status:"draft" })
    } catch (error) { await recordRun(runId, parentId, batchStepLabels.imageStyleSave, startedAt, "failed", "STYLE_SAVE_FAILED"); throw error }
  }))
  imageWorkerApi.get("/styles/:id/:version/preview", endpoint(async (req, res) => {
    const id = String(req.params.id), version = Number(req.params.version)
    if (!styleIdPattern.test(id) || !Number.isSafeInteger(version) || version < 1) return res.sendStatus(400)
    const { rows } = await query(`SELECT guide_path,guide_sha256,reference_path,reference_sha256 FROM ${styleVersions}
      WHERE owner_id=$1 AND style_id=$2 AND version=$3`, [owner(req),id,version])
    const style = rows[0]
    if (!style) return res.sendStatus(404)
    const guide = style.guide_path ? Buffer.from(await (await download(style.guide_path)).arrayBuffer()).toString("utf8") : null
    const reference = style.reference_path ? Buffer.from(await (await download(style.reference_path)).arrayBuffer()) : null
    if ((guide && digest(guide) !== style.guide_sha256) ||
      (reference && createHash("sha256").update(reference).digest("hex") !== style.reference_sha256))
      return res.status(409).json({ error: "Style asset checksum mismatch." })
    res.set("Cache-Control","private, no-store").json({ guide,
      referenceBase64: reference?.toString("base64") ?? null,
      referenceMime: reference ? imageMime(reference) : null })
  }))
  imageWorkerApi.post("/styles/:id/:version/approve", endpoint(async (req, res) => {
    const id = String(req.params.id), version = Number(req.params.version)
    if (!styleIdPattern.test(id) || !Number.isSafeInteger(version) || version < 1 || req.body?.reviewed !== true) return res.sendStatus(400)
    const runId = randomUUID(), startedAt = new Date().toISOString(), parentId = `style-library:${digest(owner(req)).slice(0,16)}`
    await recordRun(runId, parentId, batchStepLabels.imageStyleApprove, startedAt, "running")
    try {
    const { rows } = await query(`UPDATE ${styleVersions} SET status='approved',approved_at=now()
      WHERE owner_id=$1 AND style_id=$2 AND version=$3 AND status='draft' RETURNING style_id AS id,version,status`, [owner(req),id,version])
    if (!rows.length) { await recordRun(runId,parentId,batchStepLabels.imageStyleApprove,startedAt,"failed","STYLE_NOT_DRAFT");
      return res.status(409).json({ error: "Only a saved draft style version can be approved." }) }
    await recordRun(runId,parentId,batchStepLabels.imageStyleApprove,startedAt,"success")
    res.json(rows[0])
    } catch (error) { await recordRun(runId,parentId,batchStepLabels.imageStyleApprove,startedAt,"failed","STYLE_APPROVE_FAILED"); throw error }
  }))
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
    const { workerId, suggestionId, styleId = "editorial-neutral-v1", styleVersion } = req.body ?? {}
    if (typeof workerId !== "string" || !uuid.test(workerId) || typeof suggestionId !== "string") return res.sendStatus(400)
    const style = imageStyles.find(item => item.id === styleId && item.approved) ?? (await approvedStyles(owner(req))).find(item => item.id === styleId)
    if (!style) return res.status(400).json({ error: "Select an approved image style." })
    if (styleVersion != null && styleVersion !== style.version) return res.status(409).json({ error: "The approved style changed. Refresh styles before creating the image." })
    const article = await loadArticle(String(req.params.articleId))
    const placement = article && !isArticleCompleted(article) && imageAnchor(article, suggestionId)
    if (!placement) return res.status(409).json({ error: "Approve the image placement in the current draft first." })
    const { rows } = await query(`INSERT INTO ${jobs}
      (id,owner_id,worker_id,article_id,suggestion_id,anchor,input)
      SELECT $1,$2,id,$4,$5,$6,$7 FROM ${workers} WHERE id=$3 AND owner_id=$2 AND NOT revoked
      RETURNING ${jobColumns}`, [randomUUID(), owner(req), workerId, article.id, suggestionId, placement.anchor,
        { ...placement.input, styleId: style.id, styleVersion: style.version, styleSource: "guidePath" in style ? "custom" : "built-in",
          styleRules: style.visualRules,
          referenceImage: "referenceImage" in style ? style.referenceImage : null,
          referenceSha256: style.referenceSha256,
          styleGuideSha256: "guideSha256" in style ? style.guideSha256 : null,
          output: { width: 1280, height: 720, mime: "image/webp" } }])
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
    if (req.body?.reviewed !== true) return res.status(400).json({ error: "Review the image against the brief before inserting it." })
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
    const input = job.input as { styleId?: string } | undefined
    return { id: job.id, suggestion_id: job.suggestion_id, worker_id: job.worker_id, status: job.status,
      error_code: job.error_code, style_id: job.style_id ?? input?.styleId }
  }

  const imageWorkerRunner = Router()
  imageWorkerRunner.post("/styles/sync-run", endpoint(async (req, res) => {
    const current = await worker(req)
    if (!current) return res.sendStatus(401)
    const { runId, startedAt, status, errorCode } = req.body ?? {}
    if (!isUuid(runId) || typeof startedAt !== "string" || !Number.isFinite(Date.parse(startedAt)) ||
      Math.abs(Date.now() - Date.parse(startedAt)) > 20 * 60_000 ||
      !["running","success","failed"].includes(status) ||
      (errorCode != null && !["SYNC_FAILED","CHECKSUM_INVALID"].includes(errorCode))) return res.sendStatus(400)
    await recordRun(runId, `style-library:${current.id}`, batchStepLabels.imageStyleSync, startedAt, status, errorCode ?? null)
    res.json({ ok:true })
  }))
  imageWorkerRunner.post("/styles/manifest", endpoint(async (req, res) => {
    const current = await worker(req)
    if (!current) return res.sendStatus(401)
    const styles = await approvedStyles(current.owner_id)
    res.json(styles.map(({ id, version, guideSha256, referenceSha256, referenceName, modelFamily }) =>
      ({ id, version, guideSha256, referenceSha256, referenceName, modelFamily })))
  }))
  imageWorkerRunner.post("/styles/:id/:version/bundle", endpoint(async (req, res) => {
    const current = await worker(req)
    if (!current) return res.sendStatus(401)
    const id = String(req.params.id), version = Number(req.params.version)
    if (!styleIdPattern.test(id) || !Number.isSafeInteger(version) || version < 1) return res.sendStatus(400)
    const { rows } = await query(`SELECT guide_path,guide_sha256,reference_path,reference_sha256,reference_name,
      visual_rules,model_family FROM ${styleVersions} WHERE owner_id=$1 AND style_id=$2 AND version=$3 AND status='approved'`,
      [current.owner_id,id,version])
    const style = rows[0]
    if (!style) return res.sendStatus(404)
    const guide = style.guide_path ? Buffer.from(await (await download(style.guide_path)).arrayBuffer()) : null
    const reference = style.reference_path ? Buffer.from(await (await download(style.reference_path)).arrayBuffer()) : null
    if ((guide && digest(guide.toString("utf8")) !== style.guide_sha256) ||
      (reference && createHash("sha256").update(reference).digest("hex") !== style.reference_sha256))
      return res.status(409).json({ error: "Style asset checksum mismatch." })
    res.set("Cache-Control", "no-store").json({ id,version,visualRules:style.visual_rules,modelFamily:style.model_family,
      guide:guide?.toString("utf8") ?? null, guideSha256:style.guide_sha256,
      referenceBase64:reference?.toString("base64") ?? null,referenceSha256:style.reference_sha256,
      referenceName:style.reference_name })
  }))
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
    const { lease, image, failed, errorCode } = req.body ?? {}
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
    const expectedWebp = job.input?.output?.mime === "image/webp"
    const dimensions = webpDimensions(bytes)
    const valid = !failed && Boolean(mime) && (!expectedWebp ||
      (mime === "image/webp" && dimensions?.width === 1280 && dimensions.height === 720)) && bytes!.length <= 6_000_000
    const failureCode = ["STYLE_SYNC_FAILED","STYLE_VERSION_MISMATCH","STYLE_MODEL_MISSING","RENDERER_FAILED","PROMPT_OR_IMAGE_INVALID"].includes(errorCode)
      ? errorCode : "RENDER_FAILED"
    const asset = valid ? `image-workers/${job.id}/${randomUUID()}` : null
    if (asset && bytes && mime) await upload(asset, bytes, mime)
    let written = false
    try {
      const result = await query(`UPDATE ${jobs} SET status=$4,asset_path=$5,mime=$6,error_code=$7,
        input=jsonb_build_object('styleId',input->>'styleId')
        WHERE id=$1 AND worker_id=$2 AND lease=$3 AND status='running' AND lease_until > now()
        AND EXISTS (SELECT 1 FROM ${workers} WHERE id=$2 AND NOT revoked)`,
      [job.id,current.id,lease,valid ? "ready" : "failed",asset,valid ? mime : null,valid ? null : failureCode])
      written = Boolean(result.rowCount)
    } finally {
      if (asset && !written) await remove([asset]).catch(() => {})
    }
    if (!written) return res.sendStatus(409)
    const article = await loadArticle(job.article_id).catch(() => null)
    const parent = article ? await parentRun(article).catch(() => `single:${job.article_id}`) : `single:${job.article_id}`
    await recordRun(lease, parent, batchStepLabels.imageGenerate, job.processing_started_at, valid ? "success" : "failed", valid ? null : failureCode)
    res.json({ ok: true })
  }))
  return { imageWorkerApi, imageWorkerRunner }
}

export const { imageWorkerApi, imageWorkerRunner } = createImageWorkers()
