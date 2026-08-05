import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate, getAvailableProviders } from './providers.ts';
import {
  kvGet,
  kvSet,
  kvGetByPrefix,
  checkConnection,
  uploadDocumentBinary,
  downloadDocumentBinary,
  runReadOnlySelect,
} from './supabase.ts';
import { extractDocumentText } from './documentParser.ts';
import { resolveStepContext } from './stepContext.ts';

// DIST_PATH env var set by Railway start command; fallback to sibling dist/ of cwd
const DIST = process.env.DIST_PATH
  ? path.resolve(process.cwd(), process.env.DIST_PATH)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

console.log(`[static] serving frontend from: ${DIST}`);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '10mb' }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function contentMetadata(content: string) {
  return {
    contentLength: content.length,
    contentHash: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
    scanStatus: 'ready' as const,
  };
}

function assertPublicHttpUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL chỉ hỗ trợ HTTP/HTTPS.');
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' || host === '0.0.0.0' || host === '::1' ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error('Không cho phép truy cập URL nội bộ/private network.');
  return url;
}

async function fetchTextSource(urlValue: string, headers?: Record<string, string>): Promise<string> {
  const url = assertPublicHttpUrl(urlValue);
  const response = await fetch(url, { headers: headers ?? {}, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Không thể tải URL: HTTP ${response.status}.`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 10 * 1024 * 1024) throw new Error('Nguồn URL vượt giới hạn 10 MB.');
  const content = await response.text();
  if (content.length > 10 * 1024 * 1024) throw new Error('Nguồn URL vượt giới hạn 10 MB.');
  return content.trim();
}

async function fetchAirtableSource(key: string, base: string, table: string): Promise<string> {
  if (!/^app[a-zA-Z0-9]+$/.test(base)) throw new Error('Airtable Base ID không hợp lệ.');
  const url = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?pageSize=100`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Airtable API: HTTP ${response.status}.`);
  const payload = await response.json() as { records?: unknown[] };
  return JSON.stringify(payload.records ?? [], null, 2);
}

// ─── Serve Vite frontend static files ────────────────────────────────────────

app.use(express.static(DIST));

// ─── Health ──────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  const [supabaseOk] = await Promise.all([checkConnection()]);
  res.json({
    status: 'ok',
    version: '1.0.0',
    providers: getAvailableProviders(),
    supabase: supabaseOk,
    supabaseUrl: process.env.SUPABASE_URL ?? null,
  });
});

// ─── AI Generate ─────────────────────────────────────────────────────────────

app.post('/api/generate', async (req, res) => {
  const { modelId, provider, prompt, systemPrompt, stepNumber, maxTokens, temperature } = req.body;

  if (!modelId || !provider || !prompt || !Number.isInteger(stepNumber)) {
    return res.status(400).json({ error: 'modelId, provider, prompt và stepNumber là bắt buộc.' });
  }

  const providers = getAvailableProviders();
  if (!providers[provider]) {
    return res.status(400).json({
      error: `API key cho provider "${provider}" chưa được cấu hình. Thêm ${provider.toUpperCase()}_API_KEY vào Railway env.`,
    });
  }

  try {
    const stepContext = await resolveStepContext(stepNumber);
    console.log(`[generate] step=${stepNumber} provider=${provider} model=${modelId} promptLen=${prompt.length} contextChars=${stepContext.summary.totalChars}`);
    const result = await generate({
      modelId,
      provider,
      prompt,
      systemPrompt,
      contextDocs: stepContext.contextDocs,
      maxTokens,
      temperature,
    });
    console.log(`[generate] done — outputTokens=${result.usage?.outputTokens}`);
    res.json({ ...result, context: stepContext.summary, generatedAt: new Date().toISOString() });
  } catch (err: any) {
    console.error('[generate] error:', err.message);
    res.status(500).json({ error: err.message || 'Lỗi gọi AI API' });
  }
});

// ─── Provider status ─────────────────────────────────────────────────────────

app.get('/api/providers', (_req, res) => {
  res.json(getAvailableProviders());
});

// ─── Supabase KV proxy (optional — if frontend can't reach Supabase directly) ─

app.get('/api/kv/:key', async (req, res) => {
  try {
    const value = await kvGet(req.params.key);
    res.json({ value });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kv/:key', async (req, res) => {
  try {
    await kvSet(req.params.key, req.body.value);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/kv-prefix/:prefix', async (req, res) => {
  try {
    const data = await kvGetByPrefix(req.params.prefix);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Articles (via Supabase) ──────────────────────────────────────────────────

app.get('/api/articles', async (_req, res) => {
  try {
    const articles = await kvGet('writer:articles') ?? [];
    res.json(articles);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/articles', async (req, res) => {
  try {
    const article = req.body;
    const articles = await kvGet('writer:articles') ?? [];
    const updated = [article, ...(articles as any[]).filter((a: any) => a.id !== article.id)];
    await kvSet('writer:articles', updated);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/articles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const articles = (await kvGet('writer:articles') ?? []) as any[];
    const updated = articles.map(a => a.id === id ? { ...a, ...updates, updatedAt: new Date().toISOString() } : a);
    await kvSet('writer:articles', updated);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/articles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const articles = (await kvGet('writer:articles') ?? []) as any[];
    await kvSet('writer:articles', articles.filter((a: any) => a.id !== id));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Config ───────────────────────────────────────────────────────────────────

app.get('/api/config', async (_req, res) => {
  try {
    const config = await kvGet('writer:config');
    res.json(config ?? null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    const invalidSources = (req.body?.actionSources ?? []).filter((source: any) =>
      typeof source?.content !== 'string' || !source.content.trim(),
    );
    if (invalidSources.length) {
      return res.status(422).json({
        error: `Có ${invalidSources.length} Action Plan source chưa có nội dung scan. Hãy xóa và tải/nhập lại.`,
      });
    }
    const config = {
      ...req.body,
      actionSources: (req.body?.actionSources ?? []).map((source: any) => ({
        ...source,
        contentUpdatedAt: source.contentUpdatedAt ?? new Date().toISOString(),
        ...contentMetadata(source.content),
      })),
    };
    await kvSet('writer:config', config);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Files ────────────────────────────────────────────────────────────────────

app.get('/api/files', async (_req, res) => {
  try {
    const files = await kvGet('writer:files') ?? [];
    res.json(files);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/files', async (req, res) => {
  try {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Danh sách files không hợp lệ.' });
    const invalidFiles = req.body.filter((file: any) => typeof file?.content !== 'string' || !file.content.trim());
    if (invalidFiles.length) {
      return res.status(422).json({
        error: `Có ${invalidFiles.length} file chưa có nội dung scan. Hãy xóa và tải lại.`,
      });
    }
    const files = req.body.map((file: any) => ({
      ...file,
      contentUpdatedAt: file.contentUpdatedAt ?? new Date().toISOString(),
      ...contentMetadata(file.content),
    }));
    await kvSet('writer:files', files);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Multi-source import: Railway resolves content, then persists Supabase ──

app.post('/api/import/source', async (req, res) => {
  try {
    const category = String(req.body?.category ?? '');
    const sourceType = String(req.body?.sourceType ?? '');
    if (!['kb', 'action', 'rules'].includes(category)) {
      return res.status(400).json({ error: 'category phải là kb, action hoặc rules.' });
    }
    if (!['paste', 'url', 'gsheet', 'manual', 'supabase', 'airtable'].includes(sourceType)) {
      return res.status(400).json({ error: 'Loại nguồn dữ liệu không được hỗ trợ.' });
    }

    let content = '';
    if (sourceType === 'paste' || sourceType === 'manual') {
      content = String(req.body.content ?? '').trim();
    } else if (sourceType === 'url' || sourceType === 'gsheet') {
      content = await fetchTextSource(String(req.body.url ?? ''), req.body.headers);
    } else if (sourceType === 'supabase') {
      content = JSON.stringify(await runReadOnlySelect(String(req.body.query ?? '')), null, 2);
    } else if (sourceType === 'airtable') {
      content = await fetchAirtableSource(
        String(req.body.airtableKey ?? ''),
        String(req.body.airtableBase ?? ''),
        String(req.body.airtableTable ?? ''),
      );
    }
    if (!content) return res.status(422).json({ error: 'Nguồn không trả về nội dung để AI đọc.' });

    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    const name = String(req.body.name ?? '').trim() || `${sourceType}-${timestamp.slice(0, 10)}`;
    const common = {
      id,
      name,
      sourceType,
      addedAt: timestamp,
      uploadedAt: timestamp,
      contentUpdatedAt: timestamp,
      content,
      preview: content.split('\n').slice(0, 4).join('\n'),
      rowCount: content.split('\n').filter(Boolean).length,
      size: formatBytes(Buffer.byteLength(content, 'utf8')),
      fileType: sourceType === 'manual' ? 'csv' : sourceType === 'paste' ? String(req.body.format ?? 'txt') : 'json',
      url: sourceType === 'url' || sourceType === 'gsheet' ? req.body.url : undefined,
      query: sourceType === 'supabase' ? req.body.query : undefined,
      airtableBase: sourceType === 'airtable' ? req.body.airtableBase : undefined,
      airtableTable: sourceType === 'airtable' ? req.body.airtableTable : undefined,
      columns: sourceType === 'manual' ? req.body.columns : undefined,
      rows: sourceType === 'manual' ? req.body.rows : undefined,
      ...contentMetadata(content),
    };

    if (category === 'action') {
      const config = (await kvGet<Record<string, any>>('writer:config')) ?? {};
      config.actionSources = [common, ...(config.actionSources ?? []).filter((item: any) => item.id !== id)];
      await kvSet('writer:config', config);
      return res.status(201).json({ target: 'writer:config.actionSources', record: common });
    }

    const record = { ...common, category };
    const files = (await kvGet<any[]>('writer:files')) ?? [];
    await kvSet('writer:files', [record, ...files.filter(item => item.id !== id)]);
    return res.status(201).json({ target: 'writer:files', record });
  } catch (err: any) {
    console.error('[import/source] error:', err.message);
    return res.status(500).json({ error: err.message || 'Không thể import nguồn dữ liệu.' });
  }
});

// ─── Document upload: Railway parses, then persists extracted content ────────

app.post('/api/upload/document', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Thiếu file upload.' });
    const category = String(req.body.category ?? '');
    if (!['kb', 'rules', 'action'].includes(category)) {
      return res.status(400).json({ error: 'category phải là kb, rules hoặc action.' });
    }

    const content = (await extractDocumentText(req.file.buffer, req.file.originalname)).trim();
    if (!content) return res.status(422).json({ error: 'File không có nội dung văn bản để AI scan.' });

    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    const fileType = req.file.originalname.split('.').pop()?.toLowerCase() ?? 'txt';
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const storagePath = `${category}/${id}/${safeName}`;
    await uploadDocumentBinary(storagePath, req.file.buffer, req.file.mimetype || 'application/octet-stream');

    if (category === 'action') {
      const config = (await kvGet<Record<string, any>>('writer:config')) ?? {};
      const source = {
        id,
        name: req.file.originalname,
        sourceType: 'file',
        addedAt: timestamp,
        contentUpdatedAt: timestamp,
        fileType,
        size: formatBytes(req.file.size),
        storagePath,
        originalMimeType: req.file.mimetype || 'application/octet-stream',
        content,
        preview: content.split('\n').slice(0, 4).join('\n'),
        rowCount: content.split('\n').filter(Boolean).length,
        ...contentMetadata(content),
      };
      config.actionSources = [source, ...(config.actionSources ?? []).filter((item: any) => item.id !== id)];
      await kvSet('writer:config', config);
      return res.status(201).json({ target: 'writer:config.actionSources', record: source });
    }

    const record = {
      id,
      name: req.file.originalname,
      size: formatBytes(req.file.size),
      uploadedAt: timestamp,
      category,
      fileType,
      storagePath,
      originalMimeType: req.file.mimetype || 'application/octet-stream',
      content,
      contentUpdatedAt: timestamp,
      ...contentMetadata(content),
    };
    const files = (await kvGet<any[]>('writer:files')) ?? [];
    await kvSet('writer:files', [record, ...files.filter(item => item.id !== id)]);
    return res.status(201).json({ target: 'writer:files', record });
  } catch (err: any) {
    console.error('[upload/document] error:', err.message);
    return res.status(500).json({ error: err.message || 'Không thể xử lý và lưu file.' });
  }
});

app.get('/api/documents/:id/download', async (req, res) => {
  try {
    const id = req.params.id;
    const [files, config] = await Promise.all([
      kvGet<any[]>('writer:files'),
      kvGet<Record<string, any>>('writer:config'),
    ]);
    const document = [
      ...(Array.isArray(files) ? files : []),
      ...(Array.isArray(config?.actionSources) ? config.actionSources : []),
    ].find(item => item?.id === id);

    if (!document) return res.status(404).json({ error: 'Không tìm thấy tài liệu trong Supabase.' });

    let payload: Buffer;
    let filename = String(document.name || `document-${id}.txt`);
    let contentType = String(document.originalMimeType || 'application/octet-stream');

    if (document.storagePath) {
      const blob = await downloadDocumentBinary(document.storagePath);
      payload = Buffer.from(await blob.arrayBuffer());
    } else if (typeof document.content === 'string' && document.content) {
      payload = Buffer.from(document.content, 'utf8');
      contentType = 'text/plain; charset=utf-8';
      if (!/\.(txt|md|csv|json|xml|tsv)$/i.test(filename)) filename = `${filename}.extracted.txt`;
    } else {
      return res.status(404).json({ error: 'Nguồn dữ liệu này chưa có nội dung có thể tải xuống.' });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', payload.length);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return res.send(payload);
  } catch (err: any) {
    console.error('[documents/download] error:', err.message);
    return res.status(500).json({ error: err.message || 'Không thể tải tài liệu.' });
  }
});

// ─── SPA fallback — serve index.html for all non-API routes ─────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 Writer Studio Backend running on port ${PORT}`);
  console.log(`   Providers: ${JSON.stringify(getAvailableProviders())}`);
  console.log(`   Supabase:  ${!!(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY)) ? '✓ Connected' : '✗ Not configured'}\n`);
});
