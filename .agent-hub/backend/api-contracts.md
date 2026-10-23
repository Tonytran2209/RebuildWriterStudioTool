---
schema: agent-hub/api-contracts/v1
projectId: writer-studio
---

# API contract map

All endpoints are served by Railway. Authenticated client calls use `src/lib/db.ts` and `authenticatedRailwayFetch`.

| Domain | Endpoint family | Contract owner |
| --- | --- | --- |
| Auth | `/api/auth/*` | Backend |
| AI generation | `/api/generate`, `/api/seo/research` | Backend/workflow |
| Articles | `/api/articles/*` | Backend + database |
| Content plans | `/api/content-plans/*` | Backend + database |
| Batches | `/api/batches/*` | Backend/workflow |
| Config/files | `/api/config`, `/api/files/*`, imports/uploads | Backend + storage |
| Inventory | `/api/website-inventory/*` | Backend + database |
| Agent Library | `/api/agent-library/status`, `/context`, `/sync` | Agent Hub foundation |

## Error contract

- Return stable machine-readable `code` values for policy/prerequisite/provider failures.
- Preserve a user-readable `error` message without leaking secrets or raw provider credentials.
- Use `409` for prerequisite, workflow ownership or concurrency conflicts.
- The UI must show the error in the originating flow and retain saved output when applicable.

## API change checklist

Universal QC v9 adds optional `qualityReport.inputFingerprint` and section `grounding` to existing article JSON/checkpoint responses. Re-check saves refreshed section evidence and remapped usage with the new report in the same article update. Spec fingerprint values are opaque versioned identifiers; callers must use the shared canonical function rather than a local SHA implementation. Existing drafts/reports remain readable and require an explicit review to adopt the new metadata.

1. Version or document the request/response change.
2. Update the matching client library call.
3. Update error handling and the relevant Design flow.
4. Verify auth, batch ownership and optimistic-update behavior.

## Agent Library retrieval

- `POST /api/format/google-docs` returns `{markdown, html, formatter: "deterministic-v2", aiCalls: 0}`. Normalize em dashes to hyphens in the export copy only. HTML supports headings, emphasis, links, lists, horizontal rules and Markdown tables with aligned cells. No stored draft is mutated.

- `POST /api/agent-library/sync` compiles the Git canonical `.agent-hub` documents into a commit/content-pinned Supabase index. It is admin-only.
- `GET /api/agent-library/context?q=...&layers=design,backend&maxChars=...` returns only ranked, bounded chunks from the current indexed version.
- `GET /api/agent-library/status` reports whether a current index version exists.
- The index is a retrieval cache, never a replacement for the Git documents. A request records both its base commit and library version.
