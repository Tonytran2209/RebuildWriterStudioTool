# Writer Studio Image Workers

Apply `backend/migrations/003_image_workers.sql` to the Writer Studio PostgreSQL database and deploy the updated app. The server uses its configured private document storage. Keep the existing `LAB_MONITORING_TOKEN` on Railway to expose authenticated reports to AI Agent Lab.

On each Mac, install Node 22+, log into Claude Code or Codex CLI with the account that will process work, then register a worker in **Settings → Image Workers**. Register Claude and Codex separately if you want both on one Mac. Use distinct pairing tokens per process.

Run one copy of the worker per registered configuration.

```sh
export WRITER_URL=https://your-writer-studio.example
export WRITER_IMAGE_WORKER_TOKEN='paste-pairing-token'
export WRITER_IMAGE_RENDERER="$PWD/workers/openai-image.mjs"
export WRITER_IMAGE_MODEL='your-enabled-image-model'
# Set OPENAI_IMAGE_API_KEY locally before starting the sample renderer.
node workers/image-worker.mjs
```

The sample renderer calls the OpenAI Image API using its own API key. The Claude Code or Codex CLI account supplies the image prompt. A different renderer can be an executable that accepts the prompt and output path as two arguments, then writes one PNG, JPEG or WebP file up to 6 MB. Override CLI paths with `WRITER_CLAUDE_BIN` or `WRITER_CODEX_BIN` if needed. A process must be running and the Mac awake to receive work. Keep tokens local and disconnect a worker in Settings to revoke its token.

In Draft Content, approve a placement, choose a worker and generate an image. Switch workers while a job is waiting, or review the resulting preview before inserting it. The worker receives only the image brief and its section excerpt. A 15-minute claim lease allows recovery after interruption. The draft keeps its placement marker and loads inserted assets from private storage in the article preview. Existing text and Google Docs clipboard exports do not embed these assets.
