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
 ALTER TABLE writer_studio.writer_articles ADD COLUMN activity_id text, ADD COLUMN content_group text, ADD COLUMN batch_status text, ADD COLUMN draft text, ADD COLUMN completed_at timestamptz, ADD COLUMN updated_at timestamptz, ADD COLUMN error_message text;
 UPDATE writer_studio.writer_articles SET activity_id='batch', batch_status='completed', completed_at='2025-01-01T00:00:01Z', payload='{"batchStartedAt":"2025-01-01T00:00:00Z"}', draft='private' WHERE id='b';
 CREATE TABLE writer_studio.batch_job_items(id text, batch_job_id text, article_id text, status text, updated_at timestamptz, error_message text);
 INSERT INTO writer_studio.batch_job_items VALUES ('item','batch','b','completed','2025-01-01T00:00:01Z',null);
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
    assert.equal(result.jobHistory?.completion[0].p95Ms, 1000)
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
