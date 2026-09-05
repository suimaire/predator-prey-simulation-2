import './simulation.css';
import { drawPopulationChart, SERIES_COLORS, type ChartSeries } from './charts.ts';
import {
  APEX_CHALLENGE_CONFIG,
  ApexChallengeSession,
  apexParameters,
  challengeSettingsLocked,
  createApexRecord,
  evaluateApexLevels,
  loadApexPersonalBest,
  saveApexPersonalBest,
  type ApexSurvivalRecord,
} from './challenge.ts';
import {
  createLeaderboardTransport,
  createSubmission,
  participantStorageKey,
  participantKey,
  rankEntries,
  validateParticipant,
  type LeaderboardEntry,
  type LeaderboardTransport,
  type Participant,
} from './leaderboard.ts';
import {
  DEFAULT_PARAMETERS,
  ForestSimulation,
  SPECIES_LABELS,
  activeSpecies,
  validateParameters,
  type Agent,
  type FoodChainDepth,
  type SimulationParameters,
  type SimulationSnapshot,
  type Species,
} from './model.ts';
import { createFreeExplorationSeed, createInitialFreeParameters } from './seed.ts';

type NumericParameterKey = Exclude<keyof SimulationParameters, 'toroidal' | 'seed' | 'foodChainDepth'>;
type ParameterGroup = 'start' | 'forest' | 'rabbit' | 'wolf' | 'tertiary' | 'quaternary';
type PyramidMode = 'numbers' | 'energy';
type AppMode = 'free' | 'apex';

interface ParameterDefinition {
  key: NumericParameterKey;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  group: ParameterGroup;
  format?: 'percent' | 'integer' | 'decimal';
  suffix?: string;
}

const parameterDefinitions: ParameterDefinition[] = [
  { key: 'gridColumns', label: '격자 크기', description: '열 수에 따라 행 수도 비례해 바뀝니다.', min: 20, max: 48, step: 4, group: 'start', format: 'integer', suffix: '열' },
  { key: 'initialRabbits', label: '초기 토끼 수', description: '실험을 시작할 때 배치할 토끼 수', min: 0, max: 400, step: 2, group: 'start', format: 'integer', suffix: '마리' },
  { key: 'initialWolves', label: '초기 늑대 수', description: '실험을 시작할 때 배치할 늑대 수', min: 0, max: 160, step: 2, group: 'start', format: 'integer', suffix: '마리' },
  { key: 'initialForestDensity', label: '초기 숲 밀도', description: '처음 격자에 자란 숲의 평균 정도', min: 0, max: 100, step: 2, group: 'start', format: 'integer', suffix: '%' },
  { key: 'forestRegrowth', label: '숲 재생 속도', description: '각 칸의 숲 단계가 한 단계 회복될 확률', min: 0, max: 0.25, step: 0.005, group: 'forest', format: 'percent' },
  { key: 'forestMaxStage', label: '숲 최대 밀도', description: '각 칸이 도달할 수 있는 최고 성장 단계', min: 1, max: 4, step: 1, group: 'forest', format: 'integer', suffix: '단계' },
  { key: 'rabbitMoveProbability', label: '이동 확률', description: '토끼가 숲이 많은 이웃 칸으로 움직일 확률', min: 0, max: 1, step: 0.02, group: 'rabbit', format: 'percent' },
  { key: 'rabbitMoveDistance', label: '이동 거리', description: '한 step에 살펴볼 수 있는 최대 칸 수', min: 1, max: 3, step: 1, group: 'rabbit', format: 'integer', suffix: '칸' },
  { key: 'rabbitBreedProbability', label: '번식 확률', description: '에너지 조건을 만족할 때의 번식 확률', min: 0, max: 0.8, step: 0.01, group: 'rabbit', format: 'percent' },
  { key: 'rabbitBreedEnergy', label: '번식 최소 에너지', description: '이 값 이상일 때만 번식을 시도합니다.', min: 2, max: 80, step: 1, group: 'rabbit', format: 'integer' },
  { key: 'rabbitEnergyCost', label: 'step당 에너지 소모', description: '살아 있고 움직이는 데 필요한 에너지', min: 0.1, max: 8, step: 0.05, group: 'rabbit', format: 'decimal' },
  { key: 'rabbitFoodEnergy', label: '식생 섭취 에너지 기준', description: '전달 효율 10%에서 식사 1회로 얻는 모델 에너지', min: 0.5, max: 25, step: 0.5, group: 'rabbit', format: 'decimal' },
  { key: 'rabbitMaxAge', label: '최대 수명', description: '이 나이에 도달하면 자연사합니다.', min: 10, max: 240, step: 5, group: 'rabbit', format: 'integer', suffix: 'step' },
  { key: 'wolfMoveProbability', label: '이동 확률', description: '주변에 토끼가 없을 때 이동할 확률', min: 0, max: 1, step: 0.02, group: 'wolf', format: 'percent' },
  { key: 'wolfMoveDistance', label: '탐색·이동 거리', description: '한 step에 토끼를 찾을 수 있는 최대 범위', min: 1, max: 4, step: 1, group: 'wolf', format: 'integer', suffix: '칸' },
  { key: 'wolfBreedProbability', label: '번식 확률', description: '에너지 조건을 만족할 때의 번식 확률', min: 0, max: 0.6, step: 0.01, group: 'wolf', format: 'percent' },
  { key: 'wolfBreedEnergy', label: '번식 최소 에너지', description: '이 값 이상일 때만 번식을 시도합니다.', min: 4, max: 120, step: 1, group: 'wolf', format: 'integer' },
  { key: 'wolfEnergyCost', label: 'step당 에너지 소모', description: '사냥하지 못해도 매 step 줄어드는 에너지', min: 0.1, max: 10, step: 0.05, group: 'wolf', format: 'decimal' },
  { key: 'wolfFoodEnergy', label: '토끼 섭취 에너지 기준', description: '전달 효율 10%에서 사냥 1회로 얻는 모델 에너지', min: 1, max: 50, step: 1, group: 'wolf', format: 'integer' },
  { key: 'wolfMaxAge', label: '최대 수명', description: '이 나이에 도달하면 자연사합니다.', min: 10, max: 300, step: 5, group: 'wolf', format: 'integer', suffix: 'step' },
  { key: 'initialTertiary', label: '초기 개체수', description: '늑대보다 적은 수로 시작합니다.', min: 0, max: 40, step: 1, group: 'tertiary', format: 'integer', suffix: '마리' },
  { key: 'tertiaryMoveProbability', label: '이동 확률', description: '주변에 늑대가 없을 때 이동할 확률', min: 0, max: 1, step: 0.02, group: 'tertiary', format: 'percent' },
  { key: 'tertiaryMoveDistance', label: '탐색·이동 거리', description: '늑대를 찾을 수 있는 최대 범위', min: 1, max: 5, step: 1, group: 'tertiary', format: 'integer', suffix: '칸' },
  { key: 'tertiaryEnergyCost', label: 'step당 에너지 소모', description: '먹이를 찾지 못해도 사용하는 에너지', min: 0.1, max: 10, step: 0.05, group: 'tertiary', format: 'decimal' },
  { key: 'tertiaryBreedProbability', label: '번식 확률', description: '에너지 조건을 만족할 때의 번식 확률', min: 0, max: 0.3, step: 0.002, group: 'tertiary', format: 'percent' },
  { key: 'tertiaryBreedEnergy', label: '번식 최소 에너지', description: '이 값 이상일 때만 번식을 시도합니다.', min: 4, max: 160, step: 1, group: 'tertiary', format: 'integer' },
  { key: 'tertiaryFoodEnergy', label: '늑대 섭취 에너지 기준', description: '전달 효율 10%에서 사냥 1회로 얻는 모델 에너지', min: 1, max: 80, step: 1, group: 'tertiary', format: 'integer' },
  { key: 'tertiaryMaxAge', label: '최대 수명', description: '이 나이에 도달하면 자연사합니다.', min: 10, max: 360, step: 5, group: 'tertiary', format: 'integer', suffix: 'step' },
  { key: 'initialQuaternary', label: '초기 개체수', description: '먹이사슬에서 가장 적은 수로 시작합니다.', min: 0, max: 20, step: 1, group: 'quaternary', format: 'integer', suffix: '마리' },
  { key: 'quaternaryMoveProbability', label: '이동 확률', description: '주변에 3차 소비자가 없을 때 이동할 확률', min: 0, max: 1, step: 0.02, group: 'quaternary', format: 'percent' },
  { key: 'quaternaryMoveDistance', label: '탐색·이동 거리', description: '3차 소비자를 찾을 수 있는 최대 범위', min: 1, max: 6, step: 1, group: 'quaternary', format: 'integer', suffix: '칸' },
  { key: 'quaternaryEnergyCost', label: 'step당 에너지 소모', description: '먹이를 찾지 못해도 사용하는 에너지', min: 0.1, max: 10, step: 0.05, group: 'quaternary', format: 'decimal' },
  { key: 'quaternaryBreedProbability', label: '번식 확률', description: '에너지 조건을 만족할 때의 번식 확률', min: 0, max: 0.3, step: 0.002, group: 'quaternary', format: 'percent' },
  { key: 'quaternaryBreedEnergy', label: '번식 최소 에너지', description: '이 값 이상일 때만 번식을 시도합니다.', min: 4, max: 200, step: 1, group: 'quaternary', format: 'integer' },
  { key: 'quaternaryFoodEnergy', label: '3차 소비자 섭취 에너지 기준', description: '전달 효율 10%에서 사냥 1회로 얻는 모델 에너지', min: 1, max: 100, step: 1, group: 'quaternary', format: 'integer' },
  { key: 'quaternaryMaxAge', label: '최대 수명', description: '이 나이에 도달하면 자연사합니다.', min: 10, max: 420, step: 5, group: 'quaternary', format: 'integer', suffix: 'step' },
];

const groupInfo: Record<ParameterGroup, { title: string; subtitle: string; icon: string }> = {
  start: { title: '시작 조건', subtitle: '격자와 초기 분포', icon: '◎' },
  forest: { title: '숲', subtitle: '성장과 최대 밀도', icon: '♣' },
  rabbit: { title: '토끼', subtitle: '이동·먹이·번식·사망', icon: '♙' },
  wolf: { title: '늑대', subtitle: '탐색·사냥·번식·사망', icon: '◆' },
  tertiary: { title: '3차 소비자', subtitle: '늑대를 먹는 상위 포식자', icon: '▲' },
  quaternary: { title: '4차 소비자', subtitle: '최상위 영양 단계', icon: '⬟' },
};

function formatParameter(definition: ParameterDefinition, value: number): string {
  if (definition.format === 'percent') return `${Math.round(value * 100)}%`;
  if (definition.format === 'decimal') return value.toFixed(value < 1 ? 2 : 1);
  return `${Math.round(value)}${definition.suffix ? ` ${definition.suffix}` : ''}`;
}

function parameterMarkup(group: ParameterGroup): string {
  return parameterDefinitions.filter((definition) => definition.group === group).map((definition) => `
    <label class="parameter-control" for="param-${definition.key}">
      <span class="parameter-heading"><b>${definition.label}</b><output id="output-${definition.key}">${formatParameter(definition, DEFAULT_PARAMETERS[definition.key])}</output></span>
      <span class="parameter-description">${definition.description}</span>
      <input id="param-${definition.key}" data-parameter="${definition.key}" type="range" min="${definition.min}" max="${definition.max}" step="${definition.step}" value="${DEFAULT_PARAMETERS[definition.key]}" />
    </label>`).join('');
}

function parameterGroupMarkup(group: ParameterGroup, open: boolean): string {
  const info = groupInfo[group];
  return `<details class="parameter-group" data-species-group="${group}" ${open ? 'open' : ''}>
    <summary><span class="group-icon ${group}">${info.icon}</span><span><b>${info.title}</b><small>${info.subtitle}</small></span><i>⌄</i></summary>
    <div class="parameter-group-content">${parameterMarkup(group)}</div>
  </details>`;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('앱을 표시할 요소를 찾을 수 없습니다.');

// This module is evaluated once per page load, so the free-exploration seed is
// generated once and then kept as the initial seed for this page session.
const initialFreeParameters = createInitialFreeParameters();

app.innerHTML = `
  <div class="app-shell parameters-hidden" id="app-shell">
    <nav class="portal-nav" aria-label="과학 수업 포털 안내">
      <a class="portal-link" href="https://suimaire.github.io/" aria-label="과학 수업 포털로 돌아가기">← 과학 수업 포털</a>
    </nav>
    <header class="topbar">
      <div class="brand-mark" aria-hidden="true"><span></span></div>
      <div class="brand-copy"><p class="eyebrow">통합과학 2 · 생태계 상호작용</p><h1>Rabbits <span>&</span> Wolves</h1><p>Extended forest population lab</p></div>
      <div class="food-chain" id="header-chain" aria-label="현재 먹이 관계"></div>
      <div class="lesson-chip"><b>탐구 02</b><span>영양 단계와 생태계 변화</span></div>
    </header>

    <div class="lab-layout">
      <aside class="parameter-panel" aria-label="시뮬레이션 파라미터">
        <div class="panel-title-row"><div><p class="section-kicker">EXPERIMENT SETUP</p><h2>실험 조건</h2></div><button type="button" class="icon-button close-parameters" aria-label="실험 조건 닫기">×</button></div>
        <div class="parameter-scroll">
          <section class="leaderboard-panel" id="leaderboard-panel" aria-labelledby="leaderboard-heading" hidden>
            <div class="leaderboard-heading">
              <h3 id="leaderboard-heading">학급 기록판</h3>
              <button type="button" id="leaderboard-refresh" aria-label="학급 기록판 새로고침" title="새로고침">↻</button>
            </div>
            <p class="leaderboard-status" id="leaderboard-status" aria-live="polite"></p>
            <ol class="leaderboard-list" id="leaderboard-list" tabindex="0" aria-label="학급 상위 기록"></ol>
            <form class="leaderboard-form" id="leaderboard-form" hidden>
              <label for="leaderboard-student-number"><span>학번</span><input id="leaderboard-student-number" maxlength="24" placeholder="예: 10935" autocomplete="off" /></label>
              <label for="leaderboard-name"><span>이름</span><input id="leaderboard-name" maxlength="16" placeholder="예: 박창현" autocomplete="off" /></label>
              <button type="submit" class="challenge-primary" id="leaderboard-submit">이 기록 제출하기</button>
              <p class="leaderboard-privacy">입력한 학번과 이름은 수업용 기록판에 공개되고 선생님이 관리하는 서버에 저장됩니다. 같은 학번으로 다시 제출하면 최고 기록 하나만 남습니다. 실명을 남기고 싶지 않다면 선생님과 약속한 표기를 사용하세요.</p>
            </form>
          </section>
          <p class="parameter-lock-note" id="parameter-lock-note" hidden>🔒 도전 진행 중에는 설정을 변경할 수 없습니다.</p>
          <section class="special-controls chain-controls">
            <label for="food-depth"><span><b>먹이사슬 단계</b><small>활성화할 최고 소비자 단계를 고릅니다.</small></span></label>
            <select id="food-depth"><option value="2">2차 소비자까지 — 기본</option><option value="3">3차 소비자까지</option><option value="4">4차 소비자까지</option></select>
            <label class="parameter-control efficiency-control" for="transfer-efficiency"><span class="parameter-heading"><b>에너지 전달 효율</b><output id="transfer-output">10%</output></span><span class="parameter-description">10%는 학습용 대표값이며 생태계와 생물에 따라 달라질 수 있습니다.</span><input id="transfer-efficiency" type="range" min="0.05" max="0.30" step="0.01" value="0.10" /></label>
          </section>
          ${parameterGroupMarkup('start', true)}
          <section class="special-controls">
            <label class="seed-control" for="seed-input"><span><b id="seed-label">Random seed</b><small id="seed-helper">같은 seed와 설정은 같은 결과를 재현합니다.</small></span></label>
            <div class="seed-input-row"><input id="seed-input" maxlength="40" value="${initialFreeParameters.seed}" /><button type="button" id="random-seed" aria-label="새 랜덤 시드 만들기">↻</button></div>
            <label class="toggle-control" for="toroidal-toggle"><span><b>토로이드 경계</b><small>가장자리가 반대쪽과 연결됩니다.</small></span><input id="toroidal-toggle" type="checkbox" checked /><i></i></label>
          </section>
          ${parameterGroupMarkup('forest', true)}
          ${parameterGroupMarkup('rabbit', false)}
          ${parameterGroupMarkup('wolf', false)}
          ${parameterGroupMarkup('tertiary', false)}
          ${parameterGroupMarkup('quaternary', false)}
          <button type="button" class="restore-button" id="restore-defaults">기본 설정으로 복원</button>
        </div>
      </aside>

      <main class="workspace">
        <section class="mode-bar" aria-label="시뮬레이션 모드">
          <div class="mode-switch" role="group" aria-label="모드 선택"><button type="button" data-app-mode="free" aria-pressed="true">자유 탐구</button><button type="button" data-app-mode="apex" aria-pressed="false">Apex Survival</button></div>
          <p id="mode-summary">파라미터와 먹이사슬 단계를 자유롭게 바꾸며 탐구합니다.</p>
        </section>
        <section class="challenge-panel" id="challenge-panel" aria-live="polite" hidden></section>
        <nav class="sim-toolbar" aria-label="시뮬레이션 조작">
          <div class="run-controls"><button class="run-button" id="run-button" type="button" aria-label="시뮬레이션 실행"><span>▶</span><b>Run</b></button><button id="pause-button" type="button" aria-label="시뮬레이션 일시정지" disabled><span>Ⅱ</span><b>Pause</b></button><button id="step-button" type="button" aria-label="한 step 실행"><span>↦</span><b>Step</b></button><button id="reset-button" type="button" aria-label="시뮬레이션 Reset"><span>↺</span><b>Reset</b></button></div>
          <div class="toolbar-middle"><label for="speed-control"><span>속도</span><input id="speed-control" type="range" min="1" max="24" value="8" /><output id="speed-output">8 step/s</output></label></div>
          <div class="view-controls"><button type="button" id="toggle-parameters" aria-label="실험 조건 열기 또는 닫기" aria-pressed="false"><span>☷</span><b>Parameters</b></button><button type="button" id="toggle-graph" aria-label="개체군 그래프 표시 또는 숨기기" aria-pressed="true"><span>⌁</span><b>Graph</b></button><div class="step-readout"><span>STEP</span><strong id="step-value">000</strong></div></div>
        </nav>

        <section class="simulation-grid">
          <section class="board-card" aria-labelledby="forest-heading">
            <div class="board-heading"><div><p class="section-kicker">LIVE ECOSYSTEM</p><h2 id="forest-heading">숲 생태계</h2></div><div class="legend" id="board-legend"></div></div>
            <div class="canvas-frame"><canvas id="forest-board" tabindex="0" aria-label="격자형 숲 생태계. 칸을 선택하면 상태를 확인할 수 있습니다."></canvas><div class="board-status" id="board-status"><span></span><b>준비됨</b></div><div class="cell-inspector" id="cell-inspector" hidden></div></div>
            <div class="board-footnote"><span>칸을 클릭하거나 터치해 식생 단계와 개체 에너지를 확인하세요.</span><span><b>공간 규칙</b> 식생과 동물은 함께 존재 · 동물은 한 칸에 한 마리</span></div>
            <div class="population-strip" id="population-strip"></div>
          </section>

          <aside class="monitor-panel" aria-label="생태 피라미드와 종 제거 실험">
            <section class="pyramid-card">
              <div class="card-heading"><div><p class="section-kicker">LIVE ECOLOGICAL PYRAMID</p><h2>실시간 생태 피라미드</h2></div><span class="live-pill"><i></i> LIVE</span></div>
              <div class="segmented-control" role="group" aria-label="피라미드 표현 방식"><button type="button" data-pyramid-mode="numbers" aria-pressed="true">개체수</button><button type="button" data-pyramid-mode="energy" aria-pressed="false">에너지 흐름</button></div>
              <div class="pyramid" id="pyramid"></div>
              <p class="pyramid-note" id="pyramid-note"></p>
              <div class="chain-status"><small>현재 먹이사슬</small><b id="current-chain"></b><span id="chain-summary"></span></div>
            </section>

            <section class="removal-card">
              <div class="card-heading"><div><p class="section-kicker">SPECIES REMOVAL EXPERIMENT</p><h2>종 제거 실험</h2></div><span>Reset으로 복구</span></div>
              <p class="removal-restriction" id="removal-restriction" hidden>Apex Survival 중에는 종 제거 실험을 사용할 수 없습니다.</p>
              <div class="removal-list" id="removal-list"></div>
            </section>
          </aside>
        </section>

        <section class="graph-card" id="graph-card">
          <div class="card-heading"><div><p class="section-kicker">POPULATION GRAPH</p><h2>개체군 변화</h2></div><span class="live-pill"><i></i> LIVE</span></div>
          <div class="graph-legend" id="graph-legend" aria-label="그래프 계열 표시 전환"></div>
          <canvas id="population-chart" aria-label="시간에 따른 활성 영양 단계와 숲 밀도 그래프"></canvas>
          <div class="graph-foot"><p><span>왼쪽 축: 소비자 개체 수</span><span>오른쪽 축: 숲 평균 밀도</span></p><div id="intervention-log"></div></div>
        </section>

        <section class="lower-grid">
          <section class="statistics-card"><div class="card-heading"><div><p class="section-kicker">CUMULATIVE RECORD</p><h2>누적 통계</h2></div><span>현재 실험</span></div><div class="stat-grid" id="stat-grid"></div></section>
          <section class="learning-card"><div class="card-heading"><div><p class="section-kicker">MODEL ASSUMPTIONS</p><h2>모형의 가정과 한계</h2></div><span class="model-badge">확률적 모형</span></div><ul><li>학습을 위해 먹이 관계를 <b>직선형 먹이사슬</b>로 단순화했습니다. 실제 생태계는 대부분 먹이그물입니다.</li><li>영양 단계가 높을수록 이용 가능한 에너지가 제한되는 경향이 있습니다.</li><li><b>10%</b>는 보편 법칙이 아닌 교육적 대표값이며 실제 효율은 생태계와 종에 따라 다릅니다.</li><li>에너지는 실제 Joule 측정치가 아닌 <b>모델 내부 값</b>입니다.</li></ul><p class="model-limit">종 제거 뒤의 변화와 Apex Survival 점수는 실제 생태계의 안정성을 직접 측정하지 않으며, 이 단순화된 모형과 사용자가 고른 파라미터에서 나타난 결과입니다.</p></section>
        </section>

        <details class="rule-card"><summary><span><b>이 모델은 한 step을 어떻게 계산할까요?</b><small>행동 순서와 에너지 규칙 보기</small></span><i>⌄</i></summary><div class="rule-content"><ol><li><b>식생 성장</b><span>확률에 따라 한 단계 회복</span></li><li><b>토끼 행동</b><span>이동·식생 섭취·번식·사망</span></li><li><b>늑대 행동</b><span>토끼 탐색·사냥·번식·사망</span></li><li><b>상위 소비자</b><span>활성 단계별 동일 규칙 적용</span></li><li><b>기록</b><span>개체수·섭식 에너지·개입 저장</span></li></ol><p>한 번의 섭식에서 먹이의 가용 모델 에너지에 전달 효율을 정확히 한 번 적용합니다. 10%에서 기존 토끼·늑대의 획득량이 유지되며, 효율을 바꾸면 모든 영양 단계의 섭식 획득량이 같은 규칙으로 변합니다.</p></div></details>
      </main>
    </div>

    <dialog id="removal-dialog"><form method="dialog"><span class="dialog-icon">↯</span><h2 id="dialog-title">종을 제거할까요?</h2><p id="dialog-copy"></p><div><button value="cancel">취소</button><button value="confirm" class="confirm-removal" id="confirm-removal">제거</button></div></form></dialog>
  </div>`;

function element<T extends HTMLElement>(selector: string): T {
  const match = document.querySelector<T>(selector);
  if (!match) throw new Error(`${selector} 요소를 찾을 수 없습니다.`);
  return match;
}

const shell = element<HTMLDivElement>('#app-shell');
const board = element<HTMLCanvasElement>('#forest-board');
const chart = element<HTMLCanvasElement>('#population-chart');
const runButton = element<HTMLButtonElement>('#run-button');
const pauseButton = element<HTMLButtonElement>('#pause-button');
const stepButton = element<HTMLButtonElement>('#step-button');
const resetButton = element<HTMLButtonElement>('#reset-button');
const parameterToggle = element<HTMLButtonElement>('#toggle-parameters');
const graphToggle = element<HTMLButtonElement>('#toggle-graph');
const speedControl = element<HTMLInputElement>('#speed-control');
const speedOutput = element<HTMLOutputElement>('#speed-output');
const seedInput = element<HTMLInputElement>('#seed-input');
const toroidalToggle = element<HTMLInputElement>('#toroidal-toggle');
const depthSelect = element<HTMLSelectElement>('#food-depth');
const transferControl = element<HTMLInputElement>('#transfer-efficiency');
const inspector = element<HTMLDivElement>('#cell-inspector');
const removalDialog = element<HTMLDialogElement>('#removal-dialog');
const challengePanel = element<HTMLElement>('#challenge-panel');
const leaderboardPanel = element<HTMLElement>('#leaderboard-panel');
const leaderboardList = element<HTMLOListElement>('#leaderboard-list');
const leaderboardStatus = element<HTMLParagraphElement>('#leaderboard-status');
const leaderboardForm = element<HTMLFormElement>('#leaderboard-form');
const leaderboardNumberInput = element<HTMLInputElement>('#leaderboard-student-number');
const leaderboardNameInput = element<HTMLInputElement>('#leaderboard-name');
const leaderboardSubmitButton = element<HTMLButtonElement>('#leaderboard-submit');
const leaderboardRefreshButton = element<HTMLButtonElement>('#leaderboard-refresh');

let parameters: SimulationParameters = { ...initialFreeParameters };
let freeParameters: SimulationParameters = { ...parameters };
let apexDesignParameters: SimulationParameters = apexParameters(parameters);
let simulation = new ForestSimulation(parameters);
let appMode: AppMode = 'free';
let hasApexDesign = false;
const apexSession = new ApexChallengeSession();
let personalBest: ApexSurvivalRecord | null = loadApexPersonalBest(window.localStorage);
let isNewPersonalBest = false;
const leaderboardTransport: LeaderboardTransport | null = createLeaderboardTransport({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  table: import.meta.env.VITE_LEADERBOARD_TABLE,
  publicView: import.meta.env.VITE_LEADERBOARD_PUBLIC_VIEW,
});
type LeaderboardStatus = 'disabled' | 'idle' | 'loading' | 'ready' | 'error';
let leaderboardStatusPhase: LeaderboardStatus = leaderboardTransport ? 'idle' : 'disabled';
let leaderboardEntries: readonly LeaderboardEntry[] = [];
let leaderboardMessage = '';
let leaderboardSubmitting = false;
let leaderboardRequestId = 0;
let lastFinishedRecord: ApexSurvivalRecord | null = null;
let hasSubmittedFinishedRecord = false;
let highlightedParticipant: string | null = null;
let leaderboardSignature = '';
let challengeMessage = '';
let running = false;
let lastAnimationTime = performance.now();
let accumulatedTime = 0;
let resetTimer = 0;
let pyramidMode: PyramidMode = 'numbers';
let pendingRemoval: Species | null = null;
const visibleSeries = new Set<ChartSeries>(['forest', 'rabbit', 'wolf', 'tertiary', 'quaternary']);

const speciesClass: Record<Species, string> = { rabbit: 'rabbit', wolf: 'wolf', tertiary: 'tertiary', quaternary: 'quaternary' };

function allActiveAgents(snapshot: SimulationSnapshot): Agent[] {
  return activeSpecies(parameters.foodChainDepth).flatMap((species) => [...snapshot.agents[species]]);
}

function drawRabbit(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, simple = false): void {
  ctx.save(); ctx.translate(x, y); ctx.lineWidth = Math.max(1.2, size * 0.07); ctx.strokeStyle = '#2b211a'; ctx.fillStyle = '#f2a34a'; ctx.lineJoin = 'round';
  if (simple) {
    ctx.beginPath(); ctx.moveTo(-size * 0.13, -size * 0.08); ctx.lineTo(-size * 0.17, -size * 0.48); ctx.moveTo(size * 0.08, -size * 0.08); ctx.lineTo(size * 0.12, -size * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, size * 0.12, size * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.ellipse(-size * 0.13, -size * 0.29, size * 0.085, size * 0.27, -0.18, 0, Math.PI * 2); ctx.ellipse(size * 0.075, -size * 0.31, size * 0.085, size * 0.29, 0.12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, size * 0.13, size * 0.31, size * 0.27, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff5d8'; ctx.beginPath(); ctx.arc(size * 0.24, size * 0.13, size * 0.085, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#151515'; ctx.beginPath(); ctx.arc(size * 0.09, size * 0.035, Math.max(1, size * 0.034), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawWolf(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, simple = false): void {
  ctx.save(); ctx.translate(x, y); ctx.lineWidth = Math.max(1.2, size * 0.068); ctx.strokeStyle = '#101d2b'; ctx.fillStyle = '#5b718b'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-size * 0.47, size * 0.11); ctx.lineTo(-size * 0.29, -size * 0.05); ctx.lineTo(-size * 0.19, -size * 0.27); ctx.lineTo(-size * 0.03, -size * 0.13); ctx.lineTo(size * 0.18, -size * 0.1); ctx.lineTo(size * 0.3, -size * 0.32); ctx.lineTo(size * 0.41, -size * 0.12); ctx.lineTo(size * 0.49, -size * 0.03); ctx.lineTo(size * 0.3, size * 0.08); ctx.lineTo(size * 0.22, size * 0.3); ctx.lineTo(size * 0.08, size * 0.3); ctx.lineTo(size * 0.03, size * 0.1); ctx.lineTo(-size * 0.18, size * 0.12); ctx.lineTo(-size * 0.25, size * 0.31); ctx.lineTo(-size * 0.38, size * 0.31); ctx.lineTo(-size * 0.38, size * 0.13); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (!simple) { ctx.fillStyle = '#edf3f5'; ctx.beginPath(); ctx.moveTo(size * 0.3, -size * 0.04); ctx.lineTo(size * 0.46, -size * 0.02); ctx.lineTo(size * 0.32, size * 0.05); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#0c1722'; ctx.beginPath(); ctx.arc(size * 0.28, -size * 0.1, size * 0.036, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function drawTertiary(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, simple = false): void {
  ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1.1, size * 0.06); ctx.strokeStyle = '#28172b'; ctx.fillStyle = '#934d7b';
  ctx.beginPath();
  ctx.moveTo(-size * 0.5, size * 0.12); ctx.lineTo(-size * 0.18, -size * 0.2); ctx.lineTo(-size * 0.07, -size * 0.05);
  ctx.lineTo(size * 0.17, -size * 0.31); ctx.lineTo(size * 0.12, -size * 0.03); ctx.lineTo(size * 0.48, size * 0.08);
  ctx.lineTo(size * 0.14, size * 0.14); ctx.lineTo(0, size * 0.36); ctx.lineTo(-size * 0.1, size * 0.14); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (!simple) { ctx.fillStyle = '#f1d98c'; ctx.beginPath(); ctx.moveTo(size * 0.18, -size * 0.15); ctx.lineTo(size * 0.42, -size * 0.1); ctx.lineTo(size * 0.2, -size * 0.02); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

function drawQuaternary(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, simple = false): void {
  ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1.2, size * 0.055); ctx.strokeStyle = '#060711'; ctx.fillStyle = '#29243f';
  ctx.beginPath();
  ctx.moveTo(-size * 0.45, size * 0.18); ctx.lineTo(-size * 0.35, -size * 0.12); ctx.lineTo(-size * 0.18, -size * 0.31); ctx.lineTo(-size * 0.05, -size * 0.12);
  ctx.lineTo(size * 0.2, -size * 0.2); ctx.lineTo(size * 0.34, -size * 0.42); ctx.lineTo(size * 0.43, -size * 0.1); ctx.lineTo(size * 0.52, size * 0.02);
  ctx.lineTo(size * 0.31, size * 0.16); ctx.lineTo(size * 0.22, size * 0.36); ctx.lineTo(size * 0.04, size * 0.34); ctx.lineTo(-size * 0.06, size * 0.12); ctx.lineTo(-size * 0.27, size * 0.35); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (!simple) { ctx.fillStyle = '#f0bd45'; ctx.beginPath(); ctx.arc(size * 0.29, -size * 0.08, size * 0.04, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function drawSpecies(ctx: CanvasRenderingContext2D, species: Species, x: number, y: number, size: number, simple = false): void {
  if (species === 'rabbit') drawRabbit(ctx, x, y, size * 0.75, simple);
  else if (species === 'wolf') drawWolf(ctx, x, y, size * 0.88, simple);
  else if (species === 'tertiary') drawTertiary(ctx, x, y, size, simple);
  else drawQuaternary(ctx, x, y, size * 1.06, simple);
}

function initializeIconCanvases(): void {
  document.querySelectorAll<HTMLCanvasElement>('[data-mini-icon]').forEach((canvas) => {
    const ctx = canvas.getContext('2d');
    const species = canvas.dataset.miniIcon as Species | undefined;
    if (!ctx || !species) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSpecies(ctx, species, canvas.width / 2, canvas.height * 0.54, canvas.width * 0.72);
  });
}

function drawBoard(snapshot: SimulationSnapshot): void {
  const cellSize = 24;
  const logicalWidth = snapshot.width * cellSize;
  const logicalHeight = snapshot.height * cellSize;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  if (board.width !== logicalWidth * ratio || board.height !== logicalHeight * ratio) {
    board.width = logicalWidth * ratio; board.height = logicalHeight * ratio;
    board.style.aspectRatio = `${logicalWidth} / ${logicalHeight}`;
  }
  const ctx = board.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, logicalWidth, logicalHeight);
  const colors = ['#ad8a5b', '#c5d8a9', '#96bc75', '#5f9656', '#2f6b40'];
  for (let y = 0; y < snapshot.height; y += 1) {
    for (let x = 0; x < snapshot.width; x += 1) {
      const stage = snapshot.forest[y * snapshot.width + x];
      ctx.fillStyle = colors[Math.round((stage / snapshot.maxForestStage) * 4)];
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      ctx.strokeStyle = 'rgba(27,55,34,.14)'; ctx.lineWidth = 0.7;
      ctx.strokeRect(x * cellSize + 0.35, y * cellSize + 0.35, cellSize - 0.7, cellSize - 0.7);
    }
  }
  const displayedCellSize = board.clientWidth > 0 ? board.clientWidth / snapshot.width : cellSize;
  const simple = displayedCellSize < 16;
  for (const species of activeSpecies(parameters.foodChainDepth)) {
    for (const agent of snapshot.agents[species]) drawSpecies(ctx, species, (agent.x + 0.5) * cellSize, (agent.y + 0.54) * cellSize, cellSize, simple);
  }
}

function chainLabels(): string[] {
  return ['식생', ...activeSpecies(parameters.foodChainDepth).map((species) => SPECIES_LABELS[species])];
}

function challengeIsLocked(): boolean {
  return appMode === 'apex' && challengeSettingsLocked(apexSession.getState());
}

function formatSteps(value: number): string {
  return `${value.toLocaleString()} step`;
}

function renderChallengePanel(): void {
  challengePanel.hidden = appMode !== 'apex';
  renderLeaderboardPanel();
  if (appMode !== 'apex') return;
  const state = apexSession.getState();
  const metric = simulation.getHistory().at(-1)!;
  const statuses = state.levelStatus.length > 0 ? state.levelStatus : evaluateApexLevels(metric);
  const phaseLabel = state.phase === 'setup' ? '생태계 설계' : state.phase === 'over' ? 'CHALLENGE OVER' : running ? 'CHALLENGE RUNNING' : '일시정지';
  const statusMarkup = statuses.map((status) => `<li class="${status.present ? 'is-present' : 'is-collapsed'}"><span>${status.label}</span><b>${status.present ? '● 생존' : '○ 붕괴'}</b><small>${status.value.toLocaleString()} ${status.unit}</small></li>`).join('');
  const bestMarkup = personalBest ? formatSteps(personalBest.score) : '아직 기록 없음';
  const collapseLabels = state.collapsedLevels.map((level) => statuses.find((status) => status.level === level)?.label ?? level).join(', ');
  const setupActions = '<button type="button" class="challenge-primary" data-challenge-action="start">도전 시작 · Start Challenge</button>';
  const activeActions = '<button type="button" class="challenge-secondary" data-challenge-action="abort">도전 중단</button>';
  const overActions = '<button type="button" class="challenge-primary" data-challenge-action="retry">같은 설정으로 다시 도전</button><button type="button" class="challenge-secondary" data-challenge-action="edit">설정 수정하기</button>';
  challengePanel.dataset.phase = state.phase;
  challengePanel.innerHTML = `
    <div class="challenge-copy">
      <p class="section-kicker">APEX SURVIVAL · ${phaseLabel}</p>
      <h2>전체 먹이사슬을 가장 오래 유지하세요</h2>
      <p>식생부터 4차 소비자까지 모든 영양 단계를 유지하는 조건을 탐색합니다. 도전을 시작하면 설정이 잠기며, 어느 한 단계라도 사라지는 순간 기록이 결정됩니다.</p>
      <small>Challenge Seed <b>${APEX_CHALLENGE_CONFIG.seed}</b> · ${APEX_CHALLENGE_CONFIG.simulationVersion} · 같은 조건과 seed에서는 같은 결과가 재현됩니다.</small>
      ${challengeIsLocked() ? '<span class="challenge-lock">🔒 도전 진행 중에는 설정을 변경할 수 없습니다.</span>' : ''}
      ${challengeMessage ? `<span class="challenge-message">${challengeMessage}</span>` : ''}
    </div>
    <div class="challenge-score">
      ${isNewPersonalBest ? '<span class="new-best">NEW PERSONAL BEST</span>' : '<span>SCORE</span>'}
      <strong>${formatSteps(state.score)}</strong>
      <small>Personal Best <b>${bestMarkup}</b></small>
      ${state.phase === 'over' ? `<em>최초 붕괴 영양 단계 <b>${collapseLabels}</b> · t = ${state.collapseStep}</em>` : ''}
    </div>
    <ul class="challenge-levels">${statusMarkup}</ul>
    <div class="challenge-actions">${state.phase === 'setup' ? setupActions : state.phase === 'active' ? activeActions : overActions}</div>`;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => HTML_ESCAPES[character]!);
}

function formatSubmittedAt(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function readStoredParticipant(): Participant | null {
  try {
    const serialized = window.localStorage.getItem(participantStorageKey());
    if (!serialized) return null;
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<Participant>;
    if (typeof candidate.studentNumber !== 'string' || typeof candidate.studentName !== 'string') return null;
    return { studentNumber: candidate.studentNumber, studentName: candidate.studentName };
  } catch {
    return null;
  }
}

function rememberParticipant(participant: Participant): void {
  try {
    window.localStorage.setItem(participantStorageKey(), JSON.stringify(participant));
  } catch {
    // 저장이 막힌 브라우저에서도 제출 자체는 계속 동작합니다.
  }
}

function leaderboardStatusText(entryCount: number): string {
  if (leaderboardStatusPhase === 'disabled') return '이 배포에는 중앙 기록판 서버가 연결되어 있지 않습니다. Personal Best는 이 브라우저에 계속 저장됩니다.';
  if (leaderboardStatusPhase === 'loading') return '기록판을 불러오는 중입니다…';
  if (leaderboardStatusPhase === 'error') return leaderboardMessage || '기록판을 불러오지 못했습니다.';
  if (leaderboardStatusPhase === 'idle') return '기록판을 준비하고 있습니다…';
  if (entryCount === 0) return '아직 제출된 기록이 없습니다. 첫 기록을 남겨 보세요.';
  return `학생마다 최고 기록 1개씩, 상위 ${entryCount}명을 보여 줍니다.`;
}

function verificationMarkup(entry: LeaderboardEntry): string {
  // 공개 view가 검증 상태를 내보내지 않는 동안에는 배지를 그리지 않습니다.
  if (!entry.verification) return '';
  if (entry.verification === 'verified') return '<i class="is-verified" title="서버 재실행으로 확인된 기록">✔ 검증됨</i>';
  if (entry.verification === 'rejected') return '<i class="is-rejected" title="서버 재실행 결과가 제출 점수와 다릅니다">✖ 재현 불일치</i>';
  return '<i class="is-unverified" title="아직 서버에서 재실행하지 않은 기록">· 미검증</i>';
}

function renderLeaderboardPanel(): void {
  leaderboardPanel.hidden = appMode !== 'apex';
  if (appMode !== 'apex') return;

  const ranked = rankEntries(leaderboardEntries);
  const signature = JSON.stringify([leaderboardStatusPhase, leaderboardMessage, highlightedParticipant, ranked.map((entry) => [entry.id, entry.rank, entry.score, entry.verification])]);
  if (signature !== leaderboardSignature) {
    leaderboardSignature = signature;
    leaderboardList.innerHTML = ranked.map((entry) => `
      <li class="${participantKey(entry) === highlightedParticipant ? 'is-mine' : ''}">
        <b>${entry.rank}</b>
        <span class="leaderboard-who"><strong>${escapeHtml(entry.studentName)}</strong></span>
        <span class="leaderboard-score">${entry.score.toLocaleString()} step</span>
        <span class="leaderboard-meta"><small>${escapeHtml(entry.studentNumber)}</small><time datetime="${escapeHtml(entry.submittedAt)}">${escapeHtml(formatSubmittedAt(entry.submittedAt))}</time>${verificationMarkup(entry)}</span>
      </li>`).join('');
    leaderboardStatus.textContent = leaderboardStatusText(ranked.length);
    leaderboardStatus.dataset.tone = leaderboardStatusPhase === 'error' ? 'error' : 'normal';
  }

  const phase = apexSession.getState().phase;
  const canSubmit = Boolean(leaderboardTransport) && phase === 'over' && lastFinishedRecord !== null && !hasSubmittedFinishedRecord;
  leaderboardForm.hidden = !canSubmit;
  leaderboardSubmitButton.disabled = leaderboardSubmitting;
  leaderboardSubmitButton.textContent = leaderboardSubmitting ? '제출 중…' : '이 기록 제출하기';
  leaderboardRefreshButton.disabled = !leaderboardTransport || leaderboardStatusPhase === 'loading';
}

async function refreshLeaderboard(): Promise<void> {
  if (!leaderboardTransport) return;
  const requestId = leaderboardRequestId + 1;
  leaderboardRequestId = requestId;
  leaderboardStatusPhase = 'loading';
  leaderboardMessage = '';
  renderLeaderboardPanel();
  try {
    const entries = await leaderboardTransport.list();
    if (requestId !== leaderboardRequestId) return;
    leaderboardEntries = entries;
    leaderboardStatusPhase = 'ready';
  } catch (error) {
    if (requestId !== leaderboardRequestId) return;
    leaderboardStatusPhase = 'error';
    leaderboardMessage = error instanceof Error ? error.message : '기록판을 불러오지 못했습니다.';
  }
  renderLeaderboardPanel();
}

async function submitFinishedRecord(): Promise<void> {
  const record = lastFinishedRecord;
  if (!leaderboardTransport || !record || leaderboardSubmitting || hasSubmittedFinishedRecord) return;
  const validation = validateParticipant({ studentNumber: leaderboardNumberInput.value, studentName: leaderboardNameInput.value });
  if (!validation.ok) {
    leaderboardStatusPhase = 'error';
    leaderboardMessage = validation.message;
    renderLeaderboardPanel();
    return;
  }
  leaderboardSubmitting = true;
  renderLeaderboardPanel();
  try {
    const submission = await createSubmission(record, validation.participant);
    await leaderboardTransport.submit(submission);
    hasSubmittedFinishedRecord = true;
    highlightedParticipant = participantKey(validation.participant);
    rememberParticipant(validation.participant);
    leaderboardSubmitting = false;
    await refreshLeaderboard();
    if (leaderboardStatusPhase === 'ready') leaderboardMessage = '';
  } catch (error) {
    leaderboardStatusPhase = 'error';
    leaderboardMessage = error instanceof Error ? error.message : '기록을 제출하지 못했습니다.';
  } finally {
    leaderboardSubmitting = false;
    renderLeaderboardPanel();
  }
}

function clearFinishedRecord(): void {
  lastFinishedRecord = null;
  hasSubmittedFinishedRecord = false;
}

function updateControlAvailability(): void {
  const state = apexSession.getState();
  const locked = challengeIsLocked();
  for (const definition of parameterDefinitions) element<HTMLInputElement>(`#param-${definition.key}`).disabled = locked;
  transferControl.disabled = locked;
  toroidalToggle.disabled = locked;
  depthSelect.disabled = appMode === 'apex' || locked;
  seedInput.disabled = appMode === 'apex' || locked;
  element<HTMLButtonElement>('#random-seed').disabled = appMode === 'apex' || locked;
  element<HTMLButtonElement>('#restore-defaults').disabled = locked;
  element('#parameter-lock-note').hidden = !locked;
  element('#seed-label').textContent = appMode === 'apex' ? 'Challenge Seed' : 'Random seed';
  element('#seed-helper').textContent = appMode === 'apex' ? '공정한 비교를 위해 이 도전에서는 고정됩니다.' : '같은 seed와 설정은 같은 결과를 재현합니다.';
  element('#removal-restriction').hidden = appMode !== 'apex';

  if (appMode === 'free') {
    runButton.disabled = running;
    pauseButton.disabled = !running;
    stepButton.disabled = false;
  } else if (state.phase === 'active') {
    runButton.disabled = running;
    pauseButton.disabled = !running;
    stepButton.disabled = running;
  } else {
    runButton.disabled = true;
    pauseButton.disabled = true;
    stepButton.disabled = true;
  }
}

function updateStructuralUi(): void {
  const active = activeSpecies(parameters.foodChainDepth);
  shell.classList.toggle('apex-mode', appMode === 'apex');
  document.querySelectorAll<HTMLButtonElement>('[data-app-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.appMode === appMode)));
  element('#mode-summary').textContent = appMode === 'apex'
    ? '이 모형에서 식생부터 4차 소비자까지 먹이사슬을 오래 유지하는 조건을 탐색합니다.'
    : '파라미터와 먹이사슬 단계를 자유롭게 바꾸며 탐구합니다.';
  document.querySelector<HTMLElement>('[data-species-group="tertiary"]')!.hidden = parameters.foodChainDepth < 3;
  document.querySelector<HTMLElement>('[data-species-group="quaternary"]')!.hidden = parameters.foodChainDepth < 4;
  const chain = chainLabels();
  element('#header-chain').innerHTML = chain.map((label, index) => `${index ? '<i>→</i>' : ''}<span>${label}</span>`).join('');
  element('#current-chain').textContent = chain.join(' → ');
  element('#board-legend').innerHTML = `<span><i class="forest-key"></i>식생</span>${active.map((species) => `<span><canvas data-mini-icon="${species}" width="28" height="28"></canvas>${SPECIES_LABELS[species]}</span>`).join('')}`;
  element('#graph-legend').innerHTML = (['forest', ...active] as ChartSeries[]).map((series) => {
    const label = series === 'forest' ? '식생 %' : SPECIES_LABELS[series];
    return `<button type="button" data-series="${series}" aria-pressed="${visibleSeries.has(series)}"><i style="--series:${SERIES_COLORS[series]}"></i>${label}</button>`;
  }).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-series]').forEach((button) => button.addEventListener('click', () => {
    const series = button.dataset.series as ChartSeries;
    if (visibleSeries.has(series)) visibleSeries.delete(series); else visibleSeries.add(series);
    button.setAttribute('aria-pressed', String(visibleSeries.has(series)));
    render();
  }));
  initializeIconCanvases();
  updateControlAvailability();
}

function trendText(current: number, previous: number): string {
  const difference = current - previous;
  if (Math.abs(difference) < 0.5) return '안정';
  return `${difference > 0 ? '↑' : '↓'} ${Math.abs(difference).toFixed(0)}`;
}

function renderPopulationStrip(snapshot: SimulationSnapshot): void {
  const history = simulation.getHistory();
  const comparison = history[Math.max(0, history.length - 6)] ?? history[0];
  element('#population-strip').innerHTML = activeSpecies(parameters.foodChainDepth).map((species) => {
    const current = snapshot.agents[species].length;
    const old = species === 'rabbit' ? comparison?.rabbits : species === 'wolf' ? comparison?.wolves : species === 'tertiary' ? comparison?.tertiary : comparison?.quaternary;
    const removed = snapshot.removedSpecies.includes(species);
    return `<article class="mini-population ${speciesClass[species]} ${removed ? 'is-removed' : ''}"><canvas data-mini-icon="${species}" width="38" height="38"></canvas><span><small>${SPECIES_LABELS[species]}</small><b>${current}</b><em>${removed ? '제거됨' : trendText(current, old ?? current)}</em></span></article>`;
  }).join('');
  initializeIconCanvases();
}

function pyramidWidth(value: number, maximum: number): number {
  if (value <= 0) return 12;
  return Math.max(18, Math.sqrt(value / Math.max(1, maximum)) * 100);
}

function renderPyramid(snapshot: SimulationSnapshot): void {
  const metric = simulation.getHistory().at(-1);
  const pyramid = element('#pyramid');
  if (pyramidMode === 'numbers') {
    const levels = [
      { id: 'vegetation', label: '식생', value: metric?.forestAbundance ?? 0, unit: '성장 단계 합', color: '#2f7b4c' },
      ...activeSpecies(parameters.foodChainDepth).map((species) => ({ id: species, label: SPECIES_LABELS[species], value: snapshot.agents[species].length, unit: '개체', color: SERIES_COLORS[species] })),
    ].reverse();
    const maximum = Math.max(...levels.map((level) => level.value), 1);
    pyramid.innerHTML = levels.map((level) => `<div class="pyramid-level" title="${level.label}: ${level.value.toLocaleString()} ${level.unit}"><div style="width:${pyramidWidth(level.value, maximum)}%;--level:${level.color}"><span>${level.label}</span><b>${level.value.toLocaleString()}</b><small>${level.unit}</small></div></div>`).join('');
    element('#pyramid-note').textContent = '개체수 피라미드입니다. 식생은 개체가 아니라 격자의 성장 단계 합입니다. 폭은 작은 값을 보이기 위한 제곱근 척도입니다.';
  } else {
    const flows = [...simulation.getEnergyFlow(20)].reverse();
    const maximum = Math.max(...flows.map((flow) => flow.rate), 1);
    pyramid.innerHTML = flows.map((flow) => {
      const source = flow.source === 'vegetation' ? '식생' : SPECIES_LABELS[flow.source];
      const label = `${source} → ${SPECIES_LABELS[flow.target]}`;
      return `<div class="pyramid-level energy-level" title="최근 ${flow.window} step · ${label}: ${flow.rate.toFixed(1)} 모델 에너지/step"><div style="width:${pyramidWidth(flow.rate, maximum)}%;--level:${SERIES_COLORS[flow.target]}"><span>${label}</span><b>${flow.rate.toFixed(1)}</b><small>모델 에너지/step</small></div></div>`;
    }).join('');
    element('#pyramid-note').textContent = '최근 20 step의 실제 섭식 사건에서 전달된 모델 에너지 합을 경과 step으로 나눈 값입니다. 폭은 제곱근 척도입니다.';
  }
  element('#chain-summary').textContent = `활성 영양 단계 ${parameters.foodChainDepth + 1} · 전달 효율 ${Math.round(parameters.transferEfficiency * 100)}%`;
}

function renderRemoval(snapshot: SimulationSnapshot): void {
  element('#removal-list').innerHTML = activeSpecies(parameters.foodChainDepth).map((species) => {
    const removed = snapshot.removedSpecies.includes(species);
    const removalDisabled = appMode === 'apex' || removed;
    const detail = removed ? '제거됨 · Reset 필요' : appMode === 'apex' ? 'Apex Survival에서 사용 불가' : `현재 ${snapshot.agents[species].length}개체`;
    return `<div class="removal-row ${removed ? 'is-removed' : ''}"><canvas data-mini-icon="${species}" width="34" height="34"></canvas><span><b>${SPECIES_LABELS[species]}</b><small>${detail}</small></span><button type="button" data-remove="${species}" ${removalDisabled ? 'disabled' : ''}>${removed ? '제거됨' : '종 제거'}</button></div>`;
  }).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((button) => button.addEventListener('click', () => openRemovalDialog(button.dataset.remove as Species)));
  initializeIconCanvases();
}

function renderStats(snapshot: SimulationSnapshot): void {
  const stats = snapshot.stats;
  const totalBirths = activeSpecies(parameters.foodChainDepth).reduce((sum, species) => sum + stats.births[species], 0);
  const totalDeaths = activeSpecies(parameters.foodChainDepth).reduce((sum, species) => sum + stats.deaths[species], 0);
  const totalHunts = activeSpecies(parameters.foodChainDepth).slice(1).reduce((sum, species) => sum + stats.feedingEvents[species], 0);
  element('#stat-grid').innerHTML = `
    <div><span>전체 출생</span><strong>${totalBirths}</strong></div>
    <div><span>전체 자연사·피식</span><strong>${totalDeaths}</strong></div>
    <div><span>동물 사냥 성공</span><strong>${totalHunts}</strong></div>
    <div><span>토끼가 먹은 식생</span><strong>${stats.forestEaten} 단계</strong></div>
    <div><span>기록된 종 제거</span><strong>${snapshot.interventions.length}</strong></div>`;
}

function renderInterventions(snapshot: SimulationSnapshot): void {
  const interventionMarkup = snapshot.interventions.map((item) => `<span style="--marker:${SERIES_COLORS[item.species]}" title="t = ${item.step}: ${SPECIES_LABELS[item.species]} 제거">t = ${item.step} · ${SPECIES_LABELS[item.species]} 제거</span>`).join('');
  const state = apexSession.getState();
  const collapseMarkup = appMode === 'apex' && state.collapseStep !== null
    ? `<span class="collapse-log" title="t = ${state.collapseStep}: Apex 먹이사슬 붕괴">Apex chain collapsed · t = ${state.collapseStep}</span>`
    : '';
  const completeMarkup = interventionMarkup + collapseMarkup;
  element('#intervention-log').innerHTML = completeMarkup || '<span>종 제거 기록 없음</span>';
}

function render(): void {
  const snapshot = simulation.getSnapshot();
  drawBoard(snapshot);
  drawPopulationChart(chart, {
    history: simulation.getHistory(),
    depth: parameters.foodChainDepth,
    visibleSeries,
    interventions: simulation.getInterventions(),
    challengeCollapse: appMode === 'apex' && apexSession.getState().collapseStep !== null
      ? { step: apexSession.getState().collapseStep!, label: `Apex chain collapsed · t=${apexSession.getState().collapseStep}` }
      : null,
  });
  element('#step-value').textContent = String(snapshot.step).padStart(3, '0');
  renderPopulationStrip(snapshot);
  renderPyramid(snapshot);
  renderRemoval(snapshot);
  renderStats(snapshot);
  renderInterventions(snapshot);
  renderChallengePanel();
  updateControlAvailability();
}

function setRunning(nextRunning: boolean): void {
  if (appMode === 'apex' && apexSession.getState().phase !== 'active') nextRunning = false;
  running = nextRunning;
  const status = element<HTMLDivElement>('#board-status');
  status.classList.toggle('is-running', running);
  status.querySelector('b')!.textContent = running
    ? '실행 중'
    : appMode === 'apex' && apexSession.getState().phase === 'over'
      ? '도전 종료'
      : simulation.getSnapshot().step === 0 ? '준비됨' : '일시정지';
  lastAnimationTime = performance.now();
  accumulatedTime = 0;
  updateControlAvailability();
  renderChallengePanel();
}

function resetSimulation(): void {
  window.clearTimeout(resetTimer);
  setRunning(false);
  parameters = appMode === 'apex' ? apexParameters(parameters) : validateParameters(parameters);
  if (appMode === 'apex') apexDesignParameters = { ...parameters }; else freeParameters = { ...parameters };
  simulation = new ForestSimulation(parameters);
  inspector.hidden = true;
  updateStructuralUi();
  render();
}

function scheduleReset(): void {
  setRunning(false);
  if (appMode === 'apex' && apexSession.getState().phase === 'setup') {
    apexSession.returnToSetup();
    challengeMessage = '';
  }
  window.clearTimeout(resetTimer);
  resetTimer = window.setTimeout(resetSimulation, 120);
}

function updateAllControls(): void {
  for (const definition of parameterDefinitions) {
    const input = element<HTMLInputElement>(`#param-${definition.key}`);
    const value = parameters[definition.key];
    input.value = String(value);
    element<HTMLOutputElement>(`#output-${definition.key}`).value = formatParameter(definition, value);
  }
  seedInput.value = parameters.seed;
  toroidalToggle.checked = parameters.toroidal;
  depthSelect.value = String(parameters.foodChainDepth);
  transferControl.value = String(parameters.transferEfficiency);
  element<HTMLOutputElement>('#transfer-output').value = `${Math.round(parameters.transferEfficiency * 100)}%`;
  updateStructuralUi();
}

function finishApexChallenge(): void {
  const record = createApexRecord(apexSession.getState());
  lastFinishedRecord = record;
  hasSubmittedFinishedRecord = false;
  highlightedParticipant = null;
  try {
    const result = saveApexPersonalBest(window.localStorage, record);
    personalBest = result.best;
    isNewPersonalBest = result.isNewBest;
  } catch {
    challengeMessage = '이 브라우저에서는 Personal Best를 저장할 수 없습니다.';
    isNewPersonalBest = false;
  }
}

function advanceLogicalStep(): boolean {
  const metric = simulation.step();
  if (appMode !== 'apex' || apexSession.getState().phase !== 'active') return false;
  const collapsed = apexSession.acceptStep(metric);
  if (collapsed) {
    finishApexChallenge();
    setRunning(false);
  }
  return collapsed;
}

function beginApexChallenge(parameterSource: SimulationParameters = parameters): void {
  window.clearTimeout(resetTimer);
  running = false;
  parameters = apexParameters(parameterSource);
  apexDesignParameters = { ...parameters };
  simulation = new ForestSimulation(parameters);
  inspector.hidden = true;
  isNewPersonalBest = false;
  challengeMessage = '';
  clearFinishedRecord();
  const initialMetric = simulation.getHistory().at(-1)!;
  const started = apexSession.start(parameters, initialMetric);
  if (!started) {
    const missing = apexSession.getState().levelStatus.filter((level) => !level.present).map((level) => level.label).join(', ');
    challengeMessage = `도전을 시작하려면 모든 영양 단계가 존재해야 합니다. 확인: ${missing}`;
  }
  setRunning(started);
  updateAllControls();
  render();
}

function returnToApexSetup(parameterSource: SimulationParameters = parameters): void {
  window.clearTimeout(resetTimer);
  setRunning(false);
  apexSession.returnToSetup();
  parameters = apexParameters(parameterSource);
  apexDesignParameters = { ...parameters };
  simulation = new ForestSimulation(parameters);
  inspector.hidden = true;
  isNewPersonalBest = false;
  challengeMessage = '';
  clearFinishedRecord();
  updateAllControls();
  render();
}

function switchMode(nextMode: AppMode): void {
  if (nextMode === appMode) return;
  if (appMode === 'apex' && apexSession.getState().phase === 'active') {
    const confirmed = window.confirm('현재 도전을 포기하고 자유 탐구로 돌아가시겠습니까? 이 기록은 Personal Best에 저장되지 않습니다.');
    if (!confirmed) return;
  }
  window.clearTimeout(resetTimer);
  setRunning(false);
  if (appMode === 'free') freeParameters = { ...parameters };
  else apexDesignParameters = apexParameters(parameters);
  appMode = nextMode;
  apexSession.returnToSetup();
  isNewPersonalBest = false;
  challengeMessage = '';
  clearFinishedRecord();
  if (nextMode === 'apex' && leaderboardStatusPhase === 'idle') void refreshLeaderboard();
  if (nextMode === 'apex') {
    if (!hasApexDesign) {
      apexDesignParameters = apexParameters(parameters);
      hasApexDesign = true;
    }
    parameters = apexParameters(apexDesignParameters);
    toggleParameters(true);
  } else {
    parameters = validateParameters(freeParameters);
  }
  simulation = new ForestSimulation(parameters);
  updateAllControls();
  render();
}

function openRemovalDialog(species: Species): void {
  if (appMode === 'apex') return;
  pendingRemoval = species;
  element('#dialog-title').textContent = `${SPECIES_LABELS[species]}를 생태계에서 제거하시겠습니까?`;
  element('#dialog-copy').textContent = '현재 모든 개체가 즉시 사라지고 이 실험을 Reset하기 전까지 번식하거나 다시 생성되지 않습니다. 이후 먹이사슬 전체의 변화를 관찰할 수 있습니다.';
  element<HTMLButtonElement>('#confirm-removal').textContent = `${SPECIES_LABELS[species]} 제거`;
  removalDialog.showModal();
}

for (const definition of parameterDefinitions) {
  const input = element<HTMLInputElement>(`#param-${definition.key}`);
  input.addEventListener('input', () => {
    if (challengeIsLocked()) return;
    const value = Number(input.value);
    parameters = { ...parameters, [definition.key]: value };
    if (appMode === 'apex') apexDesignParameters = apexParameters(parameters); else freeParameters = { ...parameters };
    element<HTMLOutputElement>(`#output-${definition.key}`).value = formatParameter(definition, value);
    scheduleReset();
  });
}

depthSelect.addEventListener('change', () => {
  if (appMode === 'apex') return;
  parameters = { ...parameters, foodChainDepth: Number(depthSelect.value) as FoodChainDepth };
  freeParameters = { ...parameters };
  resetSimulation();
});

transferControl.addEventListener('input', () => {
  if (challengeIsLocked()) return;
  parameters = { ...parameters, transferEfficiency: Number(transferControl.value) };
  if (appMode === 'apex') apexDesignParameters = apexParameters(parameters); else freeParameters = { ...parameters };
  element<HTMLOutputElement>('#transfer-output').value = `${Math.round(parameters.transferEfficiency * 100)}%`;
  scheduleReset();
});

seedInput.addEventListener('change', () => {
  if (appMode === 'apex') return;
  parameters = { ...parameters, seed: seedInput.value };
  freeParameters = { ...parameters };
  resetSimulation();
});
toroidalToggle.addEventListener('change', () => {
  if (challengeIsLocked()) return;
  parameters = { ...parameters, toroidal: toroidalToggle.checked };
  if (appMode === 'apex') apexDesignParameters = apexParameters(parameters); else freeParameters = { ...parameters };
  resetSimulation();
});

element<HTMLButtonElement>('#random-seed').addEventListener('click', () => {
  parameters = { ...parameters, seed: createFreeExplorationSeed() };
  freeParameters = { ...parameters };
  updateAllControls(); resetSimulation();
});

element<HTMLButtonElement>('#restore-defaults').addEventListener('click', () => {
  if (challengeIsLocked()) return;
  parameters = appMode === 'apex' ? apexParameters({ ...DEFAULT_PARAMETERS }) : { ...initialFreeParameters };
  if (appMode === 'apex') apexDesignParameters = { ...parameters }; else freeParameters = { ...parameters };
  updateAllControls(); resetSimulation();
});

document.querySelectorAll<HTMLButtonElement>('[data-pyramid-mode]').forEach((button) => button.addEventListener('click', () => {
  pyramidMode = button.dataset.pyramidMode as PyramidMode;
  document.querySelectorAll<HTMLButtonElement>('[data-pyramid-mode]').forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
  renderPyramid(simulation.getSnapshot());
}));

removalDialog.addEventListener('close', () => {
  if (appMode === 'free' && removalDialog.returnValue === 'confirm' && pendingRemoval) {
    setRunning(false);
    simulation.removeSpecies(pendingRemoval);
    render();
  }
  pendingRemoval = null;
});

document.querySelectorAll<HTMLButtonElement>('[data-app-mode]').forEach((button) => button.addEventListener('click', () => switchMode(button.dataset.appMode as AppMode)));

challengePanel.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-challenge-action]');
  if (!button) return;
  const action = button.dataset.challengeAction;
  if (action === 'start') beginApexChallenge();
  if (action === 'retry') {
    const snapshot = apexSession.getState().parameterSnapshot;
    if (snapshot) beginApexChallenge({ ...snapshot });
  }
  if (action === 'edit') {
    const snapshot = apexSession.getState().parameterSnapshot;
    returnToApexSetup(snapshot ? { ...snapshot } : parameters);
  }
  if (action === 'abort') {
    const confirmed = window.confirm('현재 도전을 중단하시겠습니까? 이 기록은 Personal Best에 저장되지 않습니다.');
    if (confirmed) returnToApexSetup(parameters);
  }
});

leaderboardRefreshButton.addEventListener('click', () => { void refreshLeaderboard(); });
leaderboardForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitFinishedRecord();
});

runButton.addEventListener('click', () => {
  if (appMode === 'free' || apexSession.getState().phase === 'active') setRunning(true);
});
pauseButton.addEventListener('click', () => setRunning(false));
stepButton.addEventListener('click', () => { setRunning(false); advanceLogicalStep(); render(); });
resetButton.addEventListener('click', () => {
  if (appMode === 'free') {
    resetSimulation();
    return;
  }
  if (apexSession.getState().phase === 'active') {
    const confirmed = window.confirm('현재 도전을 포기하고 초기화하시겠습니까? 이 기록은 Personal Best에 저장되지 않습니다.');
    if (!confirmed) return;
  }
  const snapshot = apexSession.getState().parameterSnapshot;
  returnToApexSetup(snapshot ? { ...snapshot } : parameters);
});
speedControl.addEventListener('input', () => { speedOutput.value = `${speedControl.value} step/s`; });

function toggleParameters(force?: boolean): void {
  const nextVisible = force ?? shell.classList.contains('parameters-hidden');
  shell.classList.toggle('parameters-hidden', !nextVisible);
  parameterToggle.setAttribute('aria-pressed', String(nextVisible));
  window.setTimeout(render, 220);
}

parameterToggle.addEventListener('click', () => toggleParameters());
document.querySelectorAll<HTMLButtonElement>('.close-parameters').forEach((button) => button.addEventListener('click', () => toggleParameters(false)));
graphToggle.addEventListener('click', () => {
  const hidden = shell.classList.toggle('graph-hidden');
  graphToggle.setAttribute('aria-pressed', String(!hidden));
  window.setTimeout(render, 220);
});

board.addEventListener('pointerdown', (event) => {
  const snapshot = simulation.getSnapshot();
  const bounds = board.getBoundingClientRect();
  const x = Math.max(0, Math.min(snapshot.width - 1, Math.floor(((event.clientX - bounds.left) / bounds.width) * snapshot.width)));
  const y = Math.max(0, Math.min(snapshot.height - 1, Math.floor(((event.clientY - bounds.top) / bounds.height) * snapshot.height)));
  const agent = allActiveAgents(snapshot).find((candidate) => candidate.x === x && candidate.y === y);
  const stage = snapshot.forest[y * snapshot.width + x];
  const animalText = agent ? `${SPECIES_LABELS[agent.species]} · 에너지 ${agent.energy.toFixed(1)} · 나이 ${agent.age}` : '동물 없음';
  inspector.innerHTML = `<b>(${x + 1}, ${y + 1}) 칸</b><span>식생 ${stage} / ${snapshot.maxForestStage}단계</span><span>${animalText}</span>`;
  inspector.hidden = false;
  inspector.style.left = `${Math.min(76, Math.max(3, ((event.clientX - bounds.left) / bounds.width) * 100))}%`;
  inspector.style.top = `${Math.min(82, Math.max(4, ((event.clientY - bounds.top) / bounds.height) * 100))}%`;
});

board.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  const snapshot = simulation.getSnapshot();
  const x = Math.floor(snapshot.width / 2); const y = Math.floor(snapshot.height / 2);
  inspector.innerHTML = `<b>가운데 칸</b><span>식생 ${snapshot.forest[y * snapshot.width + x]} / ${snapshot.maxForestStage}단계</span><span>포인터로 다른 칸도 살펴보세요.</span>`;
  inspector.style.left = '50%'; inspector.style.top = '50%'; inspector.hidden = false;
});

const resizeObserver = new ResizeObserver(() => render());
resizeObserver.observe(board.parentElement!);
resizeObserver.observe(chart.parentElement!);

function animationLoop(time: number): void {
  const elapsed = Math.min(250, time - lastAnimationTime);
  lastAnimationTime = time;
  if (running) {
    accumulatedTime += elapsed;
    const interval = 1000 / Number(speedControl.value);
    let steps = 0;
    while (accumulatedTime >= interval && steps < 8) {
      accumulatedTime -= interval;
      steps += 1;
      if (advanceLogicalStep()) break;
    }
    if (steps > 0) render();
  }
  requestAnimationFrame(animationLoop);
}

const storedParticipant = readStoredParticipant();
if (storedParticipant) {
  leaderboardNumberInput.value = storedParticipant.studentNumber;
  leaderboardNameInput.value = storedParticipant.studentName;
}

updateAllControls();
render();
requestAnimationFrame(animationLoop);
