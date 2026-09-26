import './simulation.css';
import { foodWebMarkup } from './foodWebView.ts';
import { simulationControlsMarkup, placeSimulationControls } from './simulationControls.ts';
import { ExperimentLog } from './experimentLog.ts';
import { createModeEffects } from './modeEffects.ts';
import { DialogController } from './dialog.ts';
import { InterventionSession, groupInterventions, interventionLabel, removalPresetAmount } from './interventions.ts';
import { ParameterDraft } from './parameterDraft.ts';
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
  loadParticipant,
  validateParticipant,
  BOARD_GROUPS,
  type BoardGroup,
  type LeaderboardTransport,
  type Participant,
} from './leaderboard.ts';
import { boardMarkup, leaderboardSummaryMarkup, createLeaderboardDialog } from './leaderboardView.ts';
import { LeaderboardStore, leaderboardStateText } from './leaderboardState.ts';
import {
  DEFAULT_PARAMETERS,
  ForestSimulation,
  SPECIES_LABELS,
  RUNTIME_SPECIES,
  speciesConfigs,
  validateParameters,
  type Agent,
  type FoodChainDepth,
  type SimulationParameters,
  type SimulationSnapshot,
  type Species,
  type Intervention,
} from './model.ts';
import { createFreeExplorationSeed, createInitialFreeParameters } from './seed.ts';
import { captureRemovalFeedback, personalBestFeedback, populationChange, populationComparison, populationFeedbackDeadline, removalEmphasis, REMOVAL_FEEDBACK_MS, REMOVAL_MARKER_MS, PERSONAL_BEST_FEEDBACK_MS, type PersonalBestFeedback, type RemovalFeedback } from './feedback.ts';

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
  { key: 'initialRabbits', label: '초기 토끼 수', description: '실험을 시작할 때 배치할 토끼 수', min: 0, max: 400, step: 2, group: 'rabbit', format: 'integer', suffix: '마리' },
  { key: 'initialWolves', label: '초기 늑대 수', description: '실험을 시작할 때 배치할 늑대 수', min: 0, max: 160, step: 2, group: 'wolf', format: 'integer', suffix: '마리' },
  { key: 'initialForestDensity', label: '초기 숲 밀도', description: '처음 격자에 자란 숲의 평균 정도', min: 0, max: 100, step: 2, group: 'forest', format: 'integer', suffix: '%' },
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
  start: { title: '공통 환경', subtitle: '공간 · 먹이사슬 · 시작 환경', icon: '⚙' },
  forest: { title: '생산자 · 식생', subtitle: '재생 · 성장과 최대 밀도', icon: '♣' },
  rabbit: { title: '1차 소비자 · 토끼', subtitle: '이동 · 먹이 · 번식 · 사망', icon: '♙' },
  wolf: { title: '2차 소비자 · 늑대', subtitle: '탐색 · 사냥 · 번식 · 사망', icon: '◆' },
  tertiary: { title: '3차 소비자', subtitle: '늑대를 먹는 상위 포식자', icon: '▲' },
  quaternary: { title: '4차 소비자', subtitle: '최상위 영양 단계', icon: '⬟' },
};

function formatParameter(definition: ParameterDefinition, value: number): string {
  if (definition.format === 'percent') return `${Math.round(value * 100)}%`;
  if (definition.format === 'decimal') return value.toFixed(value < 1 ? 2 : 1);
  return `${Math.round(value)}${definition.suffix ? ` ${definition.suffix}` : ''}`;
}

// Fixed trophic order, independent of population/density values and their different units.
const initialStages: { group: Exclude<ParameterGroup, 'start'>; key: NumericParameterKey }[] = [
  { group: 'quaternary', key: 'initialQuaternary' },
  { group: 'tertiary', key: 'initialTertiary' },
  { group: 'wolf', key: 'initialWolves' },
  { group: 'rabbit', key: 'initialRabbits' },
  { group: 'forest', key: 'initialForestDensity' },
];

function parameterGroupActive(group: ParameterGroup, depth: FoodChainDepth): boolean {
  return group !== 'quaternary' && group !== 'tertiary' || depth >= (group === 'quaternary' ? 4 : 3);
}

function parameterInputMarkup(definition: ParameterDefinition): string {
  return `<input id="param-${definition.key}" data-parameter="${definition.key}" type="range" min="${definition.min}" max="${definition.max}" step="${definition.step}" value="${DEFAULT_PARAMETERS[definition.key]}" aria-valuetext="${formatParameter(definition, DEFAULT_PARAMETERS[definition.key])}" />`;
}

function parameterMarkup(definitions: ParameterDefinition[]): string {
  return definitions.map((definition) => `
    <label class="parameter-control" for="param-${definition.key}">
      <span class="parameter-heading"><b>${definition.label}</b><output id="output-${definition.key}" for="param-${definition.key}">${formatParameter(definition, DEFAULT_PARAMETERS[definition.key])}</output></span>
      <span class="parameter-description">${definition.description}</span>
      ${parameterInputMarkup(definition)}
    </label>`).join('');
}

function initialEcosystemMarkup(): string {
  return initialStages.map(({ group, key }) => {
    const info = groupInfo[group];
    const definition = parameterDefinitions.find((item) => item.key === key)!;
    return `<article class="initial-stage" data-initial-stage="${group}">
      <button type="button" class="stage-select" data-parameter-section="${group}" aria-controls="parameter-panel-${group}" aria-pressed="${group === 'wolf'}" aria-label="${info.title} 상세 설정">
        <span class="group-icon ${group}" aria-hidden="true">${info.icon}</span><span class="stage-name">${info.title}<small id="stage-status-${group}" class="stage-status" hidden>비활성</small></span>
        <output id="output-${key}" for="param-${key}" aria-hidden="true">${formatParameter(definition, DEFAULT_PARAMETERS[key])}</output><span class="selection-mark" aria-hidden="true">◀</span>
      </button>
      <div class="initial-stage-control"><label class="visually-hidden" for="param-${key}">${info.title} · ${definition.label}</label>${parameterInputMarkup(definition)}</div>
    </article>`;
  }).join('');
}

function parameterGroupMarkup(group: ParameterGroup, content?: string): string {
  const info = groupInfo[group];
  const definitions = parameterDefinitions.filter((definition) => definition.group === group && !initialStages.some((stage) => stage.key === definition.key));
  const categories: [string, RegExp][] = group === 'forest'
    ? [['재생 · 성장', /forest/]]
    : [['이동 · 탐색', /Move/], [group === 'rabbit' ? '먹이 · 에너지' : '사냥 · 에너지', /FoodEnergy|EnergyCost/], ['번식', /Breed/], ['사망', /MaxAge/]];
  return `<section class="parameter-detail" id="parameter-panel-${group}" data-parameter-panel="${group}" aria-labelledby="parameter-title-${group}" ${group === 'wolf' ? '' : 'hidden'}>
    <header class="parameter-detail-heading"><span class="group-icon ${group}" aria-hidden="true">${info.icon}</span><div><h3 id="parameter-title-${group}">${info.title}</h3><p>${info.subtitle}</p></div></header>
    ${group === 'tertiary' || group === 'quaternary' ? `<p class="inactive-detail-note" id="inactive-note-${group}" hidden>현재 먹이사슬에서 비활성입니다. 공통 환경에서 먹이사슬 단계를 높이면 편집할 수 있습니다.</p>` : ''}
    ${content ?? categories.map(([title, pattern]) => `<section class="parameter-category"><h4>${title}</h4>${parameterMarkup(definitions.filter((definition) => pattern.test(definition.key)))}</section>`).join('')}
  </section>`;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('앱을 표시할 요소를 찾을 수 없습니다.');

// This module is evaluated once per page load, so the free-exploration seed is
// generated once and then kept as the initial seed for this page session.
const initialFreeParameters = createInitialFreeParameters();

app.innerHTML = `
  <div class="app-shell" id="app-shell">
    <header class="topbar">
      <div class="header-intro">
        <div class="brand-row"><div class="brand-mark" aria-hidden="true"><span></span></div><div class="brand-copy"><p class="eyebrow">통합과학 2 · 생태계 상호작용</p><div class="brand-title"><h1>Rabbits <span>&</span> Wolves</h1><p>Extended forest population lab</p></div></div></div>
        <nav class="portal-nav" aria-label="과학 수업 포털 안내"><a class="portal-link" href="https://suimaire.github.io/" aria-label="과학 수업 포털로 돌아가기">← 과학 수업 포털</a><span class="lesson-chip">탐구 02 · 영양 단계와 생태계 변화</span></nav>
      </div>

    </header>

    <div class="lab-layout">
      <main class="workspace">
        <section class="simulation-stage" aria-label="시뮬레이션과 조작">
          <div class="simulation-main">
            <section class="board-card" aria-labelledby="forest-heading">
              <header class="board-heading">
                <div><p class="section-kicker">LIVE ECOSYSTEM</p><h2 id="forest-heading">숲 생태계</h2></div>
                <div class="board-heading-actions">
                  <div class="mode-switch" role="group" aria-label="모드 선택"><span class="mode-capsule" aria-hidden="true"><span class="apex-tab-glow"></span></span><button type="button" data-app-mode="free" aria-pressed="true">자유 탐구</button><button type="button" data-app-mode="apex" aria-pressed="false"><span class="apex-tab-label"><span class="apex-tab-ignition" aria-hidden="true"><svg class="apex-tab-flame" viewBox="0 0 16 20" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M9 1c1 4-3 5-2 8-1.5-.5-2-2-1.5-3.5C2.5 8 1 10.5 1.5 13.5a6.5 6.5 0 0 0 13-1C14.5 8 11 6 9 1ZM8.5 10c.5 2-2 3-2 5a2 2 0 0 0 4 0c0-2-1-3-2-5Z"/></svg></span>Apex Survival</span></button></div>
                  <div class="legend" id="board-legend"></div>
                </div>
              </header>
              <section class="population-hud" aria-label="현재 실험 상태">
                <div class="hud-readings">
                  <div class="step-readout"><span>STEP</span><strong id="step-value">000</strong></div>
                  <article class="mini-population forest-population"><i class="forest-key" aria-hidden="true"></i><span><small>식생량</small><b id="forest-population"></b><em>성장 단계 합</em></span></article>
                  <div class="population-strip" id="population-strip"></div>
                </div>
                <p class="population-comparison" id="population-comparison"></p>
              </section>
              <div class="canvas-frame"><canvas id="forest-board" tabindex="0" aria-label="격자형 숲 생태계. 칸을 선택하면 상태를 확인할 수 있습니다."></canvas><div class="board-status" id="board-status"><span></span><b>준비됨</b></div><div class="cell-inspector" id="cell-inspector" hidden></div></div>
              <div class="board-footnote"><span>칸을 클릭하거나 터치해 식생 단계와 개체 에너지를 확인하세요.</span><span><b>공간 규칙</b> 식생과 동물은 함께 존재 · 동물은 한 칸에 한 마리</span></div>
            </section>
          </div>

          <div class="simulation-sidebar">
            <aside class="simulation-console" aria-label="Experiment Console" id="simulation-console">
              <div class="console-heading" id="experiment-heading"><p class="section-kicker">EXPERIMENT CONSOLE</p><h2>자유 탐구</h2></div>
              <section class="challenge-panel" id="challenge-panel" aria-live="polite" hidden></section>
              <button type="button" class="parameter-entry" id="toggle-parameters" aria-label="생태계 설계 · Parameters" aria-describedby="parameter-entry-hint" aria-haspopup="dialog" aria-controls="parameters-dialog" aria-expanded="false">
                <span class="parameter-entry-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h7m5 0h4M4 17h3m5 0h8"/><circle cx="13.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/></svg></span>
                <span class="parameter-entry-copy"><span class="parameter-entry-title"><b>생태계 설계</b><small>Parameters</small></span><span class="parameter-entry-hint" id="parameter-entry-hint">개체수와 환경 조건을 조정해 실험을 설계하세요.</span></span>
                <span class="parameter-entry-action" aria-hidden="true"><span id="parameter-entry-action">설계 열기</span><span>→</span></span>
              </button>
              <section class="intervention-card" id="intervention-card" aria-labelledby="intervention-heading">
                <h2 id="intervention-heading">생태계 개입</h2>
                <p>현재 생태계에 종을 도입하거나 제거합니다.</p>
                <div class="intervention-actions">
                  <button type="button" data-introduce="fox" aria-haspopup="dialog" aria-controls="intervention-dialog">＋ 붉은여우</button>
                  <button type="button" data-introduce="tertiary" aria-haspopup="dialog" aria-controls="intervention-dialog">＋ 3차 소비자</button>
                  <button type="button" data-introduce="quaternary" aria-haspopup="dialog" aria-controls="intervention-dialog">＋ 4차 소비자</button>
                </div>
                <div class="intervention-actions intervention-secondary">
                  <button type="button" id="open-introduction" aria-haspopup="dialog" aria-controls="intervention-dialog">＋ 종 도입</button>
                  <button type="button" id="open-removal" aria-haspopup="dialog" aria-controls="intervention-dialog">− 개체 제거</button>
                </div>
                <p id="recent-intervention" aria-live="polite">최근 개입 없음</p>
              </section>
      <section class="pyramid-card ecological-pyramid--dashboard" aria-label="실시간 생태 피라미드">
        <div class="pyramid-toolbar"><h2>실시간 생태 피라미드</h2><div class="segmented-control" role="group" aria-label="피라미드 표현 방식"><button type="button" data-pyramid-mode="numbers" aria-pressed="true">개체수</button><button type="button" data-pyramid-mode="energy" aria-pressed="false">에너지 흐름</button></div></div>
        <div class="pyramid" id="pyramid"></div>
      </section>
              ${simulationControlsMarkup()}

            </aside>
          </div>
        </section>

        <section class="support-grid" aria-label="도전 안내">              <div class="challenge-copy" id="challenge-description" hidden>
                <h2>전체 먹이사슬을 가장 오래 유지하세요</h2>
                <p>식생부터 4차 소비자까지 모든 영양 단계를 유지하는 조건을 탐색합니다. 도전을 시작하면 설정이 잠기며, 어느 한 단계라도 사라지는 순간 기록이 결정됩니다.</p>
                <small>Challenge Seed <b>${APEX_CHALLENGE_CONFIG.seed}</b> · ${APEX_CHALLENGE_CONFIG.simulationVersion} · 같은 조건과 seed에서는 같은 결과가 재현됩니다.</small>
              </div>
</section>
        <section class="analysis-grid" aria-label="관찰과 분석">
          <section class="graph-card" id="graph-card">
            <div class="card-heading"><div><p class="section-kicker">POPULATION GRAPH</p><h2>개체군 변화</h2></div><span class="live-pill"><i></i> LIVE</span></div>
            <div class="graph-legend" id="graph-legend" aria-label="그래프 계열 표시 전환"></div>
            <canvas id="population-chart" aria-label="시간에 따른 활성 영양 단계와 숲 밀도 그래프"></canvas>
            <div class="graph-foot"><p><span>왼쪽 축: 소비자 개체 수</span><span>오른쪽 축: 숲 평균 밀도</span></p><div id="intervention-log"></div></div>
          </section>
        </section>


        <section class="lower-grid">
          <section class="statistics-card"><div class="card-heading"><div><p class="section-kicker">CUMULATIVE RECORD</p><h2>누적 통계</h2></div><span>현재 실험</span></div><div class="stat-grid" id="stat-grid"></div></section>
          <section class="learning-card"><div class="card-heading"><div><p class="section-kicker">MODEL ASSUMPTIONS</p><h2>모형의 가정과 한계</h2></div><span class="model-badge">확률적 모형</span></div><ul><li>학습을 위해 먹이 관계를 <b>직선형 먹이사슬</b>로 단순화했습니다. 실제 생태계는 대부분 먹이그물입니다.</li><li>영양 단계가 높을수록 이용 가능한 에너지가 제한되는 경향이 있습니다.</li><li><b>10%</b>는 보편 법칙이 아닌 교육적 대표값이며 실제 효율은 생태계와 종에 따라 다릅니다.</li><li>에너지는 실제 Joule 측정치가 아닌 <b>모델 내부 값</b>입니다.</li></ul><p class="model-limit">종 제거 뒤의 변화와 Apex Survival 점수는 실제 생태계의 안정성을 직접 측정하지 않으며, 이 단순화된 모형과 사용자가 고른 파라미터에서 나타난 결과입니다.</p></section>
        </section>

        <details class="rule-card"><summary><span><b>이 모델은 한 step을 어떻게 계산할까요?</b><small>행동 순서와 에너지 규칙 보기</small></span><i>⌄</i></summary><div class="rule-content"><ol><li><b>식생 성장</b><span>확률에 따라 한 단계 회복</span></li><li><b>토끼 행동</b><span>이동·식생 섭취·번식·사망</span></li><li><b>늑대 행동</b><span>토끼 탐색·사냥·번식·사망</span></li><li><b>상위 소비자</b><span>활성 단계별 동일 규칙 적용</span></li><li><b>기록</b><span>개체수·섭식 에너지·개입 저장</span></li></ol><p>한 번의 섭식에서 먹이의 가용 모델 에너지에 전달 효율을 정확히 한 번 적용합니다. 10%에서 기존 토끼·늑대의 획득량이 유지되며, 효율을 바꾸면 모든 영양 단계의 섭식 획득량이 같은 규칙으로 변합니다.</p></div></details>
      </main>
    </div>

              <dialog id="parameters-dialog" class="dashboard-dialog parameters-dialog" aria-labelledby="parameters-title" aria-describedby="parameter-edit-note">
                <div class="dialog-heading panel-title-row"><div><p class="section-kicker">EXPERIMENT SETUP</p><h2 id="parameters-title">실험 조건</h2></div><button type="button" class="icon-button close-parameters" aria-label="실험 조건 닫기">×</button></div>
                <p id="parameter-edit-note" class="dialog-notice"></p>
                <p class="parameter-lock-note" id="parameter-lock-note" hidden>🔒 도전 진행 중에는 설정을 변경할 수 없습니다.</p>
                <div class="parameter-workspace">
                  <section class="initial-ecosystem" aria-labelledby="initial-ecosystem-title">
                    <div class="initial-ecosystem-heading"><h3 id="initial-ecosystem-title">초기 생태계 구성</h3><p>초기값을 조절하고, 생물군을 선택하세요.</p></div>
                    <div class="initial-stages">${initialEcosystemMarkup()}</div>
                    <p class="initial-hierarchy-note">카드 폭은 영양 단계만 나타냅니다. 밀도(%)와 개체수(마리)는 비교하지 않습니다.</p>
                    <button type="button" class="environment-select" data-parameter-section="start" aria-controls="parameter-panel-start" aria-pressed="false"><span><b>⚙ 공통 환경</b><span class="selection-mark" aria-hidden="true">◀</span></span><small id="environment-summary"></small></button>
                  </section>
                  <div class="parameter-scroll dialog-body" tabindex="0" aria-label="선택한 생물군의 세부 설정">
                    <p class="detail-kicker">선택한 항목의 세부 설정</p>
                    ${parameterGroupMarkup('start', `
                  <section class="special-controls chain-controls">
                    <label for="food-depth"><span><b>먹이사슬 단계</b><small>활성화할 최고 소비자 단계를 고릅니다.</small></span></label>
                    <select id="food-depth"><option value="2">2차 소비자까지 — 기본</option><option value="3">3차 소비자까지</option><option value="4">4차 소비자까지</option></select>
                    <label class="parameter-control efficiency-control" for="transfer-efficiency"><span class="parameter-heading"><b>에너지 전달 효율</b><output id="transfer-output">10%</output></span><span class="parameter-description">10%는 학습용 대표값이며 생태계와 생물에 따라 달라질 수 있습니다.</span><input id="transfer-efficiency" type="range" min="0.05" max="0.30" step="0.01" value="0.10" /></label>
                  </section>
                  <section class="parameter-category"><h4>공간</h4>${parameterMarkup(parameterDefinitions.filter((definition) => definition.group === 'start'))}</section>
                  <section class="special-controls">
                    <label class="seed-control" for="seed-input"><span><b id="seed-label">Random seed</b><small id="seed-helper">같은 seed와 설정은 같은 결과를 재현합니다.</small></span></label>
                    <div class="seed-input-row"><input id="seed-input" maxlength="40" value="${initialFreeParameters.seed}" /><button type="button" id="random-seed" aria-label="새 랜덤 시드 만들기">↻</button></div>
                    <label class="toggle-control" for="toroidal-toggle"><span><b>토로이드 경계</b><small>가장자리가 반대쪽과 연결됩니다.</small></span><input id="toroidal-toggle" type="checkbox" checked /><i></i></label>
                  </section>`)}
                  ${parameterGroupMarkup('forest')}
                  ${parameterGroupMarkup('rabbit')}
                  ${parameterGroupMarkup('wolf')}
                  ${parameterGroupMarkup('tertiary')}
                  ${parameterGroupMarkup('quaternary')}
                  </div>
                </div>
              <div class="dialog-footer"><p id="parameter-error" role="alert"></p><div><button type="button" class="restore-button" id="restore-defaults">기본 설정으로 복원</button><button type="button" id="cancel-parameters">취소</button><button type="button" id="apply-parameters" class="challenge-primary" disabled>설정 적용</button></div></div></dialog>
    <dialog id="intervention-dialog" class="intervention-dialog" aria-labelledby="intervention-title" aria-describedby="intervention-copy intervention-step">
      <form id="intervention-form">
        <h2 id="intervention-title">생태계 개입</h2>
        <p id="intervention-copy"></p>
        <label class="intervention-field" for="intervention-species">대상 종<select id="intervention-species">${RUNTIME_SPECIES.map((species) => `<option value="${species}">${SPECIES_LABELS[species]}</option>`).join('')}</select></label>
        <span class="intervention-field" id="introduction-field"><label for="introduction-amount">도입 개체 수</label>
          <span class="amount-control"><button type="button" id="decrease-introduction" aria-label="도입 개체 수 줄이기">−</button><input id="introduction-amount" type="number" min="1" step="1" value="1" required aria-describedby="introduction-limit"><button type="button" id="increase-introduction" aria-label="도입 개체 수 늘리기">＋</button></span>
        </span>
        <section id="removal-controls" hidden aria-label="개체 제거량">
          <p class="removal-population">현재 개체수 <strong id="removal-population"></strong></p>
          <label class="intervention-field" for="removal-amount">제거할 개체 수</label>
          <span class="amount-control intervention-field"><button type="button" id="decrease-removal" aria-label="제거 개체 수 줄이기">−</button><input id="removal-amount" type="number" min="1" step="1" value="1" required aria-describedby="removal-validation"><button type="button" id="increase-removal" aria-label="제거 개체 수 늘리기">＋</button></span>
          <input id="removal-range" type="range" min="1" max="1" step="1" value="1" aria-label="제거할 개체 수" />
          <p class="removal-range-labels" aria-hidden="true"><span id="removal-min">1</span><span id="removal-max"></span></p>
          <div class="removal-presets" role="group" aria-label="제거 비율">${[[.1, '10%'], [.25, '25%'], [.5, '50%'], [1, '전체']].map(([fraction, label]) => `<button type="button" data-removal-fraction="${fraction}" aria-pressed="false">${label}</button>`).join('')}</div>
          <p class="removal-population" aria-live="polite">제거 후 예상 개체수 <strong id="removal-preview"></strong></p>
          <p id="removal-validation" role="status"></p>
        </section>
        <p id="introduction-limit"></p><p id="intervention-warning" role="status"></p>
        <p id="intervention-step"></p><p id="intervention-error" role="alert"></p>
        <div><button type="button" id="cancel-intervention">취소</button><button type="submit" class="challenge-primary" id="confirm-intervention">도입</button></div>
      </form>
    </dialog>
  </div>`;

function element<T extends HTMLElement>(selector: string, root: ParentNode = document): T {
  const match = root.querySelector<T>(selector);
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
const simulationToolbar = element<HTMLElement>('.sim-toolbar');
const experimentLog = new ExperimentLog();
const seedInput = element<HTMLInputElement>('#seed-input');
const toroidalToggle = element<HTMLInputElement>('#toroidal-toggle');
const depthSelect = element<HTMLSelectElement>('#food-depth');
const transferControl = element<HTMLInputElement>('#transfer-efficiency');
const inspector = element<HTMLDivElement>('#cell-inspector');
const interventionDialog = element<HTMLDialogElement>('#intervention-dialog');
const challengePanel = element<HTMLElement>('#challenge-panel');
const parametersDialog = element<HTMLDialogElement>('#parameters-dialog');
const leaderboardDialog = createLeaderboardDialog();
const applyParametersButton = element<HTMLButtonElement>('#apply-parameters');
const dialogs = new DialogController();
let parameterDraft: ParameterDraft | null = null;
let parameterDraftError = '';
type ParameterIntent = 'edit' | 'edit-and-start-challenge';
let parameterIntent: ParameterIntent = 'edit';

function clearParameterDraft(): void {
  parameterDraft = null;
  parameterDraftError = '';
  parameterIntent = 'edit';
  applyParametersButton.textContent = '설정 적용';
  parameterToggle.setAttribute('aria-expanded', 'false');
}
dialogs.register(parametersDialog, { onClose: clearParameterDraft });
dialogs.register(leaderboardDialog, { backdrop: true });
dialogs.register(interventionDialog, { onClose: () => interventionSession.cancel() });
const leaderboardBoards: Readonly<Record<BoardGroup, HTMLDivElement>> = {
  protector: element<HTMLDivElement>('#leaderboard-board-protector', leaderboardDialog),
  manipulator: element<HTMLDivElement>('#leaderboard-board-manipulator', leaderboardDialog),
};
const leaderboardTabs: Readonly<Record<BoardGroup, HTMLButtonElement>> = {
  protector: element<HTMLButtonElement>('#leaderboard-tab-protector', leaderboardDialog),
  manipulator: element<HTMLButtonElement>('#leaderboard-tab-manipulator', leaderboardDialog),
};
const leaderboardStatus = element<HTMLParagraphElement>('#leaderboard-status', leaderboardDialog);
const leaderboardForm = element<HTMLFormElement>('#leaderboard-form', leaderboardDialog);
const leaderboardSchoolInput = element<HTMLInputElement>('#leaderboard-school', leaderboardDialog);
const leaderboardNumberInput = element<HTMLInputElement>('#leaderboard-student-number', leaderboardDialog);
const leaderboardNameInput = element<HTMLInputElement>('#leaderboard-name', leaderboardDialog);
const leaderboardSubmitButton = element<HTMLButtonElement>('#leaderboard-submit', leaderboardDialog);
const leaderboardRefreshButton = element<HTMLButtonElement>('#leaderboard-refresh', leaderboardDialog);

let parameters: SimulationParameters = { ...initialFreeParameters };
let freeParameters: SimulationParameters = { ...parameters };
let apexDesignParameters: SimulationParameters = apexParameters(parameters);
let simulation = new ForestSimulation(parameters);
let appMode: AppMode = 'free';
let hasApexDesign = false;
const apexSession = new ApexChallengeSession();
let personalBest: ApexSurvivalRecord | null = loadApexPersonalBest(window.localStorage);
let bestResult: PersonalBestFeedback | null = null;
let bestEmphasisStartedAt = -Infinity;
let challengeSignature = '';
const leaderboardTransport: LeaderboardTransport | null = createLeaderboardTransport({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  table: import.meta.env.VITE_LEADERBOARD_TABLE,
  publicView: import.meta.env.VITE_LEADERBOARD_PUBLIC_VIEW,
});
const leaderboardStore = new LeaderboardStore(leaderboardTransport);
let leaderboardMessage = '';
let leaderboardSubmitting = false;
let lastFinishedRecord: ApexSurvivalRecord | null = null;
let hasSubmittedFinishedRecord = false;
let leaderboardSignature = '';
// 기본 표시는 보호단입니다. 기억해 두지 않으므로 페이지를 다시 열면 늘 보호단부터 보입니다.
let activeLeaderboardBoard: BoardGroup = 'protector';
let challengeMessage = '';
let running = false;
let lastAnimationTime = performance.now();
let accumulatedTime = 0;

let pyramidMode: PyramidMode = 'numbers';
let interventionKind: Intervention['kind'] = 'introduce';
const interventionSession = new InterventionSession({
  simulation: () => simulation, isFree: () => appMode === 'free',
  isRunning: () => running, setRunning,
});
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const modeEffects = createModeEffects(element('.board-card'), appMode, reducedMotion);
if (import.meta.hot) import.meta.hot.dispose(() => modeEffects.destroy());
const removalFeedback = new Map<Species, RemovalFeedback>();
const populationFeedbackUntil = new Map<Species, number>();
let lastPopulationStep = -1;
let removalNeedsRedraw = false;
const visibleSeries = new Set<ChartSeries>(['forest', 'rabbit', 'wolf', 'tertiary', 'quaternary', 'fox']);

const speciesClass: Record<Species, string> = { rabbit: 'rabbit', wolf: 'wolf', fox: 'fox', tertiary: 'tertiary', quaternary: 'quaternary' };

function allActiveAgents(snapshot: SimulationSnapshot): Agent[] {
  return simulation.getActiveSpecies().flatMap((species) => [...(snapshot.agents[species] ?? [])]);
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
  else if (species === 'fox') drawFox(ctx, x, y, size * 0.9);
  else if (species === 'tertiary') drawTertiary(ctx, x, y, size, simple);
  else drawQuaternary(ctx, x, y, size * 1.06, simple);
}

function drawFox(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
  ctx.lineWidth = 0.06; ctx.lineJoin = 'round'; ctx.strokeStyle = '#542713'; ctx.fillStyle = SERIES_COLORS.fox;
  ctx.beginPath(); ctx.moveTo(-.45, -.05); ctx.lineTo(-.36, -.44); ctx.lineTo(-.1, -.25); ctx.lineTo(.1, -.25); ctx.lineTo(.36, -.44); ctx.lineTo(.45, -.05); ctx.lineTo(0, .38); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff1d5'; ctx.beginPath(); ctx.moveTo(-.39, -.02); ctx.lineTo(0, .1); ctx.lineTo(.39, -.02); ctx.lineTo(0, .34); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#251710';
  for (const [cx, cy] of [[-.19, -.07], [.19, -.07], [0, .23]]) { ctx.beginPath(); ctx.arc(cx, cy, .045, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
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

function drawBoard(snapshot: SimulationSnapshot, now = performance.now()): void {
  const cellSize = 24;
  const logicalWidth = snapshot.width * cellSize;
  const logicalHeight = snapshot.height * cellSize;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  if (board.width !== logicalWidth * ratio || board.height !== logicalHeight * ratio) {
    board.width = logicalWidth * ratio; board.height = logicalHeight * ratio;
    board.style.aspectRatio = `${logicalWidth} / ${logicalHeight}`;
    board.parentElement!.style.setProperty('--forest-ratio', String(logicalWidth / logicalHeight));
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
  for (const species of simulation.getActiveSpecies()) {
    for (const agent of snapshot.agents[species] ?? []) drawSpecies(ctx, species, (agent.x + 0.5) * cellSize, (agent.y + 0.54) * cellSize, cellSize, simple);
  }
  for (const feedback of removalFeedback.values()) {
    const emphasis = removalEmphasis(feedback, now, reducedMotion.matches);
    if (emphasis === 0) continue;
    ctx.save();
    ctx.globalAlpha = .95 * emphasis;
    ctx.strokeStyle = SERIES_COLORS[feedback.species];
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 3]);
    for (const { x, y } of feedback.positions) ctx.strokeRect(x * cellSize + 3, y * cellSize + 3, cellSize - 6, cellSize - 6);
    ctx.restore();
  }
}

function challengeIsLocked(): boolean {
  return appMode === 'apex' && challengeSettingsLocked(apexSession.getState());
}

function formatSteps(value: number): string {
  return `${value.toLocaleString()} step`;
}

function renderChallengePanel(): void {
  challengePanel.hidden = appMode !== 'apex';
  element('#challenge-description').hidden = appMode !== 'apex';
  renderLeaderboardPanel();
  if (appMode !== 'apex') return;
  const state = apexSession.getState();
  const metric = simulation.getHistory().at(-1)!;
  const statuses = state.levelStatus.length > 0 ? state.levelStatus : evaluateApexLevels(metric);
  const phaseLabel = state.phase === 'setup' ? '생태계 설계' : state.phase === 'over' ? 'CHALLENGE OVER' : running ? 'CHALLENGE RUNNING' : '일시정지';

  const bestMarkup = personalBest ? formatSteps(personalBest.score) : '아직 기록 없음';
  const result = state.phase === 'over' ? bestResult : null;
  // Unchanged results keep their DOM, focus and one-shot animations across redraws.
  const signature = JSON.stringify([state.phase, state.score, statuses, running, personalBest?.score, result, challengeMessage]);
  if (signature === challengeSignature) return;
  challengeSignature = signature;
  const bestElapsed = result ? Math.max(0, performance.now() - bestEmphasisStartedAt) : 0;
  const emphasizeBest = result !== null && bestElapsed < PERSONAL_BEST_FEEDBACK_MS;
  const collapseLabels = state.collapsedLevels.map((level) => statuses.find((status) => status.level === level)?.label ?? level).join(', ');
  const setupActions = '<button type="button" class="challenge-primary" data-challenge-action="start">도전 시작 · Start Challenge</button>';
  const activeActions = '<button type="button" class="challenge-secondary" data-challenge-action="abort">도전 중단</button>';
  const overActions = '<button type="button" class="challenge-primary" data-challenge-action="edit-and-start" aria-haspopup="dialog" aria-controls="parameters-dialog">수정 후 도전</button><button type="button" class="challenge-secondary" data-challenge-action="retry">같은 조건 재현</button>';
  challengePanel.dataset.phase = state.phase;
  challengePanel.classList.toggle('is-new-best', result !== null);
  challengePanel.classList.toggle('best-emphasis', emphasizeBest);
  challengePanel.style.setProperty('--best-elapsed', `-${bestElapsed}ms`);
  challengePanel.innerHTML = `
    <p class="section-kicker challenge-title">APEX SURVIVAL</p>
    <div class="challenge-score">
      ${result ? '<span class="new-best">NEW PERSONAL BEST</span>' : ''}
      <strong>${state.score.toLocaleString()}</strong>
      <span class="score-unit">${state.phase === 'over' ? 'FINAL SCORE' : 'SCORE'} · STEP</span>
      ${result ? `<p class="best-improvement" aria-label="${result.description}">${result.improvement === null ? '첫 기록 달성' : `+${result.improvement.toLocaleString()} <span aria-hidden="true">↑</span><small>이전 최고보다 · step</small>`}</p>
      ${result.previousBest === null ? '' : `<p class="best-comparison"><span>Previous Best</span><b>${result.previousBest.toLocaleString()} → ${result.finalScore.toLocaleString()}</b></p>`}`
      : `<small>Personal Best <b>${bestMarkup}</b></small>`}
      ${result ? `<small>Personal Best <b>${bestMarkup}</b></small>` : ''}
    </div>
    <p class="challenge-status">상태 <b>${phaseLabel}</b></p>
    ${state.phase === 'over' ? `<p class="challenge-collapse">최초 붕괴 영양 단계 <b>${collapseLabels}</b><span>붕괴 step · ${state.collapseStep}</span></p>` : ''}

    <div class="challenge-actions">${state.phase === 'setup' ? setupActions : state.phase === 'active' ? activeActions : overActions}</div>
      ${state.phase === 'over' ? `<p class="challenge-edit-note">설정을 수정해 새로운 조건으로 도전하거나, 같은 조건을 다시 재현할 수 있습니다.</p><button type="button" class="challenge-secondary submit-record-link" data-open-ranking>기록판 / 이 기록 제출</button>` : ''}
      ${challengeIsLocked() ? '<span class="challenge-lock">🔒 도전 진행 중에는 설정을 변경할 수 없습니다.</span>' : ''}
      ${challengeMessage ? `<span class="challenge-message">${challengeMessage}</span>` : ''}
`;
}

function readStoredParticipant(): Participant | null {
  try { return loadParticipant(window.localStorage); } catch { return null; }
}

function rememberParticipant(participant: Participant): void {
  try {
    window.localStorage.setItem(participantStorageKey(), JSON.stringify(participant));
  } catch {
    // 저장이 막힌 브라우저에서도 제출 자체는 계속 동작합니다.
  }
}

function renderLeaderboardPanel(): void {
  if (appMode !== 'apex') return;
  const signature = JSON.stringify([appMode, leaderboardStore.states, leaderboardMessage, activeLeaderboardBoard]);
  if (signature !== leaderboardSignature) {
    leaderboardSignature = signature;
    for (const board of BOARD_GROUPS) {
      const isActive = board === activeLeaderboardBoard;
      const tabs = [leaderboardTabs[board]];
      if (appMode === 'apex') tabs.push(element<HTMLButtonElement>(`#summary-tab-${board}`));
      for (const tab of tabs) {
        tab.setAttribute('aria-selected', String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
      }
      leaderboardBoards[board].hidden = !isActive;
      if (appMode === 'apex') element(`#summary-board-${board}`).hidden = !isActive;
      for (const scope of ['national', 'hafs'] as const) {
        const state = leaderboardStore.states[scope][board];
        for (const surface of ['ranking', 'summary'] as const) {
          if (surface === 'summary' && appMode !== 'apex') continue;
          const status = element(`#${surface}-status-${board}-${scope}`);
          const message = leaderboardStateText(state);
          if (status.textContent !== message) status.textContent = message;
          status.dataset.tone = state.phase === 'error' ? 'error' : 'normal';
          const list = element(`#${surface}-list-${board}-${scope}`);
          const markup = boardMarkup(board, state.entries, { compact: surface === 'summary', showEmptyState: state.phase === 'ready' });
          if (list.innerHTML !== markup) list.innerHTML = markup;
        }
      }
    }
    if (leaderboardStatus.textContent !== leaderboardMessage) leaderboardStatus.textContent = leaderboardMessage;
  }
  const phase = apexSession.getState().phase;
  const canSubmit = appMode === 'apex' && Boolean(leaderboardTransport) && phase === 'over' && lastFinishedRecord !== null && !hasSubmittedFinishedRecord;
  leaderboardForm.hidden = !canSubmit;
  leaderboardSubmitButton.disabled = leaderboardSubmitting;
  leaderboardSubmitButton.textContent = leaderboardSubmitting ? '제출 중…' : '이 기록 제출하기';
  leaderboardRefreshButton.disabled = !leaderboardTransport;
}

async function refreshLeaderboard(): Promise<void> {
  await leaderboardStore.refresh(renderLeaderboardPanel);
}

async function submitFinishedRecord(): Promise<void> {
  const record = lastFinishedRecord;
  if (!leaderboardTransport || !record || leaderboardSubmitting || hasSubmittedFinishedRecord) return;
  const validation = validateParticipant({ schoolName: leaderboardSchoolInput.value, studentNumber: leaderboardNumberInput.value, studentName: leaderboardNameInput.value });
  if (!validation.ok) {
    leaderboardMessage = validation.message;
    renderLeaderboardPanel();
    return;
  }
  leaderboardSubmitting = true;
  leaderboardMessage = '';
  renderLeaderboardPanel();
  try {
    const submission = await createSubmission(record, validation.participant);
    await leaderboardTransport.submit(submission);
    hasSubmittedFinishedRecord = true;
    rememberParticipant(validation.participant);
    leaderboardSubmitting = false;
    await refreshLeaderboard();
    leaderboardMessage = '기록을 제출했습니다.';
  } catch (error) {
    leaderboardMessage = error instanceof Error ? error.message : '기록을 제출하지 못했습니다.';
  } finally {
    leaderboardSubmitting = false;
    renderLeaderboardPanel();
  }
}

function clearFinishedRecord(): void {
  lastFinishedRecord = null;
  hasSubmittedFinishedRecord = false;
  bestResult = null;
  bestEmphasisStartedAt = -Infinity;
  challengeSignature = '';
  challengePanel.classList.remove('best-emphasis', 'is-new-best');
}

function updateControlAvailability(): void {
  const state = apexSession.getState();
  const locked = challengeIsLocked();
  const values = parameterDraft?.value ?? parameters;
  for (const definition of parameterDefinitions) element<HTMLInputElement>(`#param-${definition.key}`).disabled = locked || !parameterGroupActive(definition.group, values.foodChainDepth);
  updateParameterNavigation(values);
  transferControl.disabled = locked;
  toroidalToggle.disabled = locked;
  depthSelect.disabled = appMode === 'apex' || locked;
  seedInput.disabled = appMode === 'apex' || locked;
  element<HTMLButtonElement>('#random-seed').disabled = appMode === 'apex' || locked;
  element<HTMLButtonElement>('#restore-defaults').disabled = locked;
  element('#parameter-lock-note').hidden = !locked;
  parameterToggle.setAttribute('data-locked', String(locked));
  element('#parameter-entry-hint').textContent = locked ? '도전 중에는 설정을 확인할 수 있어요.' : appMode === 'apex' ? '다음 도전의 개체수와 환경 조건을 설계하세요.' : '개체수와 환경 조건을 조정해 실험을 설계하세요.';
  element('#parameter-entry-action').textContent = locked ? '설정 보기' : '설계 열기';
  const prepared = parameterDraft?.prepare(parameters, appMode, state.phase);
  const startsChallenge = parameterIntent === 'edit-and-start-challenge' && appMode === 'apex' && state.phase === 'over';
  applyParametersButton.textContent = startsChallenge ? '설정 적용 및 도전 시작' : '설정 적용';
  applyParametersButton.disabled = prepared?.status !== 'apply' && !(startsChallenge && prepared?.status === 'unchanged');
  element('#parameter-edit-note').textContent = locked ? '도전 진행 중·일시정지 중에는 읽기 전용입니다.' : startsChallenge ? '설정을 적용하면 새 도전을 시작합니다. 취소하면 종료 결과로 돌아갑니다.' : appMode === 'apex' && state.phase === 'over' ? '다음 도전 설정을 편집합니다. 종료 결과와 숲은 그대로 유지됩니다.' : '설정 적용 시 새 조건으로 한 번 초기화됩니다. 자동 실행하지 않습니다.';
  element('#parameter-error').textContent = parameterDraftError;
  element('#seed-label').textContent = appMode === 'apex' ? 'Challenge Seed' : 'Random seed';
  element('#seed-helper').textContent = appMode === 'apex' ? '공정한 비교를 위해 이 도전에서는 고정됩니다.' : '같은 seed와 설정은 같은 결과를 재현합니다.';
  element('#intervention-card').hidden = appMode !== 'free';

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

function updateModeLayout(): void {
  const free = appMode === 'free';
  placeSimulationControls(simulationToolbar, free);
  if (free) {
    document.querySelector('.leaderboard-summary')?.remove();
    if (leaderboardDialog.open) leaderboardDialog.close();
    leaderboardDialog.remove();
    element('#simulation-console').append(experimentLog.element);
  } else {
    experimentLog.element.remove();
    if (!leaderboardDialog.isConnected) shell.append(leaderboardDialog);
    if (!document.querySelector('.leaderboard-summary')) {
      simulationToolbar.insertAdjacentHTML('beforebegin', leaderboardSummaryMarkup());
      element('#open-leaderboard').addEventListener('click', event => openLeaderboard(event.currentTarget as HTMLElement));
      for (const board of BOARD_GROUPS) bindLeaderboardTab(element<HTMLButtonElement>(`#summary-tab-${board}`), board, 'summary');
      leaderboardSignature = '';
    }
  }
  renderLeaderboardPanel();
}

function updateStructuralUi(): void {
  updateModeLayout();
  const speciesSelect = element<HTMLSelectElement>('#intervention-species');
  if (speciesSelect.dataset.mode !== appMode) {
    speciesSelect.innerHTML = RUNTIME_SPECIES.filter(species => appMode === 'free' || species !== 'fox').map(species => `<option value="${species}">${SPECIES_LABELS[species]}</option>`).join('');
    speciesSelect.dataset.mode = appMode;
  }
  const active = simulation.getActiveSpecies();
  shell.classList.toggle('apex-mode', appMode === 'apex');
  modeEffects.sync(appMode);
  element('#experiment-heading').hidden = appMode === 'apex';
  element('#simulation-console').setAttribute('aria-label', appMode === 'apex' ? 'Challenge Console' : 'Experiment Console');
  document.querySelectorAll<HTMLButtonElement>('[data-app-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.appMode === appMode)));
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

function renderPopulationStrip(snapshot: SimulationSnapshot): void {
  const comparison = populationComparison(simulation.getHistory());
  const fromStep = comparison?.step ?? snapshot.step;
  element('#population-comparison').textContent = `순변화 · 최근 ${snapshot.step - fromStep} step (t=${fromStep} → ${snapshot.step}) · 개체 제거는 제거 직전 기준`;
  element('#forest-population').textContent = simulation.getHistory().at(-1)!.forestAbundance.toLocaleString();
  const strip = element('#population-strip');
  if (strip.dataset.depth !== simulation.getActiveSpecies().join(',')) {
    strip.innerHTML = simulation.getActiveSpecies().map((species) => `<article data-population="${species}" class="mini-population ${speciesClass[species]}"><canvas data-mini-icon="${species}" width="38" height="38"></canvas><span><small>${SPECIES_LABELS[species]}</small><b></b><em></em></span></article>`).join('');
    strip.dataset.depth = simulation.getActiveSpecies().join(',');
    initializeIconCanvases();
  }
  const now = performance.now();
  for (const species of simulation.getActiveSpecies()) {
    const item = element<HTMLElement>(`[data-population="${species}"]`);
    const current = (snapshot.agents[species]?.length ?? 0);
    const change = populationChange(current, species, comparison);
    const removed = snapshot.removedSpecies.includes(species);
    const feedback = removalFeedback.get(species);
    const removing = feedback !== undefined && removalEmphasis(feedback, now, reducedMotion.matches) > 0;
    const delta = removing ? -feedback.positions.length : removed ? -(feedback?.count ?? 0) : change.delta;
    const label = item.querySelector<HTMLElement>('em')!;
    const signature = `${change.previous}:${current}`;
    if (!removed) {
      const until = populationFeedbackDeadline(now, populationFeedbackUntil.get(species), lastPopulationStep >= 0 && snapshot.step !== lastPopulationStep, item.dataset.comparison !== signature, delta);
      if (until === undefined) populationFeedbackUntil.delete(species);
      else populationFeedbackUntil.set(species, until);
    }
    item.dataset.comparison = signature;
    item.querySelector('b')!.textContent = removing ? `${feedback.count} → ${current}` : String(current);
    item.querySelector('small')!.textContent = `${SPECIES_LABELS[species]}${removing && delta !== 0 ? ' · 실험적 제거' : ''}`;
    item.classList.toggle('is-removed', removed);
    item.classList.toggle('is-removal-feedback', removing);
    item.title = removed || removing ? `실험적 제거 · ${feedback?.count ?? 0} → ${current} · t=${feedback?.step ?? snapshot.step}`
      : `t=${fromStep} → ${snapshot.step} · ${change.previous} → ${current} · ${change.text}`;
    label.textContent = removing ? `${delta} ↓` : removed ? '실험적 제거' : `${change.text}${delta === 0 ? '' : delta > 0 ? ' ↑' : ' ↓'}`;
    label.classList.toggle('has-delta', (!removed || removing) && delta !== 0);
    label.classList.toggle('is-changing', delta !== 0 && (removing || !removed && populationFeedbackUntil.has(species)));
    label.title = item.title;
  }
  lastPopulationStep = snapshot.step;
}

function clearPopulationFeedback(): void {
  removalFeedback.clear();
  populationFeedbackUntil.clear();
  removalNeedsRedraw = false;
  lastPopulationStep = -1;
  delete element('#population-strip').dataset.depth;
}

function pyramidWidth(value: number, maximum: number): number {
  if (value <= 0) return 12;
  return Math.max(18, Math.sqrt(value / Math.max(1, maximum)) * 100);
}

function renderPyramid(snapshot: SimulationSnapshot): void {
  const metric = simulation.getHistory().at(-1);
  const pyramid = element('#pyramid');
  const foodWeb = appMode === 'free' && simulation.getActiveSpecies().includes('fox');
  element('.learning-card li').innerHTML = foodWeb
    ? '기존 먹이사슬에 <b>붉은여우의 두 먹이 연결</b>을 더한 단순한 먹이그물입니다. 실제 식단 전체를 재현하지 않습니다.'
    : '학습을 위해 먹이 관계를 <b>직선형 먹이사슬</b>로 단순화했습니다. 실제 생태계는 대부분 먹이그물입니다.';
  element('.rule-content li:nth-child(3)').innerHTML = foodWeb
    ? '<b>늑대·붉은여우 행동</b><span>살아 있는 여우가 있으면 매 step 순서를 추첨합니다. 여우는 이용 가능한 토끼와 식물성 먹이 중 하나를 선택합니다. 사냥에 실패하면 그 step의 섭식을 마칩니다.</span>'
    : '<b>늑대 행동</b><span>토끼 탐색·사냥·번식·사망</span>';
  const title = foodWeb ? '실시간 영양 구조' : '실시간 생태 피라미드';
  element('.pyramid-toolbar h2').textContent = title;
  element('.pyramid-card').setAttribute('aria-label', title);
  element('.pyramid-toolbar [role=group]').setAttribute('aria-label', foodWeb ? '영양 구조 표현 방식' : '피라미드 표현 방식');
  pyramid.classList.toggle('food-web', foodWeb);
  let pyramidNote: string;
  if (pyramidMode === 'numbers') {
    const levels = [
      { id: 'vegetation', label: '식생', value: metric?.forestAbundance ?? 0, unit: '성장 단계 합', color: '#2f7b4c' },
      ...simulation.getActiveSpecies().filter(species => species !== 'fox').map((species) => ({ id: species, label: SPECIES_LABELS[species], value: (snapshot.agents[species]?.length ?? 0), unit: '개체', color: SERIES_COLORS[species] })),
    ].reverse();
    const maximum = Math.max(...levels.map((level) => level.value), 1);
    pyramid.innerHTML = levels.map((level) => `<div class="pyramid-level" title="${level.label}: ${level.value.toLocaleString()} ${level.unit}"><div style="width:${pyramidWidth(level.value, maximum)}%;--level:${level.color}"><span>${level.label}</span><b>${level.value.toLocaleString()}</b><small>${level.unit}</small></div></div>`).join('');
    pyramidNote = '식생 = 성장 단계 합 · 막대 폭 = 제곱근 척도';
  } else {
    const flows = simulation.getEnergyFlow(20).filter(flow => flow.target !== 'fox').reverse();
    const maximum = Math.max(...flows.map((flow) => flow.rate), 1);
    pyramid.innerHTML = flows.map((flow) => {
      const source = flow.source === 'vegetation' ? '식생' : SPECIES_LABELS[flow.source];
      const label = `${source} → ${SPECIES_LABELS[flow.target]}`;
      return `<div class="pyramid-level energy-level" title="최근 ${flow.window} step · ${label}: ${flow.rate.toFixed(1)} 모델 에너지/step"><div style="width:${pyramidWidth(flow.rate, maximum)}%;--level:${SERIES_COLORS[flow.target]}"><span>${label}</span><b>${flow.rate.toFixed(1)}</b><small>모델 에너지/step</small></div></div>`;
    }).join('');
    pyramidNote = '최근 20 step 실제 전달량 / 경과 step · 모델 에너지/step · 폭 = 제곱근 척도';
  }
  if (foodWeb) {
    pyramid.innerHTML = foodWebMarkup(snapshot, simulation.getFoxDiet(), simulation.getEnergyFlow(20), pyramidMode, pyramid.innerHTML);
    element('.pyramid-card').querySelectorAll('.pyramid-note, .pyramid-help, .chain-summary').forEach(description => description.remove());
    pyramid.removeAttribute('aria-describedby');
  } else {
    if (!document.querySelector('#pyramid-note')) {
      pyramid.insertAdjacentHTML('afterend', `<p class="pyramid-note" id="pyramid-note"></p>
        <details class="pyramid-help"><summary>척도와 단위 안내</summary><p>소비자는 실제 개체수이며 식생은 모든 칸의 성장 단계 합입니다. 막대 폭은 제곱근 척도와 최소 가시 폭을 적용합니다. 에너지 흐름은 최근 20 step의 실제 섭식 전달량을 경과 step으로 나눈 모델 에너지/step이며 실제 Joule이 아닙니다.</p></details><p class="chain-summary" id="chain-summary"></p>`);
    }
    pyramid.setAttribute('aria-describedby', 'pyramid-note');
    element('#pyramid-note').textContent = pyramidNote;
    const observedParameters = simulation.getParameters();
    element('#chain-summary').textContent = `활성 영양 단계 ${simulation.getActiveSpecies().length + 1} · 전달 효율 ${Math.round(observedParameters.transferEfficiency * 100)}%`;
  }
}

function renderStats(snapshot: SimulationSnapshot): void {
  const stats = snapshot.stats;
  const totalBirths = simulation.getActiveSpecies().reduce((sum, species) => sum + (stats.births[species] ?? 0), 0);
  const totalDeaths = simulation.getActiveSpecies().reduce((sum, species) => sum + (stats.deaths[species] ?? 0), 0);
  const totalHunts = simulation.getActiveSpecies().slice(1).reduce((sum, species) => sum + (stats.feedingEvents[species] ?? 0), 0) - (stats.foxPlantEaten ?? 0);
  element('#stat-grid').innerHTML = `
    <div><span>전체 출생</span><strong>${totalBirths}</strong></div>
    <div><span>전체 자연사·피식</span><strong>${totalDeaths}</strong></div>
    <div><span>동물 사냥 성공</span><strong>${totalHunts}</strong></div>
    <div><span>${simulation.getActiveSpecies().includes('fox') ? '동물이 먹은 식생' : '토끼가 먹은 식생'}</span><strong>${stats.forestEaten} 단계</strong></div>
    <div><span>기록된 생태계 개입</span><strong>${snapshot.interventions.length}</strong></div>`;
}

function renderInterventions(snapshot: SimulationSnapshot): void {
  const firstStep = simulation.getHistory()[0]?.step ?? 0;
  const groups = groupInterventions(snapshot.interventions, firstStep, snapshot.step);
  const interventionMarkup = groups.map((group) => `<span style="--marker:${SERIES_COLORS[group.events[0].species]}">Step ${group.step.toLocaleString('ko-KR')} · ${group.events.map(interventionLabel).join(' · ')}</span>`).join('');
  const latest = snapshot.interventions.at(-1);
  element('#recent-intervention').textContent = latest
    ? `최근 개입: Step ${latest.step.toLocaleString('ko-KR')} · ${interventionLabel(latest)}` : '최근 개입 없음';
  const state = apexSession.getState();
  const collapseMarkup = appMode === 'apex' && state.collapseStep !== null
    ? `<span class="collapse-log" title="t = ${state.collapseStep}: Apex 먹이사슬 붕괴">Apex chain collapsed · t = ${state.collapseStep}</span>`
    : '';
  const completeMarkup = interventionMarkup + collapseMarkup;
  element('#intervention-log').innerHTML = completeMarkup || '<span>생태계 개입 기록 없음</span>';
}

function drawChart(now = performance.now()): void {
  drawPopulationChart(chart, {
    history: simulation.getHistory(),
    depth: parameters.foodChainDepth,
    runtimeSpecies: simulation.getActiveSpecies(),
    visibleSeries,
    interventions: simulation.getInterventions(),
    removalHighlights: [...removalFeedback.values()].map((feedback) => ({ ...feedback, emphasis: removalEmphasis(feedback, now, reducedMotion.matches, REMOVAL_MARKER_MS) })),
    challengeCollapse: appMode === 'apex' && apexSession.getState().collapseStep !== null
      ? { step: apexSession.getState().collapseStep!, label: `Apex chain collapsed · t=${apexSession.getState().collapseStep}` }
      : null,
  });
}

function render(): void {
  const snapshot = simulation.getSnapshot();
  drawBoard(snapshot);
  drawChart();
  element('#step-value').textContent = String(snapshot.step).padStart(3, '0');
  renderPopulationStrip(snapshot);
  renderPyramid(snapshot);
  renderStats(snapshot);
  renderInterventions(snapshot);
  if (appMode === 'free') experimentLog.render(simulation.getEvents());
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
  setRunning(false);
  // Completed results and their simulation remain an observation of the finished run.
  // Controls now edit the next design; starting a new challenge applies that design.
  if (appMode === 'apex' && apexSession.getState().phase === 'over') {
    updateAllControls();
    return;
  }
  parameters = appMode === 'apex' ? apexParameters(parameters) : validateParameters(parameters);
  if (appMode === 'apex') apexDesignParameters = { ...parameters }; else freeParameters = { ...parameters };
  simulation = new ForestSimulation(parameters);
  clearPopulationFeedback();
  inspector.hidden = true;
  updateStructuralUi();
  render();
}

function updateAllControls(): void {
  if (!parameterDraft) return;
  const values = parameterDraft.value;
  for (const definition of parameterDefinitions) {
    element<HTMLInputElement>(`#param-${definition.key}`).value = String(values[definition.key]);
    element<HTMLInputElement>(`#param-${definition.key}`).setAttribute('aria-valuetext', formatParameter(definition, values[definition.key]));
    element<HTMLOutputElement>(`#output-${definition.key}`).value = formatParameter(definition, values[definition.key]);
  }
  seedInput.value = values.seed;
  toroidalToggle.checked = values.toroidal;
  depthSelect.value = String(values.foodChainDepth);
  transferControl.value = String(values.transferEfficiency);
  element<HTMLOutputElement>('#transfer-output').value = `${Math.round(values.transferEfficiency * 100)}%`;
  transferControl.setAttribute('aria-valuetext', `${Math.round(values.transferEfficiency * 100)}%`);
  updateControlAvailability();
}

function updateParameterNavigation(values: SimulationParameters): void {
  for (const { group, key } of initialStages) {
    const inactive = !parameterGroupActive(group, values.foodChainDepth);
    element(`[data-initial-stage="${group}"]`).classList.toggle('is-inactive', inactive);
    element(`#stage-status-${group}`).textContent = inactive ? '비활성' : '활성';
    element(`#stage-status-${group}`).hidden = !inactive;
    element(`#param-${key}`).setAttribute('aria-describedby', `stage-status-${group}`);
    if (group === 'tertiary' || group === 'quaternary') element(`#inactive-note-${group}`).hidden = !inactive;
  }
  element('#environment-summary').textContent = `격자 ${values.gridColumns}열 · 전달 ${Math.round(values.transferEfficiency * 100)}% · ${values.foodChainDepth}차까지\nSeed ${values.seed} · 토로이드 ${values.toroidal ? 'ON' : 'OFF'}`;
}

function selectParameterGroup(group: ParameterGroup): void {
  // Selection only hides/shows existing nodes: draft, slider focus and listeners stay intact.
  document.querySelectorAll<HTMLButtonElement>('[data-parameter-section]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.parameterSection === group));
  });
  document.querySelectorAll<HTMLElement>('[data-parameter-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.parameterPanel !== group;
  });
  element('.parameter-scroll').scrollTop = 0;
}

document.querySelectorAll<HTMLButtonElement>('[data-parameter-section]').forEach((button) => {
  button.addEventListener('click', () => {
    selectParameterGroup(button.dataset.parameterSection as ParameterGroup);
    if (window.matchMedia('(max-width: 760px)').matches) element('.parameter-scroll').scrollIntoView({ block: 'start' });
  });
});

function finishApexChallenge(): void {
  const record = createApexRecord(apexSession.getState());
  lastFinishedRecord = record;
  hasSubmittedFinishedRecord = false;
  try {
    const result = saveApexPersonalBest(window.localStorage, record);
    personalBest = result.best;
    bestResult = result.isNewBest ? personalBestFeedback(record.score, result.previousBest) : null;
    bestEmphasisStartedAt = result.isNewBest ? performance.now() : -Infinity;
  } catch {
    challengeMessage = '이 브라우저에서는 Personal Best를 저장할 수 없습니다.';
    bestResult = null;
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
  running = false;
  parameters = apexParameters(parameterSource);
  apexDesignParameters = { ...parameters };
  simulation = new ForestSimulation(parameters);
  clearPopulationFeedback();
  inspector.hidden = true;
  challengeMessage = '';
  clearFinishedRecord();
  const initialMetric = simulation.getHistory().at(-1)!;
  const started = apexSession.start(parameters, initialMetric);
  if (started) toggleParameters(false);
  if (!started) {
    const missing = apexSession.getState().levelStatus.filter((level) => !level.present).map((level) => level.label).join(', ');
    challengeMessage = `도전을 시작하려면 모든 영양 단계가 존재해야 합니다. 확인: ${missing}`;
  }
  setRunning(started);
  updateStructuralUi();
  render();
}

function returnToApexSetup(parameterSource: SimulationParameters = parameters): void {
  setRunning(false);
  apexSession.returnToSetup();
  parameters = apexParameters(parameterSource);
  apexDesignParameters = { ...parameters };
  simulation = new ForestSimulation(parameters);
  clearPopulationFeedback();
  inspector.hidden = true;
  challengeMessage = '';
  clearFinishedRecord();
  updateStructuralUi();
  render();
}

function switchMode(nextMode: AppMode): void {
  if (nextMode === appMode) return;
  if (appMode === 'apex' && apexSession.getState().phase === 'active') {
    const confirmed = window.confirm('현재 도전을 포기하고 자유 탐구로 돌아가시겠습니까? 이 기록은 Personal Best에 저장되지 않습니다.');
    if (!confirmed) return;
  }
  setRunning(false);
  if (appMode === 'free') freeParameters = { ...parameters };
  else apexDesignParameters = apexParameters(parameters);
  appMode = nextMode;
  apexSession.returnToSetup();
  challengeMessage = '';
  clearFinishedRecord();
  if (nextMode === 'apex') {
    if (!hasApexDesign) {
      apexDesignParameters = apexParameters(parameters);
      hasApexDesign = true;
    }
    parameters = apexParameters(apexDesignParameters);
  } else {
    parameters = validateParameters(freeParameters);
  }
  simulation = new ForestSimulation(parameters);
  clearPopulationFeedback();
  updateStructuralUi();
  render();
}

function updateInterventionDialog(): void {
  element('#intervention-error').textContent = '';
  const species = element<HTMLSelectElement>('#intervention-species').value as Species;
  const introducing = interventionKind === 'introduce';
  const limit = simulation.getIntroductionLimit(species);
  const input = element<HTMLInputElement>('#introduction-amount');
  const amount = input.valueAsNumber;
  input.max = String(limit);
  input.disabled = !introducing || limit === 0;
  element('#introduction-field').hidden = !introducing;
  element('#introduction-limit').hidden = !introducing;
  element('#introduction-limit').textContent = limit === 0 ? '도입할 빈 칸이 없습니다.' : `한 번에 1–${limit}마리 도입 가능 · 빈 칸에 배치`;
  element<HTMLButtonElement>('#decrease-introduction').disabled = !Number.isInteger(amount) || amount <= 1;
  element<HTMLButtonElement>('#increase-introduction').disabled = !Number.isInteger(amount) || amount >= limit;
  const count = (simulation.getSnapshot().agents[species]?.length ?? 0);
  const removalInput = element<HTMLInputElement>('#removal-amount');
  const removalAmount = removalInput.valueAsNumber;
  const validRemoval = Number.isInteger(removalAmount) && removalAmount >= 1 && removalAmount <= count;
  removalInput.min = count === 0 ? '0' : '1';
  removalInput.max = String(count);
  removalInput.disabled = introducing || count === 0;
  removalInput.setAttribute('aria-invalid', String(!introducing && count > 0 && !validRemoval));
  element('#removal-controls').hidden = introducing;
  element('#removal-population').textContent = `${count.toLocaleString('ko-KR')}마리`;
  element('#removal-preview').textContent = count === 0 ? '0마리' : validRemoval ? `${(count - removalAmount).toLocaleString('ko-KR')}마리` : '—';
  element('#removal-validation').textContent = count === 0 ? '제거할 개체가 없습니다.' : validRemoval ? '' : `1–${count} 사이의 정수를 입력하세요.`;
  element<HTMLButtonElement>('#decrease-removal').disabled = introducing || !validRemoval || removalAmount <= 1;
  element<HTMLButtonElement>('#increase-removal').disabled = introducing || !validRemoval || removalAmount >= count;
  const range = element<HTMLInputElement>('#removal-range');
  range.min = removalInput.min;
  range.max = String(count);
  range.value = String(validRemoval ? removalAmount : removalPresetAmount(count, .1));
  range.disabled = introducing || count === 0;
  element('#removal-min').textContent = range.min;
  element('#removal-max').textContent = count.toLocaleString('ko-KR');
  document.querySelectorAll<HTMLButtonElement>('[data-removal-fraction]').forEach(button => {
    button.disabled = introducing || count === 0;
    button.setAttribute('aria-pressed', String(validRemoval && removalAmount === removalPresetAmount(count, Number(button.dataset.removalFraction))));
  });
  element('#intervention-title').textContent = `${SPECIES_LABELS[species]} ${introducing ? '도입' : '개체 제거'}`;
  element('#intervention-copy').textContent = introducing ? '현재 생태계에 새 개체를 넣습니다. 확인 후에는 일시정지를 유지합니다.' : '현재 개체군에서 무작위로 실험적 제거를 합니다. 확인 후에는 일시정지를 유지합니다.';
  const prey = speciesConfigs(simulation.getParameters())[species].preyType;
  const noPrey = introducing && prey !== 'vegetation' && (simulation.getSnapshot().agents[prey]?.length ?? 0) === 0;
  element('#intervention-warning').textContent = noPrey ? `현재 주요 먹이인 ${SPECIES_LABELS[prey as Species]}가 없습니다. 도입 후 먹이 부족의 영향을 받을 수 있습니다.` : '';
  const confirm = element<HTMLButtonElement>('#confirm-intervention');
  confirm.textContent = introducing ? `${Number.isInteger(amount) && amount > 0 ? amount : ''}마리 도입`
    : `${SPECIES_LABELS[species]} ${validRemoval ? removalAmount === count ? '전체 제거' : `${removalAmount.toLocaleString('ko-KR')}마리 제거` : '개체 제거'}`;
  confirm.classList.toggle('confirm-removal', !introducing);
  confirm.disabled = introducing ? !Number.isInteger(amount) || amount < 1 || amount > limit : !validRemoval;
}

function resetInterventionAmount(): void {
  const species = element<HTMLSelectElement>('#intervention-species').value as Species;
  element<HTMLInputElement>('#introduction-amount').value = species === 'fox' ? '4' : '1';
  element<HTMLInputElement>('#removal-amount').value = String(removalPresetAmount((simulation.getSnapshot().agents[species]?.length ?? 0), .1));
  element('#intervention-error').textContent = '';
  updateInterventionDialog();
}

function openInterventionDialog(kind: Intervention['kind'], species: Species, opener: HTMLElement): void {
  if (parametersDialog.open || leaderboardDialog.open || interventionDialog.open) return;
  const step = interventionSession.begin();
  if (step === null) return;
  interventionKind = kind;
  element<HTMLSelectElement>('#intervention-species').value = species;
  element('#intervention-step').textContent = `현재 Step: ${step.toLocaleString('ko-KR')} · 일시정지`;
  element('#intervention-error').textContent = '';
  resetInterventionAmount();
  if (!dialogs.open(interventionDialog, opener, element('#intervention-species'))) interventionSession.cancel();
}

function confirmIntervention(event: SubmitEvent): void {
  event.preventDefault();
  const species = element<HTMLSelectElement>('#intervention-species').value as Species;
  const snapshot = simulation.getSnapshot();
  // Copy the array map, not the individuals: the model replaces the target array.
  const before = { ...snapshot, agents: { ...snapshot.agents } };
  const amount = element<HTMLInputElement>(interventionKind === 'remove' ? '#removal-amount' : '#introduction-amount').valueAsNumber;
  const result = interventionSession.confirm(interventionKind, species, amount);
  if (!result) {
    updateInterventionDialog();
    element('#intervention-error').textContent = '현재 개체 수와 개입 수량을 확인하세요.';
    return;
  }
  if (result.kind === 'remove') {
    removalFeedback.set(species, captureRemovalFeedback(before, species, performance.now(), simulation.getSnapshot().agents[species]));
    removalNeedsRedraw = true;
  } else removalFeedback.delete(species);
  populationFeedbackUntil.delete(species);
  inspector.hidden = true;
  updateStructuralUi();
  render();
  interventionDialog.close('confirm');
}

function editDraft(edit: (value: SimulationParameters) => void): void {
  if (!parameterDraft || challengeIsLocked()) return;
  edit(parameterDraft.value);
  parameterDraftError = '';
  updateControlAvailability();
}
for (const definition of parameterDefinitions) {
  const input = element<HTMLInputElement>(`#param-${definition.key}`);
  input.addEventListener('input', () => editDraft((draft) => {
    if (!parameterGroupActive(definition.group, draft.foodChainDepth)) return;
    draft[definition.key] = Number(input.value);
    element<HTMLOutputElement>(`#output-${definition.key}`).value = formatParameter(definition, draft[definition.key]);
    input.setAttribute('aria-valuetext', formatParameter(definition, draft[definition.key]));
  }));
}
depthSelect.addEventListener('change', () => {
  if (appMode === 'apex') return;
  editDraft((draft) => { draft.foodChainDepth = Number(depthSelect.value) as FoodChainDepth; });
  updateAllControls();
});
transferControl.addEventListener('input', () => editDraft((draft) => {
  draft.transferEfficiency = Number(transferControl.value);
  element<HTMLOutputElement>('#transfer-output').value = `${Math.round(draft.transferEfficiency * 100)}%`;
  transferControl.setAttribute('aria-valuetext', `${Math.round(draft.transferEfficiency * 100)}%`);
}));
seedInput.addEventListener('input', () => {
  if (appMode !== 'apex') editDraft((draft) => { draft.seed = seedInput.value; });
});
toroidalToggle.addEventListener('change', () => editDraft((draft) => { draft.toroidal = toroidalToggle.checked; }));
element('#random-seed').addEventListener('click', () => {
  if (appMode === 'apex') return;
  editDraft((draft) => { draft.seed = createFreeExplorationSeed(); }); updateAllControls();
});
element('#restore-defaults').addEventListener('click', () => {
  editDraft((draft) => Object.assign(draft, appMode === 'apex' ? apexParameters({ ...DEFAULT_PARAMETERS }) : initialFreeParameters)); updateAllControls();
});
function applyParameterDraft(): void {
  if (!parameterDraft) return;
  const result = parameterDraft.prepare(parameters, appMode, apexSession.getState().phase);
  if (parameterIntent === 'edit-and-start-challenge' && appMode === 'apex' && apexSession.getState().phase === 'over'
    && (result.status === 'apply' || result.status === 'unchanged')) {
    // The canonical start owns the single initialization and completed-result reset.
    beginApexChallenge(result.status === 'apply' ? result.parameters : parameters);
    return;
  }
  if (result.status !== 'apply') {
    parameterDraftError = result.status === 'invalid' ? result.message ?? '설정을 확인하세요.' : result.status === 'locked' ? '도전 진행 중에는 설정을 변경할 수 없습니다.' : '';
    updateControlAvailability(); return;
  }
  parameters = { ...result.parameters };
  if (appMode === 'apex') apexDesignParameters = { ...parameters }; else freeParameters = { ...parameters };
  if (result.preserveResult) renderChallengePanel();
  else {
    if (appMode === 'apex') { apexSession.returnToSetup(); challengeMessage = ''; }
    resetSimulation();
  }
  parametersDialog.close();
}
applyParametersButton.addEventListener('click', applyParameterDraft);
element('#cancel-parameters').addEventListener('click', () => parametersDialog.close());

document.querySelectorAll<HTMLButtonElement>('[data-pyramid-mode]').forEach((button) => button.addEventListener('click', () => {
  pyramidMode = button.dataset.pyramidMode as PyramidMode;
  document.querySelectorAll<HTMLButtonElement>('[data-pyramid-mode]').forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
  renderPyramid(simulation.getSnapshot());
}));

document.querySelectorAll<HTMLButtonElement>('[data-introduce]').forEach((button) => button.addEventListener('click', () => openInterventionDialog('introduce', button.dataset.introduce as Species, button)));
element('#open-introduction').addEventListener('click', (event) => openInterventionDialog('introduce', 'rabbit', event.currentTarget as HTMLElement));
element('#open-removal').addEventListener('click', (event) => {
  const species = simulation.getActiveSpecies().find((item) => (simulation.getSnapshot().agents[item]?.length ?? 0) > 0) ?? 'rabbit';
  openInterventionDialog('remove', species, event.currentTarget as HTMLElement);
});
element('#intervention-species').addEventListener('change', resetInterventionAmount);
element('#removal-amount').addEventListener('input', updateInterventionDialog);
element('#removal-range').addEventListener('input', () => {
  element<HTMLInputElement>('#removal-amount').value = element<HTMLInputElement>('#removal-range').value;
  updateInterventionDialog();
});
for (const [id, delta] of [['decrease-removal', -1], ['increase-removal', 1]] as const) {
  element(`#${id}`).addEventListener('click', () => {
    const input = element<HTMLInputElement>('#removal-amount');
    input.value = String(input.valueAsNumber + delta);
    updateInterventionDialog();
  });
}
document.querySelectorAll<HTMLButtonElement>('[data-removal-fraction]').forEach(button => button.addEventListener('click', () => {
  const species = element<HTMLSelectElement>('#intervention-species').value as Species;
  element<HTMLInputElement>('#removal-amount').value = String(removalPresetAmount((simulation.getSnapshot().agents[species]?.length ?? 0), Number(button.dataset.removalFraction)));
  updateInterventionDialog();
}));
element('#introduction-amount').addEventListener('input', updateInterventionDialog);
for (const [id, delta] of [['decrease-introduction', -1], ['increase-introduction', 1]] as const) {
  element(`#${id}`).addEventListener('click', () => {
    const input = element<HTMLInputElement>('#introduction-amount');
    input.value = String(input.valueAsNumber + delta);
    updateInterventionDialog();
  });
}
element('#cancel-intervention').addEventListener('click', () => interventionDialog.close());
element('#intervention-form').addEventListener('submit', confirmIntervention);

document.querySelectorAll<HTMLButtonElement>('[data-app-mode]').forEach((button) => button.addEventListener('click', () => switchMode(button.dataset.appMode as AppMode)));

function handleChallengeAction(event: MouseEvent): void {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-challenge-action]');
  if (!button) return;
  const action = button.dataset.challengeAction;
  if (action === 'start') beginApexChallenge();
  if (action === 'edit-and-start' && apexSession.getState().phase === 'over') {
    toggleParameters(true, 'edit-and-start-challenge', button);
  }
  if (action === 'retry' && apexSession.getState().phase === 'over') {
    const snapshot = apexSession.getState().parameterSnapshot;
    if (snapshot) beginApexChallenge({ ...snapshot });
  }
  if (action === 'abort') {
    const confirmed = window.confirm('현재 도전을 중단하시겠습니까? 이 기록은 Personal Best에 저장되지 않습니다.');
    if (confirmed) returnToApexSetup(parameters);
  }
}
challengePanel.addEventListener('click', handleChallengeAction);

function openLeaderboard(opener: HTMLElement, board: BoardGroup = activeLeaderboardBoard): void {
  if (appMode !== 'apex') return;
  selectLeaderboardBoard(board);
  dialogs.open(leaderboardDialog, opener, element('#close-leaderboard', leaderboardDialog));
}
element('#close-leaderboard', leaderboardDialog).addEventListener('click', () => leaderboardDialog.close());
challengePanel.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-open-ranking]');
  if (button) openLeaderboard(button);
});
leaderboardRefreshButton.addEventListener('click', () => { void refreshLeaderboard(); });
function selectLeaderboardBoard(board: BoardGroup): void {
  activeLeaderboardBoard = board;
  renderLeaderboardPanel();
}
function bindLeaderboardTab(tab: HTMLButtonElement, board: BoardGroup, surface: 'detail' | 'summary'): void {
  tab.addEventListener('click', () => selectLeaderboardBoard(board));
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const index = BOARD_GROUPS.indexOf(board);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? BOARD_GROUPS.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + BOARD_GROUPS.length) % BOARD_GROUPS.length;
    const selected = BOARD_GROUPS[next]!;
    selectLeaderboardBoard(selected);
    (surface === 'detail' ? leaderboardTabs[selected] : element(`#summary-tab-${selected}`)).focus();
  });
}
for (const board of BOARD_GROUPS) bindLeaderboardTab(leaderboardTabs[board], board, 'detail');
// Native maxlength counts UTF-16 units. Validate code points to match PostgreSQL's 80-character limit.
leaderboardSchoolInput.addEventListener('input', () => {
  const school = leaderboardSchoolInput.value.replace(/\s+/gu, ' ').trim();
  leaderboardSchoolInput.setCustomValidity([...school].length > 80 ? '학교명은 80자 이내로 입력해 주세요.' : '');
});
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

function toggleParameters(force?: boolean, intent: ParameterIntent = 'edit', opener: HTMLElement = parameterToggle): void {
  if (force === false) { if (parametersDialog.open) parametersDialog.close(); return; }
  if (parametersDialog.open || leaderboardDialog.open || interventionDialog.open) return;
  parameterIntent = intent;
  parameterDraft = new ParameterDraft(parameters);
  parameterDraftError = '';
  updateAllControls();
  if (dialogs.open(parametersDialog, opener, element('.close-parameters'))) {
    parameterToggle.setAttribute('aria-expanded', 'true');
    element('.parameter-scroll').scrollTop = 0;
    element('.parameter-workspace').scrollTop = 0;
  } else clearParameterDraft();
}
parameterToggle.addEventListener('click', () => toggleParameters());
element('.close-parameters').addEventListener('click', () => parametersDialog.close());
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
  // Presentation clocks never advance logical steps or alter simulation data.
  for (const [species, until] of populationFeedbackUntil) {
    if (time < until) continue;
    populationFeedbackUntil.delete(species);
    document.querySelector(`[data-population="${species}"] em`)?.classList.remove('is-changing');
  }
  if (removalNeedsRedraw) {
    drawBoard(simulation.getSnapshot(), time);
    drawChart(time);
    const effects = [...removalFeedback.values()];
    if (effects.some((feedback) => time - feedback.startedAt >= REMOVAL_FEEDBACK_MS && document.querySelector(`[data-population="${feedback.species}"]`)?.classList.contains('is-removal-feedback'))) {
      renderPopulationStrip(simulation.getSnapshot());
    }
    removalNeedsRedraw = effects.some((feedback) => time - feedback.startedAt < REMOVAL_MARKER_MS);
  }
  if (time - bestEmphasisStartedAt >= PERSONAL_BEST_FEEDBACK_MS) challengePanel.classList.remove('best-emphasis');
  requestAnimationFrame(animationLoop);
}

const storedParticipant = readStoredParticipant();
if (storedParticipant) {
  leaderboardSchoolInput.value = storedParticipant.schoolName;
  leaderboardNumberInput.value = storedParticipant.studentNumber;
  leaderboardNameInput.value = storedParticipant.studentName;
}

updateStructuralUi();
render();
void refreshLeaderboard();
requestAnimationFrame(animationLoop);
