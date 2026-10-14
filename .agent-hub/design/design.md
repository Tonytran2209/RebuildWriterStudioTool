---
schema: agent-hub/design/v1
projectId: writer-studio
theme: dark product workspace with a quiet light settings surface
sourceOfTruth: src/codex-theme.css
referencePolicy: design/sources.md
---

# Writer Studio Design Contract

## Product character

Writer Studio is a focused AI writing workspace. The UI should feel calm, operational and evidence-aware: dense enough for professional work, but never visually noisy or dashboard-like for its own sake.

## Visual system

The canonical dark tokens are defined in `src/codex-theme.css`:

| Token | Value | Use |
| --- | --- | --- |
| Canvas | `#141414` | App background |
| Sidebar | `#121212` | Persistent navigation |
| Card | `#1c1c1c` | Primary surfaces |
| Control | `#242424` | Inputs and secondary controls |
| Border | `#2a2a2a` | Hairline separation |
| Text | `#e5e5e5` | Primary content |
| Secondary | `#a7abb4` | Supporting information |
| Muted | `#7f8590` | Metadata and disabled context |
| Primary action | `#dedede` on `#171717` | High-confidence action |

Use neutral grays as the default. Semantic color is reserved for system state: emerald success, amber warning, rose/red failure. Do not introduce a decorative brand accent without an approved Design request.

## Typography, spacing and shape

- Use the system sans stack declared in `src/index.css`; use monospace only for tokens, counts, IDs and technical metadata.
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
