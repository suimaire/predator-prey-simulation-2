import { writeFileSync } from 'node:fs';
import { DEFAULT_PARAMETERS, ForestSimulation, FOX_CONFIG } from '../src/model.ts';

// Development-only harness; no tuning controls or metrics are exposed in the app.
export const calibrationSeeds = Array.from({ length: 50 }, (_, index) => `FOX-CAL-${String(index + 1).padStart(3, '0')}`);
export function runScenario(seed: string, scenario: string, steps = 600, tuning: Record<string, unknown> = {}) {
  const plant = scenario.startsWith('plant'), empty = scenario === 'no-food';
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, seed,
    initialRabbits: plant || empty ? 0 : 50,
    initialWolves: scenario === 'full-web' || scenario === 'wolf-control' ? 8 : 0,
    initialForestDensity: empty ? 0 : plant ? 100 : 78,
    forestRegrowth: empty ? 0 : 0.1,
    transferEfficiency: scenario === 'plant-max-efficiency' ? 0.3 : 0.1,
  });
  if (empty) simulation.getSnapshot().forest.fill(0);
  // Override only fox config in this development process, never core parameters.
  (simulation as any).configs = { ...(simulation as any).configs, fox: {
    ...FOX_CONFIG, ...tuning,
    omnivory: { ...FOX_CONFIG.omnivory, ...(tuning.omnivory as object ?? {}) },
  } };
  if (scenario !== 'wolf-control') simulation.introduceSpecies('fox', 4);
  let rabbitExtinction: number | null = null, wolfExtinction: number | null = null, foxExtinction: number | null = null;
  let peakFox = scenario === 'wolf-control' ? 0 : 4, rabbitEnergy = 0, plantEnergy = 0, forestTotal = 0;
  const checkpoints: Record<number, number[]> = {};
  for (let step = 1; step <= steps; step++) {
    const metric = simulation.step();
    const fox = metric.fox ?? 0;
    peakFox = Math.max(peakFox, fox); forestTotal += metric.forestPercent;
    if (metric.rabbits === 0 && rabbitExtinction === null) rabbitExtinction = step;
    if (metric.wolves === 0 && wolfExtinction === null) wolfExtinction = step;
    if (fox === 0 && foxExtinction === null) foxExtinction = step;
    const diet = simulation.getFoxDiet(1); rabbitEnergy += diet.rabbitEnergy; plantEnergy += diet.plantEnergy;
    if ([20, 50, 100, 200, 600].includes(step)) checkpoints[step] = [metric.rabbits, metric.wolves, fox];
  }
  return { seed, foxExtinction, rabbitExtinction, wolfExtinction, peakFox,
    finalFox: simulation.getSnapshot().agents.fox?.length ?? 0,
    births: simulation.getSnapshot().stats.births.fox ?? 0,
    rabbitEnergy, plantEnergy, meanForestPercent: forestTotal / steps, checkpoints };
}

export function summarize(rows: ReturnType<typeof runScenario>[]) {
  const mean = (values: number[]) => values.reduce((a,b) => a+b, 0) / values.length;
  const median = (values: number[]) => { const sorted = [...values].sort((a,b) => a-b); return (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.ceil((sorted.length-1)/2)]) / 2; };
  const shares = rows.map(r => r.rabbitEnergy + r.plantEnergy > 0 ? 100 * r.plantEnergy / (r.rabbitEnergy + r.plantEnergy) : 0);
  return { seeds: rows.length, foxSurvive: rows.filter(r => r.finalFox > 0).length,
    rabbitExtinct: rows.filter(r => r.rabbitExtinction !== null).length,
    wolfExtinct: rows.filter(r => r.wolfExtinction !== null).length,
    earlyFoxExtinct20: rows.filter(r => r.foxExtinction !== null && r.foxExtinction <= 20).length,
    earlyRabbitExtinct20: rows.filter(r => r.rabbitExtinction !== null && r.rabbitExtinction <= 20).length,
    earlyWolfExtinct20: rows.filter(r => r.wolfExtinction !== null && r.wolfExtinction <= 20).length,
    foxSurvive100: rows.filter(r => r.checkpoints[100]?.[2] > 0).length,
    capHits: rows.filter(r => r.peakFox >= FOX_CONFIG.populationCap!).length,
    maxPeakFox: Math.max(...rows.map(r => r.peakFox)), meanBirths: mean(rows.map(r => r.births)),
    medianSurvival: median(rows.map(r => r.foxExtinction ?? 600)),
    meanPlantShare: mean(shares), medianPlantShare: median(shares),
    meanForestPercent: mean(rows.map(r => r.meanForestPercent)),
  };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/calibrate-fox.ts')) {
  const count = Number(process.env.FOX_SEEDS ?? 50);
  const tuning = JSON.parse(process.env.FOX_TUNING ?? '{}');
  const output = process.env.FOX_REPORT ?? 'docs/fox-calibration.json';
  const results: Record<string, unknown> = {};
  for (const scenario of ['no-food', 'plant-only', 'plant-max-efficiency', 'rabbit-fox', 'full-web', 'wolf-control']) {
    const rows = calibrationSeeds.slice(0, count).map(seed => runScenario(seed, scenario, 600, tuning));
    results[scenario] = { summary: summarize(rows), rows };
    console.log(scenario, JSON.stringify(summarize(rows)));
  }
  writeFileSync(output, JSON.stringify({ steps: 600, config: { ...FOX_CONFIG, ...tuning }, results }, null, 2) + '\n');
}
