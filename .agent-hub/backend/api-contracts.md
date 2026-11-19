---
schema: agent-hub/api-contracts/v1
projectId: writer-studio
---

# API contract map

All endpoints are served by Railway. Authenticated client calls use `src/lib/db.ts` and `authenticatedRailwayFetch`.

| Domain | Endpoint family | Contract owner |
| --- | --- | --- |
| Auth | `/api/auth/*` | Backend |
| AI generation | Batch runner (`/api/batches/*`), `/api/seo/research` | Backend/workflow |
| Articles | `/api/articles/*` | Backend + database |
| Content plans | `/api/content-plans/*` | Backend + database |
| Batches | `/api/batches/*` | Backend/workflow |
| Config/files | `/api/config`, `/api/files/*`, imports/uploads | Backend + storage |
| Inventory | `/api/website-inventory/*` | Backend + database |
| Agent Library | `/api/agent-library/status`, `/context`, `/sync` | Agent Hub foundation |

## Shared settings and documents (2026-11-18)

- `writer:config` carries a `revision` counter. `POST /api/config` with a `revision` that is not the stored one returns `409 { code: "CONFIG_CONFLICT" }`; the CRM reloads the latest config and shows the error. A successful save returns `{ ok, revision }`. `websiteInventory` in the body is ignored (inventory is saved per record).
- `PATCH /api/files/:id { knowledgeMetadata }` and `DELETE /api/files/:id` (admin) edit one document. Delete also removes the id from every `stepConfigs[*].fileAccess` and returns `{ files, config }`. Upload and import already append to `writer:files`; the CRM reloads `GET /api/files` instead of re-posting the whole list.
- `GET /api/batch-status?ids=a,b` returns the articles of the watched batches in one load (CRM polling every 2.5 s) and resumes a batch marked running after a server restart.
- `/api/kv*` proxy routes were removed; `/api/upload/*` and `/api/import/*` are admin-only.

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

- `POST /api/agent-library/sync` compiles the Git canonical `.agent-hub` documents into a commit/content-pinned Supabase index. It is admin-only.
- `GET /api/agent-library/context?q=...&layers=design,backend&maxChars=...` returns only ranked, bounded chunks from the current indexed version.
- `GET /api/agent-library/status` reports whether a current index version exists.
- The index is a retrieval cache, never a replacement for the Git documents. A request records both its base commit and library version.


## Read-only operational monitoring

`GET /internal/monitoring?days=1..30` is separate from user `/api` authentication and requires `Authorization: Bearer <LAB_MONITORING_TOKEN>` (at least 32 characters). An unset token disables the endpoint (503); invalid credentials return 401. Responses use `Cache-Control: no-store` and `protocol: app-monitoring-v1`. Configure the token as a service secret, never a frontend variable.

The endpoint returns aggregate inventory, database round-trip/pool state, current-process CPU/RSS/heap/uptime/commit, API route counts/4xx/5xx/aborts/latency histograms, and central generate-dispatcher AI calls/errors/latencies/tokens/pricing coverage. It excludes article contents, user identifiers, request parameters, prompts and provider credentials. It performs no provider health probe or paid AI call. PostgreSQL aggregate queries use a read-only transaction with a four-second statement timeout; unavailable tables are null. Inventory includes articles deduplicated by ID (per-article KV, legacy KV, relational precedence), relational plans and statuses of workflow/queue/QC tables when present.

New dispatcher/HTTP counters begin at installation. Hourly per-instance snapshots use existing KV keys `lab-monitor:v1:<UTC hour>:<instance UUID>`; a best-effort five-second flush never fails business operations. A crash can lose the last five seconds. Reports select up to 10,000 buckets from a maximum 30-day window and mark truncated reads incomplete. Stored snapshots are not business records; retention cleanup is not yet automated. Current-process resources do not represent all replicas or container limits. Histogram percentiles are bucket upper bounds, not exact sample quantiles. SDK internal retries are not separately counted.

The Main Job of every article, batch or step-by-step, is named `Writer article` at report time, so earlier batch history is reported under the same name. The report profile declares `jobTargets: {"Writer article": 10}`.

**Step-by-step (single) articles.** Articles that are not batch items and have a non-empty draft from the last 61 days are also sent in `jobRuns` (only there, never in `jobHistory`). Each is a `Writer article` run with workload `1 SEO article (từng bước) · <title>` or `1 editorial article (từng bước) · …`.
- **Timing source.** The browser now records `startedAt`, `durationMs` and `purpose` on every AI usage record (`/api/generate`, plus `/api/seo/research`, which is now recorded as a step-2 call), stored in the article's `aiUsageByStep`.
- **Process log trace.** Batch-runner usage records in `aiUsageByStep` also carry `durationMs` and `trace` `{ input, output, sources, rules }`: prompt and reply excerpts (≤700 chars each, whitespace collapsed), the KB/Rules document names sent to the model and the compiled workflow rules (`id (strict|guided)`). No full prompt is stored. The CRM manual-mode "Checklist xử lý" pairs these calls with `batchStepRuns` by time window.
- **Sub-jobs.** Each is the last session of its step's calls; a gap over 10 minutes starts a new session. The step's time is the union of its calls' durations.
  - step 2 `seo-research` / web-search → Nghiên cứu từ khóa SEO
  - other step 2 → Article Spec & Core Idea
  - step 3 → Lập outline
  - step 4 → Viết draft
  - step 4 `recheck` → Kiểm tra chất lượng
- **Run time.** The run's time is the sum of its steps (processing time, not human review time). Its `startedAt` is that sum before the last call.
- **No "Nhận bài từ Content Plan".** The single flow does no server work when the user picks an article.
- **Older calls.** Calls saved before timing existed have no duration, so those articles are listed with `startedAt: null` (no time) and no sub-jobs.
- Single runs are reported as successful; the flow has no terminal failure state.

`jobRuns` (AI Agent Lab run history) lists each terminal batch article as one `Writer article` run. Its workload is `1 SEO article · <article title>` (or `1 editorial article · …`), and batch articles are no longer nested under a batch run. The sub-jobs of each article come from `payload.batchStepRuns`, the step timings `runBatchArticle` saves at each checkpoint of the latest attempt. The steps are Nhận bài từ Content Plan, Nghiên cứu từ khóa SEO, Article Spec & Core Idea, Lập outline, Viết draft and Kiểm tra chất lượng. Each step is sent with `parentRunId` = the article run and `parent: "Writer batch article"`. The report also declares this pipeline as `profile` (`profile-v1`, `mainJob.job` + `mainJob.steps`, defined in `backend/batchSteps.ts`). AI Agent Lab therefore lists all six sub-jobs even before they have measured runs. The profile has no `mainJob.title`, so Lab's technical report keeps its content-workload card. Only finished steps with a saved start and end are reported. A resumed attempt records only the steps it runs.

Articles completed in the last 61 days without `batchStepRuns` get **estimated** sub-jobs flagged `estimated: true`. They are built from the last `writer_ai_usage.called_at` per step within the article run:
- web-search model in step 2 → Nghiên cứu từ khóa SEO
- other step-2 calls → Article Spec & Core Idea
- step 3 → Lập outline
- from the outline end to `completed_at` → Viết draft & kiểm tra chất lượng (draft and quality share step-4 calls)

A segment is sent only when both of its ends are known and in order. "Nhận bài từ Content Plan" is not estimated. AI Agent Lab shows estimated steps in run history only, never in P95, targets or job detection. Articles with saved timings always use their measured steps. Steps go only to `jobRuns`, never to `jobHistory` counts. Only labels and timestamps leave the app, never content.

AI cost uses configured model prices at call completion, is an estimate in USD, and remains null without a valid price. Token coverage and priced-call counts are explicit. Historical `writer_ai_usage` is a separate workflow ledger: cache hits are separated from provider calls and its totals must not be added to dispatcher totals. No schema migration, auth/provider change or existing workflow response change is required.


### Task consumption telemetry

`app-monitoring-v1` additionally returns `taskUsage` (`task-usage-v1`), separately selected `historicalTasks`, and `taskReadComplete`. Gate/batch operations own an async-local UUID so calls across application retries and models share one task. API request contexts cover frontend operations; detached/unknown calls are explicitly unattributed. No prompt, response content, full request URL or credential is persisted. Best-effort per-task KV snapshots use `lab-task:v1:<UUID>` at five-second intervals. Read at most 1,000 rows/source, retain bounded in-memory rows, return per-call detail only for the latest 50 tasks and at most ten calls each; aggregate totals retain every recorded call, with detail/coverage truncation flags. Missing usage/pricing never means zero. Historical stage/gate totals are only saved final-result usage and must never be added to new task totals. The data cohort is tasks started in the requested UTC window, with usage observed for that task to date. No business-data migration, paid probe, new retry policy or generation response change.

## Generation history (REQ-44E4C670)

`PUT /api/articles/:id` accepts optional `outlineGenerationId` / `draftGenerationId` at generated-output checkpoints. A fresh ID means a separate generation even when output is identical; retry the same payload with the same ID. The server captures immutable output and context in additive `generationSnapshots` payload metadata; clients must not construct or replace that metadata. Autosave and QC retain IDs and never replace snapshots. `GET /api/articles/:id/stages` returns existing revision rows with optional `output_snapshot.generationId` and `generatedAt`; historical rows without metadata remain readable and are labelled legacy history. History storage failures fail the checkpoint before publishing new article state. No migration or historical backfill.

### Image Workers (removed 2026-11-18)

The image worker, style library and image suggestion APIs were removed from the codebase. Tables created by the former migrations 003/004 (`writer_studio.image_*`) may still exist in PostgreSQL; nothing reads them.

## Removed routes (2026-11-18)

`POST /api/generate` (browser-side AI calls and its NDJSON ack), `POST /api/format/google-docs` and `GET /api/legacy/inventory` had no caller after the CRM moved every AI step to the server batch runner; they were removed. Copy to Docs formats in the browser.

## AI task models (2026-11-19)

`AppConfig.taskModels` picks models for AI calls that are not a pipeline step; an empty value keeps the default.

| Task | Config | Default | Backend |
| --- | --- | --- | --- |
| Content Plan classification | `stepConfigs[1].modelId` | required | `POST /api/content-plans/:id/classify` |
| G1 / G2 / G3 | `stepConfigs[2..4].modelId` | required | batch runner |
| AI Review (semantic review + repair) | `taskModels.review` | G3 model | `runBatchModel(..., { modelTask: "review" })` |
| SEO keyword research | `taskModels.seo` (enabled OpenAI model only; needs web search) | `gpt-5.4-mini` | `researchSeoKeywords(seeds, count, model)` |
| Website Inventory summary | `taskModels.inventory` (any enabled model) | `WEBSITE_SUMMARY_MODEL` env, else `gpt-5.4-mini` | `processWebsiteInventoryUrl` |

Settings › Workflow AI edits these plus the pipeline numbers stored as workflow-rule stage parameters (`keywordCount`, `ideaCount`, `minimumSections`, `conclusionPercent`, `maxSentencesPerParagraph`) and one team instruction per gate (`workflowRules[core-idea|outline|draft].customInstruction`). Enforcement, execution modes and per-stage text are no longer editable; old values still compile until "Reset to defaults".
