import {test,expect} from '@playwright/test';
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
   const introduction=page.locator('[style*="-webkit-line-clamp"]');
   await expect(introduction).toBeVisible();
   const geometry=await introduction.evaluate(e=>({height:e.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(e).lineHeight),fullHeight:e.scrollHeight,clamp:getComputedStyle(e).getPropertyValue('-webkit-line-clamp')}));
   expect(geometry.clamp).toBe('6');expect(geometry.height).toBeLessThanOrEqual(geometry.lineHeight*6+1);expect(geometry.fullHeight).toBeGreaterThan(geometry.height);
   await expect(page.getByText(/BODY_SENTINEL:/).last()).toBeVisible();
   await expect(page.getByText(/CONCLUSION_SENTINEL:/).last()).toBeVisible();
   await page.screenshot({path:info.outputPath('six-line-preview.png'),fullPage:true});
   await editButton.click();
 }
 await expect(editor).toBeVisible();await expect(editor).toContainText('Introduction line 9');await expect(editor).toContainText('CONCLUSION_SENTINEL');
 await editor.press('ControlOrMeta+End');await editor.press('End');await editor.pressSequentially(' EDIT_SENTINEL');
 await expect(source).toContainText('EDIT_SENTINEL');
 const saved=await source.textContent();expect(saved!.replace(' EDIT_SENTINEL','')).toBe(initial);expect(saved).toContain('—');
 if(previewMode){await page.getByRole('button',{name:/Xem bản nháp|Preview draft/}).click();await expect(page.locator('[style*="-webkit-line-clamp"]')).toBeVisible();}
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:/Tải .txt/}).click();const download=await downloadEvent;
 const {readFile}=await import('node:fs/promises');expect(await readFile((await download.path())!,'utf8')).toBe(saved);
 expect(errors).toEqual([]);
});
