import assert from 'node:assert/strict';
import test from 'node:test';
import { APEX_CHALLENGE_CONFIG, apexParameters } from '../src/challenge.ts';
import { DEFAULT_PARAMETERS, type SimulationParameters } from '../src/model.ts';
import {
  bestPerParticipant,
  canonicalScorePayload,
  computePayloadHash,
  createLeaderboardTransport,
  createSubmission,
  createSupabaseLeaderboardTransport,
  normalizeParticipant,
  participantKey,
  PUBLIC_LEADERBOARD_COLUMNS,
  rankEntries,
  submissionMatchesScore,
  validateParticipant,
  type LeaderboardEntry,
  type LeaderboardSubmission,
} from '../src/leaderboard.ts';

const parameters = apexParameters({ ...DEFAULT_PARAMETERS });

function record(score: number, overrides: Partial<{ parameterSnapshot: SimulationParameters; achievedAt: string }> = {}) {
  return {
    challengeId: APEX_CHALLENGE_CONFIG.id,
    simulationVersion: APEX_CHALLENGE_CONFIG.simulationVersion,
    score,
    seed: APEX_CHALLENGE_CONFIG.seed,
    parameterSnapshot: overrides.parameterSnapshot ?? parameters,
    achievedAt: overrides.achievedAt ?? '2026-09-03T01:00:00.000Z',
  };
}

function entry(overrides: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, 'id' | 'score' | 'classLabel' | 'studentName'>): LeaderboardEntry {
  return {
    id: overrides.id,
    challengeId: APEX_CHALLENGE_CONFIG.id,
    simulationVersion: APEX_CHALLENGE_CONFIG.simulationVersion,
    seed: APEX_CHALLENGE_CONFIG.seed,
    score: overrides.score,
    classLabel: overrides.classLabel,
    studentName: overrides.studentName,
    achievedAt: overrides.achievedAt ?? '2026-09-03T01:00:00.000Z',
  };
}

test('학급과 이름은 공백을 정리한 뒤 검증한다', () => {
  const normalized = normalizeParticipant({ classLabel: '  2학년   3반 ', studentName: ' 김 하늘 ' });
  assert.equal(normalized.classLabel, '2학년 3반');
  assert.equal(normalized.studentName, '김 하늘');

  assert.equal(validateParticipant({ classLabel: '', studentName: '김하늘' }).ok, false);
  assert.equal(validateParticipant({ classLabel: '2-3', studentName: '   ' }).ok, false);
  assert.equal(validateParticipant({ classLabel: '2-3', studentName: '가'.repeat(17) }).ok, false);
  assert.equal(validateParticipant({ classLabel: '2-3', studentName: '<script>' }).ok, false);
  assert.equal(validateParticipant({ classLabel: '2학년 3반', studentName: '김하늘' }).ok, true);
});

test('제출 해시는 키 순서와 무관하고 점수·파라미터가 바뀌면 달라진다', async () => {
  const shuffled = Object.fromEntries(Object.entries(parameters).reverse()) as SimulationParameters;
  assert.equal(canonicalScorePayload(record(842)), canonicalScorePayload(record(842, { parameterSnapshot: shuffled })));
  assert.equal(await computePayloadHash(record(842)), await computePayloadHash(record(842, { parameterSnapshot: shuffled })));

  assert.notEqual(await computePayloadHash(record(842)), await computePayloadHash(record(843)));
  const tweaked = { ...parameters, rabbitBreedProbability: parameters.rabbitBreedProbability + 0.01 };
  assert.notEqual(await computePayloadHash(record(842)), await computePayloadHash(record(842, { parameterSnapshot: tweaked })));
});

test('해시는 학생 정보나 달성 시각에 영향을 받지 않는다', async () => {
  const first = await createSubmission(record(842), { classLabel: '2학년 3반', studentName: '김하늘' });
  const second = await createSubmission(record(842, { achievedAt: '2026-09-04T09:30:00.000Z' }), { classLabel: '1학년 1반', studentName: '이바다' });
  assert.equal(first.payloadHash, second.payloadHash);
  assert.equal(await submissionMatchesScore(first), true);
  assert.equal(await submissionMatchesScore({ ...first, score: first.score + 100 }), false);
});

test('제출 payload는 challenge 정의와 정리된 학생 정보를 함께 담는다', async () => {
  const submission = await createSubmission(record(842), { classLabel: ' 2학년  3반 ', studentName: ' 김하늘 ' });
  assert.equal(submission.challengeId, APEX_CHALLENGE_CONFIG.id);
  assert.equal(submission.simulationVersion, APEX_CHALLENGE_CONFIG.simulationVersion);
  assert.equal(submission.seed, APEX_CHALLENGE_CONFIG.seed);
  assert.equal(submission.classLabel, '2학년 3반');
  assert.equal(submission.studentName, '김하늘');
  assert.match(submission.payloadHash, /^[0-9a-f]{64}$/u);
  await assert.rejects(createSubmission(record(842), { classLabel: '2학년 3반', studentName: '' }));
});

test('학생마다 최고 기록 하나만 남기고 동점은 같은 순위를 공유한다', () => {
  const entries = [
    entry({ id: 'a', score: 500, classLabel: '2학년 3반', studentName: '김하늘' }),
    entry({ id: 'b', score: 842, classLabel: '2학년 3반', studentName: '김하늘' }),
    entry({ id: 'c', score: 842, classLabel: '2학년 3반', studentName: '이바다', achievedAt: '2026-09-03T02:00:00.000Z' }),
    entry({ id: 'd', score: 300, classLabel: '2학년 4반', studentName: '박별' }),
  ];

  assert.equal(bestPerParticipant(entries).length, 3);
  const ranked = rankEntries(entries);
  assert.deepEqual(ranked.map((item) => [item.id, item.rank]), [['b', 1], ['c', 1], ['d', 3]]);

  const expanded = rankEntries(entries, { collapseToBest: false });
  assert.deepEqual(expanded.map((item) => item.id), ['b', 'c', 'a', 'd']);
  assert.equal(rankEntries(entries, { limit: 2 }).length, 2);
});

test('같은 학생 판별은 앞뒤 공백과 중복 공백을 무시한다', () => {
  assert.equal(
    participantKey({ classLabel: '2학년 3반', studentName: '김하늘' }),
    participantKey({ classLabel: ' 2학년   3반 ', studentName: ' 김하늘 ' }),
  );
  assert.notEqual(
    participantKey({ classLabel: '2학년 3반', studentName: '김하늘' }),
    participantKey({ classLabel: '2학년 4반', studentName: '김하늘' }),
  );
});

test('조회는 공개 view를 향하고 비공개 열을 요청하지 않는다', async () => {
  const calls: string[] = [];
  const row = {
    id: 7,
    challenge_id: APEX_CHALLENGE_CONFIG.id,
    simulation_version: APEX_CHALLENGE_CONFIG.simulationVersion,
    seed: APEX_CHALLENGE_CONFIG.seed,
    score: 842,
    class_label: '2학년 3반',
    student_name: '김하늘',
    achieved_at: '2026-09-03T01:00:00.000Z',
  };
  const transport = createSupabaseLeaderboardTransport(
    { url: 'https://example.supabase.co/', anonKey: 'anon-key' },
    async (url) => {
      calls.push(url);
      return new Response(JSON.stringify([row]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  );

  const entries = await transport.list();
  assert.equal(calls[0]!.startsWith('https://example.supabase.co/rest/v1/apex_leaderboard_public?'), true);
  assert.match(calls[0]!, /simulation_version=eq\.apex-v1/u);
  assert.match(calls[0]!, /seed=eq\.260903/u);
  for (const forbidden of ['parameter_snapshot', 'payload_hash', 'verified_score', 'verified_at', 'verifier_version']) {
    assert.equal(calls[0]!.includes(forbidden), false, `조회 URL에 ${forbidden}가 들어 있습니다.`);
  }
  assert.equal(entries[0]!.id, '7');
  assert.equal(entries[0]!.classLabel, '2학년 3반');
});

test('공개 열 목록에는 비공개 필드가 들어 있지 않다', () => {
  assert.deepEqual([...PUBLIC_LEADERBOARD_COLUMNS], [
    'id', 'challenge_id', 'simulation_version', 'seed', 'score', 'class_label', 'student_name', 'achieved_at',
  ]);
  for (const forbidden of ['parameter_snapshot', 'payload_hash', 'verification', 'verified_score', 'verified_at', 'verifier_version']) {
    assert.equal(PUBLIC_LEADERBOARD_COLUMNS.includes(forbidden), false);
  }
});

test('서버가 여분의 열을 보내더라도 entry로 새어 들어오지 않는다', async () => {
  const leaky = {
    id: 9,
    challenge_id: APEX_CHALLENGE_CONFIG.id,
    simulation_version: APEX_CHALLENGE_CONFIG.simulationVersion,
    seed: APEX_CHALLENGE_CONFIG.seed,
    score: 100,
    class_label: '2-3-14',
    student_name: '김하늘',
    achieved_at: '2026-09-03T01:00:00.000Z',
    parameter_snapshot: parameters,
    payload_hash: 'b'.repeat(64),
    verified_score: 12,
  };
  const transport = createSupabaseLeaderboardTransport(
    { url: 'https://example.supabase.co', anonKey: 'anon-key' },
    async () => new Response(JSON.stringify([leaky]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  const [entry] = await transport.list();
  assert.deepEqual(
    Object.keys(entry!).sort(),
    ['achievedAt', 'challengeId', 'classLabel', 'id', 'score', 'seed', 'simulationVersion', 'studentName'],
  );
});

test('공개 view가 검증 상태를 내보내면 그때만 entry에 담긴다', async () => {
  const base = {
    id: 1,
    challenge_id: APEX_CHALLENGE_CONFIG.id,
    simulation_version: APEX_CHALLENGE_CONFIG.simulationVersion,
    seed: APEX_CHALLENGE_CONFIG.seed,
    score: 10,
    class_label: '2-3-14',
    student_name: '김하늘',
    achieved_at: '2026-09-03T01:00:00.000Z',
  };
  const make = (row: object) => createSupabaseLeaderboardTransport(
    { url: 'https://example.supabase.co', anonKey: 'anon-key' },
    async () => new Response(JSON.stringify([row]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  assert.equal((await make(base).list())[0]!.verification, undefined);
  assert.equal((await make({ ...base, verification: 'verified' }).list())[0]!.verification, 'verified');
  assert.equal((await make({ ...base, verification: '이상한값' }).list())[0]!.verification, undefined);
});

test('제출은 원본 테이블로 가고 삽입한 행을 되돌려받지 않는다', async () => {
  let body: Record<string, unknown> = {};
  let target = '';
  let prefer: string | undefined;
  const transport = createSupabaseLeaderboardTransport(
    { url: 'https://example.supabase.co', anonKey: 'anon-key' },
    async (url, init) => {
      target = url;
      prefer = (init?.headers as Record<string, string>).Prefer;
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response('', { status: 201 });
    },
  );

  const submission: LeaderboardSubmission = await createSubmission(record(842), { classLabel: '2-3-14', studentName: '김하늘' });
  await transport.submit(submission);
  assert.equal(target, 'https://example.supabase.co/rest/v1/apex_leaderboard');
  assert.equal(prefer, 'return=minimal');
  assert.equal(body.class_label, '2-3-14');
  assert.equal(body.payload_hash, submission.payloadHash);
  assert.equal('verification' in body, false);
  assert.equal('verified_score' in body, false);
});

test('테이블 이름을 바꾸면 공개 view 이름도 함께 따라간다', async () => {
  const seen: string[] = [];
  const transport = createSupabaseLeaderboardTransport(
    { url: 'https://example.supabase.co', anonKey: 'anon-key', table: 'lab_scores' },
    async (url) => {
      seen.push(url);
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  );
  await transport.list();
  assert.equal(seen[0]!.startsWith('https://example.supabase.co/rest/v1/lab_scores_public?'), true);
});

test('Supabase 오류 응답은 사용자에게 보여 줄 메시지로 바뀐다', async () => {
  const transport = createSupabaseLeaderboardTransport(
    { url: 'https://example.supabase.co', anonKey: 'anon-key' },
    async () => new Response(JSON.stringify({ message: '기록 제출이 너무 잦습니다.' }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
  );
  await assert.rejects(transport.list(), /기록 제출이 너무 잦습니다\./u);

  const withoutBody = createSupabaseLeaderboardTransport(
    { url: 'https://example.supabase.co', anonKey: 'anon-key' },
    async () => new Response('nope', { status: 503 }),
  );
  await assert.rejects(withoutBody.list(), /HTTP 503/u);
});

test('환경 변수가 없으면 transport 없이 앱이 동작한다', () => {
  assert.equal(createLeaderboardTransport({}), null);
  assert.equal(createLeaderboardTransport({ supabaseUrl: ' ', supabaseAnonKey: 'key' }), null);
  assert.equal(createLeaderboardTransport({ supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: '' }), null);
  assert.notEqual(createLeaderboardTransport({ supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'key' }), null);
});
