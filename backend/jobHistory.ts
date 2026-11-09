const technicalFailure = /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|timeout|timed out)\b|\b(?:HTTP|status(?: code)?)\s*[:=]?\s*5\d{2}\b/i

const rejectedOutput = /^(?:Brief còn thông tin N\/A\.|AI did not return a valid JSON object after one automatic format recovery\.|Batch Step 1 did not return a valid rated Core Idea\.)/

type JobRecord = {
  job: string
  workload: string
  status: "completed" | "failed"
  valid: boolean
  startedAt: string | Date | null
  endedAt: string | Date | null
  recordedAt?: string | Date | null
  error: string | null
  // Optional run linkage for AI Agent Lab's run history (jobRuns).
  runId?: string | null
  parentRunId?: string | null
  parent?: string | null
  title?: string | null
}

// A run sent only to jobRuns (not counted in jobHistory): a parent of other runs, or a sub-job
// step of a run (parentRunId + parent name the run it belongs to).
export type ParentRun = {
  job: string
  runId: string
  workload: string
  status: "success" | "failed" | "running"
  startedAt: string | null
  endedAt: string | null
  parentRunId?: string
  parent?: string
  // Reconstructed from other saved timestamps, not measured: AI Agent Lab shows it in run
  // history but keeps it out of P95, targets and job detection.
  estimated?: boolean
}

type StepRecord = { key?: unknown; label?: unknown; startedAt?: unknown; endedAt?: unknown; status?: unknown }

// Last AI call of each step inside one article run (writer_ai_usage.called_at).
export type CallMarks = { seo?: unknown; spec?: unknown; outline?: unknown }

// Estimated sub-jobs for an article finished before step timings were saved. Each segment ends at
// the last AI call of its step and starts where the previous step ended; a segment is only sent
// when both of its ends are known and in order. "Nhận bài từ Content Plan" (milliseconds) is not
// estimated, and draft and quality share step 4 calls, so they are one combined segment.
export function estimatedStepRuns(marks: CallMarks | null | undefined, article: { runId: string; job: string; workload: string; startedAt: unknown; endedAt: unknown }): ParentRun[] {
  const start = iso(article.startedAt as string), end = iso(article.endedAt as string)
  if (!marks || !start || !end) return []
  const at = (value: unknown) => {
    const time = iso(value as string)
    return time && Date.parse(time) >= Date.parse(start) && Date.parse(time) <= Date.parse(end) ? time : null
  }
  const seo = at(marks.seo), spec = at(marks.spec), outline = at(marks.outline)
  const segments: [string, string, string | null, string | null][] = [
    ["seo", "Nghiên cứu từ khóa SEO", start, seo],
    // Without a web-search call the research came from the 24h cache.
    ["spec", "Article Spec & Core Idea", seo ?? start, spec],
    ["outline", "Lập outline", spec, outline],
    ["draft-quality", "Viết draft & kiểm tra chất lượng", spec && outline, end],
  ]
  return segments.flatMap(([key, job, from, to]) =>
    from && to && Date.parse(from) <= Date.parse(to)
      ? [{ job, runId: article.runId + ":est:" + key, workload: article.workload, status: "success" as const,
          startedAt: from, endedAt: to, parentRunId: article.runId, parent: article.job, estimated: true }]
      : [])
}

// Sub-job runs of one article from its saved step timings. Running or malformed steps are skipped;
// nothing is inferred for steps without a saved start and end.
export function articleStepRuns(steps: unknown, article: { runId: string; job: string; workload: string }): ParentRun[] {
  if (!Array.isArray(steps)) return []
  return (steps as StepRecord[]).slice(0, 12).flatMap((step) => {
    const startedAt = iso(step?.startedAt as string), endedAt = iso(step?.endedAt as string)
    if (typeof step?.label !== "string" || !step.label.trim() || !startedAt || !endedAt || Date.parse(startedAt) > Date.parse(endedAt)) return []
    if (step.status !== "completed" && step.status !== "failed") return []
    return [{
      job: step.label.trim().slice(0, 80), runId: article.runId + ":" + String(step.key ?? step.label).slice(0, 40),
      workload: article.workload, status: step.status === "completed" ? "success" as const : "failed" as const,
      startedAt, endedAt, parentRunId: article.runId, parent: article.job,
    }]
  })
}

export function summarizeJobHistory(rows: JobRecord[], limit: number) {
  const durations = new Map<string, { job: string; workload: string; values: number[] }>()
  let latest: { job: string; workload: string; durationMs: number; end: number } | null = null
  let executed = 0, failed = 0, technicalErrors = 0, unclassifiedFailures = 0, validCompletions = 0, unverifiedCompletions = 0
  for (const row of rows.slice(0, limit)) {
    if (row.status !== "completed" && row.status !== "failed") continue
    executed++
    if (row.status === "failed") {
      failed++
      if (technicalFailure.test(row.error ?? "")) technicalErrors++
      else if (!rejectedOutput.test(row.error ?? "")) unclassifiedFailures++
    } else if (row.valid) {
      validCompletions++
    } else {
      unverifiedCompletions++
    }

    if (!row.startedAt || !row.endedAt) continue
    const end = new Date(row.endedAt).getTime()
    const duration = end - new Date(row.startedAt).getTime()
    if (!Number.isFinite(duration) || duration < 0) continue
    const key = JSON.stringify([row.job, row.workload])
    const group = durations.get(key) ?? { job: row.job, workload: row.workload, values: [] }
    group.values.push(duration)
    if (!latest || end > latest.end) latest = { job: row.job, workload: row.workload, durationMs: duration, end }
    durations.set(key, group)
  }
  return {
    latestJob: latest ? {
      job: latest.job, workload: latest.workload, durationMs: latest.durationMs,
    } : null,
    executed, failed, technicalErrors, unclassifiedFailures, validCompletions, unverifiedCompletions,
    complete: rows.length <= limit,
    completion: [...durations.values()].map(({ job, workload, values }) => ({
      job, workload, samples: values.length,
      p95Ms: values.sort((a, b) => a - b)[Math.ceil(0.95 * values.length) - 1],
    })),
  }
}

const iso = (value: string | Date | null | undefined) => {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

// app-monitoring-v1 `jobRuns`: terminal runs of the last 61 days, newest first, for AI Agent Lab to
// compute its own periods, comparisons and per-job error rates. Counts and timestamps only.
// app-monitoring-v1 `jobRuns`: runs of the last 61 days, newest first, for AI Agent Lab to compute
// its own periods, comparisons, per-job success rates and run history. The workload names the
// document or item the run worked on; no content leaves the app.
export function jobRuns(rows: JobRecord[], now: number, max = 5000, parents: ParentRun[] = []) {
  const since = now - 61 * 86400000
  type Run = { job: string; workload: string; status: "success" | "failed" | "running"; startedAt: string | null; endedAt: string | null
    runId?: string; parentRunId?: string; parent?: string }
  const runs: Run[] = []
  let truncated = false
  for (const row of rows) {
    if (row.status !== "completed" && row.status !== "failed") continue
    const endedAt = iso(row.endedAt) ?? iso(row.recordedAt)
    if (!endedAt || Date.parse(endedAt) < since) continue
    if (runs.length >= max) { truncated = true; break }
    const startedAt = iso(row.startedAt)
    const title = row.title?.trim()
    runs.push({
      job: row.job, workload: title ? (row.workload + " · " + title).slice(0, 200) : row.workload,
      status: row.status === "completed" ? "success" : "failed",
      startedAt: startedAt && Date.parse(startedAt) <= Date.parse(endedAt) ? startedAt : null, endedAt,
      ...(row.runId ? { runId: String(row.runId) } : {}),
      ...(row.parentRunId ? { parentRunId: String(row.parentRunId) } : {}),
      ...(row.parent ? { parent: row.parent } : {}),
    })
  }
  for (const parent of parents) {
    const at = parent.endedAt ?? parent.startedAt
    if (!at || Date.parse(at) < since) continue
    if (runs.length >= max) { truncated = true; break }
    runs.push({ ...parent, workload: parent.workload.slice(0, 200) })
  }
  runs.sort((a, b) => Date.parse(b.endedAt ?? b.startedAt ?? "") - Date.parse(a.endedAt ?? a.startedAt ?? ""))
  return { since: new Date(since).toISOString(), complete: !truncated, runs }
}

export function jobHistoryWindows(rows: JobRecord[], since: string, limit: number, now = Date.now(), parents: ParentRun[] = []) {
  const start = Date.parse(since)
  const recent = rows.filter(({ recordedAt }) => recordedAt && new Date(recordedAt).getTime() >= start)
  const runs = jobRuns(rows, now, 5000, parents)
  return {
    jobRuns: { ...runs, complete: rows.length <= limit && runs.complete },
    jobHistory: summarizeJobHistory(recent, limit),
    jobHistoryAllTime: summarizeJobHistory(rows, limit),
  }
}

type UsageCall = { step?: unknown; purpose?: unknown; model?: unknown; calledAt?: unknown; startedAt?: unknown; durationMs?: unknown }
type Interval = [number, number]

// Length of the union of intervals: parallel calls are not double-counted, pauses are not counted.
function unionMs(intervals: Interval[]) {
  let total = 0, end = -Infinity
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) {
    if (b <= end) continue
    total += b - Math.max(a, end)
    end = b
  }
  return total
}

const singleStepOf = (call: UsageCall): { key: string; label: string } | null => {
  const purpose = String(call.purpose ?? "")
  if (call.step === 2) return purpose === "seo-research" || /web-search/i.test(String(call.model ?? ""))
    ? { key: "seo", label: "Nghiên cứu từ khóa SEO" } : { key: "spec", label: "Article Spec & Core Idea" }
  if (call.step === 3) return { key: "outline", label: "Lập outline" }
  if (call.step === 4) return purpose === "recheck" ? { key: "quality", label: "Kiểm tra chất lượng" } : { key: "draft", label: "Viết draft" }
  return null
}

// A step-by-step (single) article: the user runs each step, with reading and review in between.
// Each step is its last session of AI calls (a gap over 10 minutes starts a new session) and its
// time is the processing time of those calls. The article run's time is the sum of its steps, not
// the wall-clock time including human review. Calls saved before timing existed have no duration:
// the article is then listed without time or steps.
export function singleArticleRuns(article: { runId: string; job: string; workload: string; usage: unknown; endedAt: unknown }): ParentRun[] {
  const calls = (article.usage && typeof article.usage === "object" ? Object.values(article.usage as Record<string, unknown>) : [])
    .flatMap((value) => (Array.isArray(value) ? value : [])) as UsageCall[]
  const groups = new Map<string, { label: string; calls: { start: number | null; end: number }[] }>()
  for (const call of calls.slice(-400)) {
    const step = singleStepOf(call), end = Date.parse(String(call.calledAt ?? ""))
    if (!step || !Number.isFinite(end)) continue
    const duration = Number(call.durationMs), start = Number.isFinite(duration) && duration >= 0 ? end - duration : null
    const group = groups.get(step.key) ?? { label: step.label, calls: [] }
    group.calls.push({ start, end })
    groups.set(step.key, group)
  }
  const steps: ParentRun[] = []
  let lastEnd = -Infinity, total = 0, measured = groups.size > 0
  for (const [key, group] of groups) {
    const sorted = group.calls.sort((a, b) => a.end - b.end)
    let first = sorted.length - 1
    while (first > 0 && (sorted[first].start ?? sorted[first].end) - sorted[first - 1].end <= 10 * 60000) first--
    const session = sorted.slice(first)
    const end = session.at(-1)!.end
    lastEnd = Math.max(lastEnd, end)
    if (session.some((c) => c.start === null)) { measured = false; continue }
    const ms = unionMs(session.map((c) => [c.start!, c.end] as Interval))
    total += ms
    steps.push({ job: group.label, runId: article.runId + ":" + key, workload: article.workload, status: "success",
      startedAt: new Date(end - ms).toISOString(), endedAt: new Date(end).toISOString(), parentRunId: article.runId, parent: article.job })
  }
  const fallbackEnd = Date.parse(iso(article.endedAt as string) ?? "")
  const endedAt = Number.isFinite(lastEnd) ? lastEnd : fallbackEnd
  if (!Number.isFinite(endedAt)) return []
  return [
    { job: article.job, runId: article.runId, workload: article.workload, status: "success",
      startedAt: measured && total > 0 ? new Date(endedAt - total).toISOString() : null, endedAt: new Date(endedAt).toISOString() },
    ...(measured ? steps : []),
  ]
}
