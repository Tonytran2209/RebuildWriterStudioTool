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
 const {readFile}=await import('node:fs/promises');expect(await readFile((await download.path())!,'utf8')).toBe(saved);
 expect(errors).toEqual([]);
});
