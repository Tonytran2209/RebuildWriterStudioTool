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


## Generation version history (REQ-44E4C670)

Outline and Draft provide a neutral, keyboard-accessible native version selector in an expandable history region, with timestamp/revision labels, loading, empty, unavailable/unconfirmed and retry states. History is a separate read-only region; it never binds to the current editor, attaches current QC to old output, or changes current actions. Changing articles clears the viewer and ignores superseded responses. History reloads after generation settles, and can be refreshed manually for batch checkpoints.
