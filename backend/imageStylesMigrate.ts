import "dotenv/config";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { createPool } from "./postgres.ts";

export async function migrateImageStyles(pool = createPool(process.env.DATABASE_URL)) {
  const client = await pool.connect();
  try {
    const prerequisite = await client.query("SELECT to_regclass('writer_studio.image_worker_jobs') IS NOT NULL AS ready");
    if (!prerequisite.rows[0].ready) throw new Error("Apply 003_image_workers.sql first.");
    await client.query(await readFile(new URL("./migrations/004_image_style_library.sql", import.meta.url), "utf8"));
    console.log("Image style library schema verified.");
  } finally { client.release(); await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  migrateImageStyles().catch(error => { console.error("Image style migration failed", error.code ?? error.message); process.exitCode = 1; });
