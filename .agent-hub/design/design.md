---
schema: agent-hub/design/v1
projectId: writer-studio
theme: Writer Studio neutral workspace with Light, Dark and System appearance
authority: primary-design-contract
implementationSource: src/ui-guide.css
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

## Visual system

The semantic Light/Dark tokens are defined in `src/ui-guide.css`; `src/codex-theme.css` holds legacy dark component styling that is progressively mapped to those tokens. Dark remains the default, while the user can choose Light or System.

| Token | Value | Use |
| --- | --- | --- |
| Canvas | `--ui-bg` | App background |
| Sidebar | `--ui-sidebar` | Persistent navigation |
| Card | `--ui-surface` | Primary surfaces |
| Control | `--ui-control` | Inputs and secondary controls |
| Border | `--ui-border` | Hairline separation |
| Text | `--ui-text` | Primary content |
| Secondary | `--ui-secondary` | Supporting information |
| Muted | `--ui-muted` | Metadata and disabled context |
| Primary action | `--ui-primary-bg` / `--ui-primary-text` | High-confidence action |

Use neutral grays as the default. Semantic color is reserved for system state: emerald success, amber warning, rose/red failure. Keep focus visibly neutral as specified below; reference accent examples are proposals, not automatic replacements for project tokens. Do not introduce a decorative brand accent without an approved Design request.

## Typography, spacing and shape

- Use the system sans stack declared in `src/ui-guide.css`; use monospace only for tokens, counts, IDs and technical metadata. The approved defaults are 14px UI text and 16px long-form reading text; reference examples do not change these defaults.
- Prefer compact hierarchy: app H1 is 24px/500; workspace H2 is 16px/500; H3 is 14px/500.
- Launcher greeting exception (REQ-F11599E3): the main empty-workspace greeting uses 48px in Dark and 54px in Light, doubling its previous theme-specific size while retaining weight 500 and line-height 1.25. System follows the resolved theme. Keep these sizes on narrow screens and wrap naturally without clipping or overlapping the composer; other headings retain their existing hierarchy.
- Use a 4px spacing rhythm. Primary cards and workflow groups use 12px radius; controls use 8–12px radius; pills are reserved for statuses and tags.
- Prefer borders over shadows. Avoid gradients, glass effects, large illustrations and decorative motion in operational screens.

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

- Do not copy a third-party visual identity, logo, proprietary typography or exact layout.
- Do not apply a reference-source pattern when it conflicts with the neutral Writer Studio system, accessibility, workflow clarity or existing user data.
