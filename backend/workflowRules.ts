type Mode='manual'|'batch';
const VERSION=2;
const DEFINITIONS:Record<string,{steps:number[];stages:Array<{id:string;instruction:string;parameters?:Record<string,number|boolean>}>}>={
  'source-grounding':{steps:[2,3,4],stages:[{id:'topic-authority',instruction:'Use only the topic classified from the current Content Plan activity.'},{id:'focused-retrieval',instruction:'Select relevant KB sections using topic, angle, headings and keywords.'},{id:'evidence-boundary',instruction:'Do not invent facts; preserve source names and verbatim evidence quotes.'}]},
  'core-idea':{steps:[2],stages:[{id:'market-research',instruction:'Collect a sourced keyword set through OpenAI Web Search.',parameters:{keywordCount:10}},{id:'keyword-audit',instruction:'Accept or reject every keyword against the current plan and internal knowledge.'},{id:'idea-generation',instruction:'Generate distinct ideas and score SEO, audience fit, support and uniqueness.',parameters:{ideaCount:3}}]},
  outline:{steps:[3],stages:[{id:'structured-handoff',instruction:'Lock the selected title, angle, audience, tone and accepted keywords.'},{id:'outline-mapping',instruction:'Create ordered H2/H3 sections with search intent, keyword mapping and rationale.',parameters:{minimumSections:4}},{id:'evidence-registry',instruction:'Reuse verified quotes by ID and reject unsupported references.'}]},
  draft:{steps:[4],stages:[{id:'word-allocation',instruction:'Allocate the English-word limit across introduction, sections and conclusion.',parameters:{introductionPercent:8,conclusionPercent:7}},{id:'outline-fidelity',instruction:'Keep every heading in order and do not add unplanned sections.'},{id:'structured-assembly',instruction:'Return one JSON payload; the app assembles the final article.',parameters:{maxSentencesPerParagraph:5}}]},
  'quality-persistence':{steps:[2,3,4],stages:[{id:'canonical-language',instruction:'Generate semantic content in English; translate labels only in the UI.'},{id:'validation-gate',instruction:'Validate required fields and require the final SEO checklist to reach 100%.'},{id:'controlled-persistence',instruction:'Reuse matching cache and save accepted results plus audit traces to Supabase.'}]},
};

export function compileBackendWorkflowRules(config:any,stepNumber:number,executionMode:Mode){
  const rules=Object.entries(DEFINITIONS).flatMap(([id,definition])=>{
    if(!definition.steps.includes(stepNumber))return [];
    const saved=config?.workflowRules?.[id]??{}; const applies={manual:true,batch:true,...saved.appliesTo};
    if(!applies[executionMode])return [];
    const stages=definition.stages.map(stage=>{const override=saved.stageOverrides?.[stage.id]??{};return{id:stage.id,instruction:String(override.instruction??'').trim()||stage.instruction,parameters:{...(stage.parameters??{}),...(override.parameters??{})}}});
    return[{id,enforcement:saved.enforcement==='guided'?'guided':'strict',stages,customInstruction:String(saved.customInstruction??'').trim()}];
  });
  const render=(rule:any)=>[`- [${rule.id}]`,...rule.stages.map((stage:any)=>`  • ${stage.id}: ${stage.instruction}${Object.keys(stage.parameters).length?` Parameters=${JSON.stringify(stage.parameters)}`:''}`),...(rule.customInstruction?[`  • User instruction: ${rule.customInstruction}`]:[])].join('\n');
  const strict=rules.filter(rule=>rule.enforcement==='strict'); const guided=rules.filter(rule=>rule.enforcement==='guided');
  const payload=JSON.stringify({version:VERSION,stepNumber,executionMode,rules});
  let hash=2166136261; for(let index=0;index<payload.length;index+=1){hash^=payload.charCodeAt(index);hash=Math.imul(hash,16777619);}
  const fingerprint=`wr-${VERSION}-${(hash>>>0).toString(16)}`;
  return{systemPrompt:strict.length?`STRICT WORKFLOW RULES (MUST):\n${strict.map(render).join('\n')}`:'',taskGuidance:guided.length?`GUIDED WORKFLOW RULES (SHOULD):\n${guided.map(render).join('\n')}`:'',fingerprint,snapshot:{version:VERSION,executionMode,stepNumber,fingerprint,capturedAt:new Date().toISOString(),rules}};
}
