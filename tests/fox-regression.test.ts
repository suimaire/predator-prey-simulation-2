import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DEFAULT_PARAMETERS, ForestSimulation, type SimulationParameters } from '../src/model.ts';
import { ApexChallengeSession, apexParameters } from '../src/challenge.ts';
import { baselineCommit, scenarios, intervene, exactState } from './fixtures/fox-free-scenarios.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/fox-free-baseline.json', import.meta.url), 'utf8'));
assert.equal(fixture.baselineCommit, baselineCommit);
for (const scenario of scenarios) test(`Phase 1.1 exact state + RNG + graph + energy + Apex: ${scenario.name}`, () => {
  let parameters = { ...DEFAULT_PARAMETERS, ...scenario.parameters } as SimulationParameters;
  if (scenario.apex) parameters = apexParameters(parameters);
  const simulation = new ForestSimulation(parameters);
  const challenge = scenario.apex ? new ApexChallengeSession() : null;
  challenge?.start(parameters, simulation.getHistory()[0]);
  const expected = fixture.results.find((item: any) => item.name === scenario.name);
  for (let step = 0; step < expected.hashes.length; step++) {
    if (scenario.interventions) intervene(simulation, step);
    assert.equal(createHash('sha256').update(exactState(simulation, challenge)).digest('hex'), expected.hashes[step], `step ${step}`);
    if (step < expected.hashes.length - 1) {
      const metric = simulation.step();
      challenge?.acceptStep(metric);
    }
  }
  assert.deepEqual(challenge?.getState() ?? null, expected.challenge);
});
