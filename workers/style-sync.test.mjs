import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("approved style files sync atomically and reuse verified cache", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "writer-style-sync-"));
  process.env.WRITER_STYLE_CACHE_DIR = root;
  const { createStyleSync } = await import(`./style-sync.mjs?test=${Date.now()}`);
  const guide = "# Quiet editorial style";
  const image = Buffer.from("reference-bytes");
  const digest = data => createHash("sha256").update(data).digest("hex");
  let bundles = 0;
  const events = [];
  const call = async (route, body) => {
    if (route === "/styles/manifest") return [{id:"brand-style",version:1}];
    if (route === "/styles/sync-run") { events.push(body.status); return {ok:true}; }
    if (route === "/styles/brand-style/1/bundle") {
      bundles++;
      return {id:"brand-style",version:1,visualRules:"Calm colors",modelFamily:"sdxl",
        guide,guideSha256:digest(guide),referenceBase64:image.toString("base64"),
        referenceSha256:digest(image),referenceName:"reference.png"};
    }
    throw new Error("Unexpected request");
  };
  try {
    const sync = createStyleSync(call);
    await sync.syncApproved();
    const cached = await sync.syncOne("brand-style", 1);
    assert.equal(cached.guide, guide);
    assert.equal(cached.referenceImage, "reference.png");
    assert.deepEqual(await readFile(path.join(cached.dir, "reference.png")), image);
    assert.equal(bundles, 1);
    assert.deepEqual(events, ["running", "success"]);
  } finally { await rm(root, {recursive:true,force:true}); }
});

test("tampered style bundle is rejected and logged as failed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "writer-style-tampered-"));
  process.env.WRITER_STYLE_CACHE_DIR = root;
  const { createStyleSync } = await import(`./style-sync.mjs?tampered=${Date.now()}`);
  const events = [];
  const call = async (route, body) => {
    if (route === "/styles/sync-run") { events.push(body.status); return {ok:true}; }
    return { id:"brand-style",version:1,visualRules:"Calm",modelFamily:"text-only",
      guide:"Changed",guideSha256:"0".repeat(64),referenceBase64:null,referenceSha256:null };
  };
  try {
    await assert.rejects(createStyleSync(call).syncOne("brand-style", 1), /checksum mismatch/);
    assert.deepEqual(events, ["running", "failed"]);
  } finally { await rm(root, {recursive:true,force:true}); }
});
