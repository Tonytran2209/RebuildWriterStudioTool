import { OUTLINE_OPERATIONAL_STAGES } from '../shared/outlineStructures.ts';
import { primaryPlaybookId } from '../shared/gateDocuments.ts';
type Mode='manual'|'batch';
const VERSION=5;
// Platform contract only: how the app runs. How to write (criteria, structure, lengths, tone) lives in each Gate's Playbook/Standards files.
const DEFINITIONS:Record<string,{steps:number[];stages:Array<{id:string;instruction:string;parameters?:Record<string,number|boolean>}>}>={
  'source-grounding':{steps:[2,3,4],stages:[{id:'topic-authority',instruction:'Use only the topic classified from the current Content Plan activity.'},{id:'focused-retrieval',instruction:'Select relevant KB sections using topic, angle, headings and keywords.'},{id:'evidence-boundary',instruction:'Do not invent facts. Preserve evidence quotes, but never expose internal filenames unless approved for external use.'}]},
  'core-idea':{steps:[2],stages:[{id:'market-research',instruction:'Use only the keyword list the app collected through web search.'},{id:'keyword-audit',instruction:'Accept or reject every supplied keyword; the criteria come from the Gate Playbook and Standards.'},{id:'article-spec',instruction:'Return the Article Spec fields the JSON schema requires; what goes into them follows the Gate Playbook.'},{id:'idea-generation',instruction:'Return the requested number of distinct ideas; scoring and selection criteria come from the Gate Playbook.'}]},
  outline:{steps:[3],stages:OUTLINE_OPERATIONAL_STAGES},
  draft:{steps:[4],stages:[{id:'word-allocation',instruction:'Follow the WORD BUDGET CONTRACT in the task; its numbers come from the Gate Playbook.'},{id:'outline-fidelity',instruction:'Keep every heading in order and do not add unplanned sections.'},{id:'structured-assembly',instruction:'Return one JSON payload; the app assembles the final article.'}]},
  'quality-persistence':{steps:[2,3,4],stages:[{id:'canonical-language',instruction:'Generate semantic content in English; translate labels only in the UI.'},{id:'validation-gate',instruction:'Require deterministic structure, word, coverage, confidentiality and link checks plus semantic intent, reader-outcome, evidence and brand-POV review.'},{id:'editorial-approval',instruction:'Editorial / Originality must receive explicit human outline approval before drafting; Standard / Scalable may continue automatically.'},{id:'controlled-persistence',instruction:'Reuse matching cache and save accepted results plus audit traces to Supabase.'}]},
};

export function compileBackendWorkflowRules(config:any,stepNumber:number,executionMode:Mode){
  const rules=Object.entries(DEFINITIONS).flatMap(([id,definition])=>{
    if(!definition.steps.includes(stepNumber))return [];
    const saved=config?.workflowRules?.[id]??{};
    const hardContract=id==='quality-persistence';
    const applies=hardContract?{manual:true,batch:true}:{manual:true,batch:true,...saved.appliesTo};
    if(!applies[executionMode])return [];
    const stages=definition.stages.map(stage=>{const override=saved.stageOverrides?.[stage.id]??{};return{id:stage.id,instruction:String(override.instruction??'').trim()||stage.instruction,parameters:{...(stage.parameters??{}),...(override.parameters??{})}}});
    // A Gate with a primary Playbook takes the team's instructions from that file, not from the Settings note.
    const customInstruction=primaryPlaybookId(config,stepNumber)?'':String(saved.customInstruction??'').trim();
    return[{id,enforcement:hardContract?'strict':saved.enforcement==='guided'?'guided':'strict',stages,customInstruction}];
  });
  const render=(rule:any)=>[`- [${rule.id}]`,...rule.stages.map((stage:any)=>`  • ${stage.id}: ${stage.instruction}`),...(rule.customInstruction?[`  • User instruction: ${rule.customInstruction}`]:[])].join('\n');
  const strict=rules.filter(rule=>rule.enforcement==='strict'); const guided=rules.filter(rule=>rule.enforcement==='guided');
  const payload=JSON.stringify({version:VERSION,stepNumber,executionMode,rules});
  let hash=2166136261; for(let index=0;index<payload.length;index+=1){hash^=payload.charCodeAt(index);hash=Math.imul(hash,16777619);}
  const fingerprint=`wr-${VERSION}-${(hash>>>0).toString(16)}`;
  return{systemPrompt:strict.length?`PLATFORM CONTRACT (MUST; overrides every document):\n${strict.map(render).join('\n')}`:'',taskGuidance:guided.length?`GUIDED WORKFLOW RULES (SHOULD):\n${guided.map(render).join('\n')}`:'',fingerprint,snapshot:{version:VERSION,executionMode,stepNumber,fingerprint,capturedAt:new Date().toISOString(),rules}};
}
