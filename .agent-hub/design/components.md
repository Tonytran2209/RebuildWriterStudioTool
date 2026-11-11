---
schema: agent-hub/design-components/v1
projectId: writer-studio
---

# UI component inventory

| Surface | Source | Responsibilities | Required states |
| --- | --- | --- | --- |
| App shell | `src/App.tsx` | Auth, selected article, persistence state, batch polling, campaign metadata | loading, auth, empty, sync error |
| Sidebar | `src/components/Sidebar.tsx` | Campaign disclosure and article selection; legacy batch grouping | collapsed, expanded, empty, metadata fallback, active, batch running, completed, failed |
| Launcher | `src/components/ActivityLauncher.tsx` | Start single or batch work from content plans; report metadata updates to App | empty, validation, submitting, import saved/classification error |
| Core Idea | `workspace/Step2CoreIdea.tsx` | Article spec and idea selection | generating, selected, validation error |
| Outline | `workspace/Step3Outline.tsx` | Evidence-grounded structure editing | generating, partial, saved, error |
| Draft | `workspace/Step4Draft.tsx` | Draft editing, QC, images and re-check | generating, persisted, warning, repair, error |
| Batch activity | `src/components/BatchActivity.tsx` | Job progress and item retry | queued, running, paused, completed, failed |
| Settings | `src/components/config/**` | Models, sources, workflow rules, inventory | loading, saved, validation error |
| Notifications | `workspace/WorkspaceNotification.tsx` | Cross-workspace outcomes | success, warning, error |

## Component contracts

- Use `CHATGPT-DESKTOP-UI-GUIDE.md` and `src/ui-guide.css` for semantic colors, typography, spacing, focus, responsive behavior, and Light/Dark/System appearance. Preserve Writer Studio workflow and feature semantics.
- Theme state is stored as `writer:theme-preference`; dialogs rendered through portals must use the same semantic tokens as the app shell.
- Icon-only controls need an accessible name. Dialogs need a name, Escape handling, and focus restoration; touch targets are at least 44 px on narrow screens.

- A component that starts an asynchronous operation owns the progress and local error display, but persistence status comes from the app shell.
- A saved result is rendered from durable article state, not only a local response object.
- Cards require a clear primary action and should not overload the row with equal-weight buttons.
- Status badges convey state, not navigation or primary actions.
- Empty states explain the prerequisite and provide the next safe action.

## Workspace ruler (2026-11-03)

User-requested workspace refinement: center article content in a maximum 900px reading column, with a sticky vertical ruler at the left canvas edge. Major ticks navigate to available Article Spec, Outline and Draft sections; minor ticks magnify near the pointer. Show the step title and durable completion/availability state on hover and keyboard focus. Preserve neutral theme tokens, 44px-high step targets, visible focus and reduced-motion support. Mobile retains a compact ruler and fluid reading column. Active navigation is not an AI-running indicator.

## MD-driven outline selection (2026-11-03)

Batch chooses its outline structure before running; single chooses at Draft Outline. Both selectors read only authorized Skills & Rules Markdown declarations, show source file and revision, and explain empty/invalid catalogs. Workflow AI does not display the outline catalog. Manage the source MD in Knowledge & Rules; selection and catalog errors appear only in the batch/single structure selectors. Store a frozen definition per article through outline and draft. Re-selection preserves previous output, marks it stale and requires outline regeneration; active batch selections are locked. See `../backend/outline-structures.md` for schema and lifecycle.

## Required outline picker (2026-11-03)

Use a shared, visibly required structure picker for single and batch workflows: explanatory heading, Required/Selected state, a full-width trigger and inline scrollable list of MD-driven names/descriptions. Support arrow/Home/End navigation, Enter/Space selection, Escape with focus restoration, Tab exit and pointer dismissal. Keep source name visible in a compact disclosure; technical IDs/hashes are secondary. Disable new outline generation until a structure is selected and show the reason beside the action. Retain legacy saved-outline continuation. Use neutral Light/Dark tokens and responsive 44px minimum interaction targets.

## Draft SEO brief (2026-11-03)

Use a neutral token-based SEO brief above the draft. Feature the primary keyword and search intent separately; distinguish selected secondary queries from additional research terms, deduplicate display entries without mutating stored SEO data, and render readable numbered rows rather than dense pills. Show all available terms, preserve full keyword wrapping, and place internal-link requirements and approved candidate counts in a secondary footer. Stack groups and intent on mobile; support Light/Dark/System. Export and generation contracts remain unchanged.

## QC process clarity (2026-11-03)

Distinguish content findings from incomplete/outdated review process. Explain whether the report is missing, uses old QC rules, or no longer matches reviewed inputs; show pending-review wording and a visible explicit Re-check action. Preserve draft content and completion blocking for stale/incomplete reviews. Semantic evaluation uses the article’s frozen MD structure, not a generic comparison template; the introduction contract stays independent of body structure and responsive pixel line count.

## Campaign sidebar (REQ-460AEC3E)

App loads Content Plan metadata independently of articles and ignores superseded responses. Launcher reports successful history loads, imports (before classification) and existing plan deletions to App. Sidebar groups by Content Plan id, including empty campaigns and metadata fallbacks, with collapsed native button disclosures, visible focus and 44px targets. Search exposes matching articles. Child selection keeps the existing single/batch callback; child rows have no delete control because the existing handler may delete an entire batch. Ungrouped articles retain their existing controls.

## Outline and draft history (REQ-44E4C670)

Each step has a neutral history disclosure with a labelled native select (44px targets), loading, empty, error and retry states. Fetch history only when opened. Render selected immutable output in a separate read-only region, including full outline snapshot details; keep the live editor mounted below. Identify legacy rows without generation/date metadata using explicit fallback labels. Ignore superseded responses on article changes; sessionStorage selection is scoped by article and step. No shared design-rule change.

## Draft history toolbar (REQ-FA0D7EB9, superseding REQ-67FCA523)

Draft uses a History icon button immediately right of Regenerate draft (or Generate article), sharing the View AI log toolbar style with 44px minimum targets on narrow screens, with a localized accessible name, hover/focus tooltip, visible focus and expanded state. The closed disclosure has no separate history frame; its open read-only panel sits inside the Draft card directly below the heading/action toolbar and before current content, with bounded scrolling for long history. The live editor stays continuously mounted. One GenerationHistory instance owns loading, selection and sessionStorage. Outline uses a History icon and decorative state chevron in a full-width native button (minimum 44px high): the entire closed card, including padding, opens history; when expanded, only the full-width heading toggles it. Select, retry and snapshot controls remain siblings outside the trigger, with visible keyboard focus and aria-expanded. (REQ-293A6866) Toolbar actions wrap on narrow screens while History and Generate/Regenerate remain together on the same row. Shared design rules and data contracts are unchanged.

## Workflow check log

Core Ideas, Draft Outline and Draft Content share a compact checklist for in-workspace generation. A dashed circle marks queued work, an animated ring marks the current operation, and a check marks a completed operation. Show elapsed time and distinguish saved results that need review from interrupted runs. Drive each transition from the actual application operation and retain the latest checklist alongside the output while the step remains mounted. Keep the persisted AI audit trace for detailed inspection. Use theme tokens, accessible status text and reduced-motion support.

Each checklist row opens inline to show its status, elapsed time and timestamped application events. A live line below the card shows the current operation and elapsed run time, then holds the final time. Announce operation changes to assistive technology without announcing each timer tick.

The detail icon beside each workflow checkpoint opens an accessible dialog with inputs, outputs, documents and applied rules captured during that run. Keep source context reported by the server distinct from verified evidence and mark missing data explicitly. Keep large payloads behind field disclosures and the existing timeline inline.

Keep the log header visible and its checklist collapsed by default when opening or reloading an article, including when the step has no recorded run. Its live status and timer remain visible. Restore the last finished run per article and workflow step in the current browser tab so reopening the checklist still shows its events and checkpoint details.

Campaign labels use the same 13 px typography as recent article rows, with separate accessible delete targets. In Campaigns, the completion icon shares the trailing slot with delete, which appears on row hover or keyboard focus. Keep delete available on touch devices. Completed article workspaces keep review and export available and require reopening before generation or editing. When restoring a saved sign-in, use the workspace loading screen until the session check resolves.

Draft Outline presents a single ordered hierarchy with H3 rows indented under the nearest preceding H2. Heading rows use a full-width neutral hover and a distinct expanded state. Each heading opens a read-first panel with notes and rationale in full, with editing available as an explicit action. Keep log and section actions in a compact footer. Keep legacy headings without a preceding H2 visible at the top level and preserve the saved outline order.

Image Workers pairs a named Mac and agent through Settings. An approved image suggestion exposes worker selection, queue status and a private preview. Insert is a separate action. Keep the image in its approved slot in the draft preview and preserve the prose QC result.
