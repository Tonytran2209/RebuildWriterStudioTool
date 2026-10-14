---
schema: agent-hub/storage/v1
projectId: writer-studio
---

# Storage contract

## Stored data classes

| Class | Location | Rules |
| --- | --- | --- |
| Article and workflow state | Supabase Postgres + `kv_store` | Persist checkpoints before UI completion |
| Imported documents | Supabase Storage and metadata records | Store source metadata, hash, extraction status and access policy |
| Parsed source content | Database payload/plan source records | Treat as untrusted source material |
| AI cache and workflow cache | Durable key-value records | Key by model, prompt, source fingerprint and purpose |
| Website inventory | Postgres table | Preserve canonical URL, crawl state and approval eligibility |

## Retention and privacy

- Do not put API keys, passwords, refresh tokens or service-role credentials into article payloads, logs or documents.
- Keep source documents and extracted content scoped to their content plan/project context.
- Deleting a plan or batch must make downstream article and storage effects explicit and recoverable where possible.
- Any retention or RLS change is high risk and requires human approval.
