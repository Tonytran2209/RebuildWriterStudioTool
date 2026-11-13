import {test,expect} from './browser-fixture';
import {formatDraftExport} from '../../backend/draftFormatter';
test('Draft preview preserves body, full editing and stored source',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 // A fixture must never call a real backend or an AI provider.
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
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
   } else if(url.hostname==='127.0.0.1') await route.fallback();
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
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto(`/?qc=${status}`);
 await page.getByRole('button',{name:'QC',exact:true}).click();
}
test('qc-schema accepts all semantic checks and preserves saved draft on incomplete schema',async({page})=>{
 await openQcFixture(page,'incomplete');
 const before=await page.getByTestId('stored-source').textContent();
 const result=await page.evaluate(()=>{
  const h=(window as any).qcHarness;
  const ids=['intent-satisfied','reader-outcome','intro-quality','keyword-naturalness','evidence-support','brand-pov','checklist-compliance'];
  const checks=Object.fromEntries(ids.map(id=>[id,{status:'pass',reason:'Reviewed',autoFixAllowed:false}]));
  const complete=h.parseSemanticQuality(JSON.stringify({checks}));
  delete checks['brand-pov'];
  let warning;try{h.parseSemanticQuality(JSON.stringify({checks}));}catch(error){warning=h.incompleteSemanticReviewChecks(error);}
  return {complete:h.completeSemanticChecks(complete),warning};
 });
 expect(result.complete).toBe(true);
 expect(result.warning[0]).toMatchObject({status:'warning',autoFixAllowed:false});
 await expect(page.getByText(/Semantic review incomplete|Đánh giá semantic chưa hoàn tất/).first()).toBeVisible();
 expect(await page.getByTestId('stored-source').textContent()).toBe(before);
});
test('qc-cache rejects incomplete, duplicate and schema-warning cache entries',async({page})=>{
 await openQcFixture(page,'incomplete');
 const result=await page.evaluate(()=>{
  const h=(window as any).qcHarness;
  const ids=['intent-satisfied','reader-outcome','intro-quality','keyword-naturalness','evidence-support','brand-pov','checklist-compliance'];
  const checks=ids.map(id=>({id,kind:'semantic',status:'pass'}));
  return [h.completeSemanticChecks(checks),h.completeSemanticChecks(checks.slice(1)),h.completeSemanticChecks(Array(7).fill(checks[0])),h.completeSemanticChecks(h.incompleteSemanticReviewChecks('missing'))];
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
 await expect(panel.getByText(/Review needs updating|Đánh giá cần cập nhật/).first()).toBeVisible();
});

// Exercise the real component handlers and HTTP boundary; no live AI or storage.
async function mockQcFlow(page:import('@playwright/test').Page,mode:string,incomplete=false,evidenceWarning=false,withKnowledge=false,staggeredRecovery=false){
 const calls:any[]=[];
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname!=='/api/generate')return route.fallback();
  const body=route.request().postDataJSON();calls.push(body);
  const reviewer=/publishing quality reviewer|structured-output recovery reviewer/.test(body.systemPrompt);
  const requested=staggeredRecovery
    ? body.prompt.includes('MISSING CHECKS: evidence-support, brand-pov') ? ['evidence-support']
      : body.prompt.includes('MISSING CHECKS: brand-pov') ? ['brand-pov']
        : ['intent-satisfied','reader-outcome','intro-quality','keyword-naturalness','checklist-compliance']
    : body.systemPrompt.includes('requested missing checks') ? (mode === 'generation' && incomplete && calls.length === 3 ? [] : ['brand-pov']) : ['intent-satisfied','reader-outcome','intro-quality','keyword-naturalness','evidence-support','checklist-compliance',...(incomplete?[]:['brand-pov'])];
  const content=reviewer ? JSON.stringify({checks:Object.fromEntries(requested.map(id=>[id,{status:evidenceWarning && id==='evidence-support'?'warning':'pass',reason:'Reviewed fixture',autoFixAllowed:evidenceWarning && id==='evidence-support'}]))}) : await page.evaluate(()=>JSON.stringify((window as any).qcFlow.payload));
  if(reviewer){const checkpoint=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}'));expect(checkpoint.draft).toContain('Fixture practical guide');}
  await route.fulfill({json:{content,model:'fixture',usage:{inputTokens:0,outputTokens:0}}});
 });
 await page.goto('/?qc='+mode+(withKnowledge?'&kb=1':''));return calls;
}
test('draft checklist follows generation and quality review until the report is saved', async ({ page }) => {
 let resumeGeneration!: () => void;
 const generationPending = new Promise<void>(resolve => { resumeGeneration = resolve; });
 let resumeReview!: () => void;
 const reviewPending = new Promise<void>(resolve => { resumeReview = resolve; });
 await mockQcFlow(page, 'generation');
 await page.route('**/api/generate', async route => {
  const request = route.request().postDataJSON();
  await (request.systemPrompt.includes('publishing quality reviewer') ? reviewPending : generationPending);
  await route.fallback();
 });
 const log = page.getByRole('region', { name: /Nhật ký xử lý AI|AI progress log/ });
 const toggle = log.locator(':scope > details > summary');
 await page.reload();
 await expect(toggle).toContainText(/Chưa có lượt chạy|No runs yet/);
 await expect(log.locator(':scope > details')).not.toHaveAttribute('open');
 await page.getByRole('button', { name: /Tạo bài viết|Generate article/ }).click();
 const current = log.locator('[aria-current="step"]');
 try {
  await expect(toggle).toBeVisible();
  await expect(current).toBeHidden();
  await expect(log.getByRole('status')).toBeVisible();
  await toggle.click();
  await expect(current).toContainText(/Viết bản nháp theo dàn bài|Write the draft from the outline/);
  const qc = log.locator('ol > li').last();
  const live = log.getByRole('status');
  const timer = log.locator('[aria-label^="Thời gian đã chạy"], [aria-label^="Elapsed time"]');
  await qc.locator('summary').click();
  await expect(qc.getByText(/Chưa có hoạt động|No activity yet/)).toBeVisible();
  await expect(live).toHaveText(/Đang yêu cầu AI viết|Requesting a draft/);
  const detailsButton = current.getByRole('button', { name: /Xem chi tiết mốc|View checkpoint details/ });
  await detailsButton.click();
  const popup = page.getByRole('dialog');
  await expect(popup.getByRole('heading', { name: /Đầu vào|Inputs/ })).toBeVisible();
  await expect(popup.getByText(/Yêu cầu gửi AI|Request sent to AI/)).toBeVisible();
  await expect(popup.getByText(/Chỉ dẫn hệ thống|System instructions/)).toBeVisible();
  await expect(popup.getByText(/Trích đoạn phản hồi|Response excerpt/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(detailsButton).toBeFocused();
  await expect(timer).not.toHaveText('0s');
  resumeGeneration();
  await expect(current).toContainText(/Universal QC/);
  await expect(live).toHaveText(/Đang kiểm tra nội dung và dẫn chứng|Reviewing content and evidence/);
  await expect(qc.getByText(/Đang kiểm tra nội dung và dẫn chứng|Reviewing content and evidence/)).toBeVisible();
  await current.getByRole('button', { name: /Xem chi tiết mốc|View checkpoint details/ }).click();
  await expect(popup.getByText(/Tiêu chí đánh giá nội dung|Content review criteria/)).toBeVisible();
  await expect(popup.getByText(/Dẫn chứng khai báo theo mục|Declared evidence by section/)).toBeVisible();
  resumeReview();
  await expect(current).toHaveCount(0);
  await expect(live).toHaveText(/Hoàn thành|Completed/);
  await expect(qc.getByText(/Đã lưu báo cáo QC|QC report saved/)).toBeVisible();
  await expect(popup.getByText('Universal QC report', { exact: true }).or(popup.getByText('Báo cáo Universal QC', { exact: true }))).toBeVisible();
  await popup.getByRole('button', { name: /Đóng|Close/ }).click();
  const finalElapsed = await timer.textContent();
  await page.clock.install();
  await page.clock.fastForward(3000);
  await expect(timer).toHaveText(finalElapsed!);
  await expect(page.getByRole('button', { name: /Đánh dấu hoàn thành|Mark complete/ })).toBeEnabled();
  const switchArticle = page.getByRole('button', { name: 'Switch fixture article' });
  await switchArticle.click();
  await expect(toggle).toBeVisible();
  await expect(toggle).toContainText(/Chưa có lượt chạy|No runs yet/);
  await expect(log.getByText(/Chưa có nhật ký cho bước này|No log for this step yet/)).toBeHidden();
  await toggle.click();
  await expect(log.getByText(/Chưa có nhật ký cho bước này|No log for this step yet/)).toBeVisible();
  await switchArticle.click();
  await expect(toggle).toBeVisible();
  await expect(log.locator('ol')).toBeHidden();
  await toggle.click();
  await expect(log.locator('ol')).toBeVisible();
  await page.reload();
  await expect(toggle).toBeVisible();
  await expect(log.locator('ol')).toBeHidden();
  await toggle.click();
  await log.locator('ol > li').last().getByRole('button', { name: /Xem chi tiết mốc|View checkpoint details/ }).click();
  await expect(popup.getByText('Universal QC report', { exact: true }).or(popup.getByText('Báo cáo Universal QC', { exact: true }))).toBeVisible();
 } finally {
  resumeGeneration();
  resumeReview();
 }
});

for(const incomplete of [false,true])test(`qc-schema generation saves checkpoint before reviewer and preserves ${incomplete?'incomplete':'complete'} report`,async({page})=>{
 const calls=await mockQcFlow(page,'generation',incomplete);
 await page.getByRole('button',{name:/Tạo bài viết|Generate article/}).click();
 await expect.poll(()=>calls.length).toBe(incomplete?3:2);
 expect(calls[1].systemPrompt).toContain('Never evaluate URLs, internal links, link targets, or Website Inventory in a semantic check');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').semanticReviewChecks?.length)).toBe(7);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-updates')||'[]').filter((p:any)=>p.semanticReviewChecks).length)).toBe(1);
 const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}'));
 expect(saved.draft).toContain('Fixture practical guide');
 if(incomplete)expect(saved.semanticReviewChecks.at(-1).id).toBe('semantic-review-schema');
 await page.reload();await page.getByRole('button',{name:'QC',exact:true}).click();
 if(incomplete)await expect(page.getByText(/Semantic review incomplete|Đánh giá semantic chưa hoàn tất/).first()).toBeVisible();
 expect(calls).toHaveLength(incomplete?3:2);
});
for(const incomplete of [false,true])test(`qc-cache recheck calls reviewer for incomplete cache without rewrite (${incomplete?'incomplete':'complete'})`,async({page})=>{
 const calls=await mockQcFlow(page,'recheck',incomplete);
 const before=await page.getByTestId('stored-source').textContent();
 await page.getByRole('button',{name:/Kiểm tra lại và sửa|Re-check and fix/}).click();
 await expect.poll(()=>calls.length).toBe(incomplete?2:1);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').semanticReviewChecks?.length)).toBe(7);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-updates')||'[]').filter((p:any)=>p.semanticReviewChecks).length)).toBe(1);
 expect(calls.every(c=>/publishing quality reviewer/.test(c.systemPrompt))).toBe(true);
 expect(await page.getByTestId('stored-source').textContent()).toBe(before);
 await page.reload();expect(calls).toHaveLength(incomplete?2:1);
});

test('qc-recheck refreshes changed evidence context then requests only missing semantic checks',async({page})=>{
 const calls=await mockQcFlow(page,'generation',true);
 await page.getByRole('button',{name:/Tạo bài viết|Generate article/}).click();
 await expect.poll(()=>calls.length).toBe(3);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').semanticReviewChecks?.length)).toBe(7);
 await page.reload();
 await page.getByRole('button',{name:/Kiểm tra lại và sửa|Re-check and fix/}).click();
 await expect.poll(()=>calls.length).toBe(5);
 expect(calls[3].systemPrompt).toContain('Re-check the repaired draft');
 expect(calls[4].systemPrompt).toContain('requested missing checks');
 expect(calls[4].prompt).toContain('MISSING CHECKS: brand-pov');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').semanticReviewChecks?.map((c:any)=>c.id))).toEqual(['intent-satisfied','reader-outcome','intro-quality','keyword-naturalness','evidence-support','checklist-compliance','brand-pov']);
});

for(const status of ['pass','warning','fail'])test(`qc-status-display qc-evidence-details preserves reviewer ${status}`,async({page})=>{
 await openQcFixture(page,status);
 const row=page.locator('[data-qc-check="evidence-support"]');
 await expect(row).toHaveAttribute('data-qc-status',status);
 // All-pass groups start collapsed; open the content group to inspect the row.
 await page.locator('[data-qc-group="content"]').evaluate(e=>e.setAttribute('open',''));
 const panel=page.locator('.universal-qc-panel');
 await expect(panel.locator('h3')).toHaveCSS('color','rgb(235, 235, 235)');
 await expect(panel.locator('.seo-score-tag')).toHaveCSS('color','rgb(235, 235, 235)');
 await expect(panel.locator('.seo-score-tag')).toHaveCSS('background-color','rgb(29, 29, 29)');
 await expect(panel.locator('.seo-score-tag')).toHaveCSS('border-top-color','rgb(72, 72, 72)');
 await expect(row).toHaveCSS('color','rgb(235, 235, 235)');
 for(const text of await row.locator('span').all())await expect(text).toHaveCSS('color','rgb(235, 235, 235)');
 const icon=row.locator(`[data-qc-icon="${status}"]`);
 await expect(icon).toBeVisible();
 await expect(icon).toHaveCSS('color',status==='pass'?'rgb(61, 214, 140)':status==='warning'?'rgb(255, 155, 82)':'rgb(255, 138, 136)');
 await expect(row).toContainText(status==='pass'?/Pass|Đạt/:status==='warning'?/Warning|Cảnh báo/:/Fail|Thất bại/);
 if(status!=='pass'){
  await row.locator('summary').click();
  await expect(row.getByText('Fixture review finding:',{exact:false})).toBeVisible();
  await expect(row.getByText('Compare the claim',{exact:false})).toBeVisible();
  for(const detail of await row.locator('p').all())await expect(detail).toHaveCSS('color','rgb(235, 235, 235)');
  expect(await row.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 }
 const stale=page.locator('[data-qc-check="quality-review-stale"]');
 await expect(stale).toHaveAttribute('data-qc-status','warning');
 await expect(stale.locator('[data-qc-icon="warning"]')).toBeVisible();
 await expect(stale).toContainText(/Pending review|Chờ kiểm tra/);
 await expect(stale.locator('[data-qc-icon="fail"]')).toHaveCount(0);
});

test('qc-display-preservation generated report survives reload and viewing preserves outputs',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(window as any).__qcCopy=text;}},configurable:true}));
 const calls=await mockQcFlow(page,'generation',false,true);
 await page.getByRole('button',{name:/Tạo bài viết|Generate article/}).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').semanticReviewChecks?.length)).toBe(7);
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
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').qualityReport?.inputFingerprint)).toMatch(/^qc-11-/);
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
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').qualityReport?.inputFingerprint)).toMatch(/^qc-11-/);
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

test('qc-evidence recheck repairs repeated unsupported attribution even without an auto-fix flag', async ({ page }) => {
 const attribution = 'Acme Clinic illustrates the process.';
 const supported = 'The example illustrates the process.';
 const calls: any[] = [];
 await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== '127.0.0.1') return route.abort();
  if (url.pathname !== '/api/generate') return route.fallback();
  const body = route.request().postDataJSON();
  calls.push(body);
  const warning = body.prompt.includes(attribution);
  const content = body.systemPrompt.includes('surgical draft editor')
   ? { edits: Array.from({ length: 2 }, () => ({ find: attribution, replace: supported })), appendBeforeConclusion: '' }
   : { checks: Object.fromEntries(['intent-satisfied', 'reader-outcome', 'intro-quality', 'keyword-naturalness', 'evidence-support', 'brand-pov', 'checklist-compliance'].map(id => [id, {
      status: warning && id === 'evidence-support' ? 'warning' : 'pass',
      reason: 'Compared the draft with the fixture excerpt.',
      evidence: warning && id === 'evidence-support' ? attribution : '',
      autoFixAllowed: false,
    }])) };
  await route.fulfill({ json: { content: JSON.stringify(content), model: 'fixture', usage: { inputTokens: 0, outputTokens: 0 } } });
 });
 await page.goto('/?qc=recheck&kb=1');
 await page.evaluate(attribution => {
  const saved = JSON.parse(sessionStorage.getItem('qc-fixture')!);
  saved.draft = saved.draft.replace(/(## Practical guide [01]\n\n)/g, '$1' + attribution + ' ');
  sessionStorage.setItem('qc-fixture', JSON.stringify(saved));
 }, attribution);
 await page.reload();
 await page.getByRole('button', { name: /Kiểm tra lại và sửa|Re-check and fix/ }).click();
 const saved = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('qc-fixture')!));
 await expect.poll(async () => (await saved()).semanticReviewChecks?.find((check: any) => check.id === 'evidence-support')?.status).toBe('pass');
 expect(calls).toHaveLength(3);
 expect(calls[1].prompt).toContain('DRAFT EVIDENCE USAGE');
 expect(calls[2].prompt).not.toContain(attribution);
 expect((await saved()).draft.split(supported)).toHaveLength(3);
 await expect(page.getByRole('button', { name: /Đánh dấu hoàn thành|Mark complete/ })).toBeEnabled();
});

test('qc-evidence recheck retrieves current section KB without manufacturing usage',async({page})=>{
 const calls=await mockQcFlow(page,'recheck',false,false,true);
 await page.getByRole('button',{name:/Kiểm tra lại và sửa|Re-check and fix/}).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qc-fixture')||'{}').qualityReport?.inputFingerprint)).toMatch(/^qc-11-/);
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
test('qc-compact independent collapsed findings preserve complete reason and action',async({page},info)=>{
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
  const detail=row.locator('details > div');
  const layout=await detail.evaluate(e=>{
   const style=getComputedStyle(e);
   const probe=document.createElement('div');
   probe.style.cssText='position:absolute;width:132ch;visibility:hidden';
   e.appendChild(probe);
   const limit=probe.getBoundingClientRect().width;
   probe.remove();
   const heading=e.parentElement!.querySelector('summary > span')!;
   const bounds=e.getBoundingClientRect();
   const parent=e.parentElement!.getBoundingClientRect();
   return {
    width:bounds.width,limit,
    fits:bounds.left>=parent.left && bounds.right<=parent.right+1,
    titleWeight:Number(getComputedStyle(heading).fontWeight),detailWeight:Number(style.fontWeight),
    border:style.borderLeftStyle,borderWidth:parseFloat(style.borderLeftWidth),
    spacing:parseFloat(style.marginTop),
   };
  });
  expect(layout.width).toBeLessThanOrEqual(layout.limit+1);
  expect(layout.fits).toBe(true);
  expect(layout.titleWeight).toBeGreaterThan(layout.detailWeight);
  expect(layout.border).toBe('solid');
  expect(layout.borderWidth).toBeGreaterThan(0);
  expect(layout.spacing).toBeGreaterThan(0);
  // Controlled geometry checks the cap even when the real inspector is only 236px.
  // This synthetic wide container is not a production layout reproduction.
  const wide=await detail.evaluate(e=>{
   const parent=e.parentElement!;
   const originalStyle=parent.getAttribute('style');
   try{
    parent.style.width='2000px';
    const probe=document.createElement('div');
    probe.style.cssText='position:absolute;width:60ch;visibility:hidden';
    e.appendChild(probe);
    const oldLimit=probe.getBoundingClientRect().width;
    probe.style.width='132ch';
    const limit=probe.getBoundingClientRect().width;
    probe.remove();
    return {width:e.getBoundingClientRect().width,oldLimit,limit,parentWidth:parent.getBoundingClientRect().width};
   }finally{
    if(originalStyle===null) parent.removeAttribute('style');
    else parent.setAttribute('style',originalStyle);
   }
  });
  expect(wide.width).toBeGreaterThan(wide.oldLimit+1);
  expect(wide.width).toBeCloseTo(wide.limit,0);
  expect(wide.width).toBeLessThan(wide.parentWidth);
  for(const paragraph of await row.locator('p').all()){
   await expect(paragraph).toHaveCSS('color','rgb(235, 235, 235)');
   expect(await paragraph.evaluate(e=>{
    const style=getComputedStyle(e);
    return e.scrollWidth<=e.clientWidth+1 && e.scrollHeight<=e.clientHeight+1
     && style.overflow!=='hidden' && ['none',''].includes(style.getPropertyValue('-webkit-line-clamp'));
   })).toBe(true);
  }
 }
 await page.screenshot({path:info.outputPath('qc-expanded-details.png'),fullPage:true});
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

test('approving an image preserves a passing QC report across reload', async ({ page }) => {
  const calls = await mockQcFlow(page, 'generation');
  await page.getByRole('button', { name: /Tạo bài viết|Generate article/ }).click();
  const complete = page.getByRole('button', { name: /Đánh dấu hoàn thành|Mark complete/ });
  await expect(complete).toBeEnabled();
  await page.getByRole('button', { name: /^(Gợi ý ảnh|Suggest images)$/ }).click();
  await page.getByRole('button', { name: /^(Duyệt|Approve)$/ }).first().click();
  await expect(page.getByTestId('stored-source')).toContainText('image-placeholder://');
  await expect(complete).toBeEnabled();
  await page.reload();
  await expect(complete).toBeEnabled();
  expect(calls).toHaveLength(2);
});

test('re-check retains partial recovery and requests only the remaining semantic check', async ({ page }) => {
  const calls = await mockQcFlow(page, 'recheck', false, false, false, true);
  const draft = await page.getByTestId('stored-source').textContent();
  await page.getByRole('button', { name: /Kiểm tra lại và sửa|Re-check and fix/ }).click();
  await expect.poll(() => calls.length).toBe(3);
  expect(calls[1].prompt).toContain('MISSING CHECKS: evidence-support, brand-pov');
  expect(calls[2].prompt).toContain('MISSING CHECKS: brand-pov');
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('qc-fixture') || '{}').semanticReviewChecks?.length)).toBe(7);
  await expect(page.getByRole('button', { name: /Đánh dấu hoàn thành|Mark complete/ })).toBeEnabled();
  expect(await page.getByTestId('stored-source').textContent()).toBe(draft);
});

test('regenerating a draft fills missing semantic checks and supplies the measured introduction length', async ({ page }) => {
  const calls = await mockQcFlow(page, 'recheck', false, false, false, true);
  await page.getByRole('button', { name: /Tạo lại Draft|Regenerate draft/ }).click();
  await expect(page.getByRole('button', { name: /Đánh dấu hoàn thành|Mark complete/ })).toBeEnabled();
  expect(calls).toHaveLength(4);
  expect(calls[1].prompt).toContain('DETERMINISTIC INTRODUCTION MEASUREMENT: PASS. 78 words');
  expect(calls[2].prompt).toContain('MISSING CHECKS: evidence-support, brand-pov');
  expect(calls[3].prompt).toContain('MISSING CHECKS: brand-pov');
  await page.reload();
  await expect(page.getByRole('button', { name: /Đánh dấu hoàn thành|Mark complete/ })).toBeEnabled();
});

test('approved image suggestions select a worker and insert its preview without changing draft prose', async ({page}) => {
 const jobs: Array<{ id: string; suggestion_id: string; worker_id: string; status: string }> = [];
 const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD/oAAAAASUVORK5CYII=', 'base64');
 await page.route('**/api/image-workers/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/workers')) return route.fulfill({json:[
   {id:'claude',name:'Mac Claude',agent:'claude',preferred:true,online:true},
   {id:'codex',name:'Mac Codex',agent:'codex',preferred:false,online:true},
  ]});
  if (path.endsWith('/asset')) return route.fulfill({body:image,contentType:'image/png'});
  if (path.endsWith('/insert')) {
   jobs[0].status='inserted';
   return route.fulfill({json:jobs[0]});
  }
  if (route.request().method()==='POST') {
   expect(route.request().postDataJSON()).toEqual({workerId:'claude',suggestionId:'visual'});
   jobs.push({id:'job',suggestion_id:'visual',worker_id:'claude',status:'ready'});
   return route.fulfill({status:202,json:jobs[0]});
  }
  return route.fulfill({json:jobs});
 });
 await page.route('**/api/monitoring/ui-sample', route => route.fulfill({json:{ok:true}}));
 await page.goto('/?qc=recheck');
 await expect(page.getByTestId('stored-source')).toBeAttached();
 const savedDraft = await page.evaluate(() => {
  const article = JSON.parse(sessionStorage.getItem('qc-fixture')!);
  article.draft += '\n\n![Visual explanation](image-placeholder://visual)';
  article.imageSuggestions = [{id:'visual',status:'approved',afterHeading:'Conclusion',altText:'Visual explanation',type:'diagram',brief:'Explain',purpose:'Illustrate'}];
  sessionStorage.setItem('qc-fixture', JSON.stringify(article));
  return article.draft;
 });
 await page.reload();
 const placement = page.locator('.image-placement-suggestions');
 // Generation uses the Settings default worker; no per-card picker.
 await expect(placement.getByRole('combobox')).toHaveCount(0);
 await expect(placement).toContainText('Mac Claude');
 await placement.getByRole('button', {name:/^(Tạo ảnh|Generate image)$/}).click();
 await expect(placement.getByRole('img', {name:'Visual explanation'})).toBeVisible();
 await placement.getByRole('button', {name:/Chèn vào bài|Insert into draft/}).click();
 await expect(page.locator('.draft-prose').getByRole('img', {name:'Visual explanation'})).toBeVisible();
 expect(await page.getByTestId('stored-source').textContent()).toBe(savedDraft);
 await page.reload();
 await expect(page.locator('.draft-prose').getByRole('img', {name:'Visual explanation'})).toBeVisible();
});

test('writer preview renders Markdown and a QC finding scrolls to its quoted passage',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
 await page.goto('/?qc=warning');
 await page.evaluate(()=>{const saved=JSON.parse(sessionStorage.getItem('qc-fixture')!);
  saved.qualityReport.checks=saved.qualityReport.checks.map((c:any)=>c.id==='evidence-support'?{...c,evidence:'"BODY_SENTINEL: This entire section remains visible."',location:'Main body'}:c);
  sessionStorage.setItem('qc-fixture',JSON.stringify(saved));});
 await page.reload();
 const preview=page.locator('.draft-rendered');
 await expect(preview.getByRole('heading',{level:2}).first()).toBeVisible();
 await expect(preview).not.toContainText('## ');
 await page.getByRole('button',{name:'QC',exact:true}).click();
 const row=page.locator('[data-qc-check="evidence-support"]');
 await row.locator('summary').click();
 await row.getByRole('button',{name:/Xem trong bài|Show in draft/}).click();
 await expect(preview.locator('.qc-highlight')).toContainText('BODY_SENTINEL');
});
