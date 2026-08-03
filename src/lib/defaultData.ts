import type { AIModel, AppConfig } from '../types';

export const DEFAULT_MODELS: AIModel[] = [
  // Anthropic
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', description: 'Model mạnh nhất của Anthropic, tư duy sâu sắc, viết văn phong cao.', enabled: false, contextWindow: '200K', speed: 'medium' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic', description: 'Tốc độ nhanh, xử lý văn bản chuẩn xác, chi phí tối ưu.', enabled: false, contextWindow: '200K', speed: 'fast' },
  { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'anthropic', description: 'Phân tích phức tạp, tư duy chiến lược và nội dung chuyên sâu.', enabled: false, contextWindow: '200K', speed: 'slow' },
  // OpenAI
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', description: 'Model đa năng hàng đầu của OpenAI, xử lý đa phương thức.', enabled: false, contextWindow: '128K', speed: 'fast' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', description: 'Chi phí thấp, tốc độ cao, phù hợp cho tác vụ lặp lại.', enabled: false, contextWindow: '128K', speed: 'fast' },
  { id: 'o1-preview', name: 'o1 Preview', provider: 'openai', description: 'Tư duy từng bước, lý luận logic phức tạp.', enabled: false, contextWindow: '128K', speed: 'slow' },
  // Google
  { id: 'gemini-2-0-flash', name: 'Gemini 2.0 Flash', provider: 'google', description: 'Phản hồi tức thì, context window cực lớn.', enabled: false, contextWindow: '1M', speed: 'fast' },
  { id: 'gemini-1-5-pro', name: 'Gemini 1.5 Pro', provider: 'google', description: 'Xử lý tài liệu dài, phân tích đa phương thức.', enabled: false, contextWindow: '2M', speed: 'medium' },
  // Mistral
  { id: 'mistral-large', name: 'Mistral Large', provider: 'mistral', description: 'Model mạnh nhất của Mistral, khả năng lý luận cao.', enabled: false, contextWindow: '32K', speed: 'medium' },
  // Groq
  { id: 'llama-3-70b-groq', name: 'Llama 3 70B (Groq)', provider: 'groq', description: 'Inference cực nhanh qua Groq, mã nguồn mở.', enabled: false, contextWindow: '8K', speed: 'fast' },
];

export const DEFAULT_CONFIG: AppConfig = {
  railwayUrl: '',
  stepConfigs: {
    1: { modelId: '', fileAccess: { kb: [], action: [], rules: [] } },
    2: { modelId: '', fileAccess: { kb: [], action: [], rules: [] } },
    3: { modelId: '', fileAccess: { kb: [], action: [], rules: [] } },
    4: { modelId: '', fileAccess: { kb: [], action: [], rules: [] } },
  },
  models: DEFAULT_MODELS,
};

export const STEP_LABELS: Record<number, string> = {
  1: 'Content Type',
  2: 'Core Idea & Angle',
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
};
