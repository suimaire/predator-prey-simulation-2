import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as current from '../src/model.ts';

// Fixed before the first tuning run. validateParameters accepts trimmed strings
// up to 40 characters; these two disjoint domains are never selected by outcome.
export const calibrationSeeds = Array.from({ length: 50 }, (_, i) => `FOX-CAL-${String(i + 1).padStart(3, '0')}`);
export const holdoutSeeds = Array.from({ length: 50 }, (_, i) => `FOX-HOLDOUT-${String(i + 1).padStart(3, '0')}`);
export const baselineCommit = 'e476ff83d08168a9f9e2d8d44fb49c73a3ec6c3d';
const outputDir = resolve('verification.local/fox-coexistence');
mkdirSync(outputDir, { recursive: true });
const steps = 600;
type Tuning = { preference: number; gain: number; basal?: number; reproduction?: number; hunt?: number };
export const stageA: Tuning[] = [.80, .75, .67].flatMap(preference => [.5, .7, .9].map(gain => ({ preference, gain })));

async function baselineModel() {
  const path = resolve(outputDir, 'baseline-model.ts');
  const source = execFileSync('git', ['show', `${baselineCommit}:src/model.ts`], { encoding: 'utf8' });
  writeFileSync(path, source);
  return import(pathToFileURL(path).href);
}

// Observational development-only wrappers. No replacement dynamics, no random
// draws, no production diagnostics fields. The baseline is loaded from Git.
export function runDiagnostic(model: typeof current, seed: string, scenario: string, tuning?: Tuning, observe = true) {
  const plant = scenario.startsWith('plant'), control = scenario === 'wolf-control';
  const sim = new model.ForestSimulation({ ...model.DEFAULT_PARAMETERS, seed,
    initialRabbits: plant ? 0 : 50, initialWolves: scenario === 'full-web' || control ? 8 : 0,
    initialForestDensity: plant ? 100 : 78, forestRegrowth: .1,
    transferEfficiency: scenario === 'plant-max-efficiency' ? .3 : .1,
  });
  const internal = sim as any;
  if (tuning) internal.configs = { ...internal.configs, fox: { ...model.FOX_CONFIG,
    basalEnergyCost: tuning.basal ?? model.FOX_CONFIG.basalEnergyCost,
    reproductionProbability: tuning.reproduction ?? model.FOX_CONFIG.reproductionProbability,
    omnivory: { ...model.FOX_CONFIG.omnivory, rabbitPreference: tuning.preference,
      plantNominalGain: tuning.gain, huntSuccess: tuning.hunt ?? model.FOX_CONFIG.omnivory!.huntSuccess },
  } };
  if (!control) sim.introduceSpecies('fox', 4);
  const d = { opportunities: 0, rabbitAvailable: 0, bothAvailable: 0, hunts: 0,
    successfulHunts: 0, plantEvents: 0, rabbitEnergy: 0, plantEnergy: 0,
    reproductionEligible: 0, starvation: 0, ageDeaths: 0, starvationBeforeThreshold: 0,
    energySum: 0, energySamples: 0, energyMin: Infinity, wolfFirst: 0, foxFirst: 0,
    wolfFirstLostRabbitOpportunity: 0, plantWhileRabbitsPresent: 0 };
  let feeding = false, reproducing = false, preyAvailable = false;
  const everEligible = new Set<number>();
  const neighbors = internal.neighbors.bind(sim), reproduce = internal.tryReproduce.bind(sim);
  const omnivore = internal.processOmnivore.bind(sim), predator = internal.processPredator.bind(sim);
  const record = internal.recordFeeding.bind(sim), integer = internal.random.integer.bind(internal.random);
  let firstPredator: string | null = null;
  if (observe) {
    internal.processOmnivore = (species: string) => {
      if (firstPredator === null) { firstPredator = species; d.foxFirst++; }
      preyAvailable = false; feeding = true; omnivore(species); feeding = false;
    };
    internal.processPredator = (species: string) => {
      const wolfFirst = species === 'wolf' && firstPredator === null && (internal.agents.fox?.length ?? 0) > 0;
      if (firstPredator === null) { firstPredator = species; if (wolfFirst) d.wolfFirst++; }
      const hasPrey = (fox: any) => {
        const cells = neighbors(fox, internal.configs.fox.movement.distance);
        return cells.some((cell: any) => internal.agents.rabbit.some((r: any) => r.x === cell.x && r.y === cell.y));
      };
      const before = wolfFirst ? (internal.agents.fox ?? []).filter(hasPrey) : [];
      predator(species);
      d.wolfFirstLostRabbitOpportunity += before.filter((fox: any) => !hasPrey(fox)).length;
    };
    internal.neighbors = (agent: any, distance: number) => {
      const cells = neighbors(agent, distance);
      if (feeding && !reproducing && agent.species === 'fox') {
        const occupied = internal.occupiedMap();
        preyAvailable = cells.some((cell: any) => occupied.get(internal.positionKey(cell))?.species === 'rabbit');
        d.opportunities++;
        if (preyAvailable) { d.rabbitAvailable++; if (internal.forest[internal.index(agent.x, agent.y)] > 0) d.bothAvailable++; }
      }
      return cells;
    };
    internal.random.integer = (maximum: number) => {
      if (feeding && !reproducing && preyAvailable) d.hunts++;
      return integer(maximum);
    };
    internal.recordFeeding = (source: string, target: string, gain: number) => {
      const energy = record(source, target, gain);
      if (target === 'fox') {
        if (source === 'rabbit') { d.successfulHunts++; d.rabbitEnergy += energy; }
        else { d.plantEvents++; d.plantEnergy += energy; if (internal.agents.rabbit.length > 0) d.plantWhileRabbitsPresent++; }
      }
      return energy;
    };
    internal.tryReproduce = (agent: any, config: any, occupied: any, newborns: any) => {
      if (agent.species === 'fox') {
        d.energySum += agent.energy; d.energySamples++; d.energyMin = Math.min(d.energyMin, agent.energy);
        if (agent.energy >= config.reproductionThreshold) { d.reproductionEligible++; everEligible.add(agent.id); }
      }
      reproducing = true; reproduce(agent, config, occupied, newborns); reproducing = false;
      if (agent.species === 'fox') {
        if (agent.energy <= 0) { d.starvation++; if (!everEligible.has(agent.id)) d.starvationBeforeThreshold++; }
        else if (agent.age >= config.maxAge) d.ageDeaths++;
        preyAvailable = false;
      }
    };
  }
  const initial = sim.getHistory()[0];
  let foxExtinction: number | null = null, rabbitExtinction: number | null = null, wolfExtinction: number | null = null;
  let peakFox = control ? 0 : 4, minRabbit = initial.rabbits, minForest = initial.forestPercent;
  let forestTotal = 0, finalForest = initial.forestPercent, capSteps = 0, latePeakFox = 0, allThreeSteps = 0;
  const checkpoints: Record<number, number[]> = {};
  for (let step = 1; step <= steps; step++) {
    firstPredator = null;
    const m = sim.step(), fox = m.fox ?? 0;
    if (!control && fox === 0 && foxExtinction === null) foxExtinction = step;
    if (initial.rabbits > 0 && m.rabbits === 0 && rabbitExtinction === null) rabbitExtinction = step;
    if (initial.wolves > 0 && m.wolves === 0 && wolfExtinction === null) wolfExtinction = step;
    peakFox = Math.max(peakFox, fox); minRabbit = Math.min(minRabbit, m.rabbits);
    minForest = Math.min(minForest, m.forestPercent); forestTotal += m.forestPercent; finalForest = m.forestPercent;
    if (fox >= model.FOX_CONFIG.populationCap!) capSteps++;
    if (step >= 400) latePeakFox = Math.max(latePeakFox, fox);
    if (fox > 0 && m.rabbits > 0 && m.wolves > 0) allThreeSteps++;
    if ([20,50,100,200,400,600].includes(step)) checkpoints[step] = [m.rabbits,m.wolves,fox];
  }
  const s = sim.getSnapshot();
  return { seed, foxExtinction, rabbitExtinction, wolfExtinction, peakFox, minRabbit,
    finalFox: s.agents.fox?.length ?? 0, finalRabbit: s.rabbits.length, finalWolf: s.wolves.length,
    births: s.stats.births.fox ?? 0, deaths: s.stats.deaths.fox ?? 0, capSteps, latePeakFox, allThreeSteps,
    minForest, finalForest, meanForest: forestTotal / steps, checkpoints,
    ...d, energyMean: d.energySamples ? d.energySum / d.energySamples : null,
    energyMin: Number.isFinite(d.energyMin) ? d.energyMin : null,
    rng: internal.random.state,
    stateHash: createHash('sha256').update(JSON.stringify([sim,[...internal.foxFoodWindow]])).digest('hex'),
  };
}
const mean = (v: number[]) => v.length ? v.reduce((a,b) => a+b,0)/v.length : null;
const quantile = (v: number[], q: number) => {
  if (!v.length) return null;
  const s = [...v].sort((a,b)=>a-b), n = (s.length-1)*q;
  return s[Math.floor(n)] + (s[Math.ceil(n)]-s[Math.floor(n)])*(n%1);
};
const distribution = (v: number[]) => ({ min: v.length ? Math.min(...v) : null, q25: quantile(v,.25), median: quantile(v,.5), q75: quantile(v,.75), max: v.length ? Math.max(...v) : null });
function proportion(count: number, n: number) {
  const p=count/n, z=1.96, denominator=1+z*z/n, center=(p+z*z/(2*n))/denominator;
  const margin=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denominator;
  return { count, percent: p*100, wilson95: [100*(center-margin),100*(center+margin)] };
}
export function summarize(rows: ReturnType<typeof runDiagnostic>[]) {
  const n=rows.length, sum=(key: keyof typeof rows[number])=>rows.reduce((a,r)=>a+Number(r[key]),0);
  const shares=rows.filter(r=>r.rabbitEnergy+r.plantEnergy>0).map(r=>100*r.rabbitEnergy/(r.rabbitEnergy+r.plantEnergy));
  return {
    foxSurvival: proportion(rows.filter(r=>r.finalFox>0).length,n),
    rabbitExtinction: proportion(rows.filter(r=>r.rabbitExtinction!==null).length,n),
    wolfExtinction: proportion(rows.filter(r=>r.wolfExtinction!==null).length,n),
    wolfSurvival: proportion(rows.filter(r=>r.finalWolf>0).length,n),
    rabbitSurvival: proportion(rows.filter(r=>r.finalRabbit>0).length,n),
    finalCoexistence: proportion(rows.filter(r=>r.finalFox>0&&r.finalRabbit>0&&r.finalWolf>0).length,n),
    collapse: rows.filter(r=>r.finalFox+r.finalWolf+r.finalRabbit===0).length,
    foxExtinctionSteps: distribution(rows.flatMap(r=>r.foxExtinction===null?[]:[r.foxExtinction])),
    rabbitExtinctionSteps: distribution(rows.flatMap(r=>r.rabbitExtinction===null?[]:[r.rabbitExtinction])),
    wolfExtinctionSteps: distribution(rows.flatMap(r=>r.wolfExtinction===null?[]:[r.wolfExtinction])),
    // Censored persistence is separate from medians conditioned on extinction.
    foxPersistence: distribution(rows.map(r=>r.foxExtinction??steps)),
    finalFox: distribution(rows.map(r=>r.finalFox)), peakFox: distribution(rows.map(r=>r.peakFox)),
    finalRabbit: distribution(rows.map(r=>r.finalRabbit)), finalWolf: distribution(rows.map(r=>r.finalWolf)),
    rabbitMinimum: distribution(rows.map(r=>r.minRabbit)), latePeakFox: distribution(rows.map(r=>r.latePeakFox)),
    meanBirths: mean(rows.map(r=>r.births)), noBirthRuns: rows.filter(r=>r.births===0).length,
    capRuns: rows.filter(r=>r.capSteps>0).length, capSteps: sum('capSteps'),
    dietRabbitMedian: quantile(shares,.5), dietPlantMedian: shares.length ? 100-quantile(shares,.5)! : null,
    rabbitEnergy: sum('rabbitEnergy'), plantEnergy: sum('plantEnergy'),
    forestMinimum: distribution(rows.map(r=>r.minForest)), forestFinal: distribution(rows.map(r=>r.finalForest)),
    meanForest: mean(rows.map(r=>r.meanForest)),
    diagnostics: Object.fromEntries(['opportunities','rabbitAvailable','bothAvailable','hunts','successfulHunts','plantEvents','reproductionEligible','starvation','ageDeaths','starvationBeforeThreshold','wolfFirst','foxFirst','wolfFirstLostRabbitOpportunity','plantWhileRabbitsPresent'].map(k=>[k,sum(k as any)])),
    energyMean: sum('energySamples') ? sum('energySum')/sum('energySamples') : null,
    energyMinimum: distribution(rows.flatMap(r=>r.energyMin===null?[]:[r.energyMin])),
  };
}

async function runBatch(label: string, model: typeof current, seeds: string[], scenarios: string[], tuning?: Tuning) {
  const path=resolve(outputDir,`${label}.json`);
  if (existsSync(path) && process.env.FOX_OVERWRITE !== '1') throw new Error(`Refusing to overwrite ${path}; use FOX_OVERWRITE=1 for an intentional repeat`);
  const results: Record<string, any> = {};
  for (const scenario of scenarios) {
    const rows=seeds.map(seed=>runDiagnostic(model,seed,scenario,tuning));
    results[scenario]={ summary: summarize(rows), rows };
    console.log(label,scenario,JSON.stringify({fox:results[scenario].summary.foxSurvival.count,rabbitExtinct:results[scenario].summary.rabbitExtinction.count,wolf:results[scenario].summary.wolfSurvival.count,cap:results[scenario].summary.capRuns}));
  }
  const report={baselineCommit,steps,seeds,tuning:tuning??null,results};
  writeFileSync(path,JSON.stringify(report,null,2)+'\n');
  return Object.fromEntries(Object.entries(results).map(([key,value])=>[key,value.summary]));
}

if (!isMainThread) {
  const { label, tuning } = workerData;
  parentPort!.postMessage(await runBatch(label,current,calibrationSeeds,['plant-only','rabbit-fox','full-web'],tuning));
} else if (process.argv[1]?.replaceAll('\\','/').endsWith('/calibrate-fox-coexistence.ts')) {
  const mode=process.argv[2]??'baseline';
  const scenarios=['plant-only','rabbit-fox','full-web'];
  if (mode==='baseline') {
    const baseline=await baselineModel();
    const result=await runBatch('baseline-calibration',baseline,calibrationSeeds,[...scenarios,'plant-max-efficiency','wolf-control']);
    // Verify instrumentation itself preserves complete model behavior and RNG.
    for(const scenario of scenarios) {
      const observed=runDiagnostic(baseline,calibrationSeeds[0],scenario);
      const plain=runDiagnostic(baseline,calibrationSeeds[0],scenario,undefined,false);
      for(const key of ['stateHash','rng','checkpoints','births','deaths','peakFox','minForest','finalForest']) {
        if(JSON.stringify(observed[key])!==JSON.stringify(plain[key]))throw new Error(`Observer changed ${scenario} ${key}`);
      }
    }
    writeFileSync(resolve(outputDir,'baseline-summary.json'),JSON.stringify(result,null,2)+'\n');
  } else if (mode==='audit') {
    for (const model of [await baselineModel(), current]) for (const scenario of scenarios) {
      const observed=runDiagnostic(model,'FOX-OBSERVER-AUDIT',scenario);
      const plain=runDiagnostic(model,'FOX-OBSERVER-AUDIT',scenario,undefined,false);
      assert.equal(observed.stateHash,plain.stateHash,`Observer changed state: ${scenario}`);
      assert.equal(observed.starvation+observed.ageDeaths,observed.deaths);
      assert.equal(observed.finalFox,4+observed.births-observed.deaths);
      assert.ok(observed.hunts<=observed.rabbitAvailable);
      assert.ok(observed.successfulHunts<=observed.hunts);
    }
    const seeds=[...calibrationSeeds,...holdoutSeeds];
    assert.equal(new Set(seeds).size,100);
    const states=seeds.map(seed=> {
      assert.equal(current.validateParameters({...current.DEFAULT_PARAMETERS,seed}).seed,seed);
      return (new current.ForestSimulation({...current.DEFAULT_PARAMETERS,seed}) as any).random.state;
    });
    assert.equal(new Set(states).size,100);
    console.log('Observer exact state/RNG, accounting and 100 disjoint valid seed states: PASS');
  } else if (mode==='stage-a' || mode==='stage-b') {
    if(!existsSync(resolve(outputDir,'baseline-calibration.json')))throw new Error('Save baseline before tuning');
    const selection=JSON.parse(readFileSync(resolve('docs/fox-coexistence-selection.json'),'utf8'));
    const candidates=mode==='stage-a'?stageA:selection.stageBCandidates as Tuning[];
    if(!candidates.length)throw new Error('Stage B requires explicitly diagnosed candidates');
    const result: Record<string, unknown>={};
    const jobs = [...candidates];
    async function worker() { while (jobs.length) {
      const tuning = jobs.shift()!;
      const label=`${mode}-p${tuning.preference}-g${tuning.gain}${mode==='stage-b'?`-b${tuning.basal??1.7}-r${tuning.reproduction??.018}-h${tuning.hunt??.7}`:''}`;
      const results = await new Promise((resolve,reject) => {
        const task = new Worker(new URL(import.meta.url), { workerData: { label, tuning } });
        task.once('message',resolve); task.once('error',reject);
        task.once('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}`)); });
      });
      result[label]={tuning,results};
    } }
    await Promise.all(Array.from({length:Math.min(3,candidates.length)},worker));
    const ordered=Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
    writeFileSync(resolve(outputDir,`${mode}-summary.json`),JSON.stringify(ordered,null,2)+'\n');
  } else if (mode==='validate') {
    const selection=JSON.parse(readFileSync(resolve('docs/fox-coexistence-selection.json'),'utf8'));
    const tuning=selection.tuning as Tuning;
    // Written BEFORE holdout evaluation; never tune against these results.
    await runBatch('selected-calibration-high',current,calibrationSeeds,['plant-max-efficiency'],tuning);
    await runBatch('selected-holdout',current,holdoutSeeds,[...scenarios,'plant-max-efficiency','wolf-control'],tuning);
    await runBatch('baseline-holdout',await baselineModel(),holdoutSeeds,[...scenarios,'plant-max-efficiency','wolf-control']);
  } else throw new Error(`Unknown mode: ${mode}`);
}
