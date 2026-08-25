import type { Article } from '../types';

const encoder = new TextEncoder();
function crc32(data: Uint8Array) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function u16(value: number) { return new Uint8Array([value & 255, (value >>> 8) & 255]); }
function u32(value: number) { return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }
function join(parts: Uint8Array[]) { const size = parts.reduce((sum, part) => sum + part.length, 0); const output = new Uint8Array(size); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; }
function safeName(value: string, fallback: string) { return value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || fallback; }

export function buildBatchZip(articles: Article[]): Blob {
  const completed = articles.filter(article => article.draft?.trim());
  const manifest = articles.map(article => { const usage = Object.values(article.aiUsageByStep ?? {}).flat(); return ({ id: article.id, title: article.topic || article.title, status: article.batchStatus ?? article.status, step: article.currentStep, keywords: article.keywords ?? '', models: usage.map(call => call.model), totalTokens: usage.reduce((sum, call) => sum + call.totalTokens, 0), knownCostUsd: usage.reduce((sum, call) => sum + Number(call.costUsd ?? 0), 0), costComplete: usage.every(call => call.costUsd != null), error: article.batchError ?? null }); });
  const entries = [
    ...completed.map((article, index) => ({ name: `${String(index + 1).padStart(2, '0')}-${safeName(article.topic || article.title, `article-${index + 1}`)}.md`, data: encoder.encode(article.draft!) })),
    { name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest, null, 2)) },
  ];
  const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name); const crc = crc32(entry.data);
    const header = join([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name]);
    local.push(header, entry.data);
    central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += header.length + entry.data.length;
  }
  const centralBytes = join(central);
  return new Blob([join([...local, centralBytes, join([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralBytes.length), u32(offset), u16(0)])])], { type: 'application/zip' });
}
