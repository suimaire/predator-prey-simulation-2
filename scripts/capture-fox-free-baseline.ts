// One-shot baseline capture. ALWAYS loads the immutable Phase 1.1 Git object,
// never today's model. Refuses to overwrite a reviewed fixture.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { baselineCommit, scenarios, intervene, exactState } from '../tests/fixtures/fox-free-scenarios.ts';

const directory = mkdtempSync(join(tmpdir(), 'fox-baseline-'));
try {
  for (const file of ['model.ts', 'challenge.ts']) {
    writeFileSync(join(directory, file), execFileSync('git', ['show', `${baselineCommit}:src/${file}`]));
  }
  const { DEFAULT_PARAMETERS, ForestSimulation } = await import(pathToFileURL(join(directory, 'model.ts')).href);
  const { ApexChallengeSession, apexParameters } = await import(pathToFileURL(join(directory, 'challenge.ts')).href);
  const results = [];
  for (const scenario of scenarios) {
    let parameters = { ...DEFAULT_PARAMETERS, ...scenario.parameters };
    if (scenario.apex) parameters = apexParameters(parameters);
    const simulation = new ForestSimulation(parameters);
    const challenge = scenario.apex ? new ApexChallengeSession() : null;
    challenge?.start(parameters, simulation.getHistory()[0]);
    const hashes = [];
    for (let step = 0; step <= scenario.steps; step++) {
      if (scenario.interventions) intervene(simulation, step);
      hashes.push(createHash('sha256').update(exactState(simulation, challenge)).digest('hex'));
      if (step === scenario.steps || challenge?.getState().phase === 'over') break;
      const metric = simulation.step(); challenge?.acceptStep(metric);
    }
    results.push({ name: scenario.name, hashes, challenge: challenge?.getState() ?? null });
  }
  writeFileSync(new URL('../tests/fixtures/fox-free-baseline.json', import.meta.url), JSON.stringify({ baselineCommit, results }, null, 2) + '\n', { flag: 'wx' });
  console.log(results.map(result => ({ name: result.name, samples: result.hashes.length, collapse: result.challenge?.collapseStep, score: result.challenge?.score })));
} finally { rmSync(directory, { recursive: true, force: true }); }
