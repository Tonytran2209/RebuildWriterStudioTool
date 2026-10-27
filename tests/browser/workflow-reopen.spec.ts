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
  return request.method()!=='GET'||url.pathname.startsWith('/api/')||!['127.0.0.1','localhost'].includes(url.hostname)?route.abort():route.continue();
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
