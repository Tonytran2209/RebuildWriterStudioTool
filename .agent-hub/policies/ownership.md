---
schema: agent-hub/ownership/v1
projectId: writer-studio
---

# Change ownership and scope policy

## Layer classification

| Layer | Default allowed paths |
| --- | --- |
| Design UI/UX | `src/components/**`, `src/*.css`, `src/App.tsx`, `public/**`, `index.html`, `.agent-hub/design/**` |
| Backend/workflow | `backend/**`, `src/lib/aiService.ts`, `src/lib/db.ts`, `src/lib/railway*.ts`, `.agent-hub/backend/**` |
| Database/storage | `supabase/migrations/**`, `backend/supabase.ts`, `.agent-hub/database/**` |
| Cross-layer | Explicit union of paths plus approved dependency order |

## Request requirements

Every change request must include project ID, base commit, layer, module, allowed paths, acceptance criteria, verification command and risk level.

## Conflict policy

- Requests overlapping an active request's allowed path or database contract are blocked or merged.
- Design requests may not modify API responses or migrations.
- Backend requests may not introduce schema changes implicitly.
- Database requests require explicit backend compatibility and migration rollback/backfill notes.
- If source ownership is unclear, classify as `needs-triage`; do not execute.
