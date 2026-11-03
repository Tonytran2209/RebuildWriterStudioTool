import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOutlineSelection, outlineSelectionUpdates, readOutlineStructures, buildOutlineTask, outlineStructurePrompt, validateOutlineStructure } from './outlineStructures.ts';
const definition = { id:'fixture-only', name:'Fixture', description:'Test definition', useWhen:'Testing', outlineInstructions:'Arrange test headings.', draftInstructions:'Expand the approved outline.', requiredHeadings:[{heading:'First',level:'h2'},{heading:'Second',level:'h3'}] };
const source = (entry = definition) => ({id:'rules-1', name:'fixture.md', category:'rules', fileType:'md', content:'```outline-structures\n'+JSON.stringify({version:1,structures:[entry]})+'\n```'});
test('only authorized ready Markdown rules create options; prose and KB never invent options',()=>{
 assert.equal(readOutlineStructures([source()],[]).structures.length,0);
 assert.equal(readOutlineStructures([{...source(),category:'kb'}]).structures.length,0);
 assert.equal(readOutlineStructures([{...source(),name:'rules.txt',fileType:'txt'}]).structures.length,0);
 assert.equal(readOutlineStructures([{...source(),content:'# Any prose'}]).structures.length,0);
 assert.equal(readOutlineStructures([{...source(),scanStatus:'error'}]).structures.length,0);
 assert.equal(readOutlineStructures([source()],['rules-1']).structures.length,1);
});
test('malformed blocks and duplicate IDs are actionable and never silently chosen',()=>{
 assert.equal(readOutlineStructures([{...source(),content:'```outline-structures\ninvalid\n```'}]).errors.length,1);
 const duplicates=readOutlineStructures([source(),{...source(),id:'other'}]);
 assert.equal(duplicates.structures.length,0);assert.match(duplicates.errors.join(),/Duplicate/);
});
test('snapshot freezes instructions and source revision across MD changes',()=>{
 const first=readOutlineStructures([source()]).structures[0];
 const next=readOutlineStructures([source({...definition,draftInstructions:'Updated.'})]).structures[0];
 assert.notEqual(first.sourceHash,next.sourceHash);
 assert.match(outlineStructurePrompt(first,'draft'),/Expand the approved outline/);
 assert.doesNotMatch(outlineStructurePrompt(first,'draft'),/Updated/);
 assert.match(buildOutlineTask({spec:{},direction:{},structure:first,desiredSections:6,minimumSections:4}),/Arrange test headings/);
});
test('required heading level and order are enforced; legacy snapshots remain readable',()=>{
 const snapshot=readOutlineStructures([source()]).structures[0];
 assert.deepEqual(validateOutlineStructure(definition.requiredHeadings,snapshot),[]);
 assert.ok(validateOutlineStructure([...definition.requiredHeadings].reverse(),snapshot).length);
 assert.ok(validateOutlineStructure([{heading:'First',level:'h3'}],snapshot).length);
 assert.deepEqual(validateOutlineStructure([],undefined),[]);
});

test('server resolves authorized MD content rather than trusting submitted instructions',()=>{
 const snapshot=readOutlineStructures([source()]).structures[0];
 const canonical=resolveOutlineSelection([source()],['rules-1'],{...snapshot,outlineInstructions:'forged'} as any);
 assert.equal(canonical.outlineInstructions,definition.outlineInstructions);
 assert.throws(()=>resolveOutlineSelection([source()],[],snapshot),/not authorized/);
 assert.throws(()=>resolveOutlineSelection([source({...definition,name:'New revision'})],['rules-1'],snapshot),/changed/);
});
test('switching structure preserves old output but invalidates generation and approvals',()=>{
 const snapshot=readOutlineStructures([source()]).structures[0];
 const old={outline:[{heading:'Saved outline'}],draft:'Saved draft',qualityReport:{status:'pass'},editorialApproval:{status:'approved'},status:'done'};
 const next={...old,...outlineSelectionUpdates(snapshot)};
 assert.equal(next.outline,old.outline);assert.equal(next.draft,old.draft);
 assert.equal(next.outlineNeedsRegeneration,true);assert.equal(next.draftNeedsRegeneration,true);
 assert.equal(next.editorialApproval,null);assert.equal(next.qualityReport,null);assert.equal(next.status,'in_progress');
});

test('existing generator Markdown reads explicit forms including ampersands without adding a group option',()=>{
 const content='# Source\n\n## Preparation\nPreserve evidence.\n\n## Select a form\n- Comparison-led when alternatives exist; select X below.\n- Story-led when a documented case exists.\n- Q&A-led for a concrete question.\n\n## Comparison forms\n### Type X: Fixture comparison\nContext -> contrast -> decision.\n\n## Build section specifications\nUse actual headings.\n\n## Final checks\nNever invent evidence.\n';
 const catalog=readOutlineStructures([{id:'md',name:'02-outline-generator.md',category:'rules',content}]);
 assert.deepEqual(catalog.errors,[]);
 assert.deepEqual(catalog.structures.map(s=>s.name),['Type X: Fixture comparison','Story-led','Q&A-led']);
 assert.ok(catalog.structures.every(s=>s.outlineInstructions.includes('Use actual headings.')));
 assert.ok(catalog.structures.every(s=>!s.outlineInstructions.includes('## Select a form')));
 assert.ok(catalog.structures.every(s=>s.draftInstructions.includes('Never invent evidence.')));
 assert.equal(readOutlineStructures([{id:'md',name:'another.md',category:'rules',content}]).structures.length,0);
});
