#!/usr/bin/env node
import { randomInt, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";

const base = new URL(process.env.WRITER_COMFY_URL || "http://127.0.0.1:8188");
if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(base.hostname)
    || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
  throw new Error("WRITER_COMFY_URL must be a local HTTP origin, such as http://127.0.0.1:8188.");
}

async function request(route, options = {}, timeout = 15_000) {
  const response = await fetch(new URL(route, base), { ...options, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Local ComfyUI returned HTTP ${response.status} for ${route.split("?")[0]}.`);
  return response;
}

async function checkpoints() {
  const info = await (await request("/object_info/CheckpointLoaderSimple")).json();
  const names = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
  if (!Array.isArray(names)) throw new Error("ComfyUI did not expose local checkpoint names.");
  return names;
}

function workflow(prompt, checkpoint) {
  const steps = Number(process.env.WRITER_COMFY_STEPS || 24);
  if (!Number.isInteger(steps) || steps < 1 || steps > 50) throw new Error("WRITER_COMFY_STEPS must be an integer from 1 to 50.");
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: "text, watermark, logo, unsupported statistics, extra limbs, blurry", clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: 768, height: 768, batch_size: 1 } },
    "5": { class_type: "KSampler", inputs: { seed: randomInt(0, 2 ** 32), steps, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1,
      model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0] } },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { filename_prefix: "writer-studio", images: ["6", 0] } },
  };
}

async function main() {
  const names = await checkpoints();
  if (process.argv[2] === "--list-checkpoints") {
    for (const name of names) console.log(name);
    return;
  }
  const checkpoint = process.env.WRITER_COMFY_CHECKPOINT || (names.length === 1 ? names[0] : undefined);
  if (!checkpoint || !names.includes(checkpoint)) {
    throw new Error("Set WRITER_COMFY_CHECKPOINT to an installed checkpoint; run --list-checkpoints first.");
  }
  if (process.argv[2] === "--check") {
    console.log("Local ComfyUI and checkpoint are ready.");
    return;
  }
  const [prompt, output] = process.argv.slice(2);
  if (!prompt?.trim() || !output) throw new Error("Usage: local-comfy-image.mjs PROMPT OUTPUT");
  const submitted = await (await request("/prompt", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: randomUUID(), prompt: workflow(prompt, checkpoint) }),
  })).json();
  if (!submitted.prompt_id || submitted.error) throw new Error("ComfyUI rejected the local workflow.");

  const deadline = Date.now() + 620_000;
  let image;
  while (Date.now() < deadline) {
    const history = await (await request(`/history/${encodeURIComponent(submitted.prompt_id)}`)).json();
    const result = history?.[submitted.prompt_id];
    if (result?.status?.status_str === "error") {
      throw new Error("Local ComfyUI generation failed.");
    }
    image = result?.outputs?.["7"]?.images?.[0];
    if (image) break;
    if (result?.status?.completed === true) throw new Error("Local ComfyUI finished without an image.");
    await wait(2000);
  }
  if (!image?.filename || !["output", "temp"].includes(image.type)) throw new Error("Local ComfyUI did not return an image in time.");
  const params = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type });
  const response = await request(`/view?${params}`, {}, 30_000);
  const bytes = Buffer.from(await response.arrayBuffer());
  const png = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
  const webp = bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!bytes.length || bytes.length > 6_000_000 || !(png || jpeg || webp)) {
    throw new Error("Local ComfyUI image must be PNG, JPEG or WebP and at most 6 MB.");
  }
  await writeFile(output, bytes, { mode: 0o600 });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
