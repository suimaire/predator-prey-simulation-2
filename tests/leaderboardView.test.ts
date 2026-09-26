import assert from 'node:assert/strict';
import test from 'node:test';
import { rankBoards, BOARD_GROUPS } from '../src/leaderboard.ts';
import { boardMarkup } from '../src/leaderboardView.ts';
import { entry } from './fixtures/leaderboardFixtures.ts';

for (const count of [0, 2, 3, 10, 14, 80]) {
  test(`Top 3 preview shares ranks; detail retains all boundary ties (${count} records per board)`, () => {
    const entries = BOARD_GROUPS.flatMap(board => Array.from({ length: count }, (_, i) => entry(i + 1,
      { boardGroup: board, score: i < 9 ? 100 - Math.floor(i / 2) : 90 })));
    const ranked = rankBoards(entries.reverse());
    for (const board of BOARD_GROUPS) {
      const mini = boardMarkup(board, ranked[board], { compact: true });
      const detail = boardMarkup(board, ranked[board]);
      assert.equal((mini.match(/<li /g) ?? []).length, Math.min(3, count));
      assert.equal((detail.match(/<li /g) ?? []).length, count);
      const ranks = (html: string) => [...html.matchAll(/<b>(\d+)<\/b>/g)].map(match => Number(match[1]));
      assert.deepEqual(ranks(mini), ranks(detail).slice(0,3));
      assert.deepEqual(ranks(detail), ranked[board].map(r => r.rank));
    }
  });
}
test('empty requires a successful read; school/masked name are escaped; private extras cannot reach text, title or attributes', () => {
  assert.match(boardMarkup('protector', []), /leaderboard-empty/);
  assert.doesNotMatch(boardMarkup('protector', [], { showEmptyState: false }), /leaderboard-empty/);
  const publicEntry = { ...entry(1, { schoolName: '\"><img src=x onerror=alert(1)>', displayName: '<b>○&' }),
    studentNumber: 'PRIVATE-NUMBER', studentName: 'PRIVATE-NAME', schoolKey: 'PRIVATE-KEY' };
  const rows = rankBoards([publicEntry]).protector;
  for (const compact of [true, false]) {
    const html = boardMarkup('protector', rows, { compact });
    assert.doesNotMatch(html, /<img|PRIVATE-|is-mine|data-|title=/);
    assert.match(html, /&quot;&gt;&lt;img/); assert.match(html, /&lt;b&gt;○&amp;/);
    assert.match(html, /leaderboard-school/);
    if (!compact) assert.match(html, /<time datetime=/);
  }
});
