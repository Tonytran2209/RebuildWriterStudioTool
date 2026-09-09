import type { AppConfig, WorkflowExecutionMode, WorkflowRuleId, WorkflowRuleSetting, WorkflowRuleSnapshot } from '../types';

export interface WorkflowParameterDefinition { id: string; label: string; labelVi: string; type: 'number' | 'boolean'; defaultValue: number | boolean; min?: number; max?: number; step?: number }
export interface WorkflowStageDefinition { id: string; title: string; titleVi: string; detail: string; detailVi: string; locked?: boolean; parameters?: WorkflowParameterDefinition[] }
export interface WorkflowRuleDefinition { id: WorkflowRuleId; title: string; titleVi: string; summary: string; summaryVi: string; steps: number[]; stages: WorkflowStageDefinition[] }

export const WORKFLOW_RULE_VERSION = 3;
export const DEFAULT_WORKFLOW_RULE_SETTING: WorkflowRuleSetting = { enforcement: 'strict', customInstruction: '', appliesTo: { manual: true, batch: true }, stageOverrides: {}, version: WORKFLOW_RULE_VERSION };

export const WORKFLOW_RULE_DEFINITIONS: WorkflowRuleDefinition[] = [
  { id: 'source-grounding', title: 'Source retrieval & grounding', titleVi: 'Truy xuất và đối chứng nguồn', summary: 'Controls how Content Plan, Knowledge Base and reference guides become model context.', summaryVi: 'Quy định cách Content Plan, Knowledge Base và guide tham khảo được đưa vào context.', steps: [2,3,4], stages: [
    { id:'topic-authority', title:'Topic authority', titleVi:'Nguồn topic', detail:'Use only the topic classified from the current Content Plan activity.', detailVi:'Chỉ lấy topic đã phân loại từ Content Plan của activity hiện tại.', locked:true },
    { id:'focused-retrieval', title:'Focused retrieval', titleVi:'Truy xuất tập trung', detail:'Select relevant KB sections using topic, angle, headings and keywords.', detailVi:'Chọn đoạn KB liên quan theo topic, angle, heading và keyword.' },
    { id:'evidence-boundary', title:'Evidence boundary', titleVi:'Ranh giới evidence', detail:'Do not invent facts. Preserve evidence quotes, but never expose internal filenames unless approved for external use.', detailVi:'Không bịa dữ kiện. Giữ quote evidence nhưng không lộ tên file nội bộ nếu chưa được duyệt.', locked:true },
  ]},
  { id:'core-idea', title:'Article Spec & SEO direction', titleVi:'Article Spec và định hướng SEO', summary:'Builds the canonical Article Spec, audits search demand, and proposes the allowed content direction.', summaryVi:'Tạo Article Spec chuẩn, đối chứng nhu cầu tìm kiếm và đề xuất định hướng nội dung phù hợp.', steps:[2], stages:[
    { id:'market-research', title:'Market research', titleVi:'Nghiên cứu thị trường', detail:'Collect a sourced keyword set through OpenAI Web Search.', detailVi:'Thu thập bộ keyword có URL nguồn bằng OpenAI Web Search.', parameters:[{id:'keywordCount',label:'Keyword count',labelVi:'Số keyword',type:'number',defaultValue:10,min:5,max:20,step:1}] },
    { id:'keyword-audit', title:'Keyword audit', titleVi:'Đối chứng keyword', detail:'Accept or reject every keyword against the current plan and internal knowledge.', detailVi:'Chấp nhận hoặc loại từng keyword theo content plan và knowledge nội bộ.' },
    { id:'article-spec', title:'Article Spec contract', titleVi:'Hợp đồng Article Spec', detail:'Create one canonical contract for intent, reader outcome, must-cover topics, thesis, evidence, CTA and internal-link requirements.', detailVi:'Tạo contract chuẩn cho intent, reader outcome, nội dung bắt buộc, thesis, evidence, CTA và internal link.', locked:true },
    { id:'idea-generation', title:'Idea generation', titleVi:'Tạo ý tưởng', detail:'Generate distinct ideas and score SEO, audience fit, support and uniqueness.', detailVi:'Tạo các ý tưởng khác nhau và chấm SEO, audience fit, support, uniqueness.', parameters:[{id:'ideaCount',label:'Idea count',labelVi:'Số Core Idea',type:'number',defaultValue:3,min:1,max:6,step:1}] },
  ]},
  { id:'outline', title:'Evidence-backed outline', titleVi:'Outline có dẫn chứng', summary:'Transforms the selected idea into a validated heading and evidence structure.', summaryVi:'Chuyển core idea thành cấu trúc heading và evidence đã kiểm chứng.', steps:[3], stages:[
    { id:'structured-handoff', title:'Structured handoff', titleVi:'Nhận dữ liệu có cấu trúc', detail:'Lock the selected title, angle, audience, tone and accepted keywords.', detailVi:'Khóa title, angle, audience, tone và keyword đã chấp nhận.', locked:true },
    { id:'outline-mapping', title:'Outline mapping', titleVi:'Lập outline', detail:'Create ordered H2/H3 sections with search intent, keyword mapping and rationale.', detailVi:'Tạo H2/H3 theo thứ tự với intent, keyword mapping và rationale.', parameters:[{id:'minimumSections',label:'Minimum sections',labelVi:'Section tối thiểu',type:'number',defaultValue:4,min:4,max:12,step:1}] },
    { id:'evidence-registry', title:'Evidence registry', titleVi:'Evidence registry', detail:'Reuse verified quotes by ID and reject unsupported references.', detailVi:'Tái sử dụng quote theo ID và loại reference không hợp lệ.', locked:true },
  ]},
  { id:'draft', title:'Single-pass draft generation', titleVi:'Tạo draft một lần', summary:'Controls section budgets, structured output and deterministic draft assembly.', summaryVi:'Kiểm soát word budget, structured output và ghép draft.', steps:[4], stages:[
    { id:'word-allocation', title:'Word allocation', titleVi:'Phân bổ số từ', detail:'Allocate the English-word limit across introduction, sections and conclusion.', detailVi:'Chia giới hạn từ cho introduction, sections và conclusion.', parameters:[{id:'introductionPercent',label:'Introduction %',labelVi:'Introduction %',type:'number',defaultValue:8,min:5,max:15,step:1},{id:'conclusionPercent',label:'Conclusion %',labelVi:'Conclusion %',type:'number',defaultValue:7,min:5,max:12,step:1}] },
    { id:'outline-fidelity', title:'Outline fidelity', titleVi:'Bám sát outline', detail:'Keep every heading in order and do not add unplanned sections.', detailVi:'Giữ heading đúng thứ tự và không thêm section ngoài outline.', locked:true },
    { id:'structured-assembly', title:'Structured assembly', titleVi:'Ghép bài có cấu trúc', detail:'Return one JSON payload; the app assembles the final article.', detailVi:'Trả một JSON; ứng dụng tự ghép bài.', parameters:[{id:'maxSentencesPerParagraph',label:'Max sentences/paragraph',labelVi:'Câu tối đa/đoạn',type:'number',defaultValue:5,min:2,max:7,step:1}] },
  ]},
  { id:'quality-persistence', title:'Quality gate, cache & persistence', titleVi:'Quality gate, cache và lưu trữ', summary:'Defines the non-negotiable output contract and when a result may be saved.', summaryVi:'Quy định output contract và điều kiện được phép lưu.', steps:[2,3,4], stages:[
    { id:'canonical-language', title:'Canonical language', titleVi:'Ngôn ngữ chuẩn', detail:'Generate semantic content in English; translate labels only in the UI.', detailVi:'Generate bằng tiếng Anh; chỉ dịch label tại UI.', locked:true },
    { id:'validation-gate', title:'Universal Quality Gate', titleVi:'Universal Quality Gate', detail:'Require deterministic structure, word, coverage, confidentiality and link checks plus semantic intent, reader-outcome, evidence and brand-POV review.', detailVi:'Yêu cầu kiểm tra cấu trúc, word, coverage, bảo mật, link và review semantic về intent, outcome, evidence, brand POV.', locked:true },
    { id:'editorial-approval', title:'Editorial approval', titleVi:'Phê duyệt Editorial', detail:'Editorial / Originality must receive explicit human outline approval before drafting; Standard / Scalable may continue automatically.', detailVi:'Editorial / Originality phải được duyệt outline trước draft; Standard / Scalable có thể tự động chạy tiếp.', locked:true },
    { id:'controlled-persistence', title:'Controlled persistence', titleVi:'Lưu có kiểm soát', detail:'Reuse matching cache and save accepted results plus audit traces to Supabase.', detailVi:'Dùng cache phù hợp và lưu kết quả cùng audit trace vào Supabase.', locked:true },
  ]},
];

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
    return [{ id:rule.id,enforcement:setting.enforcement,stages:rule.stages.map(stage=>getStageEffective(rule,setting,stage)),customInstruction:setting.customInstruction.trim() }];
  });
  const render=(rule:typeof rules[number])=>[`- [${rule.id}]`,...rule.stages.map(stage=>`  • ${stage.id}: ${stage.instruction}${Object.keys(stage.parameters).length?` Parameters=${JSON.stringify(stage.parameters)}`:''}`),...(rule.customInstruction?[`  • User instruction: ${rule.customInstruction}`]:[])].join('\n');
  const strict=rules.filter(rule=>rule.enforcement==='strict'); const guided=rules.filter(rule=>rule.enforcement==='guided');
  const payload=JSON.stringify({version:WORKFLOW_RULE_VERSION,stepNumber,executionMode,rules});
  const fingerprint=`wr-${WORKFLOW_RULE_VERSION}-${stableHash(payload)}`;
  const snapshot:WorkflowRuleSnapshot={version:WORKFLOW_RULE_VERSION,executionMode,stepNumber,fingerprint,capturedAt:new Date().toISOString(),rules};
  return { systemPrompt:strict.length?`STRICT WORKFLOW RULES (MUST):\n${strict.map(render).join('\n')}`:'', taskGuidance:guided.length?`GUIDED WORKFLOW RULES (SHOULD):\n${guided.map(render).join('\n')}`:'', fingerprint, snapshot, rules };
}

export function buildWorkflowRulePrompt(config:AppConfig,stepNumber:number){ return compileWorkflowRules(config,stepNumber,'manual').systemPrompt; }
export function buildWorkflowRuleGuidance(config:AppConfig,stepNumber:number){ return compileWorkflowRules(config,stepNumber,'manual').taskGuidance; }
export function getWorkflowParameter(config:AppConfig,ruleId:WorkflowRuleId,stageId:string,parameterId:string){
  const rule=WORKFLOW_RULE_DEFINITIONS.find(item=>item.id===ruleId); const stage=rule?.stages.find(item=>item.id===stageId); const setting=rule?getWorkflowRuleSetting(config,ruleId):null;
  const effective=rule&&stage&&setting?getStageEffective(rule,setting,stage):null;
  return effective?.parameters[parameterId];
}
