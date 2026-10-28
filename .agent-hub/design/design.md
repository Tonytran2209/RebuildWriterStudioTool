---
schema: agent-hub/design/v1
projectId: writer-studio
theme: Writer Studio neutral workspace with Light, Dark and System appearance
sourceOfTruth: src/ui-guide.css
uiGuide: design/CHATGPT-DESKTOP-UI-GUIDE.md
referencePolicy: design/sources.md
---

# Writer Studio Design Contract

## Product character

Writer Studio is a focused AI writing workspace. The UI should feel calm, operational and evidence-aware: dense enough for professional work, but never visually noisy or dashboard-like for its own sake. `CHATGPT-DESKTOP-UI-GUIDE.md` is the normative UI implementation guide for layout, tokens, components, states, responsive behavior and accessibility. Keep Writer Studio's own identity, data and writing workflows.

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

Use neutral grays as the default. Semantic color is reserved for system state: emerald success, amber warning, rose/red failure. The guide's accent applies only to focus and links, not decorative surfaces. Do not introduce a decorative brand accent without an approved Design request.

## Typography, spacing and shape

- Use the system sans stack declared in `src/ui-guide.css`; use monospace only for tokens, counts, IDs and technical metadata. Use the guide's 14px default and 16px long-form reading text.
- Prefer compact hierarchy: app H1 is 24px/500; workspace H2 is 16px/500; H3 is 14px/500.
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
