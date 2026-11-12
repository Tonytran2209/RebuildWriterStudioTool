#!/usr/bin/env node
import { createHash, randomInt, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webpDimensions } from "./webp.mjs";

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

function workflow(prompt, checkpoint, reference = null) {
  const steps = Number(process.env.WRITER_COMFY_STEPS || 24);
  if (!Number.isInteger(steps) || steps < 1 || steps > 50) throw new Error("WRITER_COMFY_STEPS must be an integer from 1 to 50.");
  const graph = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: "text, watermark, logo, unsupported statistics, extra limbs, blurry", clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 576, batch_size: 1 } },
    "5": { class_type: "KSampler", inputs: { seed: randomInt(0, 2 ** 32), steps, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1,
      model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0] } },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "8": { class_type: "ImageScale", inputs: { image: ["6", 0], upscale_method: "lanczos", width: 1280, height: 720, crop: "center" } },
    "7": { class_type: "SaveAnimatedWEBP", inputs: { filename_prefix: "writer-studio", images: ["8", 0], fps: 1, lossless: false, quality: 88, method: "default" } },
  };
  if (reference) {
    graph["9"] = { class_type: "LoadImage", inputs: { image: reference.filename } };
    graph["10"] = { class_type: "IPAdapterModelLoader", inputs: { ipadapter_file: reference.ipadapterModel } };
    graph["11"] = { class_type: "CLIPVisionLoader", inputs: { clip_name: reference.clipVisionModel } };
    graph["12"] = { class_type: "IPAdapterAdvanced", inputs: {
      model: ["1", 0], ipadapter: ["10", 0], clip_vision: ["11", 0], image: ["9", 0],
      weight: 0.45, weight_type: "style transfer", combine_embeds: "concat",
      start_at: 0, end_at: 1, embeds_scaling: "V only",
    } };
    graph["5"].inputs.model = ["12", 0];
  }
  return graph;
}

async function referenceFor(input) {
  if (!input.referenceImage) return null;
  if (!/^[a-z0-9][a-z0-9._-]+\.(png|jpg|jpeg|webp)$/i.test(input.referenceImage)
    || !/^[a-f0-9]{64}$/.test(input.referenceSha256 || "")) throw new Error("Invalid style reference manifest.");
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "style-references", input.referenceImage);
  const bytes = await readFile(file);
  if (createHash("sha256").update(bytes).digest("hex") !== input.referenceSha256)
    throw new Error("Style reference checksum mismatch.");
  const nodes = await (await request("/object_info")).json();
  const ipadapterModel = process.env.WRITER_COMFY_IPADAPTER_MODEL;
  const clipVisionModel = process.env.WRITER_COMFY_CLIP_VISION_MODEL;
  if (!nodes?.IPAdapterAdvanced || !nodes?.IPAdapterModelLoader || !nodes?.CLIPVisionLoader || !nodes?.LoadImage
    || !nodes.IPAdapterModelLoader.input.required.ipadapter_file[0].includes(ipadapterModel)
    || !nodes.CLIPVisionLoader.input.required.clip_name[0].includes(clipVisionModel))
    throw new Error("Style reference needs compatible IPAdapter and CLIP Vision models installed in ComfyUI.");
  const filename = `writer-style-${randomUUID()}.${input.referenceImage.split(".").at(-1)}`;
  const form = new FormData();
  form.set("image", new Blob([bytes]), filename);
  form.set("overwrite", "false");
  const uploaded = await (await request("/upload/image", { method: "POST", body: form }, 30_000)).json();
  if (uploaded.name !== filename) throw new Error("ComfyUI did not accept the style reference.");
  return { filename, ipadapterModel, clipVisionModel };
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
    const nodes = await (await request("/object_info")).json();
    if (!nodes?.SaveAnimatedWEBP || !nodes?.ImageScale) throw new Error("ComfyUI needs SaveAnimatedWEBP and ImageScale nodes.");
    console.log("Local ComfyUI and checkpoint are ready.");
    return;
  }
  const [raw, output] = process.argv.slice(2);
  let input;
  try { input = JSON.parse(raw); } catch { throw new Error("Renderer input must be JSON."); }
  if (!input?.prompt?.trim() || !output || input?.output?.width !== 1280 || input?.output?.height !== 720 || input?.output?.mime !== "image/webp")
    throw new Error("Renderer requires a 1280x720 WebP visual plan.");
  const reference = await referenceFor(input);
  const submitted = await (await request("/prompt", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: randomUUID(), prompt: workflow(input.prompt, checkpoint, reference) }),
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
  const dimensions = webpDimensions(bytes);
  if (!dimensions || dimensions.width !== 1280 || dimensions.height !== 720 || bytes.length > 6_000_000) {
    throw new Error("Local ComfyUI image must be 1280x720 WebP and at most 6 MB.");
  }
  await writeFile(output, bytes, { mode: 0o600 });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
