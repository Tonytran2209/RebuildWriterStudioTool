import { authenticatedRailwayFetch } from "./db";
import { interactionStart, measureAfterPaint, type UiKpiMetric } from "../../shared/uiKpi";

const browserClock = {
  now: () => performance.now(),
  requestAnimationFrame: (callback: () => void) => requestAnimationFrame(callback),
  isHidden: () => document.hidden,
};

/** ui-kpi-v2 start: the event's timeStamp when usable, else now (call at the top of the handler). */
export function uiInteractionStart(eventTimeStamp?: number) {
  return interactionStart(eventTimeStamp, performance.now());
}

/** Measures start → second animation frame after the state change just committed. */
export function measureUiAfterPaint(startedAt: number, report: (ms: number) => void) {
  measureAfterPaint(startedAt, browserClock, report);
}

export function sendOutlinePerformanceSample(metric: UiKpiMetric, ms: number) {
  if (document.hidden) return;
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metric, ms }),
    keepalive: true,
  };
  void authenticatedRailwayFetch("/api/monitoring/ui-sample", options, window.location.origin).catch(() => {});
}
