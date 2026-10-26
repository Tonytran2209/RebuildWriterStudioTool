---
schema: agent-hub/data-model/v1
projectId: writer-studio
sourceOfTruth: supabase/migrations + backend/migrations
---

# Database contract

## Principal entities

| Entity | Purpose | Source migration |
| --- | --- | --- |
| `kv_store` | Backward-compatible durable app state | `001` |
| `content_plans`, `content_plan_sources`, `content_plan_items` | Versioned source and planning pipeline | `002` |
| `writer_articles` | Article metadata, payload, draft and batch state | `002` |
| `writer_ai_usage` | Queryable AI usage | `002` |
| `article_stage_runs` | Revisioned core-idea, outline and draft snapshots | `003` |
| `batch_jobs`, `batch_job_items` | Batch status and item outcomes | `003` |
| `article_specs`, `quality_gate_runs`, `editorial_approvals` | Governed writing contracts | `004` |
| `knowledge_items`, `website_content_inventory` | Knowledge and approved internal-link candidates | `004`–`006` |
| `agent_library_versions`, `agent_library_documents`, `agent_library_chunks` | Commit-pinned MD Library retrieval cache | `007` |

## Data invariants

- Optional PostgreSQL Auth has a separate explicit auth:migrate ledger and migrations/002_auth.sql. auth_users stores identities/roles, auth_sessions stores only access/refresh hashes, auth_tokens stores one-time email token hashes, auth_rate_limits persists throttles, auth_audit_events records security events.
- Auth import uses explicit reviewed user UUID/email/role scope; shared Supabase auth.users is not project-isolated merely because app data schemas differ. Never import all source users or silently downgrade MFA. See docs/postgres-auth.md.

- `writer_articles.id` is the stable article identity across client, backend and stage runs.
- A content plan item maps to at most one article in a plan.
- Stage runs are append-only revisions keyed by article, stage and input fingerprint.
- Batch item state is one of `queued`, `running`, `paused`, `completed`, `failed`.
- Quality reports and Article Specs are fingerprinted to prevent stale results from being treated as current.
- Agent Library chunks mirror a canonical Git version; they are not independently editable source documents.

## Migration rules

- Database provider is explicit: DATABASE_PROVIDER=supabase (default) or postgres. DATABASE_URL alone never changes routing. PostgreSQL tables are isolated in writer_studio; AUTH_PROVIDER is independent and defaults to supabase. Supabase Query remains on the source.
- backend/migrations/001_writer_studio.sql is the destination baseline; npm run db:migrate is explicit, ledger/checksum protected and advisory-locked. No startup schema migration. Legacy projection is disabled unless explicitly opted in.
- Shared-source row ownership must be confirmed by exact ID/key manifests; code/table names do not establish production ownership. Import is dry-run by default, uses a read-only source snapshot, and commits only with --apply after counts, full-row checksums and FK validation.
- PostgreSQL stage revision allocation is transaction-locked and deduplicates input fingerprints so approve/backtrack/regenerate does not reuse a revision number.
- Production cutover/rollback, file migration and remaining dependencies: docs/postgres-migration.md. No automatic reverse migration into shared Supabase.

- All schema changes require a new ordered SQL migration; never rewrite an applied migration.
- Additive, backward-compatible changes are preferred. Contract removals require a deprecation plan.
- Database requests must specify rollback, backfill, RLS impact, indexes and API compatibility.
- Service-role backend access is intentional; no client-side change may expose service credentials.

## Universal QC review metadata

Article JSON payloads retain optional `qualityReport.inputFingerprint` (qc-9) alongside the existing specification fingerprint. This identifies exactly which content and source inputs were reviewed. Existing reports are preserved and treated as requiring an explicit re-check; no relational schema migration or automatic rewrite is needed. New/rechecked specifications use the same canonical spec-2 fingerprint in the browser and backend. `QualityGateCheck.blocking` may mark a warning as blocking, but cannot waive evidence, incomplete-review or stale-review warnings. Outline sections may store `grounding: evidence-led | editorial-guidance`; this restricts guidance-only prose and does not prove factual support.
