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

function workflow(prompt, checkpoint, reference = null, modelFamily = "text-only") {
  if (!reference && modelFamily === "text-only" && process.env.WRITER_COMFY_TEXT_MODEL_FAMILY === "z-image-turbo") return zImageWorkflow(prompt);
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

function zImageWorkflow(prompt) {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    "5": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    "6": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 576, batch_size: 1 } },
    "8": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 } },
    "9": { class_type: "KSampler", inputs: { seed: randomInt(0, 2 ** 32), steps: 8, cfg: 1,
      sampler_name: "res_multistep", scheduler: "simple", denoise: 1,
      model: ["8", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0] } },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["3", 0] } },
    "11": { class_type: "ImageScale", inputs: { image: ["10", 0], upscale_method: "lanczos", width: 1280, height: 720, crop: "center" } },
    "7": { class_type: "SaveAnimatedWEBP", inputs: { filename_prefix: "writer-studio", images: ["11", 0], fps: 1,
      lossless: false, quality: 88, method: "default" } },
  };
}

async function checkZImageModels(nodes) {
  const required = [
    ["UNETLoader", "unet_name", "z_image_turbo_bf16.safetensors"],
    ["CLIPLoader", "clip_name", "qwen_3_4b.safetensors"],
    ["VAELoader", "vae_name", "ae.safetensors"],
  ];
  for (const [node, field, filename] of required) {
    if (!nodes?.[node]?.input?.required?.[field]?.[0]?.includes(filename))
      throw new Error(`Z Image Turbo requires ${filename} in ComfyUI ${node}.`);
  }
  for (const node of ["ConditioningZeroOut", "EmptySD3LatentImage", "ModelSamplingAuraFlow", "KSampler", "CLIPTextEncode", "VAEDecode"]) {
    if (!nodes?.[node]) throw new Error(`Z Image Turbo requires ComfyUI node ${node}.`);
  }
}

async function referenceFor(input) {
  if (!input.referenceImage) return null;
  if (input.modelFamily === "sdxl" && process.env.WRITER_COMFY_MODEL_FAMILY !== "sdxl")
    throw new Error("Reference style requires an SDXL checkpoint and WRITER_COMFY_MODEL_FAMILY=sdxl.");
  if (!/^[a-z0-9][a-z0-9._-]+\.(png|jpg|jpeg|webp)$/i.test(input.referenceImage)
    || !/^[a-f0-9]{64}$/.test(input.referenceSha256 || "")) throw new Error("Invalid style reference manifest.");
  const file = path.join(process.env.WRITER_STYLE_REFERENCE_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "style-references"), input.referenceImage);
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

async function awaitImage(prompt, deadline) {
  const submitted = await (await request("/prompt", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: randomUUID(), prompt }),
  })).json();
  if (!submitted.prompt_id || submitted.error) throw new Error("ComfyUI rejected the local workflow.");
  while (Date.now() < deadline) {
    const history = await (await request(`/history/${encodeURIComponent(submitted.prompt_id)}`)).json();
    const result = history?.[submitted.prompt_id];
    if (result?.status?.status_str === "error") throw new Error("Local ComfyUI generation failed.");
    const image = result?.outputs?.["7"]?.images?.[0];
    if (image) {
      if (!image.filename || !["output", "temp"].includes(image.type)) throw new Error("Local ComfyUI returned an invalid image.");
      const params = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type });
      return Buffer.from(await (await request(`/view?${params}`, {}, 30_000)).arrayBuffer());
    }
    if (result?.status?.completed === true) throw new Error("Local ComfyUI finished without an image.");
    await wait(2000);
  }
  throw new Error("Local ComfyUI did not return an image in time.");
}

async function uploadForCompression(original) {
  const filename = `writer-compress-${randomUUID()}.webp`;
  const form = new FormData();
  form.set("image", new Blob([original], { type: "image/webp" }), filename);
  form.set("overwrite", "false");
  const uploaded = await (await request("/upload/image", { method: "POST", body: form }, 30_000)).json();
  if (uploaded.name !== filename) throw new Error("ComfyUI did not accept the image for compression.");
  return filename;
}

async function recompress(filename, quality, deadline) {
  return awaitImage({
    "6": { class_type: "LoadImage", inputs: { image: filename } },
    "7": { class_type: "SaveAnimatedWEBP", inputs: { filename_prefix: "writer-studio", images: ["6", 0], fps: 1,
      lossless: false, quality, method: "default" } },
  }, deadline);
}

async function main() {
  if (process.argv[2] === "--list-checkpoints") {
    const names = await checkpoints();
    for (const name of names) console.log(name);
    return;
  }
  const zImageEnabled = process.env.WRITER_COMFY_TEXT_MODEL_FAMILY === "z-image-turbo";
  if (process.argv[2] === "--check") {
    const nodes = await (await request("/object_info")).json();
    if (!nodes?.SaveAnimatedWEBP || !nodes?.ImageScale) throw new Error("ComfyUI needs SaveAnimatedWEBP and ImageScale nodes.");
    if (zImageEnabled) await checkZImageModels(nodes);
    const names = await checkpoints();
    const checkpoint = process.env.WRITER_COMFY_CHECKPOINT || (names.length === 1 ? names[0] : undefined);
    if (!checkpoint || !names.includes(checkpoint)) throw new Error("Set WRITER_COMFY_CHECKPOINT to an installed SDXL checkpoint for reference styles.");
    console.log(zImageEnabled ? "Local Z Image Turbo and SDXL reference checkpoint are ready." : "Local ComfyUI and checkpoint are ready.");
    return;
  }
  const [raw, output] = process.argv.slice(2);
  let input;
  try { input = JSON.parse(raw); } catch { throw new Error("Renderer input must be JSON."); }
  if (!input?.prompt?.trim() || !output || input?.output?.width !== 1280 || input?.output?.height !== 720 || input?.output?.mime !== "image/webp")
    throw new Error("Renderer requires a 1280x720 WebP visual plan.");
  const names = await checkpoints();
  const checkpoint = process.env.WRITER_COMFY_CHECKPOINT || (names.length === 1 ? names[0] : undefined);
  if (!checkpoint || !names.includes(checkpoint)) throw new Error("Set WRITER_COMFY_CHECKPOINT to an installed SDXL checkpoint for reference styles.");
  if (zImageEnabled && !input.referenceImage && input.modelFamily !== "sdxl") {
    const nodes = await (await request("/object_info")).json();
    await checkZImageModels(nodes);
  }
  const reference = await referenceFor(input);
  const deadline = Date.now() + 620_000;
  const original = await awaitImage(workflow(input.prompt, checkpoint, reference, input.modelFamily), deadline);
  const dimensions = webpDimensions(original);
  if (!dimensions || dimensions.width !== 1280 || dimensions.height !== 720)
    throw new Error("Local ComfyUI image must be 1280x720 WebP.");
  let bytes = original;
  const compressionInput = bytes.length > 300_000 ? await uploadForCompression(original) : null;
  for (const quality of [82, 76, 70, 64, 58, 52, 46, 40]) {
    if (bytes.length <= 300_000) break;
    bytes = await recompress(compressionInput, quality, deadline);
    const compressedDimensions = webpDimensions(bytes);
    if (!compressedDimensions || compressedDimensions.width !== 1280 || compressedDimensions.height !== 720)
      throw new Error("ComfyUI compression changed the required image format or dimensions.");
  }
  if (bytes.length > 300_000) throw new Error("Image exceeds 300 KB after WebP compression.");
  await writeFile(output, bytes, { mode: 0o600 });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
