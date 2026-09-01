import './style.css';
import { drawPopulationChart } from './charts.ts';
import {
  DEFAULT_PARAMETERS,
  ForestSimulation,
  validateParameters,
  type Agent,
  type SimulationParameters,
  type SimulationSnapshot,
} from './model.ts';

type NumericParameterKey = Exclude<keyof SimulationParameters, 'toroidal' | 'seed'>;
type ParameterGroup = 'start' | 'forest' | 'rabbit' | 'wolf';

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
  { key: 'initialRabbits', label: '초기 토끼 수', description: '실험을 시작할 때 배치할 토끼 수', min: 0, max: 400, step: 4, group: 'start', format: 'integer', suffix: '마리' },
  { key: 'initialWolves', label: '초기 늑대 수', description: '실험을 시작할 때 배치할 늑대 수', min: 0, max: 160, step: 2, group: 'start', format: 'integer', suffix: '마리' },
  { key: 'initialForestDensity', label: '초기 숲 밀도', description: '처음 격자에 자란 숲의 평균 정도', min: 0, max: 100, step: 2, group: 'start', format: 'integer', suffix: '%' },
  { key: 'forestRegrowth', label: '숲 재생 속도', description: '각 칸의 숲 단계가 한 단계 회복될 확률', min: 0, max: 0.25, step: 0.005, group: 'forest', format: 'percent' },
  { key: 'forestMaxStage', label: '숲 최대 밀도', description: '각 칸이 도달할 수 있는 최고 성장 단계', min: 1, max: 4, step: 1, group: 'forest', format: 'integer', suffix: '단계' },
  { key: 'rabbitMoveProbability', label: '이동 확률', description: '토끼가 숲이 많은 이웃 칸으로 움직일 확률', min: 0, max: 1, step: 0.02, group: 'rabbit', format: 'percent' },
  { key: 'rabbitMoveDistance', label: '이동 거리', description: '한 step에 살펴볼 수 있는 최대 칸 수', min: 1, max: 3, step: 1, group: 'rabbit', format: 'integer', suffix: '칸' },
  { key: 'rabbitBreedProbability', label: '번식 확률', description: '에너지 조건을 만족한 토끼가 번식할 확률', min: 0, max: 0.8, step: 0.01, group: 'rabbit', format: 'percent' },
  { key: 'rabbitBreedEnergy', label: '번식 최소 에너지', description: '이 값 이상일 때만 번식을 시도합니다.', min: 2, max: 80, step: 1, group: 'rabbit', format: 'integer' },
  { key: 'rabbitEnergyCost', label: 'step당 에너지 소모', description: '살아 있고 움직이는 데 필요한 에너지', min: 0.1, max: 8, step: 0.05, group: 'rabbit', format: 'decimal' },
  { key: 'rabbitFoodEnergy', label: '숲 섭취 에너지', description: '숲 한 단계를 먹었을 때 얻는 에너지', min: 0.5, max: 25, step: 0.5, group: 'rabbit', format: 'decimal' },
  { key: 'rabbitMaxAge', label: '최대 수명', description: '이 나이에 도달하면 자연사합니다.', min: 10, max: 240, step: 5, group: 'rabbit', format: 'integer', suffix: 'step' },
  { key: 'wolfMoveProbability', label: '이동 확률', description: '주변에 토끼가 없을 때 이동할 확률', min: 0, max: 1, step: 0.02, group: 'wolf', format: 'percent' },
  { key: 'wolfMoveDistance', label: '탐색·이동 거리', description: '한 step에 토끼를 찾을 수 있는 최대 범위', min: 1, max: 4, step: 1, group: 'wolf', format: 'integer', suffix: '칸' },
  { key: 'wolfBreedProbability', label: '번식 확률', description: '에너지 조건을 만족한 늑대가 번식할 확률', min: 0, max: 0.6, step: 0.01, group: 'wolf', format: 'percent' },
  { key: 'wolfBreedEnergy', label: '번식 최소 에너지', description: '이 값 이상일 때만 번식을 시도합니다.', min: 4, max: 120, step: 1, group: 'wolf', format: 'integer' },
  { key: 'wolfEnergyCost', label: 'step당 에너지 소모', description: '사냥하지 못해도 매 step 줄어드는 에너지', min: 0.1, max: 10, step: 0.05, group: 'wolf', format: 'decimal' },
  { key: 'wolfFoodEnergy', label: '토끼 섭취 에너지', description: '토끼 한 마리를 사냥했을 때 얻는 에너지', min: 1, max: 50, step: 1, group: 'wolf', format: 'integer' },
  { key: 'wolfMaxAge', label: '최대 수명', description: '이 나이에 도달하면 자연사합니다.', min: 10, max: 300, step: 5, group: 'wolf', format: 'integer', suffix: 'step' },
];

const groupInfo: Record<ParameterGroup, { title: string; subtitle: string; icon: string }> = {
  start: { title: '시작 조건', subtitle: '격자와 초기 분포', icon: '◎' },
  forest: { title: '숲', subtitle: '성장과 최대 밀도', icon: '♣' },
  rabbit: { title: '토끼', subtitle: '이동·먹이·번식·사망', icon: '♙' },
  wolf: { title: '늑대', subtitle: '탐색·사냥·번식·사망', icon: '◆' },
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
  return `
    <details class="parameter-group" ${open ? 'open' : ''}>
      <summary><span class="group-icon ${group}">${info.icon}</span><span><b>${info.title}</b><small>${info.subtitle}</small></span><i>⌄</i></summary>
      <div class="parameter-group-content">${parameterMarkup(group)}</div>
    </details>`;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('앱을 표시할 요소를 찾을 수 없습니다.');

app.innerHTML = `
  <div class="app-shell" id="app-shell">
    <header class="topbar">
      <div class="brand-mark" aria-hidden="true"><span></span></div>
      <div class="brand-copy">
        <p class="eyebrow">통합과학 2 · 생태계 상호작용</p>
        <h1>Rabbits <span>&</span> Wolves</h1>
        <p>Forest population lab</p>
      </div>
      <div class="food-chain" aria-label="먹이 관계"><span>숲</span><i>→</i><span>토끼</span><i>→</i><span>늑대</span></div>
      <div class="lesson-chip"><b>탐구 01</b><span>먹이 관계와 개체군 변화</span></div>
    </header>

    <div class="lab-layout">
      <aside class="parameter-panel" id="parameter-panel" aria-label="시뮬레이션 파라미터">
        <div class="panel-title-row">
          <div><p class="section-kicker">EXPERIMENT SETUP</p><h2>실험 조건</h2></div>
          <button type="button" class="icon-button close-parameters" aria-label="실험 조건 닫기">×</button>
        </div>
        <div class="parameter-scroll">
          ${parameterGroupMarkup('start', true)}
          <section class="special-controls">
            <label class="seed-control" for="seed-input"><span><b>Random seed</b><small>같은 seed는 같은 시작 장면을 만듭니다.</small></span></label>
            <div class="seed-input-row"><input id="seed-input" maxlength="40" value="${DEFAULT_PARAMETERS.seed}" /><button type="button" id="random-seed" aria-label="새 랜덤 시드 만들기">↻</button></div>
            <label class="toggle-control" for="toroidal-toggle"><span><b>토로이드 경계</b><small>가장자리가 반대쪽과 연결됩니다.</small></span><input id="toroidal-toggle" type="checkbox" checked /><i></i></label>
          </section>
          ${parameterGroupMarkup('forest', true)}
          ${parameterGroupMarkup('rabbit', false)}
          ${parameterGroupMarkup('wolf', false)}
          <button type="button" class="restore-button" id="restore-defaults">기본 설정으로 복원</button>
        </div>
      </aside>

      <main class="workspace">
        <nav class="sim-toolbar" aria-label="시뮬레이션 조작">
          <div class="run-controls">
            <button class="run-button" id="run-button" type="button"><span>▶</span><b>Run</b></button>
            <button id="pause-button" type="button" disabled><span>Ⅱ</span><b>Pause</b></button>
            <button id="step-button" type="button"><span>↦</span><b>Step</b></button>
            <button id="reset-button" type="button"><span>↺</span><b>Reset</b></button>
          </div>
          <div class="toolbar-middle">
            <label for="speed-control"><span>속도</span><input id="speed-control" type="range" min="1" max="24" value="8" /><output id="speed-output">8 step/s</output></label>
          </div>
          <div class="view-controls">
            <button type="button" id="toggle-parameters" aria-pressed="true"><span>☷</span><b>Parameters</b></button>
            <button type="button" id="toggle-graph" aria-pressed="true"><span>⌁</span><b>Graph</b></button>
            <div class="step-readout"><span>STEP</span><strong id="step-value">000</strong></div>
          </div>
        </nav>

        <section class="simulation-grid">
          <section class="board-card" aria-labelledby="forest-heading">
            <div class="board-heading">
              <div><p class="section-kicker">LIVE ECOSYSTEM</p><h2 id="forest-heading">숲 생태계</h2></div>
              <div class="legend" aria-label="시뮬레이션 범례">
                <span><i class="forest-key"></i>숲 밀도</span>
                <span><canvas data-mini-icon="rabbit-a" width="28" height="28"></canvas>토끼</span>
                <span><canvas data-mini-icon="wolf-a" width="28" height="28"></canvas>늑대</span>
              </div>
            </div>
            <div class="canvas-frame">
              <canvas id="forest-board" tabindex="0" aria-label="격자형 숲 생태계. 칸을 선택하면 상태를 확인할 수 있습니다."></canvas>
              <div class="board-status" id="board-status"><span></span><b>준비됨</b></div>
              <div class="cell-inspector" id="cell-inspector" hidden></div>
            </div>
            <div class="board-footnote">
              <span>칸을 클릭하거나 터치해 숲 단계와 개체 에너지를 확인하세요.</span>
              <span><b>공간 규칙</b> 숲과 동물은 함께 존재 · 동물은 한 칸에 한 마리</span>
            </div>
          </section>

          <aside class="monitor-panel" id="monitor-panel" aria-label="개체군 그래프와 통계">
            <section class="population-cards">
              <article class="population-card rabbit-card"><span class="card-icon"><canvas data-mini-icon="rabbit-a" width="44" height="44"></canvas></span><div><small>RABBITS</small><strong id="rabbit-count">0</strong><span id="rabbit-trend">초기 상태</span></div></article>
              <article class="population-card wolf-card"><span class="card-icon"><canvas data-mini-icon="wolf-a" width="44" height="44"></canvas></span><div><small>WOLVES</small><strong id="wolf-count">0</strong><span id="wolf-trend">초기 상태</span></div></article>
              <article class="population-card forest-card"><span class="forest-symbol">♣</span><div><small>FOREST</small><strong id="forest-count">0%</strong><span id="forest-trend">평균 밀도</span></div></article>
            </section>

            <section class="graph-card" id="graph-card">
              <div class="card-heading"><div><p class="section-kicker">POPULATION GRAPH</p><h2>개체군 변화</h2></div><span class="live-pill"><i></i> LIVE</span></div>
              <div class="graph-legend"><span class="rabbit-line">토끼</span><span class="wolf-line">늑대</span><span class="forest-line">숲 %</span></div>
              <canvas id="population-chart" aria-label="시간에 따른 토끼, 늑대, 숲의 변화 그래프"></canvas>
              <p class="axis-note"><span>왼쪽 축: 개체 수</span><span>오른쪽 축: 숲 밀도</span></p>
            </section>

            <section class="insight-card" aria-live="polite">
              <span class="insight-icon">!</span><div><small>지금 관찰할 점</small><p id="dynamic-insight">Run을 눌러 개체군 사이의 시간 차이를 관찰해 보세요.</p></div>
            </section>
          </aside>
        </section>

        <section class="lower-grid">
          <section class="statistics-card">
            <div class="card-heading"><div><p class="section-kicker">CUMULATIVE RECORD</p><h2>누적 통계</h2></div><span>현재 실험</span></div>
            <div class="stat-grid">
              <div><span>새로 태어난 토끼</span><strong id="rabbit-births">0</strong></div>
              <div><span>새로 태어난 늑대</span><strong id="wolf-births">0</strong></div>
              <div><span>전체 사망</span><strong id="total-deaths">0</strong></div>
              <div><span>늑대가 사냥한 토끼</span><strong id="rabbits-hunted">0</strong></div>
              <div><span>토끼가 먹은 숲량</span><strong id="forest-eaten">0</strong></div>
            </div>
          </section>

          <section class="learning-card">
            <div class="card-heading"><div><p class="section-kicker">THINK LIKE A SCIENTIST</p><h2>관찰 포인트</h2></div><span class="model-badge">확률적 모형</span></div>
            <ul>
              <li><b>숲이 줄면</b> 토끼가 얻는 에너지가 줄어 개체수가 감소할 수 있습니다.</li>
              <li><b>토끼가 줄어든 뒤</b> 늑대도 먹이 부족으로 감소하는 시간 지연이 나타납니다.</li>
              <li><b>숲이 회복되면</b> 토끼가 다시 늘어날 조건이 만들어집니다.</li>
              <li>같은 조건도 seed가 다르면 확률적 이동과 번식 때문에 결과가 달라집니다.</li>
            </ul>
            <p class="model-limit"><b>모형의 한계</b> 실제 생태계의 계절, 질병, 다른 먹이와 포식자, 유전적 차이는 생략했습니다.</p>
          </section>
        </section>

        <details class="rule-card">
          <summary><span><b>이 모델은 한 step을 어떻게 계산할까요?</b><small>행동 순서와 공간 규칙 보기</small></span><i>⌄</i></summary>
          <div class="rule-content">
            <ol><li><b>숲 성장</b><span>확률에 따라 한 단계 회복</span></li><li><b>토끼 이동</b><span>숲이 많은 빈 칸을 선호</span></li><li><b>토끼 먹이·번식·사망</b><span>숲 섭취 후 에너지 판정</span></li><li><b>늑대 이동·사냥</b><span>탐색 범위의 토끼를 우선</span></li><li><b>늑대 번식·사망</b><span>에너지와 수명 판정</span></li></ol>
            <p>숲은 칸의 바탕 상태이므로 토끼 또는 늑대와 같은 칸에 함께 있을 수 있습니다. 동물끼리는 한 칸에 한 마리만 존재하며, 늑대가 토끼 칸으로 이동하면 토끼는 먹히고 늑대가 그 칸을 차지합니다.</p>
          </div>
        </details>

        <details class="icon-review">
          <summary><span><b>아이콘 가독성 검토</b><small>토끼 2안 · 늑대 2안 비교 결과</small></span><i>⌄</i></summary>
          <div class="icon-review-content">
            <div class="review-copy"><p>16–24px 크기에서 형태를 비교했습니다. <b>토끼 A</b>는 긴 귀와 둥근 몸, <b>늑대 A</b>는 긴 몸·뾰족한 귀·꼬리가 보여 서로 가장 멀리 떨어진 실루엣을 만듭니다.</p><span>보드에는 A + A 조합을 적용했습니다.</span></div>
            <div class="icon-options">
              <article class="selected"><span>토끼 A · 적용</span><canvas data-icon="rabbit-a" width="72" height="72"></canvas><b>긴 귀 + 둥근 몸</b></article>
              <article><span>토끼 B</span><canvas data-icon="rabbit-b" width="72" height="72"></canvas><b>정면 얼굴형</b></article>
              <article class="selected"><span>늑대 A · 적용</span><canvas data-icon="wolf-a" width="72" height="72"></canvas><b>긴 몸 + 꼬리</b></article>
              <article><span>늑대 B</span><canvas data-icon="wolf-b" width="72" height="72"></canvas><b>방패형 얼굴</b></article>
            </div>
          </div>
        </details>
      </main>
    </div>
  </div>
`;

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
const inspector = element<HTMLDivElement>('#cell-inspector');

let parameters: SimulationParameters = { ...DEFAULT_PARAMETERS };
let simulation = new ForestSimulation(parameters);
let running = false;
let lastAnimationTime = performance.now();
let accumulatedTime = 0;
let resetTimer = 0;

function drawRabbitA(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, simple = false): void {
  ctx.save(); ctx.translate(x, y); ctx.lineWidth = Math.max(1.35, size * 0.075); ctx.strokeStyle = '#2b211a'; ctx.fillStyle = '#f2a34a'; ctx.lineJoin = 'round';
  if (simple) {
    ctx.beginPath(); ctx.moveTo(-size * 0.13, -size * 0.08); ctx.lineTo(-size * 0.17, -size * 0.48); ctx.moveTo(size * 0.08, -size * 0.08); ctx.lineTo(size * 0.12, -size * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, size * 0.12, size * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.ellipse(-size * 0.13, -size * 0.29, size * 0.085, size * 0.27, -0.18, 0, Math.PI * 2); ctx.ellipse(size * 0.075, -size * 0.31, size * 0.085, size * 0.29, 0.12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, size * 0.13, size * 0.31, size * 0.27, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff5d8'; ctx.beginPath(); ctx.arc(size * 0.24, size * 0.13, size * 0.085, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#151515'; ctx.beginPath(); ctx.arc(size * 0.09, size * 0.035, Math.max(1.1, size * 0.034), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawRabbitB(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save(); ctx.translate(x, y); ctx.lineWidth = Math.max(1.35, size * 0.075); ctx.strokeStyle = '#2b211a'; ctx.fillStyle = '#d9873e'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-size * 0.26, -size * 0.02); ctx.lineTo(-size * 0.2, -size * 0.45); ctx.quadraticCurveTo(-size * 0.08, -size * 0.5, -size * 0.05, -size * 0.12); ctx.lineTo(size * 0.05, -size * 0.12); ctx.quadraticCurveTo(size * 0.1, -size * 0.5, size * 0.22, -size * 0.43); ctx.lineTo(size * 0.26, -size * 0.02); ctx.arc(0, size * 0.08, size * 0.29, -0.15, Math.PI + 0.15, false); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#151515'; ctx.beginPath(); ctx.arc(-size * 0.1, size * 0.03, size * 0.035, 0, Math.PI * 2); ctx.arc(size * 0.1, size * 0.03, size * 0.035, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

function drawWolfA(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, simple = false): void {
  ctx.save(); ctx.translate(x, y); ctx.lineWidth = Math.max(1.35, size * 0.072); ctx.strokeStyle = '#101d2b'; ctx.fillStyle = '#5b718b'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-size * 0.47, size * 0.11); ctx.lineTo(-size * 0.29, -size * 0.05); ctx.lineTo(-size * 0.19, -size * 0.27); ctx.lineTo(-size * 0.03, -size * 0.13); ctx.lineTo(size * 0.18, -size * 0.1); ctx.lineTo(size * 0.3, -size * 0.32); ctx.lineTo(size * 0.41, -size * 0.12); ctx.lineTo(size * 0.49, -size * 0.03); ctx.lineTo(size * 0.3, size * 0.08); ctx.lineTo(size * 0.22, size * 0.3); ctx.lineTo(size * 0.08, size * 0.3); ctx.lineTo(size * 0.03, size * 0.1); ctx.lineTo(-size * 0.18, size * 0.12); ctx.lineTo(-size * 0.25, size * 0.31); ctx.lineTo(-size * 0.38, size * 0.31); ctx.lineTo(-size * 0.38, size * 0.13); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (!simple) { ctx.fillStyle = '#edf3f5'; ctx.beginPath(); ctx.moveTo(size * 0.3, -size * 0.04); ctx.lineTo(size * 0.46, -size * 0.02); ctx.lineTo(size * 0.32, size * 0.05); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#0c1722'; ctx.beginPath(); ctx.arc(size * 0.28, -size * 0.1, size * 0.036, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function drawWolfB(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save(); ctx.translate(x, y); ctx.lineWidth = Math.max(1.35, size * 0.075); ctx.strokeStyle = '#101d2b'; ctx.fillStyle = '#465a70'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-size * 0.36, -size * 0.38); ctx.lineTo(-size * 0.12, -size * 0.24); ctx.lineTo(0, -size * 0.33); ctx.lineTo(size * 0.13, -size * 0.24); ctx.lineTo(size * 0.37, -size * 0.38); ctx.lineTo(size * 0.3, size * 0.06); ctx.lineTo(size * 0.12, size * 0.35); ctx.lineTo(0, size * 0.45); ctx.lineTo(-size * 0.13, size * 0.35); ctx.lineTo(-size * 0.31, size * 0.06); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#edf3f5'; ctx.beginPath(); ctx.moveTo(-size * 0.2, size * 0.03); ctx.lineTo(0, size * 0.32); ctx.lineTo(size * 0.2, size * 0.03); ctx.lineTo(0, size * 0.15); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#0c1722'; ctx.beginPath(); ctx.arc(-size * 0.12, -size * 0.02, size * 0.038, 0, Math.PI * 2); ctx.arc(size * 0.12, -size * 0.02, size * 0.038, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

function initializeIconCanvases(): void {
  document.querySelectorAll<HTMLCanvasElement>('[data-icon]').forEach((canvas) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#dce8d3'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#b7c8ad'; ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
    const kind = canvas.dataset.icon;
    if (kind === 'rabbit-a') drawRabbitA(ctx, 36, 38, 46);
    if (kind === 'rabbit-b') drawRabbitB(ctx, 36, 38, 46);
    if (kind === 'wolf-a') drawWolfA(ctx, 36, 38, 52);
    if (kind === 'wolf-b') drawWolfB(ctx, 36, 38, 48);
  });
  document.querySelectorAll<HTMLCanvasElement>('[data-mini-icon]').forEach((canvas) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (canvas.dataset.miniIcon === 'rabbit-a') drawRabbitA(ctx, canvas.width / 2, canvas.height * 0.57, canvas.width * 0.65);
    else drawWolfA(ctx, canvas.width / 2, canvas.height * 0.55, canvas.width * 0.76);
  });
}

function drawBoard(snapshot: SimulationSnapshot): void {
  const cellSize = 24;
  const logicalWidth = snapshot.width * cellSize;
  const logicalHeight = snapshot.height * cellSize;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  if (board.width !== logicalWidth * ratio || board.height !== logicalHeight * ratio) {
    board.width = logicalWidth * ratio;
    board.height = logicalHeight * ratio;
    board.style.aspectRatio = `${logicalWidth} / ${logicalHeight}`;
  }
  const ctx = board.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, logicalWidth, logicalHeight);
  const colors = ['#ad8a5b', '#c5d8a9', '#96bc75', '#5f9656', '#2f6b40'];
  for (let y = 0; y < snapshot.height; y += 1) {
    for (let x = 0; x < snapshot.width; x += 1) {
      const stage = snapshot.forest[y * snapshot.width + x];
      const colorIndex = Math.round((stage / snapshot.maxForestStage) * 4);
      ctx.fillStyle = colors[colorIndex];
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      ctx.strokeStyle = 'rgba(27, 55, 34, .15)';
      ctx.lineWidth = 0.7;
      ctx.strokeRect(x * cellSize + 0.35, y * cellSize + 0.35, cellSize - 0.7, cellSize - 0.7);
      if (stage >= snapshot.maxForestStage && (x + y) % 3 === 0) {
        ctx.fillStyle = 'rgba(231, 242, 196, .28)';
        ctx.beginPath(); ctx.arc(x * cellSize + 5, y * cellSize + 5, 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  const displayedCellSize = board.clientWidth > 0 ? board.clientWidth / snapshot.width : cellSize;
  const simple = displayedCellSize < 17;
  for (const rabbit of snapshot.rabbits) drawRabbitA(ctx, (rabbit.x + 0.5) * cellSize, (rabbit.y + 0.55) * cellSize, cellSize * 0.72, simple);
  for (const wolf of snapshot.wolves) drawWolfA(ctx, (wolf.x + 0.5) * cellSize, (wolf.y + 0.54) * cellSize, cellSize * 0.9, simple);
}

function trendText(current: number, previous: number, label: string): string {
  const difference = current - previous;
  if (Math.abs(difference) < 0.5) return `${label} 안정`;
  return `${difference > 0 ? '↑' : '↓'} ${Math.abs(difference).toFixed(0)} ${difference > 0 ? '증가' : '감소'}`;
}

function dynamicInsight(): string {
  const history = simulation.getHistory();
  const current = history.at(-1);
  const earlier = history[Math.max(0, history.length - 10)];
  if (!current || !earlier || current.step === 0) return 'Run을 눌러 개체군 사이의 시간 차이를 관찰해 보세요.';
  if (current.rabbits === 0 && current.wolves > 0) return '토끼가 사라졌습니다. 늑대의 에너지가 줄어드는지 이어서 관찰해 보세요.';
  if (current.wolves === 0 && current.rabbits > 0) return '늑대가 사라져 포식 압력이 없어졌습니다. 숲과 토끼의 변화를 비교해 보세요.';
  if (current.forestPercent < earlier.forestPercent - 4 && current.rabbits >= earlier.rabbits) return '토끼가 늘어나는 동안 숲 밀도가 낮아지고 있습니다. 먹이 소비의 결과입니다.';
  if (current.rabbits < earlier.rabbits * 0.85 && current.wolves >= earlier.wolves) return '토끼가 먼저 감소하고 있습니다. 늑대가 뒤이어 감소하는 시간 지연이 나타나는지 보세요.';
  if (current.wolves < earlier.wolves * 0.85 && current.rabbits <= earlier.rabbits) return '먹이가 줄어든 뒤 늑대도 감소하고 있습니다. 포식자의 반응이 늦게 나타났습니다.';
  if (current.forestPercent > earlier.forestPercent + 4 && current.rabbits <= earlier.rabbits) return '토끼 수가 줄어 숲이 회복되고 있습니다. 이후 토끼가 다시 늘 수 있습니다.';
  return '세 곡선의 최고점이 같은 시점에 나타나는지, 서로 어긋나는지 관찰해 보세요.';
}

function render(): void {
  const snapshot = simulation.getSnapshot();
  const history = simulation.getHistory();
  const metric = history.at(-1);
  const comparison = history[Math.max(0, history.length - 6)] ?? metric;
  drawBoard(snapshot);
  drawPopulationChart(chart, history);
  element('#step-value').textContent = String(snapshot.step).padStart(3, '0');
  element('#rabbit-count').textContent = String(snapshot.rabbits.length);
  element('#wolf-count').textContent = String(snapshot.wolves.length);
  element('#forest-count').textContent = `${Math.round(metric?.forestPercent ?? 0)}%`;
  element('#rabbit-trend').textContent = trendText(snapshot.rabbits.length, comparison?.rabbits ?? snapshot.rabbits.length, '개체군');
  element('#wolf-trend').textContent = trendText(snapshot.wolves.length, comparison?.wolves ?? snapshot.wolves.length, '개체군');
  element('#forest-trend').textContent = trendText(metric?.forestPercent ?? 0, comparison?.forestPercent ?? 0, '평균 밀도');
  element('#rabbit-births').textContent = String(snapshot.stats.rabbitBirths);
  element('#wolf-births').textContent = String(snapshot.stats.wolfBirths);
  element('#total-deaths').textContent = String(snapshot.stats.rabbitDeaths + snapshot.stats.wolfDeaths);
  element('#rabbits-hunted').textContent = String(snapshot.stats.rabbitsHunted);
  element('#forest-eaten').textContent = `${snapshot.stats.forestEaten} 단계`;
  element('#dynamic-insight').textContent = dynamicInsight();
}

function setRunning(nextRunning: boolean): void {
  running = nextRunning;
  runButton.disabled = running;
  pauseButton.disabled = !running;
  const status = element<HTMLDivElement>('#board-status');
  status.classList.toggle('is-running', running);
  status.querySelector('b')!.textContent = running ? '실행 중' : simulation.getSnapshot().step === 0 ? '준비됨' : '일시정지';
  lastAnimationTime = performance.now();
  accumulatedTime = 0;
}

function resetSimulation(): void {
  window.clearTimeout(resetTimer);
  setRunning(false);
  parameters = validateParameters(parameters);
  simulation = new ForestSimulation(parameters);
  inspector.hidden = true;
  render();
}

function scheduleReset(): void {
  setRunning(false);
  window.clearTimeout(resetTimer);
  resetTimer = window.setTimeout(resetSimulation, 100);
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
}

for (const definition of parameterDefinitions) {
  const input = element<HTMLInputElement>(`#param-${definition.key}`);
  input.addEventListener('input', () => {
    const value = Number(input.value);
    parameters = { ...parameters, [definition.key]: value };
    element<HTMLOutputElement>(`#output-${definition.key}`).value = formatParameter(definition, value);
    scheduleReset();
  });
}

seedInput.addEventListener('change', () => {
  parameters.seed = seedInput.value;
  resetSimulation();
});

toroidalToggle.addEventListener('change', () => {
  parameters.toroidal = toroidalToggle.checked;
  resetSimulation();
});

element<HTMLButtonElement>('#random-seed').addEventListener('click', () => {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  parameters.seed = `FOREST-${String(values[0] % 100000).padStart(5, '0')}`;
  updateAllControls();
  resetSimulation();
});

element<HTMLButtonElement>('#restore-defaults').addEventListener('click', () => {
  parameters = { ...DEFAULT_PARAMETERS };
  updateAllControls();
  resetSimulation();
});

runButton.addEventListener('click', () => setRunning(true));
pauseButton.addEventListener('click', () => setRunning(false));
stepButton.addEventListener('click', () => { setRunning(false); simulation.step(); render(); });
resetButton.addEventListener('click', resetSimulation);

speedControl.addEventListener('input', () => {
  speedOutput.value = `${speedControl.value} step/s`;
});

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
  const agent: Agent | undefined = [...snapshot.rabbits, ...snapshot.wolves].find((candidate) => candidate.x === x && candidate.y === y);
  const stage = snapshot.forest[y * snapshot.width + x];
  const animalText = agent ? `${agent.species === 'rabbit' ? '토끼' : '늑대'} · 에너지 ${agent.energy.toFixed(1)} · 나이 ${agent.age}` : '동물 없음';
  inspector.innerHTML = `<b>(${x + 1}, ${y + 1}) 칸</b><span>숲 ${stage} / ${snapshot.maxForestStage}단계</span><span>${animalText}</span>`;
  inspector.hidden = false;
  inspector.style.left = `${Math.min(76, Math.max(3, ((event.clientX - bounds.left) / bounds.width) * 100))}%`;
  inspector.style.top = `${Math.min(82, Math.max(4, ((event.clientY - bounds.top) / bounds.height) * 100))}%`;
});

board.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const snapshot = simulation.getSnapshot();
    const centerX = Math.floor(snapshot.width / 2);
    const centerY = Math.floor(snapshot.height / 2);
    const stage = snapshot.forest[centerY * snapshot.width + centerX];
    inspector.innerHTML = `<b>가운데 칸</b><span>숲 ${stage} / ${snapshot.maxForestStage}단계</span><span>포인터로 다른 칸도 살펴보세요.</span>`;
    inspector.style.left = '50%'; inspector.style.top = '50%'; inspector.hidden = false;
  }
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
      simulation.step();
      accumulatedTime -= interval;
      steps += 1;
    }
    if (steps > 0) render();
  }
  requestAnimationFrame(animationLoop);
}

if (window.matchMedia('(max-width: 980px)').matches) toggleParameters(false);
initializeIconCanvases();
updateAllControls();
render();
requestAnimationFrame(animationLoop);
