import {test,expect} from '@playwright/test';
import {formatDraftExport} from '../../backend/draftFormatter';
test('Draft preview preserves body, full editing and stored source',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 // A fixture must never call a real backend or an AI provider.
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('/');
 const editButton=page.getByRole('button',{name:/Chỉnh sửa toàn bộ bản nháp|Edit full draft/});
 const editor=page.locator('[contenteditable="true"]');
 await expect(page.getByRole('heading',{name:/Bản nháp|Draft/}).first()).toBeVisible();
 const source=page.getByTestId('stored-source');
 const initial=await source.textContent();
 const previewMode=await editButton.count()>0;
 if(previewMode){
   const introduction=page.locator('.draft-prose:not(.prose-editor)').getByText(/Introduction line 9/);
   await expect(introduction).toBeVisible();
   const geometry=await introduction.evaluate(e=>({height:e.clientHeight,fullHeight:e.scrollHeight,clamp:getComputedStyle(e).getPropertyValue('-webkit-line-clamp')}));
   expect(geometry.clamp).not.toBe('6');expect(geometry.fullHeight).toBeLessThanOrEqual(geometry.height+1);
   await expect(page.locator('.draft-prose:not(.prose-editor)').getByText(/BODY_SENTINEL:/)).toBeVisible();
   await expect(page.locator('.draft-prose:not(.prose-editor)').getByText(/CONCLUSION_SENTINEL:/)).toBeVisible();
   await page.screenshot({path:info.outputPath('full-introduction-preview.png'),fullPage:true});
   await editButton.click();
 }
 await expect(editor).toBeVisible();await expect(editor).toContainText('Introduction line 9');await expect(editor).toContainText('CONCLUSION_SENTINEL');
 await editor.press('ControlOrMeta+End');await editor.press('End');await editor.pressSequentially(' EDIT_SENTINEL');
 await expect(source).toContainText('EDIT_SENTINEL');
 const saved=await source.textContent();expect(saved!.replace(' EDIT_SENTINEL','')).toBe(initial);expect(saved).toContain('—');
 if(previewMode){await page.getByRole('button',{name:/Xem bản nháp|Preview draft/}).click();await expect(page.locator('.draft-prose:not(.prose-editor)').getByText(/Introduction line 9/)).toBeVisible();}
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:/Tải .txt/}).click();const download=await downloadEvent;
 const {readFile}=await import('node:fs/promises');expect(await readFile((await download.path())!,'utf8')).toBe(saved!.replace(/—/g,'-'));
 expect(errors).toEqual([]);
});

test('Copy normalizes punctuation and preserves rich tables without mutating source',async({page})=>{
 await page.addInitScript(()=>{
   (window as any).__copied={};
   Object.defineProperty(navigator,'clipboard',{value:{
     writeText:async(text:string)=>{(window as any).__copied={text};},
     write:async(items:ClipboardItem[])=>{
       const item=items[0];
       (window as any).__copied={html:await (await item.getType('text/html')).text(),text:await (await item.getType('text/plain')).text()};
     },
   },configurable:true});
 });
 await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/format/google-docs'){
     const input=route.request().postDataJSON();
     expect(input.draft).not.toContain('—');
     await route.fulfill({json:formatDraftExport(input.draft,input.title,input.outline)});
   } else if(url.hostname==='127.0.0.1') await route.continue();
   else await route.abort();
 });
 await page.goto('/');
 const source=page.getByTestId('stored-source');
 const initial=await source.textContent();
 await page.getByRole('button',{name:/Copy nội dung|Copy content/}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__copied.text)).toBe(initial!.replace(/—/g,'-'));
 await page.getByRole('button',{name:/Copy bài \+ SEO brief|Copy article \+ SEO brief/}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__copied.html??'')).toContain('<table');
 const copied=await page.evaluate(()=>(window as any).__copied);
 expect(copied.html).toContain('<strong>A - B</strong>');
 expect(copied.html).toContain('<a href="https://example.com/details">');
 expect(copied.html).not.toContain('—');expect(copied.text).not.toContain('—');
 expect(await source.textContent()).toBe(initial);
});

// These scenarios run in GitHub browser-check; the Mac LaunchAgent must not launch a browser.
async function openQcFixture(page:import('@playwright/test').Page,status:string){
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`/?qc=${status}`);
 await page.getByRole('button',{name:'QC',exact:true}).click();
}
test('qc-schema accepts six checks and preserves saved draft on incomplete schema',async({page})=>{
 await openQcFixture(page,'incomplete');
 const before=await page.getByTestId('stored-source').textContent();
 const result=await page.evaluate(()=>{
  const h=(window as any).qcHarness;
  const ids=['intent-satisfied','reader-outcome','intro-quality','keyword-naturalness','evidence-support','brand-pov'];
  const checks=Object.fromEntries(ids.map(id=>[id,{status:'pass',reason:'Reviewed',autoFixAllowed:false}]));
  const complete=h.parseSemanticQuality(JSON.stringify({checks}));
  delete checks['brand-pov'];
  let warning;try{h.parseSemanticQuality(JSON.stringify({checks}));}catch(error){warning=h.incompleteSemanticReviewChecks(error);}
  return {complete:h.completeSemanticChecks(complete),warning};
 });
 expect(result.complete).toBe(true);
 expect(result.warning[0]).toMatchObject({status:'warning',autoFixAllowed:false});
 await expect(page.getByText('Semantic review incomplete',{exact:false}).first()).toBeVisible();
 expect(await page.getByTestId('stored-source').textContent()).toBe(before);
});
test('qc-cache rejects incomplete, duplicate and schema-warning cache entries',async({page})=>{
 await openQcFixture(page,'incomplete');
 const result=await page.evaluate(()=>{
  const h=(window as any).qcHarness;
  const ids=['intent-satisfied','reader-outcome','intro-quality','keyword-naturalness','evidence-support','brand-pov'];
  const checks=ids.map(id=>({id,kind:'semantic',status:'pass'}));
  return [h.completeSemanticChecks(checks),h.completeSemanticChecks(checks.slice(1)),h.completeSemanticChecks(Array(6).fill(checks[0])),h.completeSemanticChecks(h.incompleteSemanticReviewChecks('missing'))];
 });
 expect(result).toEqual([true,false,false,false]);
});
for(const status of ['pass','warning','fail','incomplete'])test(`qc-reload preserves ${status} report and marks changed configuration for re-check`,async({page})=>{
 await openQcFixture(page,status);
 const panel=page.locator('.draft-insight-panel').filter({hasText:'Universal QC'});
 const before=await panel.textContent();
 const draft=await page.getByTestId('stored-source').textContent();
 await page.reload();await page.getByRole('button',{name:'QC',exact:true}).click();
 await expect(panel).toHaveText(before!);
 expect(await page.getByTestId('stored-source').textContent()).toBe(draft);
 await page.getByRole('button',{name:'Change QC configuration'}).click();
 await expect(panel.getByText('QC needs re-check',{exact:false}).first()).toBeVisible();
});

// Exercise the real component handlers and HTTP boundary; no live AI or storage.
async function mockQcFlow(page:import('@playwright/test').Page,mode:string,incomplete=false,evidenceWarning=false,withKnowledge=false){
 const calls:any[]=[];
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname!=='/api/generate')return route.continue();
  const body=route.request().postDataJSON();calls.push(body);
  const reviewer=/publishing quality reviewer|structured-output recovery reviewer/.test(body.systemPrompt);
  const requested=body.systemPrompt.includes('requested missing checks') ? ['brand-pov'] : ['intent-satisfied','reader-outcome','intro-quality','keyword-naturalness','evidence-support',...(incomplete?[]:['brand-pov'])];
  const content=reviewer ? JSON.stringify({checks:Object.fromEntries(requested.map(id=>[id,{status:evidenceWarning && id==='evidence-support'?'warning':'pass',reason:'Reviewed fixture',autoFixAllowed:evidenceWarning && id==='evidence-support'}]))}) : await page.evaluate(()=>JSON.stringify((window as any).qcFlow.payload));
  if(reviewer){const checkpoint=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}'));expect(checkpoint.draft).toContain('Fixture practical guide');}
  await route.fulfill({json:{content,model:'fixture',usage:{inputTokens:0,outputTokens:0}}});
 });
 await page.goto('/?qc='+mode+(withKnowledge?'&kb=1':''));return calls;
}
for(const incomplete of [false,true])test(`qc-schema generation saves checkpoint before reviewer and preserves ${incomplete?'incomplete':'complete'} report`,async({page})=>{
 const calls=await mockQcFlow(page,'generation',incomplete);
 await page.getByRole('button',{name:/Tạo bài viết|Generate article/}).click();
 await expect.poll(()=>calls.length).toBe(2);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').semanticReviewChecks?.length)).toBe(6);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-updates')||'[]').filter((p:any)=>p.semanticReviewChecks).length)).toBe(1);
 const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}'));
 expect(saved.draft).toContain('Fixture practical guide');
 if(incomplete)expect(saved.semanticReviewChecks.at(-1).id).toBe('semantic-review-schema');
 await page.reload();await page.getByRole('button',{name:'QC',exact:true}).click();
 if(incomplete)await expect(page.getByText('Semantic review incomplete',{exact:false}).first()).toBeVisible();
 expect(calls).toHaveLength(2);
});
for(const incomplete of [false,true])test(`qc-cache recheck calls reviewer for incomplete cache without rewrite (${incomplete?'incomplete':'complete'})`,async({page})=>{
 const calls=await mockQcFlow(page,'recheck',incomplete);
 const before=await page.getByTestId('stored-source').textContent();
 await page.getByRole('button',{name:/Kiểm tra lại và sửa|Re-check and fix/}).click();
 await expect.poll(()=>calls.length).toBe(incomplete?2:1);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').semanticReviewChecks?.length)).toBe(6);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-updates')||'[]').filter((p:any)=>p.semanticReviewChecks).length)).toBe(1);
 expect(calls.every(c=>/publishing quality reviewer/.test(c.systemPrompt))).toBe(true);
 expect(await page.getByTestId('stored-source').textContent()).toBe(before);
 await page.reload();expect(calls).toHaveLength(incomplete?2:1);
});

test('qc-recheck requests only missing semantic checks saved from generation',async({page})=>{
 const calls=await mockQcFlow(page,'generation',true);
 await page.getByRole('button',{name:/Tạo bài viết|Generate article/}).click();
 await expect.poll(()=>calls.length).toBe(2);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').semanticReviewChecks?.length)).toBe(6);
 await page.reload();
 await page.getByRole('button',{name:/Kiểm tra lại và sửa|Re-check and fix/}).click();
 await expect.poll(()=>calls.length).toBe(3);
 expect(calls[2].systemPrompt).toContain('requested missing checks');
 expect(calls[2].prompt).toContain('MISSING CHECKS: brand-pov');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').semanticReviewChecks?.map((c:any)=>c.id))).toEqual(['intent-satisfied','reader-outcome','intro-quality','keyword-naturalness','evidence-support','brand-pov']);
});

for(const status of ['pass','warning','fail'])test(`qc-status-display qc-evidence-details preserves reviewer ${status}`,async({page})=>{
 await openQcFixture(page,status);
 const row=page.locator('[data-qc-check="evidence-support"]');
 await expect(row).toHaveAttribute('data-qc-status',status);
 await expect(row).toHaveClass(new RegExp(status==='pass'?'text-emerald-700':status==='warning'?'text-amber-700':'text-rose-700'));
 await expect(row.locator(`[data-qc-icon="${status}"]`)).toBeVisible();
 await expect(row).toContainText(status==='pass'?/Pass|Đạt/:status==='warning'?/Warning|Cảnh báo/:/Fail|Thất bại/);
 if(status!=='pass'){
  await row.locator('summary').click();
  await expect(row.getByText('Fixture review finding:',{exact:false})).toBeVisible();
  await expect(row.getByText('Compare the claim',{exact:false})).toBeVisible();
  expect(await row.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 }
 const stale=page.locator('[data-qc-check="quality-review-stale"]');
 await expect(stale).toHaveAttribute('data-qc-status','warning');
 await expect(stale.locator('[data-qc-icon="warning"]')).toBeVisible();
 await expect(stale).toContainText(/Warning|Cảnh báo/);
 await expect(stale.locator('[data-qc-icon="fail"]')).toHaveCount(0);
});

test('qc-display-preservation generated report survives reload and viewing preserves outputs',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(window as any).__qcCopy=text;}},configurable:true}));
 const calls=await mockQcFlow(page,'generation',false,true);
 await page.getByRole('button',{name:/Tạo bài viết|Generate article/}).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').semanticReviewChecks?.length)).toBe(6);
 const snapshot=()=>page.evaluate(()=>({article:JSON.parse(sessionStorage.getItem('qc-fixture')||'{}'),updates:sessionStorage.getItem('qc-updates')}));
 const before=await snapshot();
 const capture=async()=>{
  await page.getByRole('button',{name:/Copy nội dung|Copy content/}).click();
  const copied=await page.evaluate(()=>(window as any).__qcCopy);
  const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:/Tải .txt/}).click();
  const download=await downloading;
  const {readFile}=await import('node:fs/promises');
  return {copied,exported:await readFile((await download.path())!,'utf8')};
 };
 const output=await capture();
 expect(output.copied).toBe(before.article.draft.replace(/—/g,'-'));
 expect(output.exported).toBe(output.copied);
 await page.getByRole('button',{name:'QC',exact:true}).click();
 await expect(page.locator('[data-qc-check="quality-review-stale"]')).toHaveCount(0);
 const panel=page.locator('.draft-insight-panel').filter({hasText:'Universal QC'});
 const reportText=await panel.textContent();
 const score=await panel.locator('.seo-score-tag').textContent();
 const completion=page.getByRole('button',{name:/Đánh dấu hoàn thành|Mark.*complete/i});
 const completionState=await completion.isEnabled();
 const finding=page.locator('[data-qc-check="evidence-support"]');
 await finding.locator('summary').click();
 await expect(finding.getByText('Reviewed fixture',{exact:true})).toBeVisible();
 await finding.locator('summary').click();
 await expect(finding.locator('details')).not.toHaveAttribute('open','');
 expect(await capture()).toEqual(output);
 expect(await snapshot()).toEqual(before);
 await page.reload();await page.getByRole('button',{name:'QC',exact:true}).click();
 await expect(panel).toHaveText(reportText!);
 await expect(finding.locator('details')).not.toHaveAttribute('open','');
 await finding.locator('summary').click();
 await expect(finding.getByText('Reviewed fixture',{exact:true})).toBeVisible();
 expect(await panel.locator('.seo-score-tag').textContent()).toBe(score);
 expect(await completion.isEnabled()).toBe(completionState);
 await expect(page.locator('[data-qc-check="quality-review-stale"]')).toHaveCount(0);
 expect(await snapshot()).toEqual(before);
 expect(await capture()).toEqual(output);
 await page.getByRole('button',{name:'Change QC configuration'}).click();
 await expect(page.locator('[data-qc-check="quality-review-stale"]')).toHaveAttribute('data-qc-status','warning');
 const after=await snapshot();
 expect(after.article.draft).toBe(before.article.draft);
 expect(after.article.qualityReport).toEqual(before.article.qualityReport);
 expect(after.updates).toBe(before.updates);
 expect(await capture()).toEqual(output);
 expect(calls).toHaveLength(2);
});

test('qc-batch shared review fingerprint survives legacy spec metadata and missing browser generation fingerprint',async({page})=>{
 const calls=await mockQcFlow(page,'generation');
 await page.getByRole('button',{name:/Tạo bài viết|Generate article/}).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').qualityReport?.inputFingerprint)).toMatch(/^qc-9-/);
 await page.evaluate(()=>{
   const saved=JSON.parse(sessionStorage.getItem('qc-fixture')!);
   saved.articleSpecFingerprint='legacy-backend-sha256';saved.activityKind='batch';
   delete saved.draftSourceFingerprint;
   sessionStorage.setItem('qc-fixture',JSON.stringify(saved));
 });
 await page.reload();await page.getByRole('button',{name:'QC',exact:true}).click();
 await expect(page.locator('[data-qc-check="quality-review-stale"]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:/Đánh dấu hoàn thành|Mark complete/})).toBeEnabled();
 expect(calls).toHaveLength(2);
});

test('qc-advisory warning permits completion but evidence warnings remain blocking',async({page})=>{
 await mockQcFlow(page,'generation');
 await page.getByRole('button',{name:/Tạo bài viết|Generate article/}).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').qualityReport?.inputFingerprint)).toMatch(/^qc-9-/);
 const complete=page.getByRole('button',{name:/Đánh dấu hoàn thành|Mark complete/});
 await page.evaluate(()=>{
   const saved=JSON.parse(sessionStorage.getItem('qc-fixture')!);
   saved.qualityReport.status='warning';
   saved.qualityReport.checks=saved.qualityReport.checks.map((c:any)=>c.id==='brand-pov'?{...c,status:'warning'}:c);
   sessionStorage.setItem('qc-fixture',JSON.stringify(saved));
 });
 await page.reload();await expect(complete).toBeEnabled();
 await page.evaluate(()=>{
   const saved=JSON.parse(sessionStorage.getItem('qc-fixture')!);
   saved.qualityReport.checks=saved.qualityReport.checks.map((c:any)=>c.id==='evidence-support'?{...c,status:'warning',blocking:false}:c);
   sessionStorage.setItem('qc-fixture',JSON.stringify(saved));
 });
 await page.reload();await expect(complete).toBeDisabled();
});

test('qc-evidence missing KB does not trigger an unsupported rewrite or repeated paid review',async({page})=>{
 const calls=await mockQcFlow(page,'recheck',false,true);
 const source=await page.getByTestId('stored-source').textContent();
 const recheck=page.getByRole('button',{name:/Kiểm tra lại và sửa|Re-check and fix/});
 await recheck.click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').step4ProcessTrace?.some((event:any)=>event.title==='Knowledge Base evidence required'))).toBe(true);
 await expect(recheck).toBeEnabled();
 await recheck.click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-updates')||'[]').filter((p:any)=>p.semanticReviewChecks).length)).toBe(2);
 expect(calls).toHaveLength(1);
 expect(await page.getByTestId('stored-source').textContent()).toBe(source);
 await expect(page.getByRole('button',{name:/Đánh dấu hoàn thành|Mark complete/})).toBeDisabled();
});

test('qc-evidence recheck retrieves current section KB without manufacturing usage',async({page})=>{
 const calls=await mockQcFlow(page,'recheck',false,false,true);
 await page.getByRole('button',{name:/Kiểm tra lại và sửa|Re-check and fix/}).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').qualityReport?.inputFingerprint)).toMatch(/^qc-9-/);
 const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}'));
 expect(saved.outline.every((s:any)=>s.evidence.some((e:any)=>e.role==='kb' && e.quote.includes('script review')))).toBe(true);
 expect(Object.values(saved.draftEvidenceUsage).every((refs:any)=>refs.length===0)).toBe(true);
 expect(calls).toHaveLength(1);
 expect(calls[0].prompt).toContain('script review');
 await page.reload();await page.getByRole('button',{name:'QC',exact:true}).click();
 await expect(page.locator('[data-qc-check="quality-review-stale"]')).toHaveCount(0);
});


// Seed only the existing fixture's saved report; production persistence is untouched.
async function compactQcFixture(page:import('@playwright/test').Page){
 await openQcFixture(page,'warning');
 await page.evaluate(()=>{
  const saved=JSON.parse(sessionStorage.getItem('qc-fixture')!);
  saved.qualityReport.checks=saved.qualityReport.checks.map((c:any,i:number)=>({
   ...c,status:i===0?'pass':i===2?'fail':'warning',
   label:i===1?'Long finding '+ 'readable '.repeat(20):c.label,
   reason:i===3?'': 'Full reason '+ 'unbroken'.repeat(70),
   recommendedAction:i===3?'': 'Full action '+ 'Review the approved evidence. '.repeat(20),
  }));
  sessionStorage.setItem('qc-fixture',JSON.stringify(saved));
 });
 await page.reload();await page.getByRole('button',{name:'QC',exact:true}).click();
}
test('qc-compact independent collapsed findings preserve complete reason and action',async({page})=>{
 await compactQcFixture(page);
 const pass=page.locator('[data-qc-check="intent-satisfied"]');
 const warning=page.locator('[data-qc-check="reader-outcome"]');
 const fail=page.locator('[data-qc-check="intro-quality"]');
 await expect(pass.locator('summary')).toHaveCount(0);
 await expect(page.locator('[data-qc-check="keyword-naturalness"] summary')).toHaveCount(0);
 for(const row of [warning,fail]){
  await expect(row.locator('details')).not.toHaveAttribute('open','');
  await expect(row.getByText('Full reason ',{exact:false})).not.toBeVisible();
  await row.locator('summary').click();
  await expect(row.locator('p').nth(0)).toHaveText('Full reason '+ 'unbroken'.repeat(70));
  await expect(row.locator('p').nth(1)).toContainText('Full action '+ 'Review the approved evidence. '.repeat(20).trimEnd());
 }
 await warning.locator('summary').click();
 await expect(warning.locator('details')).not.toHaveAttribute('open','');
 await expect(fail.locator('details')).toHaveAttribute('open','');
});
test('qc-disclosure-accessibility keyboard pointer touch and long content fit viewport',async({page})=>{
 await compactQcFixture(page);
 const row=page.locator('[data-qc-check="reader-outcome"]');
 const summary=row.locator('summary');
 await summary.focus();
 await page.keyboard.press('Tab');
 await page.keyboard.press('Shift+Tab');
 await expect(summary).toBeFocused();
 expect(await summary.evaluate(e=>{const s=getComputedStyle(e);return s.outlineStyle!=='none' && parseFloat(s.outlineWidth)>=2;})).toBe(true);
 await page.keyboard.press('Enter');
 await expect(row.locator('details')).toHaveAttribute('open','');
 await page.keyboard.press('Space');
 await expect(row.locator('details')).not.toHaveAttribute('open','');
 await summary.click();
 await expect(row.locator('details')).toHaveAttribute('open','');
 for(const element of [row,summary,row.locator('p').nth(0),row.locator('p').nth(1)]){
  expect(await element.evaluate(e=>{const r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth+1 && r.left>=0 && r.right<=innerWidth+1 && e.scrollHeight<=e.clientHeight+1;})).toBe(true);
 }
 // Enable touch on the existing desktop/mobile browser context without changing config.
 const session=await page.context().newCDPSession(page);
 await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 const box=await summary.boundingBox();
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box!.x+12,y:box!.y+12}]});
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(row.locator('details')).not.toHaveAttribute('open','');
 await session.detach();
});
