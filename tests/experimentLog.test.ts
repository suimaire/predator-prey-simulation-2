import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { DEFAULT_PARAMETERS, ForestSimulation, RUNTIME_SPECIES, type Species } from '../src/model.ts';
import { experimentEventLabel } from '../src/experimentLog.ts';

const emptyParameters = { ...DEFAULT_PARAMETERS, seed: 'EXPERIMENT-EVENTS', initialRabbits: 0, initialWolves: 0, initialForestDensity: 0, forestRegrowth: 0 };

function untilExtinct(simulation: ForestSimulation, species: Species): number {
  for (let tick = 0; tick < 200; tick++) {
    const before = simulation.getSnapshot().agents[species]!.length;
    const metric = simulation.step();
    if (before > 0 && simulation.getSnapshot().agents[species]!.length === 0) return metric.step;
  }
  throw new Error(`${species} did not die in the food-free test ecosystem`);
}

for (const species of RUNTIME_SPECIES) test(`${species}: logs each natural positive-to-zero transition at its logical step, including after reintroduction`, () => {
  const simulation = new ForestSimulation(emptyParameters);
  simulation.step();
  assert.deepEqual(simulation.getEvents(), [], 'initial zero populations and vegetation create no extinction events');
  assert.equal(simulation.introduceSpecies(species, 1), true);
  assert.match(experimentEventLabel(simulation.getEvents()[0]), /\+1 도입$/u);
  const first = untilExtinct(simulation, species);
  assert.deepEqual(simulation.getEvents().at(-1), { kind: 'extinction', step: first, species });
  for (let i = 0; i < 20; i++) simulation.step();
  assert.equal(simulation.getEvents().length, 2, 'zero-to-zero does not repeat extinction');
  assert.equal(simulation.getInterventions().length, 1, 'graph keeps only intentional interventions');
  assert.equal(simulation.introduceSpecies(species, 2), true);
  assert.match(experimentEventLabel(simulation.getEvents().at(-1)!), /\+2 재도입$/u);
  const second = untilExtinct(simulation, species);
  assert.deepEqual(simulation.getEvents().filter(event => event.kind === 'extinction'), [
    { kind: 'extinction', step: first, species }, { kind: 'extinction', step: second, species },
  ]);
});

test('partial and complete removals share the event stream; full removal never adds an extinction', () => {
  const simulation = new ForestSimulation({ ...emptyParameters, initialRabbits: 10 });
  assert.equal(simulation.removeSpecies('rabbit', 3), true);
  assert.equal(experimentEventLabel(simulation.getEvents()[0]), '토끼 −3 제거');
  assert.equal(simulation.removeSpecies('rabbit'), true);
  assert.equal(experimentEventLabel(simulation.getEvents()[1]), '토끼 전체 제거');
  for (let i = 0; i < 10; i++) simulation.step();
  assert.equal(simulation.getEvents().length, 2);
  assert.equal(simulation.introduceSpecies('rabbit', 1), true);
  assert.equal(experimentEventLabel(simulation.getEvents()[2]), '토끼 +1 재도입');
  assert.equal(simulation.introduceSpecies('rabbit', 1), true);
  assert.equal(experimentEventLabel(simulation.getEvents()[3]), '토끼 +1 도입', 'adding to a living population is an introduction');
  assert.deepEqual(simulation.getInterventions()[2], { kind: 'introduce', step: 10, species: 'rabbit', amount: 1, resultingCount: 1 });
  untilExtinct(simulation, 'rabbit');
  assert.equal(simulation.getEvents().filter(event => event.kind === 'extinction').length, 1);
});

test('initial populations count as prior presence and Reset clears all events and lifecycle state', () => {
  const simulation = new ForestSimulation({ ...emptyParameters, initialRabbits: 1 });
  untilExtinct(simulation, 'rabbit');
  simulation.introduceSpecies('rabbit', 1);
  assert.equal(experimentEventLabel(simulation.getEvents().at(-1)!), '토끼 +1 재도입');
  simulation.introduceSpecies('fox', 1);
  untilExtinct(simulation, 'fox');
  simulation.reset(emptyParameters);
  assert.deepEqual(simulation.getEvents(), []);
  assert.deepEqual(simulation.getInterventions(), []);
  assert.equal(simulation.getHistory().length, 1);
  for (const species of ['rabbit', 'fox'] as const) {
    simulation.introduceSpecies(species, 1);
    assert.match(experimentEventLabel(simulation.getEvents().at(-1)!), /\+1 도입$/u);
  }
});

test('invalid interventions and observing the event log leave the complete state and RNG untouched', () => {
  const simulation = new ForestSimulation(emptyParameters);
  simulation.introduceSpecies('fox', 1);
  const state = JSON.stringify(simulation);
  assert.equal(simulation.introduceSpecies('fox', 0), false);
  assert.equal(simulation.removeSpecies('fox', 2), false);
  for (let i = 0; i < 20; i++) {
    simulation.getEvents().map(experimentEventLabel);
    simulation.getInterventions();
  }
  assert.equal(JSON.stringify(simulation), state);
});

// SHA-256 of every snapshot, history, feeding flow, RNG state and ID in each
// 300-step run, captured from model.ts before the experiment-log refactor.
for (const [seed, expected] of [
  ['EVENT-FOX-A', '04bb0aa8603f5c3ca3d622ab6b55be77c387dce02930df67ff6f63f1a3fd5059'],
  ['EVENT-FOX-B', '78ca1df91277c1df8dba2c2609ce73f820d8c4e0c37fd6e02ccff35f9bfde106'],
  ['EVENT-FOX-C', '34685edf43b86d57a7bcb7557c3b64787cb3b13a8aef8edf5a53a74dfe98d1fb'],
]) test(`logging preserves the pre-refactor trajectory with fox and interventions: ${seed}`, () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, seed, foodChainDepth: 4 });
  const hash = createHash('sha256');
  for (let step = 0; step < 300; step++) {
    if (step === 0 || step === 60 || step === 180) simulation.introduceSpecies('fox', 4);
    if (step === 4) simulation.removeSpecies('rabbit', 10);
    if (step === 8) simulation.removeSpecies('fox', 1);
    if (step === 20) simulation.removeSpecies('wolf');
    if (step === 25) simulation.introduceSpecies('wolf', 4);
    if (step === 55) simulation.removeSpecies('fox');
    hash.update(JSON.stringify({ snapshot: simulation.getSnapshot(), history: simulation.getHistory(), flow: simulation.getEnergyFlow(50),
      random: (simulation as any).random, nextAgentId: (simulation as any).nextAgentId, feedingLog: (simulation as any).feedingLog }));
    simulation.step();
  }
  assert.equal(hash.digest('hex'), expected);
});
