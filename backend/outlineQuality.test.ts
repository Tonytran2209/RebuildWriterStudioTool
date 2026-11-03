import test from 'node:test';
import assert from 'node:assert/strict';
import { outlineQualityChecks, outlineReviewInstruction } from '../src/lib/outlineQuality.ts';
import { qualityInputFingerprint, semanticReviewInputFingerprint, SEMANTIC_IDS, semanticReviewIncomplete, qualityAllowsCompletion } from '../src/lib/qualityPolicy.ts';
import { introductionCheck } from '../src/lib/introductionPolicy.ts';
import type { Article, DocumentFile, QualityGateCheck } from '../src/types/index.ts';
const structure = {id:'question-led', name:'Question-led', description:'Answer questions', useWhen:'A concrete reader question', outlineInstructions:'Start with the core question.', draftInstructions:'Answer the main question, then distinct follow-ups.', requiredHeadings:[], schemaVersion:1, sourceId:'md',sourceName:'outline-generator.md',sourceHash:'frozen'} as const;
const article = {id:'article',title:'Title',currentStep:4,status:'review',createdAt:'2026-11-03',updatedAt:'2026-11-03',outlineStructure:{...structure,requiredHeadings:[]},outline:[{id:'one',heading:'Main answer',notes:'',level:'h2'},{id:'two',heading:'Follow-up',notes:'',level:'h3'}],keywords:'answer'} as Article;
const draft='# Title\n\nIntro.\n\n## Main answer\nAnswer.\n\n### Follow-up\nFollow-up answer.\n\n## Conclusion\nConclusion.';
test('QC enforces selected outline order and H2/H3 levels without imposing a universal layout',()=>{
 assert.ok(outlineQualityChecks(article,draft).every(c=>c.status==='pass'));
 assert.equal(outlineQualityChecks(article,draft.replace('### Follow-up','## Follow-up'))[1].status,'fail');
 assert.equal(outlineQualityChecks(article,draft+'\n\n## Unplanned\nText.')[1].status,'fail');
 assert.equal(outlineQualityChecks(article,draft.replace('## Main answer\nAnswer.\n\n### Follow-up','### Follow-up\nText.\n\n## Main answer'))[1].status,'fail');
 assert.deepEqual(outlineQualityChecks({},draft),[]);
});
test('MD required headings are checked against the approved outline as well as actual draft fidelity',()=>{
 const required={...article,outlineStructure:{...article.outlineStructure!,requiredHeadings:[{heading:'Missing section',level:'h2' as const}]}};
 assert.equal(outlineQualityChecks(required,draft)[0].status,'fail');
});
test('semantic guidance includes frozen selected form and preserves introduction authority',()=>{
 const instruction=outlineReviewInstruction(article);
 assert.match(instruction,/Answer the main question/);
 assert.match(instruction,/reader-outcome/);
 assert.match(instruction,/one paragraph, 60–85/);
 assert.match(instruction,/not automatically comparison/);
 assert.match(instruction,/never a responsive pixel-level/);
});
test('both review fingerprints change with the frozen structure, not later changes to its source MD',()=>{
 const files=[{id:'md',name:'outline-generator.md',category:'rules',content:'Old MD'}] as DocumentFile[];
 const key=qualityInputFingerprint(article,draft,1500,files);
 assert.equal(key,qualityInputFingerprint(article,draft,1500,[{...files[0],content:'New MD'}]));
 assert.equal(key,qualityInputFingerprint(article,draft,1500,[]));
 const changed={...article,outlineStructure:{...article.outlineStructure!,draftInstructions:'New selected structure.'}};
 assert.notEqual(key,qualityInputFingerprint(changed,draft,1500,files));
 assert.notEqual(semanticReviewInputFingerprint(article,draft),semanticReviewInputFingerprint(changed,draft));
 assert.notEqual(semanticReviewInputFingerprint(article,draft),semanticReviewInputFingerprint(article,draft+'Edited'));
 assert.equal(semanticReviewInputFingerprint(article,draft,{b:[],a:[]}),semanticReviewInputFingerprint({...article,activityKind:'batch'},draft,{a:[],b:[]}));
});
test('incomplete review reports exact missing checks, preserves content status and blocks publication',()=>{
 const pass=SEMANTIC_IDS.map(id=>({id,label:id,kind:'semantic',status:'pass',reason:'',autoFixAllowed:false})) as QualityGateCheck[];
 const partial=pass.slice(0,5);const process=semanticReviewIncomplete('provider returned a partial response',partial);
 assert.match(process.reason,/brand-pov/);assert.doesNotMatch(process.reason,/Missing or invalid checks: intent-satisfied/);
 assert.equal(process.status,'warning');assert.equal(process.blocking,true);
 assert.equal(qualityAllowsCompletion([...partial,process]),false);
 assert.equal(qualityAllowsCompletion(pass),true);
});
test('introduction remains 60–85 words and one paragraph regardless of selected form',()=>{
 const intro=Array.from({length:65},()=> 'word').join(' ');
 assert.equal(introductionCheck('# Title\n\n'+intro+'\n\n## Main answer\nBody').status,'pass');
 assert.equal(introductionCheck('# Title\n\nToo short.\n\n## Main answer\nBody').status,'fail');
 assert.equal(introductionCheck('# Title\n\n'+intro+'\n\nSecond paragraph.\n\n## Main answer\nBody').status,'fail');
});
test('a new source snapshot and changed evidence mapping invalidate QC; unrelated UI state does not',()=>{
 const original=qualityInputFingerprint(article,draft,1500);
 assert.notEqual(original,qualityInputFingerprint({...article,draftEvidenceUsage:{one:['ev-2']}},draft,1500));
 assert.notEqual(original,qualityInputFingerprint({...article,outlineStructure:{...article.outlineStructure!,sourceHash:'new'}},draft,1500));
 assert.equal(original,qualityInputFingerprint({...article,currentStep:3,status:'review'},draft,1500));
 const orphan={...article,outline:[article.outline![1]]};
 assert.equal(outlineQualityChecks(orphan,draft)[0].status,'fail');
});
