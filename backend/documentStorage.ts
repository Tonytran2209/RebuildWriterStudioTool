import { mkdir, readFile, open, unlink, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';

export function storageProvider() {
  const value = process.env.DOCUMENT_STORAGE_PROVIDER ?? 'supabase';
  if (!['supabase', 'filesystem'].includes(value)) throw new Error('Invalid DOCUMENT_STORAGE_PROVIDER');
  if (value === 'filesystem') {
    if (!process.env.DOCUMENT_STORAGE_ROOT || !path.isAbsolute(process.env.DOCUMENT_STORAGE_ROOT)) throw new Error('Filesystem storage requires an absolute persistent volume path');
    if (process.env.RAILWAY_ENVIRONMENT_ID && process.env.DOCUMENT_STORAGE_ROOT !== process.env.RAILWAY_VOLUME_MOUNT_PATH) throw new Error('Filesystem storage must use the attached Railway persistent volume');
  }
  return value;
}
export function safeDocumentPath(key: string, root = process.env.DOCUMENT_STORAGE_ROOT) {
  if (!root || !path.isAbsolute(root)) throw new Error('DOCUMENT_STORAGE_ROOT must be an absolute persistent volume path');
  if (!key || key.includes('\\') || key.split('/').some(part => !part || part === '..' || part === '.') || path.isAbsolute(key)) throw new Error('Unsafe document storage path');
  return path.join(root, key);
}
async function location(key: string, create = false) {
  safeDocumentPath(key);
  const root = await realpath(process.env.DOCUMENT_STORAGE_ROOT!);
  let parent = root;
  for (const component of key.split('/').slice(0, -1)) {
    parent = path.join(parent, component);
    if (create) await mkdir(parent).catch((error: any) => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Document directories cannot be symlinks');
  }
  return path.join(parent, path.basename(key));
}
export async function upload(key: string, data: Buffer, _contentType: string) {
  const target = await location(key, true);
  const handle = await open(target, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(target); throw error; }
  finally { await handle.close(); }
}
export async function download(key: string) {
  const target = await location(key);
  const resolved = await realpath(target);
  if (resolved !== target) throw new Error('Document symlinks are not supported');
  return new Blob([new Uint8Array(await readFile(target))]);
}
export async function remove(key: string) {
  try { await unlink(await location(key)); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
}
