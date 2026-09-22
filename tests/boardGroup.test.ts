import assert from 'node:assert/strict';
import test from 'node:test';
import { BOARD_GROUPS, rankBoards, type LeaderboardEntry } from '../src/leaderboard.ts';
import { LeaderboardStore, leaderboardStateText } from '../src/leaderboardState.ts';
import { BOARD_LABELS, BOARD_TAB_MARKUP, boardMarkup } from '../src/leaderboardView.ts';
import { entry } from './fixtures/leaderboardFixtures.ts';

// Identity/RED TEAM/hidden/ACL tests formerly duplicated here now execute in leaderboardDb.test.ts.
// The browser has no private identity fields and must trust the server's representative records.
test('board rendering keeps different rows even when their school/masked names match across both boards', () => {
  assert.deepEqual([...BOARD_GROUPS], ['protector', 'manipulator']);
  const boards = rankBoards([entry(1), entry(2), entry(3, { boardGroup: 'manipulator' })]);
  assert.equal(boards.protector.length, 2); assert.equal(boards.manipulator.length, 1);
  assert.equal(BOARD_LABELS.protector, '생태계 수호단');
  assert.equal(BOARD_LABELS.manipulator, 'AI RED TEAM');
  assert.equal(BOARD_TAB_MARKUP.manipulator.replace(/<[^>]+>/g, ''), BOARD_LABELS.manipulator);
  assert.match(boardMarkup('manipulator', []), /시스템의 경계를 탐색한 특별 기록/);
  assert.match(boardMarkup('manipulator', []), /현재 AI RED TEAM/);
});

test('each scope/board commits independently, preserves stale success on failure, and ignores superseded success/error', async () => {
  const pending: { resolve: (rows: LeaderboardEntry[]) => void; reject: (reason: Error) => void }[] = [];
  const store = new LeaderboardStore({ name: 'fixture', submit: async () => {}, list: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  let renders = 0;
  const older = store.refresh(() => renders++);
  const newer = store.refresh(() => renders++);
  pending[4]!.resolve([entry(1)]);
  pending[5]!.resolve([entry(2, { boardGroup: 'manipulator' })]);
  pending[6]!.reject(new Error('private details'));
  pending[7]!.resolve([]);
  await newer;
  assert.equal(store.states.national.protector.phase, 'ready');
  assert.equal(store.states.hafs.protector.phase, 'error');
  assert.equal(store.states.hafs.manipulator.phase, 'ready');
  assert.ok(!leaderboardStateText(store.states.hafs.protector).includes('private details'));
  pending[0]!.resolve([entry(99)]); pending[1]!.reject(new Error('old')); pending[2]!.resolve([entry(88)]); pending[3]!.resolve([]);
  await older;
  assert.equal(store.states.national.protector.entries[0]!.id, entry(1).id);
  assert.equal(store.states.hafs.protector.phase, 'error');
  const last = store.refresh(() => renders++);
  assert.match(leaderboardStateText(store.states.national.protector), /이전 결과/);
  for (let i = 8; i < 12; i++) pending[i]!.reject(new Error('failed'));
  await last;
  assert.equal(store.states.national.protector.entries.length, 1);
  assert.match(leaderboardStateText(store.states.national.protector), /이전 결과/);
  assert.ok(renders > 0);
  assert.equal(new LeaderboardStore(null).states.national.protector.phase, 'disabled');
});
