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
}

export interface OutlineSection {
  id: string;
  heading: string;
  notes: string;
  level: 'h2' | 'h3';
}

export type ArticleStatus = 'planning' | 'in_progress' | 'review' | 'done';

export interface Article {
  id: string;
  title: string;
  currentStep: number;
  status: ArticleStatus;
  createdAt: string;
  updatedAt: string;
  // Step 1 data
  contentType?: string;
  // Step 2 data
  topic?: string;
  keywords?: string;
  targetAudience?: string;
  angle?: string;
  wordCount?: number;
  tone?: string;
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
