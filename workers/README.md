# Writer Studio Image Workers

Writer Studio queues image jobs on Railway. A paired Mac polls that queue, asks Codex CLI or Claude Code to write a focused image prompt, renders the image with a **local ComfyUI checkpoint**, and returns the image to Writer Studio private storage. The image model runs on the Mac. No OpenAI Image API key is needed for this path.

The server needs `backend/migrations/003_image_workers.sql` applied to the Writer Studio PostgreSQL database and the updated app deployed. Keep the existing `LAB_MONITORING_TOKEN` on Railway for authenticated AI Agent Lab monitoring. Rendering remains within the existing **Tạo ảnh minh họa** sub-job of **Writer article**; no new monitoring migration is needed.

## Prepare the Mac

1. Install Node 22+ and sign into Codex CLI or Claude Code. The selected agent writes the prompt, not the image pixels.
2. Install [ComfyUI Desktop](https://comfy.org/download) or self-hosted ComfyUI on the Mac. Run it on `127.0.0.1:8188` (the default). Install an **entirely local** checkpoint compatible with `CheckpointLoaderSimple`, `CLIPTextEncode`, `KSampler`, `VAEDecode`, `ImageScale` and `SaveAnimatedWEBP`. The local workflow renders at 1024 × 576, scales to **1280 × 720 (16:9)** and exports single-frame WebP at quality 88. 1280 × 768 is 5:3, so it is not used. Checkpoint choice affects image quality, speed, memory use, and license.
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

Approved style definitions live in `shared/imageStyles.json`. Each has a stable ID, version, description, visual rules, and optional reference image with SHA-256. The Draft image job lets the user choose one style. The server freezes its approved rules and output specification in the job. The AI receives style rules as appearance guidance only; the article brief governs image content.

The included three styles work as text-only profiles immediately. No reference artwork is bundled. To attach your own approved image, run:

```sh
node workers/add-style-reference.mjs editorial-neutral-v1 /absolute/path/to/your-reference.png
```

Review and commit both the changed manifest and copied image under `workers/style-references/`, then deploy the server and update the Mac checkout to the same commit. Do not add images whose rights or subject matter you have not checked. The Mac verifies the reference hash before sending it to ComfyUI.

Actual reference conditioning requires compatible IPAdapter Plus nodes, an IPAdapter model and a CLIP Vision model installed in ComfyUI. Set `WRITER_COMFY_IPADAPTER_MODEL` and `WRITER_COMFY_CLIP_VISION_MODEL` to their exact names from ComfyUI. The workflow uses `IPAdapterAdvanced` in `style transfer` mode at a restrained weight of 0.45. Verify this setup with a compatible checkpoint, preferably SDXL for style-only conditioning. If anything is missing, the job fails visibly; it will not silently ignore the reference image.

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

The Mac worker receives only the image brief and section excerpt. ComfyUI stays on loopback. A 15-minute claim lease recovers interrupted jobs. The renderer must return one 1280 × 720 WebP under 6 MB. In Draft Content, approve a placement, choose a style and worker, generate, preview, review, then insert. Existing text and Google Docs clipboard exports do not embed these assets.

The older `openai-image.mjs` renderer is not compatible with this local WebP contract; use `local-comfy-image.mjs` for this workflow.
