import assert from 'node:assert/strict';
import test from 'node:test';
import { APEX_CHALLENGE_CONFIG as definition, apexParameters } from '../src/challenge.ts';
import { DEFAULT_PARAMETERS, type SimulationParameters } from '../src/model.ts';
import { canonicalScorePayload, computePayloadHash, createLeaderboardTransport, createSubmission,
  createSupabaseLeaderboardTransport, DEFAULT_LEADERBOARD_LIMIT, loadParticipant, normalizeParticipant,
  PARTICIPANT_LIMITS, PUBLIC_LEADERBOARD_COLUMNS, rankAccentClass, rankEntries, submissionMatchesScore,
  validateParticipant, type LeaderboardScope, type BoardGroup } from '../src/leaderboard.ts';
import { entry, publicRow, fixtureServer, json, uuid } from './fixtures/leaderboardFixtures.ts';

const parameters = apexParameters({ ...DEFAULT_PARAMETERS });
const participant = { schoolName: 'HAFS', studentNumber: '00314', studentName: '홍길동' };
function record(score = 842, snapshot = parameters, achievedAt = '2026-09-03T01:00:00.000Z') {
  return { challengeId: definition.id, simulationVersion: definition.simulationVersion, seed: definition.seed,
    score, parameterSnapshot: snapshot, achievedAt };
}
const config = { url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' };

test('school is required and limited to 80 code points; legacy number/name restrictions and leading zeros remain', () => {
  assert.deepEqual(normalizeParticipant({ schoolName: '  새\t 학교 ', studentNumber: ' 00314 ', studentName: ' 홍  길동 ' }),
    { schoolName: '새 학교', studentNumber: '00314', studentName: '홍 길동' });
  assert.equal(PARTICIPANT_LIMITS.schoolName, 80);
  for (const fields of [{ schoolName: '' }, { schoolName: ' ' }, { schoolName: '가'.repeat(81) }, { schoolName: '😀'.repeat(81) },
    { studentNumber: '' }, { studentNumber: ' ' }, { studentNumber: '9'.repeat(25) }, { studentName: ' ' }, { studentName: '가'.repeat(17) },
    { studentName: '<script>' }, { studentNumber: '<img>' }]) assert.equal(validateParticipant({ ...participant, ...fields }).ok, false);
  for (const fields of [{ schoolName: '가'.repeat(80) }, { schoolName: '😀'.repeat(80) }, { studentNumber: '26-3-014' },
    { studentNumber: 'J-2026-014' }]) assert.equal(validateParticipant({ ...participant, ...fields }).ok, true);
});

test('simulation hash stays byte-compatible with previous HEAD and independent of school, number, name, time and key order', async () => {
  assert.equal(await computePayloadHash(record()), '6cbc2d568b519bf8ea6e8b470fae7e480df64ec378167bd3090a61f993f944fa');
  const shuffled = Object.fromEntries(Object.entries(parameters).reverse()) as SimulationParameters;
  assert.equal(canonicalScorePayload(record()), canonicalScorePayload(record(842, shuffled)));
  assert.equal(await computePayloadHash(record()), await computePayloadHash(record(842, shuffled)));
  const first = await createSubmission(record(), participant);
  const second = await createSubmission(record(842, parameters, '2026-09-04T09:30:00.000Z'), { schoolName: '타교', studentNumber: '10101', studentName: '이바다' });
  assert.equal(first.payloadHash, second.payloadHash);
  assert.equal(await submissionMatchesScore(first), true);
  assert.equal(await submissionMatchesScore({ ...first, score: 843 }), false);
  assert.notEqual(await computePayloadHash(record(843)), first.payloadHash);
  assert.notEqual(await computePayloadHash(record(842, { ...parameters, rabbitBreedProbability: parameters.rabbitBreedProbability + .01 })), first.payloadHash);
  for (const key of ['schoolName', 'schoolKey', 'studentNumber', 'studentName', 'achievedAt']) assert.ok(!canonicalScorePayload(first).includes(key));
});

test('submission is normalized, private fields only POST, no school_key/server fields and return=minimal', async () => {
  const server = fixtureServer([]);
  const transport = createSupabaseLeaderboardTransport(config, server.fetch);
  const submission = await createSubmission(record(), { schoolName: ' 새 학교 ', studentNumber: ' 00314 ', studentName: ' 홍길동 ' });
  assert.equal(submission.schoolName, '새 학교'); assert.equal(submission.studentNumber, '00314');
  assert.notEqual(submission.parameterSnapshot, parameters);
  await transport.submit(submission);
  const call = server.calls[0]!;
  assert.equal(call.url.pathname, '/rest/v1/apex_leaderboard');
  assert.equal((call.init?.headers as Record<string,string>).Prefer, 'return=minimal');
  const body = JSON.parse(call.init!.body as string);
  assert.deepEqual(Object.keys(body).sort(), ['challenge_id', 'simulation_version', 'seed', 'score', 'parameter_snapshot', 'school_name', 'student_number', 'student_name', 'achieved_at', 'payload_hash'].sort());
  assert.equal(body.school_name, '새 학교');
  assert.equal(body.student_number, '00314');
  assert.equal(body.payload_hash, submission.payloadHash);
});

test('public SELECT allowlist, scope filters, fixed board/range and no client identity fields', async () => {
  assert.deepEqual([...PUBLIC_LEADERBOARD_COLUMNS], ['id', 'challenge_id', 'simulation_version', 'seed', 'score', 'school_name', 'display_name', 'submitted_at', 'board_group', 'is_hafs']);
  const server = fixtureServer([publicRow(1), publicRow(2, { school_name: '타교', is_hafs: false }), publicRow(3, { board_group: 'manipulator' })]);
  const transport = createSupabaseLeaderboardTransport(config, server.fetch);
  assert.equal((await transport.list()).length, 2); // national includes HAFS
  assert.equal((await transport.list({ scope: 'hafs' })).length, 1);
  assert.equal((await transport.list({ scope: 'hafs', boardGroup: 'manipulator' })).length, 1);
  for (const call of server.calls) {
    assert.equal(call.url.pathname, '/rest/v1/apex_leaderboard_public_v2');
    assert.equal(call.url.searchParams.get('select'), PUBLIC_LEADERBOARD_COLUMNS.join(','));
    assert.equal(call.url.searchParams.get('order'), 'score.desc,submitted_at.asc,id.asc');
    assert.equal(call.url.searchParams.get('challenge_id'), 'eq.apex-survival');
    assert.equal(call.url.searchParams.get('simulation_version'), 'eq.apex-v1');
    assert.equal(call.url.searchParams.get('seed'), 'eq.260903');
    assert.equal(call.init?.cache, 'no-store');
    for (const name of ['student_number','student_name','school_key','payload_hash','parameter_snapshot','achieved_at','verification','verified_at','verified_score','verifier_version']) assert.ok(!call.url.toString().includes(name));
  }
  assert.equal(server.calls[0]!.url.searchParams.has('is_hafs'), false);
  assert.ok(server.calls.some(c => c.url.searchParams.get('is_hafs') === 'eq.true'));
});

test('runtime unknown response validation rejects malformed rows rather than presenting an empty ranking', async () => {
  const invalid = [null, {}, 'wrong', [null], [4], ...[
    { id: 2 }, { id: '' }, { school_name: '' }, { school_name: '가'.repeat(81) }, { display_name: null },
    { is_hafs: 'true' }, { is_hafs: 1 }, { score: '20' }, { score: -1 }, { score: 2.5 }, { score: 1000001 },
    { seed: '260903' }, { seed: 1 }, { seed: 2147483648 }, { challenge_id: 'other' }, { simulation_version: 'other' },
    { board_group: 'hidden' }, { board_group: 'manipulator' }, { submitted_at: '' }, { submitted_at: '2026-02-30T00:00:00Z' },
  ].map(change => [publicRow(1, change)])];
  for (const raw of invalid) {
    const transport = createSupabaseLeaderboardTransport(config, async () => json(raw));
    await assert.rejects(transport.list(), /응답 형식/);
  }
  await assert.rejects(createSupabaseLeaderboardTransport(config, async () => json([publicRow(1, { is_hafs: false })])).list({ scope: 'hafs' }), /응답 형식/);
  const transport = createSupabaseLeaderboardTransport(config, async () => json([]));
  for (const query of [{ scope: 'local' as LeaderboardScope }, { boardGroup: 'hidden' as BoardGroup }, { limit: 0 }, { limit: 2.5 }]) await assert.rejects(transport.list(query), /조회 설정/);
  assert.deepEqual(await transport.list(), []);
});

test('extra private fields are never copied into an entry; masked names never deduplicate participants', async () => {
  const server = fixtureServer([publicRow(1, { student_number: 'private-number', student_name: 'private-name', school_key: 'private-key',
    payload_hash: 'private-hash', parameter_snapshot: {}, verification: 'verified' }), publicRow(2)]);
  const rows = await createSupabaseLeaderboardTransport(config, server.fetch).list();
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]!).sort(), ['id', 'challengeId', 'simulationVersion', 'seed', 'score', 'schoolName', 'displayName', 'submittedAt', 'boardGroup', 'isHafs'].sort());
  assert.ok(!JSON.stringify(rows).includes('private-'));
});

test('Top 10 includes >50 boundary ties, handles smaller server pages and stops before lower scores', async () => {
  const rows = Array.from({ length: 120 }, (_, i) => publicRow(i + 1, { score: i < 9 ? 1000 - i : i < 83 ? 842 : 1 }));
  for (const cap of [3, 50]) {
    const server = fixtureServer(rows, cap);
    const got = await createSupabaseLeaderboardTransport(config, server.fetch).list();
    assert.equal(got.length, 83);
    assert.equal(rankEntries(got).at(-1)!.rank, 10);
    assert.ok(server.calls.length < 32);
    assert.ok(server.calls.some(c => c.url.searchParams.get('score') === 'gte.842'));
  }
  const separate = fixtureServer([...Array.from({ length: 60 }, (_, i) => publicRow(i + 1, { is_hafs: false })), publicRow(100, { score: 10 })], 3);
  const transport = createSupabaseLeaderboardTransport(config, separate.fetch);
  assert.ok(!(await transport.list()).some(r => r.isHafs));
  assert.equal((await transport.list({ scope: 'hafs' }))[0]!.id, uuid(100));
});

test('pagination allows duplicate row IDs from overlap but rejects stalled, inconsistent and unsorted responses', async () => {
  let page = 0;
  const transport = createSupabaseLeaderboardTransport(config, async () => json([[publicRow(1)], [publicRow(1), publicRow(2)], []][page++]));
  assert.equal((await transport.list()).length, 2);
  await assert.rejects(createSupabaseLeaderboardTransport(config, async () => json([publicRow(1)])).list(), /응답 형식/);
  await assert.rejects(createSupabaseLeaderboardTransport(config, async () => json([publicRow(2), publicRow(1)])).list(), /응답 형식/);
});

test('competition ranks 1,1,3 use server timestamp including microseconds/timezones and id; detail retains ties', () => {
  assert.equal(DEFAULT_LEADERBOARD_LIMIT, 10);
  const ranked = rankEntries([entry(2, { score: 900 }), entry(1, { score: 900 }), entry(3, { score: 800 }), entry(4, { score: 700 })]);
  assert.deepEqual(ranked.map(r => r.rank), [1,1,3,4]);
  assert.deepEqual(ranked.map(r => rankAccentClass(r.rank)), ['rank-gold','rank-gold','rank-bronze','']);
  assert.equal(rankAccentClass(2), 'rank-silver');
  assert.deepEqual(rankEntries([
    entry(1, { score: 900, submittedAt: '2026-09-01T00:00:00.000002Z' }),
    entry(2, { score: 900, submittedAt: '2026-09-01T09:00:00.000001+09:00' }),
  ]).map(r => r.id), [uuid(2), uuid(1)]);
  assert.equal(rankEntries(Array.from({ length: 12 }, (_, i) => entry(i + 1))).length, 10);
});

test('safe errors distinguish duplicates/school/rate; no raw DB details or legacy fallback', async () => {
  for (const [code, message] of [['23505', '이미 제출'], ['22023', '학교명'], ['23502', '학교명'], ['P0001', '너무 잦']]) {
    const transport = createSupabaseLeaderboardTransport(config, async () => json({ code, message: 'PRIVATE', details: 'PRIVATE' }, 400));
    await assert.rejects(transport.submit(await createSubmission(record(), participant)), new RegExp(message));
  }
  let count = 0;
  const failing = createSupabaseLeaderboardTransport(config, async () => { count++; return json({ message: 'PRIVATE' }, 503); });
  await assert.rejects(failing.list(), error => error instanceof Error && !error.message.includes('PRIVATE'));
  assert.equal(count, 1);
  const old = createSupabaseLeaderboardTransport({ ...config, publicView: 'apex_leaderboard_public' }, async () => { throw Error('should not fetch'); });
  await assert.rejects(old.list(), /v2 설정/);
});

test('apikey and actual JWT headers retain their roles; custom table derives v2 view; missing config disables only leaderboard', async () => {
  for (const accessToken of [undefined, 'user-jwt', '   ']) {
    const server = fixtureServer([]);
    const transport = createSupabaseLeaderboardTransport({ ...config, accessToken, table: 'lab_scores' }, server.fetch);
    await transport.list(); await transport.submit(await createSubmission(record(), participant));
    for (const call of server.calls) {
      const headers = call.init!.headers as Record<string,string>;
      assert.equal(headers.apikey, 'sb_publishable_test');
      assert.equal(headers.Authorization, accessToken?.trim() ? 'Bearer user-jwt' : undefined);
    }
    assert.equal(server.calls[0]!.url.pathname, '/rest/v1/lab_scores_public_v2');
  }
  assert.equal(createLeaderboardTransport({}), null);
  assert.equal(createLeaderboardTransport({ supabaseUrl: ' ', supabaseAnonKey: 'key' }), null);
  assert.equal(createLeaderboardTransport({ supabaseUrl: config.url, supabaseAnonKey: '' }), null);
  assert.ok(createLeaderboardTransport({ supabaseUrl: config.url, supabaseAnonKey: 'key' }));
});

test('saved participants upgrade only school to empty; broken JSON/types/storage fail safely without writes to PB', () => {
  const storage = (value: string | null) => ({ getItem: () => value });
  assert.deepEqual(loadParticipant(storage(JSON.stringify({ studentNumber: '00314', studentName: '홍길동' }))), { ...participant, schoolName: '' });
  assert.deepEqual(loadParticipant(storage(JSON.stringify(participant))), participant);
  for (const value of [null, '{', '[]', '3', 'null', '{"studentNumber":3,"studentName":"홍길동"}', '{"studentNumber":"00314","studentName":"홍길동","schoolName":null}']) assert.equal(loadParticipant(storage(value)), null);
  assert.equal(loadParticipant({ getItem() { throw Error('blocked'); } }), null);
});
