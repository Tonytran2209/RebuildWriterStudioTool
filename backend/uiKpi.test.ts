import test from "node:test"
import assert from "node:assert/strict"
import { interactionStart, measureAfterPaint, nearestRank } from "../shared/uiKpi.ts"

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
