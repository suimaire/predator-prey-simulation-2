import type { LeaderboardEntry } from '../../src/leaderboard.ts';
export const uuid = (i: number) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
export function publicRow(i = 1, overrides: Record<string, unknown> = {}) {
  return { id: uuid(i), challenge_id: 'apex-survival', simulation_version: 'apex-v1', seed: 260903,
    score: 1000 - i, school_name: 'HAFS', display_name: '홍○동', submitted_at: '2026-09-01T00:00:00.000Z',
    board_group: 'protector', is_hafs: true, ...overrides };
}
export function entry(i = 1, overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return { id: uuid(i), challengeId: 'apex-survival', simulationVersion: 'apex-v1', seed: 260903,
    score: 1000 - i, schoolName: 'HAFS', displayName: '홍○동', submittedAt: '2026-09-01T00:00:00.000Z',
    boardGroup: 'protector', isHafs: true, ...overrides };
}
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A synthetic PostgREST boundary that deliberately caps pages below the request's limit. */
export function fixtureServer(rows: ReturnType<typeof publicRow>[], maxRows = Infinity) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  return {
    calls,
    fetch: async (input: string, init?: RequestInit) => {
      const url = new URL(input); calls.push({ url, init });
      if (init?.method === 'POST') return new Response(null, { status: 201 });
      const q = url.searchParams;
      let result = rows.filter(r => `eq.${r.board_group}` === q.get('board_group'));
      if (q.get('is_hafs') === 'eq.true') result = result.filter(r => r.is_hafs);
      const cursor = q.get('or');
      if (cursor) {
        const score = Number(cursor.match(/score.lt.(-?\d+)/)![1]);
        const time = cursor.match(/submitted_at.gt.([^,)]+)/)![1]!;
        const id = cursor.match(/id.gt.([^,)]+)/)![1]!;
        result = result.filter(r => r.score < score || (r.score === score && (r.submitted_at > time || (r.submitted_at === time && r.id > id))));
      }
      if (q.has('score')) result = result.filter(r => r.score >= Number(q.get('score')!.slice(4)));
      result.sort((a, b) => b.score - a.score || a.submitted_at.localeCompare(b.submitted_at) || a.id.localeCompare(b.id));
      return json(result.slice(0, Math.min(maxRows, Number(q.get('limit')))));
    },
  };
}
