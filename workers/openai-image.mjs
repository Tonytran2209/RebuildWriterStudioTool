#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

const [prompt, output] = process.argv.slice(2);
const key = process.env.OPENAI_IMAGE_API_KEY;
const model = process.env.WRITER_IMAGE_MODEL;
if (!prompt || !output || !key || !model) throw new Error("Configure OPENAI_IMAGE_API_KEY and WRITER_IMAGE_MODEL.");
const response = await fetch("https://api.openai.com/v1/images/generations", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024", output_format: "webp" }),
  signal: AbortSignal.timeout(220_000),
});
if (!response.ok) throw new Error(`Image API returned HTTP ${response.status}.`);
const result = (await response.json()).data?.[0]?.b64_json;
if (!result) throw new Error("Image API returned no image.");
await writeFile(output, Buffer.from(result, "base64"), { mode: 0o600 });
