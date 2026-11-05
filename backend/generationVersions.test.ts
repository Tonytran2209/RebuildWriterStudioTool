import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {insertStageRevision} from './postgres.js';

// Uses the repository adapter and an isolated SQL engine; never contacts production.
test('offline revision persistence: retry, identical output, frozen snapshots and independent stages',async()=>{
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
  assert.equal(retry?.id,saved?.id);
  assert.deepEqual(retry?.output_snapshot,first.output_snapshot);
  const next=await insertStageRevision({...first,input_fingerprint:'generation-two',output_snapshot:{generationId:'two',markdown:'Identical draft'}},pool);
  assert.equal(next?.revision_number,2);
  await insertStageRevision({article_id:'synthetic',stage:'outline',input_fingerprint:'outline-new',output_snapshot:{sections:[]}},pool);
  assert.equal((await db.query("SELECT * FROM writer_studio.article_stage_runs WHERE stage='draft'")).rows.length,2);
 } finally { await db.close(); }
});
