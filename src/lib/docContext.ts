import type { AppConfig, DocumentFile } from "../types";
import { isDocumentReady } from "./documentStatus";

export interface DocRef {
  id?: string;
  name: string;
  meta?: string;
  preview?: string;
  content?: string;
}

export interface DocBundle {
  knowledgeBase: DocRef[];
  contentPlan: DocRef[];
  rules: DocRef[];
  totalCount: number;
}

const ROLE_HIERARCHY = `
QUY TẮC PHÂN QUYỀN TÀI LIỆU (BẮT BUỘC TUÂN THỦ):

1) KNOWLEDGE BASE — Kiến thức nền tảng
   Là nguồn tri thức chuyên môn, tài liệu học thuật, thông tin sản phẩm, mẫu file.
   → Dùng để tra cứu, hiểu bối cảnh, đưa ra logic và lập luận có căn cứ.
   → KHÔNG được bịa dữ liệu ngoài phạm vi Knowledge Base khi nói về kiến thức chuyên môn.

2) CONTENT PLAN HIỆN TẠI — Nguồn chủ đề của activity
   Là dữ liệu đã được nạp, trích xuất và phân loại khi bắt đầu activity hiện tại.
   → Chỉ dùng để xác định topic, nhóm nội dung và keyword đã được tổng hợp cho bài này.
   → Không được đọc hoặc suy ra từ bất kỳ kế hoạch legacy nào ngoài activity hiện tại.

3) RULES & GUIDELINES — Chuẩn mực bắt buộc (ưu tiên cao nhất)
   Là quy tắc viết bài, writing pattern, writer rule, tone of voice, brand guidelines.
   → Mọi output PHẢI tuân thủ tuyệt đối các quy tắc này. Rules ghi đè phong cách mặc định.
   → Nếu Rules mâu thuẫn với KB hoặc Content Plan hiện tại, LUÔN ưu tiên Rules.

NGUYÊN TẮC CHUNG:
- Chỉ đề xuất / khẳng định những gì có căn cứ trong tài liệu được cấp.
- Khi trích dẫn hoặc dựa vào một tài liệu cụ thể, hãy nêu tên tài liệu đó.
- Nếu tài liệu không đủ để trả lời, nói rõ "Không đủ dữ liệu trong tài liệu được cấp" — không được suy đoán.
`.trim();

function formatFile(file: DocumentFile): DocRef {
  return {
    id: file.id,
    name: file.name,
    meta: `${file.fileType.toUpperCase()} · ${file.size}`,
    content: file.content?.trim(),
  };
}

export function collectStepDocs(
  _stepNumber: number,
  _config: AppConfig,
  files: DocumentFile[],
  contentPlanInput?: string,
): DocBundle {
  const knowledgeBase: DocRef[] = files
    .filter(f => f.category === 'kb')
    .filter(isDocumentReady)
    .map(formatFile);

  const contentPlan: DocRef[] = contentPlanInput?.trim() ? [{
    id: 'current-content-plan',
    name: 'Current activity Content Plan',
    meta: 'per-activity classified source',
    content: contentPlanInput.trim(),
  }] : [];

  const rules: DocRef[] = files
    .filter(f => f.category === 'rules')
    .filter(isDocumentReady)
    .map(formatFile);

  return {
    knowledgeBase,
    contentPlan,
    rules,
    totalCount: knowledgeBase.length + contentPlan.length + rules.length,
  };
}

function formatSection(title: string, role: string, docs: DocRef[]): string {
  if (!docs.length) return `\n[${title}] — ${role}\n(trống — không có tài liệu được cấp cho vai trò này)`;
  const lines = docs.map(d => {
    const base = `- ${d.name}${d.meta ? ` (${d.meta})` : ""}`;
    if (d.content) return `${base}\n  Nội dung đầy đủ:\n${d.content}`;
    return d.preview ? `${base}\n  Preview: ${d.preview}` : base;
  });
  return `\n[${title}] — ${role}\n${lines.join("\n")}`;
}

export function buildWorkflowSourceFingerprint(bundle: DocBundle): string {
  const source = [
    ...bundle.knowledgeBase.map(doc => ({ ...doc, role: "kb" })),
    ...bundle.contentPlan.map(doc => ({ ...doc, role: "content_plan" })),
    ...bundle.rules.map(doc => ({ ...doc, role: "rules" })),
  ]
    .map(doc => `${doc.role}\n${doc.name}\n${doc.meta ?? ""}\n${doc.content ?? doc.preview ?? ""}`)
    .sort()
    .join("\n---\n");
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `ap-${(hash >>> 0).toString(16)}-${source.length}`;
}

export function buildDocContextBlock(bundle: DocBundle): string {
  return [
    formatSection("KNOWLEDGE BASE", "kiến thức nền tảng để tra cứu và lập luận", bundle.knowledgeBase),
    formatSection("CURRENT CONTENT PLAN", "nguồn topic và phân loại của activity hiện tại", bundle.contentPlan),
    formatSection("RULES & GUIDELINES", "chuẩn mực bắt buộc cho output", bundle.rules),
  ].join("\n");
}

export function buildStepDocumentPromptRules(
  stepNumber: number,
  config: AppConfig,
  _files: DocumentFile[],
): string {
  const stepConfig = config.stepConfigs[stepNumber];
  if (!stepConfig) return "";
  const categoryLabels = { kb: "KNOWLEDGE BASE", rules: "SKILLS & RULES" } as const;
  const lines = (['kb', 'rules'] as const).flatMap(category => {
    const current = stepConfig.categoryPromptRules?.[category]?.trim();
    const legacy = Object.values(stepConfig.documentPromptRules?.[category] ?? {})
      .map(rule => rule.trim()).filter(Boolean)
      .filter((rule, index, rules) => rules.indexOf(rule) === index).join("\n\n");
    const rule = current || legacy;
    return rule ? [`- [${categoryLabels[category]}]: ${rule}`] : [];
  });
  if (!lines.length) return "";
  return [
    "QUY TẮC ĐỌC THEO PHÂN VÙNG TÀI LIỆU (BẮT BUỘC):",
    "Áp dụng rule cho toàn bộ tài liệu thuộc đúng phân vùng tương ứng.",
    ...lines,
  ].join("\n");
}

export function buildRoleSystemPrompt(taskInstruction: string, documentPromptRules = ""): string {
  return [
    ROLE_HIERARCHY,
    documentPromptRules,
    `NHIỆM VỤ CỦA BẠN:\n${taskInstruction}`,
    [
      "CANONICAL OUTPUT CONTRACT (HIGHEST PRIORITY):",
      "- Produce all generated semantic content in English, regardless of the UI language or the language used in these instructions.",
      "- This includes titles, descriptions, rationales, reasons, notes, recommendations, headings, summaries, audience/tone descriptions, and the final article.",
      "- Preserve only proper nouns, file names, URLs, source-defined identifiers/taxonomy values, SEO keywords, and verbatim evidence quotes in their original language.",
      "- A document-level prompting rule may control style and terminology, but it must not change the canonical output language away from English.",
    ].join("\n"),
  ].filter(Boolean).join("\n\n");
}

export function describeBundle(bundle: DocBundle): string {
  const parts = [
    `${bundle.knowledgeBase.length} KB`,
    `${bundle.contentPlan.length} Content Plan`,
    `${bundle.rules.length} Rules`,
  ];
  return parts.join(" · ");
}
