import {
  rankAccentClass,
  type BoardGroup,
  type LeaderboardScope,
  type RankedLeaderboardEntry,
} from './leaderboard.ts';

/** 기록판 화면 문구와 마크업. DOM에 의존하지 않으므로 테스트에서 그대로 호출할 수 있습니다. */
export const BOARD_LABELS: Readonly<Record<BoardGroup, string>> = Object.freeze({
  protector: '생태계 수호단',
  manipulator: 'AI RED TEAM',
});

export const BOARD_DESCRIPTIONS: Readonly<Record<BoardGroup, string>> = Object.freeze({
  protector: '',
  manipulator: '시스템의 경계를 탐색한 특별 기록',
});

/**
 * 탭 버튼 안의 마크업. 좁은 탭에서 줄이 바뀔 때 "RED TEAM"이 갈라지지 않도록 묶습니다.
 * 글자 자체는 BOARD_LABELS와 같습니다(textContent 기준).
 */
export const BOARD_TAB_MARKUP: Readonly<Record<BoardGroup, string>> = Object.freeze({
  protector: '생태계 수호단',
  manipulator: 'AI <span class="tab-nowrap">RED TEAM</span>',
});

export const SCOPE_LABELS: Readonly<Record<LeaderboardScope, string>> = Object.freeze({ national: '전국', hafs: 'HAFS' });

const BOARD_EMPTY_MESSAGES: Readonly<Record<BoardGroup, string>> = Object.freeze({
  protector: '아직 제출된 기록이 없습니다. 첫 기록을 남겨 보세요.',
  manipulator: '현재 AI RED TEAM에 올라간 기록이 없습니다.',
});

const HTML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => HTML_ESCAPES[character]!);
}

export function formatSubmittedAt(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export interface BoardMarkupOptions {
  compact?: boolean;
  /** 목록을 아직 받지 못했거나 오류가 난 동안에는 빈 상태 문구를 띄우지 않습니다. */
  showEmptyState?: boolean;
}

/**
 * 기록판 하나의 본문. 기록이 없으면 빈 <ol> 대신 안내 문구 한 줄만 그려서 표가 깨져 보이지
 * 않게 합니다. 순위는 이미 rankBoards()가 매긴 값을 그대로 씁니다.
 */
export function boardMarkup(
  board: BoardGroup,
  ranked: readonly RankedLeaderboardEntry[],
  { showEmptyState = true, compact = false }: BoardMarkupOptions = {},
): string {
  const description = !compact && BOARD_DESCRIPTIONS[board]
    ? `<p class="leaderboard-board-note">${escapeHtml(BOARD_DESCRIPTIONS[board])}</p>`
    : '';
  if (ranked.length === 0) {
    return showEmptyState
      ? `${description}<p class="leaderboard-empty">${escapeHtml(BOARD_EMPTY_MESSAGES[board])}</p>`
      : description;
  }
  // Presentation limits never re-sort or renumber ties from rankBoards().
  const items = (compact ? ranked.slice(0, 3) : ranked).map((entry) => `
      <li class="${rankAccentClass(entry.rank)}">
        <b>${entry.rank}</b>
        <span class="leaderboard-school">${escapeHtml(entry.schoolName)}</span>
        <span class="leaderboard-who"><strong>${escapeHtml(entry.displayName)}</strong></span>
        <span class="leaderboard-score">${entry.score.toLocaleString('ko-KR')}</span>
        ${compact ? '' : `<span class="leaderboard-meta"><time datetime="${escapeHtml(entry.submittedAt)}">${escapeHtml(formatSubmittedAt(entry.submittedAt))}</time></span>`}
      </li>`).join('');
  return `${description}<ol class="leaderboard-list${compact ? ' leaderboard-list--compact' : ''}" aria-label="${escapeHtml(BOARD_LABELS[board])} 상위 기록">${items}</ol>`;
}
