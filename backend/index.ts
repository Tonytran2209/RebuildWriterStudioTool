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
  kvDelete,
  kvGetByPrefix,
  checkConnection,
  uploadDocumentBinary,
  downloadDocumentBinary,
  deleteDocumentBinaries,
  runReadOnlySelect,
  tableAvailable,
  tableSelect,
  tableInsert,
  tableUpsert,
  tableUpdate,
  tableDeleteWhere,
} from './supabase.ts';
import { extractDocumentText } from './documentParser.ts';
import { extractStructuredSections } from './documentStructure.ts';
import { resolveStepContext, resolveStep1WaveContexts, type StepWaveContext } from './stepContext.ts';
import { compileBackendWorkflowRules } from './workflowRules.ts';
import { researchSeoKeywords, seoResearchConfigured } from './seoResearch.ts';
import { jsonrepair } from 'jsonrepair';

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

const ARTICLE_PREFIX = 'writer:article:';
const articleMutationQueues = new Map<string, Promise<unknown>>();
const aiBudgetQueues = new Map<string, Promise<unknown>>();
const batchControllers = new Map<string, { paused: boolean; running: boolean }>();
const DAILY_AI_LIMITS: Record<number, number> = { 1: 12, 2: 12, 3: 10, 4: 6 };

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  mistral: 'Mistral',
  groq: 'Groq',
  together: 'Together AI',
  deepseek: 'DeepSeek',
};

function classifyAIError(error: unknown, provider: string, modelId: string) {
  const raw = error instanceof Error ? error.message : String(error);
  const details = typeof error === 'object' && error
    ? JSON.stringify(error, Object.getOwnPropertyNames(error))
    : raw;
  const searchable = `${raw} ${details}`.toLocaleLowerCase();
  const providerName = PROVIDER_NAMES[provider] ?? provider;
  const creditsExhausted = [
    /no credits? remaining/,
    /not enough credits?/,
    /credits?.*(?:exhausted|depleted|empty)/,
    /insufficient[_ -]?quota/,
    /insufficient.*(?:balance|funds|credits?)/,
    /credit balance.*(?:low|insufficient|exhausted|empty)/,
    /payment required/,
    /billing hard limit/,
    /(?:billing|payment).*(?:quota|limit|required|inactive|disabled)/,
    /(?:quota|limit).*(?:billing|payment)/,
    /add credits? to continue/,
  ].some(pattern => pattern.test(searchable));
  if (creditsExhausted) {
    return {
      status: 402,
      body: {
        code: 'AI_CREDITS_EXHAUSTED',
        provider,
        modelId,
        error: `${providerName} API đã hết credits hoặc tài khoản billing không còn hoạt động. Model ${modelId} tạm thời không thể chạy. Vui lòng nạp credits hoặc chọn model thuộc provider khác.`,
      },
    };
  }
  if (/giới hạn.*ai calls/i.test(raw)) {
    return { status: 429, body: { code: 'ARTICLE_DAILY_AI_LIMIT', provider, modelId, error: raw } };
  }
  const status = Number((error as any)?.status ?? (error as any)?.statusCode ?? 0);
  if (status === 429 || /rate[_ -]?limit|resource[_ -]?exhausted|too many requests|quota exceeded/i.test(searchable)) {
    return {
      status: 429,
      body: {
        code: 'AI_PROVIDER_QUOTA_EXCEEDED',
        provider,
        modelId,
        error: `${providerName} đang vượt quota hoặc rate limit cho model ${modelId}. Vui lòng thử lại sau hoặc chọn provider khác.`,
      },
    };
  }
  return { status: 500, body: { code: 'AI_PROVIDER_ERROR', provider, modelId, error: raw || 'Lỗi gọi AI API' } };
}

function serializeByKey<T>(queues: Map<string, Promise<unknown>>, key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const queued = result.finally(() => { if (queues.get(key) === queued) queues.delete(key); });
  queues.set(key, queued);
  return result;
}

async function loadArticles(): Promise<any[]> {
  const records = await kvGetByPrefix(ARTICLE_PREFIX);
  const individual = records.map(record => record.value).filter(Boolean);
  const legacy = (await kvGet<any[]>('writer:articles')) ?? [];
  const individualIds = new Set(individual.map(article => article.id));
  const missingLegacy = legacy.filter(article => article?.id && !individualIds.has(article.id));
  await Promise.all(missingLegacy.map(article => kvSet(`${ARTICLE_PREFIX}${article.id}`, article)));
  return [...individual, ...missingLegacy]
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}

async function reserveAIBudget(articleId: string, stepNumber: number): Promise<{ used: number; limit: number }> {
  const date = new Date().toISOString().slice(0, 10);
  const key = `writer:ai-budget:${date}:${articleId}:step-${stepNumber}`;
  return serializeByKey(aiBudgetQueues, key, async () => {
    const current = await kvGet<{ used?: number }>(key);
    const used = Number(current?.used ?? 0);
    const limit = DAILY_AI_LIMITS[stepNumber] ?? 6;
    if (used >= limit) throw new Error(`Đã đạt giới hạn ${limit} AI calls tính phí cho Step ${stepNumber} hôm nay. Hãy dùng kết quả đã lưu hoặc chờ sang ngày mới.`);
    await kvSet(key, { used: used + 1, limit, updatedAt: new Date().toISOString() });
    return { used: used + 1, limit };
  });
}

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

function repairModelJson(input: string) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (!inString) { if (char === '"') inString = true; output += char; continue; }
    if (escaped) { output += char; escaped = false; continue; }
    if (char === '\\') { output += char; escaped = true; continue; }
    if (char !== '"') { output += char; continue; }
    const next = input.slice(index + 1).match(/^\s*([,:}\]"])/)?.[1];
    if (next || !input.slice(index + 1).trim()) { inString = false; output += char; }
    else output += '\\"';
  }
  return output.replace(/\u00a0/g, ' ').replace(/,\s*([}\]])/g, '$1').replace(/}\s*{/g, '},{')
    .replace(/("(?:\\.|[^"\\])*"|\d+(?:\.\d+)?|true|false|null|\]|})\s*\n\s*(?="[^"\n]+"\s*:)/g, '$1,\n');
}

function parseJsonObject(raw: string): Record<string, any> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { const parsed = JSON.parse(cleaned); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed; } catch { /* scan below */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const body = cleaned.slice(start, end + 1);
    try { return JSON.parse(body); } catch {
      try { return JSON.parse(jsonrepair(body)); } catch { return JSON.parse(repairModelJson(body)); }
    }
  }
  throw new Error('AI did not return a valid JSON object.');
}

function batchUsage(step: 1 | 2 | 3 | 4, provider: string, response: any) {
  const inputTokens = response.cacheHit ? 0 : Number(response.usage?.inputTokens ?? 0);
  const outputTokens = response.cacheHit ? 0 : Number(response.usage?.outputTokens ?? 0);
  return {
    id: `usage-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    step, provider, model: response.model, inputTokens,
    cachedInputTokens: response.cacheHit ? 0 : Number(response.usage?.cachedInputTokens ?? 0),
    outputTokens, totalTokens: inputTokens + outputTokens, costUsd: response.cacheHit ? 0 : response.costUsd ?? null,
    cacheHit: Boolean(response.cacheHit), calledAt: new Date().toISOString(),
  };
}

async function saveArticleCheckpoint(article: any, updates: Record<string, any>) {
  const next = { ...article, ...updates, updatedAt: new Date().toISOString() };
  await kvSet(`${ARTICLE_PREFIX}${article.id}`, next);
  await projectArticle(next);
  return next;
}

async function projectArticle(article: any) {
  if (!await tableAvailable('writer_articles')) {
    if (article.contentPlanId) {
      const plan = await kvGet<any>(`${CONTENT_PLAN_PREFIX}${article.contentPlanId}`);
      if (plan) {
        const articleRecords = await kvGetByPrefix(ARTICLE_PREFIX);
        plan.totalArticles = articleRecords.filter(record => record.value?.contentPlanId === article.contentPlanId).length;
        plan.updatedAt = new Date().toISOString(); await kvSet(`${CONTENT_PLAN_PREFIX}${plan.id}`, plan);
      }
    }
    return;
  }
  await tableUpsert('writer_articles', {
    id: article.id, content_plan_id: article.contentPlanId ?? null, content_plan_item_id: article.contentPlanSourceItemId ?? null,
    activity_id: article.activityId ?? null, content_group: article.activityType === 'comparison-seo' ? 'comparison_seo' : article.activityType === 'editorial-originality' ? 'editorial_originality' : null,
    title: article.topic?.trim() || article.title, status: article.status, current_step: article.currentStep,
    payload: article, draft: article.draft ?? null, batch_status: article.batchStatus ?? null, error_message: article.batchError ?? null,
    created_at: article.createdAt, updated_at: article.updatedAt, completed_at: article.completedAt ?? null,
  }, 'id');
  const usage = Object.values(article.aiUsageByStep ?? {}).flat() as any[];
  for (const call of usage) await tableUpsert('writer_ai_usage', {
    id: call.id, content_plan_id: article.contentPlanId ?? null, activity_id: article.activityId ?? null, article_id: article.id,
    step: call.step, provider: call.provider, model: call.model, input_tokens: call.inputTokens ?? 0,
    cached_input_tokens: call.cachedInputTokens ?? 0, output_tokens: call.outputTokens ?? 0, total_tokens: call.totalTokens ?? 0,
    cost_usd: call.costUsd ?? null, cache_hit: Boolean(call.cacheHit), called_at: call.calledAt,
  }, 'id');
  await projectArticleStageRuns(article);
  await projectBatchState(article);
  if (article.contentPlanSourceItemId && await tableAvailable('article_stage_runs')) {
    const itemStatus = article.batchStatus === 'failed' ? 'failed'
      : article.status === 'done' || article.batchStatus === 'completed' ? 'completed'
      : article.batchStatus === 'running' ? 'generating'
      : article.currentStep > 2 ? 'in_progress'
      : article.batchStatus === 'queued' ? 'queued'
      : article.activityKind === 'single' ? 'in_progress' : 'not_started';
    await tableUpdate('content_plan_items', article.contentPlanSourceItemId, { status: itemStatus, updated_at: article.updatedAt });
  }
  if (article.contentPlanId) {
    const projected = await tableSelect<any>('writer_articles', query => query.select('id').eq('content_plan_id', article.contentPlanId));
    await tableUpdate('content_plans', article.contentPlanId, { total_articles: projected.length, status: 'active', updated_at: new Date().toISOString() });
  }
}

function snapshotFingerprint(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

async function projectArticleStageRuns(article: any) {
  if (!await tableAvailable('article_stage_runs')) return;
  const stages = [
    { stage: 'core_idea', legacyStep: 2, output: article.coreIdeaSuggestions?.length ? { suggestions: article.coreIdeaSuggestions, selectedId: article.selectedCoreIdeaId, seoResearch: article.seoResearch } : null, input: { topic: article.topic, keywords: article.keywords, contentType: article.contentType, planVersion: article.contentPlanVersion } },
    { stage: 'outline', legacyStep: 3, output: article.outline?.length ? { sections: article.outline } : null, input: { selectedCoreIdeaId: article.selectedCoreIdeaId, suggestions: article.coreIdeaSuggestions, planVersion: article.contentPlanVersion } },
    { stage: 'draft', legacyStep: 4, output: article.draft?.trim() ? { markdown: article.draft } : null, input: { outline: article.outline, selectedCoreIdeaId: article.selectedCoreIdeaId, planVersion: article.contentPlanVersion } },
  ];
  for (const entry of stages) {
    if (!entry.output) continue;
    const fingerprint = snapshotFingerprint({ input: entry.input, output: entry.output });
    const existing = await tableSelect<any>('article_stage_runs', query => query.select('id').eq('article_id', article.id).eq('stage', entry.stage).eq('input_fingerprint', fingerprint).limit(1));
    if (existing.length) continue;
    const revisions = await tableSelect<any>('article_stage_runs', query => query.select('revision_number').eq('article_id', article.id).eq('stage', entry.stage).order('revision_number', { ascending: false }).limit(1));
    const calls = article.aiUsageByStep?.[entry.legacyStep] ?? [];
    const latest = calls.at(-1);
    await tableInsert('article_stage_runs', {
      article_id: article.id, content_plan_id: article.contentPlanId ?? null,
      content_plan_item_id: article.contentPlanSourceItemId ?? null, stage: entry.stage,
      revision_number: Number(revisions[0]?.revision_number ?? 0) + 1, status: 'completed',
      input_fingerprint: fingerprint, input_snapshot: entry.input, output_snapshot: entry.output,
      model: latest?.model ?? null, prompt_version: null,
      input_tokens: latest?.inputTokens ?? 0, output_tokens: latest?.outputTokens ?? 0,
      cost_usd: latest?.costUsd ?? null, created_at: article.updatedAt,
    });
  }
}

async function projectBatchState(article: any) {
  if (!article.activityId || article.activityKind !== 'batch' || !await tableAvailable('batch_jobs')) return;
  const siblings = (await loadArticles()).filter(item => item.activityId === article.activityId);
  const status = siblings.some(item => item.batchStatus === 'running') ? 'running'
    : siblings.some(item => item.batchStatus === 'paused') ? 'paused'
    : siblings.length && siblings.every(item => item.batchStatus === 'completed') ? 'completed'
    : siblings.some(item => item.batchStatus === 'failed') ? 'failed' : 'queued';
  const calls = siblings.flatMap(item => Object.values(item.aiUsageByStep ?? {}).flat() as any[]);
  await tableUpsert('batch_jobs', {
    id: article.activityId, content_plan_id: article.contentPlanId ?? null, status,
    total_items: siblings.length, completed_items: siblings.filter(item => item.batchStatus === 'completed').length,
    failed_items: siblings.filter(item => item.batchStatus === 'failed').length,
    total_tokens: calls.reduce((sum, call) => sum + Number(call.totalTokens ?? 0), 0),
    total_cost_usd: calls.every(call => call.costUsd != null) ? calls.reduce((sum, call) => sum + Number(call.costUsd), 0) : null,
    updated_at: new Date().toISOString(),
  }, 'id');
  await tableUpsert('batch_job_items', {
    batch_job_id: article.activityId, content_plan_item_id: article.contentPlanSourceItemId ?? null,
    article_id: article.id, status: article.batchStatus ?? 'queued', error_message: article.batchError ?? null,
    updated_at: article.updatedAt,
  }, 'batch_job_id,article_id');
}

async function runBatchModel(article: any, step: 2 | 3 | 4, prompt: string, jsonMode: boolean, maxTokens: number) {
  const config = await kvGet<any>('writer:config');
  const stepConfig = config?.stepConfigs?.[step];
  const model = config?.models?.find((item: any) => item.id === stepConfig?.modelId && item.enabled);
  if (!model) throw new Error(`Step ${step}: no enabled AI model is configured.`);
  if (!getAvailableProviders()[model.provider]) throw new Error(`${model.provider} API is not configured.`);
  const compiledRules=compileBackendWorkflowRules(config,step,'batch');
  const effectivePrompt=compiledRules.taskGuidance?`${prompt}\n\n${compiledRules.taskGuidance}`:prompt;
  const context = await resolveStepContext(step, `${article.topic ?? ''} ${article.keywords ?? ''}`, article.id);
  const key = aiCacheKey({ kind: 'batch-pipeline-v3', articleId: article.id, step, model: model.id, prompt: effectivePrompt, fingerprint: `${context.summary.sourceFingerprint}:${compiledRules.fingerprint}` });
  const cached = await kvGet<any>(key);
  if (cached?.content) return { ...cached, provider: model.provider, cacheHit: true, workflowRuleSnapshot:compiledRules.snapshot };
  await reserveAIBudget(article.id, step);
  const response = await generate({ modelId: model.id, provider: model.provider, prompt: effectivePrompt, systemPrompt:compiledRules.systemPrompt, contextDocs: context.contextDocs, jsonMode, maxTokens, temperature: step === 4 ? 0.2 : 0.35 });
  const input = Number(response.usage?.inputTokens ?? 0);
  const cachedTokens = Number(response.usage?.cachedInputTokens ?? 0);
  const output = Number(response.usage?.outputTokens ?? 0);
  const pricing = model.pricing;
  const costUsd = pricing ? (((input - cachedTokens) * Number(pricing.inputUsdPerMillion ?? 0)) + (cachedTokens * Number(pricing.cachedInputUsdPerMillion ?? pricing.inputUsdPerMillion ?? 0)) + (output * Number(pricing.outputUsdPerMillion ?? 0))) / 1_000_000 : null;
  await kvSet(key, { ...response, costUsd, generatedAt: new Date().toISOString() });
  return { ...response, provider: model.provider, costUsd, cacheHit: false, workflowRuleSnapshot:compiledRules.snapshot };
}

function batchSeoFailures(text: string, article: any, targetWords: number) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const idea = article.coreIdeaSuggestions?.find((item: any) => item.id === article.selectedCoreIdeaId) ?? article.coreIdeaSuggestions?.[0];
  const primaryKeyword = String(idea?.primaryKeyword ?? String(article.keywords ?? '').split(',')[0] ?? article.topic ?? '').trim();
  const normalizedKeyword = primaryKeyword.toLocaleLowerCase();
  const title = text.split('\n').find(line => /^#\s+\S/.test(line.trim()))?.replace(/^#\s+/, '').trim() ?? '';
  const failures = [
    !normalizedKeyword || !title.toLocaleLowerCase().includes(normalizedKeyword) ? 'H1 title must contain the exact primary keyword' : '',
    words < 800 ? 'article must contain at least 800 English words' : '',
    words < targetWords * 0.9 || words > targetWords ? `article must contain 90–100% of the ${targetWords}-word target` : '',
    !/^#{2,3}\s+\S/m.test(text) ? 'article must contain Markdown H2/H3 headings' : '',
    !normalizedKeyword || !text.toLocaleLowerCase().includes(normalizedKeyword) ? 'body must contain the primary keyword' : '',
  ].filter(Boolean);
  return { failures, primaryKeyword, words };
}

function batchDraftBudget(outline: any[], hardLimit: number, introductionPercent=8, conclusionPercent=7) {
  const targetMax = Math.min(hardLimit, Math.max(800, Math.floor(hardLimit * 0.92)));
  const introduction = { min: Math.floor(targetMax * introductionPercent/100), max: Math.floor(targetMax * (introductionPercent+1)/100) };
  const conclusion = { min: Math.floor(targetMax * conclusionPercent/100), max: Math.floor(targetMax * (conclusionPercent+1)/100) };
  const pool = targetMax - introduction.max - conclusion.max - 20;
  const totalWeight = outline.reduce((sum, section) => sum + (section.level === 'h3' ? 0.65 : 1), 0) || 1;
  return {
    hardLimit, targetMin: Math.min(hardLimit, Math.max(800, Math.ceil(hardLimit * 0.9))), targetMax, introduction, conclusion,
    sections: outline.map(section => {
      const allocation = Math.max(35, Math.floor(pool * (section.level === 'h3' ? 0.65 : 1) / totalWeight));
      return { id: section.id, heading: section.heading, level: section.level, minWords: Math.floor(allocation * 0.9), maxWords: allocation };
    }),
  };
}

function assembleBatchDraft(raw: string, article: any) {
  const parsed = parseJsonObject(raw);
  if (!String(parsed.title ?? '').trim() || !String(parsed.introduction ?? '').trim() || !String(parsed.conclusion ?? '').trim() || !Array.isArray(parsed.sections)) {
    throw new Error('Structured draft is missing title, introduction, sections, or conclusion.');
  }
  const expected = article.outline ?? [];
  const byId = new Map(parsed.sections.map((section: any) => [section.id, section]));
  const sections = expected.map((section: any, index: number) => byId.get(section.id) ?? parsed.sections[index]);
  if (sections.length !== expected.length || sections.some((section: any) => !String(section?.content ?? '').trim())) {
    throw new Error(`Structured draft completed only ${sections.filter((section: any) => String(section?.content ?? '').trim()).length}/${expected.length} sections.`);
  }
  const idea = article.coreIdeaSuggestions?.find((item: any) => item.id === article.selectedCoreIdeaId) ?? article.coreIdeaSuggestions?.[0];
  const keyword = String(idea?.primaryKeyword ?? String(article.keywords ?? '').split(',')[0] ?? article.topic ?? '').trim();
  const parsedTitle = String(parsed.title).trim();
  const title = parsedTitle.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()) ? parsedTitle : `${parsedTitle}: ${keyword}`;
  return [
    `# ${title}`, String(parsed.introduction).trim(),
    ...sections.flatMap((section: any, index: number) => [`${expected[index].level === 'h3' ? '###' : '##'} ${expected[index].heading}`, String(section.content).trim()]),
    '## Conclusion', String(parsed.conclusion).trim(),
  ].join('\n\n');
}

async function runBatchArticle(initial: any, controller: { paused: boolean; running: boolean }) {
  let article = initial;
  const contentMode = article.activityType === 'editorial-originality' ? 'Editorial/Originality' : 'Comparison/SEO';
  const runtimeConfig = await kvGet<any>('writer:config');
  const maxDraftWords = Math.min(10000, Math.max(800, Number(runtimeConfig?.stepConfigs?.[4]?.maxDraftWords ?? runtimeConfig?.stepConfigs?.[4]?.maxDraftCharacters ?? 1500)));
  const workflowParam=(rule:string,stage:string,param:string,fallback:number)=>Number(runtimeConfig?.workflowRules?.[rule]?.stageOverrides?.[stage]?.parameters?.[param]??fallback);
  const minimumOutlineSections=Math.min(12,Math.max(4,workflowParam('outline','outline-mapping','minimumSections',4)));
  const keywordCount=Math.min(20,Math.max(5,workflowParam('core-idea','market-research','keywordCount',10)));
  const introductionPercent=Math.min(15,Math.max(5,workflowParam('draft','word-allocation','introductionPercent',8)));
  const conclusionPercent=Math.min(12,Math.max(5,workflowParam('draft','word-allocation','conclusionPercent',7)));
  const maxSentencesPerParagraph=Math.min(7,Math.max(2,workflowParam('draft','structured-assembly','maxSentencesPerParagraph',5)));
  const appendUsage = (step: 2 | 3 | 4, response: any) => ({
    ...article.aiUsageByStep,
    [step]: [...(article.aiUsageByStep?.[step] ?? []), batchUsage(step, response.provider ?? 'unknown', response)].slice(-50),
  });
  try {
    if (controller.paused) return;
    article = await saveArticleCheckpoint(article, { batchStatus: 'running', batchError: null, batchStartedAt: article.batchStartedAt ?? new Date().toISOString(), status: 'in_progress' });
    if (!article.coreIdeaSuggestions?.length) {
      let seoResearch = article.seoResearch;
      let seoUsage: any = null;
      if (!seoResearch) {
        const seeds = [article.topic, ...String(article.keywords ?? '').split(',')].map(String).map(value => value.trim()).filter(Boolean).slice(0, 10);
        const seoKey = aiCacheKey({ kind: 'batch-seo-v2', keywordCount, seeds: seeds.map(value => value.toLowerCase()).sort() });
        seoResearch = await kvGet<any>(seoKey);
        if (seoResearch?.researchedAt && Date.now() - new Date(seoResearch.researchedAt).getTime() > 24 * 60 * 60 * 1000) seoResearch = null;
        if (!seoResearch) {
          await reserveAIBudget(article.id, 2);
          seoResearch = await researchSeoKeywords(seeds, keywordCount);
          seoUsage = batchUsage(2, 'openai', { model: 'gpt-5.4-mini-web-search', usage: seoResearch.usage, costUsd: null, cacheHit: false });
          await kvSet(seoKey, seoResearch);
          article = await saveArticleCheckpoint(article, { seoResearch, aiUsageByStep: { ...article.aiUsageByStep, 2: [...(article.aiUsageByStep?.[2] ?? []), seoUsage].slice(-50) } });
          seoUsage = null;
        }
      }
      const response = await runBatchModel(article, 2, [
        `Create the strongest evidence-grounded ${contentMode} core idea for: ${article.topic}.`,
        `SEO research: ${JSON.stringify(seoResearch.keywords)}`,
        'Use the supplied Knowledge Base and Skills. Return only JSON:',
        '{"title":string,"angleLabel":string,"angleDescription":string,"mainArgument":string,"primaryKeyword":string,"secondaryKeywords":string[],"targetAudience":string,"recommendedTone":string,"recommendedWordCount":number,"rating":{"overall":number,"seoPotential":number,"audienceFit":number,"docSupport":number,"uniqueness":number},"ratingRationale":string}',
      ].join('\n'), true, 3500);
      const idea = parseJsonObject(response.content);
      const normalized = { id: `batch-idea-${article.id}`, matchedDocs: [], ruleRefs: [], evidence: [], ...idea };
      const step2Usage = appendUsage(2, response);
      if (seoUsage) step2Usage[2] = [seoUsage, ...(step2Usage[2] ?? [])].slice(-50);
      article = await saveArticleCheckpoint(article, { seoResearch, coreIdeaSuggestions: [normalized], selectedCoreIdeaId: normalized.id, coreIdeaScannedAt: new Date().toISOString(), currentStep: 3, aiUsageByStep: step2Usage, workflowRuleSnapshots:{...article.workflowRuleSnapshots,2:response.workflowRuleSnapshot} });
    }
    if (controller.paused) { await saveArticleCheckpoint(article, { batchStatus: 'paused' }); return; }
    if (!article.outline?.length) {
      const idea = article.coreIdeaSuggestions.find((item: any) => item.id === article.selectedCoreIdeaId) ?? article.coreIdeaSuggestions[0];
      const response = await runBatchModel(article, 3, [
        `Create a detailed SEO outline for ${article.topic}.`, `Core idea: ${JSON.stringify(idea)}`,
        `Use KB facts and workflow rules. Return only JSON: {"sections":[{"heading":string,"notes":string,"rationale":string,"level":"h2"|"h3","keywords":string[],"searchIntent":"informational"|"commercial"|"transactional"|"navigational"}]}. Include at least ${minimumOutlineSections} sections.`,
      ].join('\n'), true, 5000);
      const parsed = parseJsonObject(response.content);
      const sections = (Array.isArray(parsed.sections) ? parsed.sections : []).map((section: any, index: number) => ({ id: `batch-section-${index + 1}`, evidence: [], ruleRefs: [], ...section }));
      if (sections.length < minimumOutlineSections) throw new Error(`Step 3 returned only ${sections.length}/${minimumOutlineSections} usable sections.`);
      article = await saveArticleCheckpoint(article, { outline: sections, outlineScannedAt: new Date().toISOString(), currentStep: 4, aiUsageByStep: appendUsage(3, response), workflowRuleSnapshots:{...article.workflowRuleSnapshots,3:response.workflowRuleSnapshot} });
    }
    if (controller.paused) { await saveArticleCheckpoint(article, { batchStatus: 'paused' }); return; }
    if (!article.draft?.trim()) {
      const budget = batchDraftBudget(article.outline ?? [], maxDraftWords, introductionPercent, conclusionPercent);
      const response = await runBatchModel(article, 4, [
        `Write the complete publication-ready ${contentMode} article: ${article.topic}.`,
        `Primary keyword: ${article.coreIdeaSuggestions?.[0]?.primaryKeyword ?? article.keywords ?? article.topic}.`,
        `Outline: ${JSON.stringify(article.outline)}`,
        `WORD BUDGET CONTRACT: ${JSON.stringify(budget)}`,
        `Complete every section before expanding any section. Do not repeat definitions, benefits, comparisons, evidence, or conclusions. Each paragraph serves one claim and contains at most ${maxSentencesPerParagraph} sentences.`,
        'Follow every supplied Skill rule and use only supported KB claims.',
        'Return only JSON: {"title":string,"introduction":string,"sections":[{"id":string,"content":string}],"conclusion":string}. Include exactly one non-empty entry for every outline section ID in order.',
      ].join('\n'), true, Math.min(12000, Math.max(1200, Math.ceil(maxDraftWords * 1.55))));
      if (!response.content.trim()) throw new Error('Step 4 returned an empty draft.');
      const draftResponses = [response];
      const assembledDraft = assembleBatchDraft(response.content, article);
      const validation = batchSeoFailures(assembledDraft, article, maxDraftWords);
      if (validation.failures.length) throw new Error(`Draft was not saved because the SEO checklist is not 100%: ${validation.failures.join('; ')}.`);
      article = await saveArticleCheckpoint(article, { draft: assembledDraft, draftScannedAt: new Date().toISOString(), currentStep: 4, status: 'done', completedAt: new Date().toISOString(), batchStatus: 'completed', aiUsageByStep: { ...article.aiUsageByStep, 4: [...(article.aiUsageByStep?.[4] ?? []), ...draftResponses.map(item => batchUsage(4, item.provider ?? 'unknown', item))].slice(-50) }, workflowRuleSnapshots:{...article.workflowRuleSnapshots,4:response.workflowRuleSnapshot} });
    } else if (article.batchStatus !== 'completed') {
      article = await saveArticleCheckpoint(article, { status: 'done', batchStatus: 'completed', completedAt: article.completedAt ?? new Date().toISOString() });
    }
  } catch (error: any) {
    await saveArticleCheckpoint(article, { batchStatus: 'failed', batchError: error?.message ?? String(error), status: 'review' });
  }
}

async function runBatch(activityId: string) {
  const controller = batchControllers.get(activityId) ?? { paused: false, running: false };
  if (controller.running) return;
  controller.running = true; controller.paused = false; batchControllers.set(activityId, controller);
  await kvSet(`writer:batch:${activityId}`, { activityId, status: 'running', updatedAt: new Date().toISOString() });
  try {
    const articles = (await loadArticles()).filter(article => article.activityId === activityId && article.activityKind === 'batch' && !['completed', 'failed'].includes(article.batchStatus));
    await runWithConcurrency(articles, 2, article => runBatchArticle(article, controller));
    const latest = (await loadArticles()).filter(article => article.activityId === activityId);
    const status = controller.paused ? 'paused' : latest.every(article => article.batchStatus === 'completed') ? 'completed' : latest.some(article => article.batchStatus === 'failed') ? 'failed' : 'queued';
    const usage = latest.flatMap(article => Object.values(article.aiUsageByStep ?? {}).flat() as any[]);
    await kvSet(`writer:batch:${activityId}`, { activityId, status, total: latest.length, completed: latest.filter(article => article.batchStatus === 'completed').length, failed: latest.filter(article => article.batchStatus === 'failed').length, totalTokens: usage.reduce((sum, call) => sum + Number(call.totalTokens ?? 0), 0), totalCostUsd: usage.every(call => call.costUsd != null) ? usage.reduce((sum, call) => sum + Number(call.costUsd), 0) : null, updatedAt: new Date().toISOString() });
  } finally { controller.running = false; }
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

function extractWaveNumber(value: unknown): string | undefined {
  const canonical = canonicalEvidence(value);
  return canonical.match(/\b(?:publishing\s+)?wave\s*(\d+)\b/)?.[1]
    ?? canonical.match(/^w?\s*(\d+)$/)?.[1];
}

function normalizeStep1ScopeItems(items: unknown[], context: StepWaveContext): unknown[] {
  const expectedWaveNumber = extractWaveNumber(context.wave);
  const expectedTimeframe = canonicalEvidence(context.timeframe);
  return items.map(item => {
    if (!item || typeof item !== 'object') return item;
    const record = item as Record<string, unknown>;
    const waveMatches = expectedWaveNumber && extractWaveNumber(record.wave) === expectedWaveNumber;
    const timeframeMatches = !expectedTimeframe || canonicalEvidence(record.timeframe).includes(expectedTimeframe);
    return waveMatches && timeframeMatches
      ? { ...record, wave: context.wave, timeframe: context.timeframe ?? record.timeframe }
      : record;
  });
}

function missingStep1Coverage(items: unknown[], context: StepWaveContext): string[] {
  const records = items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  const expectedWave = canonicalEvidence(context.wave);
  const expectedWaveNumber = extractWaveNumber(context.wave);
  const expectedTimeframe = canonicalEvidence(context.timeframe);
  const inScope = records.filter(item => {
    const wave = canonicalEvidence(item.wave);
    const timeframe = canonicalEvidence(item.timeframe);
    const waveNumber = extractWaveNumber(item.wave);
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
  const expectedWaveNumber = extractWaveNumber(context.wave);
  const expectedTimeframe = canonicalEvidence(context.timeframe);
  const count = records.filter(item => {
    const wave = canonicalEvidence(item.wave);
    const waveNumber = extractWaveNumber(item.wave);
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

function summarizeStep1Items(items: unknown[]): Array<Record<string, string>> {
  return items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .slice(0, 12)
    .map(item => ({
      label: String(item.label ?? item.name ?? '').slice(0, 100),
      typeGroup: String(item.typeGroup ?? item.type ?? ''),
      wave: String(item.wave ?? ''),
      timeframe: String(item.timeframe ?? ''),
    }));
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

const CONTENT_PLAN_PREFIX = 'writer:content-plan:';
const CONTENT_PLAN_CLASSIFIER_VERSION = 'content-plan-classifier-v1';

function planFromRow(row: any, sources: any[] = [], items: any[] = []) {
  return {
    id: row.id, name: row.name, description: row.description, status: row.status,
    seriesId: row.series_id ?? row.id,
    version: row.version, previousVersionId: row.previous_version_id ?? null,
    sourceFingerprint: row.source_fingerprint ?? '', totalArticles: row.total_articles ?? 0,
    comparisonCount: row.comparison_count ?? 0, editorialCount: row.editorial_count ?? 0,
    reviewCount: row.review_count ?? 0, createdAt: row.created_at, updatedAt: row.updated_at,
    classifiedAt: row.classified_at,
    changeSummary: row.change_summary ?? undefined,
    sources: sources.map(source => ({ id: source.id, contentPlanId: source.content_plan_id, sourceType: source.source_type, name: source.name, originalUrl: source.original_url, storagePath: source.storage_path, mimeType: source.mime_type, extractedContent: source.extracted_content, contentHash: source.content_hash, contentLength: source.content_length, scanStatus: source.scan_status, scanError: source.scan_error, createdAt: source.created_at })),
    items: items.map(item => ({ id: item.id, title: item.title, keywords: item.keywords ?? [], type: String(item.content_group).replaceAll('_', '-'), sourceLine: item.source_text ?? item.title, confidence: Number(item.confidence ?? 0), classificationReason: item.classification_reason, sourceId: item.source_id, sourceSectionId: item.source_section_id, sourceQuote: item.source_quote, status: item.status ?? 'not_started' })),
  };
}

async function relationalPlansAvailable() { return tableAvailable('content_plans'); }

async function getContentPlan(id: string): Promise<any | null> {
  if (await relationalPlansAvailable()) {
    const [plans, sources, items] = await Promise.all([
      tableSelect<any>('content_plans', query => query.eq('id', id)),
      tableSelect<any>('content_plan_sources', query => query.eq('content_plan_id', id).order('created_at')),
      tableSelect<any>('content_plan_items', query => query.eq('content_plan_id', id).order('position')),
    ]);
    return plans[0] ? planFromRow(plans[0], sources, items) : null;
  }
  return kvGet(`${CONTENT_PLAN_PREFIX}${id}`);
}

async function listContentPlans(): Promise<any[]> {
  if (await relationalPlansAvailable()) {
    const plans = await tableSelect<any>('content_plans', query => query.order('created_at', { ascending: false }));
    return Promise.all(plans.map(plan => getContentPlan(plan.id)));
  }
  return (await kvGetByPrefix(CONTENT_PLAN_PREFIX)).map(record => record.value).filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function createContentPlanRecord(input: { name: string; previousVersionId?: string | null; source: any }): Promise<any> {
  const previous = input.previousVersionId ? await getContentPlan(input.previousVersionId) : null;
  const id = crypto.randomUUID(); const now = new Date().toISOString(); const sourceId = crypto.randomUUID();
  const source = { id: sourceId, contentPlanId: id, ...input.source, scanStatus: 'ready', createdAt: now };
  const plan = { id, seriesId: previous?.seriesId ?? id, name: input.name, status: 'draft', version: previous ? Number(previous.version) + 1 : 1, previousVersionId: previous?.id ?? null, sourceFingerprint: source.contentHash, totalArticles: 0, comparisonCount: 0, editorialCount: 0, reviewCount: 0, createdAt: now, updatedAt: now, sources: [source], items: [] };
  if (await relationalPlansAvailable()) {
    const planRow: Record<string, unknown> = { id, name: plan.name, status: plan.status, version: plan.version, previous_version_id: plan.previousVersionId, source_fingerprint: plan.sourceFingerprint };
    if (await tableAvailable('article_stage_runs')) planRow.series_id = plan.seriesId;
    await tableInsert('content_plans', planRow);
    await tableInsert('content_plan_sources', { id: sourceId, content_plan_id: id, source_type: source.sourceType, name: source.name, original_url: source.originalUrl ?? null, storage_path: source.storagePath ?? null, mime_type: source.mimeType ?? null, extracted_content: source.extractedContent, content_hash: source.contentHash, content_length: source.contentLength, scan_status: 'ready' });
    return getContentPlan(id);
  }
  await kvSet(`${CONTENT_PLAN_PREFIX}${id}`, plan); return plan;
}

async function saveClassifiedPlan(plan: any, items: any[], model: string) {
  const now = new Date().toISOString();
  const counts = { comparisonCount: items.filter(item => item.type === 'comparison-seo').length, editorialCount: items.filter(item => item.type === 'editorial-originality').length, reviewCount: items.filter(item => item.type === 'needs-review').length };
  const previous = plan.previousVersionId ? await getContentPlan(plan.previousVersionId) : null;
  const previousTitles = new Map<string, string>((previous?.items ?? []).map((item: any) => [String(item.title).toLocaleLowerCase(), String(item.title)]));
  const currentTitles = new Map<string, string>(items.map((item: any) => [String(item.title).toLocaleLowerCase(), String(item.title)]));
  const changeSummary = previous ? { added: [...currentTitles.entries()].filter(([key]) => !previousTitles.has(key)).map(([, title]) => title), removed: [...previousTitles.entries()].filter(([key]) => !currentTitles.has(key)).map(([, title]) => title), unchanged: [...currentTitles.entries()].filter(([key]) => previousTitles.has(key)).map(([, title]) => title) } : undefined;
  if (await relationalPlansAvailable()) {
    await tableDeleteWhere('content_plan_items', 'content_plan_id', plan.id);
    for (const [position, item] of items.entries()) await tableInsert('content_plan_items', { id: item.id, content_plan_id: plan.id, source_id: item.sourceId, source_section_id: item.sourceSectionId, title: item.title, keywords: item.keywords, source_text: item.sourceLine, source_quote: item.sourceQuote, content_group: item.type.replaceAll('-', '_'), confidence: item.confidence, classification_reason: item.classificationReason, position });
    await tableUpdate('content_plans', plan.id, { status: 'ready', classification_model: model, classification_prompt_version: CONTENT_PLAN_CLASSIFIER_VERSION, comparison_count: counts.comparisonCount, editorial_count: counts.editorialCount, review_count: counts.reviewCount, change_summary: changeSummary ?? null, classified_at: now, updated_at: now });
    return getContentPlan(plan.id);
  }
  const next = { ...plan, ...counts, status: 'ready', items, changeSummary, classifiedAt: now, updatedAt: now, classificationModel: model, classificationPromptVersion: CONTENT_PLAN_CLASSIFIER_VERSION };
  await kvSet(`${CONTENT_PLAN_PREFIX}${plan.id}`, next); return next;
}

function googleExportUrl(value: string, sourceType: string): string {
  const url = new URL(value); const match = url.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('Google Docs/Sheets URL không hợp lệ.');
  return sourceType === 'google_sheet'
    ? `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`
    : `https://docs.google.com/document/d/${match[1]}/export?format=txt`;
}

function verifiedClassificationItems(parsed: any, plan: any) {
  const rawItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
  const sources = new Map((plan.sources ?? []).map((source: any) => [source.id, source])); const seen = new Set<string>();
  return rawItems.flatMap((raw: any, index: number) => {
    const source = (sources.get(String(raw.sourceId ?? '')) ?? (sources.size === 1 ? [...sources.values()][0] : null)) as any; const title = String(raw.title ?? '').trim(); let quote = String(raw.sourceQuote ?? '').trim();
    const group = String(raw.contentGroup ?? raw.type ?? '').replaceAll('_', '-'); const confidence = Math.max(0, Math.min(1, Number(raw.confidence ?? 0)));
    if (source && title && (!quote || !String(source.extractedContent).includes(quote)) && String(source.extractedContent).includes(title)) quote = title;
    if (!source || !title || !quote || !String(source.extractedContent).includes(quote)) return [];
    const key = title.toLocaleLowerCase(); if (seen.has(key)) return []; seen.add(key);
    const type = ['comparison-seo', 'editorial-originality'].includes(group) && confidence >= 0.65 ? group : 'needs-review';
    return [{ id: crypto.randomUUID(), title, keywords: Array.isArray(raw.keywords) ? raw.keywords.map(String).filter(Boolean) : [], type, sourceLine: String(raw.sourceLine ?? quote), confidence, classificationReason: String(raw.classificationReason ?? '').trim(), sourceId: source.id, sourceSectionId: String(raw.sourceSectionId ?? `item-${index + 1}`), sourceQuote: quote }];
  });
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
  const relationalContentPlans = supabaseOk ? await tableAvailable('content_plans') : false;
  const threeStageSessions = supabaseOk ? await tableAvailable('article_stage_runs') : false;
  res.status(supabaseOk ? 200 : 503).json({
    status: supabaseOk ? 'ok' : 'degraded',
    supabase: supabaseOk,
    relationalContentPlans,
    threeStageSessions,
    supabaseUrl: process.env.SUPABASE_URL ?? null,
  });
});

app.post('/api/seo/research', async (req, res) => {
  try {
    const seeds = Array.isArray(req.body?.seeds) ? req.body.seeds : [];
    const keywordCount = Math.min(20, Math.max(5, Number(req.body?.keywordCount ?? 10)));
    const articleId = String(req.body?.articleId ?? '');
    if (!articleId) return res.status(400).json({ error: 'articleId là bắt buộc.' });
    const cacheKey = `writer:seo-cache:web-v2:${keywordCount}:${crypto.createHash('sha256').update(JSON.stringify(seeds.map((seed: unknown) => String(seed).trim().toLocaleLowerCase()).sort())).digest('hex')}`;
    const cached = await kvGet<any>(cacheKey);
    if (cached?.researchedAt && Date.now() - new Date(cached.researchedAt).getTime() < 24 * 60 * 60 * 1000) {
      return res.json({ ...cached, cacheHit: true });
    }
    const budget = await reserveAIBudget(articleId, 2);
    const result = await researchSeoKeywords(seeds, keywordCount);
    await kvSet(cacheKey, result);
    res.json({ ...result, cacheHit: false, budget });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('OPENAI_API_KEY')) return res.status(503).json({ code: 'AI_PROVIDER_NOT_CONFIGURED', provider: 'openai', modelId: 'gpt-5.4-mini', error: message });
    const failure = classifyAIError(error, 'openai', 'gpt-5.4-mini');
    res.status(failure.status).json(failure.body);
  }
});

// ─── AI Generate ─────────────────────────────────────────────────────────────

app.post('/api/generate', async (req, res) => {
  const { modelId, provider, prompt, systemPrompt, stepNumber, maxTokens, temperature, splitByWave, bypassCache, jsonMode, contextQuery, skipDocumentContext, pricing, articleId } = req.body;

  if (!modelId || !provider || !prompt || !Number.isInteger(stepNumber) || !articleId) {
    return res.status(400).json({ error: 'modelId, provider, prompt, stepNumber và articleId là bắt buộc.' });
  }

  const providers = getAvailableProviders();
  if (!providers[provider]) {
    return res.status(400).json({
      code: 'AI_PROVIDER_NOT_CONFIGURED',
      provider,
      modelId,
      error: `API key cho provider "${provider}" chưa được cấu hình. Thêm ${provider.toUpperCase()}_API_KEY vào Railway env.`,
    });
  }

  try {
    const startedAt = Date.now();
    const contextsStartedAt = Date.now();
    const normalizedContextQuery = String(contextQuery ?? '').trim().slice(0, 4_000);
    const contexts = skipDocumentContext && (stepNumber === 2 || stepNumber === 4)
      ? [{ contextDocs: [], contentPlanText: '', summary: { stepNumber, kb: [], contentPlan: [], rules: [], totalChars: 0, sourceFingerprint: `empty-step-${stepNumber}` } }]
      : stepNumber === 1 && splitByWave
      ? await resolveStep1WaveContexts(String(articleId))
      : [await resolveStepContext(stepNumber, normalizedContextQuery, String(articleId))];
    const contextMs = Date.now() - contextsStartedAt;
    const sourceFingerprint = contexts.map(context => context.summary.sourceFingerprint).sort().join('|');
    const cacheKey = aiCacheKey({ modelId, provider, prompt, systemPrompt, stepNumber, maxTokens, temperature, splitByWave: Boolean(splitByWave), jsonMode: Boolean(jsonMode), contextQuery: normalizedContextQuery, skipDocumentContext: Boolean(skipDocumentContext), sourceFingerprint, promptVersion: 12 });
    const cached = bypassCache ? null : await kvGet<any>(cacheKey);
    if (cached?.content) {
      console.log(`[generate] cache-hit step=${stepNumber} key=${cacheKey.slice(-12)} totalMs=${Date.now() - startedAt}`);
      return res.json({ ...cached, cacheHit: true, generatedAt: cached.generatedAt, servedAt: new Date().toISOString() });
    }

    const budget = await reserveAIBudget(String(articleId), stepNumber);

    console.log(`[generate] step=${stepNumber} provider=${provider} model=${modelId} waves=${contexts.length} promptLen=${prompt.length} contextChars=${contexts.reduce((sum, item) => sum + item.summary.totalChars, 0)}`);
    const providerStartedAt = Date.now();
    let result;
    if (stepNumber === 1 && splitByWave) {
      try {
        const waveResults = await runWithConcurrency(contexts as StepWaveContext[], 3, async context => {
          const scopeCacheKey = aiCacheKey({
            kind: 'step1-scope-v2',
            modelId,
            provider,
            prompt,
            systemPrompt,
            maxTokens,
            temperature,
            sourceFingerprint: context.summary.sourceFingerprint,
            scopeKey: context.scopeKey,
          });
          if (!bypassCache) {
            const cachedScope = await kvGet<{ response?: any; items?: unknown[] }>(scopeCacheKey);
            if (cachedScope?.response && Array.isArray(cachedScope.items)
              && !missingStep1Coverage(cachedScope.items, context).length) {
              console.log(`[generate] step1-scope-cache-hit scope=${context.scopeKey}`);
              return { response: cachedScope.response, items: cachedScope.items };
            }
          }
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
              jsonMode,
            });
            const items = normalizeStep1ScopeItems(extractJsonArray(response.content), context);
            return { response, items };
          };

          const first = await callWave();
          const firstMissing = missingStep1Coverage(first.items, context);
          const firstEstimate = step1CoverageEstimate(first.items, context);
          if (!firstMissing.length && !firstEstimate) {
            await kvSet(scopeCacheKey, first);
            return first;
          }

          console.warn(`[generate] retry scope=${context.scopeKey} reason=${[...firstMissing, firstEstimate].filter(Boolean).join(', ')}`);
          const second = await callWave([
            `LẦN TRƯỚC CÒN THIẾU CHÍNH XÁC: ${firstMissing.length ? firstMissing.join(', ') : firstEstimate}.`,
            'Chỉ trả các lựa chọn hợp lệ còn thiếu; không lặp lại item đã có và không tạo item cho header/evidence tham chiếu.',
            'DANH SÁCH ĐÃ CÓ Ở LẦN TRƯỚC (dùng để đối chiếu, không chép lại):',
            JSON.stringify(first.items),
          ].join('\n'));
          const mergedItems = mergeStep1Items(first.items, second.items);
          const hardMissing = missingStep1Coverage(mergedItems, context);
          if (hardMissing.length) {
            throw new Error(`${context.scopeKey} thiếu scope/Type bắt buộc: ${hardMissing.join(', ')}. AI đã trả: ${JSON.stringify(summarizeStep1Items(mergedItems))}`);
          }
          const remainingEstimate = step1CoverageEstimate(mergedItems, context);
          if (remainingEstimate) console.warn(`[generate] accepted scope=${context.scopeKey} ${remainingEstimate}; parser rows include repeated headers/evidence`);
          const completed = { response: combineStep1Responses(first.response, second.response), items: mergedItems };
          await kvSet(scopeCacheKey, completed);
          return completed;
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
      result = await generate({ modelId, provider, prompt, systemPrompt, contextDocs: context.contextDocs, maxTokens, temperature, jsonMode });
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
      budget,
    };
    await kvSet(cacheKey, responsePayload);
    console.log(`[generate] done cache=false contextMs=${contextMs} providerMs=${providerMs} totalMs=${Date.now() - startedAt} outputTokens=${result.usage?.outputTokens}`);
    return res.json(responsePayload);
  } catch (err: any) {
    console.error('[generate] error:', err.message);
    const failure = classifyAIError(err, provider, modelId);
    res.status(failure.status).json(failure.body);
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

app.get('/api/content-plans', async (_req, res) => {
  try { res.json(await listContentPlans()); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/content-plans/:id', async (req, res) => {
  try { const plan = await getContentPlan(req.params.id); if (!plan) return res.status(404).json({ error: 'Content Plan không tồn tại.' }); res.json({ plan }); } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/content-plans/:id/articles', async (req, res) => {
  try {
    const plan = await getContentPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Content Plan không tồn tại.' });
    const articles = (await loadArticles()).filter(article => article.contentPlanId === plan.id);
    res.json({ planId: plan.id, version: plan.version, articles });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/content-plans/import', upload.single('file'), async (req, res) => {
  try {
    const body = req.file ? req.body : req.body ?? {};
    const sourceType = String(req.file ? 'file' : body.sourceType ?? 'paste');
    if (!['file', 'paste', 'google_doc', 'google_sheet'].includes(sourceType)) return res.status(400).json({ error: 'Content Plan source type không hợp lệ.' });
    const name = String(body.name ?? req.file?.originalname ?? 'Content Plan').trim();
    const previousVersionId = String(body.previousVersionId ?? '').trim() || null;
    let content = '';
    let originalUrl: string | undefined; let storagePath: string | undefined; let mimeType: string | undefined;
    if (req.file) {
      content = (await extractDocumentText(req.file.buffer, req.file.originalname)).trim();
      mimeType = req.file.mimetype;
    } else if (sourceType === 'google_doc' || sourceType === 'google_sheet') {
      originalUrl = String(body.url ?? '').trim();
      try { content = await fetchTextSource(googleExportUrl(originalUrl, sourceType)); }
      catch (error: any) { throw new Error(`Không đọc được Google ${sourceType === 'google_sheet' ? 'Sheet' : 'Doc'}. Hãy bật quyền "Anyone with the link can view". ${error.message}`); }
    } else content = String(body.content ?? '').trim();
    if (!content) return res.status(422).json({ error: 'Content Plan không có nội dung có thể trích xuất.' });
    if (content.length > 2_000_000) return res.status(413).json({ error: 'Content Plan vượt giới hạn 2 triệu ký tự.' });
    const contentHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    const previous = previousVersionId ? await getContentPlan(previousVersionId) : null;
    if (previous?.sourceFingerprint === contentHash) return res.json({ plan: previous, reused: true });
    if (req.file) {
      const provisionalPlanId = crypto.randomUUID();
      storagePath = `content-plans/${provisionalPlanId}/${crypto.randomUUID()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await uploadDocumentBinary(storagePath, req.file.buffer, req.file.mimetype || 'application/octet-stream');
    }
    const plan = await createContentPlanRecord({ name, previousVersionId, source: { sourceType, name: req.file?.originalname ?? name, originalUrl, storagePath, mimeType, extractedContent: content, contentHash, contentLength: content.length } });
    res.status(201).json({ plan, reused: false });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

async function classifyPlanRequest(req: any, res: any, force: boolean) {
  try {
    const plan = await getContentPlan(req.params.id); if (!plan) return res.status(404).json({ error: 'Content Plan không tồn tại.' });
    if (!force && plan.status === 'ready' && plan.items?.length) return res.json({ plan, cacheHit: true });
    const config = await kvGet<any>('writer:config'); const step = config?.stepConfigs?.[1];
    const model = config?.models?.find((item: any) => item.id === step?.modelId && item.enabled);
    if (!model) return res.status(422).json({ error: 'Hãy chọn một AI model đang bật cho Step 1 trước khi phân loại Content Plan.' });
    const cacheKey = aiCacheKey({ kind: CONTENT_PLAN_CLASSIFIER_VERSION, fingerprint: plan.sourceFingerprint, model: model.id });
    const cached = force ? null : await kvGet<any>(cacheKey);
    let parsed: any; let response: any;
    if (cached?.content) { response = cached; parsed = parseJsonObject(cached.content); }
    else {
      await reserveAIBudget(`content-plan-${plan.id}`, 1);
      const sourceBlock = (plan.sources ?? []).map((source: any) => `SOURCE id=${source.id} name=${JSON.stringify(source.name)}\n${String(source.extractedContent).slice(0, 500_000)}`).join('\n\n---\n\n');
      response = await generate({ modelId: model.id, provider: model.provider, jsonMode: true, maxTokens: 10000, temperature: 0.2, systemPrompt: 'Classify only topics explicitly present in the supplied Content Plan sources. Never invent topics. Every item must include a verbatim sourceQuote copied from its source.', prompt: [
        'Extract every planned article and classify it.',
        'comparison-seo: comparisons, versus, alternatives, reviews, best/top lists, pricing, buyer guides, commercial or transactional SEO intent.',
        'editorial-originality: thought leadership, analysis, opinion, original research, storytelling, brand editorial, or expert insight.',
        'Use needs-review when confidence is below 0.65 or the source is ambiguous.',
        'Return JSON only: {"items":[{"title":string,"keywords":string[],"contentGroup":"comparison-seo"|"editorial-originality"|"needs-review","confidence":number,"classificationReason":string,"sourceId":string,"sourceSectionId":string,"sourceLine":string,"sourceQuote":string}]}',
        sourceBlock,
      ].join('\n\n') });
      await kvSet(cacheKey, { ...response, generatedAt: new Date().toISOString() }); parsed = parseJsonObject(response.content);
    }
    const items = verifiedClassificationItems(parsed, plan);
    if (!items.length) throw new Error('AI không trả về topic nào có source evidence hợp lệ.');
    let saved = await saveClassifiedPlan(plan, items, response.model ?? model.id);
    if (!cached && response.usage) {
      const usage = batchUsage(1, model.provider, { ...response, provider: model.provider, cacheHit: false });
      if (await tableAvailable('writer_ai_usage')) await tableUpsert('writer_ai_usage', { id: usage.id, content_plan_id: plan.id, activity_id: null, article_id: null, step: 1, provider: usage.provider, model: usage.model, input_tokens: usage.inputTokens, cached_input_tokens: usage.cachedInputTokens, output_tokens: usage.outputTokens, total_tokens: usage.totalTokens, cost_usd: usage.costUsd, cache_hit: false, called_at: usage.calledAt }, 'id');
      else { saved = { ...saved, classificationUsage: [...(saved.classificationUsage ?? []), usage] }; await kvSet(`${CONTENT_PLAN_PREFIX}${plan.id}`, saved); }
    }
    res.json({ plan: saved, cacheHit: Boolean(cached) });
  } catch (err: any) { const classified = classifyAIError(err, 'openai', 'content-plan-classifier'); res.status(classified.status).json(classified.body); }
}

app.post('/api/content-plans/:id/classify', (req, res) => void classifyPlanRequest(req, res, false));
app.post('/api/content-plans/:id/reclassify', (req, res) => void classifyPlanRequest(req, res, true));

app.patch('/api/content-plans/:id/items/:itemId', async (req, res) => {
  try {
    const type = String(req.body?.type ?? '');
    if (!['comparison-seo', 'editorial-originality', 'needs-review'].includes(type)) return res.status(400).json({ error: 'Nhóm nội dung không hợp lệ.' });
    const plan = await getContentPlan(req.params.id); if (!plan) return res.status(404).json({ error: 'Content Plan không tồn tại.' });
    if (await relationalPlansAvailable()) {
      await tableUpdate('content_plan_items', req.params.itemId, { content_group: type.replaceAll('-', '_') });
      const items = (await getContentPlan(plan.id)).items ?? [];
      await tableUpdate('content_plans', plan.id, { comparison_count: items.filter((item: any) => item.type === 'comparison-seo').length, editorial_count: items.filter((item: any) => item.type === 'editorial-originality').length, review_count: items.filter((item: any) => item.type === 'needs-review').length, updated_at: new Date().toISOString() });
    } else {
      plan.items = (plan.items ?? []).map((item: any) => item.id === req.params.itemId ? { ...item, type } : item);
      plan.comparisonCount = plan.items.filter((item: any) => item.type === 'comparison-seo').length;
      plan.editorialCount = plan.items.filter((item: any) => item.type === 'editorial-originality').length;
      plan.reviewCount = plan.items.filter((item: any) => item.type === 'needs-review').length;
      plan.updatedAt = new Date().toISOString(); await kvSet(`${CONTENT_PLAN_PREFIX}${plan.id}`, plan);
    }
    res.json({ plan: await getContentPlan(plan.id) });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/content-plans/:id/status', async (req, res) => {
  try {
    const status = String(req.body?.status ?? '');
    if (!['draft', 'ready', 'active', 'archived'].includes(status)) return res.status(400).json({ error: 'Content Plan status không hợp lệ.' });
    const plan = await getContentPlan(req.params.id); if (!plan) return res.status(404).json({ error: 'Content Plan không tồn tại.' });
    if (await relationalPlansAvailable()) await tableUpdate('content_plans', plan.id, { status, updated_at: new Date().toISOString() });
    else { plan.status = status; plan.updatedAt = new Date().toISOString(); await kvSet(`${CONTENT_PLAN_PREFIX}${plan.id}`, plan); }
    res.json({ plan: await getContentPlan(plan.id) });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/content-plans/:id', async (req, res) => {
  try {
    const plan = await getContentPlan(req.params.id); if (!plan) return res.status(404).json({ error: 'Content Plan không tồn tại.' });
    const linked = (await loadArticles()).filter(article => article.contentPlanId === plan.id);
    if (linked.length) return res.status(409).json({ error: `Content Plan đang có ${linked.length} article. Hãy archive thay vì xóa để bảo toàn lịch sử.` });
    await deleteDocumentBinaries((plan.sources ?? []).map((source: any) => source.storagePath).filter(Boolean));
    if (await relationalPlansAvailable()) await tableDeleteWhere('content_plans', 'id', plan.id);
    else await kvDelete(`${CONTENT_PLAN_PREFIX}${plan.id}`);
    res.json({ ok: true, deletedId: plan.id });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/batches/:activityId', async (req, res) => {
  try {
    const articles = (await loadArticles()).filter(article => article.activityId === req.params.activityId);
    const batch = await kvGet(`writer:batch:${req.params.activityId}`);
    const controller = batchControllers.get(req.params.activityId);
    if ((batch as any)?.status === 'running' && !controller?.running) {
      void runBatch(req.params.activityId).catch(error => console.error(`[batch-resume] ${req.params.activityId}`, error));
    }
    res.json({ batch: batch ?? null, articles });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/batches/:activityId/start', async (req, res) => {
  try {
    const activityId = req.params.activityId;
    const articles = (await loadArticles()).filter(article => article.activityId === activityId && article.activityKind === 'batch');
    if (!articles.length) return res.status(404).json({ error: 'Batch activity không tồn tại.' });
    void runBatch(activityId).catch(error => console.error(`[batch] ${activityId}`, error));
    res.status(202).json({ ok: true, activityId, queued: articles.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/batches/:activityId/pause', async (req, res) => {
  try {
    const activityId = req.params.activityId;
    const controller = batchControllers.get(activityId) ?? { paused: false, running: false };
    controller.paused = true; batchControllers.set(activityId, controller);
    await kvSet(`writer:batch:${activityId}`, { activityId, status: 'paused', updatedAt: new Date().toISOString() });
    res.json({ ok: true, activityId });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/batches/:activityId/retry/:articleId', async (req, res) => {
  try {
    const key = `${ARTICLE_PREFIX}${req.params.articleId}`;
    const article = await kvGet<any>(key);
    if (!article || article.activityId !== req.params.activityId) return res.status(404).json({ error: 'Article không thuộc batch này.' });
    await kvSet(key, { ...article, batchStatus: 'queued', batchError: null, updatedAt: new Date().toISOString() });
    void runBatch(req.params.activityId).catch(error => console.error(`[batch-retry] ${req.params.activityId}`, error));
    res.status(202).json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/articles', async (_req, res) => {
  try {
    res.json(await loadArticles());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/articles/:id/stages', async (req, res) => {
  try {
    const article = (await loadArticles()).find(item => item.id === req.params.id);
    if (!article) return res.status(404).json({ error: 'Bài viết không tồn tại trong Supabase.' });
    if (await tableAvailable('article_stage_runs')) {
      const stages = await tableSelect<any>('article_stage_runs', query => query.eq('article_id', article.id).order('created_at', { ascending: false }));
      return res.json({ articleId: article.id, stages });
    }
    res.json({ articleId: article.id, stages: [] });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/articles', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const article = { ...req.body, updatedAt: now };
    if (!article.id) return res.status(400).json({ error: 'Article id là bắt buộc.' });
    await kvSet(`${ARTICLE_PREFIX}${article.id}`, article);
    await projectArticle(article);
    res.json({ ok: true, article });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/articles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const article = await serializeByKey(articleMutationQueues, id, async () => {
      let existing = await kvGet<any>(`${ARTICLE_PREFIX}${id}`);
      if (!existing) existing = (await loadArticles()).find(item => item.id === id);
      if (!existing) throw new Error('Bài viết không tồn tại trong Supabase.');
      const next = { ...existing, ...updates, id, updatedAt: new Date().toISOString() };
      await kvSet(`${ARTICLE_PREFIX}${id}`, next);
      await projectArticle(next);
      return next;
    });
    res.json({ ok: true, article });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/articles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await kvGet<any>(`${ARTICLE_PREFIX}${id}`);
    if (!existing && !(await loadArticles()).some(article => article.id === id)) {
      res.status(404).json({ error: 'Bài viết không tồn tại trong Supabase.' });
      return;
    }
    await kvDelete(`${ARTICLE_PREFIX}${id}`);
    if (await tableAvailable('writer_articles')) await tableDeleteWhere('writer_articles', 'id', id);
    const legacy = (await kvGet<any[]>('writer:articles')) ?? [];
    if (legacy.some(article => article?.id === id)) {
      await kvSet('writer:articles', legacy.filter(article => article?.id !== id));
    }
    if (existing?.activityId) {
      const siblings = (await loadArticles()).filter(article => article.activityId === existing.activityId);
      if (!siblings.length) {
        await kvDelete(`writer:batch:${existing.activityId}`);
        batchControllers.delete(existing.activityId);
      }
    }
    if (existing?.contentPlanId) {
      if (await relationalPlansAvailable()) {
        const projected = await tableSelect<any>('writer_articles', query => query.select('id').eq('content_plan_id', existing.contentPlanId));
        await tableUpdate('content_plans', existing.contentPlanId, { total_articles: projected.length, updated_at: new Date().toISOString() });
      } else {
        const plan = await kvGet<any>(`${CONTENT_PLAN_PREFIX}${existing.contentPlanId}`);
        if (plan) { plan.totalArticles = (await kvGetByPrefix(ARTICLE_PREFIX)).filter(record => record.value?.contentPlanId === existing.contentPlanId).length; plan.updatedAt = new Date().toISOString(); await kvSet(`${CONTENT_PLAN_PREFIX}${plan.id}`, plan); }
      }
    }
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
    const { actionSources: _removedLegacySources, ...config } = req.body ?? {};
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
    if (!['kb', 'rules'].includes(category)) {
      return res.status(400).json({ error: 'category phải là kb hoặc rules.' });
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
    if (!['kb', 'rules'].includes(category)) {
      return res.status(400).json({ error: 'category phải là kb hoặc rules.' });
    }

    const content = (await extractDocumentText(req.file.buffer, req.file.originalname)).trim();
    if (!content) return res.status(422).json({ error: 'File không có nội dung văn bản để AI scan.' });

    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    const fileType = req.file.originalname.split('.').pop()?.toLowerCase() ?? 'txt';
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const storagePath = `${category}/${id}/${safeName}`;
    await uploadDocumentBinary(storagePath, req.file.buffer, req.file.mimetype || 'application/octet-stream');

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

function canonicalHeading(value: string) {
  return value.replace(/^#{1,6}\s+/, '').replace(/[*_`]/g, '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function assignDocumentHeadings(draft: string, title: string, outline: Array<{ heading?: string; level?: string }>) {
  const headingLevels = new Map(outline
    .filter(section => section?.heading)
    .map(section => [canonicalHeading(String(section.heading)), section.level === 'h3' ? 3 : 2] as const));
  const canonicalTitle = canonicalHeading(title);
  const lines = draft.replace(/\r\n?/g, '\n').split('\n');
  let hasH1 = false;
  const formatted = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    const existing = trimmed.match(/^(#{1,6})\s+(.+)$/);
    const text = existing?.[2]?.trim() ?? trimmed;
    const canonical = canonicalHeading(text);
    if (canonicalTitle && canonical === canonicalTitle) {
      hasH1 = true;
      return `# ${text}`;
    }
    const outlineLevel = headingLevels.get(canonical);
    if (outlineLevel) return `${'#'.repeat(outlineLevel)} ${text}`;
    if (existing) {
      const level = Math.min(3, Math.max(1, existing[1].length));
      if (level === 1) hasH1 = true;
      return `${'#'.repeat(level)} ${text}`;
    }
    return line.trimEnd();
  });
  if (!hasH1 && title.trim()) formatted.unshift(`# ${title.trim()}`, '');
  return formatted.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
}

function markdownForGoogleDocs(markdown: string) {
  const html: string[] = ['<div>'];
  let listType: 'ul' | 'ol' | null = null;
  const closeList = () => { if (listType) html.push(`</${listType}>`); listType = null; };
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    if (!line) { closeList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { closeList(); const level = heading[1].length; html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); continue; }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const nextType = unordered ? 'ul' : 'ol';
      if (listType !== nextType) { closeList(); listType = nextType; html.push(`<${nextType}>`); }
      html.push(`<li>${inlineMarkdown((unordered ?? ordered)![1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  html.push('</div>');
  return html.join('');
}

app.post('/api/format/google-docs', (req, res) => {
  const draft = String(req.body?.draft ?? '').trim();
  const title = String(req.body?.title ?? '').trim();
  const outline = Array.isArray(req.body?.outline) ? req.body.outline : [];
  if (!draft) return res.status(400).json({ error: 'Draft không được để trống.' });
  const markdown = assignDocumentHeadings(draft, title, outline);
  return res.json({ markdown, html: markdownForGoogleDocs(markdown), formatter: 'deterministic-v1', aiCalls: 0 });
});

app.get('/api/documents/:id/download', async (req, res) => {
  try {
    const id = req.params.id;
    const files = await kvGet<any[]>('writer:files');
    const document = (Array.isArray(files) ? files : []).find(item => item?.id === id);

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
  void (async () => {
    if (!await tableAvailable('writer_articles')) return;
    const articles = await loadArticles();
    for (const article of articles) await projectArticle(article);
    console.log(`[migration] projected ${articles.length} KV articles into relational tables`);
  })().catch(error => console.error('[migration] relational projection failed:', error));
});
