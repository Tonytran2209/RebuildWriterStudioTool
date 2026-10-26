# Fresh document uploads on Railway

Existing extracted content and references are not deleted by this workflow. Original Supabase files are not restored automatically.

## Deployment

Attach a persistent volume to the Writer Studio application service (not the database service), mounted at `/data/writer-documents`. Configure:

```env
DATABASE_PROVIDER=postgres
DOCUMENT_STORAGE_PROVIDER=filesystem
DOCUMENT_STORAGE_ROOT=/data/writer-documents
```

Keep the existing DATABASE_URL and auth configuration. The storage root must match RAILWAY_VOLUME_MOUNT_PATH. Redeploy after configuring the volume and variables. Never use ephemeral container storage for uploaded documents.

## User workflow

Open Settings → Knowledge & Rules. The storage banner must show Railway Volume and PostgreSQL Railway. A configuration error is not a successful storage check; the banner checks directory access, while an actual upload/download confirms the full workflow.

Upload evidence and reference documents in Knowledge Base. Upload writing guides/checklists in Skills & Rules above the workflow rules editor. Both support multiple DOCX, PDF, TXT, MD, CSV, TSV, XLSX, JSON and XML files, maximum 15 MB each. Uploads run sequentially; failed files are listed individually and successful files remain visible. Only retry failed files to avoid duplicate records. Uploading the same name creates a new document ID; it does not replace an existing source.

Upload persists the original on the configured volume and extracted text in writer_studio.kv_store under writer:files immediately. Canceling Settings does not undo an upload. Save changes persists subsequent library edits, governance metadata and workflow configuration; save failures remain visible. Opening/closing Settings reloads the server library, and saving unrelated configuration does not rewrite an unchanged library.

Content Plan documents still use the Content Plan ingestion flow, sharing the same storage provider. Historical Supabase references are not rebound to new uploads. Review the source's external-use permissions before using KB material as publishable evidence.

## Smoke check

Upload one TXT in each group, download and compare its contents, close/reopen Settings and reload the app. Verify both ready-source counts and run a draft with the intended sources. These production checks must be performed after deploying the volume configuration; local builds do not confirm production persistence.
