import assert from 'node:assert/strict';
import test from 'node:test';
import { rankBoards, BOARD_GROUPS, type LeaderboardEntry } from '../src/leaderboard.ts';
import { boardMarkup } from '../src/leaderboardView.ts';

for (const count of [0, 2, 3, 10, 14]) {
  test(`Top 3 and Top 10 share rank order for ${count} entries in each board`, () => {
    const entries = BOARD_GROUPS.flatMap((board) => Array.from({ length: count }, (_, i): LeaderboardEntry => ({
      id: `${board}-${i}`, challengeId: 'apex-survival', simulationVersion: 'apex-v1', seed: 260903,
      studentNumber: `${board}-${i}`, studentName: `participant-${i}`, score: 100 - Math.floor(i / 2),
      submittedAt: `2026-09-01T00:00:${String(i).padStart(2, '0')}.000Z`, boardGroup: board,
    })));
    const ranked = rankBoards(entries.reverse());
    for (const board of BOARD_GROUPS) {
      const mini = boardMarkup(board, ranked[board], { compact: true, limit: 3 });
      const detail = boardMarkup(board, ranked[board], { limit: 10 });
      assert.equal((mini.match(/<li /g) ?? []).length, Math.min(3, count));
      assert.equal((detail.match(/<li /g) ?? []).length, Math.min(10, count));
      const ranks = (html: string) => [...html.matchAll(/<b>(\d+)<\/b>/g)].map((match) => Number(match[1]));
      assert.deepEqual(ranks(mini), ranks(detail).slice(0, 3));
      assert.deepEqual(ranks(detail), ranked[board].slice(0, 10).map((entry) => entry.rank));
    }
  });
}

test('empty state only appears after a successful read, and names are escaped in text and title', () => {
  assert.match(boardMarkup('protector', [], { limit: 3 }), /leaderboard-empty/);
  assert.doesNotMatch(boardMarkup('protector', [], { showEmptyState: false }), /leaderboard-empty/);
  const records = rankBoards([{ id: 'a', challengeId: 'apex-survival', simulationVersion: 'apex-v1', seed: 260903,
    studentNumber: '1', studentName: '\"><img src=x onerror=alert(1)>', score: 4, boardGroup: 'protector', submittedAt: '' }]);
  for (const compact of [true, false]) {
    const html = boardMarkup('protector', records.protector, { compact });
    assert.doesNotMatch(html, /<img/); assert.match(html, /&quot;&gt;&lt;img/);
  }
});
