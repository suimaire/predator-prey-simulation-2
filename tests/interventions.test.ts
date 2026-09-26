import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DEFAULT_PARAMETERS, ForestSimulation, POPULATION_LIMITS, SPECIES_ORDER, speciesConfigs, type SimulationParameters } from '../src/model.ts';
import { InterventionSession, groupInterventions, interventionLabel, removalPresetAmount } from '../src/interventions.ts';
import { ApexChallengeSession, apexParameters } from '../src/challenge.ts';
import { drawPopulationChart, SERIES_COLORS } from '../src/charts.ts';

function advance(simulation: ForestSimulation, steps: number) {
  for (let i = 0; i < steps; i++) simulation.step();
}

function assertValid(simulation: ForestSimulation) {
  const snapshot = simulation.getSnapshot();
  const ids = new Set<number>();
  const cells = new Set<string>();
  for (const species of SPECIES_ORDER) for (const agent of snapshot.agents[species]) {
    assert.ok(agent.x >= 0 && agent.x < snapshot.width && agent.y >= 0 && agent.y < snapshot.height);
    assert.ok(Number.isFinite(agent.energy) && agent.energy > 0);
    assert.ok(agent.age >= 0);
    assert.equal(ids.has(agent.id), false); ids.add(agent.id);
    const cell = `${agent.x}:${agent.y}`;
    assert.equal(cells.has(cell), false); cells.add(cell);
  }
}

test('Step 500 introduction preserves existing agents, forest, stats, parameters and every historical sample', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, seed: 'RUNTIME-500' });
  advance(simulation, 500);
  const before = structuredClone(simulation.getSnapshot());
  const rabbitArray = simulation.getSnapshot().rabbits;
  const wolfArray = simulation.getSnapshot().wolves;
  const history = structuredClone(simulation.getHistory());
  const parameters = simulation.getParameters();
  assert.equal(simulation.introduceSpecies('tertiary', 3), true);
  const after = simulation.getSnapshot();
  assert.equal(after.step, 500);
  assert.equal(after.rabbits, rabbitArray); assert.equal(after.wolves, wolfArray);
  assert.deepEqual(after.rabbits, before.rabbits); assert.deepEqual(after.wolves, before.wolves);
  assert.deepEqual(after.forest, before.forest); assert.deepEqual(after.stats, before.stats);
  assert.deepEqual(simulation.getParameters(), parameters);
  assert.deepEqual(simulation.getHistory().slice(0, history.length), history);
  assert.equal(after.tertiary.length, 3);
  const threshold = speciesConfigs(parameters).tertiary.reproductionThreshold;
  for (const agent of after.tertiary) {
    assert.equal(agent.age, 0); assert.ok(agent.energy >= threshold * .55 && agent.energy < threshold * .85);
  }
  assert.deepEqual(after.interventions, [{ kind: 'introduce', step: 500, species: 'tertiary', amount: 3, resultingCount: 3 }]);
  assertValid(simulation);
});

test('2-stage setup permits a lone fourth consumer and no-prey third consumer; both use existing starvation rules', () => {
  for (const species of ['tertiary', 'quaternary'] as const) {
    const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, initialWolves: 0, initialRabbits: 0 });
    assert.equal(simulation.introduceSpecies(species, 2), true);
    assert.equal(simulation.getParameters().foodChainDepth, 2);
    assert.equal(simulation.getSnapshot().agents[species].length, 2);
    const energies = simulation.getSnapshot().agents[species].map(agent => agent.energy);
    simulation.step();
    simulation.getSnapshot().agents[species].forEach((agent, index) => {
      assert.equal(agent.age, 1);
      assert.equal(agent.energy, energies[index] - speciesConfigs(simulation.getParameters())[species].basalEnergyCost);
    });
    assert.ok(simulation.getEnergyFlow().some(flow => flow.target === species));
    advance(simulation, 100);
    assert.equal(simulation.getSnapshot().agents[species].length, 0);
    assert.equal(simulation.getSnapshot().stats.deaths[species], 2);
  }
});

test('adding to a living population preserves every existing individual and adds exactly the requested count', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, foodChainDepth: 4 });
  advance(simulation, 2);
  const before = structuredClone(simulation.getSnapshot());
  assert.ok(SPECIES_ORDER.every(species => before.agents[species].length > 0));
  assert.equal(simulation.introduceSpecies('tertiary', 3), true);
  for (const species of SPECIES_ORDER) {
    assert.deepEqual(simulation.getSnapshot().agents[species].slice(0, before.agents[species].length), before.agents[species]);
  }
  assert.equal(simulation.getSnapshot().tertiary.length, before.tertiary.length + 3);
  assert.equal(simulation.getInterventions().at(-1)!.resultingCount, before.tertiary.length + 3);
  assert.deepEqual(simulation.getSnapshot().forest, before.forest);
  assertValid(simulation);
});

test('removal preserves other species (including higher consumers), RNG, step and history; reintroduction is a new action', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, foodChainDepth: 4 });
  advance(simulation, 2);
  const before = structuredClone(simulation.getSnapshot());
  const history = structuredClone(simulation.getHistory());
  const randomBefore = JSON.stringify((simulation as any).random);
  assert.equal(simulation.removeSpecies('tertiary'), true);
  assert.equal(JSON.stringify((simulation as any).random), randomBefore);
  assert.equal(simulation.getSnapshot().step, 2);
  assert.deepEqual(simulation.getSnapshot().quaternary, before.quaternary);
  assert.deepEqual(simulation.getSnapshot().rabbits, before.rabbits);
  assert.deepEqual(simulation.getSnapshot().wolves, before.wolves);
  assert.deepEqual(simulation.getSnapshot().forest, before.forest);
  assert.deepEqual(simulation.getHistory().slice(0, history.length), history);
  advance(simulation, 5);
  assert.equal(simulation.introduceSpecies('tertiary', 2), true);
  assert.equal(simulation.getSnapshot().removedSpecies.includes('tertiary'), false);
  assert.equal(simulation.getInterventions().at(-1)!.step, 7);
  assert.equal(simulation.getSnapshot().tertiary.length, 2);
  simulation.step(); assert.equal(simulation.getSnapshot().tertiary[0].age, 1);
  assert.equal(simulation.getParameters().initialTertiary, DEFAULT_PARAMETERS.initialTertiary);
});

test('wolves can be removed and reintroduced later without changing initial conditions or reusing IDs', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS });
  const oldIds = simulation.getSnapshot().wolves.map(agent => agent.id);
  simulation.removeSpecies('wolf'); advance(simulation, 15);
  assert.equal(simulation.introduceSpecies('wolf', 3), true);
  assert.ok(simulation.getSnapshot().wolves.every(agent => !oldIds.includes(agent.id)));
  assert.equal(simulation.getParameters().initialWolves, 8);
  assert.deepEqual(simulation.getInterventions().map(e => [e.step, e.kind, e.species, e.amount, e.resultingCount]), [
    [0, 'remove', 'wolf', 8, 0], [15, 'introduce', 'wolf', 3, 3],
  ]);
});

test('partial removal removes exactly 25 distinct rabbits, preserving survivors, other species and all experiment state', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, initialRabbits: 100 });
  const before = structuredClone(simulation.getSnapshot());
  const original = [...simulation.getSnapshot().rabbits];
  const wolves = simulation.getSnapshot().wolves;
  const history = structuredClone(simulation.getHistory());
  const parameters = simulation.getParameters();
  assert.equal(simulation.removeSpecies('rabbit', 25), true);
  const after = simulation.getSnapshot();
  const survivors = new Set(after.rabbits.map(agent => agent.id));
  assert.equal(after.rabbits.length, 75);
  assert.equal(survivors.size, 75);
  assert.equal(original.filter(agent => !survivors.has(agent.id)).length, 25);
  assert.deepEqual(after.rabbits, before.rabbits.filter(agent => survivors.has(agent.id)));
  after.rabbits.forEach(agent => assert.equal(agent, original.find(item => item.id === agent.id)));
  assert.equal(after.wolves, wolves); assert.equal(after.wolves.length, 8);
  assert.deepEqual(after.forest, before.forest); assert.deepEqual(after.stats, before.stats);
  assert.deepEqual(after.removedSpecies, []);
  assert.equal(after.step, before.step); assert.deepEqual(simulation.getParameters(), parameters);
  assert.deepEqual(simulation.getHistory().slice(0, history.length), history);
  assert.deepEqual(simulation.getHistory().slice(-2).map(item => [item.step, item.rabbits]), [[0, 100], [0, 75]]);
  assert.deepEqual(after.interventions, [{ kind: 'remove', step: 0, species: 'rabbit', amount: 25, resultingCount: 75 }]);
  assertValid(simulation);
});

test('every species retains aged survivor identities, energy, position, active behavior and existing death/feeding statistics', () => {
  for (const species of SPECIES_ORDER) {
    const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, foodChainDepth: 4, initialQuaternary: 4 });
    advance(simulation, 2);
    const snapshot = simulation.getSnapshot();
    const before = structuredClone(snapshot);
    const original = [...snapshot.agents[species]];
    const energyFlow = structuredClone(simulation.getEnergyFlow());
    assert.ok(original.length > 1);
    assert.equal(simulation.removeSpecies(species, 1), true);
    const survivors = simulation.getSnapshot().agents[species];
    assert.equal(survivors.length, original.length - 1);
    for (const agent of survivors) {
      assert.equal(agent, original.find(item => item.id === agent.id));
      assert.deepEqual(agent, before.agents[species].find(item => item.id === agent.id));
    }
    for (const other of SPECIES_ORDER.filter(item => item !== species)) assert.deepEqual(simulation.getSnapshot().agents[other], before.agents[other]);
    assert.deepEqual(simulation.getSnapshot().stats, before.stats);
    assert.deepEqual(simulation.getEnergyFlow(), energyFlow);
    assert.deepEqual(simulation.getInterventions().at(-1), { kind: 'remove', step: 2, species, amount: 1, resultingCount: original.length - 1 });
    simulation.step();
    assert.ok(simulation.getSnapshot().agents[species].some(agent => agent.age === 3));
  }
});

test('partial selection consumes the existing seeded RNG, never Math.random, and is not a prefix/ID selection', (t) => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, initialRabbits: 100, seed: 'PARTIAL-RNG' });
  const random = (simulation as any).random;
  const state = random.state;
  const original = simulation.getSnapshot().rabbits.map(agent => agent.id);
  const next = random.next.bind(random);
  let calls = 0;
  t.mock.method(random, 'next', () => {
    calls++;
    return next();
  });
  t.mock.method(Math, 'random', () => { throw new Error('Unseeded selection'); });
  simulation.removeSpecies('rabbit', 25);
  assert.equal(calls, 25); assert.notEqual(random.state, state);
  const survivingIds = new Set(simulation.getSnapshot().rabbits.map(agent => agent.id));
  const removed = original.filter(id => !survivingIds.has(id));
  assert.notDeepEqual(removed, original.slice(0, 25));
  assert.notDeepEqual(removed, original.slice(-25));
});

test('same history reproduces removed IDs and the future trajectory; different seeds produce different samples', () => {
  const parameters = { ...DEFAULT_PARAMETERS, initialRabbits: 100, foodChainDepth: 4 as const, initialQuaternary: 4, seed: 'PARTIAL-REPLAY' };
  const a = new ForestSimulation(parameters), b = new ForestSimulation(parameters);
  for (const simulation of [a, b]) {
    advance(simulation, 3);
    simulation.introduceSpecies('wolf', 3);
    assert.equal(simulation.removeSpecies('rabbit', 25), true);
    assert.equal(simulation.removeSpecies('quaternary', 2), true);
  }
  for (let step = 0; step < 100; step++) {
    assert.deepEqual(a.getSnapshot(), b.getSnapshot());
    assert.deepEqual(a.getHistory(), b.getHistory());
    assert.deepEqual(a.getEnergyFlow(), b.getEnergyFlow());
    a.step(); b.step();
  }
  const samples = new Set<string>();
  for (const seed of ['A', 'B', 'C', 'D']) {
    const simulation = new ForestSimulation({ ...parameters, seed });
    simulation.removeSpecies('rabbit', 25);
    samples.add(JSON.stringify(simulation.getSnapshot().rabbits.map(agent => agent.id)));
  }
  assert.equal(samples.size, 4);
});

test('explicit full removal matches the legacy call without consuming RNG, including population one', () => {
  for (const population of [1, 100]) {
    const parameters = { ...DEFAULT_PARAMETERS, initialRabbits: population };
    const explicit = new ForestSimulation(parameters), legacy = new ForestSimulation(parameters);
    const rng = JSON.stringify((explicit as any).random);
    assert.equal(explicit.removeSpecies('rabbit', population), true);
    assert.equal(legacy.removeSpecies('rabbit'), true);
    assert.equal(JSON.stringify((explicit as any).random), rng);
    assert.deepEqual(explicit.getSnapshot(), legacy.getSnapshot());
    assert.equal(explicit.getSnapshot().rabbits.length, 0);
    assert.deepEqual(explicit.getSnapshot().removedSpecies, ['rabbit']);
    advance(explicit, 30); advance(legacy, 30);
    assert.deepEqual(explicit.getSnapshot(), legacy.getSnapshot());
  }
});

test('invalid and zero-population removals reject atomically, including overflow and stale quantities', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS });
  const before = structuredClone(simulation.getSnapshot());
  const history = structuredClone(simulation.getHistory());
  const rng = JSON.stringify((simulation as any).random);
  for (const amount of [0, -1, 1.5, NaN, Infinity, -Infinity, 51, Number.MAX_VALUE, Number('')]) {
    assert.equal(simulation.removeSpecies('rabbit', amount), false);
  }
  assert.equal(simulation.removeSpecies('tertiary', 1), false);
  assert.equal(simulation.removeSpecies('tertiary'), false);
  assert.deepEqual(simulation.getSnapshot(), before);
  assert.deepEqual(simulation.getHistory(), history);
  assert.equal(JSON.stringify((simulation as any).random), rng);
});

test('removal percentage presets round and clamp to a living population', () => {
  for (const [population, fraction, expected] of [[3, .1, 1], [224, .1, 22], [224, .25, 56], [224, .5, 112], [224, 1, 224], [50, .1, 5], [8, .1, 1], [3, -.1, 1], [3, 2, 3]]) {
    assert.equal(removalPresetAmount(population, fraction), expected);
  }
  for (const fraction of [.1, .25, .5, 1]) {
    assert.equal(removalPresetAmount(1, fraction), 1);
    assert.equal(removalPresetAmount(0, fraction), 0);
  }
  assert.equal(removalPresetAmount(NaN, .1), 0);
  assert.equal(removalPresetAmount(10, NaN), 0);
});

test('Reset after introductions and partial removals restores the original snapshot, history and RNG', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS });
  const control = new ForestSimulation({ ...DEFAULT_PARAMETERS });
  advance(simulation, 5); simulation.introduceSpecies('rabbit', 20);
  simulation.removeSpecies('rabbit', 30); simulation.introduceSpecies('tertiary', 6); simulation.removeSpecies('tertiary', 3);
  simulation.reset();
  assert.deepEqual(simulation.getSnapshot(), control.getSnapshot());
  assert.deepEqual(simulation.getHistory(), control.getHistory());
  advance(simulation, 20); advance(control, 20);
  assert.deepEqual(simulation.getSnapshot(), control.getSnapshot());
});

test('Reset clears all runtime events/activation and exactly restores the configured initial experiment', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS });
  const before = structuredClone(simulation.getSnapshot());
  simulation.introduceSpecies('tertiary', 5); simulation.introduceSpecies('quaternary', 1);
  advance(simulation, 10); simulation.removeSpecies('wolf');
  simulation.reset();
  assert.deepEqual(simulation.getSnapshot(), before);
  assert.deepEqual(simulation.getActiveSpecies(), ['rabbit', 'wolf']);
  assert.equal(simulation.getHistory().length, 1);
});

test('invalid/full-grid introductions are atomic and do not consume seeded RNG', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS });
  const control = new ForestSimulation({ ...DEFAULT_PARAMETERS });
  for (const amount of [0, -1, 1.5, NaN, Infinity, POPULATION_LIMITS.tertiary + 1]) assert.equal(simulation.introduceSpecies('tertiary', amount), false);
  assert.deepEqual(simulation.getSnapshot(), control.getSnapshot());
  advance(simulation, 20); advance(control, 20);
  assert.deepEqual(simulation.getSnapshot(), control.getSnapshot());
  const full = new ForestSimulation({ ...DEFAULT_PARAMETERS, gridColumns: 20, initialRabbits: 400 });
  assert.equal(full.getIntroductionLimit('quaternary'), 0);
  assert.equal(full.introduceSpecies('quaternary', 1), false);
  full.removeSpecies('rabbit'); assert.equal(full.getIntroductionLimit('quaternary'), POPULATION_LIMITS.quaternary);
  const almostFull = new ForestSimulation({ ...DEFAULT_PARAMETERS, gridColumns: 20, initialRabbits: 279, initialWolves: 0 });
  assert.equal(almostFull.getIntroductionLimit('tertiary'), 1);
  assert.equal(almostFull.introduceSpecies('tertiary', 2), false);
  assert.equal(almostFull.introduceSpecies('tertiary', 1), true);
  assert.equal(almostFull.getIntroductionLimit('tertiary'), 0);
  assertValid(almostFull);
});

test('same seed, initial settings and action sequence reproduce every state including positions, energy and history', () => {
  const parameters = { ...DEFAULT_PARAMETERS, seed: 'INTERVENTION-REPLAY' };
  const a = new ForestSimulation(parameters), b = new ForestSimulation(parameters);
  for (let step = 0; step < 650; step++) {
    for (const simulation of [a, b]) {
      if (step === 7 || step === 300 || step === 500) simulation.introduceSpecies('tertiary', 3);
      if (step === 7 || step === 500) simulation.introduceSpecies('quaternary', 2);
      if (step === 9) simulation.removeSpecies('tertiary');
      if (step === 20) simulation.removeSpecies('wolf');
      if (step === 250) simulation.introduceSpecies('wolf', 6);
      simulation.step(); assertValid(simulation);
    }
    assert.deepEqual(a.getSnapshot(), b.getSnapshot());
    assert.deepEqual(a.getHistory(), b.getHistory());
    assert.deepEqual(a.getEnergyFlow(), b.getEnergyFlow());
  }
});

function controls(running = true) {
  const state = { running, free: true, simulation: new ForestSimulation({ ...DEFAULT_PARAMETERS }) };
  const session = new InterventionSession({ simulation: () => state.simulation, isFree: () => state.free,
    isRunning: () => state.running, setRunning: value => { state.running = value; } });
  const tick = () => { if (state.running) state.simulation.step(); };
  return { state, session, tick };
}

test('begin pauses synchronously at the current step, confirm stays paused, cancel restores the prior running state', () => {
  for (const initiallyRunning of [true, false]) {
    const { state, session, tick } = controls(initiallyRunning);
    advance(state.simulation, 500);
    assert.equal(session.begin(), 500);
    for (let i = 0; i < 40; i++) tick();
    assert.equal(state.simulation.getSnapshot().step, 500); assert.equal(state.running, false);
    assert.equal(session.begin(), null);
    session.cancel(); assert.equal(state.running, initiallyRunning);
    session.begin();
    assert.equal(session.confirm('introduce', 'tertiary', 3)!.step, 500);
    session.cancel(); // Native dialog close must not undo a confirmed pause.
    assert.equal(state.running, false); tick(); assert.equal(state.simulation.getSnapshot().step, 500);
    assert.equal(session.confirm('introduce', 'tertiary', 3), null);
  }
});

test('Apex and stale experiment transactions reject both mutations and accidental resume', () => {
  for (const kind of ['introduce', 'remove'] as const) {
    const { state, session } = controls();
    state.free = false;
    assert.equal(session.begin(), null); assert.equal(session.confirm(kind, 'wolf'), null);
    assert.equal(state.simulation.getInterventions().length, 0);
    state.free = true; session.begin(); state.free = false;
    assert.equal(session.confirm(kind, 'wolf'), null); session.cancel(); assert.equal(state.running, false);
    state.free = true; state.running = true; session.begin();
    state.simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS });
    assert.equal(session.confirm(kind, 'wolf'), null); session.cancel(); assert.equal(state.running, false);
  }
});

test('partial removal transactions preserve pause/cancel behavior and validate current populations at confirmation', () => {
  for (const initiallyRunning of [true, false]) {
    const { state, session, tick } = controls(initiallyRunning);
    session.begin(); tick(); assert.equal(state.simulation.getSnapshot().step, 0);
    session.cancel(); assert.equal(state.running, initiallyRunning);
    session.begin(); assert.equal(session.confirm('remove', 'rabbit', 25)!.amount, 25);
    session.cancel(); tick(); assert.equal(state.running, false);
    assert.equal(state.simulation.getSnapshot().rabbits.length, 25);
    session.begin(); state.simulation.removeSpecies('rabbit', 20);
    assert.equal(session.confirm('remove', 'rabbit', 10), null);
    assert.equal(state.simulation.getSnapshot().rabbits.length, 5);
    assert.equal(session.confirm('remove', 'rabbit', 2)!.resultingCount, 3);
    state.free = false;
    assert.equal(session.begin(), null); assert.equal(session.confirm('remove', 'rabbit', 1), null);
    assert.equal(state.simulation.getSnapshot().rabbits.length, 3);
  }
});

test('one marker per step groups introduce/remove events and retains every series/history sample', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS });
  advance(simulation, 500);
  simulation.introduceSpecies('tertiary', 6); simulation.removeSpecies('tertiary', 3); simulation.introduceSpecies('quaternary', 2); simulation.removeSpecies('tertiary');
  const history = structuredClone(simulation.getHistory());
  const labels: string[] = [], lines: { color: string; dashed: boolean; points: number[][] }[] = [];
  const ctx = {
    strokeStyle: '', dashed: false, points: [] as number[][],
    setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {},
    beginPath() { this.points = []; }, moveTo(x: number, y: number) { this.points.push([x, y]); },
    lineTo(x: number, y: number) { this.points.push([x, y]); },
    setLineDash(value: number[]) { this.dashed = value.length > 0; },
    stroke() { lines.push({ color: this.strokeStyle, dashed: this.dashed, points: [...this.points] }); },
    fillText(value: string) { labels.push(value); },
  };
  const canvas = { width: 640, height: 260, title: '', getBoundingClientRect: () => ({ width: 640, height: 260 }), getContext: () => ctx } as unknown as HTMLCanvasElement;
  drawPopulationChart(canvas, { history, depth: 2, runtimeSpecies: simulation.getActiveSpecies(), visibleSeries: new Set(SPECIES_ORDER), interventions: simulation.getInterventions() });
  assert.equal(lines.filter(line => line.dashed).length, 1);
  assert.equal(lines.find(line => line.dashed)!.points[0][0], 595); // Rightmost step 500.
  assert.ok(lines.some(line => !line.dashed && line.color === SERIES_COLORS.quaternary));
  assert.ok(labels.includes('Step 500')); assert.ok(labels.includes('3차 소비자 +6')); assert.ok(labels.includes('3차 소비자 −3 (실험적 제거)'));
  assert.match(canvas.title, /3차 소비자 −3 \(실험적 전체 제거\)/);
  assert.deepEqual(history.slice(-5).map(item => [item.step, item.tertiary]), [[500, 0], [500, 6], [500, 3], [500, 3], [500, 0]]);
  assert.equal(interventionLabel(simulation.getInterventions()[1]), '3차 소비자 −3 (실험적 제거)');
  assert.match(canvas.title, /4차 소비자 \+2/);
  assert.equal(groupInterventions(simulation.getInterventions(), 0, 500)[0].events.length, 4);
  assert.deepEqual(groupInterventions(simulation.getInterventions(), 501, 600), []);
  assert.deepEqual(simulation.getHistory(), history);
});

const baseline = JSON.parse(readFileSync(new URL('fixtures/intervention-baseline.json', import.meta.url), 'utf8'));
for (const fixture of baseline.cases) test(`no-intervention trajectory matches main ${baseline.sourceCommit}: ${JSON.stringify(fixture.overrides)}`, () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, ...fixture.overrides } as SimulationParameters);
  const digest = createHash('sha256');
  for (let step = 0; step <= 600; step++) {
    digest.update(JSON.stringify(simulation.getSnapshot())); digest.update(JSON.stringify(simulation.getEnergyFlow()));
    if (step < 600) simulation.step();
  }
  assert.equal(digest.digest('hex'), fixture.hash);
});
for (const fixture of baseline.apexCases) test(`Apex score, collapse and every state match main ${baseline.sourceCommit}: ${JSON.stringify(fixture.overrides)}`, () => {
  const parameters = apexParameters({ ...DEFAULT_PARAMETERS, ...fixture.overrides });
  const simulation = new ForestSimulation(parameters), session = new ApexChallengeSession();
  const digest = createHash('sha256');
  session.start(parameters, simulation.getHistory().at(-1)!); digest.update(JSON.stringify(simulation.getSnapshot()));
  while (session.getState().phase === 'active') { session.acceptStep(simulation.step()); digest.update(JSON.stringify(simulation.getSnapshot())); }
  assert.equal(digest.digest('hex'), fixture.hash);
  assert.equal(session.getState().score, fixture.score); assert.equal(session.getState().collapseStep, fixture.collapseStep);
});
