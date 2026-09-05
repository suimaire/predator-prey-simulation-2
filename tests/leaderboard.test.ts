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
  DEFAULT_LEADERBOARD_LIMIT,
  normalizeParticipant,
  participantKey,
  PUBLIC_LEADERBOARD_COLUMNS,
  rankAccentClass,
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

function entry(overrides: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, 'id' | 'score' | 'studentNumber' | 'studentName'>): LeaderboardEntry {
  return {
    id: overrides.id,
    challengeId: APEX_CHALLENGE_CONFIG.id,
    simulationVersion: APEX_CHALLENGE_CONFIG.simulationVersion,
    seed: APEX_CHALLENGE_CONFIG.seed,
    score: overrides.score,
    studentNumber: overrides.studentNumber,
    studentName: overrides.studentName,
    submittedAt: overrides.submittedAt ?? '2026-09-03T01:00:00.000Z',
  };
}

test('학번과 이름은 공백을 정리한 뒤 검증한다', () => {
  const normalized = normalizeParticipant({ studentNumber: '  20314 ', studentName: ' 김 하늘 ' });
  assert.equal(normalized.studentNumber, '20314');
  assert.equal(normalized.studentName, '김 하늘');

  assert.equal(validateParticipant({ studentNumber: '', studentName: '김하늘' }).ok, false);
  assert.equal(validateParticipant({ studentNumber: '   ', studentName: '김하늘' }).ok, false);
  assert.equal(validateParticipant({ studentNumber: '9'.repeat(25), studentName: '김하늘' }).ok, false);
  assert.equal(validateParticipant({ studentNumber: '20314', studentName: '   ' }).ok, false);
  assert.equal(validateParticipant({ studentNumber: '20314', studentName: '가'.repeat(17) }).ok, false);
  assert.equal(validateParticipant({ studentNumber: '20314', studentName: '<script>' }).ok, false);

  // 자릿수나 숫자 형식은 강제하지 않습니다. 학번 체계가 바뀌어도 그대로 쓸 수 있어야 합니다.
  assert.equal(validateParticipant({ studentNumber: '20314', studentName: '김하늘' }).ok, true);
  assert.equal(validateParticipant({ studentNumber: '26-3-014', studentName: '김하늘' }).ok, true);
  assert.equal(validateParticipant({ studentNumber: 'J-2026-014', studentName: '김하늘' }).ok, true);
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
  const first = await createSubmission(record(842), { studentNumber: '20314', studentName: '김하늘' });
  const second = await createSubmission(record(842, { achievedAt: '2026-09-04T09:30:00.000Z' }), { studentNumber: '10101', studentName: '이바다' });
  assert.equal(first.payloadHash, second.payloadHash);
  assert.equal(await submissionMatchesScore(first), true);
  assert.equal(await submissionMatchesScore({ ...first, score: first.score + 100 }), false);

  // 서버의 중복 방지 인덱스는 (student_number, payload_hash) 로만 유일성을 봅니다.
  // 그 구조가 성립하려면 해시가 학생 정보를 전혀 담지 않아야 합니다.
  const payload = canonicalScorePayload(record(842));
  assert.equal(payload.includes('studentName'), false);
  assert.equal(payload.includes('studentNumber'), false);
  assert.equal(payload.includes('김하늘'), false);
});

test('같은 파라미터로 다시 도전하면 해시가 같고, 조금이라도 다르면 달라진다', async () => {
  // 시뮬레이션이 seed 결정론적이므로 같은 파라미터는 항상 같은 점수를 냅니다. 그래서
  // "같은 해시 = 같은 도전을 그대로 다시 낸 것" 이 되고, 서버가 그것만 중복으로 막습니다.
  const again = await computePayloadHash(record(842));
  assert.equal(await computePayloadHash(record(842)), again);

  // 점수가 다른 진짜 새 도전은 해시가 달라 여러 행으로 보존됩니다.
  assert.notEqual(await computePayloadHash(record(843)), again);
  const tweakedParameters = { ...parameters, wolfBreedProbability: parameters.wolfBreedProbability + 0.01 };
  assert.notEqual(await computePayloadHash(record(842, { parameterSnapshot: tweakedParameters })), again);
});

test('제출 payload는 challenge 정의와 정리된 학생 정보를 함께 담는다', async () => {
  const submission = await createSubmission(record(842), { studentNumber: '  20314 ', studentName: ' 김하늘 ' });
  assert.equal(submission.challengeId, APEX_CHALLENGE_CONFIG.id);
  assert.equal(submission.simulationVersion, APEX_CHALLENGE_CONFIG.simulationVersion);
  assert.equal(submission.seed, APEX_CHALLENGE_CONFIG.seed);
  assert.equal(submission.studentNumber, '20314');
  assert.equal(submission.studentName, '김하늘');
  assert.match(submission.payloadHash, /^[0-9a-f]{64}$/u);
  await assert.rejects(createSubmission(record(842), { studentNumber: '20314', studentName: '' }));
});

test('학생마다 최고 기록 하나만 남기고 동점은 같은 순위를 공유한다', () => {
  const entries = [
    entry({ id: 'a', score: 500, studentNumber: '20314', studentName: '김하늘' }),
    entry({ id: 'b', score: 842, studentNumber: '20314', studentName: '김하늘' }),
    entry({ id: 'c', score: 842, studentNumber: '20321', studentName: '이바다', submittedAt: '2026-09-03T02:00:00.000Z' }),
    entry({ id: 'd', score: 300, studentNumber: '20414', studentName: '박별' }),
  ];

  assert.equal(bestPerParticipant(entries).length, 3);
  const ranked = rankEntries(entries);
  assert.deepEqual(ranked.map((item) => [item.id, item.rank]), [['b', 1], ['c', 1], ['d', 3]]);

  const expanded = rankEntries(entries, { collapseToBest: false });
  assert.deepEqual(expanded.map((item) => item.id), ['b', 'c', 'a', 'd']);
  assert.equal(rankEntries(entries, { limit: 2 }).length, 2);
});

test('동일인 판정은 학번 하나로 하고 이름은 보지 않는다', () => {
  // 앞뒤 공백과 중복 공백은 무시합니다.
  assert.equal(
    participantKey({ studentNumber: '20314', studentName: '김하늘' }),
    participantKey({ studentNumber: '  20314 ', studentName: ' 김하늘 ' }),
  );
  // 같은 학번이면 이름 표기가 달라도 같은 학생입니다.
  assert.equal(
    participantKey({ studentNumber: '20314', studentName: '김민수' }),
    participantKey({ studentNumber: '20314', studentName: '김민수A' }),
  );
  // 학번이 다르면 이름이 같아도 다른 학생입니다.
  assert.notEqual(
    participantKey({ studentNumber: '20314', studentName: '김민수' }),
    participantKey({ studentNumber: '20414', studentName: '김민수' }),
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
    student_number: '20314',
    student_name: '김하늘',
    submitted_at: '2026-09-03T01:00:00.000Z',
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
  // 동점 tie-break는 학생이 보낸 achieved_at이 아니라 서버가 채운 submitted_at을 씁니다.
  assert.match(calls[0]!, /order=score\.desc%2Csubmitted_at\.asc/u);
  for (const forbidden of ['parameter_snapshot', 'payload_hash', 'achieved_at', 'verified_score', 'verified_at', 'verifier_version']) {
    assert.equal(calls[0]!.includes(forbidden), false, `조회 URL에 ${forbidden}가 들어 있습니다.`);
  }
  assert.equal(entries[0]!.id, '7');
  assert.equal(entries[0]!.studentNumber, '20314');
});

test('공개 열 목록에는 비공개 필드가 들어 있지 않다', () => {
  assert.deepEqual([...PUBLIC_LEADERBOARD_COLUMNS], [
    'id', 'challenge_id', 'simulation_version', 'seed', 'score', 'student_number', 'student_name', 'submitted_at',
  ]);
  // achieved_at은 학생이 보낸 값이라 공개 view에서 뺐습니다. 조회 목록에도 있으면 안 됩니다.
  for (const forbidden of ['achieved_at', 'parameter_snapshot', 'payload_hash', 'verification', 'verified_score', 'verified_at', 'verifier_version']) {
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
    student_number: '20314',
    student_name: '김하늘',
    submitted_at: '2026-09-03T01:00:00.000Z',
    achieved_at: '2026-09-03T00:59:00.000Z',
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
    ['challengeId', 'id', 'score', 'seed', 'simulationVersion', 'studentName', 'studentNumber', 'submittedAt'],
  );
});

test('공개 view가 검증 상태를 내보내면 그때만 entry에 담긴다', async () => {
  const base = {
    id: 1,
    challenge_id: APEX_CHALLENGE_CONFIG.id,
    simulation_version: APEX_CHALLENGE_CONFIG.simulationVersion,
    seed: APEX_CHALLENGE_CONFIG.seed,
    score: 10,
    student_number: '20314',
    student_name: '김하늘',
    submitted_at: '2026-09-03T01:00:00.000Z',
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

  const submission: LeaderboardSubmission = await createSubmission(record(842), { studentNumber: '20314', studentName: '김하늘' });
  await transport.submit(submission);
  assert.equal(target, 'https://example.supabase.co/rest/v1/apex_leaderboard');
  assert.equal(prefer, 'return=minimal');
  assert.equal(body.student_number, '20314');
  assert.equal(body.payload_hash, submission.payloadHash);
  assert.equal('verification' in body, false);
  assert.equal('verified_score' in body, false);
  // 제출 시각은 서버 default now()가 정합니다. 클라이언트가 실어 보내는 일이 없어야 합니다.
  assert.equal('submitted_at' in body, false);
  assert.equal('created_at' in body, false);
});

test('익명 요청은 publishable key를 apikey 헤더로만 보낸다', async () => {
  const seen: Record<string, string>[] = [];
  const capture = async (_url: string, init?: RequestInit) => {
    seen.push(init?.headers as Record<string, string>);
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const anonymous = createSupabaseLeaderboardTransport(
    { url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' },
    capture,
  );
  await anonymous.list();
  assert.equal(seen[0]!.apikey, 'sb_publishable_test');
  // sb_publishable_ key는 JWT가 아니므로 Authorization: Bearer 자리에 넣지 않습니다.
  assert.equal('Authorization' in seen[0]!, false);

  // 나중에 Supabase Auth 로그인을 붙이면 그때 발급되는 access token만 Authorization으로 갑니다.
  const signedIn = createSupabaseLeaderboardTransport(
    { url: 'https://example.supabase.co', anonKey: 'sb_publishable_test', accessToken: 'user-jwt' },
    capture,
  );
  await signedIn.list();
  assert.equal(seen[1]!.apikey, 'sb_publishable_test');
  assert.equal(seen[1]!.Authorization, 'Bearer user-jwt');

  // 공백뿐인 token은 없는 것으로 봅니다.
  const blank = createSupabaseLeaderboardTransport(
    { url: 'https://example.supabase.co', anonKey: 'sb_publishable_test', accessToken: '   ' },
    capture,
  );
  await blank.list();
  assert.equal('Authorization' in seen[2]!, false);
});

test('동점 정렬은 서버가 채운 제출 시각을 따른다', () => {
  const entries = [
    entry({ id: 'late', score: 700, studentNumber: '20314', studentName: '김하늘', submittedAt: '2026-09-03T05:00:00.000Z' }),
    entry({ id: 'early', score: 700, studentNumber: '20414', studentName: '이바다', submittedAt: '2026-09-03T03:00:00.000Z' }),
  ];
  assert.deepEqual(rankEntries(entries).map((item) => item.id), ['early', 'late']);
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

test('기본 표시 인원은 상위 10명이다', () => {
  assert.equal(DEFAULT_LEADERBOARD_LIMIT, 10);

  // 12명이 서로 다른 점수를 냈으면 정확히 10명만 보여 줍니다.
  const twelve = Array.from({ length: 12 }, (_, index) => entry({
    id: `s${index}`,
    score: 1200 - index * 10,
    studentNumber: `203${String(index).padStart(2, '0')}`,
    studentName: `학생${index}`,
  }));
  const ranked = rankEntries(twelve);
  assert.equal(ranked.length, 10);
  assert.deepEqual(ranked.map((item) => item.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(ranked[0]!.score, 1200);
  assert.equal(ranked[9]!.score, 1110);
  // 11, 12번째 학생은 잘려 나갑니다.
  assert.equal(ranked.some((item) => item.id === 's10'), false);
  assert.equal(ranked.some((item) => item.id === 's11'), false);
});

test('10위와 동점인 학생이 더 있으면 그 학생들까지 함께 보여 준다', () => {
  // 1~9위는 서로 다른 점수, 10~12위는 모두 842점입니다.
  const entries = [
    ...Array.from({ length: 9 }, (_, index) => entry({
      id: `top${index}`,
      score: 1000 - index * 10,
      studentNumber: `201${String(index).padStart(2, '0')}`,
      studentName: `상위${index}`,
    })),
    entry({ id: 'tie-a', score: 842, studentNumber: '20401', studentName: '동점갑', submittedAt: '2026-09-03T01:00:00.000Z' }),
    entry({ id: 'tie-b', score: 842, studentNumber: '20402', studentName: '동점을', submittedAt: '2026-09-03T02:00:00.000Z' }),
    entry({ id: 'tie-c', score: 842, studentNumber: '20403', studentName: '동점병', submittedAt: '2026-09-03T03:00:00.000Z' }),
    entry({ id: 'below', score: 500, studentNumber: '20404', studentName: '하위', submittedAt: '2026-09-03T04:00:00.000Z' }),
  ];

  const ranked = rankEntries(entries);
  assert.equal(ranked.length, 12);
  assert.deepEqual(ranked.slice(9).map((item) => item.id), ['tie-a', 'tie-b', 'tie-c']);
  // 동점자는 같은 순위를 공유합니다.
  assert.deepEqual(ranked.slice(9).map((item) => item.rank), [10, 10, 10]);
  // 동점 그룹 안에서는 먼저 제출한 쪽이 앞섭니다.
  assert.deepEqual(ranked.slice(9).map((item) => item.submittedAt), [
    '2026-09-03T01:00:00.000Z', '2026-09-03T02:00:00.000Z', '2026-09-03T03:00:00.000Z',
  ]);
  // 동점이 아닌 아래 학생까지 딸려 오지는 않습니다.
  assert.equal(ranked.some((item) => item.id === 'below'), false);
});

test('같은 학번의 여러 제출은 최고 기록 하나로 접힌다', () => {
  // 공개 view가 서버에서 이미 접어 주지만, 클라이언트도 같은 규칙으로 한 번 더 접습니다.
  const entries = [
    entry({ id: 'a1', score: 500, studentNumber: '20314', studentName: '김민수', submittedAt: '2026-09-03T01:00:00.000Z' }),
    entry({ id: 'a2', score: 880, studentNumber: '20314', studentName: '김민수', submittedAt: '2026-09-03T02:00:00.000Z' }),
    entry({ id: 'a3', score: 640, studentNumber: '20314', studentName: '김민수', submittedAt: '2026-09-03T03:00:00.000Z' }),
  ];
  const ranked = rankEntries(entries);
  assert.equal(ranked.length, 1);
  assert.deepEqual(
    [ranked[0]!.studentNumber, ranked[0]!.studentName, ranked[0]!.score],
    ['20314', '김민수', 880],
  );
});

test('같은 학번이면 이름 표기가 달라도 한 학생으로 접힌다', () => {
  const entries = [
    entry({ id: 'b1', score: 880, studentNumber: '20314', studentName: '김민수', submittedAt: '2026-09-03T01:00:00.000Z' }),
    entry({ id: 'b2', score: 900, studentNumber: '20314', studentName: '김민수A', submittedAt: '2026-09-03T02:00:00.000Z' }),
  ];
  const ranked = rankEntries(entries);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]!.score, 900);
  // 대표 기록의 이름이 그대로 표시됩니다.
  assert.equal(ranked[0]!.studentName, '김민수A');
});

test('학번이 다르면 이름이 같아도 서로 다른 학생이다', () => {
  const entries = [
    entry({ id: 'c1', score: 880, studentNumber: '20314', studentName: '김민수' }),
    entry({ id: 'c2', score: 810, studentNumber: '20414', studentName: '김민수', submittedAt: '2026-09-03T02:00:00.000Z' }),
  ];
  const ranked = rankEntries(entries);
  assert.equal(ranked.length, 2);
  assert.deepEqual(
    ranked.map((item) => [item.studentNumber, item.score, item.rank]),
    [['20314', 880, 1], ['20414', 810, 2]],
  );
});

test('같은 학생이 같은 최고점을 여러 번 냈으면 먼저 제출한 기록이 대표가 된다', () => {
  const entries = [
    entry({ id: 'late', score: 900, studentNumber: '20314', studentName: '김하늘', submittedAt: '2026-09-03T05:00:00.000Z' }),
    entry({ id: 'early', score: 900, studentNumber: '20314', studentName: '김하늘', submittedAt: '2026-09-03T01:00:00.000Z' }),
  ];
  const ranked = rankEntries(entries);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]!.id, 'early');
});

test('환경 변수가 없으면 transport 없이 앱이 동작한다', () => {
  assert.equal(createLeaderboardTransport({}), null);
  assert.equal(createLeaderboardTransport({ supabaseUrl: ' ', supabaseAnonKey: 'key' }), null);
  assert.equal(createLeaderboardTransport({ supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: '' }), null);
  assert.notEqual(createLeaderboardTransport({ supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'key' }), null);
});

test('상위 3위 테두리는 표시 순서가 아니라 rank 값으로 정해진다', () => {
  const entries = [
    entry({ id: 'd1', score: 900, studentNumber: '10101', studentName: '가은' }),
    entry({ id: 'd2', score: 900, studentNumber: '10102', studentName: '나연', submittedAt: '2026-09-03T02:00:00.000Z' }),
    entry({ id: 'd3', score: 800, studentNumber: '10103', studentName: '다올', submittedAt: '2026-09-03T03:00:00.000Z' }),
    entry({ id: 'd4', score: 700, studentNumber: '10104', studentName: '라온', submittedAt: '2026-09-03T04:00:00.000Z' }),
  ];
  const ranked = rankEntries(entries);
  assert.deepEqual(ranked.map((item) => item.rank), [1, 1, 3, 4]);
  assert.deepEqual(
    ranked.map((item) => rankAccentClass(item.rank)),
    ['rank-gold', 'rank-gold', 'rank-bronze', ''],
  );
});

test('rank 값이 그대로 금 · 은 · 동 클래스로 이어진다', () => {
  assert.equal(rankAccentClass(1), 'rank-gold');
  assert.equal(rankAccentClass(2), 'rank-silver');
  assert.equal(rankAccentClass(3), 'rank-bronze');
  assert.equal(rankAccentClass(4), '');
  assert.equal(rankAccentClass(12), '');
});
