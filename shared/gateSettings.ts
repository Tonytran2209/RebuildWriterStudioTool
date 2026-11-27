/**
 * Gate settings: the single place for every number and switch of the AI workflow
 * (design: .agent-hub/backend/gate-documents-v2.md §6). Markdown documents hold wording only.
 * Saved flat in writer:config.gateSettings as { [id]: value }; read through resolveGateSettings.
 */
import { primaryPlaybookId, storageGroupOf } from './gateDocuments.ts';

export type GateSettingKind = 'number' | 'boolean' | 'text';
export interface GateSetting {
  id: string;
  /** 2 = G1, 3 = G2, 4 = G3, 0 = every Gate */
  step: 0 | 2 | 3 | 4;
  level: 'basic' | 'advanced';
  kind: GateSettingKind;
  def: number | boolean | string;
  min?: number;
  max?: number;
  vi: string; en: string; hintVi: string; hintEn: string;
  /** v1 location of the value (workflowRules[rule].stageOverrides[stage].parameters[id]), read once by the migration. */
  legacy?: [rule: string, stage: string];
}

export const GATE_SETTINGS: GateSetting[] = [
  { id: 'specSelfReview', step: 2, level: 'basic', kind: 'boolean', def: false, vi: 'Tự duyệt bằng AI theo Standards', en: 'AI self-review against Standards', hintVi: 'Sau khi tạo Core Idea, AI chấm theo các file Standards đã tick ở G1 và sửa lỗi. Tốn thêm lượt gọi AI.', hintEn: 'After the Core Idea, AI checks it against the Standards ticked for G1 and fixes issues. Costs extra AI calls.' },
  { id: 'specFixRounds', step: 2, level: 'advanced', kind: 'number', def: 1, min: 0, max: 2, vi: 'Số lượt sửa tối đa', en: 'Max fix rounds', hintVi: 'Mỗi lượt gồm một lần sửa và một lần chấm lại.', hintEn: 'Each round is one fix and one re-check.' },
  { id: 'competitorAnalysis', step: 2, level: 'basic', kind: 'boolean', def: false, vi: 'Phân tích nội dung đối thủ', en: 'Competitor content analysis', hintVi: 'Đọc các trang đối thủ tìm được khi nghiên cứu keyword (không gồm trang của bạn trong Website Inventory) và tóm tắt cấu trúc, điểm mạnh, điểm yếu, khoảng trống. Tốn thêm một lượt gọi AI mỗi bài.', hintEn: 'Reads competitor pages found during keyword research (not your Website Inventory pages) and summarises structure, strengths, weaknesses and gaps. One extra AI call per article.' },
  { id: 'competitorCount', step: 2, level: 'advanced', kind: 'number', def: 5, min: 2, max: 10, vi: 'Số trang đối thủ tối đa', en: 'Max competitor pages', hintVi: 'Trang nào không đọc được thì bỏ qua.', hintEn: 'Pages that cannot be read are skipped.' },
  { id: 'cannibalisationCheck', step: 2, level: 'basic', kind: 'boolean', def: true, vi: 'Cảnh báo trùng keyword (cannibalisation)', en: 'Keyword overlap warning (cannibalisation)', hintVi: 'Sau G1, so keyword chính và tiêu đề với Website Inventory và các bài khác; chỉ cảnh báo, không chặn. Không gọi AI.', hintEn: 'After G1, compares the primary keyword and title with Website Inventory and other articles; warns only. No AI call.' },
  { id: 'keywordCount', step: 2, level: 'basic', kind: 'number', def: 10, min: 5, max: 20, legacy: ['core-idea', 'market-research'], vi: 'Số keyword nghiên cứu', en: 'Keywords to research', hintVi: 'Số keyword SEO tra trên web cho mỗi bài.', hintEn: 'SEO keywords looked up on the web per article.' },
  { id: 'ideaCount', step: 2, level: 'basic', kind: 'number', def: 3, min: 2, max: 6, legacy: ['core-idea', 'idea-generation'], vi: 'Số ý tưởng', en: 'Ideas', hintVi: 'Số ý tưởng AI tạo ra để chọn một ý viết bài.', hintEn: 'Ideas generated before one is chosen.' },
  { id: 'outlineSelfReview', step: 3, level: 'basic', kind: 'boolean', def: false, vi: 'Tự duyệt bằng AI theo Standards', en: 'AI self-review against Standards', hintVi: 'Sau khi lập outline, AI chấm theo các file Standards đã tick ở G2 và sửa lỗi. Tốn thêm lượt gọi AI.', hintEn: 'After the outline, AI checks it against the Standards ticked for G2 and fixes issues. Costs extra AI calls.' },
  { id: 'outlineFixRounds', step: 3, level: 'advanced', kind: 'number', def: 1, min: 0, max: 2, vi: 'Số lượt sửa tối đa', en: 'Max fix rounds', hintVi: 'Sửa chỉ được đổi tiêu đề và ghi chú của section đã có, không thêm hay bớt section.', hintEn: 'A fix may only change headings and notes of existing sections, never add or remove sections.' },
  { id: 'minimumSections', step: 3, level: 'basic', kind: 'number', def: 4, min: 4, max: 12, legacy: ['outline', 'outline-mapping'], vi: 'Số section tối thiểu', en: 'Minimum sections', hintVi: 'Outline không được ít hơn số section này (tính cả H3).', hintEn: 'The outline never has fewer sections (H3 included).' },
  { id: 'draftFixRounds', step: 4, level: 'advanced', kind: 'number', def: 1, min: 0, max: 2, vi: 'Số lượt sửa tối đa sau AI Review', en: 'Max fix rounds after AI Review', hintVi: 'AI Review ở G3 luôn chạy; đây là số lần AI tự sửa theo kết quả chấm.', hintEn: 'G3 AI Review always runs; this is how many times AI fixes the draft from it.' },
  { id: 'introMinWords', step: 4, level: 'basic', kind: 'number', def: 60, min: 30, max: 150, vi: 'Mở bài tối thiểu (từ)', en: 'Introduction minimum (words)', hintVi: 'QC và prompt dùng cùng số này.', hintEn: 'QC and prompts use the same number.' },
  { id: 'introMaxWords', step: 4, level: 'basic', kind: 'number', def: 85, min: 40, max: 200, vi: 'Mở bài tối đa (từ)', en: 'Introduction maximum (words)', hintVi: 'Luôn ≥ số tối thiểu.', hintEn: 'Never below the minimum.' },
  { id: 'introParagraphs', step: 4, level: 'advanced', kind: 'number', def: 1, min: 1, max: 3, vi: 'Số đoạn mở bài', en: 'Introduction paragraphs', hintVi: 'QC yêu cầu đúng số đoạn này.', hintEn: 'QC requires exactly this many paragraphs.' },
  { id: 'conclusionPercent', step: 4, level: 'basic', kind: 'number', def: 7, min: 5, max: 12, legacy: ['draft', 'word-allocation'], vi: 'Độ dài kết luận (%)', en: 'Conclusion length (%)', hintVi: 'Phần trăm số từ dành cho kết luận.', hintEn: 'Share of the word budget for the conclusion.' },
  { id: 'conclusionHeading', step: 4, level: 'advanced', kind: 'text', def: 'Conclusion', vi: 'Tiêu đề mục kết luận', en: 'Conclusion heading', hintVi: 'Tool tự thêm mục H2 này ở cuối bài (ví dụ "Where to Start").', hintEn: 'The tool appends this H2 at the end (for example "Where to Start").' },
  { id: 'maxSentencesPerParagraph', step: 4, level: 'advanced', kind: 'number', def: 5, min: 2, max: 7, legacy: ['draft', 'structured-assembly'], vi: 'Số câu tối đa mỗi đoạn', en: 'Max sentences per paragraph', hintVi: 'Giữ đoạn văn ngắn, dễ đọc.', hintEn: 'Keeps paragraphs short.' },
  { id: 'titleKeyword', step: 4, level: 'advanced', kind: 'boolean', def: true, vi: 'H1 phải chứa keyword chính', en: 'H1 must contain the primary keyword', hintVi: 'Bật: QC kiểm tra và tool tự thêm keyword vào H1 nếu thiếu.', hintEn: 'On: QC checks it and the tool appends the keyword to the H1 when missing.' },
  { id: 'promptCache', step: 0, level: 'advanced', kind: 'boolean', def: true, vi: 'Dùng prompt cache', en: 'Use prompt cache', hintVi: 'Phần quy tắc giống nhau giữa các bài được nhà cung cấp AI cache, nên rẻ hơn khi chạy batch.', hintEn: 'Rules shared by every article are cached by the AI provider, so batches cost less.' },
];

export type GateSettingValues = {
  specSelfReview: boolean; specFixRounds: number; competitorAnalysis: boolean; competitorCount: number; cannibalisationCheck: boolean; keywordCount: number; ideaCount: number;
  outlineSelfReview: boolean; outlineFixRounds: number; minimumSections: number;
  draftFixRounds: number; introMinWords: number; introMaxWords: number; introParagraphs: number; conclusionPercent: number;
  conclusionHeading: string; maxSentencesPerParagraph: number; titleKeyword: boolean; promptCache: boolean;
};

/** One setting value made safe: numbers clamped and rounded, text one short line without Markdown markers. */
function clean(setting: GateSetting, value: unknown): number | boolean | string {
  if (setting.kind === 'boolean') return typeof value === 'boolean' ? value : setting.def;
  if (setting.kind === 'text') {
    const text = typeof value === 'string' ? value.replace(/[#\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    return text || setting.def;
  }
  const number = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.min(setting.max!, Math.max(setting.min!, Math.round(number))) : setting.def;
}

/** Valid saved values only (unknown keys dropped); used by the server before saving and by every reader. */
export function sanitizeGateSettings(raw: unknown): Partial<GateSettingValues> {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const out: Record<string, unknown> = {};
  for (const setting of GATE_SETTINGS) if (source[setting.id] !== undefined) out[setting.id] = clean(setting, source[setting.id]);
  return out as Partial<GateSettingValues>;
}

export function resolveGateSettings(config: { gateSettings?: unknown } | null | undefined): GateSettingValues {
  const saved = sanitizeGateSettings(config?.gateSettings) as Record<string, unknown>;
  const values = Object.fromEntries(GATE_SETTINGS.map(setting => [setting.id, saved[setting.id] ?? setting.def])) as GateSettingValues;
  if (values.introMaxWords < values.introMinWords) values.introMaxWords = values.introMinWords;
  return values;
}

/* ─── Migration from v1 (front matter numbers and old Settings stage parameters) ─── */

type LegacyFile = { id: string; name: string; category?: string; storageGroup?: string; content?: string };
type LegacyConfig = { stepConfigs?: Record<number, any>; workflowRules?: Record<string, any> } | null | undefined;

/** Numeric `key: value` lines of a leading `---` front matter block (v1 format). */
export function readFrontMatter(content = ''): Record<string, number> {
  const match = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!match) return {};
  return Object.fromEntries(match[1].split(/\r?\n/).flatMap(line => {
    const pair = /^\s*([A-Za-z][\w-]*)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?:#.*)?$/.exec(line);
    return pair ? [[pair[1], Number(pair[2])]] : [];
  }));
}

const V1_NUMBERS: Array<[id: keyof GateSettingValues, step: 2 | 3 | 4]> = [['keywordCount', 2], ['ideaCount', 2], ['minimumSections', 3], ['introMinWords', 4], ['introMaxWords', 4], ['conclusionPercent', 4], ['maxSentencesPerParagraph', 4]];

/** The numbers v1 used: primary Playbook front matter, then a ticked Standards file, then the old Settings value. Unset numbers are left out. */
export function legacyGateNumbers(files: LegacyFile[], config: LegacyConfig): Partial<GateSettingValues> {
  const out: Record<string, number> = {};
  for (const [id, step] of V1_NUMBERS) {
    const allowed = new Set<string>(config?.stepConfigs?.[step]?.fileAccess?.rules ?? []);
    const rules = files.filter(file => file.category === 'rules' && allowed.has(file.id) && file.content);
    const primary = primaryPlaybookId(config as any, step);
    const ordered = [...rules.filter(file => file.id === primary), ...rules.filter(file => file.id !== primary && storageGroupOf(file) === 'Standards')];
    const fromFile = ordered.map(file => readFrontMatter(file.content)[id]).find(Number.isFinite);
    const setting = GATE_SETTINGS.find(s => s.id === id)!;
    const legacy = setting.legacy ? Number(config?.workflowRules?.[setting.legacy[0]]?.stageOverrides?.[setting.legacy[1]]?.parameters?.[id]) : NaN;
    const value = fromFile ?? (Number.isFinite(legacy) ? legacy : undefined);
    if (value !== undefined) out[id] = clean(setting, value) as number;
  }
  return out as Partial<GateSettingValues>;
}
