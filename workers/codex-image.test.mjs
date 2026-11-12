import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { cropBox, newestImage } from "./codex-image.mjs";

test("cropBox keeps the largest centred 16:9 area", () => {
  assert.deepEqual(cropBox(1672, 941), { x: 0, y: 0, w: 1672, h: 940 });
  assert.deepEqual(cropBox(1024, 1024), { x: 0, y: 224, w: 1024, h: 576 });
  assert.deepEqual(cropBox(2000, 720), { x: 360, y: 0, w: 1280, h: 720 });
});

test("newestImage picks the newest image created after the job started", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-image-test-"));
  try {
    const session = path.join(root, "session");
    await mkdir(session);
    const old = path.join(session, "old.png"), fresh = path.join(session, "exec-new.png");
    await writeFile(old, "x"); await writeFile(fresh, "x"); await writeFile(path.join(session, "notes.txt"), "x");
    const now = Date.now() / 1000;
    await utimes(old, now - 3600, now - 3600);
    assert.equal(await newestImage([root], Date.now() - 60_000), fresh);
    assert.equal(await newestImage([root], Date.now() + 60_000), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
