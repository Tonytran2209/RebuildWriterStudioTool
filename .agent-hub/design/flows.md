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

Show the complete introduction in draft preview and full editing. The 5–6 line goal is a writing guideline, enforced through a shared single-paragraph contract (default 60–85 words, set in the G3 Playbook), not CSS clipping. Responsive line wrapping must not hide saved content.

## Draft copy and export

Preview, plain copy, rich copy and TXT downloads normalize em dashes to hyphens on output only; saved source remains unchanged. Copy/export includes pending editor changes. Rich copy includes HTML and Markdown clipboard variants, including table cells and inline formatting. Plain-text fallback retains Markdown syntax when rich clipboard support is unavailable.

## Universal QC review

Show Universal QC as compact icon, name and status rows. Checklist titles use a heavier weight than expanded details. Limit the expanded detail box to 132ch and the available container width, with spacing and a neutral left border separating it from the title. Wrap the full reason and recommended action, including unbroken strings, without clipping or line limits. Keep text white and reserve status colors for icons. Warning/failure rows with a reason or recommended action offer an inline disclosure, collapsed by default; rows without details and passing rows have no disclosure. Mouse, touch and keyboard users can open each disclosure independently to read the full details. Preserve saved findings across reloads and keep their details available by reopening the disclosure; open/closed state is local presentation only and resets on reload. Viewing details must not call AI, save the article, change QC/completion gates or alter copy/TXT output. Refresh deterministic checks locally and retain saved semantic findings. Permit completion only with a current complete review and no blocking checks; advisory semantic warnings stay visible without forcing another paid repair. Evidence, incomplete-review and stale-review warnings remain blocking. Re-check can retrieve relevant KB excerpts for each section; missing-source findings must explain the required source/manual correction instead of recommending repeated AI calls.

The SEO brief displays the required internal-link range alongside available approved candidates. Both single and batch prompts/QC require 5–7 links for a 1500-word target; the target is not silently lowered when the inventory is insufficient. Approve additional relevant pages or adjust the outline when there are too few body sections to distribute the required links.
# Document library uploads

Storage (CRM) owns the library: "Add document" opens a side panel that picks the library (KB or Skills & Rules) and the import method (file, paste, URL/API, Google Sheets, manual table, Supabase, Airtable); the document panel shows governance, the text AI reads, download and delete (delete also removes the file from every gate's Shipper access). Admins can also tick one or more documents in the Storage table (Content Plans, missing placeholders and Approved Articles are not selectable) and delete them from the bulk bar after a confirm that lists the names; deletion is permanent, including the uploaded originals. Website Inventory and Legacy Action Plans are Storage sub-pages (`#/storage/website`, `#/storage/legacy`); the workflow rule editor lives under Settings › Workflow AI. Show sequential multi-file progress, per-file failures and successful records. Support DOCX/Markdown as well as existing formats. Uploads persist immediately; closing Settings refreshes server state. Unchanged library data must not be rewritten when saving unrelated settings. See docs/document-reupload.md.

## Hướng dẫn thao tác
[Hướng dẫn sử dụng Writer Studio](user-guide.md) mô tả Content Plan → Core Idea → Outline → Draft/QC, batch, copy/export và quản lý nguồn. Dùng source hiện tại để xác nhận khi triển khai thay đổi.

## MD-driven outline selection (2026-11-03)

Batch chooses its outline structure before running; single chooses at Draft Outline. Both selectors read only authorized Skills & Rules Markdown declarations, show source file and revision, and explain empty/invalid catalogs. Workflow AI does not display the outline catalog. Manage the source MD in Storage (Add document → Skills & Rules); selection and catalog errors appear only in the batch/single structure selectors. Store a frozen definition per article through outline and draft. Re-selection preserves previous output, marks it stale and requires outline regeneration; active batch selections are locked. See `../backend/outline-structures.md` for schema and lifecycle.

## Required outline picker (2026-11-03)

Use a shared, visibly required structure picker for single and batch workflows: explanatory heading, Required/Selected state, a full-width trigger and inline scrollable list of MD-driven names/descriptions. Support arrow/Home/End navigation, Enter/Space selection, Escape with focus restoration, Tab exit and pointer dismissal. Keep source name visible in a compact disclosure; technical IDs/hashes are secondary. Disable new outline generation until a structure is selected and show the reason beside the action. Retain legacy saved-outline continuation. Use neutral Light/Dark tokens and responsive 44px minimum interaction targets.

## QC process clarity (2026-11-03)

Distinguish content findings from incomplete/outdated review process. Explain whether the report is missing, uses old QC rules, or no longer matches reviewed inputs; show pending-review wording and a visible explicit Re-check action. Preserve draft content and completion blocking for stale/incomplete reviews. Semantic evaluation uses the article’s frozen MD structure, not a generic comparison template; the introduction contract stays independent of body structure and responsive pixel line count.

## Campaign navigation (REQ-460AEC3E)

Campaigns correspond to Content Plan ids, without merging series versions. Initially collapsed groups reveal saved articles on click, Enter or Space; search exposes matching campaign/article results. Expansion is local UI state only. Metadata loads independently; errors retain article access through fallback groups. Ignore stale history responses after import/delete and stale App loads after metadata updates or scope changes. Publish imported plans before classification so classification errors do not hide durable imports. Selecting an article retains existing batch navigation and persistence behavior. Disclosure never writes or deletes data.

## View generated versions (REQ-44E4C670)

Open Outline/Draft history and choose a saved revision; choose Current version to close the historical preview. History selection is presentation-only and persists per article/step in sessionStorage. It never writes an article, calls AI, restores workflow inputs or changes QC/checkpoints. The current editor, copy and export retain current content, including pending edits. History errors preserve current output and offer reload. Pending draft autosave cleanup uses the owning article callback when navigating away. Legacy records show saved revision history without implying a complete generation timeline.

## Writer reading view and role-based detail (2026-11-13)

Draft preview renders the saved Markdown (headings, paragraphs, lists, tables, links) with the shared escaped `markdownToHtml` used by rich copy; the editor keeps raw Markdown. Preview links open in a new tab so an unsaved workspace is never navigated away. Universal QC groups checks (structure, SEO & links, content & evidence, images, SEO checklist); all-pass groups collapse, groups with findings open with passing checks folded into one line, and "Pass" is screen-reader only. A finding with a quoted passage or section offers "Show in draft", which scrolls to and briefly highlights the matching block (reduced motion respected). A read-only "Checklist applied to this article" disclosure under the SEO brief lists the Standards documents granted to Step 4. Under G1 and G2 the manual tab shows the saved AI self-review (status, fix rounds, FAIL/WARN items, "Stale" when the output changed); it never blocks the Gate. Settings › Workflow rules is one box per Gate (primary Playbook, ticked Standards and Brand context, guessed-group warning, basic settings, collapsed Advanced, prompt preview with the cache point) plus an "Every Gate" box. Accounts with role `user` (writers) do not see AI logs, token usage or the idle generation log; admins see everything. Viewing never calls AI or changes saved data.

## CRM pipeline workspace (2026-11-17)

Default flow: Add Plan (side panel; Content Plan source: pasted topics, file DOCX/PDF/XLSX/CSV/MD/TXT, Google Doc or Google Sheet — imported through `/api/content-plans/import`, then classified and split into batches; imported plans also appear in Storage › Source data and open the plan record) → batch record. The plan record's Articles tab lists every plan topic in plan order (its article when one exists, otherwise a "Not started" row with its type); "Run unprocessed topics" starts the remaining ones in batches by type with a chosen outline structure (needs-review runs as Editorial) → article record. Articles list shows gate, AI Approval (Universal QC score vs. the Settings threshold, evidence failures hard-block) and human review. Article record tabs: Final Article (rendered, Copy to Docs), AI Review (score and criteria, failures first), Generation History (timeline, AI calls and cost), Manual mode (the existing Core Idea, Outline and Draft steps). Review Workspace filters by review status and the random sample; Request Revision requires a comment. Completion stays a human action. See `docs/AI-PIPELINE-UPGRADE.md` §10.

## CRM only (2026-11-18)

The classic sidebar/launcher/step UI is removed. Manual mode follows the demo: ideas as radio rows with scores, outline rows (H2/H3, expandable notes), draft textarea with explicit save. Regenerate G1/G2/Draft and Re-check AI call `POST /api/articles/:id/rerun`, which clears that gate's output and lets the batch runner resume. Retry on an AI Review failure re-runs the review gate.
