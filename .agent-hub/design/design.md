---
schema: agent-hub/design/v1
projectId: writer-studio
theme: Writer Studio on the Twenty design language with Light, Dark and System appearance
authority: primary-design-contract
implementationSource: [src/theme-tokens.css, src/ui-guide.css]
supplementalReferences: [design/CHATGPT-DESKTOP-UI-GUIDE.md]
referencePolicy: design/sources.md
---

# Writer Studio Design Contract

## Product character

Writer Studio is a focused AI writing workspace. The UI should feel calm, operational and evidence-aware: dense enough for professional work, but never visually noisy or dashboard-like for its own sake. This document is the primary design contract. `CHATGPT-DESKTOP-UI-GUIDE.md` provides supplemental research for UI patterns; it does not override this contract. Keep Writer Studio's own identity, data and writing workflows.

## Design authority and evolution

1. This `design.md` defines the approved project design rules. CSS and components implement those rules and show current behavior; they do not independently authorize a contract change.
2. [CHATGPT Desktop UI Guide](CHATGPT-DESKTOP-UI-GUIDE.md), [reference sources](sources.md), screenshots and future guides are supplemental references. Use compatible patterns to make the requested UI clearer, current and accessible. Examples, tokens and checklists are not automatically mandatory.
3. On conflict, follow `design.md` and record the discrepancy. Do not silently copy reference colors/layouts or redefine project identity. Surface material unresolved design decisions; compatible UI refinements may continue under the request's existing authority.
4. A requested change to the shared design system must explicitly update this contract and relevant implementation in the same reviewed request. Updating a reference alone does not change the approved system or authorize a redesign.
5. After a completed UI request, update this contract when approved rules change, update affected usage/component/flow MD, and retain rationale and verification in the request/feedback library. Future requests must recheck current source and this contract; past outcomes and trends remain supporting context, not automatic authority.

## Visual system (Twenty design language, 2026-11-11)

User-authorized redesign: Writer Studio adopts the Twenty design language (https://github.com/twentyhq/twenty). Tokens are sRGB conversions of the MIT-licensed `twenty-ui` theme (`theme-light.css` / `theme-dark.css`). Writer Studio keeps its own name, logo, data and workflows. No AGPL Twenty application code is copied.

Tokens live in `src/theme-tokens.css` (imported by `src/index.css`) and apply through both `:root[data-writer-theme]` and the `.writer-light` / `.codex-dark` classes. `src/ui-guide.css` holds the shared component layer and loads last. Legacy hex values in `index.css`, `codex-theme.css` and `settings-interactions.css` were remapped to these tokens. Tailwind `slate`/`gray`/`blue`/`indigo`/`emerald`/`amber`/`red`/`rose` utilities, text sizes, radii and shadows resolve to tokens through `@theme inline`. Dark remains the default; users can choose Light or System.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--ui-bg` / `--ui-surface` | #ffffff | #171717 | App background and cards (Twenty background-primary) |
| `--ui-sidebar` / `--ui-control` | #fcfcfc | #1b1b1b | Navigation drawer and inputs (background-secondary) |
| `--ui-soft` | #f1f1f1 | #1d1d1d | Tertiary fills (background-tertiary) |
| `--ui-hover` / `--ui-selected` | black 4% / 8% | white 6% / 10% | Transparent hover and selection overlays |
| `--ui-text` / `--ui-secondary` | #333333 / #666666 | #ebebeb / #b3b3b3 | Primary and secondary text |
| `--ui-muted` | #6b6b6b | #929292 | Metadata (Twenty tertiary, adjusted to keep 4.5:1 on all fills) |
| `--ui-border` / `--ui-border-strong` | #ebebeb / #d6d6d6 | #2a2a2a / #484848 | Hairlines and control borders |
| `--ui-accent` / `--ui-primary-bg` | #3e63dd | #3e63dd | Primary action, focus, selection accent (Twenty blue) |
| `--ui-accent-soft` / `--ui-accent-text` | #edf2fe / #3a5bc7 | #182449 / #9db1ff | Focus ring, accent tags and links |
| success / warning / danger | Radix green/orange/red text-on-tint | same families, dark tints | System state only |

Neutral grays remain the default. Blue is the single accent: primary actions, focus and links. Semantic colors stay reserved for state. Do not introduce other decorative accents without an approved Design request.

## Typography, spacing and shape

- Inter (400/500/600) is the UI font and DM Mono the monospace font, loaded from Google Fonts with system fallbacks. Monospace is only for tokens, counts, IDs and technical metadata.
- UI text is 13px (Twenty md). Tailwind `text-xs` is 12px, `text-sm` and `text-base` are 13px, `text-lg` 16px, `text-xl` 20px and `text-2xl` 24px. Long-form reading text in the draft editor stays at 16px.
- Headings: app H1 24px/600, workspace H2 16px/600, H3 13–14px/500. H1/H2 use -0.01em tracking.
- Launcher greeting exception (REQ-040C6C78, superseding REQ-F11599E3): reduce the main empty-workspace greeting to 32px on desktop (>=900px), 28px on tablet (601-899px), and 24px on mobile (<=600px), consistently in Light, Dark and System. Retain weight 500 and line-height 1.25, and wrap naturally without clipping or overlapping the composer; other headings retain their existing hierarchy.
- Use a 4px spacing rhythm. Radius: 4px (`--ui-radius-sm`) for buttons, inputs, menu items and tags; 8px (`--ui-radius-md`) for cards, panels, popovers and dialogs; pills only for avatars and counters.
- Prefer hairline borders over shadows. Only popovers, menus and dialogs use Twenty's layered shadow. Avoid gradients, glass effects, large illustrations and decorative motion in operational screens.
- Inputs: hairline border, 4px radius. Focus shows the blue accent border with a 3px `--ui-accent-soft` ring. Other controls keep a 2px focus outline. Twenty's light border (#d6d6d6) is lighter than WCAG 1.4.11 non-text contrast; labels, placeholders and the focus ring identify fields instead.
- Sidebar items are 28px high with 4px radius and transparent hover/selected overlays (44px on narrow screens). Inspector tabs use Twenty's underline style.

## Interaction rules

- Every AI action has visible `idle`, `running`, `saved`, `warning` and `error` feedback.
- A completed action must show persisted output without requiring reload or reselecting a task.
- Disable or explain unsafe actions rather than silently failing them.
- Focus must remain visible via the neutral focus ring; keyboard navigation cannot depend on hover.
- Destructive actions require confirmation and identify scope (single article, batch, plan or source).

## Responsive rules

- Desktop prioritizes sidebar + continuous workflow canvas.
- On small screens, preserve readable content width and stack controls; never hide the status/error reason needed to continue.
- Loading placeholders should preserve the final content region to minimize layout shift.

## Non-goals

- Do not copy a third-party logo, name, proprietary assets or AGPL application code. The Twenty design language (tokens and component patterns from MIT `twenty-ui`) is the approved exception (2026-11-11 request).
- Do not apply a reference-source pattern when it conflicts with the neutral Writer Studio system, accessibility, workflow clarity or existing user data.

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
