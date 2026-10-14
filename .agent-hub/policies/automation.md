---
schema: agent-hub/automation-policy/v1
projectId: writer-studio
---

# Automation policy

## Auto-safe requests

Auto-execution may create a branch and pull request only when all conditions hold:

- Scope is one layer and a bounded allow-list of paths.
- No database migration, authentication, authorization, provider credential, deletion, billing or production deployment change is involved.
- Required checks pass: `npm run check`.
- The request is based on the current approved Design/Backend/Database library versions.

## Approval-required requests

Human approval is required before code changes for cross-layer workflow changes, broad UI redesigns, new third-party integrations, batch/concurrency changes, new APIs and semantic policy changes.

Human approval is required before merge/deploy for every database migration, RLS/storage policy, auth/permission change, data deletion, billing/provider configuration or production deployment.

## External reference ingestion

External design sources are read-only research inputs. Fetching or refreshing a source may create a review proposal but cannot automatically alter canonical Design MD files or product UI.
