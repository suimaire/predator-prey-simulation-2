import { BOARD_GROUPS, LEADERBOARD_SCOPES, LeaderboardError, rankEntries,
  type BoardGroup, type LeaderboardScope, type LeaderboardTransport, type RankedLeaderboardEntry } from './leaderboard.ts';

export interface LeaderboardState {
  phase: 'disabled' | 'idle' | 'loading' | 'ready' | 'error';
  entries: RankedLeaderboardEntry[];
  message: string;
  generation: number;
}

/** Requests commit independently; a superseded response cannot mutate either scope. */
export class LeaderboardStore {
  readonly states: Record<LeaderboardScope, Record<BoardGroup, LeaderboardState>>;
  private readonly transport: LeaderboardTransport | null;
  constructor(transport: LeaderboardTransport | null) {
    this.transport = transport;
    const state = (): LeaderboardState => ({ phase: transport ? 'idle' : 'disabled', entries: [], message: '', generation: 0 });
    this.states = { national: { protector: state(), manipulator: state() }, hafs: { protector: state(), manipulator: state() } };
  }
  async refresh(changed: () => void): Promise<void> {
    const transport = this.transport;
    if (!transport) return;
    await Promise.allSettled(LEADERBOARD_SCOPES.flatMap(scope => BOARD_GROUPS.map(async boardGroup => {
      const state = this.states[scope][boardGroup];
      const generation = ++state.generation;
      state.phase = 'loading'; state.message = ''; changed();
      try {
        const entries = await transport.list({ scope, boardGroup });
        if (generation !== state.generation) return;
        state.entries = rankEntries(entries);
        state.phase = 'ready';
      } catch (error) {
        if (generation !== state.generation) return;
        state.phase = 'error';
        state.message = error instanceof LeaderboardError ? error.message : '기록판을 불러오지 못했습니다. 다시 시도해 주세요.';
      }
      changed();
    })));
  }
}

export function leaderboardStateText(state: LeaderboardState): string {
  if (state.phase === 'disabled') return '중앙 기록판 서버가 연결되지 않았습니다. Personal Best는 이 브라우저에 계속 저장됩니다.';
  if (state.phase === 'idle') return '기록판을 준비하고 있습니다…';
  if (state.phase === 'loading') return state.entries.length ? '갱신 중입니다. 이전 결과를 표시합니다…' : '기록판을 불러오는 중입니다…';
  if (state.phase === 'error') return state.message + (state.entries.length ? ' 이전 결과를 표시합니다.' : '');
  return '';
}
