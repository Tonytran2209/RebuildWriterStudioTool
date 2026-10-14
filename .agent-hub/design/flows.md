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
