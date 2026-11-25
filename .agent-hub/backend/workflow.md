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

## Gate documents (Storage → prompt)

`shared/gateDocuments.ts` is the one source for how Storage files drive a Gate (G1 = step 2, G2 = step 3, G3 and AI review = step 4).

- **Platform contract (code):** gate order, JSON schemas, evidence boundary, confidentiality, English output, editorial approval, cache/budget/monitoring and deterministic measurement. `workflowRules.ts` (version 5) holds only these; it carries no writing criteria or numbers.
- **Roles by Storage group:** a Rules file ticked for a step is sent as `PLAYBOOK` (the step's `stepConfigs[step].primaryPlaybookId`, only while ticked), `STANDARD` (Standards), `VOICE` (Voice & Style) or `SUPPORTING_PLAYBOOK` (other Playbooks). KB is `KNOWLEDGE_BASE` (facts only, excerpted; a file named *vocab* goes whole), the activity plan is `CONTENT_PLAN` (topic only, excerpted). Rule roles go whole.
- **Precedence** (stated to the model in `GATE_DOCUMENT_CONTRACT`): platform contract > STANDARD > PLAYBOOK > SUPPORTING_PLAYBOOK > VOICE; KB and Content Plan never instruct.
- **Numbers:** `keywordCount`, `ideaCount`, `minimumSections`, `introMinWords`, `introMaxWords`, `conclusionPercent`, `maxSentencesPerParagraph` are read from a leading `---` front matter of the Gate's primary Playbook, then a ticked Standards file, then the old workflow-rule stage parameter, then the default (`resolveGateParameters`). Settings shows them read-only with their source.
- A Gate with a primary Playbook no longer sends the Settings team note (`customInstruction`).

## Safety invariants

- Serialize article mutations by article ID.
- Batch workers only process non-terminal items. Do not allow manual AI mutations for active batch items.
- An AI response is parsed, validated and repaired only within its declared workflow stage.
- JSON formatting recovery is an exception path and has distinct cache identity.
- Re-check should target failed checks and avoid regenerating a complete draft unless explicitly requested.

## Change rules

- Single and batch drafts share internal-link candidate ranking/deduplication, prompt contract, missing-link insertion and budget/distribution QC. Use the configured word target consistently: 1300–1700 words requires 5–7 unique approved URLs (1500-word default). Keep at most one internal link per section and add missing links only to unoccupied body sections. Short inventories remain a visible QC failure; never invent URLs or count canonical duplicates as separate links.

- Universal QC v10 shares canonical Article Spec and reviewed-input fingerprints between browser and batch. A review records draft, spec, outline, normalized draft evidence usage, keywords, word target, authorized KB/rules content and relevant workflow settings; model/UI-only changes do not stale the review. Historical reports without this metadata require one explicit re-check, preserving drafts. New reports must be fingerprinted with the same normalized evidence usage persisted with the generated draft; an unchanged report must survive viewing and reload.
- Content Plan supplies topic/intent; Rules supply style; neither is factual evidence. Select verified KB excerpts per section and keep evidence usage explicitly declared. Mark sections without factual KB excerpts as editorial-guidance (no invented statistics, healthcare outcomes or product claims); semantic review still rejects unsupported concrete claims and unmet Article Spec requirements. Do not fill empty usage or treat a valid reference as proof of claim support. Quote verification requires every quoted fragment to exist in its source.
- Re-check refreshes bounded, relevant excerpts from the authorized KB and remaps historical IDs by source/quote/role. If no relevant evidence is available and evidence support is unresolved, preserve the draft and request a source or manual qualification rather than another automatic rewrite. Semantic JSON recovery receives the same registry as the original review.
- Failures, evidence-support warnings, incomplete reviews and stale reviews block completion in manual and batch flows. Other semantic warnings are advisory unless explicitly blocking; retain them visibly in the report.

- Draft introductions use one paragraph of `introMinWords`–`introMaxWords` English words (default 60–85, set in the G3 Playbook front matter and frozen on the article as `introductionBudget`), ideally 3–4 concise sentences, aiming for about 5–6 desktop reading lines. This overrides historical introduction percentage settings. Single and batch generation, deterministic QC, semantic review and targeted repair share this contract. Start with the reader's pain point/decision and answer the search intent directly; avoid generic setup and unsupported promises. Allocate the remaining word budget to body sections.

- API or workflow changes require matching updates to `backend/api-contracts.md` and affected UI flow documentation.
- Preserve legacy-compatible step numbers 2/3/4 in storage unless a migration request is explicitly approved.
- Do not add unbounded retries, parallel mutation paths or silent fallback models.

## Test execution boundaries

SQL persistence regressions belong in `backend/*.test.ts` and run with `npm --prefix backend test`; `backend/generationVersions.test.ts` covers immutable stage snapshots, generation retry deduplication, identical outputs and independent stage numbering using isolated PGlite. This suite uses backend dependencies and never connects to production.

Browser specs under `tests/browser/` use the browser fixture and mocked API responses. Do not import backend modules, PostgreSQL adapters, `pg` or PGlite into a browser spec, even behind a test-runner selection variable: static imports execute before test registration. Browser CI intentionally installs only frontend dependencies. Keep SQL assertions in the backend suite and history-selection/reload/error behavior in browser tests.

## Generate snapshots (REQ-44E4C670)

Manual and batch outline/draft checkpoints assign a generation ID before persistence. Capture the initial generated output plus Article Spec, outline, structure, evidence usage and source fingerprint once; later QC/repairs/autosave do not rewrite that generation snapshot. Each new ID has a distinct stage fingerprint; repeated persistence uses the same ID and existing adapter deduplication. Capture available legacy output as a single baseline before replacing/clearing current output; it is not evidence of individual historical generations. Persist stage snapshots before updating article KV; failures preserve current article state, while an already-inserted snapshot remains readable/retryable. Unavailable history storage blocks new generation checkpoints. Existing legacy revision rows remain unchanged. No new retention, migration or batch scheduling rules.
