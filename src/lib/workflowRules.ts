import { OUTLINE_OPERATIONAL_STAGES } from '../../shared/outlineStructures';
import { primaryPlaybookId } from '../../shared/gateDocuments';
import type { AppConfig, WorkflowExecutionMode, WorkflowRuleId, WorkflowRuleSetting, WorkflowRuleSnapshot } from '../types';

export interface WorkflowParameterDefinition { id: string; label: string; labelVi: string; type: 'number' | 'boolean'; defaultValue: number | boolean; min?: number; max?: number; step?: number }
export interface WorkflowStageDefinition { id: string; title: string; titleVi: string; detail: string; detailVi: string; locked?: boolean; parameters?: WorkflowParameterDefinition[] }
export interface WorkflowRuleDefinition { id: WorkflowRuleId; title: string; titleVi: string; summary: string; summaryVi: string; steps: number[]; stages: WorkflowStageDefinition[] }

export const WORKFLOW_RULE_VERSION = 5;
export const DEFAULT_WORKFLOW_RULE_SETTING: WorkflowRuleSetting = { enforcement: 'strict', customInstruction: '', appliesTo: { manual: true, batch: true }, stageOverrides: {}, version: WORKFLOW_RULE_VERSION };

export const WORKFLOW_RULE_DEFINITIONS: WorkflowRuleDefinition[] = [
  { id: 'source-grounding', title: 'Source retrieval & grounding', titleVi: 'Truy xuất và đối chứng nguồn', summary: 'Controls how Content Plan, Knowledge Base and reference guides become model context.', summaryVi: 'Quy định cách Content Plan, Knowledge Base và guide tham khảo được đưa vào context.', steps: [2,3,4], stages: [
    { id:'topic-authority', title:'Topic authority', titleVi:'Nguồn topic', detail:'Use only the topic classified from the current Content Plan activity.', detailVi:'Chỉ lấy topic đã phân loại từ Content Plan của activity hiện tại.', locked:true },
    { id:'focused-retrieval', title:'Focused retrieval', titleVi:'Truy xuất tập trung', detail:'Select relevant KB sections using topic, angle, headings and keywords.', detailVi:'Chọn đoạn KB liên quan theo topic, angle, heading và keyword.' },
    { id:'evidence-boundary', title:'Evidence boundary', titleVi:'Ranh giới evidence', detail:'Do not invent facts. Preserve evidence quotes, but never expose internal filenames unless approved for external use.', detailVi:'Không bịa dữ kiện. Giữ quote evidence nhưng không lộ tên file nội bộ nếu chưa được duyệt.', locked:true },
  ]},
  { id:'core-idea', title:'Article Spec & SEO direction', titleVi:'Article Spec và định hướng SEO', summary:'Builds the canonical Article Spec, audits search demand, and proposes the allowed content direction.', summaryVi:'Tạo Article Spec chuẩn, đối chứng nhu cầu tìm kiếm và đề xuất định hướng nội dung phù hợp.', steps:[2], stages:[
    { id:'market-research', title:'Market research', titleVi:'Nghiên cứu thị trường', detail:'Use only the keyword list the app collected through web search.', detailVi:'Chỉ dùng danh sách keyword ứng dụng đã tra trên web.' },
    { id:'keyword-audit', title:'Keyword audit', titleVi:'Đối chứng keyword', detail:'Accept or reject every supplied keyword; the criteria come from the Gate Playbook and Standards.', detailVi:'Chấp nhận hoặc loại từng keyword; tiêu chí lấy từ Playbook và Standards của Gate.' },
    { id:'article-spec', title:'Article Spec contract', titleVi:'Hợp đồng Article Spec', detail:'Return the Article Spec fields the JSON schema requires; what goes into them follows the Gate Playbook.', detailVi:'Trả các trường Article Spec theo JSON schema; nội dung theo Playbook của Gate.', locked:true },
    { id:'idea-generation', title:'Idea generation', titleVi:'Tạo ý tưởng', detail:'Return the requested number of distinct ideas; scoring and selection criteria come from the Gate Playbook.', detailVi:'Trả đúng số ý tưởng; tiêu chí chấm và chọn lấy từ Playbook của Gate.' },
  ]},
  { id:'outline', title:'Evidence-backed outline', titleVi:'Outline có dẫn chứng', summary:'Transforms the selected idea into a validated heading and evidence structure.', summaryVi:'Chuyển core idea thành cấu trúc heading và evidence đã kiểm chứng.', steps:[3], stages:[
    { id:'structured-handoff', title:'Structured handoff', titleVi:'Nhận dữ liệu có cấu trúc', detail:'Lock the selected title, angle, audience, tone and accepted keywords.', detailVi:'Khóa title, angle, audience, tone và keyword đã chấp nhận.', locked:true },
    { id:'outline-mapping', title:'Outline mapping', titleVi:'Lập outline', detail:'Return ordered H2/H3 sections in the JSON schema.', detailVi:'Trả H2/H3 theo thứ tự trong JSON schema.' },
    { id:'evidence-registry', title:'Evidence registry', titleVi:'Evidence registry', detail:'Reuse verified quotes by ID and reject unsupported references.', detailVi:'Tái sử dụng quote theo ID và loại reference không hợp lệ.', locked:true },
  ]},
  { id:'draft', title:'Single-pass draft generation', titleVi:'Tạo draft một lần', summary:'Controls section budgets, structured output and deterministic draft assembly.', summaryVi:'Kiểm soát word budget, structured output và ghép draft.', steps:[4], stages:[
    { id:'word-allocation', title:'Word allocation', titleVi:'Phân bổ số từ', detail:'Follow the WORD BUDGET CONTRACT in the task; its numbers come from the Gate Playbook.', detailVi:'Theo WORD BUDGET CONTRACT; các con số lấy từ Playbook của Gate.' },
    { id:'outline-fidelity', title:'Outline fidelity', titleVi:'Bám sát outline', detail:'Keep every heading in order and do not add unplanned sections.', detailVi:'Giữ heading đúng thứ tự và không thêm section ngoài outline.', locked:true },
    { id:'structured-assembly', title:'Structured assembly', titleVi:'Ghép bài có cấu trúc', detail:'Return one JSON payload; the app assembles the final article.', detailVi:'Trả một JSON; ứng dụng tự ghép bài.' },
  ]},
  { id:'quality-persistence', title:'Quality gate, cache & persistence', titleVi:'Quality gate, cache và lưu trữ', summary:'Defines the non-negotiable output contract and when a result may be saved.', summaryVi:'Quy định output contract và điều kiện được phép lưu.', steps:[2,3,4], stages:[
    { id:'canonical-language', title:'Canonical language', titleVi:'Ngôn ngữ chuẩn', detail:'Generate semantic content in English; translate labels only in the UI.', detailVi:'Generate bằng tiếng Anh; chỉ dịch label tại UI.', locked:true },
    { id:'validation-gate', title:'Universal Quality Gate', titleVi:'Universal Quality Gate', detail:'Require deterministic structure, word, coverage, confidentiality and link checks plus semantic intent, reader-outcome, evidence and brand-POV review.', detailVi:'Yêu cầu kiểm tra cấu trúc, word, coverage, bảo mật, link và review semantic về intent, outcome, evidence, brand POV.', locked:true },
    { id:'editorial-approval', title:'Editorial approval', titleVi:'Phê duyệt Editorial', detail:'Editorial / Originality must receive explicit human outline approval before drafting; Standard / Scalable may continue automatically.', detailVi:'Editorial / Originality phải được duyệt outline trước draft; Standard / Scalable có thể tự động chạy tiếp.', locked:true },
    { id:'controlled-persistence', title:'Controlled persistence', titleVi:'Lưu có kiểm soát', detail:'Reuse matching cache and save accepted results plus audit traces to Supabase.', detailVi:'Dùng cache phù hợp và lưu kết quả cùng audit trace vào Supabase.', locked:true },
  ]},
];

for (const stage of WORKFLOW_RULE_DEFINITIONS.find(rule => rule.id === 'outline')!.stages) {
  const shared = OUTLINE_OPERATIONAL_STAGES.find(item => item.id === stage.id);
  if (shared) stage.detail = shared.instruction;
}

export function getWorkflowRuleSetting(config: AppConfig, id: WorkflowRuleId): WorkflowRuleSetting {
  const saved = config.workflowRules?.[id];
  const setting = { ...DEFAULT_WORKFLOW_RULE_SETTING, ...saved, appliesTo:{...DEFAULT_WORKFLOW_RULE_SETTING.appliesTo,...saved?.appliesTo}, stageOverrides:saved?.stageOverrides ?? {} };
  // The quality gate is a product invariant, not optional prompt guidance.
  // Always expose and compile it as strict for both execution paths, including
  // older saved configurations that predate the four-phase contract.
  if (id === 'quality-persistence') return { ...setting, enforcement:'strict', appliesTo:{ manual:true, batch:true } };
  return setting;
}

export function getStageEffective(rule: WorkflowRuleDefinition, setting: WorkflowRuleSetting, stage: WorkflowStageDefinition) {
  const override = setting.stageOverrides[stage.id] ?? {};
  const parameters = Object.fromEntries((stage.parameters ?? []).map(parameter => [parameter.id, override.parameters?.[parameter.id] ?? parameter.defaultValue]));
  return { id:stage.id, instruction:override.instruction?.trim() || stage.detail, parameters };
}

function stableHash(value:string){ let hash=2166136261; for(let i=0;i<value.length;i+=1){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);} return (hash>>>0).toString(16); }

export function compileWorkflowRules(config: AppConfig, stepNumber: number, executionMode: WorkflowExecutionMode) {
  const rules = WORKFLOW_RULE_DEFINITIONS.flatMap(rule => {
    if (!rule.steps.includes(stepNumber)) return [];
    const setting=getWorkflowRuleSetting(config,rule.id);
    if (!setting.appliesTo[executionMode]) return [];
    // Same as the backend: a Gate with a primary Playbook takes team instructions from that file.
    return [{ id:rule.id,enforcement:setting.enforcement,stages:rule.stages.map(stage=>getStageEffective(rule,setting,stage)),customInstruction:primaryPlaybookId(config,stepNumber)?'':setting.customInstruction.trim() }];
  });
  const render=(rule:typeof rules[number])=>[`- [${rule.id}]`,...rule.stages.map(stage=>`  • ${stage.id}: ${stage.instruction}`),...(rule.customInstruction?[`  • User instruction: ${rule.customInstruction}`]:[])].join('\n');
  const strict=rules.filter(rule=>rule.enforcement==='strict'); const guided=rules.filter(rule=>rule.enforcement==='guided');
  const payload=JSON.stringify({version:WORKFLOW_RULE_VERSION,stepNumber,executionMode,rules});
  const fingerprint=`wr-${WORKFLOW_RULE_VERSION}-${stableHash(payload)}`;
  const snapshot:WorkflowRuleSnapshot={version:WORKFLOW_RULE_VERSION,executionMode,stepNumber,fingerprint,capturedAt:new Date().toISOString(),rules};
  return { systemPrompt:strict.length?`PLATFORM CONTRACT (MUST; overrides every document):\n${strict.map(render).join('\n')}`:'', taskGuidance:guided.length?`GUIDED WORKFLOW RULES (SHOULD):\n${guided.map(render).join('\n')}`:'', fingerprint, snapshot, rules };
}

export function buildWorkflowRulePrompt(config:AppConfig,stepNumber:number){ return compileWorkflowRules(config,stepNumber,'manual').systemPrompt; }
export function buildWorkflowRuleGuidance(config:AppConfig,stepNumber:number){ return compileWorkflowRules(config,stepNumber,'manual').taskGuidance; }
