---
schema: agent-hub/project/v1
projectId: writer-studio
name: Writer Studio
repository: Tonytran2209/RebuildWriterStudioTool
defaultBranch: main
runtime:
  frontend: React 19 + Vite + Tailwind CSS 4
  backend: Node 22 + Express on Railway
  database: Supabase Postgres + Storage
verification:
  required:
    - npm run check
  frontend: npm run typecheck && npm run build
  backend: npm --prefix backend run typecheck
---

# Writer Studio project map

Writer Studio creates evidence-aware articles through the Core Idea, Outline and Draft workflow. It supports single articles and governed batch orchestration.

## Canonical libraries

| Concern | Canonical document |
| --- | --- |
| UI/UX contract | `design/design.md` |
| UI component boundaries | `design/components.md` |
| User flows and state rules | `design/flows.md` |
| Backend and workflow rules | `backend/workflow.md` |
| API surface | `backend/api-contracts.md` |
| Data contracts | `database/data-model.md` |
| Storage and retention | `database/storage.md` |
| Change safety | `policies/ownership.md`, `policies/automation.md` |

## Module map

| Module | Primary paths | Layer owner |
| --- | --- | --- |
| Application shell and state | `src/App.tsx`, `src/components/Sidebar.tsx` | Design + workflow |
| Article workflow UI | `src/components/workspace/Step2CoreIdea.tsx`, `Step3Outline.tsx`, `Step4Draft.tsx` | Design + workflow |
| Batch UI | `src/components/BatchActivity.tsx` | Design + workflow |
| Settings and knowledge UI | `src/components/config/**` | Design + workflow |
| Browser client | `src/lib/db.ts`, `src/lib/aiService.ts`, `src/lib/railway*.ts` | Backend contract |
| Railway service | `backend/index.ts`, `backend/providers.ts`, `backend/stepContext.ts` | Backend/workflow |
| Persistence | `backend/supabase.ts`, `supabase/migrations/**` | Database/storage |

## Agent reading order

1. Read this file and `policies/ownership.md`.
2. Classify feedback as Design, Backend, Database, or a dependency chain.
3. Read only the corresponding library documents and scoped source paths.
4. Create a request with `baseCommit`, `allowedPaths`, acceptance criteria and risk.
5. Do not modify another layer unless the request explicitly declares that dependency.

## Invariants

- Preserve the three-stage article workflow and its saved checkpoints.
- Batch-owned work may not race manual mutations while its item is active.
- Draft content must persist before it is reported as generated or reviewed.
- AI output is untrusted until schema, deterministic and evidence checks pass.
- Secrets, provider keys and Supabase service-role keys never enter frontend code or MD examples.
