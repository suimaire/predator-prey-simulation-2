import './style.css';
import { describeState, trajectorySummary } from './analysis.ts';
import { drawPhaseChart, drawTimeChart } from './charts.ts';
import {
  DEFAULT_DURATION,
  DEFAULT_PARAMETERS,
  PARAMETER_LIMITS,
  clampParameter,
  nearestState,
  simulate,
  type ModelKind,
  type ModelParameters,
  type PopulationState,
} from './model.ts';

type ParameterKey = keyof ModelParameters;
type ChartView = 'time' | 'phase' | 'both';

interface ParameterDefinition {
  key: ParameterKey;
  symbol: string;
  label: string;
  help: string;
  unit: string;
  decimals: number;
}

interface PredictionScenario {
  id: string;
  title: string;
  question: string;
  options: Array<{ value: string; label: string }>;
  correct: string;
  apply: (base: ModelParameters) => ModelParameters;
  explain: (base: ModelParameters, changed: ModelParameters) => string;
}

const parameterDefinitions: ParameterDefinition[] = [
  { key: 'alpha', symbol: 'α', label: '피식자 자연 증가율', help: '포식자가 없을 때 피식자가 스스로 증가하는 정도', unit: '년⁻¹', decimals: 2 },
  { key: 'beta', symbol: 'β', label: '포식 계수', help: '만남과 포식으로 피식자가 감소하는 정도', unit: '(개체·년)⁻¹', decimals: 3 },
  { key: 'delta', symbol: 'δ', label: '포식자의 증가 계수', help: '먹은 피식자가 포식자 증가로 이어지는 정도', unit: '(개체·년)⁻¹', decimals: 3 },
  { key: 'gamma', symbol: 'γ', label: '포식자 자연 사망률', help: '피식자를 먹지 못할 때 포식자가 감소하는 정도', unit: '년⁻¹', decimals: 2 },
  { key: 'preyInitial', symbol: 'N₀', label: '초기 피식자 수', help: '0년 시점의 피식자 개체수', unit: '상대 개체수', decimals: 0 },
  { key: 'predatorInitial', symbol: 'P₀', label: '초기 포식자 수', help: '0년 시점의 포식자 개체수', unit: '상대 개체수', decimals: 0 },
  { key: 'carryingCapacity', symbol: 'K', label: '환경수용력', help: '확장 모형에서 환경이 지탱할 수 있는 피식자 수', unit: '상대 개체수', decimals: 0 },
];

const predictionScenarios: PredictionScenario[] = [
  {
    id: 'alpha-up',
    title: 'α를 25% 높이기',
    question: '피식자의 자연 증가율 α를 25% 높이면, 포식자가 진동하는 중심 수준 P* = α/β는 어떻게 될까?',
    options: [
      { value: 'increase', label: '증가한다' },
      { value: 'decrease', label: '감소한다' },
      { value: 'same', label: '변하지 않는다' },
    ],
    correct: 'increase',
    apply: (base) => ({ ...base, alpha: clampParameter('alpha', base.alpha * 1.25) }),
    explain: (base, changed) => `포식자 공존 평형 P*가 ${(base.alpha / base.beta).toFixed(1)}에서 ${(changed.alpha / changed.beta).toFixed(1)}로 변합니다.`,
  },
  {
    id: 'gamma-up',
    title: 'γ를 25% 높이기',
    question: '포식자 자연 사망률 γ를 25% 높이면, 피식자가 진동하는 중심 수준 N* = γ/δ는 어떻게 될까?',
    options: [
      { value: 'increase', label: '증가한다' },
      { value: 'decrease', label: '감소한다' },
      { value: 'same', label: '변하지 않는다' },
    ],
    correct: 'increase',
    apply: (base) => ({ ...base, gamma: clampParameter('gamma', base.gamma * 1.25) }),
    explain: (base, changed) => `피식자 공존 평형 N*가 ${(base.gamma / base.delta).toFixed(1)}에서 ${(changed.gamma / changed.delta).toFixed(1)}로 변합니다.`,
  },
  {
    id: 'double-prey',
    title: 'N₀를 두 배로 만들기',
    question: '기본 모형에서 초기 피식자 수 N₀만 두 배로 바꾸면 장기 궤적은 어떻게 될까?',
    options: [
      { value: 'same-orbit', label: '원래 궤도로 되돌아온다' },
      { value: 'new-orbit', label: '다른 닫힌 궤적을 따른다' },
      { value: 'damped', label: '진동이 점차 사라진다' },
    ],
    correct: 'new-orbit',
    apply: (base) => ({ ...base, preyInitial: clampParameter('preyInitial', base.preyInitial * 2) }),
    explain: (base, changed) => `N₀가 ${base.preyInitial.toFixed(0)}에서 ${changed.preyInitial.toFixed(0)}로 바뀌어, 같은 평형점 주위의 다른 궤적에서 진동합니다. 기본 모형에는 원래 궤도로 끌어당기는 감쇠가 없습니다.`,
  },
];

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('앱을 표시할 요소를 찾을 수 없습니다.');

const parameterMarkup = parameterDefinitions.map((definition) => {
  const limit = PARAMETER_LIMITS[definition.key];
  const isCarryingCapacity = definition.key === 'carryingCapacity';
  return `
    <div class="parameter-control${isCarryingCapacity ? ' carrying-capacity-control' : ''}" data-parameter-row="${definition.key}">
      <div class="parameter-heading">
        <label for="range-${definition.key}">
          <span class="parameter-symbol">${definition.symbol}</span>
          <span>${definition.label}</span>
        </label>
        <output id="output-${definition.key}" for="range-${definition.key} number-${definition.key}"></output>
      </div>
      <p>${definition.help}</p>
      <div class="parameter-inputs">
        <input
          id="range-${definition.key}"
          data-range-param="${definition.key}"
          type="range"
          min="${limit.min}"
          max="${limit.max}"
          step="${limit.step}"
        />
        <input
          id="number-${definition.key}"
          data-number-param="${definition.key}"
          type="number"
          inputmode="decimal"
          min="${limit.min}"
          max="${limit.max}"
          step="${limit.step}"
          aria-label="${definition.label} 숫자 입력"
        />
        <span class="parameter-unit">${definition.unit}</span>
      </div>
    </div>`;
}).join('');

app.innerHTML = `
  <header class="app-header">
    <div>
      <p class="eyebrow">INTERACTIVE ECOLOGY LAB</p>
      <h1>포식자-피식자 동역학 실험실</h1>
      <p class="header-description">피식자의 변화가 먼저, 포식자의 반응이 뒤따르는 이유를 직접 조작하며 확인해 보세요.</p>
    </div>
    <div class="model-switch" role="group" aria-label="수학 모형 선택">
      <button type="button" class="model-button is-active" data-model="basic" aria-pressed="true">Basic model</button>
      <button type="button" class="model-button" data-model="logistic" aria-pressed="false">More realistic model</button>
    </div>
  </header>

  <main class="app-layout">
    <aside class="control-panel" aria-label="변수 조절 패널">
      <div class="panel-heading">
        <div>
          <p class="section-kicker">VARIABLES</p>
          <h2>조건 설정</h2>
        </div>
        <button type="button" class="text-button" id="restore-defaults">기본값으로 돌아가기</button>
      </div>
      <div class="parameter-list">${parameterMarkup}</div>

      <section class="formula-card" aria-labelledby="formula-heading">
        <div class="formula-card-heading">
          <h3 id="formula-heading">사용 중인 방정식</h3>
          <span id="model-badge">표준 모형</span>
        </div>
        <div class="formula" id="prey-equation">dN/dt = αN − βNP</div>
        <div class="formula">dP/dt = δNP − γP</div>
        <p id="formula-note">피식자의 먹이가 제한되지 않는다고 가정합니다.</p>
      </section>
    </aside>

    <section class="workspace" aria-label="시뮬레이션 결과">
      <section class="simulation-toolbar" aria-label="시뮬레이션 조작">
        <div class="button-group">
          <button type="button" class="primary-action" id="run-button"><span class="button-symbol">▶</span> Run <small>20년</small></button>
          <button type="button" id="live-button"><span class="button-symbol">●</span> Live</button>
          <button type="button" id="pause-button" disabled><span class="button-symbol">Ⅱ</span> Pause</button>
          <button type="button" id="step-button">Step <small>+0.25년</small></button>
          <button type="button" id="reset-button">Reset</button>
        </div>
        <div class="run-status" aria-live="polite">
          <span class="status-dot" id="status-dot"></span>
          <span id="run-status-text">초기 상태</span>
        </div>
      </section>

      <section class="chart-section" aria-labelledby="chart-heading">
        <div class="chart-heading-row">
          <div>
            <p class="section-kicker">POPULATION DYNAMICS</p>
            <h2 id="chart-heading">개체군 변화</h2>
          </div>
          <div class="chart-tabs" role="tablist" aria-label="그래프 보기 방식">
            <button type="button" data-chart-view="time" class="is-active" role="tab" aria-selected="true">Time graph</button>
            <button type="button" data-chart-view="phase" role="tab" aria-selected="false">Phase plot</button>
            <button type="button" data-chart-view="both" role="tab" aria-selected="false">동시 보기</button>
          </div>
        </div>
        <div class="legend" aria-label="그래프 범례">
          <span><i class="legend-mark prey-mark"></i>피식자 N</span>
          <span><i class="legend-mark predator-mark"></i>포식자 P</span>
          <span class="legend-hint">그래프를 마우스나 손가락으로 짚어 보세요.</span>
        </div>
        <div class="charts" id="charts-container">
          <div class="chart-panel" id="time-chart-panel">
            <svg id="time-chart" class="population-chart" role="img"></svg>
          </div>
          <div class="chart-panel" id="phase-chart-panel" hidden>
            <svg id="phase-chart" class="population-chart" role="img"></svg>
          </div>
        </div>
        <div class="time-scrubber">
          <label for="time-slider">관찰 시점 <strong id="time-output">0.00년</strong></label>
          <input id="time-slider" type="range" min="0" max="20" step="0.01" value="0" />
          <div class="time-scale" aria-hidden="true"><span>0년</span><span>10년</span><span>20년</span></div>
        </div>
      </section>

      <section class="insight-grid">
        <article class="ecosystem-panel">
          <div class="panel-heading">
            <div>
              <p class="section-kicker">CURRENT ECOSYSTEM</p>
              <h2>현재 생태계</h2>
            </div>
            <div class="current-time" id="current-time">0.00년</div>
          </div>
          <div class="population-readout">
            <div class="population-value prey-value">
              <span class="readout-icon prey-icon">●</span>
              <div><small>피식자 N</small><strong id="prey-value">40.0</strong></div>
              <span class="trend" id="prey-trend">증가</span>
            </div>
            <div class="population-value predator-value">
              <span class="readout-icon predator-icon">◆</span>
              <div><small>포식자 P</small><strong id="predator-value">9.0</strong></div>
              <span class="trend" id="predator-trend">감소</span>
            </div>
          </div>
          <div class="ecosystem-field" id="ecosystem-field" role="img" aria-label="현재 개체수를 점으로 축약한 생태계 그림">
            <div class="habitat-line"></div>
          </div>
          <p class="visualization-note">점의 수는 실제 개체수와 1:1 대응하지 않는 교육용 축약 표현입니다.</p>
        </article>

        <article class="feedback-panel">
          <p class="section-kicker">NEGATIVE FEEDBACK</p>
          <h2>지금 순환의 어느 단계일까?</h2>
          <p class="feedback-explanation" id="feedback-explanation"></p>
          <ol class="feedback-cycle" id="feedback-cycle">
            <li><span>1</span><strong>피식자 증가</strong><small>이용할 먹이가 많아짐</small></li>
            <li><span>2</span><strong>잠시 뒤 포식자 증가</strong><small>피식자의 정점보다 늦게 반응</small></li>
            <li><span>3</span><strong>피식자 감소</strong><small>포식 압력이 커짐</small></li>
            <li><span>4</span><strong>포식자 감소</strong><small>먹이 부족과 자연 사망</small></li>
          </ol>
          <div class="equilibrium-note" id="equilibrium-note"></div>
          <p class="model-caution">이 진동은 이상화된 상호작용의 주기적 동역학입니다. 항상 안정된 항상성이라고 해석하지 않습니다.</p>
        </article>
      </section>

      <section class="prediction-section">
        <label class="prediction-toggle" for="prediction-toggle">
          <input id="prediction-toggle" type="checkbox" />
          <span><strong>Prediction Mode</strong><small>먼저 예측하고, 그다음 계산 결과와 비교하기</small></span>
        </label>
        <div class="prediction-content" id="prediction-content" hidden>
          <label for="scenario-select">탐구 질문</label>
          <select id="scenario-select"></select>
          <fieldset id="prediction-fieldset">
            <legend id="prediction-question"></legend>
            <div id="prediction-options"></div>
          </fieldset>
          <p class="prediction-instruction">예측을 선택한 뒤 <strong>Run</strong>을 누르세요. 이 탐구 질문은 Basic model을 기준으로 하며, 현재 조건에서 한 번에 한 변수만 바꿉니다.</p>
          <div id="prediction-result" class="prediction-result" role="status" aria-live="polite" hidden></div>
        </div>
      </section>

      <details class="assumptions">
        <summary>Model assumptions · 이 모형의 가정과 한계</summary>
        <div class="assumption-content">
          <div>
            <h3>기본 Lotka-Volterra 모형의 가정</h3>
            <ul>
              <li>피식자의 먹이는 무한하며, 포식자가 없으면 제한 없이 증가합니다.</li>
              <li>두 종은 공간 구조 없이 무작위로 만납니다.</li>
              <li>포식자에게는 이 피식자 외의 먹이가 없습니다.</li>
              <li>계절과 환경 조건이 변하지 않습니다.</li>
              <li>개체의 나이, 질병, 이동, 유전적 차이를 고려하지 않습니다.</li>
            </ul>
          </div>
          <div>
            <h3>그래프를 해석할 때</h3>
            <p>기본 모형의 닫힌 궤적은 안정점으로 수렴하는 결과가 아니라 초기 조건에 따라 결정되는 중립적 주기 궤적입니다. 실제 자연에서는 환경 변화와 밀도 의존성 때문에 완벽히 같은 진동이 반복되지 않을 수 있습니다.</p>
            <p><strong>More realistic model</strong>은 피식자에 환경수용력 K를 적용하여 ‘먹이가 무한하다’는 가정 일부를 완화합니다.</p>
          </div>
        </div>
      </details>
    </section>
  </main>
`;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`필수 요소를 찾을 수 없습니다: ${selector}`);
  return element;
}

const timeChart = requiredElement<SVGSVGElement>('#time-chart');
const phaseChart = requiredElement<SVGSVGElement>('#phase-chart');
const chartsContainer = requiredElement<HTMLDivElement>('#charts-container');
const timeChartPanel = requiredElement<HTMLDivElement>('#time-chart-panel');
const phaseChartPanel = requiredElement<HTMLDivElement>('#phase-chart-panel');
const timeSlider = requiredElement<HTMLInputElement>('#time-slider');
const timeOutput = requiredElement<HTMLElement>('#time-output');
const runButton = requiredElement<HTMLButtonElement>('#run-button');
const liveButton = requiredElement<HTMLButtonElement>('#live-button');
const pauseButton = requiredElement<HTMLButtonElement>('#pause-button');
const predictionToggle = requiredElement<HTMLInputElement>('#prediction-toggle');
const predictionContent = requiredElement<HTMLDivElement>('#prediction-content');
const scenarioSelect = requiredElement<HTMLSelectElement>('#scenario-select');
const predictionQuestion = requiredElement<HTMLElement>('#prediction-question');
const predictionOptions = requiredElement<HTMLDivElement>('#prediction-options');
const predictionResult = requiredElement<HTMLDivElement>('#prediction-result');

let parameters: ModelParameters = { ...DEFAULT_PARAMETERS };
let predictionBaseline: ModelParameters = { ...DEFAULT_PARAMETERS };
let model: ModelKind = 'basic';
let chartView: ChartView = 'time';
let trajectory = simulate(parameters, DEFAULT_DURATION, undefined, model);
let selectedTime = 0;
let visibleUntil = 0;
let isLive = false;
let animationFrameId: number | null = null;
let lastAnimationTime = 0;
let lastChartRenderTime = 0;

function formatParameter(definition: ParameterDefinition, value: number): string {
  return value.toFixed(definition.decimals);
}

function syncParameterControls(): void {
  for (const definition of parameterDefinitions) {
    const value = parameters[definition.key];
    const formatted = formatParameter(definition, value);
    requiredElement<HTMLInputElement>(`[data-range-param="${definition.key}"]`).value = String(value);
    requiredElement<HTMLInputElement>(`[data-number-param="${definition.key}"]`).value = formatted;
    requiredElement<HTMLOutputElement>(`#output-${definition.key}`).textContent = `${formatted} ${definition.unit}`;
  }
}

function recompute(resetTime = true): void {
  trajectory = simulate(parameters, DEFAULT_DURATION, undefined, model);
  if (resetTime) {
    selectedTime = 0;
    visibleUntil = 0;
  }
  timeSlider.value = selectedTime.toFixed(2);
}

function setRunStatus(text: string, mode: 'idle' | 'live' | 'complete' = 'idle'): void {
  requiredElement('#run-status-text').textContent = text;
  requiredElement('#status-dot').setAttribute('data-mode', mode);
}

function pauseLive(status = '일시정지'): void {
  isLive = false;
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
  animationFrameId = null;
  lastAnimationTime = 0;
  liveButton.disabled = false;
  pauseButton.disabled = true;
  if (status) setRunStatus(status, visibleUntil >= DEFAULT_DURATION ? 'complete' : 'idle');
}

function setParametersFromScenario(changed: ModelParameters): void {
  parameters = changed;
  syncParameterControls();
  recompute();
}

function currentScenario(): PredictionScenario {
  return predictionScenarios.find((scenario) => scenario.id === scenarioSelect.value) ?? predictionScenarios[0];
}

function setupPredictionQuestion(): void {
  const scenario = currentScenario();
  predictionQuestion.textContent = scenario.question;
  predictionOptions.innerHTML = scenario.options.map((option) => `
    <label class="prediction-option">
      <input type="radio" name="prediction-choice" value="${option.value}" />
      <span>${option.label}</span>
    </label>
  `).join('');
  predictionResult.hidden = true;
}

function applyPredictionScenario(): boolean {
  const choice = document.querySelector<HTMLInputElement>('input[name="prediction-choice"]:checked');
  if (!choice) {
    predictionResult.hidden = false;
    predictionResult.dataset.result = 'warning';
    predictionResult.innerHTML = '<strong>예측을 먼저 선택해 주세요.</strong><span>예측을 기록한 뒤 결과를 확인하는 것이 탐구 모드의 핵심입니다.</span>';
    return false;
  }
  const scenario = currentScenario();
  const changed = scenario.apply(predictionBaseline);
  setParametersFromScenario(changed);
  const correct = choice.value === scenario.correct;
  predictionResult.hidden = false;
  predictionResult.dataset.result = correct ? 'correct' : 'review';
  predictionResult.innerHTML = `<strong>${correct ? '예측이 모형의 결과와 일치합니다.' : '그래프와 평형식을 다시 비교해 보세요.'}</strong><span>${scenario.explain(predictionBaseline, changed)}</span>`;
  return true;
}

function renderCharts(): void {
  timeChartPanel.hidden = chartView === 'phase';
  phaseChartPanel.hidden = chartView === 'time';
  chartsContainer.classList.toggle('show-both', chartView === 'both');
  const options = {
    trajectory,
    visibleUntil,
    selectedTime,
    parameters,
    model,
    onSelectTime: (time: number) => {
      selectedTime = time;
      visibleUntil = Math.max(visibleUntil, time);
      timeSlider.value = time.toFixed(2);
      renderDynamic();
    },
  };
  if (chartView !== 'phase') drawTimeChart(timeChart, options);
  if (chartView !== 'time') drawPhaseChart(phaseChart, options);
}

function createPositions(count: number, seed: number): Array<{ x: number; y: number }> {
  let value = seed;
  return Array.from({ length: count }, () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    const x = 4 + (value / 2 ** 32) * 92;
    value = (value * 1664525 + 1013904223) >>> 0;
    const y = 10 + (value / 2 ** 32) * 75;
    return { x, y };
  });
}

const preyPositions = createPositions(30, 41);
const predatorPositions = createPositions(30, 907);

function iconCount(value: number, maximum: number): number {
  if (value <= 0 || maximum <= 0) return 0;
  return Math.min(28, Math.max(2, Math.round(3 + 24 * Math.sqrt(value / maximum))));
}

function renderEcosystem(state: PopulationState): void {
  const summary = trajectorySummary(trajectory, parameters, model);
  const preyCount = iconCount(state.prey, summary.preyMax);
  const predatorCount = iconCount(state.predator, summary.predatorMax);
  const field = requiredElement<HTMLDivElement>('#ecosystem-field');
  field.querySelectorAll('.organism').forEach((element) => element.remove());
  for (let index = 0; index < preyCount; index += 1) {
    const dot = document.createElement('span');
    dot.className = 'organism prey-organism';
    dot.style.left = `${preyPositions[index].x}%`;
    dot.style.top = `${preyPositions[index].y}%`;
    dot.setAttribute('aria-hidden', 'true');
    field.append(dot);
  }
  for (let index = 0; index < predatorCount; index += 1) {
    const dot = document.createElement('span');
    dot.className = 'organism predator-organism';
    dot.style.left = `${predatorPositions[index].x}%`;
    dot.style.top = `${predatorPositions[index].y}%`;
    dot.setAttribute('aria-hidden', 'true');
    field.append(dot);
  }
  field.setAttribute('aria-label', `교육용 축약 그림: 피식자 ${state.prey.toFixed(1)}, 포식자 ${state.predator.toFixed(1)}`);
}

function renderDynamic(skipCharts = false): void {
  const state = nearestState(trajectory, selectedTime);
  const stateDescription = describeState(state, parameters, model);
  const summary = trajectorySummary(trajectory, parameters, model);
  timeOutput.textContent = `${state.time.toFixed(2)}년`;
  requiredElement('#current-time').textContent = `${state.time.toFixed(2)}년`;
  requiredElement('#prey-value').textContent = state.prey.toFixed(1);
  requiredElement('#predator-value').textContent = state.predator.toFixed(1);
  requiredElement('#prey-trend').textContent = stateDescription.preyTrend;
  requiredElement('#predator-trend').textContent = stateDescription.predatorTrend;
  requiredElement('#prey-trend').setAttribute('data-trend', stateDescription.preyTrend);
  requiredElement('#predator-trend').setAttribute('data-trend', stateDescription.predatorTrend);
  requiredElement('#feedback-explanation').textContent = stateDescription.explanation;
  document.querySelectorAll('#feedback-cycle li').forEach((item, index) => {
    item.classList.toggle('is-active', index === stateDescription.activeStage);
  });
  const lagText = summary.peakLag
    ? `기본 조건에서 확인된 정점 간 시간 지연: ${summary.peakLag.lag.toFixed(2)}년`
    : '현재 범위에서는 비교 가능한 두 정점을 찾지 못했습니다.';
  requiredElement('#equilibrium-note').innerHTML = `
    <span>공존 평형 기준</span>
    <strong>N* ${summary.equilibrium.prey.toFixed(1)} · P* ${summary.equilibrium.predator.toFixed(1)}</strong>
    <small>${lagText}</small>
  `;
  renderEcosystem(state);
  if (!skipCharts) renderCharts();
}

function updateModelUI(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-model]').forEach((button) => {
    const active = button.dataset.model === model;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.body.dataset.model = model;
  requiredElement('#model-badge').textContent = model === 'basic' ? '표준 모형' : '환경수용력 포함';
  requiredElement('#prey-equation').textContent = model === 'basic'
    ? 'dN/dt = αN − βNP'
    : 'dN/dt = αN(1 − N/K) − βNP';
  requiredElement('#formula-note').textContent = model === 'basic'
    ? '피식자의 먹이가 제한되지 않는다고 가정합니다.'
    : '피식자의 환경수용력 K를 반영한 로지스틱 증가입니다.';
}

function liveLoop(timestamp: number): void {
  if (!isLive) return;
  if (lastAnimationTime === 0) lastAnimationTime = timestamp;
  const elapsedSeconds = Math.min(0.1, (timestamp - lastAnimationTime) / 1000);
  lastAnimationTime = timestamp;
  selectedTime = Math.min(DEFAULT_DURATION, selectedTime + elapsedSeconds * 1.5);
  visibleUntil = Math.max(visibleUntil, selectedTime);
  timeSlider.value = selectedTime.toFixed(2);

  if (timestamp - lastChartRenderTime >= 32 || selectedTime >= DEFAULT_DURATION) {
    renderDynamic();
    lastChartRenderTime = timestamp;
  } else {
    renderDynamic(true);
  }

  if (selectedTime >= DEFAULT_DURATION) {
    pauseLive('20년 계산 완료');
    renderDynamic();
    return;
  }
  animationFrameId = requestAnimationFrame(liveLoop);
}

for (const definition of parameterDefinitions) {
  const rangeInput = requiredElement<HTMLInputElement>(`[data-range-param="${definition.key}"]`);
  const numberInput = requiredElement<HTMLInputElement>(`[data-number-param="${definition.key}"]`);
  const commitValue = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    pauseLive('조건 변경됨');
    parameters = { ...parameters, [definition.key]: clampParameter(definition.key, parsed) };
    predictionBaseline = { ...parameters };
    syncParameterControls();
    recompute();
    predictionResult.hidden = true;
    renderDynamic();
  };
  rangeInput.addEventListener('input', () => commitValue(rangeInput.value));
  numberInput.addEventListener('change', () => commitValue(numberInput.value));
}

document.querySelectorAll<HTMLButtonElement>('[data-model]').forEach((button) => {
  button.addEventListener('click', () => {
    const nextModel = button.dataset.model;
    if (nextModel !== 'basic' && nextModel !== 'logistic') return;
    pauseLive('모형 변경됨');
    model = nextModel;
    predictionBaseline = { ...parameters };
    recompute();
    updateModelUI();
    renderDynamic();
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-chart-view]').forEach((button) => {
  button.addEventListener('click', () => {
    const nextView = button.dataset.chartView;
    if (nextView !== 'time' && nextView !== 'phase' && nextView !== 'both') return;
    chartView = nextView;
    document.querySelectorAll<HTMLButtonElement>('[data-chart-view]').forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    renderCharts();
  });
});

runButton.addEventListener('click', () => {
  pauseLive('');
  if (predictionToggle.checked && !applyPredictionScenario()) return;
  recompute(false);
  selectedTime = DEFAULT_DURATION;
  visibleUntil = DEFAULT_DURATION;
  timeSlider.value = String(DEFAULT_DURATION);
  setRunStatus('20년 계산 완료', 'complete');
  renderDynamic();
});

liveButton.addEventListener('click', () => {
  if (selectedTime >= DEFAULT_DURATION) {
    selectedTime = 0;
    visibleUntil = 0;
  }
  isLive = true;
  liveButton.disabled = true;
  pauseButton.disabled = false;
  setRunStatus('실시간 진행 중', 'live');
  animationFrameId = requestAnimationFrame(liveLoop);
});

pauseButton.addEventListener('click', () => pauseLive());

requiredElement<HTMLButtonElement>('#step-button').addEventListener('click', () => {
  pauseLive('한 단계 진행');
  selectedTime = Math.min(DEFAULT_DURATION, selectedTime + 0.25);
  visibleUntil = Math.max(visibleUntil, selectedTime);
  timeSlider.value = selectedTime.toFixed(2);
  renderDynamic();
});

requiredElement<HTMLButtonElement>('#reset-button').addEventListener('click', () => {
  pauseLive('초기 상태');
  recompute();
  predictionResult.hidden = true;
  renderDynamic();
});

requiredElement<HTMLButtonElement>('#restore-defaults').addEventListener('click', () => {
  pauseLive('기본값 복원됨');
  parameters = { ...DEFAULT_PARAMETERS };
  predictionBaseline = { ...DEFAULT_PARAMETERS };
  model = 'basic';
  syncParameterControls();
  recompute();
  updateModelUI();
  predictionResult.hidden = true;
  renderDynamic();
});

timeSlider.addEventListener('input', () => {
  pauseLive('시점 선택');
  selectedTime = Math.max(0, Math.min(DEFAULT_DURATION, Number(timeSlider.value)));
  visibleUntil = Math.max(visibleUntil, selectedTime);
  renderDynamic();
});

predictionScenarios.forEach((scenario) => {
  const option = document.createElement('option');
  option.value = scenario.id;
  option.textContent = scenario.title;
  scenarioSelect.append(option);
});

predictionToggle.addEventListener('change', () => {
  predictionContent.hidden = !predictionToggle.checked;
  if (predictionToggle.checked) {
    if (model !== 'basic') {
      pauseLive('탐구 모드: 기본 모형으로 전환');
      model = 'basic';
      recompute();
      updateModelUI();
      renderDynamic();
    }
    predictionBaseline = { ...parameters };
    setupPredictionQuestion();
  } else {
    predictionResult.hidden = true;
  }
});

scenarioSelect.addEventListener('change', () => {
  parameters = { ...predictionBaseline };
  syncParameterControls();
  recompute();
  setupPredictionQuestion();
  renderDynamic();
});

let resizeTimer = 0;
const resizeObserver = new ResizeObserver(() => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(renderCharts, 80);
});
resizeObserver.observe(chartsContainer);

syncParameterControls();
updateModelUI();
setupPredictionQuestion();
renderDynamic();
