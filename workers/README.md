# Writer Studio Image Workers

Writer Studio queues image jobs on Railway. A paired Mac polls that queue, asks Codex CLI or Claude Code to write a focused image prompt, renders the image with a **local ComfyUI checkpoint**, and returns the image to Writer Studio private storage. The image model runs on the Mac. No OpenAI Image API key is needed for this path.

The server needs `backend/migrations/003_image_workers.sql` applied to the Writer Studio PostgreSQL database and the updated app deployed. Keep the existing `LAB_MONITORING_TOKEN` on Railway for authenticated AI Agent Lab monitoring. Rendering remains within the existing **Tạo ảnh minh họa** sub-job of **Writer article**; no new monitoring migration is needed.

## Prepare the Mac

1. Install Node 22+ and sign into Codex CLI or Claude Code. The selected agent writes the prompt, not the image pixels.
2. Install [ComfyUI Desktop](https://comfy.org/download) or self-hosted ComfyUI on the Mac. Run it on `127.0.0.1:8188` (the default). Install an **entirely local** checkpoint compatible with `CheckpointLoaderSimple`, `CLIPTextEncode`, `KSampler`, `VAEDecode`, `ImageScale` and `SaveAnimatedWEBP`. The local workflow renders at 1024 × 576, scales to **1280 × 720 (16:9)** and exports single-frame WebP at quality 88. If the file exceeds **300 KB (300,000 bytes)**, ComfyUI re-encodes the finished image at progressively lower quality without regenerating it. Images still over the limit are rejected. 1280 × 768 is 5:3, so it is not used. Checkpoint choice affects image quality, speed, memory use, and license.
3. With ComfyUI open, list the exact installed checkpoint names:

   ```sh
   node workers/local-comfy-image.mjs --list-checkpoints
   ```

4. Choose one listed checkpoint and verify the local renderer:

   ```sh
   export WRITER_COMFY_CHECKPOINT='exact-name-from-list.safetensors'
   node workers/local-comfy-image.mjs --check
   ```

   `WRITER_COMFY_URL` defaults to `http://127.0.0.1:8188`. Only loopback HTTP origins are accepted. If ComfyUI uses another local port, set `WRITER_COMFY_URL` accordingly.

   `WRITER_COMFY_STEPS` defaults to 24. On slower Macs, setting it to 16 can shorten generation at some cost to detail. The worker allows up to 10 minutes for the local render within the backend's 15-minute lease.

## Style library and reference images

The three built-in styles remain in `shared/imageStyles.json`. New user styles live in **Settings → Image Styles**. Enter an ID, name, visual rules and optional Markdown guide; optionally upload a reference image for an SDXL style. Save a draft, preview the saved files, and explicitly approve the version. Railway stores metadata in `writer_studio.image_style_versions` and files in the existing private document storage provider. The Draft image job shows only approved styles and freezes its style ID, version, rules and asset hashes. The AI receives the guide as untrusted appearance data only; the article brief governs image content.

After deploying this code, run `npm run db:image-styles:migrate` once on the Railway app service before saving styles. This idempotently applies `backend/migrations/004_image_style_library.sql`; the existing image-worker migration 003 must already be present. The Railway document storage must be backed by its persistent volume (`DOCUMENT_STORAGE_PROVIDER=filesystem` and `DOCUMENT_STORAGE_ROOT=RAILWAY_VOLUME_MOUNT_PATH`).

The built-in styles work as text-only profiles immediately. No reference artwork is bundled. The older repo-based tool remains available for a built-in style:

```sh
node workers/add-style-reference.mjs editorial-neutral-v1 /absolute/path/to/your-reference.png
```

For a style created in Settings, no commit is needed when uploading its guide or image. Use the same style ID to save a new draft version; the previously approved version remains active until the new one is approved. The Mac worker polls approved versions once per minute, downloads only changed versions through its paired token, checks SHA-256 and writes an atomic private cache at `~/Library/Application Support/Writer Studio/style-cache` (overridable with `WRITER_STYLE_CACHE_DIR`). A job can also fetch its exact frozen version on demand. Do not upload images whose rights or subject matter you have not checked.

Actual reference conditioning requires compatible IPAdapter Plus nodes, an SDXL checkpoint, an IPAdapter model and a CLIP Vision model installed in ComfyUI. Set `WRITER_COMFY_MODEL_FAMILY=sdxl`, `WRITER_COMFY_IPADAPTER_MODEL` and `WRITER_COMFY_CLIP_VISION_MODEL` on the Mac to match the installed models. The workflow uses `IPAdapterAdvanced` in `style transfer` mode at weight 0.45. If anything is missing, the job fails visibly with `STYLE_MODEL_MISSING`; a download/hash failure reports `STYLE_SYNC_FAILED`. It will not silently ignore the reference image. Text-only styles still work with the existing checkpoint.

The agent returns a JSON visual plan (`mustShow`, `mustNotShow`, `prompt`). The worker checks its shape, compiles the prompt with the chosen style, and rejects non-WebP or non-1280 × 720 output. These are technical checks, not proof of semantic accuracy. In Draft, inspect the private preview and explicitly confirm that the image matches the brief, contains no invented detail or text, and uses the chosen style before inserting it. There is no automatic regeneration loop.

   On the configured iMac, `~/Library/Application Support/Writer Studio/start-image-worker.sh` now uses the local renderer and reads the checkpoint name from `~/Library/Application Support/Writer Studio/comfy-checkpoint.txt`. If exactly one checkpoint is installed, the renderer selects it automatically and this file is optional. With multiple checkpoints, write the desired name into that file before running the script. The script no longer reads `writer-studio-image-api-key` from Keychain.

## Pair and run

In **Settings → Image Workers**, register one worker with agent **Codex** or **Claude Code**. Pairing tokens are shown once. Use one separate registration and process for each agent. If the token was lost or rejected, disconnect that worker and register again.

```sh
export WRITER_URL='https://your-writer-studio.example'
read -rs 'WRITER_IMAGE_WORKER_TOKEN?Paste pairing token: '
printf '\n'
export WRITER_IMAGE_WORKER_TOKEN
export WRITER_COMFY_CHECKPOINT='exact-name-from-list.safetensors'
export WRITER_IMAGE_RENDERER="$PWD/workers/local-comfy-image.mjs"
node workers/image-worker.mjs
```

Run from the Writer Studio repository root. `WRITER_IMAGE_RENDERER` must be an absolute path to an executable. `WRITER_CODEX_BIN` or `WRITER_CLAUDE_BIN` may override CLI paths. Keep the Mac awake, ComfyUI running, and this worker process running to receive jobs. The Mac needs outbound HTTPS to Writer Studio, but no inbound public port. Disconnecting a worker in Settings revokes its token.

The Mac worker receives only the image brief and section excerpt. ComfyUI stays on loopback. A 15-minute claim lease recovers interrupted jobs. The renderer must return one 1280 × 720 WebP of at most 300 KB (300,000 bytes). In Draft Content, approve a placement, choose a style and worker, generate, preview, review, then insert. Existing text and Google Docs clipboard exports do not embed these assets.

The older `openai-image.mjs` renderer is not compatible with this local WebP contract; use `local-comfy-image.mjs` for this workflow.
