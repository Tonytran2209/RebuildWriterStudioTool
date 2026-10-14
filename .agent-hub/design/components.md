---
schema: agent-hub/design-components/v1
projectId: writer-studio
---

# UI component inventory

| Surface | Source | Responsibilities | Required states |
| --- | --- | --- | --- |
| App shell | `src/App.tsx` | Auth, selected article, persistence state, batch polling | loading, auth, empty, sync error |
| Sidebar | `src/components/Sidebar.tsx` | Project/article selection and batch grouping | active, batch running, completed, failed |
| Launcher | `src/components/ActivityLauncher.tsx` | Start single or batch work from content plans | empty, validation, submitting |
| Core Idea | `workspace/Step2CoreIdea.tsx` | Article spec and idea selection | generating, selected, validation error |
| Outline | `workspace/Step3Outline.tsx` | Evidence-grounded structure editing | generating, partial, saved, error |
| Draft | `workspace/Step4Draft.tsx` | Draft editing, QC, images and re-check | generating, persisted, warning, repair, error |
| Batch activity | `src/components/BatchActivity.tsx` | Job progress and item retry | queued, running, paused, completed, failed |
| Settings | `src/components/config/**` | Models, sources, workflow rules, inventory | loading, saved, validation error |
| Notifications | `workspace/WorkspaceNotification.tsx` | Cross-workspace outcomes | success, warning, error |

## Component contracts

- A component that starts an asynchronous operation owns the progress and local error display, but persistence status comes from the app shell.
- A saved result is rendered from durable article state, not only a local response object.
- Cards require a clear primary action and should not overload the row with equal-weight buttons.
- Status badges convey state, not navigation or primary actions.
- Empty states explain the prerequisite and provide the next safe action.
