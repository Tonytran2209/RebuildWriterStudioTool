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

- Single and batch drafts share internal-link candidate ranking/deduplication, prompt contract, missing-link insertion and budget/distribution QC. Use the configured word target consistently: 1300–1700 words requires 5–7 unique approved URLs (1500-word default). Keep at most one internal link per section and add missing links only to unoccupied body sections. Short inventories remain a visible QC failure; never invent URLs or count canonical duplicates as separate links.

- Universal QC v9 shares canonical Article Spec and reviewed-input fingerprints between browser and batch. A review records draft, spec, outline, keywords, word target, authorized KB/rules content and relevant workflow settings; model/UI-only changes do not stale the review. Historical reports without this metadata require one explicit re-check, preserving drafts.
- Content Plan supplies topic/intent; Rules supply style; neither is factual evidence. Select verified KB excerpts per section and keep evidence usage explicitly declared. Mark sections without factual KB excerpts as editorial-guidance (no invented statistics, healthcare outcomes or product claims); semantic review still rejects unsupported concrete claims and unmet Article Spec requirements. Do not fill empty usage or treat a valid reference as proof of claim support. Quote verification requires every quoted fragment to exist in its source.
- Re-check refreshes bounded, relevant excerpts from the authorized KB and remaps historical IDs by source/quote/role. If no relevant evidence is available and evidence support is unresolved, preserve the draft and request a source or manual qualification rather than another automatic rewrite. Semantic JSON recovery receives the same registry as the original review.
- Failures, evidence-support warnings, incomplete reviews and stale reviews block completion in manual and batch flows. Other semantic warnings are advisory unless explicitly blocking; retain them visibly in the report.

- Draft introductions use a fixed 60–85 English words in one paragraph, ideally 3–4 concise sentences, aiming for about 5–6 desktop reading lines. This overrides historical introduction percentage settings. Single and batch generation, deterministic QC, semantic review and targeted repair share this contract. Start with the reader's pain point/decision and answer the search intent directly; avoid generic setup and unsupported promises. Allocate the remaining word budget to body sections.

- API or workflow changes require matching updates to `backend/api-contracts.md` and affected UI flow documentation.
- Preserve legacy-compatible step numbers 2/3/4 in storage unless a migration request is explicitly approved.
- Do not add unbounded retries, parallel mutation paths or silent fallback models.
