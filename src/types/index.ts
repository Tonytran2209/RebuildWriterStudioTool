import type { OutlineStructureSnapshot } from '../../shared/outlineStructures.ts';
import type { ContentPlanSettings } from '../../shared/contentPlanSettings.ts';
export type AIProvider = "anthropic" | "openai" | "google" | "mistral" | "together" | "groq" | "deepseek"

export interface AIModel {
  id: string
  name: string
  provider: AIProvider
  description: string
  enabled: boolean
  contextWindow: string
  speed: "fast" | "medium" | "slow"
  pricing?: {
    inputUsdPerMillion: number
    outputUsdPerMillion: number
    cachedInputUsdPerMillion?: number
    longContextThresholdTokens?: number
    longContextInputMultiplier?: number
    longContextOutputMultiplier?: number
  }
}

export type AppLanguage = "vi" | "en"

export interface AICallUsage {
  id: string
  articleId?: string
  step: 1 | 2 | 3 | 4
  provider: AIProvider
  model: string
  inputTokens: number
  cachedInputTokens?: number
  outputTokens: number
  totalTokens: number
  costUsd: number | null
  cacheHit: boolean
  calledAt: string
  // Monitoring (AI Agent Lab): when the call started, how long it took as seen by the browser, and
  // why it was made ("generation", "recheck", "seo-research", ...). Older records lack them.
  startedAt?: string
  durationMs?: number
  purpose?: string
  /** Short excerpt of what the call received and returned, saved by the batch runner. */
  trace?: { input: string; output: string; sources: string[]; rules: string[] }
}

export type FileCategory = "kb" | "rules"
export type LegacyFileCategory = "action" | "action-plan"
export type FileType = "pdf" | "docx" | "csv" | "xlsx" | "txt" | "md" | "json"

export interface StructuredDocumentSection {
  id: string
  heading: string
  content: string
  contentHash: string
  wave?: string
  timeframe?: string
  typeGroups: ContentTypeGroup[]
}

export interface DocumentFile {
  id: string
  name: string
  size: string
  uploadedAt: string
  category: FileCategory | LegacyFileCategory
  fileType: FileType
  content?: string
  contentUpdatedAt?: string
  contentLength?: number
  contentHash?: string
  scanStatus?: "ready" | "error"
  structuredSections?: StructuredDocumentSection[]
  storagePath?: string
  originalMimeType?: string
  sourceType?: ActionSourceType
  addedAt?: string
  preview?: string
  rowCount?: number
  url?: string
  query?: string
  columns?: string[]
  rows?: ManualRow[]
  airtableBase?: string
  airtableTable?: string
  knowledgeMetadata?: KnowledgeMetadata
  /** Storage group chosen when the document was added (same groups as Storage and Settings). */
  storageGroup?: string
}

export interface GateReviewItem { item: string; status: "pass" | "warning" | "fail"; reason: string; location?: string; fixable?: boolean }
export interface GateReview {
  status: "pass" | "warning" | "fail" | "error"
  checks: GateReviewItem[]
  /** Fix rounds actually run. */
  rounds: number
  /** Hash of the reviewed output; a different current output means the review is stale. */
  outputHash: string
  standards: string[]
  reviewedAt: string
  error?: string
}

export interface KnowledgeMetadata {
  /** positioning, usp and brand_voice are Brand context (sent whole); the rest are Evidence (excerpted). */
  type: "usp" | "positioning" | "brand_voice" | "client_insight" | "case_study" | "framework" | "approved_claim" | "production_insight" | "reference"
  topics: string[]
  service?: string
  audience?: string
  visibility: "internal" | "public"
  approvedForExternalUse: boolean
  lastUpdated?: string
}

export interface WebsiteContentRecord {
  id: string
  url: string
  canonicalUrl?: string
  title: string
  contentType: "blog" | "service" | "portfolio" | "landing" | "about" | "commercial"
  topics: string[]
  services?: string[]
  audience?: string
  status: "active" | "redirected" | "broken" | "unchecked" | "queued" | "checking"
  redirectTarget?: string
  eligibleForInternalLink: boolean
  lastChecked?: string
  description?: string
  httpStatus?: number
  crawlStatus?: "queued" | "checking" | "summarizing" | "complete" | "failed"
  lastError?: string
  classificationConfidence?: number
  contentFingerprint?: string
  summary?: string
  primaryTopic?: string
  searchIntent?: SearchIntent
  internalLinkAnchors?: string[]
  keyClaims?: string[]
  language?: string
  aiModel?: string
  aiSummaryVersion?: string
  summarizedAt?: string
  summaryCacheHit?: boolean
  aiSummarySkippedReason?: "daily-limit"
}

export interface StepFileAccess {
  kb: string[]
  rules: string[]
}

export type StepDocumentPromptRules = Partial<Record<FileCategory, Record<string, string>>>
export type StepCategoryPromptRules = Partial<Record<FileCategory, string>>

export interface StepConfig {
  modelId: string
  fileAccess: StepFileAccess
  /** Target English-word count for the final draft stage (legacy field name). */
  maxDraftWords?: number
  /** Legacy character setting, read once as a numeric migration fallback. */
  maxDraftCharacters?: number
  categoryPromptRules?: StepCategoryPromptRules
  /** The Gate's primary Playbook (a Rules file ticked for this step); sent as the authoritative method. */
  primaryPlaybookId?: string
  /** Legacy per-document rules, retained only for automatic migration. */
  documentPromptRules?: StepDocumentPromptRules
  systemPrompt?: string
}

export type WorkflowRuleId = "source-grounding" | "core-idea" | "outline" | "draft" | "quality-persistence"
export type WorkflowRuleEnforcement = "strict" | "guided"
export type WorkflowExecutionMode = "manual" | "batch"

export interface WorkflowStageOverride {
  instruction?: string
  parameters?: Record<string, number | string | boolean>
}

export interface WorkflowRuleSetting {
  enforcement: WorkflowRuleEnforcement
  customInstruction: string
  appliesTo: { manual: boolean; batch: boolean }
  stageOverrides: Record<string, WorkflowStageOverride>
  version: number
}

export type WorkflowRuleSettings = Partial<Record<WorkflowRuleId, WorkflowRuleSetting>>

export interface AppConfig {
  /** Server-side save counter; a save built on an older revision is rejected (409). */
  revision?: number
  /** Every number and switch of the AI workflow, by setting id (shared/gateSettings.ts). */
  gateSettings?: Record<string, number | boolean | string>
  /** 2 once the Gate documents v2 migration has run. */
  gateDocumentsVersion?: number
  railwayUrl: string
  stepConfigs: Record<number, StepConfig>
  models: AIModel[]
  /** Models for AI tasks that are not a pipeline step: empty = default (review → G3 model, SEO → gpt-5.4-mini, inventory → env/gpt-5.4-mini). */
  taskModels?: { review?: string; seo?: string; inventory?: string }
  /** Admin rules of the Content Plan classifier; missing fields use the defaults. */
  contentPlan?: Partial<ContentPlanSettings>
  /** Catalog version the saved model list and prices were merged from (src/lib/defaultData.ts). */
  modelCatalogVersion?: string
  workflowRules?: WorkflowRuleSettings
  websiteInventory?: WebsiteContentRecord[]
  pipeline?: Partial<PipelineSettings>
}

/** 3-gate pipeline settings. Values are provisional until the team closes docs/AI-PIPELINE-UPGRADE.md §8. */
export interface PipelineSettings {
  threshold: number
  options: number
  revisionRounds: number
  perBatch: number
  maxParallel: number
  noPass: "best-flagged" | "fail"
  reviewSample: number
}

export interface HumanReview {
  status: "approved" | "needs_revision"
  comment?: string
  reviewer?: string
  reviewedAt: string
}

export type SearchIntent = "informational" | "commercial" | "transactional" | "navigational"

export interface EvidenceRef {
  source: string
  note?: string
  quote?: string
  role?: "kb" | "content_plan" | "rules"
}

export interface OutlineSection {
  grounding?: "evidence-led" | "editorial-guidance"
  id: string
  heading: string
  notes: string
  rationale?: string
  level: "h2" | "h3"
  keywords?: string[]
  searchIntent?: SearchIntent
  evidence?: EvidenceRef[]
  ruleRefs?: string[]
}

export type ArticleStatus = "planning" | "in_progress" | "review" | "done"

export type ContentTypeGroup = "A" | "B" | "C"

export interface ContentTypeSuggestion {
  id: string
  label: string
  description: string
  keywords?: string[]
  // Classification snapshot created from the current Content Plan input.
  typeGroup?: ContentTypeGroup
  wave?: string
  timeframe?: string
  audience?: string
  format?: string
  matchedDocs?: string[]
  kbRefs?: string[]
  ruleRefs?: string[]
  kbEvidence?: string
  ruleEvidence?: string
  contentPlanEvidence?: string
  scheduleEvidence?: string
  sourceYear?: number
  icon?: string
}

export interface CoreIdeaRating {
  overall: number
  seoPotential: number
  audienceFit: number
  docSupport: number
  uniqueness: number
}

export interface SeoKeywordMetric {
  keyword: string
  searchVolume: number | null
  keywordDifficulty: number | null
  competition: number | null
  cpc: number | null
  intent: string | null
  source: "dataforseo" | "openai_web_search"
  sources?: string[]
  marketEvidence?: string
  updatedAt: string | null
}

export interface SeoResearchResult {
  keywords: SeoKeywordMetric[]
  seedKeywords: string[]
  location: string
  language: string
  researchedAt: string
  cacheHit?: boolean
  budget?: { used: number; limit: number }
}

export interface KeywordAuditItem {
  keyword: string
  decision: "accepted" | "rejected"
  reason: string
  ruleReason: string
  kbReason: string
}

/** Sub-job timing saved by the batch runner (backend/batchSteps.ts). */
export type BatchStepRun = { key: "plan" | "seo" | "spec" | "outline" | "draft" | "quality"; label: string; startedAt: string; endedAt: string | null; status: "running" | "completed" | "failed" }

export interface AIProcessTraceEvent {
  id: string
  stage: string
  status: "completed" | "warning" | "failed"
  title: string
  detail: string
  facts?: Record<string, string | number | boolean | null>
  sources?: string[]
}

export interface CoreIdeaSuggestion {
  id: string
  title: string
  angleLabel: string
  angleDescription: string
  mainArgument: string
  primaryKeyword: string
  secondaryKeywords: string[]
  targetAudience: string
  recommendedTone: string
  recommendedWordCount: number
  rating: CoreIdeaRating
  ratingRationale: string
  ratingRationales?: Partial<Record<keyof CoreIdeaRating, string>>
  keywordAudit?: KeywordAuditItem[]
  matchedDocs: string[]
  ruleRefs: string[]
  evidence?: EvidenceRef[]
}

export interface ArticleSpec {
  version: number
  topic: string
  primaryQuery: string
  secondaryQueries: string[]
  audience: string
  market: string
  language: string
  primaryIntent: SearchIntent
  secondaryIntent?: SearchIntent
  expectedReaderOutcome: string
  winningFormat: string
  mustCover: string[]
  optionalCoverage: string[]
  thesis: string
  brandPov: string
  evidence: EvidenceRef[]
  ctaObjective: string
  internalLinkRequirements: string[]
  /** Information-gain fields (G1). Absent on Specs built before they existed. */
  pageType?: string
  entities?: string[]
  /** Questions readers ask (People Also Ask style), to be answered in the article. */
  questions?: string[]
  /** What competing pages miss (from the competitor analysis when it ran). */
  contentGaps?: string[]
  /** What this brand can add that generic pages cannot, grounded in Brand context and Evidence. */
  informationGain?: string[]
  /** Short self-contained statements worth being quoted by search and AI answers. */
  citationTargets?: string[]
  createdAt: string
}

export interface CompetitorPage {
  url: string
  status: "analyzed" | "failed"
  title?: string
  headings?: string[]
  wordCount?: number
  pageType?: string
  strengths?: string[]
  weaknesses?: string[]
  entities?: string[]
  error?: string
}
export interface CompetitorAnalysis {
  status: "done" | "error"
  analyzedAt: string
  /** researchedAt of the keyword research the URLs came from; a new research means a new analysis. */
  seoResearchedAt: string
  pages: CompetitorPage[]
  summary?: { commonSections: string[]; contentGaps: string[]; entities: string[]; questions: string[]; formats: string[] }
  error?: string
}
export interface CannibalisationMatch { kind: "page" | "article"; id: string; title: string; url?: string; keyword: string; score: number }

export interface QualityGateCheck {
  blocking?: boolean
  id: string
  label: string
  kind: "deterministic" | "semantic"
  status: "pass" | "warning" | "fail"
  reason: string
  evidence?: string
  location?: string
  recommendedAction?: string
  autoFixAllowed: boolean
}

export interface UniversalQualityReport {
  inputFingerprint?: string
  version: number
  status: "pass" | "warning" | "fail"
  checkedAt: string
  articleSpecFingerprint: string
  checks: QualityGateCheck[]
}

export interface EditorialApproval {
  status: "pending" | "approved" | "rejected"
  approvedAt?: string
  note?: string
  outlineFingerprint?: string
}

export interface Article {
  id: string
  title: string
  currentStep: number
  status: ArticleStatus
  createdAt: string
  updatedAt: string
  completedAt?: string | null
  // Step 1 data
  contentType?: string | null
  selectedContentTypeSuggestionId?: string | null
  selectedContentTypeSnapshot?: ContentTypeSuggestion | null
  contentTypeSuggestions?: ContentTypeSuggestion[]
  contentTypeSourceFingerprint?: string | null
  contentTypeScannedAt?: string | null
  contentTypeCacheHit?: boolean
  // Step 2 data
  topic?: string
  keywords?: string
  targetAudience?: string
  angle?: string
  wordCount?: number
  tone?: string
  coreIdeaSuggestions?: CoreIdeaSuggestion[]
  selectedCoreIdeaId?: string
  coreIdeaSourceFingerprint?: string | null
  coreIdeaScannedAt?: string | null
  seoResearch?: SeoResearchResult | null
  articleSpec?: ArticleSpec | null
  articleSpecFingerprint?: string | null
  step2ProcessTrace?: AIProcessTraceEvent[]
  // Step 3 data
  outline?: OutlineSection[]
  outlineSourceFingerprint?: string | null
  outlineScannedAt?: string | null
  step3ProcessTrace?: AIProcessTraceEvent[]
  step3SuggestedKeywords?: string[]
  outlineStructure?: OutlineStructureSnapshot | null
  /** Introduction range from Settings › Workflow rules (G3), frozen when the draft is written; QC measures against it. */
  introductionBudget?: { min: number; max: number; paragraphs?: number }
  /** Conclusion heading and H1 keyword rule, frozen when the draft is written. Absent = "Conclusion", keyword required. */
  draftFormat?: { conclusionHeading?: string; titleKeyword?: boolean }
  competitorAnalysis?: CompetitorAnalysis | null
  /** Overlap of this article's primary keyword/title with existing pages and articles, checked after G1. */
  cannibalisation?: { checkedAt: string; matches: CannibalisationMatch[] } | null
  /** G1 (2) and G2 (3) AI self-review against that Gate's Standards. */
  gateReviews?: Partial<Record<2 | 3, GateReview>>
  outlineNeedsRegeneration?: boolean
  draftNeedsRegeneration?: boolean
  /** Legacy storage only; layout comes from outlineStructure. */
  comparisonStructure?: "standard" | "similarities-differences"
  // Step 4 data
  outlineGenerationId?: string
  draftGenerationId?: string
  draft?: string
  draftSourceFingerprint?: string | null
  draftScannedAt?: string | null
  step4ProcessTrace?: AIProcessTraceEvent[]
  step4RawResponseExcerpt?: string | null
  draftEvidenceUsage?: Record<string, string[]>
  semanticReviewFingerprint?: string | null
  semanticReviewChecks?: QualityGateCheck[] | null
  qualityReport?: UniversalQualityReport | null
  editorialApproval?: EditorialApproval | null
  humanReview?: HumanReview | null
  /** Human-confirmed example for G2/G3 (Storage › Approved Articles). */
  approvedArticle?: { by: string; at: string } | null
  workflowRuleSnapshots?: Partial<Record<2 | 3 | 4, WorkflowRuleSnapshot>>
  aiUsageByStep?: Partial<Record<1 | 2 | 3 | 4, AICallUsage[]>>
  batchStepRuns?: BatchStepRun[]
  // Activity workspace / per-run content plan
  activityType?: "comparison-seo" | "editorial-originality"
  activityKind?: "single" | "batch"
  activityId?: string
  contentPlanInput?: string
  contentPlanItemId?: string
  batchSize?: 5 | 10 | 15 | 20
  batchArticleIds?: string[]
  batchStatus?: "queued" | "running" | "paused" | "completed" | "failed" | "awaiting_approval"
  batchError?: string | null
  batchStartedAt?: string | null
  contentPlanId?: string
  contentPlanVersion?: number
  contentPlanSourceItemId?: string
  /** Runtime compatibility marker. Legacy records remain read-only until copied. */
  legacyReadOnly?: boolean
  legacyReason?: string
  migratedFromArticleId?: string
}

export interface WorkflowRuleSnapshot {
  version: number
  executionMode: WorkflowExecutionMode
  stepNumber: number
  fingerprint: string
  capturedAt: string
  rules: Array<{
    id: WorkflowRuleId
    enforcement: WorkflowRuleEnforcement
    stages: Array<{
      id: string
      instruction: string
      parameters: Record<string, number | string | boolean>
    }>
    customInstruction: string
  }>
}

export interface ContentPlanItem {
  id: string
  title: string
  keywords: string[]
  type: "comparison-seo" | "editorial-originality" | "needs-review"
  sourceLine: string
  confidence?: number
  classificationReason?: string
  sourceId?: string
  sourceSectionId?: string
  sourceQuote?: string
  status?: "not_started" | "queued" | "generating" | "in_progress" | "completed" | "failed" | "archived"
}

export type ContentPlanSourceType = "file" | "google_doc" | "google_sheet" | "paste"

export interface ContentPlanSource {
  id: string
  contentPlanId: string
  sourceType: ContentPlanSourceType
  name: string
  originalUrl?: string
  storagePath?: string
  mimeType?: string
  extractedContent: string
  contentHash: string
  contentLength: number
  scanStatus: "processing" | "ready" | "failed"
  scanError?: string
  createdAt: string
}

export interface ContentPlan {
  id: string
  seriesId?: string
  name: string
  description?: string
  status: "draft" | "processing" | "ready" | "active" | "archived" | "failed"
  version: number
  previousVersionId?: string | null
  sourceFingerprint: string
  totalArticles: number
  comparisonCount: number
  editorialCount: number
  reviewCount: number
  createdAt: string
  updatedAt: string
  classifiedAt?: string
  /** Topics the AI named in the last classification that were not found in the source. */
  classificationDropped?: string[]
  /** Why the last background classification failed (status `failed`). */
  classificationError?: string
  sources?: ContentPlanSource[]
  items?: ContentPlanItem[]
  changeSummary?: { added: string[]; removed: string[]; unchanged: string[] }
}

export interface ContentType {
  id: string
  label: string
  description: string
  icon: string
  color: string
}

export type ActiveTab = "step-setup" | "models" | "knowledge-base"
export type KbSubTab = "kb" | "rules" | "website" | "legacy-action"

// ── Knowledge/Skill source import ────────────────────────────────────────────

export type ActionSourceType = "file" | "paste" | "url" | "gsheet" | "manual" | "supabase" | "airtable" // upload CSV/XLSX/JSON/PDF // paste raw CSV, JSON, plain text // REST API endpoint hoặc RSS feed // Google Sheets public URL // nhập bảng thủ công // SQL query trên Supabase đã kết nối // Airtable API

export interface ManualRow {
  id: string
  cells: string[]
}

export interface ActionDataSource {
  id: string
  name: string
  sourceType: ActionSourceType
  addedAt: string
  // Chung
  preview?: string // vài dòng đầu để hiển thị
  rowCount?: number
  // File
  fileType?: string
  size?: string
  // Paste / Manual
  content?: string // raw text hoặc CSV string
  contentUpdatedAt?: string
  contentLength?: number
  contentHash?: string
  scanStatus?: "ready" | "error"
  structuredSections?: StructuredDocumentSection[]
  storagePath?: string
  originalMimeType?: string
  // URL / GSheet
  url?: string
  headers?: Record<string, string> // custom request headers cho API
  // Manual table
  columns?: string[]
  rows?: ManualRow[]
  // Supabase
  query?: string
  // Airtable
  airtableKey?: string
  airtableBase?: string
  airtableTable?: string
}
