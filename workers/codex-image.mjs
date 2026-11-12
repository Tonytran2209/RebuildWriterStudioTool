#!/usr/bin/env node
// Renders with Codex CLI's built-in $imagegen (billed to the signed-in ChatGPT plan, no API key),
// then crops/scales to 1280x720 WebP <= 300 KB with cwebp.
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./run-command.mjs";
import { webpDimensions } from "./webp.mjs";

const codex = process.env.WRITER_CODEX_BIN || "codex";
const cwebp = process.env.WRITER_CWEBP_BIN || "cwebp";
const imagesRoot = process.env.WRITER_CODEX_IMAGES_DIR || path.join(homedir(), ".codex", "generated_images");
const MAX_BYTES = 300_000;

// Largest centred 16:9 box inside width x height.
export function cropBox(width, height) {
  const w = Math.min(width, Math.floor(height * 16 / 9));
  const h = Math.min(height, Math.floor(w * 9 / 16));
  return { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), w, h };
}

// Codex saves $imagegen output under ~/.codex/generated_images/<session>/; it may also copy into cwd.
export async function newestImage(dirs, since) {
  let best = null;
  async function walk(dir, depth) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && depth > 0) await walk(file, depth - 1);
      else if (entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name)) {
        const { mtimeMs } = await stat(file);
        if (mtimeMs >= since && (!best || mtimeMs > best.mtimeMs)) best = { file, mtimeMs };
      }
    }
  }
  for (const dir of dirs) await walk(dir, 2);
  return best?.file ?? null;
}

async function dimensions(file) {
  const { stdout } = await runCommand("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { timeout: 15_000 });
  const width = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1]);
  if (!width || !height) throw new Error("Could not read generated image size.");
  return { width, height };
}

async function referenceFile(input) {
  if (!input.referenceImage) return null;
  if (!/^[a-z0-9][a-z0-9._-]+\.(png|jpg|jpeg|webp)$/i.test(input.referenceImage)
    || !/^[a-f0-9]{64}$/.test(input.referenceSha256 || "")) throw new Error("Invalid style reference manifest.");
  const file = path.join(process.env.WRITER_STYLE_REFERENCE_DIR
    || path.join(path.dirname(fileURLToPath(import.meta.url)), "style-references"), input.referenceImage);
  if (createHash("sha256").update(await readFile(file)).digest("hex") !== input.referenceSha256)
    throw new Error("Style reference checksum mismatch.");
  return file;
}

async function toWebp(source, output) {
  const { width, height } = await dimensions(source);
  const box = cropBox(width, height);
  for (const quality of [88, 80, 70, 60, 50]) {
    await runCommand(cwebp, ["-quiet", "-q", String(quality), "-crop", String(box.x), String(box.y), String(box.w), String(box.h),
      "-resize", "1280", "720", "-metadata", "none", source, "-o", output], { timeout: 60_000 });
    const bytes = await readFile(output);
    const size = webpDimensions(bytes);
    if (size?.width !== 1280 || size.height !== 720) throw new Error("cwebp produced the wrong dimensions.");
    if (bytes.length <= MAX_BYTES) return;
  }
  throw new Error("Image is still over 300 KB at the lowest quality.");
}

async function check() {
  await runCommand(codex, ["--version"], { timeout: 15_000 });
  await runCommand(codex, ["login", "status"], { timeout: 15_000 });
  await runCommand(cwebp, ["-version"], { timeout: 15_000 });
  console.log("Codex CLI (signed in) and cwebp are ready.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--check") await check();
  else {
    const [raw, output] = process.argv.slice(2);
    if (!raw || !output) throw new Error("Usage: codex-image.mjs '<json input>' <output.webp>");
    const input = JSON.parse(raw);
    if (typeof input.prompt !== "string" || !input.prompt.trim()) throw new Error("Missing prompt.");
    const reference = await referenceFile(input);
    const folder = path.dirname(path.resolve(output));
    const prompt = [
      "$imagegen Generate exactly one raster image. Do not ask questions; do not edit any other file.",
      "Landscape 16:9. No text, letters, numbers, logos or watermarks in the image.",
      reference ? "Match only the visual style (palette, line, texture, lighting) of the attached reference image, never its content." : "",
      `Image description: ${input.prompt.trim()}`,
      "Save the final image as ./generated.png in the current directory.",
    ].filter(Boolean).join("\n");
    const since = Date.now() - 1000;
    // Not --ephemeral: the generated image is stored under the session's folder.
    await runCommand(codex, ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check",
      ...(reference ? ["-i", reference] : []), "--", prompt], { timeout: 600_000, cwd: folder, maxBuffer: 4 * 1024 * 1024 });
    const source = await newestImage([folder, imagesRoot], since);
    if (!source || path.resolve(source) === path.resolve(output)) throw new Error("Codex did not produce an image (check plan limits).");
    await toWebp(source, output);
  }
}
