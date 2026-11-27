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
- `PATCH /api/files/:id { knowledgeMetadata }` and `DELETE /api/files/:id` (admin) edit one document; `POST /api/files/delete { ids }` (admin, at most 200) deletes several. Delete is permanent: it removes the records and the ids from every `stepConfigs[*].fileAccess`, clears a `primaryPlaybookId` that pointed at them, then deletes the uploaded originals (`storagePath`) and their `knowledge_items` rows (cleanup failures are logged, the library change stays). It returns `{ files, config, deletedIds, missingIds }`; unknown ids are reported in `missingIds`, and a call that deletes nothing returns 404. Upload and import already append to `writer:files`; the CRM reloads `GET /api/files` instead of re-posting the whole list.
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

### Content Plan classification (`content-plan-classifier-v3`, `backend/contentPlanClassifier.ts`)

- Rows labelled `comparison-seo:` / `editorial-originality:` are saved without AI.
- The rest of each source is sent as numbered non-empty lines (`n| text`, at most 300 characters per line), in chunks of about 20,000 characters that run in parallel.
- The AI returns only `{"items":[[lineNumber,"c"|"e"|"r"]]}`. The call uses `temperature 0`, reasoning effort `low` on OpenAI GPT-5+, and an 8,000-token cap. Every list of titles counts (priority topics, backlogs and action plans alike).
- The title is copied from the file line, with list markers and markdown removed; text after ` | ` becomes keywords.
- The group follows the first rule that applies:
  1. the closest numbered or markdown heading above the line, when that heading names Comparison or Editorial;
  2. the title's wording (`Why…`, `not`, `cannot` and `fails` mean editorial; `vs`, `alternatives`, `instead of`, `different from`, `best/top`, `template`, `how to price/choose/evaluate` mean comparison);
  3. the AI's letter.
- The same topic listed twice (identical, or a shortened copy sharing ≥85% of its key words) is merged into its first title. The merged topic takes the group of its most certain copy.
- A truncated or unreadable answer is split in half and retried, up to two levels. The cache key is classifier version + model + chunk-text hash + the prompt-facing admin settings. Line numbers that match no line are reported in `classificationDropped`.
- Background run: `POST /api/content-plans/import` with `classify=1` (form field or JSON `classify: true`), or `POST /api/content-plans/:id/classify?background=1`, sets the plan to `processing`, answers immediately (`201`/`202`) and classifies after the response. The plan ends as `ready`, or as `failed` with `classificationError`. `writer:content-plan-run:<planId>` keeps the error, or the dropped topics in `classificationDropped`. A second request for a plan that is already running gets `409`. After a restart, plans left in `processing` become `failed` and the user is asked to classify again. The CRM refreshes processing plans every 2.5 s through `GET /api/content-plans/:id`, and Storage shows them as "Analyzing". The Storage upload panel, Storage documents and the plan page's Classify button all use the background run. Add Plan still classifies synchronously, because it starts batches right after.
- Admin settings (`config.contentPlan`, Settings › Workflow AI › "Phân loại Content Plan", saved through `POST /api/config`, admin only). `shared/contentPlanSettings.ts` normalizes them on every read: unknown fields are dropped, lengths are capped, and missing or empty fields use the defaults. The defaults reproduce the rules above.
  - `systemPrompt` (≤2,000 chars) and `rulesPrompt` (≤8,000 chars) are the prompt itself, shown and edited in full. The tool always appends `CLASSIFIER_ANSWER_FORMAT` (the JSON answer with line numbers, `c`/`e`/`r`) and then the numbered lines, so any rules still produce a readable answer. Both prompts are part of the AI cache key, so editing them asks the AI again.
  - Toggles: `useHeadings` (rule 1) with `comparisonHeadings` / `editorialHeadings`, `useTitleWords` (rule 2) with `comparisonPhrases` / `editorialPhrases`, `mergeDuplicates` with `duplicateSensitivity` (`strict` 95%/85%, `normal` 85%/70%, `loose` 75%/60%: containment/overlap), and `keepNeedsReview` (off = unsure topics become Editorial). With both rules off, the AI's prompt alone decides groups.
  - Word lists: whole words, ≤40 entries of ≤60 chars. `^` first = the text starts with it, `#` = any number, `*` = any letters. They are escaped into a plain alternation, never used as raw regex. Editorial wins over comparison except in titles with `vs`/`versus`.
  - No daily AI-call limit for classification.
- Topic ids are stable per source line (`line-<sha256(sourceId|line)>`). After each successful classification, the AI's picks are saved in `writer:content-plan-picks:<planId>` (`{sources: {sourceId: [[line, letter]]}}`). Deleting a plan deletes this key and `writer:content-plan-run:<planId>`.
- `POST /api/content-plans/:id/reapply` (admin only) rebuilds the plan's topics from the saved picks under the settings, without an AI call.
  - With `{dryRun: true, settings}`, it returns `{preview: {before, after, changed[], added[], removed[]}}` for the unsaved draft settings and saves nothing.
  - Without `dryRun`, it applies the saved settings. Group changes are written in place: ids, item status and article links are kept, and manual group edits are overwritten. If topics would be added or merged away, the plan is rewritten, which is refused (`409`) once it has articles.
  - Plans classified before picks were saved get `409` until they are classified again. A plan that is `processing` gets `409`.
  - Applying is logged as a `Phân loại Content Plan` run with workload `Áp dụng lại rule · <plan name>`.
- Monitoring: each run that does work is saved as `lab-run:v1:<runId>` with job `Phân loại Content Plan`, `parent: "Writer article"`, workload `Content Plan · <plan name>`, `status`, `startedAt`, `endedAt`, `items {total, succeeded}` and an error code (`DATABASE_ERROR` when a PostgreSQL write or read failed, otherwise the AI error code such as `AI_PROVIDER_ERROR`). It is reported in `jobRuns` and declared as the first step of `profile.mainJob.steps`. Finished runs also count in `jobHistory` / `jobHistoryAllTime` (`executed`, `failed`, `validCompletions`, `latestJob`, `completion`); `DATABASE_ERROR`, `AI_PROVIDER_ERROR`, `AI_PROVIDER_QUOTA_EXCEEDED` and `AI_CREDITS_EXHAUSTED` count as `technicalErrors`, while refusals by HTTP status (`404`/`409`/`422`) count as `unclassifiedFailures`. Running runs are not counted. It has no `parentRunId`, because it runs once per plan, before any article run exists.

Settings › Workflow rules edits these plus the primary Playbook per gate (`stepConfigs[2|3|4].primaryPlaybookId`), every pipeline number and switch (`gateSettings`, ids in `shared/gateSettings.ts`; `POST /api/config` drops unknown keys and clamps values before saving) and, for a gate without a primary Playbook, a team note (`workflowRules[core-idea|outline|draft].customInstruction`). `gateDocumentsVersion` is set to 2 by the startup migration (see `backend/workflow.md` › Gate documents). `PATCH /api/files/:id` accepts `storageGroup` `Domain Knowledge`, `Playbooks` or `Standards` (`Voice & Style` is refused) and `knowledgeMetadata.type` including `brand_voice`. Articles may carry `introductionBudget {min,max,paragraphs}`, `draftFormat {conclusionHeading,titleKeyword}` and `gateReviews {2|3: {status,checks,rounds,outputHash,standards,reviewedAt,error?}}`. Enforcement, execution modes and per-stage text are no longer editable; old values still compile until "Reset to defaults".

## Roles and accounts (PostgreSQL auth)

- Roles: `admin`, `user` (Content Operator), `reviewer`. Reviewers may read everything but write only `humanReview` / `approvedArticle` through `PUT /api/articles/:id`; other writes return 403. Admin-only routes are unchanged.
- `POST /api/auth/login` accepts `email` as an email address or a username. The session `user.email` field carries the display identity: username when set, else email.
- Migration `backend/migrations/008_auth_roles_usernames.sql` (auth migration version 2, `npm run auth:migrate`) adds `username`, the `reviewer` role and allows username-only accounts.
- `ACCOUNT_PASSWORD=... npm run auth:accounts -- --account=<username>:<user|reviewer|admin>[:<existing username, email or email name>] [--apply]` creates or updates accounts; dry-run by default, keeps at least one active admin, signs updated accounts out. Never commit the password.
