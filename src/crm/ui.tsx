import type { CSSProperties } from "react"
import { measureUiAfterPaint, sendOutlinePerformanceSample, uiInteractionStart } from "../lib/performanceTelemetry"

// Shared bits of the demo markup (pipeline-crm.html helpers).
export const I = ({ n, s }: { n: string; s?: CSSProperties }) => <i className={`ti ti-${n}`} style={s} aria-hidden="true" />
export const PALETTE = ["#4662d5", "#d45452", "#7948af", "#14806e", "#c25700", "#317299", "#b23887", "#307f52", "#997000"]
export const colorOf = (s: string) => PALETTE[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length]
export const Av = ({ name, round, xl }: { name?: string; round?: boolean; xl?: boolean }) =>
  <span className={`av${round ? " round" : ""}${xl ? " xl" : ""}`} style={{ background: colorOf(name ?? "?") }}>{((name ?? "?").trim()[0] ?? "?").toUpperCase()}</span>
export const person = (email?: string) => email ? email.split("@")[0] : ""
export const go = (h: string) => { window.location.hash = h }
export const enc = encodeURIComponent

export const toast = (message: string) => window.dispatchEvent(new CustomEvent("writer:workspace-notice", { detail: { id: Date.now() + Math.random(), message, kind: "success" } }))
export const errText = (err: unknown) => err instanceof Error ? err.message : String(err)

/**
 * ui-kpi-v2 for a click that hands work to the server: call at the top of the handler, right
 * after setting the busy state. clickLatency = click → painted busy state; responseTime =
 * click → painted state after the server accepted the job (not when the job finishes).
 */
export async function trackHandoff<T>(eventTimeStamp: number, job: () => Promise<T>): Promise<T> {
  const start = uiInteractionStart(eventTimeStamp)
  measureUiAfterPaint(start, ms => sendOutlinePerformanceSample("clickLatency", ms))
  const result = await job()
  measureUiAfterPaint(start, ms => sendOutlinePerformanceSample("responseTime", ms))
  return result
}
