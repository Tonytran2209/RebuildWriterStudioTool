import type { AIModel, AppConfig } from '../types/index.ts';

// Prices: USD per 1M tokens from each provider's pricing page, checked 2026-11-18. Bump the version when the catalog changes.
export const MODEL_CATALOG_VERSION = '2026-11-18';

export const DEFAULT_MODELS: AIModel[] = [
  // Anthropic
  { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', provider: 'anthropic', description: 'Model mạnh nhất của Anthropic cho suy luận sâu và tác vụ dài.', enabled: false, contextWindow: '1M', speed: 'slow', pricing: { inputUsdPerMillion: 8, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 40 } },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', provider: 'anthropic', description: 'Model cao cấp cho phân tích, chiến lược và nội dung chuyên sâu.', enabled: false, contextWindow: '1M', speed: 'medium', pricing: { inputUsdPerMillion: 4, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 20 } },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', provider: 'anthropic', description: 'Cân bằng tốt giữa chất lượng, tốc độ và chi phí.', enabled: false, contextWindow: '1M', speed: 'fast', pricing: { inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 10 } },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', provider: 'anthropic', description: 'Rất nhanh và rẻ cho tác vụ sản lượng lớn (giá tăng gấp 5 khi prompt trên 100K token).', enabled: false, contextWindow: '1M', speed: 'fast', pricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 } },
  // OpenAI
  { id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra', provider: 'openai', description: 'Flagship cho suy luận và coding phức tạp nhất.', enabled: false, contextWindow: '1.05M', speed: 'slow', pricing: { inputUsdPerMillion: 8, cachedInputUsdPerMillion: 0.4, outputUsdPerMillion: 40, longContextThresholdTokens: 272000, longContextInputMultiplier: 2, longContextOutputMultiplier: 1.5 } },
  { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', provider: 'openai', description: 'Cân bằng năng lực và chi phí cho workflow sản xuất.', enabled: false, contextWindow: '1.05M', speed: 'medium', pricing: { inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 10, longContextThresholdTokens: 272000, longContextInputMultiplier: 2, longContextOutputMultiplier: 1.5 } },
  { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', provider: 'openai', description: 'Nhanh, hiệu quả cho tác vụ thường xuyên.', enabled: false, contextWindow: '1.05M', speed: 'fast', pricing: { inputUsdPerMillion: 1, cachedInputUsdPerMillion: 0.05, outputUsdPerMillion: 5, longContextThresholdTokens: 272000, longContextInputMultiplier: 2, longContextOutputMultiplier: 1.5 } },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', provider: 'openai', description: 'Tiết kiệm nhất cho phân loại, trích xuất và sản lượng lớn.', enabled: false, contextWindow: '1.05M', speed: 'fast', pricing: { inputUsdPerMillion: 0.1, cachedInputUsdPerMillion: 0.01, outputUsdPerMillion: 0.5, longContextThresholdTokens: 272000, longContextInputMultiplier: 2, longContextOutputMultiplier: 1.5 } },
  // Google Gemini (giá hiện tại; Google công bố tăng giá Gemini 4 Carbon/Argon từ 01/12/2026 và 3.8 Flash từ 01/01/2027)
  { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', provider: 'google', description: 'Model suy luận mạnh nhất của Gemini 4.', enabled: false, contextWindow: '1M', speed: 'slow', pricing: { inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 10 } },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', provider: 'google', description: 'Frontier hiệu quả: nhanh hơn, ít token hơn Carbon.', enabled: false, contextWindow: '1M', speed: 'medium', pricing: { inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 10 } },
  { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', provider: 'google', description: 'Nhanh và hiệu quả cho công việc hằng ngày.', enabled: false, contextWindow: '1M', speed: 'fast', pricing: { inputUsdPerMillion: 1.5, cachedInputUsdPerMillion: 0.075, outputUsdPerMillion: 7.5 } },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'google', description: 'Flash stable thế hệ trước cho tài liệu dài và tác vụ đa bước.', enabled: false, contextWindow: '1M', speed: 'fast', pricing: { inputUsdPerMillion: 0.75, cachedInputUsdPerMillion: 0.075, outputUsdPerMillion: 3.75 } },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', provider: 'google', description: 'Nhanh và tiết kiệm cho xử lý khối lượng lớn.', enabled: false, contextWindow: '1M', speed: 'fast', pricing: { inputUsdPerMillion: 0.3, cachedInputUsdPerMillion: 0.03, outputUsdPerMillion: 2.5 } },
  // Mistral
  { id: 'mistral-large-latest', name: 'Mistral Large 4', provider: 'mistral', description: 'Model đa năng mạnh nhất của Mistral, context 1M.', enabled: false, contextWindow: '1M', speed: 'medium', pricing: { inputUsdPerMillion: 0.7, cachedInputUsdPerMillion: 0.07, outputUsdPerMillion: 2.1 } },
  { id: 'mistral-small-2603', name: 'Mistral Small 4', provider: 'mistral', description: 'Model hybrid nhanh, hiệu quả cho instruct và reasoning.', enabled: false, contextWindow: '256K', speed: 'fast', pricing: { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 } },
  // DeepSeek (giá giờ cao điểm; ngoài giờ cao điểm rẻ hơn một nửa)
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', description: 'Suy luận sâu cho nội dung dài và tác vụ agent phức tạp.', enabled: false, contextWindow: '1M', speed: 'medium', pricing: { inputUsdPerMillion: 1.32, cachedInputUsdPerMillion: 0.044, outputUsdPerMillion: 3.96 } },
  { id: 'deepseek-flash', name: 'DeepSeek Flash', provider: 'deepseek', description: 'Nhanh và tiết kiệm cho workflow nội dung sản lượng lớn.', enabled: false, contextWindow: '1M', speed: 'fast', pricing: { inputUsdPerMillion: 0.3, cachedInputUsdPerMillion: 0.006, outputUsdPerMillion: 1.2 } },
  // Together AI
  { id: 'moonshotai/Kimi-K3.1-Pro', name: 'Kimi K3.1 Pro', provider: 'together', description: 'Model context dài chất lượng cao qua Together Serverless.', enabled: false, contextWindow: '1M', speed: 'medium', pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 10 } },
  { id: 'Qwen/Qwen4-Max', name: 'Qwen4 Max', provider: 'together', description: 'Model Qwen mạnh nhất, context 1M.', enabled: false, contextWindow: '1M', speed: 'medium', pricing: { inputUsdPerMillion: 1.425, outputUsdPerMillion: 4.275 } },
  { id: 'zai-org/GLM-5.3', name: 'GLM-5.3', provider: 'together', description: 'Model open-weight context 1M cho nội dung dài.', enabled: false, contextWindow: '1M', speed: 'medium', pricing: { inputUsdPerMillion: 1.4, outputUsdPerMillion: 4.4 } },
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'together', description: 'Model open-weight ổn định, hỗ trợ structured output.', enabled: false, contextWindow: '128K', speed: 'fast', pricing: { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 } },
  // Groq
  { id: 'groq-gpt-oss-120b', name: 'GPT-OSS 120B (Groq)', provider: 'groq', description: 'Model open-weight reasoning cao với inference rất nhanh.', enabled: false, contextWindow: '131K', speed: 'fast', pricing: { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 } },
  { id: 'groq-gpt-oss-20b', name: 'GPT-OSS 20B (Groq)', provider: 'groq', description: 'Bản nhỏ, rất rẻ cho tác vụ đơn giản.', enabled: false, contextWindow: '131K', speed: 'fast', pricing: { inputUsdPerMillion: 0.075, outputUsdPerMillion: 0.3 } },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', provider: 'groq', description: 'Model production đa năng (Groq hiện báo giá theo hợp đồng).', enabled: false, contextWindow: '131K', speed: 'fast', pricing: { inputUsdPerMillion: 0.59, outputUsdPerMillion: 0.79 } },
];

/** Retired or superseded catalog ids → successor, so a gate never loses its model when the catalog changes. */
export const MODEL_REPLACEMENTS: Record<string, string> = {
  'claude-fable-5': 'claude-fable-5-2', 'claude-opus-5': 'claude-opus-5-5', 'claude-sonnet-5': 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001': 'claude-haiku-5-5',
  'gpt-5.6-sol': 'gpt-6.2-sol', 'gpt-5.6-terra': 'gpt-6.1-terra', 'gpt-5.6-luna': 'gpt-6-luna', 'gpt-5.5': 'gpt-6.2-sol', 'gpt-5.4': 'gpt-6.1-terra', 'gpt-5.4-mini': 'gpt-6.1-terra', 'gpt-5.4-nano': 'gpt-6-luna',
  'gemini-3.6-flash': 'gemini-3.8-flash',
  'mistral-medium-3-5': 'mistral-large-latest',
  'deepseek-v4-flash': 'deepseek-flash',
  'moonshotai/Kimi-K3': 'moonshotai/Kimi-K3.1-Pro',
  'llama-3.1-8b-instant': 'groq-gpt-oss-20b',
};

export function mergeWithLatestModelCatalog(config: AppConfig): AppConfig {
  const resolve = (id: string) => MODEL_REPLACEMENTS[id] ?? id;
  const modelIds = new Set(DEFAULT_MODELS.map(model => model.id));
  const savedModels = new Map<string, AIModel>();
  for (const model of config.models) {
    const id = resolve(model.id);
    const previous = savedModels.get(`${model.provider}:${id}`);
    // A retired model that was enabled keeps its successor enabled.
    savedModels.set(`${model.provider}:${id}`, previous ? { ...previous, enabled: previous.enabled || model.enabled } : model);
  }
  // A new catalog version brings new list prices; manual price edits are kept only within one version.
  const keepPricing = config.modelCatalogVersion === MODEL_CATALOG_VERSION;
  const stepConfigs = Object.fromEntries(
    Object.entries(config.stepConfigs).map(([step, stepConfig]) => [
      step,
      {
        ...stepConfig,
        modelId: modelIds.has(resolve(stepConfig.modelId)) ? resolve(stepConfig.modelId) : '',
        fileAccess: {
          kb: stepConfig.fileAccess?.kb ?? [],
          rules: stepConfig.fileAccess?.rules ?? [],
        },
      },
    ]),
  );

  const taskModels = Object.fromEntries(Object.entries(config.taskModels ?? {}).map(([task, id]) => [task, id && modelIds.has(resolve(id)) ? resolve(id) : '']));
  return {
    ...config,
    modelCatalogVersion: MODEL_CATALOG_VERSION,
    stepConfigs,
    taskModels,
    models: DEFAULT_MODELS.map(model => {
      const saved = savedModels.get(`${model.provider}:${model.id}`);
      return {
        ...model,
        enabled: saved?.enabled ?? model.enabled,
        pricing: (keepPricing && saved?.pricing) || model.pricing,
      };
    }),
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  railwayUrl: 'https://rebuildwriterstudiotool-production.up.railway.app',
  stepConfigs: {
    1: { modelId: '', fileAccess: { kb: [], rules: [] } },
    2: { modelId: '', fileAccess: { kb: [], rules: [] } },
    3: { modelId: '', fileAccess: { kb: [], rules: [] } },
    4: { modelId: '', fileAccess: { kb: [], rules: [] }, maxDraftWords: 1500 },
  },
  models: DEFAULT_MODELS,
};

export const STEP_LABELS: Record<number, string> = {
  1: 'Content Type',
  2: 'Article Spec & Direction',
  3: 'Draft Outline',
  4: 'First Draft & Audit',
};

export const PROVIDER_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  anthropic: { label: 'Anthropic', color: 'text-violet-600', icon: '◆' },
  openai:    { label: 'OpenAI',    color: 'text-emerald-600', icon: '⬡' },
  google:    { label: 'Google',    color: 'text-blue-600',    icon: '◉' },
  mistral:   { label: 'Mistral AI',color: 'text-orange-600',  icon: '▲' },
  together:  { label: 'Together AI',color: 'text-pink-600',   icon: '◈' },
  groq:      { label: 'Groq',      color: 'text-amber-600',   icon: '⚡' },
  deepseek:  { label: 'DeepSeek',  color: 'text-cyan-700',    icon: '✦' },
};
