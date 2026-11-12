#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [styleId, source] = process.argv.slice(2);
if (!styleId || !source) throw new Error("Usage: node workers/add-style-reference.mjs STYLE_ID /absolute/path/to/reference.png");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "shared", "imageStyles.json");
const styles = JSON.parse(await readFile(manifestPath, "utf8"));
const style = styles.find(item => item.id === styleId && item.approved);
if (!style) throw new Error("Unknown or unapproved style ID.");
if (!path.isAbsolute(source) || !/\.(png|jpe?g|webp)$/i.test(source)) throw new Error("Use an absolute PNG, JPEG or WebP file path.");
const bytes = await readFile(source);
if (!bytes.length || bytes.length > 6_000_000) throw new Error("Reference must be between 1 byte and 6 MB.");
const extension = path.extname(source).toLowerCase();
const name = `${styleId}${extension}`;
const folder = path.join(root, "workers", "style-references");
await mkdir(folder, { recursive: true });
await copyFile(source, path.join(folder, name));
style.referenceImage = name;
style.referenceSha256 = createHash("sha256").update(bytes).digest("hex");
style.version += 1;
await writeFile(manifestPath, JSON.stringify(styles, null, 2) + "\n");
console.log(`Reference registered for ${styleId} v${style.version}. Review and commit the image and manifest together.`);
