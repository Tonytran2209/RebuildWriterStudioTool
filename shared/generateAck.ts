// Opt-in acknowledgement for POST /api/generate (ui-kpi-v2 responseTime).
//
// A client that sends GENERATE_ACK_HEADER: GENERATE_ACK_VERSION on the outline
// step receives, once the server has validated the request and before it
// loads context or calls the AI, a 200 NDJSON stream:
//   {"type":"accepted"}\n
//   {"type":"result","status":<http status>,"body":<the JSON body the plain route returns>}\n
// Requests rejected before acceptance get the usual JSON status responses, and
// callers without the header get the unchanged single JSON response.

export const GENERATE_ACK_HEADER = "X-Writer-Generate-Ack"
export const GENERATE_ACK_VERSION = "v1"
export const GENERATE_ACK_CONTENT_TYPE = "application/x-ndjson"
export const GENERATE_ACK_INCOMPLETE = "Kết nối tới Railway bị ngắt trước khi nhận được kết quả."

export type GenerateAckEvent =
  | { type: "accepted" }
  | { type: "result"; status: number; body: unknown }

interface AckResponseLike {
  status(code: number): AckResponseLike
  json(body: unknown): unknown
  setHeader(name: string, value: string): unknown
  flushHeaders(): void
  write(chunk: string): unknown
  end(chunk?: string): unknown
  locals: Record<string, unknown>
}

/** Server side: one place that decides between a plain JSON reply and the in-stream result. */
export function createGenerateReply(res: AckResponseLike, enabled: boolean) {
  let accepted = false
  return {
    get accepted() { return accepted },
    accept() {
      if (!enabled || accepted) return
      accepted = true
      res.status(200)
      res.setHeader("Content-Type", GENERATE_ACK_CONTENT_TYPE + "; charset=utf-8")
      res.setHeader("Cache-Control", "no-store")
      res.setHeader("X-Accel-Buffering", "no")
      res.flushHeaders()
      res.write(JSON.stringify({ type: "accepted" } satisfies GenerateAckEvent) + "\n")
    },
    send(status: number, body: unknown) {
      if (!accepted) return res.status(status).json(body)
      // Lets request monitoring count the real outcome, not the stream's 200.
      res.locals.outcomeStatus = status
      return res.end(JSON.stringify({ type: "result", status, body } satisfies GenerateAckEvent) + "\n")
    },
  }
}

export function isGenerateAckResponse(response: { headers: { get(name: string): string | null } }) {
  return (response.headers.get("content-type") ?? "").toLowerCase().startsWith(GENERATE_ACK_CONTENT_TYPE)
}

/**
 * Client side: reads the NDJSON stream, calls onAccepted at the first
 * `accepted` event and resolves with the final status/body. The full result is
 * still consumed; only the clock stops early.
 */
export async function readGenerateAckStream(
  body: ReadableStream<Uint8Array> | null,
  onAccepted: () => void,
): Promise<{ status: number; body: unknown }> {
  if (!body) throw new Error(GENERATE_ACK_INCOMPLETE)
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let acceptedSeen = false
  const handle = (line: string) => {
    if (!line.trim()) return null
    const event = JSON.parse(line) as GenerateAckEvent
    if (event.type === "accepted") {
      if (!acceptedSeen) {
        acceptedSeen = true
        onAccepted()
      }
      return null
    }
    if (event.type === "result") return { status: Number(event.status), body: event.body }
    return null
  }
  for (;;) {
    const { done, value } = await reader.read()
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
    let newline: number
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const result = handle(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      if (result) {
        void reader.cancel().catch(() => {})
        return result
      }
    }
    if (done) {
      const result = handle(buffer)
      if (result) return result
      throw new Error(GENERATE_ACK_INCOMPLETE)
    }
  }
}
