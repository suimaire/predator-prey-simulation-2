import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { root, outputDir, protocol, protocolHash, readReport, type Candidate, type Run, type Scenario } from './calibrate-fox-observable.ts';

const entries: { id: string; scenario: Scenario; candidate: Candidate; modelCommit: string; rawSha256: string; summary: any; rows: Run[] }[] = [];
const selectionPath = resolve(root, 'docs/fox-observable-selection.json');
const selection = existsSync(selectionPath) ? JSON.parse(readFileSync(selectionPath, 'utf8')) : null;
for (const baseline of [true, false]) for (const candidate of (baseline ? [protocol.candidates[0]] : protocol.candidates) as Candidate[]) {
  for (const scenario of (baseline ? ['full-web'] : ['full-web', 'rabbit-fox', 'plant-only', 'plant-max-efficiency']) as Scenario[]) {
    const id = baseline ? 'phase2-fallback-n4' : candidate.id;
    const path = resolve(outputDir, `${id}--${scenario}.json`);
    if (!existsSync(path)) continue;
    const report = readReport({ candidate, scenario, baseline });
    entries.push({ id, scenario, candidate, modelCommit: report.modelCommit,
      rawSha256: createHash('sha256').update(readFileSync(path)).digest('hex'), summary: report.summary, rows: report.rows });
  }
}
const full = entries.filter(e => e.scenario === 'full-web');
const guards = entries.filter(e => e.scenario !== 'full-web');
const fmt = (value: number | null) => value === null ? 'N/A' : Number(value.toFixed(2)).toString();
const count = (value: { count: number; total: number }) => value.total ? `${value.count}/${value.total}` : 'N/A';
const table = (headers: string[], rows: (string | number)[][]) => [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`), ''].join('\n');
const quant = (s: any, key: string) => `${s.survival.quantileLowerBounds[key] ? '≥' : ''}${fmt(s.survival.restrictedDuration[key])}`;
const lines = ['# Observable Dynamics — reproducible results', '',
  `Protocol SHA-256: \`${protocolHash}\`. Seed domain: FOX-OBS-001…100, n=100 per condition, all retained.`, '',
  'Durations are steps **after introduction**, including descendants. Introduction is at step 0, as in Phase 2/2.1. Horizon = 600 after introduction. No pre-introduction 50-step window exists for this scenario. All runs contribute to restricted-duration type-7 quantiles; ≥ marks a bound involving right-censoring, not an extinction at 600.', '',
  'P(T≥k) includes extinction exactly at k; alive at 600 is a separate measure. Counts below are count/100 (numerically percent). Educational UX/model outcomes, **not natural red-fox survival probabilities**. These are descriptive comparisons; there is no scalar score or automatic release gate.', '',
  '## Full Web candidate matrix', '',
  table(['Candidate', 'Preference', 'Intro', 'Q25', 'Median', '≥50', '≥100', '≥150', '≥200', '≥300', 'Rabbit≤200', 'Wolf≤200', 'Interaction≤100', 'Peak max', 'Cap runs/steps/guard calls'], full.map(({ id, candidate: c, summary: s }) => [
    id, id.startsWith('phase2') ? 'fallback' : c.preference, c.introductionAmount, quant(s, 'q25'), quant(s, 'median'),
    ...[50,100,150,200,300].map(k => count(s.survival.surviveAtLeast[k])), count(s.rabbitExtinction[200]), count(s.wolfExtinction[200]),
    count(s.interaction[100].occurred), s.foxPeak.max, `${s.capRuns}/${s.capSteps}/${s.capGuardCalls}`,
  ])),
  '## Survival distribution and auxiliary horizon results', '',
  table(['Candidate', 'Min', 'P10', 'Q25', 'Median', 'Q75', 'Max/bound', '≥500', 'Alive/censored600', 'Extinct exactly600', 'All three600', 'Extinct<50'], full.map(({ id, summary: s }) => [id,
    ...['min','p10','q25','median','q75','max'].map(k => quant(s, k)), count(s.survival.surviveAtLeast[500]), count(s.survival.aliveAtHorizon),
    count(s.survival.extinctExactlyAtHorizon), count(s.coexistAtHorizon), count(s.survival.extinctBefore50),
  ])),
  '## Rabbit and wolf extinction guardrails', '',
  table(['Candidate', 'Rabbit≤50', '≤100', '≤200', '≤300', '≤600', 'Wolf≤50', '≤100', '≤200', '≤300', '≤600'], full.map(({ id, summary: s }) => [id,
    ...['rabbitExtinction','wolfExtinction'].flatMap(key => [50,100,200,300,600].map(w => count(s[key][w]))),
  ])),
  '## Vegetation and actual energy diet', '',
  'Vegetation mean/median/minimum pool the 600 post-introduction samples per run with equal weighting. Collapse = <5% for ≥10 consecutive steps within 200; <1% is an additional descriptive flag. Neither alone proves an effect caused by fox feeding. Full run-level distributions are in the JSON summary.', '',
  table(['Candidate', 'Veg mean%', 'Median%', 'Min%', 'Collapse≤200', 'Any<1%≤200', 'Rabbit/plant pooled%', 'Rabbit/plant run median%', 'Rabbit dominant'], full.map(({ id, summary: s }) => [id,
    fmt(s.vegetation.mean), fmt(s.vegetation.median), fmt(s.vegetation.minimum), count(s.vegetation.earlyCollapse), count(s.vegetation.belowOneWithin200),
    `${fmt(s.diet.rabbitPooledPercent)}/${fmt(s.diet.rabbitPooledPercent === null ? null : 100-s.diet.rabbitPooledPercent)}`,
    `${fmt(s.diet.rabbitRunPercent.median)}/${fmt(s.diet.plantMedianPercent)}`, count(s.diet.rabbitDominantRuns),
  ])),
  '## Interaction windows', '',
  'Event and energy columns are totals over all 100 runs; probability columns are counts. Births are separate from the kill-or-plant interaction definition. JSON additionally records per-run quantiles and means for each metric.', '',
  table(['Candidate', 'Window', 'Hunt attempts', 'Kills', 'Plant events', 'Rabbit energy', 'Plant energy', 'Births', 'Interaction', 'Reproduced'], full.flatMap(({ id, summary: s }) => [50,100,200].map(w => {
    const v = s.interaction[w]; return [id,w,...['rabbitHuntAttempts','rabbitKills','plantFeedingEvents','rabbitEnergy','plantEnergy','foxBirths'].map(k=>fmt(v.metrics[k].total)),count(v.occurred),count(v.reproduced)];
  }))),
  '## Additional guardrails', '',
  table(['Candidate', 'Scenario', 'Q25', 'Median', '≥100', '≥200', 'Alive600', 'Rabbit≤100/200/600', 'Interaction≤100', 'Births total', 'Growth/repeated runs', 'Peak max', 'Cap runs', 'Veg mean/min%', 'Collapse≤200'], guards.map(({ id, scenario, summary: s }) => [id,scenario,quant(s,'q25'),quant(s,'median'),
    count(s.survival.surviveAtLeast[100]),count(s.survival.surviveAtLeast[200]),count(s.survival.aliveAtHorizon),
    [100,200,600].map(w=>count(s.rabbitExtinction[w])).join(' / '),count(s.interaction[100].occurred),s.births.total,
    `${s.populationGrowthRuns}/${s.repeatedGrowthRuns}`,s.foxPeak.max,s.capRuns,`${fmt(s.vegetation.mean)}/${fmt(s.vegetation.minimum)}`,count(s.vegetation.earlyCollapse),
  ])),
  '## Full Web trajectory changes', '',
  'Endpoint deltas compare elapsed step 100/200 with the pre-action initial metric. Direction counts = increase / unchanged / decrease. These are changes over time, not causal effects versus a fox-free control. Window-mean delta distributions are retained in JSON.', '',
  table(['Candidate', 'Window', 'Rabbit Δ median', '↑/=/↓', 'Wolf Δ median', '↑/=/↓', 'Vegetation Δ median pp', '↑/=/↓'], full.flatMap(({id,summary:s})=>[100,200].map(w=>[id,w,
    ...['rabbit','wolf','vegetation'].flatMap(k=>{ const v=s.changes[w][k];return [fmt(v.endpoint.median),`${v.directions.increase}/${v.directions.unchanged}/${v.directions.decrease}`]; }),
  ]))),
  '## Time at configured simulation speeds', '',
  'Q25 / median seconds, calculated as steps ÷ step/s. Rendering stalls/background throttling may lengthen wall-clock time; pausing does not change dynamics.', '',
  table(['Candidate', '8 step/s', '20 step/s', '40 step/s'],full.map(({id,summary:s})=>[id,...[8,20,40].map(speed=>`${fmt(s.seconds[speed].q25)} / ${fmt(s.seconds[speed].median)}`)])),
];

let representatives: any[] = [];
const chosen = full.find(e => e.id === selection?.selectedCandidate);
if (chosen) {
  const rows = chosen.rows;
  const nearest = (target: number) => [...rows].sort((a,b)=>Math.abs(a.survival.duration-target)-Math.abs(b.survival.duration-target)||a.seed.localeCompare(b.seed))[0];
  const targets = { q25: chosen.summary.survival.restrictedDuration.q25, median: chosen.summary.survival.restrictedDuration.median,
    long: Math.max(...rows.map(r=>r.survival.duration)) };
  representatives = Object.entries(targets).map(([label,target])=>{
    const row=nearest(target);
    writeFileSync(resolve(outputDir,`trajectory-${label}-${row.seed}.csv`), ['elapsed,absoluteStep,rabbit,wolf,fox,vegetationPercent',
      ...row.trajectory.map(m=>[m.elapsed,m.step,m.rabbit,m.wolf,m.fox,m.vegetation].join(','))].join('\n')+'\n');
    return { label, seed:row.seed, survival:row.survival, foxPeak:row.foxPeak, events:row.events,
      checkpoints:row.trajectory.filter(m=>[0,25,50,100,150,200,300,500,600,row.survival.duration].includes(m.elapsed)) };
  });
  lines.push('## Deterministic representative trajectories', '',
    'Nearest Q25, nearest median, longest observed duration; ties resolved by ascending seed. All 100 runs remain in every aggregate. Per-step CSV is under verification.local/fox-observable/.', '',
    table(['Role','Seed','Duration','Peak','Step','Rabbit','Wolf','Fox','Vegetation%'],representatives.flatMap(r=>r.checkpoints.map((m: any)=>[r.label,r.seed,`${r.survival.censored?'≥':''}${r.survival.duration}`,r.foxPeak,m.elapsed,m.rabbit,m.wolf,m.fox,fmt(m.vegetation)]))));
}
const compact = entries.map(({ rows, ...entry })=>entry);
// One condition per JSON line keeps the versioned machine summary compact;
// human review uses the Markdown/CSV tables, while raw runs stay gitignored.
writeFileSync(resolve(root,'docs/fox-observable-summary.json'),[
  '{', `"protocolHash":${JSON.stringify(protocolHash)},`,
  `"baseCommit":${JSON.stringify(protocol.baseCommit)},`, `"baselineCommit":${JSON.stringify(protocol.baselineCommit)},`,
  `"selection":${JSON.stringify(selection)},`, '"entries":[', compact.map(e=>JSON.stringify(e)).join(',\n'),
  '],', `"representatives":${JSON.stringify(representatives)}`, '}',
].join('\n')+'\n');
writeFileSync(resolve(root,'docs/fox-observable-results.md'),lines.join('\n').trimEnd()+'\n');
const headers=['candidate','scenario','preference','intro','min','p10','q25','median','q75','restrictedMax','censored600','p50','p100','p150','p200','p300','p500',
  'rabbitExt50','rabbitExt100','rabbitExt200','rabbitExt300','rabbitExt600','wolfExt50','wolfExt100','wolfExt200','wolfExt300','wolfExt600',
  'interaction50','interaction100','interaction200','foxPeakMax','capRuns','capSteps','capGuardCalls','vegMean','vegMedian','vegMin','vegCollapse200','rabbitPooledEnergyPercent'];
const csv = entries.map(({id,scenario,candidate:c,summary:s})=>[id,scenario,id.startsWith('phase2')?'fallback':c.preference,c.introductionAmount,
  ...['min','p10','q25','median','q75','max'].map(k=>s.survival.restrictedDuration[k]),s.survival.aliveAtHorizon.count,
  ...[50,100,150,200,300,500].map(k=>s.survival.surviveAtLeast[k].proportion),
  ...['rabbitExtinction','wolfExtinction'].flatMap(k=>[50,100,200,300,600].map(w=>s[k][w].proportion)),
  ...[50,100,200].map(w=>s.interaction[w].occurred.proportion),s.foxPeak.max,s.capRuns,s.capSteps,s.capGuardCalls,s.vegetation.mean,s.vegetation.median,s.vegetation.minimum,s.vegetation.earlyCollapse.proportion,s.diet.rabbitPooledPercent,
]);
writeFileSync(resolve(root,'docs/fox-observable-summary.csv'),[headers,...csv].map(r=>r.join(',')).join('\n')+'\n');
console.log(table(['Candidate','Q25','Median','≥100','≥200','R≤100/200','W≤100/200','Veg collapse','Peak'],full.map(({id,summary:s})=>[id,quant(s,'q25'),quant(s,'median'),count(s.survival.surviveAtLeast[100]),count(s.survival.surviveAtLeast[200]),
  `${count(s.rabbitExtinction[100])}/${count(s.rabbitExtinction[200])}`,`${count(s.wolfExtinction[100])}/${count(s.wolfExtinction[200])}`,count(s.vegetation.earlyCollapse),s.foxPeak.max])));
console.log(`Wrote ${entries.length} condition summaries and ${representatives.length} representative trajectories.`);
