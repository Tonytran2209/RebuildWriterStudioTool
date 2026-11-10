import {test,expect,type Page} from './browser-fixture';

// Run by browser-check on both desktop and mobile; no local browser launch.
async function open(page:Page){
 const requests:string[]=[];
 page.on('request',request=>{
  const url=new URL(request.url());
  if(request.method()!=='GET'||url.pathname.startsWith('/api/')||!['127.0.0.1','localhost'].includes(url.hostname))requests.push(request.method()+' '+request.url());
 });
 await page.route('**/*',route=>{
  const request=route.request();const url=new URL(request.url());
  return request.method()!=='GET'||url.pathname.startsWith('/api/')||!['127.0.0.1','localhost'].includes(url.hostname)?route.abort():route.fallback();
 });
 await page.goto('/?reopen');
 await expect(page.locator('.core-idea-select-area')).toHaveCount(2);
 return requests;
}
async function snapshot(page:Page){return JSON.parse((await page.getByTestId('reopen-state').textContent())!);}
async function selected(page:Page,id:string|null){
 const cards=page.locator('.core-idea-select-area');
 await expect(page.locator('.core-idea-select-area[aria-pressed="true"]')).toHaveCount(id?1:0);
 for(const name of ['one','two'])await expect(cards.filter({hasText:'Idea '+name})).toHaveAttribute('aria-pressed',String(name===id));
}
test('reopen-selection restores draft/completed, switches without remount and accepts same-ID snapshots',async({page})=>{
 await open(page);await selected(page,'one');
 await page.getByRole('button',{name:'Open 1',exact:true}).click();await selected(page,'two');
 await page.getByRole('button',{name:'Open 0',exact:true}).click();await selected(page,'one');
 await page.getByRole('button',{name:'Update snapshot',exact:true}).click();await selected(page,'two');
 await page.reload();await selected(page,'two');
});
test('reopen-title displays full Vietnamese title and follows article/snapshot/reload',async({page})=>{
 await open(page);
 const titles=(await snapshot(page)).articles.map((a:any)=>a.title);
 const title=page.getByTestId('outline-article-title');
 await expect(title).toHaveText(titles[0]);await expect(title).toBeVisible();
 const size=await title.evaluate(e=>({height:e.clientHeight,scrollHeight:e.scrollHeight,width:e.clientWidth,scrollWidth:e.scrollWidth}));
 expect(size.scrollHeight).toBeLessThanOrEqual(size.height+1);expect(size.scrollWidth).toBeLessThanOrEqual(size.width+1);
 await page.getByRole('button',{name:'Open 1',exact:true}).click();await expect(title).toHaveText(titles[1]);
 await page.reload();await expect(title).toHaveText(titles[1]);
 await page.getByRole('button',{name:'Open 0',exact:true}).click();await expect(title).toHaveText(titles[0]);
 await page.getByRole('button',{name:'Update snapshot',exact:true}).click();await expect(title).toHaveText('Tiêu đề cập nhật cùng ID');
 await page.reload();await expect(title).toHaveText('Tiêu đề cập nhật cùng ID');
});
test('reopen-preservation viewing never writes or generates and missing IDs stay unselected',async({page})=>{
 const requests=await open(page);const before=await snapshot(page);
 for(const index of [1,2,3,0]){
  await page.getByRole('button',{name:'Open '+index,exact:true}).click();
  await selected(page,index===0?'one':index===1?'two':null);
  await page.reload();await selected(page,index===0?'one':index===1?'two':null);
  const after=await snapshot(page);expect(after.articles).toEqual(before.articles);expect(after.updates).toEqual([]);
 }
 expect(await snapshot(page)).toEqual(before);expect(requests).toEqual([]);
});

test('completed articles block AI generation, selection and re-check while retaining saved content', async ({page}) => {
 await page.route('**/api/**', route => route.abort());
 await page.goto('/?reopen&versions');
 await page.getByRole('button', {name: 'Open 1', exact: true}).click();
 const before = await snapshot(page);
 const core = page.getByTestId('reopen-core');
 const outline = page.getByTestId('reopen-outline');
 for (const choice of await core.locator('.core-idea-select-area').all()) await expect(choice).toBeDisabled();
 await expect(core.locator('.workflow-endpoint-button')).toBeDisabled();
 await expect(outline.locator('.workflow-endpoint-button')).toBeDisabled();
 await expect(page.getByRole('button', {name: /Tạo lại Draft|Regenerate draft/})).toBeDisabled();
 await expect(page.getByRole('button', {name: /Kiểm tra lại và sửa|Re-check and fix/})).toBeDisabled();
 await expect(page.getByRole('button', {name: /Mở lại bài viết|Reopen article/})).toBeEnabled();
 expect(await snapshot(page)).toEqual(before);
});

for (const theme of ['light', 'dark']) test(`outline headings use a compact disclosure and readable details in ${theme}`, async ({page}, testInfo) => {
 await page.goto(`/?reopen&outline-tree&versions&theme=${theme}`);
 await page.addStyleTag({path:'src/ui-guide.css'});
 const outline = page.getByTestId('reopen-outline');
 const list = outline.getByRole('list', {name: /Các heading trong dàn bài|Outline headings/});
 const childList = list.getByRole('list', {name: /Các mục con của First section|Subheadings of First section/});
 const child = childList.getByRole('button', {name: 'H3 Supporting detail'});
 const parent = list.getByRole('button', {name: 'H2 First section'});
 await expect(list.getByRole('button', {name: 'H3 Legacy subsection'})).toBeVisible();
 await expect(childList.getByRole('button', {name: /Legacy subsection|Second section/})).toHaveCount(0);
 await expect(parent).toHaveAttribute('aria-expanded', 'false');
 await expect(child).toHaveAttribute('aria-expanded', 'false');
 await expect(list.locator('textarea')).toHaveCount(0);
 const background = () => child.evaluate(element => getComputedStyle(element).backgroundColor);
 const idle = await background();
 let collapsedBackground = idle;
 if (testInfo.project.name === 'desktop') {
  const dimensions = () => child.evaluate(element => ({width: element.clientWidth, height: element.clientHeight}));
  const rowSize = await dimensions();
  await child.hover();
  await expect.poll(background).not.toBe(idle);
  collapsedBackground = await background();
  expect(await dimensions()).toEqual(rowSize);
 }
 await child.click();
 await expect.poll(background).not.toBe(collapsedBackground);
 await expect(child).toHaveAttribute('aria-expanded', 'true');
 await expect(parent).toHaveAttribute('aria-expanded', 'false');
 const panel = outline.locator(`[id="${await child.getAttribute('aria-controls')}"]`);
 await expect(panel.getByText('Supporting detail notes', {exact: true})).toBeVisible();
 await expect(panel.locator('textarea')).toHaveCount(0);
 const size = await panel.evaluate(element => ({scroll: element.scrollWidth, width: element.clientWidth}));
 expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
 await expect(panel.getByRole('button', {name: /Xem AI log|View AI log/})).toBeVisible();
 await panel.getByRole('button', {name: /^(Chỉnh sửa|Edit)$/}).click();
 await expect(panel.getByRole('textbox', {name: /Ghi chú|Notes/})).toHaveValue('Supporting detail notes');
 await panel.getByRole('textbox', {name: /Tiêu đề heading|Heading title/}).fill('Updated supporting detail');
 await panel.getByRole('textbox', {name: /Tiêu đề heading|Heading title/}).blur();
 await expect(childList.getByRole('button', {name: 'H3 Updated supporting detail'})).toBeVisible();
});
