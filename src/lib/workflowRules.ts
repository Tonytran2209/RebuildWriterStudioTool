import type { AppConfig, WorkflowRuleId, WorkflowRuleSetting } from '../types';

export interface WorkflowRuleDefinition {
  id: WorkflowRuleId;
  title: string;
  titleVi: string;
  summary: string;
  summaryVi: string;
  steps: number[];
  stages: Array<{ title: string; titleVi: string; detail: string; detailVi: string }>;
}

export const DEFAULT_WORKFLOW_RULE_SETTING: WorkflowRuleSetting = {
  enforcement: 'strict',
  customInstruction: '',
};

export const WORKFLOW_RULE_DEFINITIONS: WorkflowRuleDefinition[] = [
  {
    id: 'source-grounding', title: 'Source retrieval & grounding', titleVi: 'Truy xuất và đối chứng nguồn',
    summary: 'Controls how Content Plan, Knowledge Base and reference guides become model context.',
    summaryVi: 'Quy định cách Content Plan, Knowledge Base và guide tham khảo được đưa vào context.', steps: [2, 3, 4],
    stages: [
      { title: 'Topic authority', titleVi: 'Nguồn topic', detail: 'Use only the topic classified from the current Content Plan activity.', detailVi: 'Chỉ lấy topic đã phân loại từ Content Plan của activity hiện tại.' },
      { title: 'Focused retrieval', titleVi: 'Truy xuất tập trung', detail: 'Railway selects relevant KB sections using topic, angle, headings and keywords.', detailVi: 'Railway chọn đoạn KB liên quan theo topic, angle, heading và keyword.' },
      { title: 'Evidence boundary', titleVi: 'Ranh giới evidence', detail: 'Do not invent facts; preserve source names and verbatim evidence quotes.', detailVi: 'Không bịa dữ kiện; giữ đúng tên nguồn và quote nguyên văn.' },
    ],
  },
  {
    id: 'core-idea', title: 'Core Idea & SEO research', titleVi: 'Core Idea và nghiên cứu SEO',
    summary: 'The real Step 1 pipeline that researches, audits and ranks content angles.',
    summaryVi: 'Pipeline Bước 1 thực tế để research, đối chứng và chấm điểm góc nội dung.', steps: [2],
    stages: [
      { title: 'Market research', titleVi: 'Nghiên cứu thị trường', detail: 'OpenAI Web Search collects a sourced Top 10 keyword set for the configured market.', detailVi: 'OpenAI Web Search thu thập Top 10 keyword có URL nguồn theo thị trường.' },
      { title: 'Keyword audit', titleVi: 'Đối chứng keyword', detail: 'Every keyword is accepted or rejected against the current plan and internal knowledge.', detailVi: 'Mỗi keyword được chấp nhận hoặc loại dựa trên content plan và knowledge nội bộ.' },
      { title: 'Idea generation', titleVi: 'Tạo ý tưởng', detail: 'Generate exactly three distinct ideas, then score SEO, audience fit, support and uniqueness.', detailVi: 'Tạo đúng ba ý tưởng khác nhau rồi chấm SEO, audience fit, support và uniqueness.' },
    ],
  },
  {
    id: 'outline', title: 'Evidence-backed outline', titleVi: 'Outline có dẫn chứng',
    summary: 'Transforms the selected idea into a validated heading and evidence structure.',
    summaryVi: 'Chuyển core idea đã chọn thành cấu trúc heading và evidence đã kiểm chứng.', steps: [3],
    stages: [
      { title: 'Structured handoff', titleVi: 'Nhận dữ liệu có cấu trúc', detail: 'Lock the selected title, angle, audience, tone and accepted keywords.', detailVi: 'Khóa title, angle, audience, tone và keyword đã được chấp nhận.' },
      { title: 'Outline mapping', titleVi: 'Lập outline', detail: 'Create ordered H2/H3 sections with search intent, keyword mapping and rationale.', detailVi: 'Tạo H2/H3 theo thứ tự với search intent, keyword mapping và rationale.' },
      { title: 'Evidence registry', titleVi: 'Evidence registry', detail: 'Reuse verified quotes by ID and reject unsupported or mismatched references.', detailVi: 'Tái sử dụng quote đã xác minh theo ID và loại reference không hợp lệ.' },
    ],
  },
  {
    id: 'draft', title: 'Single-pass draft generation', titleVi: 'Tạo draft một lần',
    summary: 'Controls section budgets, structured output and deterministic draft assembly.',
    summaryVi: 'Kiểm soát word budget theo section, structured output và ghép draft ổn định.', steps: [4],
    stages: [
      { title: 'Word allocation', titleVi: 'Phân bổ số từ', detail: 'Allocate the configured English-word limit across introduction, every outline section and conclusion.', detailVi: 'Chia giới hạn từ tiếng Anh cho introduction, từng section và conclusion.' },
      { title: 'Outline fidelity', titleVi: 'Bám sát outline', detail: 'Keep every heading in order, complete all sections first and do not add unplanned sections.', detailVi: 'Giữ mọi heading đúng thứ tự, hoàn thiện tất cả mục và không thêm section ngoài outline.' },
      { title: 'Structured assembly', titleVi: 'Ghép bài có cấu trúc', detail: 'Return one JSON payload; the application assembles and formats the final article without another AI call.', detailVi: 'Trả một JSON; ứng dụng tự ghép và format bài mà không gọi AI lần nữa.' },
    ],
  },
  {
    id: 'quality-persistence', title: 'Quality gate, cache & persistence', titleVi: 'Quality gate, cache và lưu trữ',
    summary: 'Defines the non-negotiable output contract and when a result may be saved.',
    summaryVi: 'Quy định output contract bắt buộc và điều kiện kết quả được phép lưu.', steps: [2, 3, 4],
    stages: [
      { title: 'Canonical language', titleVi: 'Ngôn ngữ chuẩn', detail: 'Generate semantic content in English; translate labels only in the UI layer.', detailVi: 'Generate nội dung bằng tiếng Anh; chỉ dịch label tại tầng UI.' },
      { title: 'Validation gate', titleVi: 'Cổng kiểm tra', detail: 'Parse structured output, validate required fields and require the final SEO checklist to reach 100%.', detailVi: 'Parse structured output, kiểm tra field và yêu cầu SEO checklist cuối đạt 100%.' },
      { title: 'Controlled persistence', titleVi: 'Lưu có kiểm soát', detail: 'Reuse matching cache snapshots and save accepted results plus audit traces to Supabase.', detailVi: 'Tái sử dụng cache phù hợp và lưu kết quả đạt chuẩn cùng audit trace vào Supabase.' },
    ],
  },
];

export function getWorkflowRuleSetting(config: AppConfig, id: WorkflowRuleId): WorkflowRuleSetting {
  return { ...DEFAULT_WORKFLOW_RULE_SETTING, ...config.workflowRules?.[id] };
}

export function buildWorkflowRulePrompt(config: AppConfig, stepNumber: number): string {
  const rules = WORKFLOW_RULE_DEFINITIONS.filter(rule => rule.steps.includes(stepNumber));
  if (!rules.length) return '';
  return [
    'WORKFLOW RULE REGISTRY (USER-CONFIGURED APPLICATION):',
    ...rules.flatMap(rule => {
      const setting = getWorkflowRuleSetting(config, rule.id);
      return [
        `- [${rule.title}] enforcement=${setting.enforcement}`,
        ...rule.stages.map(stage => `  • ${stage.title}: ${stage.detail}`),
        ...(setting.customInstruction.trim() ? [`  • User application instruction: ${setting.customInstruction.trim()}`] : []),
      ];
    }),
  ].join('\n');
}
