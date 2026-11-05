---
schema: agent-hub/api-contracts/v1
projectId: writer-studio
---

# API contract map

All endpoints are served by Railway. Authenticated client calls use `src/lib/db.ts` and `authenticatedRailwayFetch`.

| Domain | Endpoint family | Contract owner |
| --- | --- | --- |
| Auth | `/api/auth/*` | Backend |
| AI generation | `/api/generate`, `/api/seo/research` | Backend/workflow |
| Articles | `/api/articles/*` | Backend + database |
| Content plans | `/api/content-plans/*` | Backend + database |
| Batches | `/api/batches/*` | Backend/workflow |
| Config/files | `/api/config`, `/api/files/*`, imports/uploads | Backend + storage |
| Inventory | `/api/website-inventory/*` | Backend + database |
| Agent Library | `/api/agent-library/status`, `/context`, `/sync` | Agent Hub foundation |

## Error contract

- Return stable machine-readable `code` values for policy/prerequisite/provider failures.
- Preserve a user-readable `error` message without leaking secrets or raw provider credentials.
- Use `409` for prerequisite, workflow ownership or concurrency conflicts.
- The UI must show the error in the originating flow and retain saved output when applicable.

## API change checklist

Universal QC v9 adds optional `qualityReport.inputFingerprint` and section `grounding` to existing article JSON/checkpoint responses. Re-check saves refreshed section evidence and remapped usage with the new report in the same article update. Spec fingerprint values are opaque versioned identifiers; callers must use the shared canonical function rather than a local SHA implementation. Existing drafts/reports remain readable and require an explicit review to adopt the new metadata.

1. Version or document the request/response change.
2. Update the matching client library call.
3. Update error handling and the relevant Design flow.
4. Verify auth, batch ownership and optimistic-update behavior.

## Agent Library retrieval

- `POST /api/format/google-docs` returns `{markdown, html, formatter: "deterministic-v2", aiCalls: 0}`. Normalize em dashes to hyphens in the export copy only. HTML supports headings, emphasis, links, lists, horizontal rules and Markdown tables with aligned cells. No stored draft is mutated.

- `POST /api/agent-library/sync` compiles the Git canonical `.agent-hub` documents into a commit/content-pinned Supabase index. It is admin-only.
- `GET /api/agent-library/context?q=...&layers=design,backend&maxChars=...` returns only ranked, bounded chunks from the current indexed version.
- `GET /api/agent-library/status` reports whether a current index version exists.
- The index is a retrieval cache, never a replacement for the Git documents. A request records both its base commit and library version.


## Read-only operational monitoring

`GET /internal/monitoring?days=1..30` is separate from user `/api` authentication and requires `Authorization: Bearer <LAB_MONITORING_TOKEN>` (at least 32 characters). An unset token disables the endpoint (503); invalid credentials return 401. Responses use `Cache-Control: no-store` and `protocol: app-monitoring-v1`. Configure the token as a service secret, never a frontend variable.

The endpoint returns aggregate inventory, database round-trip/pool state, current-process CPU/RSS/heap/uptime/commit, API route counts/4xx/5xx/aborts/latency histograms, and central generate-dispatcher AI calls/errors/latencies/tokens/pricing coverage. It excludes article contents, user identifiers, request parameters, prompts and provider credentials. It performs no provider health probe or paid AI call. PostgreSQL aggregate queries use a read-only transaction with a four-second statement timeout; unavailable tables are null. Inventory includes articles deduplicated by ID (per-article KV, legacy KV, relational precedence), relational plans and statuses of workflow/queue/QC tables when present.

New dispatcher/HTTP counters begin at installation. Hourly per-instance snapshots use existing KV keys `lab-monitor:v1:<UTC hour>:<instance UUID>`; a best-effort five-second flush never fails business operations. A crash can lose the last five seconds. Reports select up to 10,000 buckets from a maximum 30-day window and mark truncated reads incomplete. Stored snapshots are not business records; retention cleanup is not yet automated. Current-process resources do not represent all replicas or container limits. Histogram percentiles are bucket upper bounds, not exact sample quantiles. SDK internal retries are not separately counted.

AI cost uses configured model prices at call completion, is an estimate in USD, and remains null without a valid price. Token coverage and priced-call counts are explicit. Historical `writer_ai_usage` is a separate workflow ledger: cache hits are separated from provider calls and its totals must not be added to dispatcher totals. No schema migration, auth/provider change or existing workflow response change is required.


### Task consumption telemetry

`app-monitoring-v1` additionally returns `taskUsage` (`task-usage-v1`), separately selected `historicalTasks`, and `taskReadComplete`. Gate/batch operations own an async-local UUID so calls across application retries and models share one task. API request contexts cover frontend operations; detached/unknown calls are explicitly unattributed. No prompt, response content, full request URL or credential is persisted. Best-effort per-task KV snapshots use `lab-task:v1:<UUID>` at five-second intervals. Read at most 1,000 rows/source, retain bounded in-memory rows, return per-call detail only for the latest 50 tasks and at most ten calls each; aggregate totals retain every recorded call, with detail/coverage truncation flags. Missing usage/pricing never means zero. Historical stage/gate totals are only saved final-result usage and must never be added to new task totals. The data cohort is tasks started in the requested UTC window, with usage observed for that task to date. No business-data migration, paid probe, new retry policy or generation response change.


## Generation version history (REQ-44E4C670)

GET `/api/articles/:id/stages` retains `{articleId, stages}` and existing stage row fields. Missing stage storage returns 503 `STAGE_HISTORY_UNAVAILABLE`, rather than an empty success. Article updates optionally carry `outlineGeneration: {generationId, createdAt, sections}` and `draftGeneration: {generationId, createdAt, markdown}`. Callers retain this metadata during editor/QC saves. A new UUID belongs to each successful generation checkpoint, including identical outputs; retry the same checkpoint with the same UUID. The history viewer warns if the current generation is absent from returned rows.
