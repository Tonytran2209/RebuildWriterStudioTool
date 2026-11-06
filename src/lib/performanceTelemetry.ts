import { authenticatedRailwayFetch } from "./db";

export function sendOutlinePerformanceSample(metric: "clickLatency" | "responseTime", startedAt: number) {
  if (document.hidden) return;
  // The second frame runs after the first frame has had an opportunity to paint.
  requestAnimationFrame(() => {
    const ms = performance.now() - startedAt;
    requestAnimationFrame(() => {
      if (document.hidden) return;
      const options = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metric, ms }),
        keepalive: true,
      };
      void authenticatedRailwayFetch("/api/monitoring/ui-sample", options, window.location.origin).catch(() => {});
    });
  });
}
