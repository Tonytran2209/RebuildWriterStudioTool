# Writer Studio Image Workers

Writer Studio queues image jobs on Railway. A paired Mac polls that queue, asks Codex CLI or Claude Code to write a focused image prompt, renders the image with a **local ComfyUI checkpoint**, and returns the image to Writer Studio private storage. The image model runs on the Mac. No OpenAI Image API key is needed for this path.

The server needs `backend/migrations/003_image_workers.sql` applied to the Writer Studio PostgreSQL database and the updated app deployed. Keep the existing `LAB_MONITORING_TOKEN` on Railway for authenticated AI Agent Lab monitoring. Rendering remains within the existing **Tạo ảnh minh họa** sub-job of **Writer article**; no new monitoring migration is needed.

## Prepare the Mac

1. Install Node 22+ and sign into Codex CLI or Claude Code. The selected agent writes the prompt, not the image pixels.
2. Install [ComfyUI Desktop](https://comfy.org/download) or self-hosted ComfyUI on the Mac. Run it on `127.0.0.1:8188` (the default). Install an **entirely local** checkpoint compatible with ComfyUI's built-in `CheckpointLoaderSimple`, `CLIPTextEncode`, `KSampler`, and `VAEDecode` nodes. Do not select partner/API nodes if the goal is local generation. A simple checkpoint workflow is included in `local-comfy-image.mjs` at 768 × 768, 24 sampling steps. Checkpoint choice affects image quality, speed, memory use, and license.
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

The Mac worker receives only the image brief and section excerpt. ComfyUI stays on loopback. A 15-minute claim lease recovers interrupted jobs. The renderer must return one PNG, JPEG or WebP under 6 MB; the included 768 × 768 workflow normally fits that limit, but a larger result fails safely. In Draft Content, approve a placement, choose a worker, generate, preview, then insert. Existing text and Google Docs clipboard exports do not embed these assets.

The older `openai-image.mjs` renderer remains available as an optional alternative for users who deliberately choose the OpenAI Image API; it is not used by the local configuration above.
