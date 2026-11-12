import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const cacheRoot = process.env.WRITER_STYLE_CACHE_DIR || path.join(homedir(), "Library", "Application Support", "Writer Studio", "style-cache");
const validId = /^[a-z][a-z0-9-]{2,49}$/;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const pending = new Map();

export function createStyleSync(call) {
  async function cached(id, version) {
    if (!validId.test(id) || !Number.isSafeInteger(version) || version < 1) throw new Error("Invalid style identity.");
    const dir = path.join(cacheRoot, id, String(version));
    try {
      const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
      if (manifest.referenceImage && !/^reference\.(png|jpg|jpeg|webp)$/.test(manifest.referenceImage)) return null;
      const guide = manifest.guideSha256 ? await readFile(path.join(dir, "guide.md")) : null;
      const reference = manifest.referenceSha256 ? await readFile(path.join(dir, manifest.referenceImage)) : null;
      if (manifest.id === id && manifest.version === version &&
        Boolean(guide) === Boolean(manifest.guideSha256) && Boolean(reference) === Boolean(manifest.referenceSha256) &&
        (!guide || sha(guide) === manifest.guideSha256) && (!reference || sha(reference) === manifest.referenceSha256))
        return { ...manifest, guide: guide?.toString("utf8") ?? null, dir };
    } catch { /* Missing or corrupt cache is replaced from the approved server version. */ }
    return null;
  }

  async function syncOne(id, version) {
    const key = `${id}:${version}`;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const existing = await cached(id, version);
      if (existing) return existing;
      const runId = randomUUID();
      const startedAt = new Date().toISOString();
      await call("/styles/sync-run", { runId, startedAt, status: "running" }).catch(() => {});
      try {
      const bundle = await call(`/styles/${id}/${version}/bundle`);
      if (bundle.id !== id || bundle.version !== version || typeof bundle.visualRules !== "string") throw new Error("Invalid approved style bundle.");
      const guide = bundle.guide == null ? null : Buffer.from(bundle.guide, "utf8");
      const reference = bundle.referenceBase64 == null ? null : Buffer.from(bundle.referenceBase64, "base64");
      if (Boolean(guide) !== Boolean(bundle.guideSha256) || Boolean(reference) !== Boolean(bundle.referenceSha256) ||
        (guide && (guide.length > 12_000 || sha(guide) !== bundle.guideSha256)) ||
        (reference && (reference.length > 4_000_000 || sha(reference) !== bundle.referenceSha256)))
        throw new Error("Approved style bundle checksum mismatch.");
      const extension = bundle.referenceName?.match(/\.(png|jpe?g|webp)$/i)?.[1]?.toLowerCase();
      if (reference && !extension) throw new Error("Invalid reference image type.");
      const referenceImage = reference ? `reference.${extension}` : null;
      const parent = path.join(cacheRoot, id);
      const finalDir = path.join(parent, String(version));
      const tempDir = path.join(parent, `.pending-${randomUUID()}`);
      await mkdir(tempDir, { recursive: true, mode: 0o700 });
      try {
        if (guide) await writeFile(path.join(tempDir, "guide.md"), guide, { mode: 0o600 });
        if (reference && referenceImage) await writeFile(path.join(tempDir, referenceImage), reference, { mode: 0o600 });
        const manifest = { id,version,visualRules:bundle.visualRules,modelFamily:bundle.modelFamily,
          guideSha256:bundle.guideSha256,referenceSha256:bundle.referenceSha256,referenceImage };
        await writeFile(path.join(tempDir, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
        await rm(finalDir, { recursive: true, force: true });
        await rename(tempDir, finalDir);
      } finally { await rm(tempDir, { recursive: true, force: true }).catch(() => {}) }
      const saved = await cached(id, version);
      if (!saved) throw new Error("Style cache verification failed.");
      await call("/styles/sync-run", { runId, startedAt, status: "success" }).catch(() => {});
      return saved;
      } catch (error) {
        await call("/styles/sync-run", { runId, startedAt, status: "failed", errorCode: "SYNC_FAILED" }).catch(() => {});
        throw error;
      }
    })().finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  async function syncApproved() {
    const manifest = await call("/styles/manifest");
    if (!Array.isArray(manifest)) throw new Error("Invalid approved styles manifest.");
    for (const item of manifest) await syncOne(item.id, Number(item.version));
  }
  return { syncOne, syncApproved };
}
