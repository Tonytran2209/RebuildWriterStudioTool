---
schema: agent-hub/backend-workflow/v1
projectId: writer-studio
---

# Backend and workflow contract

## Runtime ownership

Railway Express (`backend/index.ts`) owns authentication, provider calls, article persistence, content-plan processing, batch orchestration, imports and website inventory. The browser client must use authenticated Railway APIs and must not call provider APIs or Supabase service-role credentials directly.

## Core workflows

- **Content Plan:** imported source → classification → plan items → article activity.
- **Single article:** Core Idea → Outline → Draft; each output persists before next-step controls are exposed.
- **Batch:** process active items with bounded concurrency; item checkpoints update durable status and aggregate batch state.
- **Draft quality:** structured output → deterministic checks → optional semantic review/recheck → persisted report.
- **Inventory:** scan/crawl → classify/summarize → approved pages become internal-link candidates.

## Safety invariants

- Serialize article mutations by article ID.
- Batch workers only process non-terminal items. Do not allow manual AI mutations for active batch items.
- An AI response is parsed, validated and repaired only within its declared workflow stage.
- JSON formatting recovery is an exception path and has distinct cache identity.
- Re-check should target failed checks and avoid regenerating a complete draft unless explicitly requested.

## Change rules

- API or workflow changes require matching updates to `backend/api-contracts.md` and affected UI flow documentation.
- Preserve legacy-compatible step numbers 2/3/4 in storage unless a migration request is explicitly approved.
- Do not add unbounded retries, parallel mutation paths or silent fallback models.
