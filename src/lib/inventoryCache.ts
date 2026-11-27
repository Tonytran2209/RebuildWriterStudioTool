/**
 * Browser cache of the Website Inventory table list (IndexedDB), keyed by backend URL, with the server revision
 * it was loaded at. Shown first when the page opens, then refreshed. Any storage failure (private window, blocked
 * site data) returns null / does nothing: the list simply loads from the server.
 */
import type { WebsiteContentRecord } from '../types';

const DB_NAME = 'writer-studio-cache';
const STORE = 'website-inventory';
export type CachedInventory = { revision: string; records: WebsiteContentRecord[]; savedAt: string };

function open(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function readInventoryCache(key: string): Promise<CachedInventory | null> {
  const db = await open();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key || 'default');
      request.onsuccess = () => { const value = request.result; resolve(value && typeof value.revision === 'string' && Array.isArray(value.records) ? value : null); db.close(); };
      request.onerror = () => { resolve(null); db.close(); };
    } catch { resolve(null); db.close(); }
  });
}

export async function writeInventoryCache(key: string, value: Omit<CachedInventory, 'savedAt'>): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...value, savedAt: new Date().toISOString() }, key || 'default');
      tx.oncomplete = () => { resolve(); db.close(); };
      tx.onerror = () => { resolve(); db.close(); };
    } catch { resolve(); db.close(); }
  });
}
