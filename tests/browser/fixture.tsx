import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import Step4Draft, {parseSemanticQuality, completeSemanticChecks, incompleteSemanticReviewChecks} from '../../src/components/workspace/Step4Draft';
import {normalizeArticleSpec,articleSpecFingerprint} from '../../src/lib/articleSpec';
import {INTRODUCTION_INSTRUCTION} from '../../src/lib/introductionPolicy';
import {LanguageProvider} from '../../src/lib/i18n';
import {DEFAULT_CONFIG,DEFAULT_MODELS} from '../../src/lib/defaultData';
import '../../src/index.css';import '../../src/codex-theme.css';
const original='# Browser fixture\n\n'+Array.from({length:9},(_,i)=>`Introduction line ${i+1} — unchanged source.`).join('\n')+'\n\n## Main body\nBODY_SENTINEL: This entire section remains visible.\n\n| Option | Benefit |\n| --- | --- |\n| **A — B** | [Details](https://example.com/details) |\n\n## Conclusion\nCONCLUSION_SENTINEL: Keep this section.';
const qcIds=['intent-satisfied','reader-outcome','intro-quality','keyword-naturalness','evidence-support','brand-pov'];
const qcStatus=new URLSearchParams(location.search).get('qc');
const flow=qcStatus==='generation'||qcStatus==='recheck';
const intro=Array(13).fill('Readers can compare practical choices carefully.').join(' ');
const sections=Array.from({length:3},(_,i)=>({id:'section-'+i,heading:'Practical guide '+i,level:'h2',content:Array(24).fill('Consider the available options and explain each useful practical decision.').join(' ')+` [More guidance](https://example.com/guide-${i})`,evidenceRefs:[]}));
const payload={title:'Fixture practical guide',introduction:intro,sections,conclusion:Array(6).fill('Choose useful steps and review your practical decisions carefully.').join(' ')};
const flowDraft='# '+payload.title+'\n\n'+intro+'\n\n'+sections.map(s=>'## '+s.heading+'\n\n'+s.content).join('\n\n')+'\n\n## Conclusion\n\n'+payload.conclusion;
const fixtureSpec=normalizeArticleSpec({primaryQuery:'fixture',mustCover:[]},{topic:'Browser fixture'});
const fixtureSpecFingerprint=articleSpecFingerprint(fixtureSpec);
let cacheHash=2166136261;
for(const char of [INTRODUCTION_INSTRUCTION,flowDraft,fixtureSpecFingerprint,JSON.stringify({}),JSON.stringify(sections)].join('\u0000')){cacheHash^=char.charCodeAt(0);cacheHash=Math.imul(cacheHash,16777619);}
const incompleteCacheFingerprint=`semantic-v1-${(cacheHash>>>0).toString(36)}`;
const flowConfig={...DEFAULT_CONFIG,stepConfigs:{...DEFAULT_CONFIG.stepConfigs,4:{...DEFAULT_CONFIG.stepConfigs[4],maxDraftWords:900}},websiteInventory:sections.map((_,i)=>({id:'link-'+i,title:'Practical guide '+i,url:`https://example.com/guide-${i}`,eligibleForInternalLink:true,status:'active'}))};
Object.assign(window,{qcFlow:{payload,flowDraft}});
const semanticChecks=qcStatus==='incomplete' ? incompleteSemanticReviewChecks('missing checks') : qcIds.map(id=>({id,label:id,kind:'semantic',status:qcStatus || 'pass',reason:'Fixture review finding',autoFixAllowed:false}));
Object.assign(window,{qcHarness:{parseSemanticQuality,completeSemanticChecks,incompleteSemanticReviewChecks}});
function Fixture(){
 const [article,setArticle]=useState<any>(()=>{const saved=qcStatus && sessionStorage.getItem('qc-fixture');return saved ? JSON.parse(saved) : {id:'browser-fixture',topic:'Browser fixture',draft:qcStatus==='generation'?'':flow?flowDraft:original,keywords:'fixture',tone:'professional',outline:[],currentStep:4,status:'draft',...(flow?{contentPlanId:'fixture-plan',contentPlanItemId:'fixture-item',contentPlanInput:'Practical fixture guide',contentType:'guide',selectedCoreIdeaId:'fixture-idea',coreIdeaSuggestions:[{id:'fixture-idea',primaryKeyword:'fixture'}],articleSpec:fixtureSpec,articleSpecFingerprint:fixtureSpecFingerprint,outline:sections,semanticReviewFingerprint:incompleteCacheFingerprint,draftEvidenceUsage:{}}:{}),...(qcStatus ? {qualityReport:{status:qcStatus,checks:semanticChecks},semanticReviewChecks:flow?incompleteSemanticReviewChecks('missing'):semanticChecks} : {})};});
 useEffect(()=>{if(qcStatus)sessionStorage.setItem('qc-fixture',JSON.stringify(article));},[article]);
 return <main>{qcStatus && <button onClick={()=>setArticle((a:any)=>({...a,articleSpecFingerprint:'changed-fixture-spec',keywords:'changed configuration'}))}>Change QC configuration</button>}<details><summary>Fixture source (local only)</summary><pre data-testid="stored-source">{article.draft}</pre></details><Step4Draft article={article} config={flow?flowConfig as any:DEFAULT_CONFIG} files={[]} model={DEFAULT_MODELS[0]} railwayUrl={flow?"http://127.0.0.1:4173":""} onUpdate={async p=>{if(flow){const history=JSON.parse(sessionStorage.getItem("qc-updates")||"[]");history.push(p);sessionStorage.setItem("qc-updates",JSON.stringify(history));}setArticle((a:any)=>{const next={...a,...p};if(qcStatus)sessionStorage.setItem('qc-fixture',JSON.stringify(next));return next;});return true;}} onPrev={()=>{}} onToggleComplete={()=>{}}/></main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture/></LanguageProvider>);
