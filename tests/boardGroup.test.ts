import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { APEX_CHALLENGE_CONFIG, apexParameters } from '../src/challenge.ts';
import { DEFAULT_PARAMETERS } from '../src/model.ts';
import {
  BOARD_GROUPS,
  createSupabaseLeaderboardTransport,
  PUBLIC_LEADERBOARD_COLUMNS,
  rankBoards,
  type BoardGroup,
  type LeaderboardEntry,
} from '../src/leaderboard.ts';
import { BOARD_DESCRIPTIONS, BOARD_LABELS, boardMarkup } from '../src/leaderboardView.ts';

// ---------------------------------------------------------------------------
// schema.sql 정적 검사
// 이 저장소의 테스트는 Postgres 없이 돌기 때문에, 권한과 view 정의가 요구사항대로 적혀 있는지
// SQL 원문으로 확인합니다. 실제 DB에서의 확인은 README "권한 검증" 표를 따릅니다.
// ---------------------------------------------------------------------------

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
/** 주석을 지운 SQL. 주석 속 설명 문구에 걸려 검사가 거짓으로 통과하지 않게 합니다. */
const sql = schema.replace(/--.*$/gmu, '');

function statement(pattern: RegExp): string {
  const match = sql.match(pattern);
  assert.ok(match, `schema.sql에서 ${pattern}를 찾지 못했습니다.`);
  return match[0];
}

test('board_group 열은 NOT NULL, 기본값 protector, 세 값으로만 제한된다', () => {
  assert.match(sql, /board_group\s+text\s+not null default 'protector'/u);
  assert.match(sql, /add column if not exists board_group text not null default 'protector'/u);
  assert.match(sql, /check \(board_group in \('protector', 'manipulator', 'hidden'\)\)/u);
  // 재실행 안전: 제약은 없을 때만 추가합니다.
  assert.match(sql, /if not exists \(\s*select 1 from pg_constraint[\s\S]*?conname = 'apex_leaderboard_board_group'/u);
});

test('학생 키는 INSERT 때 board_group을 지정할 수 없다', () => {
  const grant = statement(/grant insert \(([\s\S]*?)\) on table public\.apex_leaderboard to anon, authenticated;/u);
  assert.equal(grant.includes('board_group'), false, 'INSERT 열 GRANT에 board_group이 들어 있습니다.');
  // 검증 열과 같은 방식: 열 GRANT에서 빼고, INSERT 정책도 기본값만 허용합니다.
  assert.equal(grant.includes('verification'), false);
  const policy = statement(/create policy apex_leaderboard_insert[\s\S]*?;/u);
  assert.match(policy, /for insert/u);
  assert.match(policy, /board_group = 'protector'/u);
});

test('학생 키로는 board_group을 UPDATE 할 수 없다', () => {
  assert.match(sql, /revoke all on table public\.apex_leaderboard from anon, authenticated;/u);
  assert.doesNotMatch(sql, /grant[^;]*\b(update|all)\b[^;]*on table public\.apex_leaderboard\s+to/iu);
  assert.doesNotMatch(sql, /create policy[^;]*on public\.apex_leaderboard\s+for (update|all)/iu);
});

test('board_group을 자동으로 정하는 함수·트리거는 없다', () => {
  // 제출 빈도 제한 트리거 하나만 있고, 그 함수는 board_group을 건드리지 않습니다.
  const triggers = sql.match(/create trigger/giu) ?? [];
  assert.equal(triggers.length, 1);
  const functions = sql.match(/create or replace function[\s\S]*?\$\$;/giu) ?? [];
  for (const body of functions) assert.equal(body.includes('board_group'), false);
});

test('공개 view는 board_group을 노출하고 hidden을 빼며 보드별로 학번당 1행을 고른다', () => {
  const view = statement(/create view public\.apex_leaderboard_public[\s\S]*?;/u);
  assert.match(view, /with \(security_invoker = false\)/u);
  assert.match(view, /distinct on \(challenge_id, simulation_version, seed, board_group, participant_key\)/u);
  assert.match(view, /where base\.board_group <> 'hidden'/u);
  assert.match(view, /order by\s+challenge_id,\s+simulation_version,\s+seed,\s+board_group,\s+participant_key,\s+score desc,\s+submitted_at asc,\s+id asc/u);

  const selectList = view.slice(view.indexOf('distinct on'), view.indexOf('from ('));
  assert.match(selectList, /\bboard_group\b/u);
  for (const forbidden of ['parameter_snapshot', 'payload_hash', 'achieved_at', 'verified_score', 'verifier_version', 'base.*']) {
    assert.equal(selectList.includes(forbidden), false, `공개 view 열에 ${forbidden}가 있습니다.`);
  }
  // 학생 키는 view SELECT만, 원본 테이블 SELECT는 여전히 없습니다.
  assert.match(sql, /grant select on table public\.apex_leaderboard_public to anon, authenticated;/u);
  assert.doesNotMatch(sql, /grant select[^;]*on table public\.apex_leaderboard\s+to/iu);
});

test('클라이언트 공개 열 목록도 view와 같고 비공개 열이 없다', () => {
  assert.equal(PUBLIC_LEADERBOARD_COLUMNS.includes('board_group'), true);
  for (const forbidden of ['parameter_snapshot', 'payload_hash', 'achieved_at']) {
    assert.equal(PUBLIC_LEADERBOARD_COLUMNS.some((column) => column.includes(forbidden)), false);
  }
});

// ---------------------------------------------------------------------------
// 클라이언트 집계
// ---------------------------------------------------------------------------

function entry(
  id: string,
  score: number,
  studentNumber: string,
  boardGroup: BoardGroup,
  submittedAt = '2026-09-03T01:00:00.000Z',
): LeaderboardEntry {
  return {
    id,
    challengeId: APEX_CHALLENGE_CONFIG.id,
    simulationVersion: APEX_CHALLENGE_CONFIG.simulationVersion,
    seed: APEX_CHALLENGE_CONFIG.seed,
    score,
    studentNumber,
    studentName: `학생${studentNumber}`,
    submittedAt,
    boardGroup,
  };
}

test('보호단과 조작단은 각각 학번당 최고 기록 1개로 접힌다', () => {
  const boards = rankBoards([
    entry('p1', 500, '20314', 'protector'),
    entry('p2', 700, '20314', 'protector'),
    entry('p3', 600, '20401', 'protector'),
    entry('m1', 3000, '20501', 'manipulator'),
    entry('m2', 9000, '20501', 'manipulator'),
    entry('m3', 4000, '20502', 'manipulator'),
  ]);
  assert.deepEqual(boards.protector.map((item) => [item.id, item.rank]), [['p2', 1], ['p3', 2]]);
  // 조작단도 1위부터 점수 내림차순입니다.
  assert.deepEqual(boards.manipulator.map((item) => [item.id, item.rank]), [['m2', 1], ['m3', 2]]);
});

test('한 학생이 양쪽에 기록을 가지면 두 보드에 각각 나타난다', () => {
  const boards = rankBoards([
    entry('safe', 800, '20314', 'protector'),
    entry('forged', 99999, '20314', 'manipulator'),
    entry('other', 900, '20401', 'protector'),
  ]);
  assert.deepEqual(boards.protector.map((item) => [item.id, item.rank]), [['other', 1], ['safe', 2]]);
  assert.deepEqual(boards.manipulator.map((item) => [item.id, item.rank]), [['forged', 1]]);
  // 조작단 점수가 보호단 순위에 끼어들지 않습니다.
  assert.equal(boards.protector.some((item) => item.score === 99999), false);
});

function topTenWithTies(board: BoardGroup): LeaderboardEntry[] {
  return [
    ...Array.from({ length: 9 }, (_, index) => entry(`${board}-top${index}`, 1000 - index * 10, `3${index}`, board)),
    entry(`${board}-tie-late`, 842, '41', board, '2026-09-03T03:00:00.000Z'),
    entry(`${board}-tie-early`, 842, '42', board, '2026-09-03T01:00:00.000Z'),
    entry(`${board}-tie-mid`, 842, '43', board, '2026-09-03T02:00:00.000Z'),
    entry(`${board}-below`, 500, '44', board, '2026-09-03T04:00:00.000Z'),
  ];
}

test('두 보드 모두 상위 10명 + 마지막 자리 동점자 규칙을 따른다', () => {
  const boards = rankBoards([...topTenWithTies('protector'), ...topTenWithTies('manipulator')]);
  for (const board of BOARD_GROUPS) {
    const ranked = boards[board];
    assert.equal(ranked.length, 12, board);
    assert.deepEqual(ranked.slice(0, 9).map((item) => item.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // 동점은 같은 순위를 공유하고 먼저 제출한 기록이 앞입니다.
    assert.deepEqual(ranked.slice(9).map((item) => [item.id, item.rank]), [
      [`${board}-tie-early`, 10], [`${board}-tie-mid`, 10], [`${board}-tie-late`, 10],
    ]);
    assert.equal(ranked.some((item) => item.id === `${board}-below`), false);
  }
});

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------

const parameters = apexParameters({ ...DEFAULT_PARAMETERS });

function row(id: number, score: number, studentNumber: string, boardGroup: string, extra: object = {}) {
  return {
    id,
    challenge_id: APEX_CHALLENGE_CONFIG.id,
    simulation_version: APEX_CHALLENGE_CONFIG.simulationVersion,
    seed: APEX_CHALLENGE_CONFIG.seed,
    score,
    student_number: studentNumber,
    student_name: `학생${studentNumber}`,
    submitted_at: '2026-09-03T01:00:00.000Z',
    board_group: boardGroup,
    ...extra,
  };
}

/** 요청 URL의 board_group 조건대로 행을 돌려주는 가짜 PostgREST. */
function serve(rowsByGroup: Record<string, object[]>) {
  return createSupabaseLeaderboardTransport(
    { url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' },
    async (url) => {
      const filter = new URL(url).searchParams.get('board_group') ?? '';
      const rows = rowsByGroup[filter.replace(/^eq\./u, '')] ?? [];
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  );
}

test('두 보드를 따로 받아 boardGroup을 붙여 돌려준다', async () => {
  const entries = await serve({
    protector: [row(1, 800, '20314', 'protector')],
    manipulator: [row(2, 9000, '20314', 'manipulator')],
  }).list();
  assert.deepEqual(entries.map((item) => [item.id, item.boardGroup]), [['1', 'protector'], ['2', 'manipulator']]);

  const onlyManipulator = await serve({ manipulator: [row(2, 9000, '20314', 'manipulator')] }).list({ boardGroup: 'manipulator' });
  assert.deepEqual(onlyManipulator.map((item) => item.id), ['2']);
});

test('hidden 행이나 요청과 다른 분류의 행은 어느 보드에도 올라가지 않는다', async () => {
  // 정상 배포된 view는 hidden을 내보내지 않지만, 잘못 배포된 경우에도 화면에 새지 않아야 합니다.
  const entries = await serve({
    protector: [row(1, 800, '20314', 'protector'), row(2, 9999, '20401', 'hidden'), row(3, 700, '20402', 'manipulator')],
    manipulator: [row(4, 900, '20501', 'hidden'), row(5, 600, '20502', 'unknown')],
  }).list();
  assert.deepEqual(entries.map((item) => item.id), ['1']);
  const boards = rankBoards(entries);
  assert.equal(boards.protector.length, 1);
  assert.equal(boards.manipulator.length, 0);
});

test('공개 view 응답에 비공개 열이 섞여 와도 entry에는 들어가지 않는다', async () => {
  const [leaked] = await serve({
    manipulator: [row(9, 9000, '20314', 'manipulator', { parameter_snapshot: parameters, payload_hash: 'a'.repeat(64), achieved_at: '2026-09-03T00:00:00.000Z' })],
  }).list({ boardGroup: 'manipulator' });
  assert.ok(leaked);
  const keys = Object.keys(leaked);
  for (const forbidden of ['parameterSnapshot', 'parameter_snapshot', 'payloadHash', 'payload_hash', 'achievedAt', 'achieved_at']) {
    assert.equal(keys.includes(forbidden), false, `entry에 ${forbidden}가 들어 있습니다.`);
  }
});

// ---------------------------------------------------------------------------
// 화면 마크업
// ---------------------------------------------------------------------------

test('데이터 조작단이 비어 있으면 빈 목록 대신 설명과 안내 문구만 그린다', () => {
  const html = boardMarkup('manipulator', []);
  assert.equal(html.includes('<ol'), false);
  assert.equal(html.includes('<li'), false);
  assert.match(html, /class="leaderboard-board-note"/u);
  assert.equal(html.includes(BOARD_DESCRIPTIONS.manipulator), true);
  assert.match(html, /class="leaderboard-empty"/u);

  // 아직 불러오는 중이면 "기록 없음" 이라고 단정하지 않습니다.
  const loading = boardMarkup('manipulator', [], { showEmptyState: false });
  assert.equal(loading.includes('leaderboard-empty'), false);
});

test('조작단에는 설명 문구가 붙고 1위부터 순위가 그려진다', () => {
  assert.equal(BOARD_LABELS.protector, '생태 HAFS 보호단');
  assert.equal(BOARD_LABELS.manipulator, '데이터 조작단');
  assert.equal(BOARD_DESCRIPTIONS.manipulator, '웹 페이지에서 설정할 수 없는 파라미터 값이 사용된 기록');

  const boards = rankBoards([
    entry('m1', 4000, '20501', 'manipulator'),
    entry('m2', 9000, '20502', 'manipulator'),
  ]);
  const html = boardMarkup('manipulator', boards.manipulator);
  assert.equal((html.match(/<li /gu) ?? []).length, 2);
  assert.ok(html.indexOf('9,000') < html.indexOf('4,000'));
  assert.match(html, /<b>1<\/b>/u);
  assert.match(html, /aria-label="데이터 조작단 상위 기록"/u);

  // 보호단에는 조작단 설명이 붙지 않습니다.
  const protector = boardMarkup('protector', rankBoards([entry('p1', 800, '20314', 'protector')]).protector);
  assert.equal(protector.includes('leaderboard-board-note'), false);
});

test('학생 이름은 HTML escape 되어 그려진다', () => {
  const [ranked] = rankBoards([{ ...entry('x', 100, '20314', 'protector'), studentName: '<img>' }]).protector;
  const html = boardMarkup('protector', [ranked!]);
  assert.equal(html.includes('<img>'), false);
  assert.match(html, /&lt;img&gt;/u);
});
