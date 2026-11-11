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
    const claude = await (await request(api + "/workers", "POST", { name: "Mac One", agent: "claude" }, undefined, 201)).json()
    const codex = await (await request(api + "/workers", "POST", { name: "Mac Two", agent: "codex" }, undefined, 201)).json()
    const [claudeId] = claude.token.split(".")
    const [codexId] = codex.token.split(".")
    const queued = await (await request(api + "/articles/article-1/jobs", "POST", { workerId: claudeId, suggestionId: "visual" }, undefined, 202)).json()
    await request(runner + "/claim", "POST", {}, codex.token, 204)
    await request(api + `/jobs/${queued.id}/worker`, "PATCH", { workerId: codexId })
    await request(runner + "/claim", "POST", {}, claude.token, 204)
    const claimed = await (await request(runner + "/claim", "POST", {}, codex.token)).json()
    assert.equal(claimed.agent, "codex")
    assert.equal(claimed.input.brief, "PRIVATE_BRIEF")
    await request(runner + `/jobs/${claimed.id}/start`, "POST", { lease: claimed.lease }, codex.token)
    const readReport = async () => (await request("/internal/monitoring?days=1", "GET", undefined, secret)).json()
    const running = await readReport()
    assert.equal(running.jobRuns.runs[0].status, "running")
    assert.equal(running.jobRuns.runs[0].endedAt, null)
    const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD/oAAAAASUVORK5CYII="
    const resultPath = runner + `/jobs/${claimed.id}/result`
    await request(resultPath, "POST", { lease: claimed.lease, image }, claude.token, 409)
    await request(resultPath, "POST", { lease: claimed.lease, image }, codex.token)
    await request(resultPath, "POST", { lease: claimed.lease, image }, codex.token)
    assert.equal(files.size, 1)
    assert.equal((await request(api + `/jobs/${claimed.id}/asset`)).headers.get("content-type"), "image/png")
    currentArticle = { ...article, draft: article.draft.replace("Example prose.", "Changed prose.") }
    await request(api + `/jobs/${claimed.id}/insert`, "POST", undefined, undefined, 409)
    currentArticle = article
    await request(api + `/jobs/${claimed.id}/insert`, "POST")
    await request(api + `/jobs/${claimed.id}/insert`, "POST")
    const result = await readReport()
    assert.deepEqual(result.profile.mainJob.steps.slice(-2), ["Tạo ảnh minh họa", "Chèn ảnh vào bài"])
    assert.equal(result.jobRuns.runs.length, 3)
    assert.equal(result.jobRuns.runs.filter((run: any) => run.status === "failed").length, 1)
    assert.ok(result.jobRuns.runs.every((run: any) => run.parentRunId === "single:article-1" && run.startedAt && run.endedAt))
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_BRIEF|PRIVATE_TITLE|Example prose|Mac Two/)
    await query("INSERT INTO writer_studio.image_worker_runs (id,parent_run_id,job,status) VALUES (gen_random_uuid(),'single:article-1','Tạo ảnh minh họa','running')")
    assert.equal((await readReport()).jobRuns.runs.length, 3)
    await request(api + `/workers/${codexId}`, "PATCH", { action: "revoke" })
    await request(runner + "/claim", "POST", {}, codex.token, 401)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await monitor.stop()
    await pg.close()
  }
})
