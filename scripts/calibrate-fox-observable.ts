import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as product from '../src/model.ts';
import { distribution, earlyVegetationCollapse, mean, proportion, survivalObservation, summarizeSurvival } from './fox-observable-metrics.ts';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const protocol = JSON.parse(readFileSync(resolve(root, 'docs/fox-observable-protocol.json'), 'utf8'));
export const outputDir = resolve(root, 'verification.local/fox-observable');
export type Candidate = { id: string; preference: number; introductionAmount: number };
export type Scenario = 'full-web' | 'rabbit-fox' | 'plant-only' | 'plant-max-efficiency';
type Model = typeof product;
type Metric = { elapsed: number; step: number; rabbit: number; wolf: number; fox: number; vegetation: number };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const protocolHash = hash(readFileSync(resolve(root, 'docs/fox-observable-protocol.json'), 'utf8').replaceAll('\r\n', '\n'));

export async function loadModel(commit: string): Promise<Model> {
  assert.ok([protocol.baseCommit, protocol.baselineCommit].includes(commit));
  mkdirSync(outputDir, { recursive: true });
  const path = resolve(outputDir, `model-${commit}.ts`);
  const source = execFileSync('git', ['show', `${commit}:src/model.ts`], { cwd: root, encoding: 'utf8' });
  // Each worker reads the immutable extraction prepared by the parent.
  if (!existsSync(path)) writeFileSync(path, source);
  assert.equal(hash(readFileSync(path, 'utf8').replaceAll('\r\n', '\n')), hash(source.replaceAll('\r\n', '\n')));
  return import(pathToFileURL(path).href);
}

const emptyEvents = () => ({ rabbitHuntAttempts: 0, rabbitKills: 0, plantFeedingEvents: 0, rabbitEnergy: 0, plantEnergy: 0, foxBirths: 0 });
type Events = ReturnType<typeof emptyEvents>;

export function runObservable(model: Model, seed: string, scenario: Scenario, candidate: Candidate,
  options: { observe?: boolean; introductionStep?: number; horizon?: number; baseline?: boolean } = {}) {
  const horizon = options.horizon ?? protocol.horizonAfterIntroduction;
  const introductionStep = options.introductionStep ?? protocol.introductionStep;
  const sim = new model.ForestSimulation({ ...model.DEFAULT_PARAMETERS, ...protocol.scenarios[scenario], seed });
  // Private members are accessed only in this development harness. No dynamics
  // are replaced: only the requested preference and introduction amount vary.
  const internal = sim as any;
  if (!options.baseline) internal.configs = { ...internal.configs, fox: { ...model.FOX_CONFIG,
    omnivory: { ...model.FOX_CONFIG.omnivory, rabbitPreference: candidate.preference },
  } };
  const metric = (m: product.PopulationMetric): Metric => ({ elapsed: m.step - introductionStep, step: m.step,
    rabbit: m.rabbits, wolf: m.wolves, fox: m.fox ?? 0, vegetation: m.forestPercent });
  const preTrajectory = [metric(sim.getHistory()[0])];
  for (let i = 0; i < introductionStep; i++) preTrajectory.push(metric(sim.step()));
  const before = preTrajectory.at(-1)!;
  assert.ok(sim.introduceSpecies('fox', candidate.introductionAmount), 'Introduction must succeed completely');
  assert.equal(sim.getSnapshot().agents.fox!.length, candidate.introductionAmount);
  const trajectory = [metric(sim.getHistory().at(-1)!)];
  const events = emptyEvents(), windows: Record<number, Events> = {};
  let inFox = false, reproducing = false, pendingHunt = false;
  let foragingMap: Map<number, product.Agent> | null = null;
  let capGuardCalls = 0;
  if (options.observe !== false) {
    const omnivore = internal.processOmnivore.bind(sim), occupiedMap = internal.occupiedMap.bind(sim);
    const neighbors = internal.neighbors.bind(sim), integer = internal.random.integer.bind(internal.random);
    const record = internal.recordFeeding.bind(sim), reproduce = internal.tryReproduce.bind(sim);
    internal.processOmnivore = (species: string) => {
      inFox = species === 'fox'; pendingHunt = false; foragingMap = null;
      try { return omnivore(species); } finally { inFox = false; pendingHunt = false; }
    };
    internal.occupiedMap = () => {
      const map = occupiedMap();
      if (inFox && !reproducing) foragingMap = map;
      return map;
    };
    internal.neighbors = (agent: product.Agent, distance: number) => {
      const cells = neighbors(agent, distance);
      if (inFox && !reproducing && agent.species === 'fox') {
        // Observe the actual per-pass map, which removes rabbits killed earlier
        // in the same pass; rebuilding from agents would count stale prey.
        assert.ok(foragingMap);
        pendingHunt = cells.some((cell: any) => foragingMap!.get(internal.positionKey(cell))?.species === 'rabbit');
      }
      return cells;
    };
    internal.random.integer = (maximum: number) => {
      if (inFox && !reproducing && pendingHunt) { events.rabbitHuntAttempts++; pendingHunt = false; }
      return integer(maximum);
    };
    internal.recordFeeding = (source: string, target: string, gain: number) => {
      const energy = record(source, target, gain);
      if (target === 'fox' && source === 'rabbit') { events.rabbitKills++; events.rabbitEnergy += energy; }
      if (target === 'fox' && source === 'vegetation') { events.plantFeedingEvents++; events.plantEnergy += energy; }
      return energy;
    };
    internal.tryReproduce = (agent: product.Agent, config: product.SpeciesConfig, occupied: unknown, newborns: product.Agent[]) => {
      pendingHunt = false;
      if (agent.species === 'fox' && internal.agents.fox.length + newborns.length >= config.populationCap!) capGuardCalls++;
      reproducing = true;
      try { return reproduce(agent, config, occupied, newborns); } finally { reproducing = false; }
    };
  }
  let foxExtinctAt: number | null = null;
  let rabbitExtinction: number | null = before.rabbit === 0 ? null : -1;
  let wolfExtinction: number | null = before.wolf === 0 ? null : -1;
  let capSteps = 0, growthSteps = 0;
  for (let elapsed = 1; elapsed <= horizon; elapsed++) {
    const m = metric(sim.step()); trajectory.push(m);
    if (m.fox === 0 && foxExtinctAt === null) foxExtinctAt = m.step;
    if (m.rabbit === 0 && rabbitExtinction === -1) rabbitExtinction = elapsed;
    if (m.wolf === 0 && wolfExtinction === -1) wolfExtinction = elapsed;
    if (m.fox >= model.FOX_CONFIG.populationCap!) capSteps++;
    if (m.fox > trajectory.at(-2)!.fox) growthSteps++;
    events.foxBirths = sim.getSnapshot().stats.births.fox ?? 0;
    if (protocol.interaction.windows.includes(elapsed)) windows[elapsed] = { ...events };
  }
  const vegetation = trajectory.slice(1).map(m => m.vegetation);
  const preWindow = preTrajectory.filter(m => m.elapsed >= -50 && m.elapsed < 0);
  const deltas = Object.fromEntries([100, 200].filter(w => w <= horizon).map(w => {
    const window = trajectory.slice(1, w + 1), end = trajectory[w];
    const delta = (reference: Metric) => Object.fromEntries((['rabbit', 'wolf', 'vegetation'] as const).map(key => [key, {
      endpoint: end[key] - reference[key], windowMean: mean(window.map(m => m[key]))! - reference[key],
    }]));
    const preReference = preWindow.length === 50 ? { ...before,
      rabbit: mean(preWindow.map(m => m.rabbit))!, wolf: mean(preWindow.map(m => m.wolf))!, vegetation: mean(preWindow.map(m => m.vegetation))!,
    } : null;
    return [w, { versusInitial: delta(before), versusPre50Mean: preReference ? delta(preReference) : null, foxPeak: Math.max(...window.map(m => m.fox)) }];
  }));
  const snapshot = sim.getSnapshot();
  return { seed, scenario, candidate: candidate.id, introductionStep, horizon, introduced: candidate.introductionAmount,
    survival: survivalObservation(introductionStep, foxExtinctAt, horizon), foxExtinctAt,
    rabbitInitiallyPresent: before.rabbit > 0, wolfInitiallyPresent: before.wolf > 0,
    rabbitExtinction: rabbitExtinction === -1 ? null : rabbitExtinction, wolfExtinction: wolfExtinction === -1 ? null : wolfExtinction,
    events: { ...events }, windows, foxPeak: Math.max(...trajectory.map(m => m.fox)),
    capSteps, capGuardCalls, growthSteps, foxDeaths: snapshot.stats.deaths.fox ?? 0,
    vegetation: { mean: mean(vegetation)!, median: distribution(vegetation).median!, min: Math.min(...vegetation),
      earlyCollapse: earlyVegetationCollapse(vegetation), belowOneWithin200: vegetation.slice(0, 200).some(v => v < 1) },
    before, pre50Available: preWindow.length === 50, deltas, final: trajectory.at(-1)!,
    // Functions are ignored by JSON, matching the unobserved model serialization.
    stateHash: hash(JSON.stringify([sim, [...internal.foxFoodWindow]])), rng: internal.random.state,
    trajectory: [...preTrajectory.slice(0, -1), ...trajectory],
  };
}
export type Run = ReturnType<typeof runObservable>;

export function summarize(rows: Run[]) {
  assert.ok(rows.length);
  const n = rows.length, sum = (key: keyof Events) => rows.reduce((a, r) => a + r.events[key], 0);
  const extinction = (species: 'rabbit' | 'wolf') => {
    const applicable = rows.filter(r => r[`${species}InitiallyPresent`]);
    return Object.fromEntries(protocol.extinctionGuardrails.windows.map((w: number) => [w,
      proportion(applicable.filter(r => r[`${species}Extinction`] !== null && r[`${species}Extinction`]! <= w).length, applicable.length)]));
  };
  const shares = rows.filter(r => r.events.rabbitEnergy + r.events.plantEnergy > 0)
    .map(r => 100 * r.events.rabbitEnergy / (r.events.rabbitEnergy + r.events.plantEnergy));
  const totalEnergy = sum('rabbitEnergy') + sum('plantEnergy');
  const changes = Object.fromEntries([100, 200].map(w => [w, Object.fromEntries((['rabbit', 'wolf', 'vegetation'] as const).map(species => {
    const values = rows.map(r => (r.deltas[w].versusInitial[species] as any).endpoint as number);
    const means = rows.map(r => (r.deltas[w].versusInitial[species] as any).windowMean as number);
    return [species, { endpoint: distribution(values), windowMean: distribution(means),
      directions: { increase: values.filter(v => v > 0).length, unchanged: values.filter(v => v === 0).length, decrease: values.filter(v => v < 0).length } }];
  }))]));
  return { runs: n, survival: summarizeSurvival(rows.map(r => r.survival), rows[0].horizon),
    coexistAtHorizon: proportion(rows.filter(r => r.final.rabbit > 0 && r.final.wolf > 0 && r.final.fox > 0).length, n),
    rabbitExtinction: extinction('rabbit'), wolfExtinction: extinction('wolf'),
    interaction: Object.fromEntries(protocol.interaction.windows.map((w: number) => [w, {
      occurred: proportion(rows.filter(r => r.windows[w].rabbitKills + r.windows[w].plantFeedingEvents > 0).length, n),
      reproduced: proportion(rows.filter(r => r.windows[w].foxBirths > 0).length, n),
      metrics: Object.fromEntries(Object.keys(emptyEvents()).map(key => [key, {
        total: rows.reduce((a, r) => a + r.windows[w][key as keyof Events], 0),
        mean: mean(rows.map(r => r.windows[w][key as keyof Events])), ...distribution(rows.map(r => r.windows[w][key as keyof Events])),
      }])),
    }])),
    foxPeak: distribution(rows.map(r => r.foxPeak)),
    capRuns: rows.filter(r => r.capSteps > 0 || r.capGuardCalls > 0).length,
    capSteps: rows.reduce((a, r) => a + r.capSteps, 0), capGuardCalls: rows.reduce((a, r) => a + r.capGuardCalls, 0),
    births: { total: sum('foxBirths'), ...distribution(rows.map(r => r.events.foxBirths)) },
    populationGrowthRuns: rows.filter(r => r.growthSteps > 0).length, repeatedGrowthRuns: rows.filter(r => r.growthSteps > 1).length,
    vegetation: { mean: mean(rows.map(r => r.vegetation.mean)), median: distribution(rows.flatMap(r => r.trajectory.filter(m => m.elapsed > 0).map(m => m.vegetation))).median,
      minimum: Math.min(...rows.map(r => r.vegetation.min)), runMeans: distribution(rows.map(r => r.vegetation.mean)),
      runMedians: distribution(rows.map(r => r.vegetation.median)), runMinima: distribution(rows.map(r => r.vegetation.min)),
      earlyCollapse: proportion(rows.filter(r => r.vegetation.earlyCollapse).length, n), belowOneWithin200: proportion(rows.filter(r => r.vegetation.belowOneWithin200).length, n) },
    diet: { rabbitEnergy: sum('rabbitEnergy'), plantEnergy: sum('plantEnergy'),
      rabbitPooledPercent: totalEnergy ? 100 * sum('rabbitEnergy') / totalEnergy : null,
      rabbitRunPercent: distribution(shares), plantMedianPercent: shares.length ? 100 - distribution(shares).median! : null,
      rabbitDominantRuns: proportion(shares.filter(s => s > 50).length, shares.length) },
    changes,
    seconds: Object.fromEntries([8, 20, 40].map(speed => [speed, Object.fromEntries(Object.entries(distribution(rows.map(r => r.survival.duration))).map(([key, value]) => [key, value! / speed]))])),
  };
}

type Job = { candidate: Candidate; scenario: Scenario; baseline?: boolean };
const jobId = (job: Job) => `${job.baseline ? 'phase2-fallback-n4' : job.candidate.id}--${job.scenario}`;
async function runJob(job: Job) {
  const path = resolve(outputDir, `${jobId(job)}.json`);
  if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}. Preserve/archive a previous evaluation explicitly before repeating.`);
  const model = await loadModel(job.baseline ? protocol.baselineCommit : protocol.baseCommit);
  const rows = protocol.seeds.map((seed: string) => runObservable(model, seed, job.scenario, job.candidate, { baseline: job.baseline }));
  const report = { protocolHash, modelCommit: job.baseline ? protocol.baselineCommit : protocol.baseCommit, job, summary: summarize(rows), rows };
  writeFileSync(path, JSON.stringify(report) + '\n');
  return { id: jobId(job), median: report.summary.survival.restrictedDuration.median, p100: report.summary.survival.surviveAtLeast[100].count };
}
async function batch(jobs: Job[]) {
  await loadModel(protocol.baseCommit); await loadModel(protocol.baselineCommit);
  const remaining = [...jobs];
  async function work() {
    while (remaining.length) {
      const job = remaining.shift()!;
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: job });
        worker.once('message', resolve); worker.once('error', reject);
        worker.once('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}`)); });
      });
      console.log(JSON.stringify(result));
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, work));
}

export function readReport(job: Job) {
  const report = JSON.parse(readFileSync(resolve(outputDir, `${jobId(job)}.json`), 'utf8'));
  assert.equal(report.protocolHash, protocolHash, 'Protocol changed after evaluation');
  assert.deepEqual(report.rows.map((r: Run) => r.seed), protocol.seeds, 'Every fixed seed must be present in order');
  return report;
}

export async function audit() {
  assert.equal(protocol.seeds.length, 100); assert.equal(new Set(protocol.seeds).size, 100);
  const states = protocol.seeds.map((seed: string) => {
    assert.match(seed, /^FOX-OBS-\d{3}$/);
    assert.equal(product.validateParameters({ ...product.DEFAULT_PARAMETERS, seed }).seed, seed);
    return (new product.ForestSimulation({ ...product.DEFAULT_PARAMETERS, seed }) as any).random.state;
  });
  assert.equal(new Set(states).size, 100);
  assert.equal(product.FOX_CONFIG.omnivory!.plantNominalGain, .5);
  assert.equal(product.validateParameters({ ...product.DEFAULT_PARAMETERS, transferEfficiency: Infinity }).transferEfficiency, .05);
  assert.equal(product.validateParameters({ ...product.DEFAULT_PARAMETERS, transferEfficiency: 1 }).transferEfficiency, .3);
  const currentSource = execFileSync('git', ['show', `${protocol.baseCommit}:src/model.ts`], { cwd: root, encoding: 'utf8' });
  assert.equal(hash(readFileSync(resolve(root, 'src/model.ts'), 'utf8').replaceAll('\r\n', '\n')), hash(currentSource.replaceAll('\r\n', '\n')), 'Product model must stay at exact Phase 2.1 source for this evaluation');
  for (const baseline of [false, true]) {
    const model = await loadModel(baseline ? protocol.baselineCommit : protocol.baseCommit);
    for (const scenario of ['full-web', 'rabbit-fox', 'plant-only', 'plant-max-efficiency'] as Scenario[]) {
      // Audit seeds are outside the evaluation set; no extra FOX-OBS selection.
      const observed = runObservable(model, 'FOX-OBS-AUDIT', scenario, protocol.candidates[0], { baseline });
      const plain = runObservable(model, 'FOX-OBS-AUDIT', scenario, protocol.candidates[0], { baseline, observe: false });
      assert.equal(observed.stateHash, plain.stateHash); assert.equal(observed.rng, plain.rng);
      assert.deepEqual(observed.trajectory, plain.trajectory);
      assert.equal(observed.final.fox, observed.introduced + observed.events.foxBirths - observed.foxDeaths);
      assert.ok(observed.events.rabbitKills <= observed.events.rabbitHuntAttempts);
      const efficiency = protocol.scenarios[scenario].transferEfficiency;
      assert.ok(Math.abs(observed.events.rabbitEnergy - observed.events.rabbitKills * 8 * efficiency / .1) < 1e-8);
      assert.ok(Math.abs(observed.events.plantEnergy - observed.events.plantFeedingEvents * .5 * efficiency / .1) < 1e-8);
    }
  }
  console.log('PASS: 100 fixed valid seeds/unique RNG states; exact product source; observers preserve state/RNG/trajectory for both commits and all 4 scenarios.');
}

if (!isMainThread) parentPort!.postMessage(await runJob(workerData));
else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? 'audit';
  const current: Candidate = protocol.candidates[0];
  if (mode === 'audit') await audit();
  else if (mode === 'references') {
    await batch([{ candidate: current, scenario: 'full-web', baseline: true }, { candidate: current, scenario: 'full-web' }]);
  } else if (mode === 'matrix') {
    readReport({ candidate: current, scenario: 'full-web', baseline: true });
    readReport({ candidate: current, scenario: 'full-web' });
    await batch(protocol.candidates.slice(1).map((candidate: Candidate) => ({ candidate, scenario: 'full-web' })));
  } else if (mode === 'guardrails' || mode === 'max-efficiency') {
    const selection = JSON.parse(readFileSync(resolve(root, 'docs/fox-observable-selection.json'), 'utf8'));
    const ids: string[] = mode === 'guardrails' ? selection.guardrailCandidates : [selection.selectedCandidate];
    assert.ok(ids.length >= 1 && ids.length <= 3);
    const jobs = ids.flatMap(id => {
      const candidate = protocol.candidates.find((c: Candidate) => c.id === id);
      assert.ok(candidate, 'Selection must come from the fixed matrix');
      return (mode === 'guardrails' ? ['rabbit-fox', 'plant-only'] : ['plant-max-efficiency']).map(scenario => ({ candidate, scenario } as Job));
    });
    await batch(jobs);
  } else throw new Error(`Unknown mode: ${mode}`);
}
