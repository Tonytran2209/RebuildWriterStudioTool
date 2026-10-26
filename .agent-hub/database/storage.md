---
schema: agent-hub/storage/v1
projectId: writer-studio
---

# Storage contract

## Stored data classes

| Class | Location | Rules |
| --- | --- | --- |
| Article and workflow state | Explicit Supabase provider or Railway PostgreSQL writer_studio schema | Persist checkpoints before UI completion; never infer provider from URL |
| Imported documents | Supabase Storage by default; optional persistent Railway volume | Keep metadata/path; copy and checksum original bytes before switching DOCUMENT_STORAGE_PROVIDER |
| Parsed source content | Database payload/plan source records | Treat as untrusted source material |
| AI cache and workflow cache | Durable key-value records | Key by model, prompt, source fingerprint and purpose |
| Website inventory | Postgres table | Preserve canonical URL, crawl state and approval eligibility |

## Retention and privacy

- PostgreSQL remains backend-only. Supabase Auth, password recovery and the explicit Supabase Query import feature still require source credentials.
- Filesystem mode requires DOCUMENT_STORAGE_ROOT on a persistent volume. Paths are validated; uploads refuse overwrites and directory symlinks. No database blob storage or silent source fallback.
- Freeze all API activity and drain background jobs for final snapshot/cutover. Admin-only smoke mode is explicit; ordinary users remain blocked. New target writes make a provider-only rollback unsafe.
- See docs/postgres-migration.md for exact operator commands and shared-source ownership requirements.

- Do not put API keys, passwords, refresh tokens or service-role credentials into article payloads, logs or documents.
- Keep source documents and extracted content scoped to their content plan/project context.
- Deleting a plan or batch must make downstream article and storage effects explicit and recoverable where possible.
- Any retention or RLS change is high risk and requires human approval.
