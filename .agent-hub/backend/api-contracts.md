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

## Error contract

- Return stable machine-readable `code` values for policy/prerequisite/provider failures.
- Preserve a user-readable `error` message without leaking secrets or raw provider credentials.
- Use `409` for prerequisite, workflow ownership or concurrency conflicts.
- The UI must show the error in the originating flow and retain saved output when applicable.

## API change checklist

1. Version or document the request/response change.
2. Update the matching client library call.
3. Update error handling and the relevant Design flow.
4. Verify auth, batch ownership and optimistic-update behavior.
