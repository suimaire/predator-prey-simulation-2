import assert from 'node:assert/strict';
import test from 'node:test';
import { captureRemovalFeedback, personalBestImprovement, populationChange, populationComparison, removalEmphasis } from '../src/feedback.ts';
import { DEFAULT_PARAMETERS, ForestSimulation, type Species } from '../src/model.ts';
import { drawPopulationChart, SERIES_COLORS } from '../src/charts.ts';

test('population feedback uses signed net change, including zero without claiming stability', () => {
  const baseline = { step: 0, rabbits: 120, wolves: 26, tertiary: 4, quaternary: 2, forestPercent: 80, forestAbundance: 900 };
  assert.deepEqual(populationChange(128, 'rabbit', baseline), { previous: 120, delta: 8, text: '+8' });
  assert.deepEqual(populationChange(20, 'wolf', baseline), { previous: 26, delta: -6, text: '-6' });
  assert.deepEqual(populationChange(4, 'tertiary', baseline), { previous: 4, delta: 0, text: '순변화 0' });
  assert.deepEqual(populationChange(1, 'quaternary', baseline), { previous: 2, delta: -1, text: '-1' });
  assert.deepEqual(populationChange(5, 'rabbit', undefined), { previous: 5, delta: 0, text: '순변화 0' });
});

test('comparison retains startup, five-step and capped-history semantics', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, foodChainDepth: 4 });
  for (let step = 0; step <= 500; step += 1) {
    const snapshot = simulation.getSnapshot();
    const comparison = populationComparison(simulation.getHistory())!;
    assert.equal(comparison.step, Math.max(0, step - 5));
    for (const species of ['rabbit', 'wolf', 'tertiary', 'quaternary'] as Species[]) {
      const field = species === 'rabbit' ? 'rabbits' : species === 'wolf' ? 'wolves' : species;
      assert.equal(populationChange(snapshot.agents[species].length, species, comparison).delta, snapshot.agents[species].length - comparison[field]);
    }
    if (step < 500) simulation.step();
  }
});

test('removal copies exact current count and positions without changing the model or future trajectory', () => {
  const parameters = { ...DEFAULT_PARAMETERS, foodChainDepth: 4 as const, seed: 'REMOVAL-FEEDBACK' };
  const simulation = new ForestSimulation(parameters);
  const control = new ForestSimulation(parameters);
  for (let step = 0; step < 5; step += 1) { simulation.step(); control.step(); }
  const before = simulation.getSnapshot();
  const historyLength = simulation.getHistory().length;
  const rabbitChange = populationChange(before.rabbits.length, 'rabbit', populationComparison(simulation.getHistory()));
  const expectedPositions = before.wolves.map(({ x, y }) => ({ x, y }));
  const stats = structuredClone(before.stats);
  const feedback = captureRemovalFeedback(before, 'wolf', 1000);
  assert.equal(feedback.count, before.wolves.length);
  assert.ok(feedback.count > 0);
  assert.deepEqual(feedback.positions, expectedPositions);
  assert.notEqual(feedback.positions[0], before.wolves[0]);
  assert.deepEqual(simulation.getSnapshot(), control.getSnapshot());
  simulation.removeSpecies('wolf');
  control.removeSpecies('wolf');
  assert.equal(simulation.getSnapshot().wolves.length, 0);
  assert.equal(simulation.getSnapshot().step, 5);
  assert.deepEqual(simulation.getSnapshot().stats, stats);
  assert.equal(simulation.getHistory().length, historyLength);
  assert.equal(simulation.getHistory().at(-1)!.wolves, 0);
  assert.deepEqual(simulation.getInterventions(), [{ step: 5, species: 'wolf' }]);
  assert.deepEqual(populationChange(simulation.getSnapshot().rabbits.length, 'rabbit', populationComparison(simulation.getHistory())), rabbitChange);
  for (const reduced of [false, true]) {
    assert.equal(removalEmphasis(feedback, 1000, reduced), 1);
    assert.equal(removalEmphasis(feedback, 1300, reduced), reduced ? 1 : .5);
    assert.equal(removalEmphasis(feedback, 1600, reduced), 0);
  }
  for (let step = 0; step < 20; step += 1) { simulation.step(); control.step(); }
  assert.deepEqual(simulation.getSnapshot(), control.getSnapshot());
  assert.deepEqual(simulation.getHistory(), control.getHistory());
  assert.deepEqual(feedback.positions, expectedPositions);
  assert.equal(captureRemovalFeedback(simulation.getSnapshot(), 'wolf', 2000).count, 0);
});

test('first, improved, tied and lower best feedback respect zero as a real existing record', () => {
  assert.equal(personalBestImprovement(0, null), '첫 기록 달성');
  assert.equal(personalBestImprovement(1450, null), '첫 기록 달성');
  assert.equal(personalBestImprovement(1450, 1250), '이전 최고보다 +200 step');
  assert.equal(personalBestImprovement(200, 0), '이전 최고보다 +200 step');
  assert.equal(personalBestImprovement(0, 0), null);
  assert.equal(personalBestImprovement(1250, 1250), null);
  assert.equal(personalBestImprovement(1200, 1250), null);
});

test('chart emphasis reuses exactly one existing marker and restores its normal width', (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const strokes: { color: string; width: number }[] = [];
  const labels: string[] = [];
  const context = {
    strokeStyle: '', lineWidth: 0,
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    save() {}, restore() {}, setLineDash() {}, translate() {}, rotate() {},
    stroke() { strokes.push({ color: this.strokeStyle, width: this.lineWidth }); },
    fillText(text: string) { labels.push(text); },
  };
  const canvas = { width: 640, height: 260, getBoundingClientRect: () => ({ width: 640, height: 260 }), getContext: () => context } as unknown as HTMLCanvasElement;
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS });
  simulation.step();
  simulation.removeSpecies('wolf');
  const history = structuredClone(simulation.getHistory());
  for (const emphasis of [1, .5, 0]) {
    strokes.length = 0; labels.length = 0;
    drawPopulationChart(canvas, {
      history: simulation.getHistory(), depth: 2, visibleSeries: new Set(), interventions: simulation.getInterventions(),
      removalHighlights: [{ species: 'wolf', step: 1, emphasis }],
    });
    assert.deepEqual(strokes.filter((stroke) => stroke.color === SERIES_COLORS.wolf), [{ color: SERIES_COLORS.wolf, width: 1.5 + 2 * emphasis }]);
    assert.deepEqual(labels.filter((label) => label.includes('제거')), ['t=1 늑대 제거']);
    assert.deepEqual(simulation.getHistory(), history);
  }
});
