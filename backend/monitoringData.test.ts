import test from "node:test"
import assert from "node:assert/strict"
import { PGlite } from "@electric-sql/pglite"
import { readMonitoringData } from "./monitoringData.ts"
test("read-only aggregates deduplicate actual storage precedence and separate cached ledger records", async () => {
  const db = new PGlite()
  const previous = process.env.DATABASE_PROVIDER
  process.env.DATABASE_PROVIDER = "postgres"
  try {
    await db.exec(`CREATE SCHEMA writer_studio;
 CREATE TABLE writer_studio.kv_store(key text primary key,value jsonb);
 CREATE TABLE writer_studio.writer_articles(id text,status text,payload jsonb);
 CREATE TABLE writer_studio.writer_ai_usage(provider text,model text,step int,input_tokens int,cached_input_tokens int,output_tokens int,cost_usd numeric,cache_hit boolean,called_at timestamptz);
 INSERT INTO writer_studio.writer_articles VALUES ('a','draft','{}'),('b','done','{}');
 ALTER TABLE writer_studio.writer_articles ADD COLUMN title text, ADD COLUMN activity_id text, ADD COLUMN content_group text, ADD COLUMN batch_status text, ADD COLUMN draft text, ADD COLUMN completed_at timestamptz, ADD COLUMN updated_at timestamptz, ADD COLUMN error_message text;
 UPDATE writer_studio.writer_articles SET title='So sánh CRM cho SME', activity_id='batch', content_group='comparison_seo', batch_status='completed', completed_at=date_trunc('second', now()) - interval '1 hour', draft='private',
   payload=jsonb_build_object('batchStartedAt', date_trunc('second', now()) - interval '1 hour 1 second', 'batchStepRuns', jsonb_build_array(
     jsonb_build_object('key','plan','label','Nhận bài từ Content Plan','startedAt', date_trunc('second', now()) - interval '1 hour 1 second','endedAt', date_trunc('second', now()) - interval '1 hour 1 second' + interval '200 milliseconds','status','completed'),
     jsonb_build_object('key','draft','label','Viết draft','startedAt', date_trunc('second', now()) - interval '1 hour 1 second' + interval '200 milliseconds','endedAt', date_trunc('second', now()) - interval '1 hour','status','completed'),
     jsonb_build_object('key','quality','label','Kiểm tra chất lượng','startedAt', date_trunc('second', now()) - interval '1 hour','endedAt', null,'status','running'))) WHERE id='b';
 CREATE TABLE writer_studio.batch_job_items(id text, batch_job_id text, article_id text, status text, updated_at timestamptz, error_message text);
 INSERT INTO writer_studio.batch_job_items VALUES ('item','batch','b','completed','2025-01-01T00:00:01Z',null);
 CREATE TABLE writer_studio.batch_jobs(id text, content_plan_id uuid, status text, total_items int, failed_items int, updated_at timestamptz);
 INSERT INTO writer_studio.batch_jobs VALUES ('batch','00000000-0000-0000-0000-000000000001','completed',1,0,now());
 INSERT INTO writer_studio.kv_store VALUES ('writer:article:a','{"id":"a","status":"done","content":"private"}'),('writer:articles','[{"id":"a","status":"draft"},{"id":"c","status":"draft"}]');
 INSERT INTO writer_studio.writer_ai_usage VALUES ('test','model',1,100,10,20,0.001,false,now()),('test','model',1,100,10,20,0,true,now()),('test','unknown',2,10,0,2,null,false,now());`)
    const client = {
      query: async (sql: string, values?: any[]) => db.query(sql, values),
      release: () => {},
    }
    const pool = {
      connect: async () => client,
      totalCount: 1,
      idleCount: 0,
      waitingCount: 0,
    }
    const result = await readMonitoringData(
      "2020-01-01T00:00:00.000Z",
      pool as any,
    )
    assert.equal(result.articles.total, 3)
    assert.equal(
      result.articles.byStatus.find((s: any) => s.status === "done").count,
      2,
    )
    assert.equal(result.plans, null)
    assert.equal(result.complete, true)
    assert.equal(result.jobHistory?.validCompletions, 1)
    assert.equal(result.jobHistoryAllTime?.executed, 1)
    assert.equal(result.contentWorkload?.articles, 1)
    assert.equal(result.contentWorkload?.averageWords, 1)
    assert.equal(result.jobHistory?.completion[0].p95Ms, 1000)
    // jobRuns: each article is a run named by its article; saved step timings are its sub-jobs.
    const runs = (result as any).jobRuns?.runs ?? []
    assert.equal(runs.some((r: any) => r.job === "Writer batch"), false, "articles are no longer nested under the batch")
    const article = runs.find((r: any) => r.job === "Writer article")
    assert.deepEqual(article && { runId: article.runId, workload: article.workload, status: article.status, parentRunId: article.parentRunId },
      { runId: "item", workload: "1 SEO article · So sánh CRM cho SME", status: "success", parentRunId: undefined })
    const steps = runs.filter((r: any) => r.parentRunId === "item")
    assert.deepEqual(steps.map((r: any) => [r.job, r.parent, r.workload, Date.parse(r.endedAt) - Date.parse(r.startedAt)]).sort(), [
      ["Nhận bài từ Content Plan", "Writer article", "1 SEO article · So sánh CRM cho SME", 200],
      ["Viết draft", "Writer article", "1 SEO article · So sánh CRM cho SME", 800],
    ], "a running step is not reported")
    assert.equal(result.jobHistoryAllTime?.executed, 1, "steps are not counted as jobs")
    const row = result.ledger.models.find((m: any) => m.model === "model")
    assert.equal(row.calls, 1)
    assert.equal(row.cache_hits, 1)
    assert.equal(row.input_tokens, 100)
    assert.equal(row.known_cost_usd, 0.001)
    assert.equal(result.ledger.timeline.reduce((n: number, hour: any) => n + hour.calls, 0), 2)
    assert.equal(result.ledger.timeline.reduce((n: number, hour: any) => n + hour.pricedCalls, 0), 1)
    assert.ok(!JSON.stringify(result).includes("private"))
    assert.equal(
      result.ledger.models.find((m: any) => m.model === "unknown")
        .known_cost_usd,
      null,
    )
  } finally {
    if (previous === undefined) delete process.env.DATABASE_PROVIDER
    else process.env.DATABASE_PROVIDER = previous
    await db.close()
  }
})

test("articles without saved step timings get estimated sub-jobs from AI call times", async () => {
  const db = new PGlite()
  const previous = process.env.DATABASE_PROVIDER
  process.env.DATABASE_PROVIDER = "postgres"
  try {
    await db.exec(`CREATE SCHEMA writer_studio;
 CREATE TABLE writer_studio.kv_store(key text primary key,value jsonb);
 CREATE TABLE writer_studio.writer_articles(id text,status text,payload jsonb,title text,activity_id text,content_group text,draft text,completed_at timestamptz);
 CREATE TABLE writer_studio.batch_job_items(id text, batch_job_id text, article_id text, status text, updated_at timestamptz, error_message text);
 CREATE TABLE writer_studio.writer_ai_usage(id text,article_id text,provider text,model text,step int,input_tokens int,cached_input_tokens int,output_tokens int,cost_usd numeric,cache_hit boolean,called_at timestamptz);
 INSERT INTO writer_studio.writer_articles VALUES
   ('old','done',jsonb_build_object('batchStartedAt', date_trunc('second', now()) - interval '2 hours'),'Old article','b1','comparison_seo','text',date_trunc('second', now()) - interval '1 hour 57 minutes'),
   ('new','done',jsonb_build_object('batchStartedAt', date_trunc('second', now()) - interval '30 minutes','batchStepRuns','[]'::jsonb),'New article','b1','comparison_seo','text',date_trunc('second', now()) - interval '28 minutes');
 INSERT INTO writer_studio.batch_job_items VALUES ('i-old','b1','old','completed',now(),null),('i-new','b1','new','completed',now(),null);
 INSERT INTO writer_studio.writer_ai_usage VALUES
   ('u1','old','openai','gpt-5.4-mini-web-search',2,1,0,1,null,false,date_trunc('second', now()) - interval '2 hours' + interval '10 seconds'),
   ('u2','old','openai','gpt-5.4',2,1,0,1,null,false,date_trunc('second', now()) - interval '2 hours' + interval '40 seconds'),
   ('u3','old','openai','gpt-5.4',3,1,0,1,null,false,date_trunc('second', now()) - interval '2 hours' + interval '80 seconds'),
   ('u4','new','openai','gpt-5.4',3,1,0,1,null,false,date_trunc('second', now()) - interval '29 minutes');`)
    const client = { query: async (sql: string, values?: any[]) => db.query(sql, values), release: () => {} }
    const pool = { connect: async () => client, totalCount: 1, idleCount: 0, waitingCount: 0 }
    const result: any = await readMonitoringData("2020-01-01T00:00:00.000Z", pool as any)
    const runs = result.jobRuns?.runs ?? []
    const old = runs.filter((r: any) => r.parentRunId === "i-old")
    assert.deepEqual(old.map((r: any) => [r.job, Date.parse(r.endedAt) - Date.parse(r.startedAt), r.estimated]).sort(), [
      ["Article Spec & Core Idea", 30000, true],
      ["Lập outline", 40000, true],
      ["Nghiên cứu từ khóa SEO", 10000, true],
      ["Viết draft & kiểm tra chất lượng", 100000, true],
    ])
    assert.equal(runs.some((r: any) => r.parentRunId === "i-new"), false, "an article with saved step timings is never estimated")
    assert.equal(result.jobHistoryAllTime?.executed, 2, "estimated steps are not counted as jobs")
  } finally {
    if (previous === undefined) delete process.env.DATABASE_PROVIDER
    else process.env.DATABASE_PROVIDER = previous
    await db.close()
  }
})

test("step-by-step articles are reported as runs with measured steps and summed processing time", async () => {
  const db = new PGlite()
  const previous = process.env.DATABASE_PROVIDER
  process.env.DATABASE_PROVIDER = "postgres"
  try {
    await db.exec(`CREATE SCHEMA writer_studio;
 CREATE TABLE writer_studio.kv_store(key text primary key,value jsonb);
 CREATE TABLE writer_studio.writer_articles(id text,status text,payload jsonb,title text,activity_id text,content_group text,draft text,completed_at timestamptz,updated_at timestamptz);
 CREATE TABLE writer_studio.batch_job_items(id text, batch_job_id text, article_id text, status text, updated_at timestamptz, error_message text);
 INSERT INTO writer_studio.writer_articles VALUES
   ('s1','review',jsonb_build_object('activityKind','single','aiUsageByStep',jsonb_build_object(
      '2', jsonb_build_array(
        jsonb_build_object('step',2,'purpose','seo-research','calledAt',to_char(now() - interval '50 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'durationMs',8000),
        jsonb_build_object('step',2,'purpose','generation','calledAt',to_char(now() - interval '49 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'durationMs',30000)),
      '4', jsonb_build_array(
        jsonb_build_object('step',4,'purpose','generation','calledAt',to_char(now() - interval '20 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'durationMs',60000),
        jsonb_build_object('step',4,'purpose','recheck','calledAt',to_char(now() - interval '10 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'durationMs',12000)))),
    'Single article','act','comparison_seo','draft text',null,now()),
   ('s-old','review',jsonb_build_object('aiUsageByStep',jsonb_build_object('3', jsonb_build_array(
      jsonb_build_object('step',3,'calledAt',to_char(now() - interval '2 days','YYYY-MM-DD"T"HH24:MI:SS"Z"'))))),
    'Old single','act2','editorial_originality','draft',null,now() - interval '2 days'),
   ('s-nodraft','review','{}','No draft','act3','comparison_seo','',null,now()),
   ('b1','done','{"activityKind":"batch"}','Batch','b','comparison_seo','text',now(),now());
 INSERT INTO writer_studio.batch_job_items VALUES ('i1','b','b1','completed',now(),null);`)
    const client = { query: async (sql: string, values?: any[]) => db.query(sql, values), release: () => {} }
    const pool = { connect: async () => client, totalCount: 1, idleCount: 0, waitingCount: 0 }
    const result: any = await readMonitoringData("2020-01-01T00:00:00.000Z", pool as any)
    const runs = result.jobRuns?.runs ?? []
    const single = runs.find((r: any) => r.runId === "single:s1")
    assert.equal(single.job, "Writer article")
    assert.equal(single.workload, "1 SEO article (từng bước) · Single article")
    assert.equal(Date.parse(single.endedAt) - Date.parse(single.startedAt), 110000, "8s + 30s + 60s + 12s of processing, not the 40 minutes of review")
    const steps = runs.filter((r: any) => r.parentRunId === "single:s1")
    assert.deepEqual(steps.map((r: any) => [r.job, Date.parse(r.endedAt) - Date.parse(r.startedAt)]).sort(), [
      ["Article Spec & Core Idea", 30000], ["Kiểm tra chất lượng", 12000], ["Nghiên cứu từ khóa SEO", 8000], ["Viết draft", 60000]])
    const old = runs.find((r: any) => r.runId === "single:s-old")
    assert.deepEqual([old.workload, old.startedAt], ["1 editorial article (từng bước) · Old single", null], "calls without timing: listed, no time or steps")
    assert.equal(runs.some((r: any) => r.parentRunId === "single:s-old"), false)
    assert.equal(runs.some((r: any) => r.runId === "single:s-nodraft" || r.runId === "single:b1"), false, "no draft or batch articles are not single runs")
  } finally {
    if (previous === undefined) delete process.env.DATABASE_PROVIDER
    else process.env.DATABASE_PROVIDER = previous
    await db.close()
  }
})
