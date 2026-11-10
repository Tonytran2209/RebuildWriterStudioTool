// Timing points of the AI Agent Lab "ui-kpi-v2" browser KPIs.
export const UI_KPI_STANDARD = "ui-kpi-v2"
export const UI_KPI_METRICS = ["clickLatency", "responseTime"] as const
export type UiKpiMetric = (typeof UI_KPI_METRICS)[number]

const MAX_EVENT_AGE_MS = 10_000

interface Clock {
  now(): number
  requestAnimationFrame(callback: () => void): unknown
  isHidden(): boolean
}

export const roundKpiMs = (ms: number) => Math.round(ms * 10) / 10

/**
 * Start of an interaction: the click/submit event's timeStamp when it is on
 * the performance.now() clock (positive, not in the future, at most 10 s old),
 * otherwise performance.now() at the start of the handler.
 */
export function interactionStart(eventTimeStamp: number | undefined, now: number): number {
  return typeof eventTimeStamp === "number" && Number.isFinite(eventTimeStamp) &&
    eventTimeStamp > 0 && eventTimeStamp <= now && now - eventTimeStamp <= MAX_EVENT_AGE_MS
    ? eventTimeStamp
    : now
}

/**
 * Calls back with the exact duration (0.1 ms) inside the second nested
 * animation frame after a state change, i.e. once the first frame has had a
 * chance to paint it. Nothing is reported while the page is hidden.
 */
export function measureAfterPaint(startedAt: number, clock: Clock, report: (ms: number) => void) {
  if (clock.isHidden()) return
  clock.requestAnimationFrame(() => {
    clock.requestAnimationFrame(() => {
      if (clock.isHidden()) return
      report(roundKpiMs(clock.now() - startedAt))
    })
  })
}

/** Nearest-rank percentile over raw samples. */
export function nearestRank(values: number[], fraction: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil(fraction * sorted.length))) - 1]
}
