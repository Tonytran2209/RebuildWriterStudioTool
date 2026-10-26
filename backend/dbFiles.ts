import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { createPool } from './postgres.ts';
import { safeDocumentPath, upload, download, remove } from './documentStorage.ts';

async function main() {
  const args = process.argv.slice(2);
  const manifest = args.find(a => a.startsWith('--scope='))?.slice(8);
  if (!manifest || args.some(a => !a.startsWith('--scope=') && a !== '--apply')) throw new Error('Usage: npm run db:files -- --scope=/private/path/files.json [--apply]');
  const scope = JSON.parse(await readFile(manifest, 'utf8'));
  if (scope.project !== 'writer-studio' || !scope.ownershipEvidence || !Array.isArray(scope.paths) || scope.paths.some((p: unknown) => typeof p !== 'string') || new Set(scope.paths).size !== scope.paths.length) throw new Error('Explicit reviewed file paths and ownershipEvidence required');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('Source Supabase URL/server key required');
  if (process.env.RAILWAY_ENVIRONMENT_ID && process.env.DOCUMENT_STORAGE_ROOT !== process.env.RAILWAY_VOLUME_MOUNT_PATH) throw new Error('DOCUMENT_STORAGE_ROOT must equal the attached Railway volume mount');
  const source = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) },
  });
  const pool = createPool(process.env.DATABASE_URL);
  const created: string[] = [];
  const heartbeat = setInterval(() => console.log('Files heartbeat: verification active'), 15000);
  try {
    const docs = await pool.query("SELECT value FROM writer_studio.kv_store WHERE key='writer:files'");
    const plans = await pool.query('SELECT storage_path FROM writer_studio.content_plan_sources WHERE storage_path IS NOT NULL');
    const references = new Set<string>([...(docs.rows[0]?.value ?? []).map((d: any) => d.storagePath).filter(Boolean), ...plans.rows.map(p => p.storage_path)]);
    const legacyPlans = await pool.query("SELECT value FROM writer_studio.kv_store WHERE key LIKE 'writer:content-plan:%'");
    for (const row of legacyPlans.rows) for (const s of row.value?.sources ?? []) if (s.storagePath) references.add(s.storagePath);
    if (scope.paths.some((p: string) => !references.has(p))) throw new Error('File scope contains paths not referenced by imported Writer Studio records');
    if ([...references].some(p => !scope.paths.includes(p))) throw new Error('File scope is incomplete; include every referenced original file before switching storage');
    for (const key of scope.paths) {
      const target = safeDocumentPath(key);
      const exists = await access(target).then(() => true, (error: any) => { if (error.code === 'ENOENT') return false; throw error; });
      const response = await source.storage.from('writer-documents').download(key);
      if (response.error || !response.data) throw new Error('Source file download failed; inspect private manifest and source bucket permissions');
      const data = Buffer.from(await response.data.arrayBuffer());
      const checksum = createHash('sha256').update(data).digest('hex');
      if (exists) {
        // Resume is permitted only for byte-identical files; never overwrite.
        const prior = Buffer.from(await (await download(key)).arrayBuffer());
        if (createHash('sha256').update(prior).digest('hex') !== checksum) throw new Error('Existing target file differs; refusing overwrite');
      } else if (args.includes('--apply')) {
        await upload(key, data, response.data.type); created.push(key);
        const saved = Buffer.from(await (await download(key)).arrayBuffer());
        if (saved.length !== data.length || createHash('sha256').update(saved).digest('hex') !== checksum) throw new Error('File checksum verification failed');
      }
      console.log(`File ${scope.paths.indexOf(key) + 1}/${scope.paths.length}: ${data.length} bytes; ${exists ? 'existing checksum verified' : args.includes('--apply') ? 'copied and checksum verified' : 'source read; no write'}`);
    }
    console.log('File scope verified. Original metadata and storagePath remain unchanged. Auth still uses Supabase.');
  } catch (error) {
    for (const key of created.reverse()) await remove(key);
    throw error;
  } finally { clearInterval(heartbeat); await pool.end(); }
}
main().catch(error => { console.error('File migration stopped', error.code ?? 'VALIDATION', error.code ? 'Check storage permissions and database locally.' : error.message); process.exitCode = 1; });
