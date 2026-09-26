import {
  BOARD_GROUPS,
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

/** Mounted only in Apex Survival. Uses the existing v2 board rendering. */
export function leaderboardSummaryMarkup(): string {
  return `<section class="leaderboard-summary" aria-labelledby="ranking-summary-title">
                <div class="card-heading"><h2 id="ranking-summary-title">공개 랭킹 <small>Top 3</small></h2></div>
                <div class="leaderboard-tabs" role="tablist" aria-label="요약 기록판 선택">
                  ${BOARD_GROUPS.map(board => `<button type="button" role="tab" id="summary-tab-${board}" aria-controls="summary-board-${board}" aria-selected="${board === 'protector'}" tabindex="${board === 'protector' ? 0 : -1}">${BOARD_TAB_MARKUP[board]}</button>`).join('')}
                </div>
                ${BOARD_GROUPS.map(board => `<div id="summary-board-${board}" role="tabpanel" aria-labelledby="summary-tab-${board}" ${board === 'protector' ? '' : 'hidden'}><div class="ranking-mini-grid">${['national', 'hafs'].map(scope => `<section aria-labelledby="summary-heading-${board}-${scope}"><h3 id="summary-heading-${board}-${scope}">${scope === 'national' ? '전국' : 'HAFS'} TOP 3</h3><p class="leaderboard-status" id="summary-status-${board}-${scope}" aria-live="polite"></p><div id="summary-list-${board}-${scope}"></div></section>`).join('')}</div></div>`).join('')}
                <button type="button" id="open-leaderboard" aria-haspopup="dialog" aria-controls="leaderboard-dialog">전체 순위 보기</button>
              </section>`;
}

/** Build once off-document; mount only in Apex, preserving form state and listeners. */
export function createLeaderboardDialog(): HTMLDialogElement {
  const template = document.createElement('template');
  template.innerHTML = `<dialog id="leaderboard-dialog" class="dashboard-dialog leaderboard-dialog" aria-labelledby="leaderboard-title"><div class="dialog-heading"><h2 id="leaderboard-title">전국 · HAFS 랭킹</h2><button type="button" id="close-leaderboard" aria-label="랭킹 닫기">×</button></div><section class="leaderboard-panel" id="leaderboard-panel" aria-label="Apex Survival 기록판">
          <div class="leaderboard-heading">
            <div class="leaderboard-tabs" role="tablist" aria-label="기록판 선택">
              <button type="button" role="tab" id="leaderboard-tab-protector" data-board="protector" aria-controls="leaderboard-board-protector" aria-selected="true">${BOARD_TAB_MARKUP.protector}</button>
              <button type="button" role="tab" id="leaderboard-tab-manipulator" data-board="manipulator" aria-controls="leaderboard-board-manipulator" aria-selected="false" tabindex="-1">${BOARD_TAB_MARKUP.manipulator}</button>
            </div>
            <button type="button" id="leaderboard-refresh" aria-label="기록판 새로고침" title="새로고침">↻</button>
          </div>
          <p class="leaderboard-status" id="leaderboard-status" aria-live="polite"></p>
          <p class="leaderboard-ranking-note">참가자별 대표 최고 기록 · Top 10과 경계 동점자 전체 · 점수 단위: step</p>
          <div class="dialog-body ranking-body" tabindex="0" aria-label="상세 랭킹 목록">${BOARD_GROUPS.map(board => `<div class="leaderboard-board" role="tabpanel" id="leaderboard-board-${board}" aria-labelledby="leaderboard-tab-${board}" ${board === 'protector' ? '' : 'hidden'}><div class="ranking-scope-grid">${['national', 'hafs'].map(scope => `<section aria-labelledby="ranking-heading-${board}-${scope}"><h3 id="ranking-heading-${board}-${scope}">${scope === 'national' ? '전국 순위' : 'HAFS 랭킹'}</h3><p class="leaderboard-status" id="ranking-status-${board}-${scope}" aria-live="polite"></p><div id="ranking-list-${board}-${scope}"></div></section>`).join('')}</div></div>`).join('')}
          </div><form class="leaderboard-form" id="leaderboard-form" hidden>
            <label for="leaderboard-school"><span>학교</span><input id="leaderboard-school" data-max-codepoints="80" required placeholder="학교명을 입력해 주세요" autocomplete="off" aria-describedby="leaderboard-school-hint" /><small id="leaderboard-school-hint">최대 80자</small></label>
            <label for="leaderboard-student-number"><span>학번</span><input id="leaderboard-student-number" maxlength="24" placeholder="예: 10935" autocomplete="off" /></label>
            <label for="leaderboard-name"><span>이름</span><input id="leaderboard-name" maxlength="16" placeholder="예: 박창현" autocomplete="off" /></label>
            <button type="submit" class="challenge-primary" id="leaderboard-submit">이 기록 제출하기</button>
            <p class="leaderboard-privacy">학교명, 일부 가림 처리된 이름, 점수가 공개 기록판에 표시됩니다. 학번과 전체 이름은 참가자 구분 및 기록 관리를 위해 서버에 저장되지만 공개 기록판에는 표시되지 않습니다. 같은 학교의 같은 학번은 동일 참가자로 처리됩니다.</p>
          </form>
        </section></dialog>`;
  return template.content.firstElementChild as HTMLDialogElement;
}
