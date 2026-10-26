# Writer Studio: Supabase database → Railway PostgreSQL

## Scope and current verification

This implementation changes database/storage adapters, not editorial/UI behavior. It has not connected to production, migrated live records, changed Railway variables, or verified live service names/ownership. The operator must confirm the application service is **RebuildWriterStudioTool** and destination is **Postgres-ROYC**, as supplied in the request. Never select the Intercom service or its Postgres. Repository inspection alone cannot establish ownership of rows in a shared Supabase.

Before: Railway Express → Supabase PostgREST database + Supabase Auth + private Storage. After database cutover: Railway Express → node-postgres pool → isolated **writer_studio** schema. Supabase Auth remains; optional original-file migration uses a Railway persistent volume. Database and file provider switches are independent and default to Supabase. No switch occurs merely because DATABASE_URL exists.

Active data access is centralized in backend/supabase.ts (compatibility facade), called by backend/index.ts, agentLibrary.ts and stepContext.ts. The frontend calls Railway, not direct database credentials. Existing authenticated-user/admin authorization remains. This is an app-wide workspace, not newly introduced per-user RLS. Keep the database private and use a role restricted to the writer_studio schema; PostgreSQL does not provide replacement Supabase authentication.

### Allow-list and ownership

| Records | Source tables | Required ownership selection |
| --- | --- | --- |
| Settings, articles, batches, files metadata, caches, fallback plans/inventory | kv_store | Exact reviewed writer: keys; inspect payloads, not just prefix |
| Plans | content_plans | Explicit plan UUIDs, including referenced previous versions |
| Plan sources/items | content_plan_sources, content_plan_items | Owned content_plan_id values |
| Articles | writer_articles | Explicit article IDs; include migrated_from_article_id parents |
| Usage | writer_ai_usage | Explicit IDs or owned article_id; include plan-only usage separately |
| Stage revisions | article_stage_runs | Owned article_id |
| Batch jobs/items | batch_jobs, batch_job_items | Explicit batch IDs / batch_job_id |
| Specs, QC, approvals | article_specs, quality_gate_runs, editorial_approvals | Owned article_id |
| Knowledge metadata | knowledge_items | Explicit IDs cross-checked against owned document metadata |
| Internal links | website_content_inventory | Explicit IDs verified against this app's approved inventory |
| MD library | agent_library_versions, agent_library_documents, agent_library_chunks | project_id exactly writer-studio |

These 17 tables are referenced by code and migrations 001–007. They are candidates, not proof that every production row belongs to Writer Studio. Most have no tenant/project ownership column. If a writer:config or writer:files value combines apps, STOP: this importer does not silently split shared JSON values. A separately reviewed data transformation is needed.

Excluded by default: other public tables, auth schema/users, storage metadata tables, all other project library rows, other applications' files, and legacy kv_store_48d8062f. The legacy Edge Function under supabase/functions/server uses that last table; active src code does not call it. Confirm no old client is still writing it before cutover. No active Realtime or RPC call was found; the kv_store timestamp trigger is recreated within writer_studio. Source RLS policies/service_role/anon roles are not copied. Inspect live custom triggers/functions reported by db:scope: unexpected business logic needs review before importing.

Supabase dependencies that remain:

- Auth: sign-in, refresh, sign-up, password recovery and JWT user lookup. Retain SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (or existing ANON fallback), and SUPABASE_SECRET_KEY for admin password update.
- The explicit “Supabase Query” source-import feature still queries the original Supabase. It is intentionally not redirected to the application database.
- Files remain on Supabase until DOCUMENT_STORAGE_PROVIDER is explicitly changed after file migration.
- Any separately deployed legacy Edge Function remains untouched. This is not complete Supabase removal.

## Configuration

Set in **RebuildWriterStudioTool**, after confirming the service labels in Railway:

```dotenv
DATABASE_URL=${{Postgres-ROYC.DATABASE_URL}}
DATABASE_PROVIDER=supabase
SOURCE_DATABASE_URL=<Supabase PostgreSQL connection string, server-side only>
SUPABASE_URL=<existing source project URL>
SUPABASE_SECRET_KEY=<existing source server key>
SUPABASE_PUBLISHABLE_KEY=<existing authentication public key>
DOCUMENT_STORAGE_PROVIDER=supabase
WRITER_MAINTENANCE_MODE=false
WRITER_MAINTENANCE_ALLOW_ADMIN=false
RUN_LEGACY_PROJECTION_ON_START=false
```

SOURCE_DATABASE_URL uses the **database password**, not the API key. If the direct host fails with ENETUNREACH on IPv6, obtain the **Session pooler** PostgreSQL URI in Supabase Dashboard → Connect. Use session mode (not transaction mode) for the snapshot/cursor importer. Preserve TLS verification parameters from the dashboard; do not disable certificate verification. Never paste secrets into chat or commit them.

Pool settings: max 8 connections, 10-second connection timeout, 30-second statement/idle-pool timeout, 35-second client query timeout. Import uses a read-only REPEATABLE READ source transaction, 100-row batches, a 15-second heartbeat, and destination transaction with deferred FK validation. Migration/import share an advisory lock; import also locks selected destination tables. Application stage revision writes use an advisory transaction lock. SQL values are parameterized; identifiers are validated and tables allow-listed.

## Operator procedure

Run commands from the repository root using the exact revision reviewed for deployment. Root npm scripts forward arguments to backend. Install dependencies first with npm ci and npm ci --prefix backend. On Railway, use a shell **inside RebuildWriterStudioTool** for private-network URLs and the attached volume. Running a Railway environment command on a local machine does not magically expose Railway private networking; use approved public connection endpoints only if executing locally.

1. **Backup and inspect.** Obtain a provider snapshot/backup, verify its availability and perform a restore rehearsal into an isolated test database. Keep a separate backup of original files. Do not copy an entire shared public schema into the destination. Review app ownership using source records and known Writer Studio plans/articles/files.

   ```sh
   npm run db:scope -- --output=/private/path/scope-candidates.json
   ```

   This read-only command produces IDs/keys, column types and live trigger definitions in a local mode-0600 file, without printing payloads or secrets. It deliberately leaves ownershipEvidence empty. Remove every foreign identifier; add a concrete ownership explanation to each entry. Explicitly document any omitted table or record and why it is outside Writer Studio. Empty/absent tables do not require an entry. Do not assume generated candidates are approved. Retain the inspection artifact privately, not in Git.

   Manifest example (IDs below must be replaced with real reviewed IDs):

   ```json
   {
     "project": "writer-studio",
     "sourceIdentity": "source-host:5432/postgres",
     "targetIdentity": "target-host:5432/railway",
     "entries": [
       {"table":"kv_store","column":"key","values":["writer:config","writer:files"],"ownershipEvidence":"Verified all records in these values belong exclusively to Writer Studio"},
       {"table":"content_plans","column":"id","values":["owned-plan-uuid"],"ownershipEvidence":"Matched to Writer Studio plan export"},
       {"table":"writer_articles","column":"id","values":["owned-article-id"],"ownershipEvidence":"Matched article and parent plan to Writer Studio"}
     ]
   }
   ```

   This is a format example, not a complete migration scope. Include all owned dependent rows from the table above. sourceIdentity/targetIdentity are host:port/database (no password); db:scope fills them from URLs. Import refuses a connection identity mismatch, identical endpoints, missing IDs, unreviewed entries and existing destination rows within the selected scope.

2. **Rehearse on an isolated destination.** Run migration/dry-run/apply and smoke tests below against disposable copies first. Validate row counts, representative saved drafts/QC/settings, original files, and every workflow. Do not point a rehearsal at another application's database.

3. **Freeze final writes.** Pause batches, website crawls and generation; wait for in-flight tasks to finish. Set WRITER_MAINTENANCE_MODE=true and WRITER_MAINTENANCE_ALLOW_ADMIN=false, then deploy and wait until old replicas/jobs have stopped. All /api requests, including GET endpoints that can populate caches/projections, now return 503. Stop any legacy Edge Function clients or other Writers using the same owned records. Other applications using different source records may continue. Snapshot consistency alone does not capture writes after the snapshot.

4. **Create schema explicitly.**

   ```sh
   npm run db:migrate
   ```

   Creates only writer_studio schema and its migration ledger; no auth/public/storage import, no DROP/TRUNCATE. Version/checksum drift or unversioned existing tables stop execution. No schema migration runs at startup. Legacy startup projection defaults off and must remain off throughout cutover.

5. **Review the frozen scope again, then dry-run.**

   ```sh
   npm run db:import -- --scope=/private/path/writer-scope.json
   ```

   Default is read-only with respect to source and target records: it reads a source snapshot, checks selected IDs, destination scope emptiness and column type compatibility. It does not insert rows, even temporarily. Full destination constraints/checksums are evaluated in the apply transaction before commit.

6. **Apply and verify.**

   ```sh
   npm run db:import -- --scope=/private/path/writer-scope.json --apply
   ```

   Every selected row is inserted without upsert/overwrite. IDs, arrays, JSON, nulls and timestamps including microseconds are preserved. Per-table counts and ordered full-row SHA-256 hashes must match, then all foreign keys are checked before one commit. A failure rolls back the entire database import. Logs show table/batch progress, not record values or secrets. If successful, do not rerun the same scope; it will correctly refuse existing records. After failure, fix the cause and rerun the complete scope.

   Legacy is a **separate optional** command using an independent manifest containing only explicitly reviewed KV keys from kv_store_48d8062f:

   ```sh
   npm run db:import -- --scope=/private/path/legacy-scope.json --legacy
   npm run db:import -- --scope=/private/path/legacy-scope.json --legacy --apply
   ```

   It imports into writer_studio.kv_store, does not reimport completed relational tables, and refuses key collisions. If writer:articles already exists in both datasets, stop for a reviewed merge plan; never overwrite the current array. Legacy rows lacking updated_at use the new table default; their existing fields are fully verified.

7. **Original files.** Before choosing volume storage, measure total bytes and growth in the source bucket against the reviewed references. Code limits individual uploads to 15 MiB, but production aggregate size is unknown. A volume suits the current single-service/small-document workload; for large or multi-replica deployments keep Supabase Storage until an S3-compatible adapter is separately implemented. Do not store binaries in PostgreSQL.

   Attach a persistent volume to RebuildWriterStudioTool (never Intercom). Set DOCUMENT_STORAGE_ROOT to its exact mount path, e.g. /data/writer-documents, with that directory as the actual Railway volume mount. Keep DOCUMENT_STORAGE_PROVIDER=supabase during copying. A local temp directory is not production storage.

   Make /private/path/files.json:

   ```json
   {"project":"writer-studio","ownershipEvidence":"Reviewed against imported Writer Studio file and plan-source metadata","paths":["knowledge/owned-id/original.pdf","content-plans/owned-id/source.xlsx"]}
   ```

   ```sh
   npm run db:files -- --scope=/private/path/files.json
   npm run db:files -- --scope=/private/path/files.json --apply
   ```

   The manifest must match all referenced original storagePath values in imported writer:files and relational/fallback plan sources. No unreferenced bucket objects are copied. Both modes download source bytes; dry-run writes nothing. Apply copies missing files, verifies size/SHA-256, and accepts an existing file only if byte-identical. A handled error removes only files created in that run. If a process is killed, rerun: existing complete files are checksum-verified; mismatches stop for operator review. There is no false claim of a distributed DB/filesystem transaction. Do not cut over until both phases pass.

   Original names, MIME metadata, paths and API download URLs remain unchanged. Downloads use stored paths, not saved public Supabase URLs. External source URLs (Google Docs, websites) are left intact. No automatic fallback to source Storage occurs after filesystem cutover.

8. **Cut over while paused.** Set DATABASE_PROVIDER=postgres. If file migration completed and volume is attached, also set DOCUMENT_STORAGE_PROVIDER=filesystem. Deploy; keep maintenance on. GET /health is process liveness and explicitly names providers. GET /health/dependencies executes a real database read and schema availability checks; expect databaseProvider=postgres, databaseConnected=true, relationalContentPlans=true, threeStageSessions=true. Authentication and file providers are shown separately; this endpoint does not claim Auth/Storage availability.

9. **Admin-only smoke tests.** Temporarily set WRITER_MAINTENANCE_ALLOW_ADMIN=true while WRITER_MAINTENANCE_MODE=true and deploy. Only login/refresh and authenticated admin workflow requests are admitted; ordinary users remain blocked. Verify with a non-admin session that maintenance still holds. Use marked test records and verify:

   - Login/refresh; existing plans, articles, QC and library context load.
   - Create/edit/delete test article and test plan.
   - Approve, reject/backtrack, approve again; regenerate outline/draft; revision history remains distinct/idempotent.
   - Single and batch generation checkpoint/save/reload; settings save.
   - Upload/download original document with identical bytes; delete test document.
   - A constraint error reports its actual cause; it is not relabeled as a connection error.

   Admin smoke writes are real target changes. Record them for rollback accounting. Do not import again after smoke writes.

10. **Reopen.** Only after verification, set maintenance and admin-smoke flags false, deploy, resume batches/crawls and monitor dependency health and error logs. Keep source unchanged during observation. Remove SOURCE_DATABASE_URL from the long-running app after the import window (retain securely for controlled recovery). Do not remove Supabase Auth/server credentials while authentication/recovery or Supabase Query still depends on them.

## Rollback

Before any target writes (including admin smoke), with source still frozen and unchanged, switching DATABASE_PROVIDER back to supabase and storage back to supabase is a viable rollback after verifying source health.

Once target writes exist, **switching the provider back alone loses data**. Freeze again, drain jobs, back up the target database and volume, and inventory all changes since cutover (including updates/deletes, new file bytes and smoke records). Prefer repairing forward. Otherwise perform an explicitly approved reconciliation into the source using a separate reviewed reverse-migration process; no blind reverse importer is provided because the source is shared. Validate both datasets and files before reopening. This implementation never modifies source tables or deletes source objects.

## Verification limits

Local tests exercise PostgreSQL engine SQL via PGlite: schema, JSONB/arrays, constraints, ledger checks, snapshot cursors, dry-run, rollback, checksums, timestamps, legacy import and revision behavior, plus filesystem roundtrips. Production Supabase ownership, source custom triggers, TCP/TLS/pool behavior against Railway, source file volume and live authenticated AI workflows still require the rehearsal/operator smoke checks above. Never interpret a local test pass as production cutover approval.

## Implementation map

| Files | Responsibility |
| --- | --- |
| backend/postgres.ts, backend/supabase.ts | Explicit provider routing, parameterized PostgreSQL CRUD, pooling, revision lock; existing Supabase compatibility |
| backend/migrations/001_writer_studio.sql, backend/dbMigrate.ts | Isolated schema, ledger, checksum, migration lock |
| backend/importScope.ts, backend/dbScope.ts, backend/dbImport.ts | Ownership manifest, read-only inventory, snapshot import/dry-run/legacy mode |
| backend/documentStorage.ts, backend/dbFiles.ts | Persistent filesystem adapter and verified original-file migration |
| backend/index.ts | Real dependency health, maintenance/admin-smoke gates, pool cleanup, opt-in legacy startup projection |
| backend/postgres.test.ts | PostgreSQL-engine, migration/import and filesystem regression tests |
| backend/.env.example | Server-side variables |
| package.json, backend/package.json, backend/package-lock.json | Operator commands, pg runtime and test dependencies |
| .agent-hub/database/data-model.md, .agent-hub/database/storage.md | Updated MD Library contracts |
| docs/postgres-migration.md | Ownership assessment, deployment sequence, limits and rollback runbook |
