import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generate, getAvailableProviders } from './providers.ts';
import { kvGet, kvSet, kvGetByPrefix, checkConnection } from './supabase.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try multiple candidate paths to find dist/index.html (tsx ESM resolves __dirname differently per env)
const DIST_CANDIDATES = [
  path.resolve(__dirname, '../dist'),
  path.resolve(process.cwd(), '../dist'),
  path.resolve(process.cwd(), 'dist'),
  '/app/dist',
];
const DIST = DIST_CANDIDATES.find(p => fs.existsSync(path.join(p, 'index.html'))) ?? DIST_CANDIDATES[0];
console.log(`[static] dist resolved to: ${DIST}`);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

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
  const { modelId, provider, prompt, systemPrompt, contextDocs, maxTokens, temperature } = req.body;

  if (!modelId || !provider || !prompt) {
    return res.status(400).json({ error: 'modelId, provider và prompt là bắt buộc.' });
  }

  const providers = getAvailableProviders();
  if (!providers[provider]) {
    return res.status(400).json({
      error: `API key cho provider "${provider}" chưa được cấu hình. Thêm ${provider.toUpperCase()}_API_KEY vào Railway env.`,
    });
  }

  try {
    console.log(`[generate] provider=${provider} model=${modelId} promptLen=${prompt.length}`);
    const result = await generate({ modelId, provider, prompt, systemPrompt, contextDocs, maxTokens, temperature });
    console.log(`[generate] done — outputTokens=${result.usage?.outputTokens}`);
    res.json(result);
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
    await kvSet('writer:config', req.body);
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
    await kvSet('writer:files', req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
  console.log(`   Supabase:  ${!!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) ? '✓ Connected' : '✗ Not configured'}\n`);
});
