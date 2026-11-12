import assert from "node:assert/strict";
import test from "node:test";
import { webpDimensions } from "./webp.mjs";

test("WebP output contract reads exact dimensions and rejects another format", () => {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(22, 4); bytes.write("WEBPVP8X", 8);
  bytes.writeUInt32LE(10, 16); bytes.writeUIntLE(1279, 24, 3); bytes.writeUIntLE(719, 27, 3);
  assert.deepEqual(webpDimensions(bytes), { width: 1280, height: 720 });
  bytes.write("PNG ", 8);
  assert.equal(webpDimensions(bytes), null);
});
