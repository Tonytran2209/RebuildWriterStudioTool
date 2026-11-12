import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const renderer = new URL("./local-comfy-image.mjs", import.meta.url).pathname;
const webp = Buffer.alloc(30);
webp.write("RIFF", 0); webp.writeUInt32LE(22, 4); webp.write("WEBPVP8X", 8);
webp.writeUInt32LE(10, 16); webp.writeUIntLE(1279, 24, 3); webp.writeUIntLE(719, 27, 3);

test("local renderer submits a checkpoint workflow and retrieves its image", async () => {
  let submitted;
  let historyReads = 0;
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/object_info/CheckpointLoaderSimple") return res.end(JSON.stringify({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [["local.safetensors"]] } } } }));
    if (req.url === "/prompt") {
      let body = "";
      for await (const chunk of req) body += chunk;
      submitted = JSON.parse(body);
      return res.end(JSON.stringify({ prompt_id: "job-1" }));
    }
    if (req.url === "/history/job-1") {
      historyReads++;
      return res.end(JSON.stringify(historyReads === 1 ? {} : { "job-1": { outputs: { "7": { images: [{ filename: "image.webp", subfolder: "", type: "output" }] } } } }));
    }
    if (req.url?.startsWith("/view?")) {
      res.setHeader("Content-Type", "image/webp");
      return res.end(webp);
    }
    res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const folder = await mkdtemp(path.join(tmpdir(), "writer-local-render-test-"));
  try {
    const output = path.join(folder, "image");
    await run(process.execPath, [renderer, JSON.stringify({prompt:"An editorial diagram", output:{width:1280,height:720,mime:"image/webp"}}), output], {
      env: { ...process.env, WRITER_COMFY_URL: `http://127.0.0.1:${server.address().port}`, WRITER_COMFY_CHECKPOINT: "local.safetensors" },
      timeout: 10_000,
    });
    assert.equal(submitted.prompt["1"].inputs.ckpt_name, "local.safetensors");
    assert.equal(submitted.prompt["2"].inputs.text, "An editorial diagram");
    assert.deepEqual(submitted.prompt["4"].inputs, { width: 1024, height: 576, batch_size: 1 });
    assert.equal(submitted.prompt["7"].class_type, "SaveAnimatedWEBP");
    assert.equal(submitted.prompt["8"].inputs.width, 1280);
    assert.deepEqual(await readFile(output), webp);
  } finally {
    server.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test("local renderer refuses non-local ComfyUI hosts", async () => {
  await assert.rejects(run(process.execPath, [renderer, "prompt", "/tmp/image"], {
    env: { ...process.env, WRITER_COMFY_URL: "https://example.com", WRITER_COMFY_CHECKPOINT: "local.safetensors" },
  }), /WRITER_COMFY_URL must be a local HTTP origin/);
});

test("text-only styles use Z Image Turbo and Qwen without SDXL or IPAdapter nodes", async () => {
  let submitted;
  const nodeNames = ["ConditioningZeroOut", "EmptySD3LatentImage", "ModelSamplingAuraFlow", "KSampler", "CLIPTextEncode", "VAEDecode"];
  const nodes = Object.fromEntries(nodeNames.map(name => [name, {}]));
  Object.assign(nodes, {
    UNETLoader: { input: { required: { unet_name: [["z_image_turbo_bf16.safetensors"]] } } },
    CLIPLoader: { input: { required: { clip_name: [["qwen_3_4b.safetensors"]] } } },
    VAELoader: { input: { required: { vae_name: [["ae.safetensors"]] } } },
  });
  const server = createServer(async (req, res) => {
    if (req.url === "/object_info/CheckpointLoaderSimple")
      return res.end(JSON.stringify({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [["sdxl.safetensors"]] } } } }));
    if (req.url === "/object_info") return res.end(JSON.stringify(nodes));
    if (req.url === "/prompt") {
      let body = "";
      for await (const chunk of req) body += chunk;
      submitted = JSON.parse(body).prompt;
      return res.end(JSON.stringify({ prompt_id: "z-job" }));
    }
    if (req.url === "/history/z-job")
      return res.end(JSON.stringify({ "z-job": { outputs: { "7": { images: [{ filename: "z.webp", type: "output" }] } } } }));
    if (req.url?.startsWith("/view?")) return res.end(webp);
    res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const folder = await mkdtemp(path.join(tmpdir(), "writer-z-image-test-"));
  try {
    const output = path.join(folder, "image");
    await run(process.execPath, [renderer, JSON.stringify({ prompt: "A diagram", modelFamily: "text-only",
      output: { width: 1280, height: 720, mime: "image/webp" } }), output], {
      env: { ...process.env, WRITER_COMFY_URL: `http://127.0.0.1:${server.address().port}`,
        WRITER_COMFY_CHECKPOINT: "sdxl.safetensors", WRITER_COMFY_TEXT_MODEL_FAMILY: "z-image-turbo" }, timeout: 10_000,
    });
    assert.equal(submitted["1"].class_type, "UNETLoader");
    assert.equal(submitted["2"].inputs.clip_name, "qwen_3_4b.safetensors");
    assert.equal(submitted["3"].inputs.vae_name, "ae.safetensors");
    assert.equal(submitted["9"].inputs.steps, 8);
    assert.equal(submitted["9"].inputs.cfg, 1);
    assert.equal(submitted["11"].inputs.width, 1280);
    assert.ok(!Object.values(submitted).some(node => node.class_type === "IPAdapterAdvanced"));
    assert.deepEqual(await readFile(output), webp);
  } finally {
    server.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test("local renderer recompresses an oversized WebP without regenerating the image", async () => {
  const large = Buffer.alloc(310_000);
  webp.copy(large);
  let prompts = [];
  const server = createServer(async (req, res) => {
    if (req.url === "/object_info/CheckpointLoaderSimple")
      return res.end(JSON.stringify({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [["local.safetensors"]] } } } }));
    if (req.url === "/upload/image") {
      let body = "";
      for await (const chunk of req) body += chunk.toString("latin1");
      const name = body.match(/writer-compress-[\w-]+\.webp/)?.[0];
      return res.end(JSON.stringify({ name }));
    }
    if (req.url === "/prompt") {
      let body = "";
      for await (const chunk of req) body += chunk;
      prompts.push(JSON.parse(body).prompt);
      return res.end(JSON.stringify({ prompt_id: `job-${prompts.length}` }));
    }
    if (req.url?.startsWith("/history/job-"))
      return res.end(JSON.stringify({ [req.url.slice(9)]: { outputs: { "7": { images: [{ filename: "image.webp", type: "output" }] } } } }));
    if (req.url?.startsWith("/view?")) return res.end(prompts.length === 1 ? large : webp);
    res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const folder = await mkdtemp(path.join(tmpdir(), "writer-compress-test-"));
  try {
    const output = path.join(folder, "image");
    await run(process.execPath, [renderer, JSON.stringify({ prompt: "A diagram", output: { width: 1280, height: 720, mime: "image/webp" } }), output], {
      env: { ...process.env, WRITER_COMFY_URL: `http://127.0.0.1:${server.address().port}`, WRITER_COMFY_CHECKPOINT: "local.safetensors" },
      timeout: 10_000,
    });
    assert.equal(prompts.length, 2);
    assert.equal(prompts[1]["6"].class_type, "LoadImage");
    assert.equal(prompts[1]["7"].inputs.quality, 82);
    assert.deepEqual(await readFile(output), webp);
  } finally {
    server.close();
    await rm(folder, { recursive: true, force: true });
  }
});
