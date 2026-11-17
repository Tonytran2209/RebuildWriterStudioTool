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

export const QC_GROUPS = [
  { key: 'structure', vi: 'Cấu trúc & độ dài', en: 'Structure & length' },
  { key: 'seo', vi: 'SEO & liên kết', en: 'SEO & links' },
  { key: 'content', vi: 'Nội dung & dẫn chứng', en: 'Content & evidence' },
  { key: 'checklist', vi: 'SEO checklist', en: 'SEO checklist' },
] as const;
export function qcGroupOf(id: string): typeof QC_GROUPS[number]['key'] {
  if (id === 'checklist-compliance') return 'checklist';
  if (['introduction-word-budget', 'outline-structure', 'outline-fidelity', 'complete-structure', 'duplicate-headings', 'word-budget', 'single-conclusion', 'placeholders', 'conclusion-word-budget'].includes(id)) return 'structure';
  if (['primary-query', 'title-keyword', 'keyword-naturalness', 'must-cover', 'intent-satisfied', 'link-correctness'].includes(id) || id.startsWith('internal-link')) return 'seo';
  return 'content';
}
