---
schema: agent-hub/data-model/v1
projectId: writer-studio
sourceOfTruth: supabase/migrations
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

- `writer_articles.id` is the stable article identity across client, backend and stage runs.
- A content plan item maps to at most one article in a plan.
- Stage runs are append-only revisions keyed by article, stage and input fingerprint.
- Batch item state is one of `queued`, `running`, `paused`, `completed`, `failed`.
- Quality reports and Article Specs are fingerprinted to prevent stale results from being treated as current.
- Agent Library chunks mirror a canonical Git version; they are not independently editable source documents.

## Migration rules

- All schema changes require a new ordered SQL migration; never rewrite an applied migration.
- Additive, backward-compatible changes are preferred. Contract removals require a deprecation plan.
- Database requests must specify rollback, backfill, RLS impact, indexes and API compatibility.
- Service-role backend access is intentional; no client-side change may expose service credentials.
