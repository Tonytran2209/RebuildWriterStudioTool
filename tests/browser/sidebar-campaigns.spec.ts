import { test, expect } from '@playwright/test';
// Completed child buttons include the status icon's accessible label.
const plan = (id:string,name:string) => ({id,name,version:1,status:'ready',createdAt:'2026-11-01',items:[]});
async function open(page:any,theme='dark') {
 await page.addInitScript(()=>localStorage.setItem('writer:language','en'));
 await page.goto('/?campaigns&theme='+theme);
 const menu=page.getByRole('button',{name:'Open menu',exact:true});
 if(await menu.isVisible()) await menu.click();
}
for(const theme of ['light','dark']) test(`campaign disclosure and navigation in ${theme}`,async({page})=>{
 const writes:string[]=[];
 await page.route('**/api/content-plans**',async route=>{if(route.request().method()!=='GET')writes.push(route.request().method());await route.fulfill({json:[plan('campaign-a','Added campaign'),plan('empty','Empty campaign')]});});
 await open(page,theme);
 const campaign=page.getByRole('button',{name:'Added campaign'});
 await expect(campaign).toHaveAttribute('aria-expanded','false');
 await expect(page.getByRole('button',{name:'Single article Completed',exact:true})).toHaveCount(0);
 await campaign.focus(); await page.keyboard.press('Enter');
 await expect(campaign).toHaveAttribute('aria-expanded','true');
 await page.getByRole('button',{name:'Batch article',exact:true}).click();
 await expect(page.getByTestId('campaign-selected')).toHaveText('batch');
 await page.getByRole('button',{name:'Single article Completed',exact:true}).click();
 await expect(page.getByTestId('campaign-selected')).toHaveText('single');
 await expect(campaign.locator('.campaign-nav-label')).toHaveCSS('font-size','13px');
 await expect(page.getByRole('button',{name:'Batch article',exact:true}).locator('.campaign-nav-label')).toHaveCSS('font-size','13px');
 await campaign.focus(); await page.keyboard.press('Space');
 await expect(campaign).toHaveAttribute('aria-expanded','false');
 await page.getByRole('button',{name:'Empty campaign'}).click();
 await expect(page.getByText('No articles yet',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByRole('textbox',{name:'Search articles'}).fill('Single');
 await expect(page.getByRole('button',{name:'Single article Completed',exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Search articles'}).fill('');
 await page.getByRole('button',{name:'Campaign details unavailable'}).click();
 await expect(page.getByRole('button',{name:'Missing metadata article',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Ungrouped article',exact:true})).toBeVisible();
 expect(writes).toEqual([]); await expect(page.getByTestId('campaign-deleted')).toBeEmpty();
});
test('metadata failure preserves article access',async({page})=>{
 await page.route('**/api/content-plans',route=>route.fulfill({status:503,json:{error:'Metadata unavailable'}}));
 await open(page);
 const fallback=page.getByRole('button',{name:'Campaign details unavailable'});
 await expect(fallback).toHaveCount(2);
 await fallback.first().click();
 await page.getByRole('button',{name:'Single article Completed',exact:true}).click();
 await expect(page.getByTestId('campaign-selected')).toHaveText('single');
});
test('import survives classification failure and delayed history',async({page})=>{
 let release!:()=>void; const held=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/api/content-plans',async route=>{await held;await route.fulfill({json:[]});});
 await page.route('**/api/content-plans/import',route=>route.fulfill({json:{plan:plan('imported','Imported campaign')}}));
 await page.route('**/api/content-plans/imported/classify',route=>route.fulfill({status:500,json:{error:'Classification failed'}}));
 await open(page);
 await page.getByRole('textbox',{name:'Content Plan content'}).fill('Synthetic plan for contract test');
 await page.getByRole('button',{name:'Submit Content Plan'}).click();
 await expect(page.getByRole('button',{name:'Imported campaign'})).toBeVisible();
 await expect(page.getByText('Classification failed',{exact:true})).toBeVisible();
 await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/content-plans')),Promise.resolve().then(()=>release())]);
 await expect(page.getByRole('button',{name:'Imported campaign'})).toBeVisible();
});

test('offline: actual Sidebar renders collapsed campaigns and preserves ungrouped access', async () => {
 const React = await import('react');
 const {renderToStaticMarkup} = await import('react-dom/server');
 const {default:Sidebar} = await import('../../src/components/Sidebar');
 const {LanguageProvider} = await import('../../src/lib/i18n');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'en'}});
 try {
  const markup=renderToStaticMarkup(React.createElement(LanguageProvider,{children:React.createElement(Sidebar,{
   articles:[{id:'single',title:'Hidden child',contentPlanId:'campaign-a'},{id:'old',title:'Accessible old article'}] as any,
   contentPlans:[plan('campaign-a','Added campaign'),plan('empty','Empty campaign')] as any,
   activeArticleId:null,onSelectArticle:()=>{},onNewArticle:()=>{},onOpenConfig:()=>{},canManageSettings:false,
   currentUser:{email:'fixture@example.com',role:'user'},themePreference:'dark',onThemeChange:()=>{},onSignOut:()=>{},
   onToggleComplete:()=>{},completionSavingId:null,onDeleteArticle:()=>{throw new Error('Unexpected deletion')},deletingArticleId:null
  })}));
  expect(markup).toContain('Added campaign');expect(markup).toContain('Empty campaign');
  expect(markup.match(/aria-expanded="false" aria-controls="campaign-/g)).toHaveLength(2);
  expect(markup).not.toContain('Hidden child');expect(markup).toContain('Accessible old article');
 } finally { Reflect.deleteProperty(globalThis,'localStorage'); }
});

test('campaign articles have per-item deletion and plan history supports delete or archive',async({page})=>{
 const writes:string[]=[];
 let archiveStatus='ready';
 let emptyDeleted=false;
 await page.route('**/api/content-plans**',async route=>{
  const request=route.request();
  if(request.method()==='PATCH'){
   writes.push('archive');
   archiveStatus='archived';
   return route.fulfill({json:{plan:{...plan('campaign-a','Added campaign'),status:archiveStatus}}});
  }
  if(request.method()==='DELETE'){
   writes.push('delete');
   emptyDeleted=true;
   return route.fulfill({json:{ok:true}});
  }
  await route.fulfill({json:[{...plan('campaign-a','Added campaign'),status:archiveStatus},...(emptyDeleted?[]:[plan('empty','Empty campaign')])]});
 });
 page.on('dialog', dialog=>dialog.accept());
 await open(page);
 await page.getByRole('button',{name:'Added campaign'}).click();
 await page.getByRole('button',{name:'Delete article: Single article',exact:true}).click();
 await expect(page.getByTestId('campaign-deleted')).toHaveText('single');
 await page.getByRole('button',{name:'Delete article: Batch article',exact:true}).click();
 await expect(page.getByTestId('campaign-deleted')).toHaveText('batch');
 await page.locator('.activity-launcher').getByRole('button',{name:'Content Plan history',exact:true}).click();
 await page.getByRole('button',{name:'Archive Content Plan: Added campaign',exact:true}).click();
 await expect(page.getByRole('button',{name:'Archive Content Plan: Added campaign',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Delete Content Plan: Empty campaign',exact:true}).click();
 await expect(page.getByRole('button',{name:'Delete Content Plan: Empty campaign',exact:true})).toHaveCount(0);
 expect(writes).toEqual(['archive','delete']);
});
