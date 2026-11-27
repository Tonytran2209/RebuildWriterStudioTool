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

## Gate documents (Storage → prompt), v2

Design and rationale: `gate-documents-v2.md`. `shared/gateDocuments.ts` owns roles and send order; `shared/gateSettings.ts` owns every number and switch (G1 = step 2, G2 = step 3, G3 and AI review = step 4).

- **Platform contract (code):** gate order, JSON schemas, evidence boundary, confidentiality, English output, editorial approval, cache/budget/monitoring and deterministic measurement. `workflowRules.ts` (version 5) holds only these; it carries no writing criteria or numbers.
- **Four Storage groups.** Rules files are **Playbooks** (how to produce a Gate's output) or **Standards** (what the output is checked against). Domain Knowledge is **Brand context** when `knowledgeMetadata.type` is `positioning`, `usp` or `brand_voice` (sent whole) and **Evidence** otherwise (excerpted; the only source of facts). **Source data** is the Content Plan. "Voice & Style" no longer exists: a saved value reads as Standards, and the startup migration rewrites it. A Rules file without a saved group is guessed from its name and shown as guessed in Storage and Settings.
- **Roles sent:** `PLAYBOOK` (the step's `stepConfigs[step].primaryPlaybookId`, only while ticked), `SUPPORTING_PLAYBOOK`, `STANDARD`, `BRAND_CONTEXT`, `KNOWLEDGE_BASE` (Evidence), `CONTENT_PLAN`, in that order. The contract plus the first four roles are identical for every article of a Gate: `StepContextResult.cacheableDocs` counts them, and Anthropic calls put a `cache_control` breakpoint after them (`anthropicSystem`, Settings switch `promptCache`).
- **Precedence** (`GATE_DOCUMENT_CONTRACT`): platform contract > Gate settings > STANDARD > PLAYBOOK > SUPPORTING_PLAYBOOK > BRAND_CONTEXT. Evidence supplies facts only, the Content Plan topic only.
- **Settings are the only source of numbers** (`writer:config.gateSettings`, sanitized by `POST /api/config`): keyword and idea counts (G1), minimum sections (G2), introduction range and paragraph count, conclusion %, conclusion heading, max sentences per paragraph, H1-keyword rule, fix rounds (G1/G2/G3), G1/G2 self-review switches and prompt cache. MD front matter is no longer read. A new draft freezes `introductionBudget` and `draftFormat` on the article; QC and repairs use the frozen values, and an existing draft keeps the values it was written with.
- **AI review uses Standards only.** G3 `checklist-compliance` reads the Standards ticked for G3 (`step4ChecklistDocs`), and the review also receives Brand context (internal file names replaced) to judge `brand-pov`. Playbooks never become review criteria.
- **G1/G2 self-review** (sub-jobs "Kiểm tra Core Idea" and "Kiểm tra outline"): runs only when the Gate's switch is on and it has Standards ticked. One review call, then up to N fix rounds (fix + re-review). A G1 fix changes wording of the selected idea and Spec only (keywords and evidence never change); a G2 fix changes heading/notes/keywords/searchIntent/rationale of existing section IDs and is rejected if it breaks unique or required headings. The result is saved as `article.gateReviews[2|3]` with an output hash (stale when the output changes) and never blocks the article; a failed review is recorded as status `error` and the sub-job as failed.
- A Gate with a primary Playbook no longer sends the Settings team note (`customInstruction`).
- **Migration** (`backend/gateMigration.ts`, at startup, once: `gateDocumentsVersion = 2`): Voice & Style files become Standards, KB files named *vocab* without metadata become `brand_voice`, and the numbers v1 used (front matter, then old stage parameters) are written into `gateSettings` unless the admin already saved one. Nothing is deleted.

## G1 research: competitor analysis, information gain, overlap

- **Competitor analysis** (sub-job "Phân tích đối thủ", between keyword research and the Spec; Settings G1 `competitorAnalysis`, off by default, `competitorCount` 2–10): takes the source URLs keyword research returned (`competitorUrls`: research order, unique pages, Website Inventory hosts excluded), reads each with `fetchPublicPage` (same private-network, redirect, size and 12 s limits as the inventory scan; three at a time), then one AI call summarises each page (page type, strengths, weaknesses, entities) and the set (common sections, gaps, entities, questions, formats). Saved as `article.competitorAnalysis`, keyed by the keyword research's `researchedAt`, so a rerun with the same research reuses it. The step run carries `items {total, succeeded}` (pages analysed). A failure is saved as status `error`, marks the sub-job failed and never stops the article. The full SERP source (top results, PAA, AI Overview) is a separate, later change.
- **Information-gain Spec fields** (G1): `pageType`, `entities`, `questions`, `contentGaps`, `informationGain`, `citationTargets` (short capped lists). G1 fills them using the competitor analysis when it ran; G2 must place each item in a section within the selected structure and name it in the notes; the G3 review warns (never fails) for each item the draft does not deliver.
- **Map and metadata Spec fields** (G1, same AI call, `src/lib/specMaps.ts`): `pageTypeReason`; `brandAssets` [{asset, use}] (Brand Opportunity Map, G2 places each in a section, the G3 review warns under brand-pov per unused asset); `entityMap` [{name, attributes, related}]; `citations` [{statement, source, entity}] (AI Citation Map); `metaDescription`, `schemaTypes`. SEO metadata shown and exported is derived (`seoMetadataOf`): title = draft H1 (else selected idea title), slug from the primary query, schema from G1 or from page type (+ FAQPage when the Spec has questions). Older Specs simply lack these fields.
- **Writer Brief** (`src/lib/writerBrief.ts`): Markdown assembled from the Spec, selected idea, outline with evidence and SEO metadata; no AI call. Downloaded from the manual tab and included in the batch ZIP under `briefs/`; the ZIP manifest carries `seoMetadata`.
- **Quality Scorecard** (`src/lib/qcGroups.ts`): QC checks grouped into five axes, SEO, Brand (brand-pov, checklist-compliance = Standards, source-confidentiality), Evidence, Differentiation (reader-outcome, where Spec questions, gaps and information gain are judged), AI readiness (structure, outline, introduction). Axis score = pass 1, warning 0.5, fail 0. A view only: it never changes whether an article passes.
- **Overlap (cannibalisation) warning** (Settings G1 `cannibalisationCheck`, on by default, no AI): after the Spec, `findCannibalisation` compares the primary keyword and title with Website Inventory pages (not broken/redirected) and other articles by word overlap (Jaccard ≥ 0.6, at least two shared content words). Saved as `article.cannibalisation` and shown under G1. It does not enter QC or the approval score.

## Safety invariants

- Serialize article mutations by article ID.
- Batch workers only process non-terminal items. Do not allow manual AI mutations for active batch items.
- An AI response is parsed, validated and repaired only within its declared workflow stage.
- JSON formatting recovery is an exception path and has distinct cache identity.
- Re-check should target failed checks and avoid regenerating a complete draft unless explicitly requested.

## Change rules

- Single and batch drafts share internal-link candidate ranking/deduplication, prompt contract, missing-link insertion and budget/distribution QC. Use the configured word target consistently: 1300–1700 words requires 5–7 unique approved URLs (1500-word default). Keep at most one internal link per section and add missing links only to unoccupied body sections. Short inventories remain a visible QC failure; never invent URLs or count canonical duplicates as separate links.

- Universal QC v10 shares canonical Article Spec and reviewed-input fingerprints between browser and batch. A review records draft, spec, outline, normalized draft evidence usage, keywords, word target, authorized KB/rules content and relevant workflow settings; model/UI-only changes do not stale the review. Historical reports without this metadata require one explicit re-check, preserving drafts. New reports must be fingerprinted with the same normalized evidence usage persisted with the generated draft; an unchanged report must survive viewing and reload.
- Content Plan supplies topic/intent; Playbooks, Standards and Brand context supply method, checks and voice; none is factual evidence. Select verified KB excerpts per section and keep evidence usage explicitly declared. Mark sections without factual KB excerpts as editorial-guidance (no invented statistics, healthcare outcomes or product claims); semantic review still rejects unsupported concrete claims and unmet Article Spec requirements. Do not fill empty usage or treat a valid reference as proof of claim support. Quote verification requires every quoted fragment to exist in its source.
- Re-check refreshes bounded, relevant excerpts from the authorized KB and remaps historical IDs by source/quote/role. If no relevant evidence is available and evidence support is unresolved, preserve the draft and request a source or manual qualification rather than another automatic rewrite. Semantic JSON recovery receives the same registry as the original review.
- Failures, evidence-support warnings, incomplete reviews and stale reviews block completion in manual and batch flows. Other semantic warnings are advisory unless explicitly blocking; retain them visibly in the report.

- Draft introductions use `introParagraphs` paragraph(s) (default one) of `introMinWords`–`introMaxWords` English words (default 60–85, set in Settings › Workflow rules and frozen on the article as `introductionBudget`), ideally 3–4 concise sentences, aiming for about 5–6 desktop reading lines. This overrides historical introduction percentage settings. Single and batch generation, deterministic QC, semantic review and targeted repair share this contract. Start with the reader's pain point/decision and answer the search intent directly; avoid generic setup and unsupported promises. Allocate the remaining word budget to body sections.

- API or workflow changes require matching updates to `backend/api-contracts.md` and affected UI flow documentation.
- Preserve legacy-compatible step numbers 2/3/4 in storage unless a migration request is explicitly approved.
- Do not add unbounded retries, parallel mutation paths or silent fallback models.

## Test execution boundaries

SQL persistence regressions belong in `backend/*.test.ts` and run with `npm --prefix backend test`; `backend/generationVersions.test.ts` covers immutable stage snapshots, generation retry deduplication, identical outputs and independent stage numbering using isolated PGlite. This suite uses backend dependencies and never connects to production.

Browser specs under `tests/browser/` use the browser fixture and mocked API responses. Do not import backend modules, PostgreSQL adapters, `pg` or PGlite into a browser spec, even behind a test-runner selection variable: static imports execute before test registration. Browser CI intentionally installs only frontend dependencies. Keep SQL assertions in the backend suite and history-selection/reload/error behavior in browser tests.

## Generate snapshots (REQ-44E4C670)

Manual and batch outline/draft checkpoints assign a generation ID before persistence. Capture the initial generated output plus Article Spec, outline, structure, evidence usage and source fingerprint once; later QC/repairs/autosave do not rewrite that generation snapshot. Each new ID has a distinct stage fingerprint; repeated persistence uses the same ID and existing adapter deduplication. Capture available legacy output as a single baseline before replacing/clearing current output; it is not evidence of individual historical generations. Persist stage snapshots before updating article KV; failures preserve current article state, while an already-inserted snapshot remains readable/retryable. Unavailable history storage blocks new generation checkpoints. Existing legacy revision rows remain unchanged. No new retention, migration or batch scheduling rules.
