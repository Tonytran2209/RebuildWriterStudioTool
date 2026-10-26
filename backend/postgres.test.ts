import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { SelectQuery, provider, tableName, insertRow, rowValues, insertStageRevision, selectRows, updateRow, deleteRows, available } from './postgres.ts';
import { validateScope } from './importScope.ts';
import { upload, download, remove, safeDocumentPath } from './documentStorage.ts';
import { migrate } from './dbMigrate.ts';
import { importData } from './dbImport.ts';

test('provider is explicit, safe identifiers and parameterized filters', () => {
  const prior = process.env.DATABASE_PROVIDER;
  delete process.env.DATABASE_PROVIDER;
  assert.equal(provider(), 'supabase');
  process.env.DATABASE_PROVIDER = 'invalid';
  assert.throws(provider);
  if (prior === undefined) delete process.env.DATABASE_PROVIDER; else process.env.DATABASE_PROVIDER = prior;
  assert.throws(() => tableName('auth.users'));
  const query = new SelectQuery().select('id,title').eq('id', "'; DROP TABLE x; --").neq('status', 'done').order('created_at', { ascending: false }).range(2, 4).compile('writer_articles');
  assert.ok(query.text.includes('LIMIT 3 OFFSET 2'));
  assert.ok(!query.text.includes('DROP'));
  assert.deepEqual(query.values, ["'; DROP TABLE x; --", 'done']);
  assert.throws(() => new SelectQuery().select('id; delete'));
});
test('scope fails closed for shared tables, missing ownership and other projects', () => {
  const valid = { project: 'writer-studio', sourceIdentity: 'source/db', targetIdentity: 'target/db', entries: [{ table: 'kv_store', column: 'key', values: ['writer:files'], ownershipEvidence: 'Reviewed file IDs against Writer Studio source plan export' }] };
  assert.equal(validateScope(valid), valid);
  assert.throws(() => validateScope({ ...valid, entries: [{ ...valid.entries[0], ownershipEvidence: '' }] }));
  assert.throws(() => validateScope({ ...valid, entries: [{ ...valid.entries[0], values: ['intercom:config'] }] }));
  assert.throws(() => validateScope({ ...valid, entries: [{ table: 'agent_library_versions', column: 'project_id', values: ['intercom-writer-studio'], ownershipEvidence: 'x' }] }));
});
test('real PostgreSQL engine schema, JSON/array/null, upsert, rollback and revision constraints', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE SCHEMA writer_studio; BEGIN;');
    await db.exec(await readFile(new URL('./migrations/001_writer_studio.sql', import.meta.url), 'utf8'));
    await db.exec('COMMIT');
    const client = { query: async (text: string, values?: any[]) => {
      const result = await db.query(text, values);
      return { ...result, rowCount: result.rows.length };
    } } as any;
    const plan = '00000000-0000-4000-8000-000000000001';
    await insertRow('content_plans', { id: plan, name: 'Plan' }, undefined, client);
    const item = '00000000-0000-4000-8000-000000000002';
    await insertRow('content_plan_items', { id: item, content_plan_id: plan, title: 'Topic', keywords: ['one', 'two'], content_group: 'comparison_seo' }, undefined, client);
    await insertRow('writer_articles', { id: 'a', title: 'Draft', content_plan_id: plan, content_plan_item_id: item, payload: { draft: 'saved', selectedCoreIdeaId: null }, draft: null }, undefined, client);
    assert.equal(await available('writer_articles', client), true);
    await updateRow('writer_articles', 'a', { draft: 'Revised', payload: { draft: 'Revised', tags: ['a', 'b'] } }, client);
    assert.equal((await selectRows('writer_articles', q => q.eq('id', 'a').range(0, 0), client))[0].draft, 'Revised');
    assert.equal((await selectRows('writer_articles', q => q.order('id').range(1, 1), client)).length, 0);
    await assert.rejects(() => updateRow('writer_articles', 'missing', { title: 'x' }, client), /exactly one/);
    await insertRow('kv_store', { key: 'writer:files', value: [{ id: 'file1' }] }, 'key', client);
    assert.deepEqual((await db.query<any>("SELECT value FROM writer_studio.kv_store")).rows[0].value, [{ id: 'file1' }]);
    assert.deepEqual((await db.query<any>('SELECT keywords FROM writer_studio.content_plan_items')).rows[0].keywords, ['one', 'two']);
    await insertRow('editorial_approvals', { article_id: 'a', status: 'approved' }, 'article_id', client);
    await insertRow('editorial_approvals', { article_id: 'a', status: 'pending', approved_at: null }, 'article_id', client);
    await insertRow('editorial_approvals', { article_id: 'a', status: 'approved' }, 'article_id', client);
    for (const [n, fingerprint] of [[1, 'first'], [2, 'regenerated']] as const) await insertRow('article_stage_runs', { article_id: 'a', stage: 'draft', revision_number: n, input_fingerprint: fingerprint, output_snapshot: { markdown: 'text' } }, undefined, client);
    await assert.rejects(() => insertRow('article_stage_runs', { article_id: 'a', stage: 'draft', revision_number: 3, input_fingerprint: 'first' }, undefined, client), /unique/);
    await assert.rejects(() => insertRow('writer_articles', { id: 'b', title: 'Duplicate', content_plan_id: plan, content_plan_item_id: item }, undefined, client), /unique/);
    await assert.rejects(() => insertRow('writer_articles', { id: 'bad', title: 'Bad FK', content_plan_id: '00000000-0000-4000-8000-000000000003' }, undefined, client), /foreign key/);
    await db.exec("BEGIN; SET LOCAL writer_studio.importing='on';");
    await insertRow('kv_store', { key: 'writer:import', value: {}, updated_at: '2020-01-01T00:00:00.123456Z' }, undefined, client);
    assert.match((await db.query<any>("SELECT updated_at::text AS stamp FROM writer_studio.kv_store WHERE key='writer:import'")).rows[0].stamp, /123456/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query<any>("SELECT * FROM writer_studio.kv_store WHERE key='writer:import'")).rows.length, 0);
    await assert.rejects(() => rowValues(client, 'kv_store', { nonexistent: 'x' }), /Unknown column/);
    await deleteRows('writer_articles', 'id', 'a', client);
    assert.equal((await db.query('SELECT * FROM writer_studio.article_stage_runs')).rows.length, 0);
  } finally { await db.close(); }
});
test('filesystem upload/download preserves bytes, refuses overwrite and traversal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'writer-files-'));
  const prior = process.env.DOCUMENT_STORAGE_ROOT;
  process.env.DOCUMENT_STORAGE_ROOT = root;
  try {
    const bytes = Buffer.from([0, 1, 255, 5]);
    await upload('knowledge/id/original.pdf', bytes, 'application/pdf');
    assert.deepEqual(Buffer.from(await (await download('knowledge/id/original.pdf')).arrayBuffer()), bytes);
    await assert.rejects(() => upload('knowledge/id/original.pdf', bytes, 'application/pdf'), /EEXIST/);
    assert.throws(() => safeDocumentPath('../other-app/file'));
    assert.throws(() => safeDocumentPath('/etc/passwd'));
    await remove('knowledge/id/original.pdf');
    await remove('knowledge/id/original.pdf');
  } finally {
    if (prior === undefined) delete process.env.DOCUMENT_STORAGE_ROOT; else process.env.DOCUMENT_STORAGE_ROOT = prior;
    await rm(root, { recursive: true, force: true });
  }
});
test('migration ledger idempotence and snapshot importer dry-run/apply/no-overwrite', async () => {
  const source = new PGlite({ parsers: { 1184: value => value } });
  const target = new PGlite({ parsers: { 1184: value => value } });
  const root = await mkdtemp(path.join(tmpdir(), 'writer-import-'));
  const sourceEnv = process.env.SOURCE_DATABASE_URL, targetEnv = process.env.DATABASE_URL;
  const wrap = (db: PGlite) => {
    const client = {
      query: async (sql: string, values?: any[]) => {
        if (sql.startsWith('SET LOCAL search_path')) { await db.exec(sql); return { rows: [], rowCount: 0 }; }
        const r = await db.query(sql, values);
        return { ...r, rowCount: r.rows.length };
      },
      release() {},
    };
    return { connect: async () => client, end: async () => {} } as any;
  };
  try {
    await migrate(wrap(target));
    await migrate(wrap(target));
    assert.equal((await target.query('SELECT * FROM writer_studio.schema_migrations')).rows.length, 1);
    await source.exec("CREATE TABLE kv_store(key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()); INSERT INTO kv_store VALUES ('writer:files','[{\"id\":\"1\"}]','2020-01-01T00:00:00.123456Z'), ('other:private','{}',now());");
    process.env.SOURCE_DATABASE_URL = 'postgres://unused@source/db';
    process.env.DATABASE_URL = 'postgres://unused@target/db';
    const scope = path.join(root, 'scope.json');
    await writeFile(scope, JSON.stringify({ project: 'writer-studio', sourceIdentity: 'source:5432/db', targetIdentity: 'target:5432/db', entries: [{ table: 'kv_store', column: 'key', values: ['writer:files'], ownershipEvidence: 'Test fixture only' }] }));
    const factory = (url: string | undefined) => wrap(url === process.env.SOURCE_DATABASE_URL ? source : target);
    await importData(['--scope=' + scope], factory);
    assert.equal((await target.query('SELECT * FROM writer_studio.kv_store')).rows.length, 0);
    await importData(['--scope=' + scope, '--apply'], factory);
    assert.equal((await target.query('SELECT * FROM writer_studio.kv_store')).rows.length, 1);
    assert.match((await target.query<any>('SELECT updated_at::text AS stamp FROM writer_studio.kv_store')).rows[0].stamp, /123456/);
    await assert.rejects(() => importData(['--scope=' + scope, '--apply'], factory), /refusing overwrite/);
    assert.equal((await source.query('SELECT * FROM public.kv_store')).rows.length, 2);
    await source.exec("INSERT INTO public.kv_store VALUES ('writer:new','{}',now()); CREATE TABLE public.writer_articles(id text PRIMARY KEY,title text,content_plan_id uuid); INSERT INTO public.writer_articles VALUES ('missing-parent','Draft','00000000-0000-4000-8000-000000000099')");
    await writeFile(scope, JSON.stringify({ project: 'writer-studio', sourceIdentity: 'source:5432/db', targetIdentity: 'target:5432/db', entries: [
      { table: 'kv_store', column: 'key', values: ['writer:new'], ownershipEvidence: 'Test' },
      { table: 'writer_articles', column: 'id', values: ['missing-parent'], ownershipEvidence: 'Test' },
    ] }));
    await assert.rejects(() => importData(['--scope=' + scope, '--apply'], factory), /foreign key/);
    assert.equal((await target.query('SELECT * FROM writer_studio.kv_store')).rows.length, 1);
    assert.equal((await target.query('SELECT * FROM writer_studio.writer_articles')).rows.length, 0);
    await source.exec("CREATE TABLE public.kv_store_48d8062f(key text PRIMARY KEY,value jsonb NOT NULL); INSERT INTO public.kv_store_48d8062f VALUES ('writer:legacy','null'), ('writer:legacy-big','{\"n\":12345678901234567890123456789}')");
    await writeFile(scope, JSON.stringify({ project: 'writer-studio', sourceIdentity: 'source:5432/db', targetIdentity: 'target:5432/db', entries: [{ table: 'kv_store', column: 'key', values: ['writer:legacy', 'writer:legacy-big'], ownershipEvidence: 'Explicit legacy fixture' }] }));
    await importData(['--scope=' + scope, '--legacy', '--apply'], factory);
    assert.equal((await target.query('SELECT * FROM writer_studio.kv_store')).rows.length, 3);
    assert.equal((await target.query<any>("SELECT value::text AS raw FROM writer_studio.kv_store WHERE key='writer:legacy'")).rows[0].raw, 'null');
    assert.match((await target.query<any>("SELECT value::text AS raw FROM writer_studio.kv_store WHERE key='writer:legacy-big'")).rows[0].raw, /12345678901234567890123456789/);
    await target.exec("INSERT INTO writer_studio.writer_articles(id,title) VALUES ('stage-test','Draft')");
    const stage = { article_id: 'stage-test', stage: 'draft', input_fingerprint: 'same', revision_number: 99, output_snapshot: { markdown: 'Draft' } };
    const first = await insertStageRevision(stage, wrap(target));
    const repeat = await insertStageRevision(stage, wrap(target));
    assert.equal(first?.id, repeat?.id);
    assert.equal(first?.revision_number, 1);
    const revised = await insertStageRevision({ ...stage, input_fingerprint: 'new' }, wrap(target));
    assert.equal(revised?.revision_number, 2);
    await target.exec("UPDATE writer_studio.schema_migrations SET checksum='tampered'");
    await assert.rejects(() => migrate(wrap(target)), /checksum mismatch/);
  } finally {
    if (sourceEnv === undefined) delete process.env.SOURCE_DATABASE_URL; else process.env.SOURCE_DATABASE_URL = sourceEnv;
    if (targetEnv === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = targetEnv;
    await source.close(); await target.close(); await rm(root, { recursive: true, force: true });
  }
});
