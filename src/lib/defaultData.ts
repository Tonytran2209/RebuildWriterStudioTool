import type { AIModel, AppConfig, Article, DocumentFile } from '../types';

export const DEFAULT_MODELS: AIModel[] = [
  // Anthropic
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', description: 'Model mạnh nhất của Anthropic, tư duy sâu sắc, viết văn phong cao.', enabled: true, contextWindow: '200K', speed: 'medium' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic', description: 'Tốc độ nhanh, xử lý văn bản chuẩn xác, chi phí tối ưu.', enabled: true, contextWindow: '200K', speed: 'fast' },
  { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'anthropic', description: 'Phân tích phức tạp, tư duy chiến lược và nội dung chuyên sâu.', enabled: true, contextWindow: '200K', speed: 'slow' },
  // OpenAI
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', description: 'Model đa năng hàng đầu của OpenAI, xử lý đa phương thức.', enabled: true, contextWindow: '128K', speed: 'fast' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', description: 'Chi phí thấp, tốc độ cao, phù hợp cho tác vụ lặp lại.', enabled: false, contextWindow: '128K', speed: 'fast' },
  { id: 'o1-preview', name: 'o1 Preview', provider: 'openai', description: 'Tư duy từng bước, lý luận logic phức tạp.', enabled: false, contextWindow: '128K', speed: 'slow' },
  // Google
  { id: 'gemini-2-0-flash', name: 'Gemini 2.0 Flash', provider: 'google', description: 'Phản hồi tức thì, context window cực lớn.', enabled: true, contextWindow: '1M', speed: 'fast' },
  { id: 'gemini-1-5-pro', name: 'Gemini 1.5 Pro', provider: 'google', description: 'Xử lý tài liệu dài, phân tích đa phương thức.', enabled: false, contextWindow: '2M', speed: 'medium' },
  // Mistral
  { id: 'mistral-large', name: 'Mistral Large', provider: 'mistral', description: 'Model mạnh nhất của Mistral, khả năng lý luận cao.', enabled: false, contextWindow: '32K', speed: 'medium' },
  // Groq (fast inference)
  { id: 'llama-3-70b-groq', name: 'Llama 3 70B (Groq)', provider: 'groq', description: 'Inference cực nhanh qua Groq, mã nguồn mở.', enabled: false, contextWindow: '8K', speed: 'fast' },
];

export const DEFAULT_CONFIG: AppConfig = {
  railwayUrl: '',
  stepConfigs: {
    1: { modelId: 'claude-3-5-sonnet', fileAccess: { kb: [], action: [], rules: [] } },
    2: { modelId: 'claude-3-5-sonnet', fileAccess: { kb: [], action: [], rules: [] } },
    3: { modelId: 'claude-sonnet-4-6', fileAccess: { kb: [], action: ['SEO_Keyword_Strategy.csv'], rules: [] } },
    4: { modelId: 'claude-3-opus', fileAccess: { kb: ['Bang_gia_Sua_doi_2026.pdf'], action: ['SEO_Keyword_Strategy.csv'], rules: ['Tone_of_Voice_B2B.txt'] } },
  },
  models: DEFAULT_MODELS,
};

export const DEFAULT_FILES: DocumentFile[] = [
  { id: 'kb-1', name: 'Bang_gia_Sua_doi_2026.pdf', size: '2.4 MB', uploadedAt: '01/08/2026', category: 'kb', fileType: 'pdf' },
  { id: 'kb-2', name: 'Phan_tich_doi_thu.docx', size: '1.1 MB', uploadedAt: '28/07/2026', category: 'kb', fileType: 'docx' },
  { id: 'kb-3', name: 'Catalog_San_pham_Q3.pdf', size: '5.8 MB', uploadedAt: '25/07/2026', category: 'kb', fileType: 'pdf' },
  { id: 'act-1', name: 'SEO_Keyword_Strategy.csv', size: '512 KB', uploadedAt: '02/08/2026', category: 'action', fileType: 'csv' },
  { id: 'act-2', name: 'Content_Calendar_Q3.xlsx', size: '345 KB', uploadedAt: '30/07/2026', category: 'action', fileType: 'xlsx' },
  { id: 'rules-1', name: 'Tone_of_Voice_B2B.txt', size: '45 KB', uploadedAt: '15/07/2026', category: 'rules', fileType: 'txt' },
  { id: 'rules-2', name: 'Brand_Guidelines_2026.md', size: '128 KB', uploadedAt: '10/07/2026', category: 'rules', fileType: 'md' },
];

export const DEFAULT_ARTICLES: Article[] = [
  {
    id: 'art-1',
    title: 'So sánh Sản phẩm A & B — Phân tích chi tiết 2026',
    currentStep: 1,
    status: 'in_progress',
    createdAt: '2026-08-03T08:00:00Z',
    updatedAt: '2026-08-03T09:30:00Z',
    contentType: 'comparison',
  },
  {
    id: 'art-2',
    title: 'Chiến lược SEO Content Marketing Q3/2026',
    currentStep: 3,
    status: 'in_progress',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-02T15:00:00Z',
    contentType: 'seo-blog',
    topic: 'SEO Content Marketing cho doanh nghiệp vừa và nhỏ',
    keywords: 'content marketing, SEO, digital marketing Việt Nam',
    tone: 'professional',
  },
  {
    id: 'art-3',
    title: 'Review Laptop Dell XPS 15 2026 — Đánh giá chuyên sâu',
    currentStep: 4,
    status: 'review',
    createdAt: '2026-07-28T09:00:00Z',
    updatedAt: '2026-08-01T11:00:00Z',
    contentType: 'review',
  },
];

export const STEP_LABELS: Record<number, string> = {
  1: 'Content Type',
  2: 'Core Idea & Angle',
  3: 'Draft Outline',
  4: 'First Draft & Audit',
};

export const PROVIDER_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  anthropic: { label: 'Anthropic', color: 'text-violet-600', icon: '◆' },
  openai: { label: 'OpenAI', color: 'text-emerald-600', icon: '⬡' },
  google: { label: 'Google', color: 'text-blue-600', icon: '◉' },
  mistral: { label: 'Mistral AI', color: 'text-orange-600', icon: '▲' },
  together: { label: 'Together AI', color: 'text-pink-600', icon: '◈' },
  groq: { label: 'Groq', color: 'text-amber-600', icon: '⚡' },
};
