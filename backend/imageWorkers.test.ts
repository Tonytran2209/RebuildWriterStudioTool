import assert from "node:assert/strict"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import test from "node:test"
import express from "express"
import { PGlite } from "@electric-sql/pglite"
import { createImageWorkers, imageAnchor, readImageWorkerRuns } from "./imageWorkers.ts"
import { createMonitoring } from "./monitoring.ts"
import type { Article } from "../src/types/index.ts"

const suggestion = { id: "visual", status: "approved", evidenceSafe: true, afterSectionId: "section", afterHeading: "Example",
  brief: "PRIVATE_BRIEF", altText: "Example diagram", type: "diagram" }
const article = {
  id: "article-1", status: "review", title: "PRIVATE_TITLE", outline: [{ id: "section", heading: "Example" }],
  draft: "# Title\n\n## Example\n\nExample prose.\n\n![Example diagram](image-placeholder://visual)\n\n## Conclusion\n\nEnd.",
  imageSuggestions: [suggestion],
} as Article & { draft: string }

test("image placement requires an approved marker under the exact section", () => {
  const placed = imageAnchor(article, "visual")
  assert.equal(placed?.input.excerpt, "Example prose.")
  assert.equal(imageAnchor({ ...article, draft: article.draft.replace("Example prose.", "Updated prose.") }, "visual")?.anchor === placed?.anchor, false)
  assert.equal(imageAnchor({ ...article, draft: article.draft.replace("## Example", "## Renamed") }, "visual"), null)
  assert.equal(imageAnchor({ ...article, draft: article.draft.replace("![Example diagram](image-placeholder://visual)", "") }, "visual"), null)
})

test("paired workers claim only their assigned jobs and publish private images and article runs", async () => {
  const pg = new PGlite()
  await pg.exec("CREATE SCHEMA writer_studio")
  await pg.exec(await readFile(new URL("./migrations/003_image_workers.sql", import.meta.url), "utf8"))
  await pg.exec(await readFile(new URL("./migrations/004_image_style_library.sql", import.meta.url), "utf8"))
  const query = async (sql: string, params?: unknown[]) => {
    const result = await pg.query(sql, params)
    return { rows: result.rows, rowCount: result.affectedRows }
  }
  const files = new Map<string, Blob>()
  let currentArticle = article
  const { imageWorkerApi, imageWorkerRunner } = createImageWorkers({
    query, loadArticle: async () => currentArticle, available: () => true,
    upload: async (key, data, mime) => { files.set(key, new Blob([new Uint8Array(data)], { type: mime })) },
    download: async key => files.get(key)!,
    remove: async keys => { for (const key of keys) files.delete(key) },
  })
  const secret = "monitor-token-fixture-01234567890123456789"
  const monitor = createMonitoring("writer-studio", {
    token: () => secret, readImageRuns: () => readImageWorkerRuns(query),
    readData: async () => ({ buckets: [], inventory: undefined, database: { status: "ready" }, articles: null, plans: null,
      ledger: null, contentWorkload: null, jobHistory: null, jobHistoryAllTime: null, complete: true }),
  })
  const app = express()
  app.use(express.json())
  app.use("/api/image-workers", (req, _res, next) => { Object.assign(req, { auth: { userId: "user" } }); next() }, imageWorkerApi)
  app.use("/internal/image-worker", imageWorkerRunner)
  app.get("/internal/monitoring", (req, res) => monitor.handler(req, res))
  const server = app.listen(0, "127.0.0.1")
  await once(server, "listening")
  const origin = "http://127.0.0.1:" + (server.address() as { port: number }).port
  async function request(path: string, method = "GET", body?: unknown, token?: string, expected = 200) {
    const response = await fetch(origin + path, { method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    assert.equal(response.status, expected, path)
    return response
  }
  const api = "/api/image-workers"
  const runner = "/internal/image-worker"
  try {
    const styles = await (await request(api + "/styles")).json()
    assert.ok(styles.some((style: any) => style.id === "editorial-neutral-v1"))
    const claude = await (await request(api + "/workers", "POST", { name: "Mac One", agent: "claude" }, undefined, 201)).json()
    const codex = await (await request(api + "/workers", "POST", { name: "Mac Two", agent: "codex" }, undefined, 201)).json()
    const [claudeId] = claude.token.split(".")
    const [codexId] = codex.token.split(".")
    const reference = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD/oAAAAASUVORK5CYII="
    const style = await (await request(api + "/styles", "POST", { id:"brand-style", name:"Brand style", description:"Editorial",
      visualRules:"Use calm colors.", modelFamily:"sdxl", guide:"# Approved style guide", referenceBase64:reference,
      referenceName:"reference.png" }, undefined, 201)).json()
    assert.equal(style.status, "draft")
    assert.equal((await (await request(api + "/styles/manage")).json())[0].status, "draft")
    const preview = await (await request(api + "/styles/brand-style/1/preview")).json()
    assert.equal(preview.guide, "# Approved style guide")
    assert.equal(preview.referenceBase64, reference)
    await request(api + "/styles/brand-style/1/approve", "POST", {}, undefined, 400)
    await request(api + "/styles/brand-style/1/approve", "POST", { reviewed:true })
    assert.equal((await (await request(runner + "/styles/manifest", "POST", {}, codex.token)).json())[0].id, "brand-style")
    const bundle = await (await request(runner + "/styles/brand-style/1/bundle", "POST", {}, codex.token)).json()
    assert.equal(bundle.guide, "# Approved style guide")
    assert.equal(bundle.referenceBase64, reference)
    assert.ok((await (await request(api + "/styles")).json()).some((item: any) => item.id === "brand-style"))
    await request(api + "/styles", "POST", { id:"brand-style", name:"Brand style", description:"New revision",
      visualRules:"Use restrained blue.", modelFamily:"text-only" }, undefined, 201)
    assert.equal((await (await request(api + "/styles")).json()).find((item: any) => item.id === "brand-style").version, 1)
    await request(api + "/styles/brand-style/2/approve", "POST", { reviewed:true })
    assert.equal((await (await request(api + "/styles")).json()).find((item: any) => item.id === "brand-style").version, 2)
    assert.equal((await (await request(runner + "/styles/brand-style/1/bundle", "POST", {}, codex.token)).json()).visualRules, "Use calm colors.")
    await request(api + "/articles/article-1/jobs", "POST", { workerId: claudeId, suggestionId: "visual", styleId: "unknown" }, undefined, 400)
    const queued = await (await request(api + "/articles/article-1/jobs", "POST", { workerId: claudeId, suggestionId: "visual" }, undefined, 202)).json()
    await request(runner + "/claim", "POST", {}, codex.token, 204)
    await request(api + `/jobs/${queued.id}/worker`, "PATCH", { workerId: codexId })
    await request(runner + "/claim", "POST", {}, claude.token, 204)
    const claimed = await (await request(runner + "/claim", "POST", {}, codex.token)).json()
    assert.equal(claimed.agent, "codex")
    assert.equal(claimed.input.brief, "PRIVATE_BRIEF")
    assert.equal(claimed.input.styleId, "editorial-neutral-v1")
    assert.deepEqual(claimed.input.output, { width: 1280, height: 720, mime: "image/webp" })
    await request(runner + `/jobs/${claimed.id}/start`, "POST", { lease: claimed.lease }, codex.token)
    const readReport = async () => (await request("/internal/monitoring?days=1", "GET", undefined, secret)).json()
    const running = await readReport()
    assert.equal(running.jobRuns.runs[0].status, "running")
    assert.equal(running.jobRuns.runs[0].endedAt, null)
    const webp = Buffer.alloc(30)
    webp.write("RIFF", 0); webp.writeUInt32LE(22, 4); webp.write("WEBPVP8X", 8)
    webp.writeUInt32LE(10, 16); webp.writeUIntLE(1279, 24, 3); webp.writeUIntLE(719, 27, 3)
    const image = webp.toString("base64")
    const resultPath = runner + `/jobs/${claimed.id}/result`
    await request(resultPath, "POST", { lease: claimed.lease, image }, claude.token, 409)
    await request(resultPath, "POST", { lease: claimed.lease, image }, codex.token)
    await request(resultPath, "POST", { lease: claimed.lease, image }, codex.token)
    assert.equal([...files.keys()].filter(key => key.startsWith("image-workers/")).length, 1)
    assert.equal((await request(api + `/jobs/${claimed.id}/asset`)).headers.get("content-type"), "image/webp")
    currentArticle = { ...article, draft: article.draft.replace("Example prose.", "Changed prose.") }
    await request(api + `/jobs/${claimed.id}/insert`, "POST", { reviewed: true }, undefined, 409)
    currentArticle = article
    await request(api + `/jobs/${claimed.id}/insert`, "POST", undefined, undefined, 400)
    await request(api + `/jobs/${claimed.id}/insert`, "POST", { reviewed: true })
    await request(api + `/jobs/${claimed.id}/insert`, "POST", { reviewed: true })
    const result = await readReport()
    assert.deepEqual(result.profile.mainJob.steps.slice(-2), ["Tạo ảnh minh họa", "Chèn ảnh vào bài"])
    const articleRuns = result.jobRuns.runs.filter((run: any) => run.parent === "Writer article")
    assert.equal(articleRuns.length, 3)
    assert.equal(result.jobRuns.runs.filter((run: any) => run.status === "failed").length, 1)
    assert.ok(articleRuns.every((run: any) => run.parentRunId === "single:article-1" && run.startedAt && run.endedAt))
    assert.equal(result.jobRuns.runs.filter((run: any) => run.parent === "Image style library").length, 4)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_BRIEF|PRIVATE_TITLE|Example prose|Mac Two/)
    const syncRunId = "f30b503d-aad4-4820-a675-088844ff0133"
    const startedAt = new Date().toISOString()
    await request(runner + "/styles/sync-run", "POST", { runId:syncRunId,startedAt,status:"running" }, codex.token)
    assert.equal((await readReport()).jobRuns.runs.find((run: any) => run.runId === syncRunId)?.status, "running")
    await request(runner + "/styles/sync-run", "POST", { runId:syncRunId,startedAt,status:"success" }, codex.token)
    const synced = (await readReport()).jobRuns.runs.find((run: any) => run.runId === syncRunId)
    assert.equal(synced.status, "success")
    assert.equal(synced.parent, "Image style library")
    assert.ok(synced.parentRunId.startsWith("style-library:") && synced.startedAt && synced.endedAt)
    await query("INSERT INTO writer_studio.image_worker_runs (id,parent_run_id,job,status) VALUES (gen_random_uuid(),'single:article-1','Tạo ảnh minh họa','running')")
    assert.equal((await readReport()).jobRuns.runs.length, 8)
    await request(api + `/workers/${codexId}`, "PATCH", { action: "revoke" })
    await request(runner + "/claim", "POST", {}, codex.token, 401)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await monitor.stop()
    await pg.close()
  }
})
