import { jobHistoryWindows } from "./jobHistory.ts"
import { performance } from "node:perf_hooks"
import { database } from "./postgres.ts"
// Fixed aggregate SQL only. No article content, user identity or credentials leave this module.
export async function readMonitoringData(
  since: string,
  override?: ReturnType<typeof database>,
) {
  if (process.env.DATABASE_PROVIDER !== "postgres")
    return {
      buckets: [],
      inventory: undefined,
      jobHistory: null,
      jobHistoryAllTime: null,
      database: { status: "unsupported" },
      articles: null,
      plans: null,
      ledger: null,
      complete: false,
    }
  const db = override ?? database(),
    start = performance.now()
  const client = await db.connect()
  try {
    await client.query("BEGIN READ ONLY")
    await client.query("SET LOCAL statement_timeout='4000'")
    const exists = async (table: string) =>
      (
        await client.query("SELECT to_regclass($1) IS NOT NULL AS ok", [
          "writer_studio." + table,
        ])
      ).rows[0].ok
    const buckets = (
      await client.query(
        "SELECT key,value FROM writer_studio.kv_store WHERE key LIKE 'lab-monitor:v1:%' AND value->>'hour'>=$1 ORDER BY key LIMIT 10001",
        [since],
      )
    ).rows
    const taskRows=(await client.query("SELECT key,value FROM writer_studio.kv_store WHERE key LIKE 'lab-task:v1:%' AND value->>'startedAt'>=$1 ORDER BY value->>'startedAt' DESC LIMIT 1001",[since])).rows;
    let historicalTasks:any[]=[];
    if(await exists('article_stage_runs')) historicalTasks=(await client.query(`SELECT id::text AS id,article_id AS "entityId",stage AS label,status,created_at AS "startedAt",input_tokens AS "inputTokens",output_tokens AS "outputTokens",cost_usd::float8 AS "knownCostUsd",model FROM writer_studio.article_stage_runs WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 1001`,[since])).rows.map(r=>({...r,kind:'historical-stage',coverage:'Saved final-result usage; may omit retries and cache attribution'}));
    let articles: any = null,
      plans: any = null,
      ledger: any = null
    const inventory: Record<string, any> = {}
    if (await exists("writer_articles")) {
      const rows = await client.query(`WITH candidates AS (
 SELECT value->>'id' AS id,COALESCE(value->>'status','unknown') AS status,1 AS priority FROM writer_studio.kv_store WHERE key LIKE 'writer:article:%' AND value->>'id' IS NOT NULL
 UNION ALL SELECT item->>'id',COALESCE(item->>'status','unknown'),2 FROM writer_studio.kv_store CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(value)='array' THEN value ELSE '[]'::jsonb END) item WHERE key='writer:articles'
 UNION ALL SELECT id::text,COALESCE(payload->>'status',status,'unknown'),3 FROM writer_studio.writer_articles), dedup AS (SELECT DISTINCT ON(id) id,status FROM candidates WHERE id IS NOT NULL ORDER BY id,priority) SELECT status,count(*)::int AS count FROM dedup GROUP BY status`)
      articles = {
        total: rows.rows.reduce((n: number, r: any) => n + r.count, 0),
        byStatus: rows.rows,
        scope: "current inventory; deduplicated KV and relational records",
      }
    }
    if (await exists("content_plans"))
      plans = {
        total: Number(
          (
            await client.query(
              "SELECT count(*) AS count FROM writer_studio.content_plans",
            )
          ).rows[0].count,
        ),
        scope: "relational records",
      }
    const usageQueries: string[] = []
    if (await exists("writer_ai_usage")) {
      usageQueries.push(`SELECT called_at AS recorded_at, input_tokens, output_tokens, cost_usd
        FROM writer_studio.writer_ai_usage WHERE called_at >= $1 AND NOT cache_hit`)
      const rows = (
        await client.query(
          `SELECT provider,model,step,count(*)::int AS records,count(*) FILTER(WHERE cache_hit)::int AS cache_hits,count(*) FILTER(WHERE NOT cache_hit)::int AS calls,COALESCE(sum(input_tokens) FILTER(WHERE NOT cache_hit),0)::float8 AS input_tokens,COALESCE(sum(cached_input_tokens) FILTER(WHERE NOT cache_hit),0)::float8 AS cached_input_tokens,COALESCE(sum(output_tokens) FILTER(WHERE NOT cache_hit),0)::float8 AS output_tokens,sum(cost_usd) FILTER(WHERE NOT cache_hit)::float8 AS known_cost_usd,count(*) FILTER(WHERE NOT cache_hit AND cost_usd IS NOT NULL)::int AS priced_calls FROM writer_studio.writer_ai_usage WHERE called_at >= $1 GROUP BY provider,model,step`,
          [since],
        )
      ).rows
      ledger = {
        source: "writer_ai_usage",
        scope:
          "historically recorded workflow usage; separate from dispatcher telemetry; not additive",
        models: rows,
      }
    }
    for (const table of [
      "content_plan_items",
      "article_stage_runs",
      "batch_jobs",
      "batch_job_items",
      "quality_gate_runs",
      "editorial_approvals",
      "website_content_inventory",
    ] as const) {
      if (await exists(table))
        inventory[table] = (
          await client.query(
            `SELECT status,count(*)::int AS count FROM writer_studio.${table} GROUP BY status`,
          )
        ).rows
      else inventory[table] = null
    }
    // Writer keeps the latest terminal state per batch article, not every retry.
    const jobLimit = 10000
    const history = await exists("batch_job_items") && await exists("writer_articles")
      ? jobHistoryWindows((await client.query(
        `SELECT 'Writer batch article' AS job,
           CASE a.content_group WHEN 'editorial_originality' THEN '1 editorial article'
             WHEN 'comparison_seo' THEN '1 SEO article' ELSE '1 batch article' END AS workload,
           b.status,
           (b.status = 'completed' AND a.status = 'done' AND NULLIF(btrim(a.draft), '') IS NOT NULL) AS valid,
           a.payload->>'batchStartedAt' AS "startedAt",
           CASE WHEN b.status = 'completed' THEN a.completed_at END AS "endedAt",
           CASE WHEN b.status = 'completed' THEN COALESCE(a.completed_at, b.updated_at) ELSE b.updated_at END AS "recordedAt",
           b.error_message AS error
         FROM writer_studio.batch_job_items b
         LEFT JOIN writer_studio.writer_articles a ON a.id = b.article_id AND a.activity_id = b.batch_job_id
         WHERE b.status IN ('completed', 'failed')
         ORDER BY "recordedAt" DESC NULLS LAST, b.id LIMIT $1`, [jobLimit + 1],
      )).rows, since, jobLimit)
      : { jobHistory: null, jobHistoryAllTime: null }
    await client.query("COMMIT")
    if (ledger && usageQueries.length) {
      ledger.timeline = (await client.query(`
        SELECT date_trunc('hour', recorded_at, 'UTC') AS hour,
          count(*)::int AS calls,
          count(*) FILTER (WHERE input_tokens IS NOT NULL AND output_tokens IS NOT NULL)::int AS "usageSamples",
          count(cost_usd)::int AS "pricedCalls",
          sum(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0))::float8 AS "totalTokens",
          sum(cost_usd)::float8 AS "knownCostUsd"
        FROM (${usageQueries.join(" UNION ALL ")}) usage
        GROUP BY 1 ORDER BY 1`, [since])).rows
    }
    return {
      buckets: buckets.slice(0, 10000),
      ...history,
      taskRows:taskRows.slice(0,1000),
      historicalTasks:historicalTasks.slice(0,1000),
      taskReadComplete:taskRows.length<=1000&&historicalTasks.length<=1000,
      database: {
        status: "ready",
        responseMs: performance.now() - start,
        poolTotal: db.totalCount,
        poolIdle: db.idleCount,
        poolWaiting: db.waitingCount,
      },
      articles,
      plans,
      ledger,
      inventory,
      complete: buckets.length <= 10000,
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
