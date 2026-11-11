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
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD/oAAAAASUVORK5CYII=", "base64");

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
      return res.end(JSON.stringify(historyReads === 1 ? {} : { "job-1": { outputs: { "7": { images: [{ filename: "image.png", subfolder: "", type: "output" }] } } } }));
    }
    if (req.url?.startsWith("/view?")) {
      res.setHeader("Content-Type", "image/png");
      return res.end(png);
    }
    res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const folder = await mkdtemp(path.join(tmpdir(), "writer-local-render-test-"));
  try {
    const output = path.join(folder, "image");
    await run(process.execPath, [renderer, "An editorial diagram", output], {
      env: { ...process.env, WRITER_COMFY_URL: `http://127.0.0.1:${server.address().port}`, WRITER_COMFY_CHECKPOINT: "local.safetensors" },
      timeout: 10_000,
    });
    assert.equal(submitted.prompt["1"].inputs.ckpt_name, "local.safetensors");
    assert.equal(submitted.prompt["2"].inputs.text, "An editorial diagram");
    assert.deepEqual(await readFile(output), png);
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
