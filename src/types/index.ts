export type AIProvider = 'anthropic' | 'openai' | 'google' | 'mistral' | 'together' | 'groq';

export interface AIModel {
  id: string;
  name: string;
  provider: AIProvider;
  description: string;
  enabled: boolean;
  contextWindow: string;
  speed: 'fast' | 'medium' | 'slow';
}

export type FileCategory = 'kb' | 'action' | 'rules';
export type FileType = 'pdf' | 'docx' | 'csv' | 'xlsx' | 'txt' | 'md' | 'json';

export interface DocumentFile {
  id: string;
  name: string;
  size: string;
  uploadedAt: string;
  category: FileCategory;
  fileType: FileType;
  content?: string;
  contentUpdatedAt?: string;
  contentLength?: number;
  contentHash?: string;
  scanStatus?: 'ready' | 'error';
  storagePath?: string;
  originalMimeType?: string;
}

export interface StepFileAccess {
  kb: string[];
  action: string[];
  rules: string[];
}

export interface StepConfig {
  modelId: string;
  fileAccess: StepFileAccess;
  systemPrompt?: string;
}

export interface AppConfig {
  railwayUrl: string;
  stepConfigs: Record<number, StepConfig>;
  models: AIModel[];
  actionSources: ActionDataSource[];
}

export type SearchIntent = 'informational' | 'commercial' | 'transactional' | 'navigational';

export interface EvidenceRef {
  source: string;
  note?: string;
  role?: 'kb' | 'action' | 'rules';
}

export interface OutlineSection {
  id: string;
  heading: string;
  notes: string;
  level: 'h2' | 'h3';
  keywords?: string[];
  searchIntent?: SearchIntent;
  evidence?: EvidenceRef[];
  ruleRefs?: string[];
}

export type ArticleStatus = 'planning' | 'in_progress' | 'review' | 'done';

export type ContentTypeGroup = 'A' | 'B' | 'C';

export interface ContentTypeSuggestion {
  id: string;
  label: string;
  description: string;
  keywords?: string[];
  // Phân loại theo Action Plan: Type A/B/C — mỗi wave gắn với mốc thời gian
  typeGroup?: ContentTypeGroup;
  wave?: string;
  timeframe?: string;
  audience?: string;
  format?: string;
  matchedDocs?: string[];
  kbRefs?: string[];
  ruleRefs?: string[];
  kbEvidence?: string;
  ruleEvidence?: string;
  actionPlanEvidence?: string;
  scheduleEvidence?: string;
  sourceYear?: number;
  icon?: string;
}

export interface CoreIdeaRating {
  overall: number;
  seoPotential: number;
  audienceFit: number;
  docSupport: number;
  uniqueness: number;
}

export interface CoreIdeaSuggestion {
  id: string;
  title: string;
  angleLabel: string;
  angleDescription: string;
  mainArgument: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  targetAudience: string;
  recommendedTone: string;
  recommendedWordCount: number;
  rating: CoreIdeaRating;
  ratingRationale: string;
  matchedDocs: string[];
  ruleRefs: string[];
}

export interface Article {
  id: string;
  title: string;
  currentStep: number;
  status: ArticleStatus;
  createdAt: string;
  updatedAt: string;
  // Step 1 data
  contentType?: string | null;
  selectedContentTypeSuggestionId?: string | null;
  contentTypeSuggestions?: ContentTypeSuggestion[];
  contentTypeSourceFingerprint?: string | null;
  contentTypeScannedAt?: string | null;
  // Step 2 data
  topic?: string;
  keywords?: string;
  targetAudience?: string;
  angle?: string;
  wordCount?: number;
  tone?: string;
  coreIdeaSuggestions?: CoreIdeaSuggestion[];
  selectedCoreIdeaId?: string;
  // Step 3 data
  outline?: OutlineSection[];
  // Step 4 data
  draft?: string;
}

export interface ContentType {
  id: string;
  label: string;
  description: string;
  icon: string;
  color: string;
}

export type ActiveTab = 'step-setup' | 'models' | 'knowledge-base';
export type KbSubTab = 'kb' | 'action' | 'rules';

// ── Action Plan — multi-source data input ────────────────────────────────────

export type ActionSourceType =
  | 'file'       // upload CSV/XLSX/JSON/PDF
  | 'paste'      // paste raw CSV, JSON, plain text
  | 'url'        // REST API endpoint hoặc RSS feed
  | 'gsheet'     // Google Sheets public URL
  | 'manual'     // nhập bảng thủ công
  | 'supabase'   // SQL query trên Supabase đã kết nối
  | 'airtable';  // Airtable API

export interface ManualRow {
  id: string;
  cells: string[];
}

export interface ActionDataSource {
  id: string;
  name: string;
  sourceType: ActionSourceType;
  addedAt: string;
  // Chung
  preview?: string;       // vài dòng đầu để hiển thị
  rowCount?: number;
  // File
  fileType?: string;
  size?: string;
  // Paste / Manual
  content?: string;       // raw text hoặc CSV string
  contentUpdatedAt?: string; // dùng để phát hiện Action Plan quý mới
  contentLength?: number;
  contentHash?: string;
  scanStatus?: 'ready' | 'error';
  storagePath?: string;
  originalMimeType?: string;
  // URL / GSheet
  url?: string;
  headers?: Record<string, string>;   // custom request headers cho API
  // Manual table
  columns?: string[];
  rows?: ManualRow[];
  // Supabase
  query?: string;
  // Airtable
  airtableKey?: string;
  airtableBase?: string;
  airtableTable?: string;
}
