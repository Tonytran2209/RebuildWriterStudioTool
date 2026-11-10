import test from "node:test"
import assert from "node:assert/strict"
import express from "express"
import { createGenerateReply, GENERATE_ACK_HEADER, GENERATE_ACK_INCOMPLETE, GENERATE_ACK_VERSION, readGenerateAckStream } from "../shared/generateAck.ts"
import { interactionStart, measureAfterPaint, nearestRank } from "../shared/uiKpi.ts"
import { outcomeStatus } from "./monitoring.ts"

// Browser globals used by src/lib/aiService.ts and src/lib/db.ts.
const storage = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
  window: { location: { origin: "http://127.0.0.1" }, dispatchEvent: () => true, addEventListener: () => {} },
})
// Loaded by path so the backend typecheck does not compile the Vite-resolved
// frontend module graph (extensionless imports); the browser typecheck covers it.
type CallAI = (req: Record<string, unknown>) => Promise<{ content: string }>
const aiServicePath = "../src/lib/aiService.ts"
const { callAI } = (await import(aiServicePath)) as { callAI: CallAI }

const quota = { code: "AI_PROVIDER_QUOTA_EXCEEDED", provider: "openai", modelId: "m", error: "rate limited" }

// Same shape as /api/generate: pre-accept validation, accept, then outcome.
function generateApp(outcome: { status: number; body: unknown }, gate?: Promise<void>, observed?: { status?: number }, reject = false) {
  const app = express()
  app.use(express.json())
  app.use((_req, res, next) => { res.once("finish", () => { if (observed) observed.status = outcomeStatus(res) }); next() })
  app.post("/api/generate", async (req, res) => {
    const reply = createGenerateReply(res, req.body.stepNumber === 3 && req.get(GENERATE_ACK_HEADER) === GENERATE_ACK_VERSION)
    if (reject) return res.status(409).json({ error: "Select an outline structure from Skills & Rules before generating." })
    try {
      reply.accept()
      await gate
      if (outcome.status >= 400) throw Object.assign(new Error("provider"), outcome)
      return reply.send(200, outcome.body)
    } catch (error: any) {
      reply.send(error.status, error.body)
    }
  })
  return app
}

async function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1")
  await new Promise<void>((resolve) => server.once("listening", resolve))
  return { server, url: "http://127.0.0.1:" + (server.address() as { port: number }).port }
}

const request = (url: string, extra: Record<string, unknown> = {}) => ({
  articleId: "a", model: { id: "m", provider: "openai" } as any, railwayUrl: url, prompt: "p", stepNumber: 3 as const, ...extra,
})

test("ack: accepted arrives before the AI finishes and the full result is still delivered", async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const observed: { status?: number } = {}
  const { server, url } = await listen(generateApp({ status: 200, body: { content: "{}", model: "m" } }, gate, observed))
  try {
    const events: string[] = []
    const pending = callAI(request(url, { onAccepted: () => { events.push("accepted"); release() } }))
    const result = await pending
    events.push("result")
    assert.deepEqual(events, ["accepted", "result"], "the AI result was gated on the accepted event reaching the client")
    assert.equal(result.content, "{}")
    assert.equal(observed.status, 200)
  } finally {
    server.close()
  }
})

test("ack: in-stream errors produce the same message as the plain JSON route", async () => {
  const { server, url } = await listen(generateApp({ status: 429, body: quota }))
  const observed: { status?: number } = {}
  const streamed = await listen(generateApp({ status: 429, body: quota }, undefined, observed))
  const gated = await listen(generateApp({ status: 200, body: {} }, undefined, undefined, true))
  try {
    const plain = await callAI(request(url)).then(() => null, (e: Error) => e.message)
    let accepted = 0
    const ack = await callAI(request(streamed.url, { onAccepted: () => accepted++ })).then(() => null, (e: Error) => e.message)
    assert.ok(plain && plain.includes("quota"))
    assert.equal(ack, plain)
    assert.equal(accepted, 1)
    assert.equal(observed.status, 429, "monitoring counts the real outcome, not the stream's 200")
    // Rejected before acceptance: an ordinary JSON status response, no ack.
    accepted = 0
    const rejected = await callAI(request(gated.url, { onAccepted: () => accepted++ }))
      .then(() => null, (e: Error) => e.message)
    assert.equal(accepted, 0)
    assert.equal(rejected, "Railway: Select an outline structure from Skills & Rules before generating.")
  } finally {
    server.close()
    streamed.server.close()
    gated.server.close()
  }
})

test("ack: callers without the opt-in and non-outline steps keep the single JSON response", async () => {
  const { server, url } = await listen(generateApp({ status: 200, body: { content: "x", model: "m" } }))
  try {
    const plain = await fetch(url + "/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stepNumber: 3 }) })
    assert.match(plain.headers.get("content-type") ?? "", /application\/json/)
    const step4 = await fetch(url + "/api/generate", { method: "POST", headers: { "content-type": "application/json", [GENERATE_ACK_HEADER]: GENERATE_ACK_VERSION }, body: JSON.stringify({ stepNumber: 4 }) })
    assert.match(step4.headers.get("content-type") ?? "", /application\/json/)
    const ack = await fetch(url + "/api/generate", { method: "POST", headers: { "content-type": "application/json", [GENERATE_ACK_HEADER]: GENERATE_ACK_VERSION }, body: JSON.stringify({ stepNumber: 3 }) })
    assert.match(ack.headers.get("content-type") ?? "", /application\/x-ndjson/)
    assert.deepEqual((await ack.text()).trim().split("\n").map((l) => JSON.parse(l)), [
      { type: "accepted" }, { type: "result", status: 200, body: { content: "x", model: "m" } },
    ])
  } finally {
    server.close()
  }
})

test("ack stream parser handles split chunks and a stream cut before the result", async () => {
  const encoder = new TextEncoder()
  const stream = (...chunks: string[]) => new ReadableStream<Uint8Array>({
    start(controller) { for (const c of chunks) controller.enqueue(encoder.encode(c)); controller.close() },
  })
  let accepted = 0
  const result = await readGenerateAckStream(stream('{"type":"acc', 'epted"}\n{"type":"result","sta', 'tus":200,"body":{"ok":true}}'), () => accepted++)
  assert.deepEqual(result, { status: 200, body: { ok: true } })
  assert.equal(accepted, 1)
  await assert.rejects(readGenerateAckStream(stream('{"type":"accepted"}\n'), () => {}), new RegExp(GENERATE_ACK_INCOMPLETE))
})

test("ui-kpi-v2 timing: event timeStamp start and end in the second animation frame", () => {
  assert.equal(interactionStart(900, 1000), 900)
  assert.equal(interactionStart(0, 1000), 1000)
  assert.equal(interactionStart(1500, 1000), 1000, "not on the performance.now() clock")
  assert.equal(interactionStart(1000, 12_000), 12_000, "older than 10 s")
  assert.equal(interactionStart(Date.now(), 1000), 1000, "epoch timestamps are rejected")

  let now = 100
  const frames: (() => void)[] = []
  let hidden = false
  const clock = { now: () => now, requestAnimationFrame: (cb: () => void) => frames.push(cb), isHidden: () => hidden }
  const reported: number[] = []
  measureAfterPaint(40, clock, (ms) => reported.push(ms))
  now = 116.04
  frames.shift()!()
  assert.equal(reported.length, 0, "nothing is measured in the first (pre-paint) frame")
  now = 132.36
  frames.shift()!()
  assert.equal(reported.join(), "92.4", "measured inside the second nested frame, rounded to 0.1 ms")

  measureAfterPaint(40, clock, (ms) => reported.push(ms))
  hidden = true
  frames.shift()!(); frames.shift()!()
  measureAfterPaint(40, clock, (ms) => reported.push(ms))
  assert.equal(frames.length, 0)
  assert.equal(reported.join(), "92.4", "hidden pages report nothing")
})

test("nearest-rank P95", () => {
  assert.equal(nearestRank([], 0.95), null)
  assert.equal(nearestRank([5], 0.95), 5)
  assert.equal(nearestRank(Array.from({ length: 100 }, (_, i) => 100 - i), 0.95), 95)
  assert.equal(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10)
})
