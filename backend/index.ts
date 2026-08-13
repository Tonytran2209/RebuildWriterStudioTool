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
import { extractStructuredSections } from './documentStructure.ts';
import { resolveStepContext, resolveStep1WaveContexts, type StepWaveContext } from './stepContext.ts';
import { researchSeoKeywords, seoResearchConfigured } from './seoResearch.ts';

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
    structuredSections: extractStructuredSections(content),
  };
}

function aiCacheKey(input: unknown): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify(input), 'utf8').digest('hex');
  return `writer:ai-cache:${digest}`;
}

function extractJsonArray(content: string): unknown[] {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    }
  }
  throw new Error('AI không trả về JSON array hợp lệ cho một wave.');
}

function canonicalEvidence(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function missingStep1Coverage(items: unknown[], context: StepWaveContext): string[] {
  const records = items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  const expectedWave = canonicalEvidence(context.wave);
  const expectedWaveNumber = expectedWave.match(/\bwave\s*(\d+)\b/)?.[1];
  const expectedTimeframe = canonicalEvidence(context.timeframe);
  const inScope = records.filter(item => {
    const wave = canonicalEvidence(item.wave);
    const timeframe = canonicalEvidence(item.timeframe);
    const waveNumber = wave.match(/\bwave\s*(\d+)\b/)?.[1];
    const waveMatches = expectedWaveNumber ? waveNumber === expectedWaveNumber : wave === expectedWave;
    return waveMatches && (!expectedTimeframe || timeframe.includes(expectedTimeframe));
  });
  const missing: string[] = [];
  if (!inScope.length) missing.push(`${context.wave}${context.timeframe ? ` / ${context.timeframe}` : ''}`);
  for (const typeGroup of context.expectedTypeGroups) {
    const present = inScope.some(item =>
      String(item.typeGroup ?? item.type ?? '').toUpperCase().match(/\b(A|B|C)\b/)?.[1] === typeGroup,
    );
    if (!present) missing.push(`Type ${typeGroup}`);
  }
  return missing;
}

function step1CoverageEstimate(items: unknown[], context: StepWaveContext): string | null {
  const records = items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  const expectedWaveNumber = canonicalEvidence(context.wave).match(/\bwave\s*(\d+)\b/)?.[1];
  const expectedTimeframe = canonicalEvidence(context.timeframe);
  const count = records.filter(item => {
    const wave = canonicalEvidence(item.wave);
    const waveNumber = wave.match(/\bwave\s*(\d+)\b/)?.[1];
    const waveMatches = expectedWaveNumber ? waveNumber === expectedWaveNumber : wave === canonicalEvidence(context.wave);
    return waveMatches && (!expectedTimeframe || canonicalEvidence(item.timeframe).includes(expectedTimeframe));
  }).length;
  return count < context.expectedItemCount ? `ước lượng ${count}/${context.expectedItemCount}` : null;
}

function mergeStep1Items(...groups: unknown[][]): unknown[] {
  const seen = new Set<string>();
  return groups.flat().filter(item => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    const key = [record.typeGroup ?? record.type, record.wave, record.timeframe, record.label ?? record.name]
      .map(canonicalEvidence)
      .join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function combineStep1Responses(first: any, second: any) {
  return {
    ...second,
    usage: {
      inputTokens: (first.usage?.inputTokens ?? 0) + (second.usage?.inputTokens ?? 0),
      outputTokens: (first.usage?.outputTokens ?? 0) + (second.usage?.outputTokens ?? 0),
      cachedInputTokens: (first.usage?.cachedInputTokens ?? 0) + (second.usage?.cachedInputTokens ?? 0),
    },
  };
}

function assertCompleteStep1Result(items: unknown[], contexts: StepWaveContext[]): void {
  const failures = contexts.flatMap(context =>
    missingStep1Coverage(items, context).map(reason => `${context.scopeKey}: ${reason}`),
  );
  if (failures.length) {
    throw new Error(`Kết quả Step 1 chưa đủ manifest theo từng wave/timeframe: ${failures.join('; ')}`);
  }
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
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

// Railway liveness must not depend on an external service. If Supabase is
// temporarily slow during a deploy, waiting for it here can make Railway mark
// an otherwise healthy container as unavailable and return 502 upstream errors.
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    providers: getAvailableProviders(),
    seoResearch: seoResearchConfigured(),
    supabaseConfigured: !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY)),
  });
});

// Dependency diagnostics are kept separate from Railway's liveness probe.
app.get('/health/dependencies', async (_req, res) => {
  const supabaseOk = await checkConnection();
  res.status(supabaseOk ? 200 : 503).json({
    status: supabaseOk ? 'ok' : 'degraded',
    supabase: supabaseOk,
    supabaseUrl: process.env.SUPABASE_URL ?? null,
  });
});

app.post('/api/seo/research', async (req, res) => {
  try {
    const seeds = Array.isArray(req.body?.seeds) ? req.body.seeds : [];
    const cacheKey = `writer:seo-cache:web-v1:${crypto.createHash('sha256').update(JSON.stringify(seeds.map((seed: unknown) => String(seed).trim().toLocaleLowerCase()).sort())).digest('hex')}`;
    const cached = await kvGet<any>(cacheKey);
    if (cached?.researchedAt && Date.now() - new Date(cached.researchedAt).getTime() < 24 * 60 * 60 * 1000) {
      return res.json({ ...cached, cacheHit: true });
    }
    const result = await researchSeoKeywords(seeds);
    await kvSet(cacheKey, result);
    res.json({ ...result, cacheHit: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(message.includes('OPENAI_API_KEY') ? 503 : 502).json({ error: message });
  }
});

// ─── AI Generate ─────────────────────────────────────────────────────────────

app.post('/api/generate', async (req, res) => {
  const { modelId, provider, prompt, systemPrompt, stepNumber, maxTokens, temperature, splitByWave, bypassCache, pricing } = req.body;

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
    const startedAt = Date.now();
    const contextsStartedAt = Date.now();
    const contexts = stepNumber === 1 && splitByWave
      ? await resolveStep1WaveContexts()
      : [await resolveStepContext(stepNumber)];
    const contextMs = Date.now() - contextsStartedAt;
    const sourceFingerprint = contexts.map(context => context.summary.sourceFingerprint).sort().join('|');
    const cacheKey = aiCacheKey({ modelId, provider, prompt, systemPrompt, stepNumber, maxTokens, temperature, splitByWave: Boolean(splitByWave), sourceFingerprint, promptVersion: 9 });
    const cached = bypassCache ? null : await kvGet<any>(cacheKey);
    if (cached?.content) {
      console.log(`[generate] cache-hit step=${stepNumber} key=${cacheKey.slice(-12)} totalMs=${Date.now() - startedAt}`);
      return res.json({ ...cached, cacheHit: true, generatedAt: cached.generatedAt, servedAt: new Date().toISOString() });
    }

    console.log(`[generate] step=${stepNumber} provider=${provider} model=${modelId} waves=${contexts.length} promptLen=${prompt.length} contextChars=${contexts.reduce((sum, item) => sum + item.summary.totalChars, 0)}`);
    const providerStartedAt = Date.now();
    let result;
    if (stepNumber === 1 && splitByWave) {
      try {
        const waveResults = await runWithConcurrency(contexts as StepWaveContext[], 3, async context => {
          const callWave = async (correction?: string) => {
            const waveInstruction = [
              systemPrompt ?? '',
              '',
              `PHẠM VI REQUEST NÀY: Chỉ tổng hợp dữ liệu thuộc ${context.wave}${context.timeframe ? `, timeframe ${context.timeframe}` : ''}.`,
              'Không đưa dữ liệu từ wave khác vào response. Vẫn phải trả về duy nhất JSON array hợp lệ.',
              context.expectedTypeGroups.length
                ? `Phải bao phủ đầy đủ các nhóm nhận diện được trong section: ${context.expectedTypeGroups.map(group => `Type ${group}`).join(', ')}.`
                : 'Phải trả về tất cả lựa chọn hợp lệ có trong phạm vi này; không dừng sau lựa chọn đầu tiên.',
              `Parser nhận diện khoảng ${context.expectedItemCount} dòng Type để đối chiếu. Đây là checklist bao phủ, không phải yêu cầu tạo trùng lựa chọn cho header/evidence lặp.`,
              context.expectedRows.length
                ? `CHECKLIST CÁC DÒNG TYPE PHẢI ĐỐI CHIẾU (không được bỏ sót):\n${context.expectedRows.map((row, index) => `${index + 1}. ${row}`).join('\n')}`
                : '',
              correction ?? '',
            ].filter(Boolean).join('\n');
            const response = await generate({
              modelId,
              provider,
              prompt,
              systemPrompt: waveInstruction,
              contextDocs: context.contextDocs,
              maxTokens: Math.min(maxTokens ?? 12000, Math.max(6000, context.expectedItemCount * 1000)),
              temperature,
            });
            const items = extractJsonArray(response.content);
            return { response, items };
          };

          const first = await callWave();
          const firstMissing = missingStep1Coverage(first.items, context);
          const firstEstimate = step1CoverageEstimate(first.items, context);
          if (!firstMissing.length && !firstEstimate) return first;

          console.warn(`[generate] retry scope=${context.scopeKey} reason=${[...firstMissing, firstEstimate].filter(Boolean).join(', ')}`);
          const second = await callWave(`LẦN TRƯỚC CHƯA BAO PHỦ HẾT CHECKLIST. Hãy trả các lựa chọn hợp lệ còn thiếu trong section; không tạo bản sao cho header hoặc evidence lặp.`);
          const mergedItems = mergeStep1Items(first.items, second.items);
          const hardMissing = missingStep1Coverage(mergedItems, context);
          if (hardMissing.length) {
            throw new Error(`Thiếu scope/Type bắt buộc: ${hardMissing.join(', ')}`);
          }
          const remainingEstimate = step1CoverageEstimate(mergedItems, context);
          if (remainingEstimate) console.warn(`[generate] accepted scope=${context.scopeKey} ${remainingEstimate}; parser rows include repeated headers/evidence`);
          return { response: combineStep1Responses(first.response, second.response), items: mergedItems };
        });
        const merged = waveResults.flatMap(item => item.items);
        assertCompleteStep1Result(merged, contexts as StepWaveContext[]);
        result = {
          content: JSON.stringify(merged),
          model: waveResults[0]?.response.model ?? modelId,
          usage: {
            inputTokens: waveResults.reduce((sum, item) => sum + (item.response.usage?.inputTokens ?? 0), 0),
            outputTokens: waveResults.reduce((sum, item) => sum + (item.response.usage?.outputTokens ?? 0), 0),
            cachedInputTokens: waveResults.reduce((sum, item) => sum + (item.response.usage?.cachedInputTokens ?? 0), 0),
          },
        };
      } catch (waveError: any) {
        // Do not discard successful scoped work and pay for another huge call.
        // The frontend keeps the last complete Supabase snapshot on failure.
        console.warn(`[generate] scoped Step 1 failed; fallback=disabled reason=${waveError.message}`);
        throw new Error(`Step 1 chưa hoàn tất một scope sau 2 lần kiểm tra: ${waveError.message}`);
      }
    } else {
      const context = contexts[0];
      result = await generate({ modelId, provider, prompt, systemPrompt, contextDocs: context.contextDocs, maxTokens, temperature });
    }
    const providerMs = Date.now() - providerStartedAt;
    const generatedAt = new Date().toISOString();
    const responsePayload = {
      ...result,
      costUsd: pricing
        && Number.isFinite(Number(pricing.inputUsdPerMillion))
        && Number.isFinite(Number(pricing.outputUsdPerMillion))
        ? (() => {
          const inputTokens = result.usage?.inputTokens ?? 0;
          const cachedTokens = result.usage?.cachedInputTokens ?? 0;
          const longContext = Number(pricing.longContextThresholdTokens) > 0
            && inputTokens > Number(pricing.longContextThresholdTokens);
          const inputMultiplier = longContext ? Number(pricing.longContextInputMultiplier ?? 1) : 1;
          const outputMultiplier = longContext ? Number(pricing.longContextOutputMultiplier ?? 1) : 1;
          return ((inputTokens - cachedTokens) * Number(pricing.inputUsdPerMillion) * inputMultiplier
            + cachedTokens * Number(pricing.cachedInputUsdPerMillion ?? pricing.inputUsdPerMillion) * inputMultiplier
            + (result.usage?.outputTokens ?? 0) * Number(pricing.outputUsdPerMillion) * outputMultiplier) / 1_000_000;
        })()
        : null,
      context: {
        ...contexts[0].summary,
        totalChars: contexts.reduce((sum, item) => sum + item.summary.totalChars, 0),
        waves: contexts.length,
      },
      cacheHit: false,
      generatedAt,
      servedAt: generatedAt,
      timing: { contextMs, providerMs, totalMs: Date.now() - startedAt },
    };
    await kvSet(cacheKey, responsePayload);
    console.log(`[generate] done cache=false contextMs=${contextMs} providerMs=${providerMs} totalMs=${Date.now() - startedAt} outputTokens=${result.usage?.outputTokens}`);
    return res.json(responsePayload);
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
    const now = new Date().toISOString();
    const article = { ...req.body, updatedAt: now };
    const articles = await kvGet('writer:articles') ?? [];
    const updated = [article, ...(articles as any[]).filter((a: any) => a.id !== article.id)];
    await kvSet('writer:articles', updated);
    res.json({ ok: true, article });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/articles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const articles = (await kvGet('writer:articles') ?? []) as any[];
    const existing = articles.find(a => a.id === id);
    if (!existing) {
      res.status(404).json({ error: 'Bài viết không tồn tại trong Supabase.' });
      return;
    }
    const article = { ...existing, ...updates, id, updatedAt: new Date().toISOString() };
    const updated = articles.map(a => a.id === id ? article : a);
    await kvSet('writer:articles', updated);
    res.json({ ok: true, article });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/articles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const articles = (await kvGet('writer:articles') ?? []) as any[];
    if (!articles.some((article: any) => article.id === id)) {
      res.status(404).json({ error: 'Bài viết không tồn tại trong Supabase.' });
      return;
    }
    await kvSet('writer:articles', articles.filter((a: any) => a.id !== id));
    res.json({ ok: true, deletedId: id });
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
