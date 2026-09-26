import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PARAMETERS, FOX_CONFIG, ForestSimulation, chooseFoxFoodSource, type Agent } from '../src/model.ts';
import { foodWebMarkup } from '../src/foodWebView.ts';

function fixture(rabbit: boolean, stage: number, draws: number[], efficiency = .1) {
  const sim = new ForestSimulation({ ...DEFAULT_PARAMETERS, initialRabbits: 0, initialWolves: 0,
    forestRegrowth: 0, transferEfficiency: efficiency });
  sim.introduceSpecies('fox', 1);
  if (rabbit) sim.introduceSpecies('rabbit', 1);
  const fox = sim.getSnapshot().agents.fox![0] as Agent;
  Object.assign(fox, { x: 4, y: 4, energy: 10 });
  if (rabbit) Object.assign(sim.getSnapshot().rabbits[0], { x: 5, y: 4 });
  const internal = sim as any;
  internal.configs = { ...internal.configs, fox: { ...FOX_CONFIG, reproductionProbability: 0,
    movement: { probability: 0, distance: 1 },
    omnivory: { ...FOX_CONFIG.omnivory, rabbitPreference: .75, plantNominalGain: .5 },
  } };
  sim.getSnapshot().forest.fill(4);
  const cell = 4 * sim.getSnapshot().width + 4;
  sim.getSnapshot().forest[cell] = stage;
  let calls = 0;
  internal.random.next = () => {
    assert.ok(calls < draws.length, 'unexpected RNG draw');
    return draws[calls++];
  };
  return { sim, fox, internal, cell, feed: () => {
    internal.processOmnivore('fox'); internal.stepNumber = 1;
    assert.equal(calls, draws.length, 'RNG consumption order');
  } };
}

test('source choice uses one seeded draw only for both foods, including exact threshold', () => {
  const noDraw = () => { throw new Error('source RNG must not be used'); };
  assert.equal(chooseFoxFoodSource(true, false, .75, noDraw), 'rabbit');
  assert.equal(chooseFoxFoodSource(false, true, .75, noDraw), 'vegetation');
  assert.equal(chooseFoxFoodSource(false, false, .75, noDraw), null);
  for (const [draw, expected] of [[0,'rabbit'],[.749999,'rabbit'],[.75,'vegetation'],[.999999,'vegetation']] as const) {
    let calls = 0;
    assert.equal(chooseFoxFoodSource(true, true, .75, () => { calls++; return draw; }), expected);
    assert.equal(calls, 1);
  }
});

test('both foods: source, rabbit candidate, success RNG; exactly one rabbit meal', () => {
  const { sim, fox, feed } = fixture(true, 4, [.74, 0, .69]);
  const forest = sim.getSnapshot().forest.slice();
  feed();
  assert.equal(sim.getSnapshot().rabbits.length, 0);
  assert.equal(fox.energy, 10 - FOX_CONFIG.basalEnergyCost + 8);
  assert.deepEqual(sim.getSnapshot().forest, forest);
  assert.equal(sim.getFoxDiet().rabbitEnergy, 8);
  assert.equal(sim.getFoxDiet().plantEnergy, 0);
});

test('rabbit selected and hunt fails at boundary: no fallback, retry, meal or vegetation loss', () => {
  const { sim, fox, feed } = fixture(true, 4, [.1, 0, .70]);
  const forest = sim.getSnapshot().forest.slice();
  feed();
  assert.equal(sim.getSnapshot().rabbits.length, 1);
  assert.deepEqual(sim.getSnapshot().forest, forest);
  assert.equal(fox.energy, 10 - FOX_CONFIG.basalEnergyCost);
  assert.equal(sim.getSnapshot().stats.feedingEvents.fox, 0);
  assert.equal(sim.getFoxDiet().rabbitEnergy + sim.getFoxDiet().plantEnergy, 0);
});

test('plant selected: no hunt/candidate RNG, no rabbit loss or movement, one current-cell stage', () => {
  const { sim, fox, cell, feed } = fixture(true, 1, [.75]);
  const rabbits = structuredClone(sim.getSnapshot().rabbits);
  feed();
  assert.deepEqual(sim.getSnapshot().rabbits, rabbits);
  assert.deepEqual([fox.x, fox.y], [4,4]);
  assert.equal(sim.getSnapshot().forest[cell], 0);
  assert.equal(fox.energy, 10 - FOX_CONFIG.basalEnergyCost + .5);
  assert.equal(sim.getFoxDiet().rabbitEnergy, 0);
  assert.equal(sim.getFoxDiet().plantEnergy, .5);
});

test('rabbit only: adjacent vegetation is not available and no source-choice draw occurs', () => {
  const { sim, feed } = fixture(true, 0, [0, .69]);
  const forest = sim.getSnapshot().forest.slice();
  feed();
  assert.equal(sim.getSnapshot().rabbits.length, 0);
  assert.deepEqual(sim.getSnapshot().forest, forest);
});

test('plant only: preserves legacy movement draw without source-choice or hunt draws', () => {
  const { sim, cell, feed } = fixture(false, 2, [.99]);
  feed();
  assert.equal(sim.getSnapshot().forest[cell], 1);
  assert.equal(sim.getFoxDiet().plantEnergy, .5);
});

test('no food: only legacy movement draw, no meal, zero-safe diet and UI', () => {
  const { sim, fox, feed } = fixture(false, 0, [.99]);
  feed();
  assert.equal(fox.energy, 10 - FOX_CONFIG.basalEnergyCost);
  assert.equal(sim.getFoxDiet().rabbitPercent, null);
  assert.equal(sim.getFoxDiet().plantPercent, null);
  const html = foodWebMarkup(sim.getSnapshot(), sim.getFoxDiet(), sim.getEnergyFlow(), 'energy', 'core-chain');
  assert.match(html, /최근 섭식 없음/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('weighted plant choice honors max efficiency once and displayed diet is actual energy', () => {
  const { sim, fox, internal, feed } = fixture(true, 4, [.9], .3);
  feed();
  assert.equal(fox.energy, 10 - FOX_CONFIG.basalEnergyCost + 1.5);
  assert.equal(sim.getFoxDiet().plantEnergy, 1.5);
  internal.stepNumber = 0; internal.recordFeeding('rabbit', 'fox', 8); internal.stepNumber = 1;
  const diet = sim.getFoxDiet();
  assert.equal(diet.rabbitEnergy, 24);
  assert.equal(diet.rabbitPercent, 24 / 25.5 * 100);
  const html = foodWebMarkup(sim.getSnapshot(), diet, sim.getEnergyFlow(), 'numbers', 'core-chain');
  assert.match(html, /94%/); assert.match(html, /6%/);
  assert.doesNotMatch(html, /75%|NaN/);
});

test('weighted trajectories with the same parameters and interventions replay state, history and RNG', () => {
  const run = () => {
    const sim = new ForestSimulation({ ...DEFAULT_PARAMETERS, seed: 'FOX-CHOICE-REPLAY' });
    for (let step = 0; step < 180; step++) {
      if (step === 5 || step === 70) sim.introduceSpecies('fox', 4);
      if (step === 30) sim.removeSpecies('fox', 2);
      if (step === 80) sim.removeSpecies('wolf', 2);
      sim.step();
    }
    return JSON.stringify(sim);
  };
  assert.equal(run(), run());
});
