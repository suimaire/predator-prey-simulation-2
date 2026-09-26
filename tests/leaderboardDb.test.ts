import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const sql = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = sql('supabase/schema.sql');
const expand = sql('supabase/migrations/20260922_leaderboard_schools_v2.sql');
const finalize = sql('supabase/manual-cutover/20260922_finalize_leaderboard_v2.sql');
const legacy = sql('tests/fixtures/leaderboard-legacy.sql');
const publicColumns = ['id', 'challenge_id', 'simulation_version', 'seed', 'score', 'school_name', 'display_name', 'submitted_at', 'board_group', 'is_hafs'];

async function database(old = false) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;`);
  await db.exec(old ? legacy : schema);
  return db;
}
async function asRole(db: PGlite, role: string, run: () => Promise<unknown>) {
  await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec('reset role'); }
}
let serial = 0;
function row(overrides: Record<string, unknown> = {}) {
  serial++;
  return { challenge_id: 'apex-survival', simulation_version: 'apex-v1', seed: 260903, score: 900,
    parameter_snapshot: { synthetic: true }, student_number: `00${serial}`, student_name: '홍길동',
    achieved_at: new Date().toISOString(), payload_hash: serial.toString(16).padStart(64, '0'), school_name: 'HAFS', ...overrides };
}
async function insert(db: PGlite, values = row()) {
  const keys = Object.keys(values);
  await db.query(`insert into public.apex_leaderboard (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map(key => values[key]));
}
const all = async (db: PGlite) => (await db.query('select * from public.apex_leaderboard order by id')).rows;
const visible = async (db: PGlite) => (await db.query('select * from public.apex_leaderboard_public_v2 order by score desc, submitted_at, id')).rows;
async function expectRollback(db: PGlite, statement: string, pattern: RegExp) {
  await assert.rejects(db.exec(statement), pattern);
  await db.exec('rollback');
}

test('PostgreSQL fresh install: real anon/authenticated permissions and return-minimal INSERT', async () => {
  const db = await database();
  try {
    for (const role of ['anon', 'authenticated']) {
      await asRole(db, role, async () => {
        await insert(db);
        assert.deepEqual(Object.keys((await visible(db))[0]!), publicColumns);
        for (const field of ['student_number', 'student_name', 'school_key', 'parameter_snapshot', 'payload_hash', 'achieved_at', 'verification', 'verified_score', 'verified_at', 'verifier_version']) {
          await assert.rejects(db.query(`select ${field} from public.apex_leaderboard_public_v2`), /does not exist/);
        }
        for (const statement of ['select * from public.apex_leaderboard', 'update public.apex_leaderboard set score=0',
          'delete from public.apex_leaderboard', 'select * from public.apex_school_aliases',
          "insert into public.apex_school_aliases values ('fake','hafs')", "update public.apex_schools set display_name='fake'",
          'delete from public.apex_school_aliases', "select * from public.apex_resolve_school('HAFS')",
          'select public.apex_leaderboard_rate_limit()', 'select public.apex_leaderboard_resolve_school()']) {
          await assert.rejects(db.exec(statement), /permission denied/);
        }
        for (const [field, value] of Object.entries({ school_key: 'hafs', board_group: 'manipulator', submitted_at: new Date().toISOString(),
          created_at: new Date().toISOString(), verification: 'verified', verified_score: 999, verified_at: new Date().toISOString(), verifier_version: 'fake' })) {
          await assert.rejects(insert(db, row({ [field]: value })), /permission denied/);
        }
        const omitted = row(); delete omitted.school_name;
        await assert.rejects(insert(db, omitted), /School name required/);
        await assert.rejects(insert(db, row({ school_name: '' })), /School name required/);
      });
    }
    assert.equal((await all(db)).length, 2);
    await db.exec(schema); // Reinstall cannot resurrect the legacy private endpoint.
    assert.equal((await db.query("select to_regclass('public.apex_leaderboard_public') as legacy")).rows[0]!.legacy, null);
    const triggers = (await db.query("select tgname from pg_trigger where tgrelid='public.apex_leaderboard'::regclass and not tgisinternal order by tgname")).rows;
    assert.deepEqual(triggers.map(t => t.tgname), ['apex_10_resolve_school', 'apex_20_rate_limit']);
    await db.exec(sql('supabase/verification/leaderboard_v2.sql'));
  } finally { await db.close(); }
});

test('registry aliases, namespaces, 80 code points, normalized identity and name-independent duplicate protection', async () => {
  const db = await database();
  try {
    for (const alias of [' HAFS ', 'hAfS', '외대부고', '용인외대부고', '한국외대부고', '용인한국외대부고', '한국외국어대학교부설고등학교', '용인한국외국어대학교부설고등학교']) {
      await insert(db, row({ school_name: alias }));
    }
    assert.ok((await all(db)).every(r => r.school_key === 'hafs' && r.school_name === 'HAFS'));
    const common = row({ student_number: ' 00A  B ', school_name: '새  학교', created_at: '2026-01-01' });
    await insert(db, common);
    await assert.rejects(insert(db, { ...common, student_number: '00a b', student_name: '다른이름', school_name: ' 새\t학교 ' }), /duplicate key/);
    await insert(db, { ...common, school_name: '타교' });
    for (const name of ['school:known', 'free:hafs', '가'.repeat(80), '😀'.repeat(80)]) await insert(db, row({ school_name: name }));
    await assert.rejects(insert(db, row({ school_name: '가'.repeat(81) })), /School name required/);
    const stored = await all(db);
    assert.ok(stored.some(r => r.school_key === 'free:school:known'));
    assert.ok(stored.some(r => r.school_key === 'free:free:hafs'));
    assert.ok(stored.some(r => r.school_key === 'free:' + '가'.repeat(80)));
    assert.ok(stored.some(r => r.student_number === ' 00A  B '));
    const normalization = (await db.query("select public.apex_normalize_student_number(' 00A  B ') as value")).rows[0];
    assert.equal(normalization!.value, '00a b');
    for (const whitespace of ['\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u1680', '\u2000', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff']) {
      const input = `${whitespace}새${whitespace}${whitespace}학교${whitespace}`;
      assert.equal((await db.query('select public.apex_clean_school_name($1) as name', [input])).rows[0]!.name, input.replace(/\s+/gu, ' ').trim());
    }
    await db.exec("insert into public.apex_schools values ('school:new','새 학교'); insert into public.apex_school_aliases values ('새 학교','school:new')");
    assert.ok((await all(db)).some(r => r.school_key === 'free:새 학교'), 'new aliases do not re-key old records');
    await assert.rejects(db.exec("update public.apex_leaderboard set school_key='hafs' where school_name='타교'"), /Direct school_key update forbidden/);
    await db.exec("update public.apex_leaderboard set school_name='용인외대부고' where school_name='school:known'");
    assert.ok(!(await all(db)).some(r => r.school_key === 'free:school:known'));
  } finally { await db.close(); }
});

test('rate limit remains ten per minute, shared by HAFS aliases but isolated from other schools', async () => {
  const db = await database();
  try {
    for (let i = 0; i < 10; i++) await insert(db, row({ school_name: i % 2 ? '외대부고' : 'HAFS', student_number: '001Ab' }));
    await assert.rejects(insert(db, row({ school_name: 'hAfS', student_number: ' 001ab ' })), /Submission rate limit/);
    await insert(db, row({ school_name: '다른 학교', student_number: '001Ab' }));
    await insert(db, row({ school_name: 'HAFS', student_number: '1Ab' }));
  } finally { await db.close(); }
});

test('DB owns representative selection, RED TEAM scope, hidden restoration, ties and Unicode masking', async () => {
  const db = await database();
  try {
    const identity = { student_number: '007', created_at: '2026-01-01', submitted_at: '2026-01-01' };
    await insert(db, row({ ...identity, score: 900 }));
    await insert(db, row({ ...identity, score: 999, student_name: '이름변경' }));
    await insert(db, row({ ...identity, score: 2, board_group: 'manipulator' }));
    await insert(db, row({ ...identity, school_name: '타교', score: 700 }));
    for (const scope of [{ seed: 1 }, { simulation_version: 'other' }, { challenge_id: 'other' }]) {
      await insert(db, row({ ...identity, ...scope, score: 800 }));
    }
    assert.equal((await visible(db)).length, 5);
    assert.ok(!(await visible(db)).some(r => r.score === 999 || r.score === 900));
    await db.exec("update public.apex_leaderboard set board_group='hidden' where board_group='manipulator'");
    assert.ok((await visible(db)).some(r => r.score === 999));
    await db.exec("update public.apex_leaderboard set board_group='protector' where board_group='hidden'");
    assert.ok((await visible(db)).some(r => r.score === 999));
    assert.ok(!(await visible(db)).some(r => r.score === 2));
    await db.exec("update public.apex_leaderboard set board_group='hidden' where score=999");
    assert.ok((await visible(db)).some(r => r.score === 900));
    for (const [name, masked] of [['홍길동', '홍○동'], ['김철수', '김○수'], ['박준', '박○'], ['제갈공명', '제○○명'], ['김', '○'], ['  홍\t길\n동  ', '홍○동'], ['😀가😀', '😀○😀'], ['A\u0301B', 'A○B']]) {
      assert.equal((await db.query('select public.apex_mask_name($1) as n', [name])).rows[0]!.n, masked);
    }
    const fixed = { student_number: 'tie', created_at: '2026-01-01', score: 1000 };
    for (const [id, submitted_at] of [['00000000-0000-0000-0000-000000000003', '2026-02-01'], ['00000000-0000-0000-0000-000000000002', '2026-01-01'], ['00000000-0000-0000-0000-000000000001', '2026-01-01']]) {
      await insert(db, row({ ...fixed, id, submitted_at }));
    }
    assert.equal((await visible(db))[0]!.id, '00000000-0000-0000-0000-000000000001');
  } finally { await db.close(); }
});

test('upgrade refuses unconfirmed provenance; approved backfill preserves EVERY original field and final contract matches fresh install', async () => {
  const db = await database(true);
  const fresh = await database();
  try {
    for (const board of ['protector', 'manipulator', 'hidden']) {
      const old = row({ board_group: board, created_at: '2026-01-01', verification: 'verified', verified_score: 888, verified_at: '2026-01-01', verifier_version: 'synthetic' });
      delete old.school_name; await insert(db, old);
    }
    await db.exec(sql('supabase/preflight/leaderboard_v2.sql'));
    const before = await all(db);
    await expectRollback(db, expand, /provenance unconfirmed/);
    assert.deepEqual(await all(db), before);
    await db.exec("set apex.legacy_all_hafs_confirmed='yes'");
    await db.exec(expand);
    const after = await all(db);
    assert.deepEqual(after.map(({ school_name, school_key, ...old }) => old), before);
    assert.ok(after.every(r => r.school_name === 'HAFS' && r.school_key === 'hafs'));
    await asRole(db, 'anon', () => db.query('select * from public.apex_leaderboard_public')); // still open during expand
    await expectRollback(db, schema, /Existing legacy database/);
    await expectRollback(db, finalize, /Confirm deployed v2 frontend/);
    await db.exec("set apex.frontend_v2_confirmed='yes'");
    await db.exec(finalize);
    await db.exec(sql('supabase/verification/leaderboard_v2.sql'));
    await asRole(db, 'anon', () => assert.rejects(db.query('select * from public.apex_leaderboard_public'), /does not exist/));
    await db.exec(schema);
    await db.exec(schema);
    const contract = async (d: PGlite) => (await d.query(`select c.relname, a.attname, format_type(a.atttypid,a.atttypmod) as type,
      a.attnotnull, pg_get_expr(ad.adbin,ad.adrelid) as default_value from pg_class c join pg_attribute a on a.attrelid=c.oid
      left join pg_attrdef ad on ad.adrelid=c.oid and ad.adnum=a.attnum where c.oid in
      ('public.apex_leaderboard'::regclass,'public.apex_leaderboard_public_v2'::regclass) and a.attnum>0 and not a.attisdropped order by 1,2`)).rows;
    assert.deepEqual(await contract(db), await contract(fresh));
    for (const query of [
      "select pg_get_viewdef('public.apex_leaderboard_public_v2'::regclass) as definition",
      "select indexname,indexdef from pg_indexes where schemaname='public' and tablename='apex_leaderboard' order by indexname",
      "select policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='apex_leaderboard' order by policyname",
      "select tgname,pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.apex_leaderboard'::regclass and not tgisinternal order by tgname",
      "select relname,relowner::regrole::text,relacl::text,reloptions from pg_class where oid in ('public.apex_leaderboard'::regclass,'public.apex_leaderboard_public_v2'::regclass) order by relname",
    ]) assert.deepEqual((await db.query(query)).rows, (await fresh.query(query)).rows);
    assert.deepEqual((await all(db)).map(({ school_name, school_key, ...old }) => old), before);
  } finally { await db.close(); await fresh.close(); }
});

test('partial existing school data is preserved, key-only requires mapping, and duplicate collision rolls back without deletion', async () => {
  const db = await database(true);
  try {
    await db.exec('alter table public.apex_leaderboard add school_name text; alter table public.apex_leaderboard add school_key text');
    await insert(db, row({ school_name: '다른 학교', school_key: 'free:다른 학교' }));
    await insert(db, row({ school_name: '타교', school_key: null }));
    await insert(db, row({ school_name: null, school_key: 'hafs' }));
    await insert(db, row({ school_name: null, school_key: null }));
    const before = await all(db);
    await db.exec("set apex.legacy_all_hafs_confirmed='yes'");
    await expectRollback(db, expand, /Partial school row/);
    assert.deepEqual(await all(db), before);
    await db.exec('create temporary table apex_v2_school_mapping(id uuid primary key,school_name text not null)');
    await db.query("insert into apex_v2_school_mapping values ($1,'HAFS')", [before.find(r => r.school_name === null && r.school_key === 'hafs')!.id]);
    await db.query("insert into apex_v2_school_mapping values ($1,'확인된 타교')", [before.find(r => r.school_name === null && r.school_key === null)!.id]);
    await db.exec(expand);
    assert.ok((await all(db)).some(r => r.school_name === '다른 학교' && r.school_key === 'free:다른 학교'));
    assert.ok((await all(db)).some(r => r.school_name === '타교' && r.school_key === 'free:타교'));
    assert.ok((await all(db)).some(r => r.school_name === '확인된 타교' && r.school_key === 'free:확인된 타교'));
  } finally { await db.close(); }
  const duplicate = await database(true);
  try {
    const a = row({ student_number: ' Ab01 ', created_at: '2026-01-01' }); delete a.school_name;
    await insert(duplicate, a); await insert(duplicate, { ...a, student_number: 'ab01' });
    const before = await all(duplicate);
    await duplicate.exec("set apex.legacy_all_hafs_confirmed='yes'");
    await expectRollback(duplicate, expand, /Normalized submission collision/);
    assert.deepEqual(await all(duplicate), before);
    assert.ok((await duplicate.query("select indexdef from pg_indexes where indexname='apex_leaderboard_dedupe_idx'")).rows[0]);
  } finally { await duplicate.close(); }
});

test('registry conflicts, unknown triggers and inherited privileges fail closed without changing unrelated roles', async () => {
  const db = await database();
  try {
    await db.exec("insert into public.apex_schools values ('school:other','Other'); update public.apex_school_aliases set school_key='school:other' where alias_key='hafs'");
    await expectRollback(db, expand, /HAFS alias conflict/);
    await db.exec("update public.apex_school_aliases set school_key='hafs' where alias_key='hafs'");
    await db.exec('create trigger draft_resolver before insert on public.apex_leaderboard for each row execute function public.apex_leaderboard_resolve_school()');
    await expectRollback(db, expand, /Unexpected leaderboard trigger/);
    await db.exec('drop trigger draft_resolver on public.apex_leaderboard; create role old_reader; grant old_reader to anon; grant select on public.apex_leaderboard to old_reader');
    await expectRollback(db, expand, /Unexpected effective table privileges/);
    assert.equal((await db.query("select has_table_privilege('old_reader','public.apex_leaderboard','SELECT') as allowed")).rows[0]!.allowed, true);
  } finally { await db.close(); }
});
