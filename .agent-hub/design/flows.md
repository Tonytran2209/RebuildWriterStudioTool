---
schema: agent-hub/design-flows/v1
projectId: writer-studio
---

# UX flow contract

## Single article

1. Select a classified Content Plan item.
2. Generate/select a Core Idea and persist Article Spec.
3. Generate/edit a verified Outline.
4. Generate/edit Draft, then run deterministic and optional semantic QC.
5. Mark complete only after the required persistence and workflow gate pass.

## Batch article

1. Batch UI shows per-item status and a batch-level aggregate.
2. Active (`queued`, `running`, `paused`) items are controlled by batch orchestration; manual AI mutations explain why they are unavailable.
3. Terminal (`failed`, `completed`) items may be repaired manually without racing a worker.
4. A retry changes only the targeted item back to queued state.

## UI feedback rules

- Show a spinner/skeleton inside the output region while an AI action runs.
- On completion, replace loading UI with the persisted result in the same view.
- On warning, preserve the saved output and state exactly what remains unresolved.
- On error, preserve usable progress and offer the safe retry path.

## Draft introduction display

Show the complete introduction in draft preview and full editing. The 5–6 line goal is a writing guideline, enforced through a shared 60–85-word single-paragraph contract, not CSS clipping. Responsive line wrapping must not hide saved content.

## Draft copy and export

Preview, plain copy, rich copy and TXT downloads normalize em dashes to hyphens on output only; saved source remains unchanged. Copy/export includes pending editor changes. Rich copy includes HTML and Markdown clipboard variants, including table cells and inline formatting. Plain-text fallback retains Markdown syntax when rich clipboard support is unavailable.

## Universal QC review

Show Universal QC as compact icon, name and status rows. Warning/failure rows with a reason or recommended action offer an inline disclosure, collapsed by default; rows without details and passing rows have no disclosure. Mouse, touch and keyboard users can open each disclosure independently to read the full details. Preserve saved findings across reloads and keep their details available by reopening the disclosure; open/closed state is local presentation only and resets on reload. Viewing details must not call AI, save the article, change QC/completion gates or alter copy/TXT output. Refresh deterministic checks locally and retain saved semantic findings. Permit completion only with a current complete review and no blocking checks; advisory semantic warnings stay visible without forcing another paid repair. Evidence, incomplete-review and stale-review warnings remain blocking. Re-check can retrieve relevant KB excerpts for each section; missing-source findings must explain the required source/manual correction instead of recommending repeated AI calls.

The SEO brief displays the required internal-link range alongside available approved candidates. Both single and batch prompts/QC require 5–7 links for a 1500-word target; the target is not silently lowered when the inventory is insufficient. Approve additional relevant pages or adjust the outline when there are too few body sections to distribute the required links.
# Document library uploads

Knowledge & Rules exposes separate document importers for KB and Skills & Rules, alongside the workflow rule editor. Show configured storage destinations, sequential multi-file progress, per-file failures and successful records. Support DOCX/Markdown as well as existing formats. Uploads persist immediately; closing Settings refreshes server state. Unchanged library data must not be rewritten when saving unrelated settings. See docs/document-reupload.md.
