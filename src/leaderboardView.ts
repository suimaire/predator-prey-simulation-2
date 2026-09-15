import {
  participantKey,
  rankAccentClass,
  type BoardGroup,
  type LeaderboardEntry,
  type RankedLeaderboardEntry,
} from './leaderboard.ts';

/** 기록판 화면 문구와 마크업. DOM에 의존하지 않으므로 테스트에서 그대로 호출할 수 있습니다. */
export const BOARD_LABELS: Readonly<Record<BoardGroup, string>> = Object.freeze({
  protector: '생태 HAFS 보호단',
  manipulator: 'HAFS AI RED TEAM',
});

export const BOARD_DESCRIPTIONS: Readonly<Record<BoardGroup, string>> = Object.freeze({
  protector: '',
  manipulator: '시스템의 경계를 탐색한 특별 기록',
});

const BOARD_EMPTY_MESSAGES: Readonly<Record<BoardGroup, string>> = Object.freeze({
  protector: '아직 제출된 기록이 없습니다. 첫 기록을 남겨 보세요.',
  manipulator: '현재 HAFS AI RED TEAM에 올라간 기록이 없습니다.',
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

function verificationMarkup(entry: LeaderboardEntry): string {
  // 공개 view가 검증 상태를 내보내지 않는 동안에는 배지를 그리지 않습니다.
  if (!entry.verification) return '';
  if (entry.verification === 'verified') return '<i class="is-verified" title="서버 재실행으로 확인된 기록">✔ 검증됨</i>';
  if (entry.verification === 'rejected') return '<i class="is-rejected" title="서버 재실행 결과가 제출 점수와 다릅니다">✖ 재현 불일치</i>';
  return '<i class="is-unverified" title="아직 서버에서 재실행하지 않은 기록">· 미검증</i>';
}

export interface BoardMarkupOptions {
  highlightedParticipant?: string | null;
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
  { highlightedParticipant = null, showEmptyState = true }: BoardMarkupOptions = {},
): string {
  const description = BOARD_DESCRIPTIONS[board]
    ? `<p class="leaderboard-board-note">${escapeHtml(BOARD_DESCRIPTIONS[board])}</p>`
    : '';
  if (ranked.length === 0) {
    return showEmptyState
      ? `${description}<p class="leaderboard-empty">${escapeHtml(BOARD_EMPTY_MESSAGES[board])}</p>`
      : description;
  }
  const items = ranked.map((entry) => `
      <li class="${[rankAccentClass(entry.rank), participantKey(entry) === highlightedParticipant ? 'is-mine' : ''].filter(Boolean).join(' ')}">
        <b>${entry.rank}</b>
        <span class="leaderboard-who"><strong>${escapeHtml(entry.studentName)}</strong></span>
        <span class="leaderboard-score">${entry.score.toLocaleString()} step</span>
        <span class="leaderboard-meta"><small>${escapeHtml(entry.studentNumber)}</small><time datetime="${escapeHtml(entry.submittedAt)}">${escapeHtml(formatSubmittedAt(entry.submittedAt))}</time>${verificationMarkup(entry)}</span>
      </li>`).join('');
  return `${description}<ol class="leaderboard-list" tabindex="0" aria-label="${escapeHtml(BOARD_LABELS[board])} 상위 기록">${items}</ol>`;
}
