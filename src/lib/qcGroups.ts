// Universal QC criteria labels and display groups.
export const QC_LABELS_VI: Record<string, string> = {
  'introduction-word-budget': 'Mở bài ngắn gọn, đúng trọng tâm',
  'outline-structure': 'Đúng cấu trúc MD đã chọn',
  'outline-fidelity': 'Giữ đúng heading của outline',
  'complete-structure': 'Đủ H1 và H2',
  'duplicate-headings': 'Không lặp heading liền nhau',
  'word-budget': 'Số từ trong khoảng mục tiêu',
  'single-conclusion': 'Có đúng một phần Conclusion',
  'primary-query': 'Có từ khóa chính trong bài',
  'title-keyword': 'H1 chứa từ khóa chính',
  'must-cover': 'Đủ các chủ đề bắt buộc',
  'placeholders': 'Không còn placeholder',
  'source-confidentiality': 'Không lộ tên nguồn nội bộ',
  'link-correctness': 'Internal link đã được duyệt',
  'internal-link-budget': 'Số lượng internal link',
  'internal-link-distribution': 'Internal link rải đều các mục',
  'evidence-mapping': 'Dẫn chứng đúng mục outline',
  'conclusion-word-budget': 'Độ dài phần kết',
  'intent-satisfied': 'Đáp ứng search intent',
  'reader-outcome': 'Giá trị cho người đọc',
  'intro-quality': 'Chất lượng mở bài',
  'keyword-naturalness': 'Từ khóa tự nhiên',
  'evidence-support': 'Có dẫn chứng hỗ trợ',
  'brand-pov': 'Đúng góc nhìn thương hiệu',
};

/** Quality Scorecard axes. Standards checks (checklist-compliance) count as Brand; Spec questions, gaps and information gain are judged in reader-outcome. */
export const QC_GROUPS = [
  { key: 'seo', vi: 'SEO', en: 'SEO' },
  { key: 'brand', vi: 'Thương hiệu', en: 'Brand' },
  { key: 'evidence', vi: 'Dẫn chứng', en: 'Evidence' },
  { key: 'differentiation', vi: 'Khác biệt', en: 'Differentiation' },
  { key: 'ai', vi: 'Sẵn sàng cho AI', en: 'AI readiness' },
] as const;
export type QcGroupKey = typeof QC_GROUPS[number]['key'];
export function qcGroupOf(id: string): QcGroupKey {
  if (['brand-pov', 'checklist-compliance', 'source-confidentiality'].includes(id)) return 'brand';
  if (['evidence-support', 'evidence-mapping', 'placeholders'].includes(id)) return 'evidence';
  if (id === 'reader-outcome') return 'differentiation';
  if (['introduction-word-budget', 'outline-structure', 'outline-fidelity', 'complete-structure', 'duplicate-headings', 'single-conclusion', 'conclusion-word-budget', 'intro-quality'].includes(id)) return 'ai';
  return 'seo';
}
/** Axis score 0-100 with the AI Review weights: pass 1, warning 0.5, fail 0. */
export function qcGroupScore(checks: Array<{ status: string }>): number {
  if (!checks.length) return 0;
  return Math.round(checks.reduce((sum, check) => sum + (check.status === 'pass' ? 1 : check.status === 'warning' ? 0.5 : 0), 0) / checks.length * 100);
}
