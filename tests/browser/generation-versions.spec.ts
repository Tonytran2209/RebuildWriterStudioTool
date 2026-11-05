import {test as playwrightTest} from '@playwright/test';
const offlineTest = process.env.NODE_TEST_CONTEXT ? (await import('node:test')).test : playwrightTest;
import {createRequire} from 'node:module';
import {insertStageRevision} from '../../backend/postgres';

// Uses the repository adapter and an isolated SQL engine; never contacts production.
offlineTest('offline revision persistence: retry, identical output, frozen snapshots and independent stages',async()=>{
 const requireBackend=createRequire(new URL('../../backend/package.json',import.meta.url));
 const {PGlite}=requireBackend('@electric-sql/pglite');
 const db=new PGlite();
 try {
  await db.exec(`CREATE SCHEMA writer_studio;
   CREATE TABLE writer_studio.article_stage_runs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY, article_id text, stage text,
    revision_number integer, input_fingerprint text, output_snapshot jsonb,
    UNIQUE(article_id,stage,revision_number), UNIQUE(article_id,stage,input_fingerprint));`);
  const client={query:async(sql:string,values?:any[])=>{const result=await db.query(sql,values);return {...result,rowCount:result.rows.length};},release(){}};
  const pool={connect:async()=>client} as any;
  const first={article_id:'synthetic',stage:'draft',input_fingerprint:'generation-one',output_snapshot:{generationId:'one',markdown:'Identical draft'}};
  const saved=await insertStageRevision(first,pool);
  const retry=await insertStageRevision({...first,output_snapshot:{generationId:'one',markdown:'Later autosave/QC must not replace snapshot'}},pool);
  expect(retry?.id).toBe(saved?.id);
  expect(retry?.output_snapshot).toEqual(first.output_snapshot);
  const next=await insertStageRevision({...first,input_fingerprint:'generation-two',output_snapshot:{generationId:'two',markdown:'Identical draft'}},pool);
  expect(next?.revision_number).toBe(2);
  await insertStageRevision({article_id:'synthetic',stage:'outline',input_fingerprint:'outline-new',output_snapshot:{sections:[]}},pool);
  expect((await db.query("SELECT * FROM writer_studio.article_stage_runs WHERE stage='draft'")).rows).toHaveLength(2);
 } finally { await db.close(); }
});

import {test,expect} from './browser-fixture';

// Synthetic contract records, not a reproduction of production data.
const stages=(articleId:string)=>['outline','draft'].flatMap(stage=>[1,2].map(revision=>({
 id:`${articleId}-${stage}-${revision}`,article_id:articleId,stage,revision_number:revision,
 created_at:`2026-11-05T07:0${revision}:00Z`,output_snapshot:{generationId:`generation-${revision}`,
 ...(stage==='draft'?{markdown:'Identical generated draft'}:{sections:[{id:'section',heading:'Identical generated outline',notes:'Frozen notes'}]})},
})));

if (!process.env.NODE_TEST_CONTEXT) {
test('saved versions remain distinct for identical output; viewing and reload preserve current content',async({page})=>{
 await page.route('**/api/articles/*/stages',route=>route.fulfill({json:{stages:stages('versions-0')}}));
 await page.goto('/?versions');
 for(const stage of ['outline','draft']){
  await page.getByRole('button',{name:`Xem lịch sử ${stage}`,exact:true}).click();
  const region=page.getByRole('region',{name:`Lịch sử ${stage}`,exact:true});
  await expect(region.locator('option')).toHaveCount(3);
  for(const revision of [1,2]){
   await region.getByRole('combobox').selectOption(`versions-0-${stage}-${revision}`);
   await expect(region.getByTestId('generation-preview')).toContainText(stage==='draft'?'Identical generated draft':'Frozen notes');
  }
  await region.getByRole('combobox').selectOption('');
  await expect(region.getByTestId('generation-preview')).toHaveCount(0);
 }
 await expect(page.getByTestId('version-current')).toHaveText('Saved draft 0');
 await expect(page.getByTestId('version-updates')).toHaveText('[]');
 await page.getByRole('button',{name:/Chỉnh sửa toàn bộ bản nháp|Edit full draft/}).click();
 const editor=page.locator('[contenteditable=true]');
 await editor.fill('Pending current editor changes');
 const draftRegion=page.getByRole('region',{name:'Lịch sử draft',exact:true});
 await draftRegion.getByRole('combobox').selectOption('versions-0-draft-1');
 await expect(editor).toHaveText('Pending current editor changes');
 await page.reload();
 await page.getByRole('button',{name:'Xem lịch sử draft',exact:true}).click();
 await expect(page.getByRole('region',{name:'Lịch sử draft',exact:true}).locator('option')).toHaveCount(3);
 await expect(page.getByTestId('version-current')).toHaveText('Saved draft 0');
});

test('history errors retain current content and offer retry; article switches discard old responses',async({page})=>{
 let fail=true;
 await page.route('**/api/articles/*/stages',async route=>{
  if(route.request().url().includes('versions-0')){
   if(fail)return route.fulfill({status:503,json:{error:'History unavailable'}});
   await new Promise(resolve=>setTimeout(resolve,350));
   return route.fulfill({json:{stages:stages('versions-0')}});
  }
  return route.fulfill({json:{stages:[]}});
 });
 await page.goto('/?versions');
 await page.getByRole('button',{name:'Xem lịch sử draft',exact:true}).click();
 const region=page.getByRole('region',{name:'Lịch sử draft',exact:true});
 await expect(region.getByRole('alert')).toBeVisible();
 await expect(page.getByTestId('version-current')).toHaveText('Saved draft 0');
 fail=false;
 await region.getByRole('button',{name:'Tải lại lịch sử'}).click();
 await page.getByRole('button',{name:'Switch article'}).click();
 await page.getByRole('button',{name:'Xem lịch sử draft',exact:true}).click();
 await expect(region).toContainText('Chưa có phiên bản đã lưu.');
 await expect(region.locator('option')).toHaveCount(1);
 await expect(page.getByTestId('version-updates')).toHaveText('[]');
});

}
