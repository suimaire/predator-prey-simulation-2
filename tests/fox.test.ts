import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PARAMETERS, FOOD_SOURCES, FOX_CONFIG, ForestSimulation, activeSpecies, speciesConfigs, type Agent } from '../src/model.ts';
import { InterventionSession, interventionLabel } from '../src/interventions.ts';
import { foodWebMarkup } from '../src/foodWebView.ts';
import { drawPopulationChart, SERIES_COLORS } from '../src/charts.ts';
import { populationChange } from '../src/feedback.ts';
import { runScenario, summarize } from '../scripts/calibrate-fox.ts';

const advance = (sim: ForestSimulation, n: number) => { for (let i=0;i<n;i++) sim.step(); };
function feedingFixture(rabbits = 0, efficiency = .1) {
  const sim = new ForestSimulation({ ...DEFAULT_PARAMETERS, initialRabbits: 0, initialWolves: 0, transferEfficiency: efficiency, forestRegrowth: 0 });
  sim.introduceSpecies('fox', 1);
  if (rabbits) sim.introduceSpecies('rabbit', rabbits);
  const fox = sim.getSnapshot().agents.fox![0] as Agent;
  Object.assign(fox, { x: 4, y: 4, energy: 10 });
  sim.getSnapshot().rabbits.forEach((rabbit, index) => Object.assign(rabbit, { x: 5, y: 4+index }));
  const internal = sim as any;
  internal.configs = { ...internal.configs, fox: { ...FOX_CONFIG, reproductionProbability: 0, movement: { probability: 0, distance: 1 } } };
  return { sim, fox, internal, feed: () => internal.processOmnivore('fox') };
}

test('fox is independent, runtime-only, omnivorous, with exactly the permitted edges', () => {
  const sim = new ForestSimulation({ ...DEFAULT_PARAMETERS, foodChainDepth: 4 });
  assert.deepEqual(activeSpecies(2), ['rabbit','wolf']);
  assert.deepEqual(activeSpecies(4), ['rabbit','wolf','tertiary','quaternary']);
  assert.equal(sim.getSnapshot().agents.fox, undefined);
  assert.equal(speciesConfigs(sim.getParameters()).fox.trophicLevel, null);
  assert.deepEqual(FOOD_SOURCES, { rabbit:['vegetation'], wolf:['rabbit'], fox:['rabbit','vegetation'], tertiary:['wolf'], quaternary:['tertiary'] });
});

test('Step 500 fox transaction preserves current ecosystem, initial parameters and every graph sample; reset is exact', () => {
  const sim = new ForestSimulation({ ...DEFAULT_PARAMETERS, seed:'FOX-INTRO' });
  const initial = structuredClone(sim.getSnapshot());
  advance(sim,500);
  const before = structuredClone(sim.getSnapshot()), history = structuredClone(sim.getHistory());
  let running=true;
  const session = new InterventionSession({ simulation:()=>sim, isFree:()=>true, isRunning:()=>running, setRunning:value=>running=value });
  assert.equal(session.begin(),500); assert.equal(running,false);
  assert.equal(session.confirm('introduce','fox',4)?.amount,4);
  session.cancel(); assert.equal(running,false);
  const after=sim.getSnapshot(); assert.equal(after.step,500);
  for (const key of ['rabbits','wolves','tertiary','quaternary','forest'] as const) assert.deepEqual(after[key],before[key]);
  assert.deepEqual(sim.getHistory().slice(0,history.length),history);
  assert.equal(after.agents.fox!.length,4);
  assert.equal(sim.getParameters().foodChainDepth,2);
  sim.reset(); assert.deepEqual(sim.getSnapshot(),initial);
  assert.equal(sim.getFoxDiet().rabbitPercent,null); assert.deepEqual(sim.getActiveSpecies(),['rabbit','wolf']);
});

test('fox partial Fisher–Yates, full removal, reintroduction, IDs and action sequence replay deterministically', () => {
  const first=new ForestSimulation({...DEFAULT_PARAMETERS,seed:'FOX-REPLAY'}), second=new ForestSimulation({...DEFAULT_PARAMETERS,seed:'FOX-REPLAY'});
  for (const sim of [first,second]) {
    advance(sim,8); sim.introduceSpecies('fox',8);
    const before=[...sim.getSnapshot().agents.fox!];
    sim.removeSpecies('fox',4);
    assert.equal(sim.getSnapshot().agents.fox!.length,4);
    sim.getSnapshot().agents.fox!.forEach(agent=>assert.ok(before.includes(agent)));
    assert.equal(new Set(sim.getSnapshot().agents.fox!.map(a=>a.id)).size,4);
    sim.removeSpecies('wolf',4); sim.removeSpecies('rabbit',3); advance(sim,12);
    const rng=JSON.stringify((sim as any).random); sim.removeSpecies('fox');
    assert.equal(JSON.stringify((sim as any).random),rng);
    assert.ok(sim.getActiveSpecies().includes('fox')); assert.equal(sim.getHistory().at(-1)!.fox,0);
    sim.introduceSpecies('fox',4); advance(sim,50);
    assert.match(interventionLabel(sim.getInterventions()[0]),/붉은여우 \+8/);
    assert.match(interventionLabel(sim.getInterventions()[1]),/붉은여우 −4/);
  }
  assert.deepEqual(first.getSnapshot(),second.getSnapshot()); assert.deepEqual(first.getHistory(),second.getHistory());
  assert.deepEqual((first as any).random,(second as any).random);
});

test('successful hunt removes exactly one rabbit and never consumes vegetation in that step', () => {
  const {sim,fox,internal,feed}=feedingFixture(2); const forest=sim.getSnapshot().forest.slice();
  internal.random.next=()=>0;
  feed();
  assert.equal(sim.getSnapshot().rabbits.length,1);
  assert.equal(fox.energy,10-FOX_CONFIG.basalEnergyCost+FOX_CONFIG.nominalFoodGainAtTenPercent);
  assert.deepEqual(sim.getSnapshot().forest,forest);
  assert.equal(sim.getSnapshot().stats.deaths.rabbit,1);
  assert.equal(internal.feedingLog.length,1); assert.equal(internal.feedingLog[0].source,'rabbit');
});

test('failed hunt retains rabbit and disallows same-step plant fallback despite available plants', () => {
  const {sim,fox,internal,feed}=feedingFixture(1); const forest=sim.getSnapshot().forest.slice();
  internal.random.next=()=>.99; feed();
  assert.equal(sim.getSnapshot().rabbits.length,1); assert.deepEqual(sim.getSnapshot().forest,forest);
  assert.equal(fox.energy,10-FOX_CONFIG.basalEnergyCost); assert.equal(internal.feedingLog.length,0);
});

test('plant feeding consumes one finite stage, honors all edible stages, and shares transfer-efficiency contract', () => {
  for (const efficiency of [.05,.1,.3]) for (const stage of [0,1,2,4]) {
    const {sim,fox,internal,feed}=feedingFixture(0,efficiency);
    const index=4*sim.getSnapshot().width+4; sim.getSnapshot().forest[index]=stage;
    feed(); assert.equal(sim.getSnapshot().forest[index],Math.max(0,stage-1));
    const gain=stage>0 ? FOX_CONFIG.omnivory!.plantNominalGain/.1*efficiency : 0;
    assert.equal(fox.energy,10-FOX_CONFIG.basalEnergyCost+gain);
    assert.equal(internal.feedingLog.length,stage>0?1:0);
    assert.equal(sim.getSnapshot().stats.forestEaten,stage>0?1:0);
  }
});

test('rabbit-food gain applies efficiency exactly once too', () => {
  for (const efficiency of [.05,.1,.3]) {
    const {sim,fox,internal,feed}=feedingFixture(1,efficiency); internal.random.next=()=>0; feed();
    assert.equal(fox.energy,10-FOX_CONFIG.basalEnergyCost+FOX_CONFIG.nominalFoodGainAtTenPercent/.1*efficiency);
    assert.equal(sim.getEnergyFlow().find(f=>f.target==='fox'&&f.source==='vegetation')!.eventCount,0);
  }
});

test('no food continues metabolism and death; natural extinction retains runtime history', () => {
  const {sim,fox,internal,feed}=feedingFixture(); sim.getSnapshot().forest.fill(0); fox.energy=.1; feed();
  assert.equal(sim.getSnapshot().agents.fox!.length,0); assert.equal(sim.getSnapshot().stats.deaths.fox,1);
  assert.equal(internal.feedingLog.length,0); assert.ok(sim.getActiveSpecies().includes('fox'));
});

test('fox never hunts higher consumers and higher consumers never hunt fox', () => {
  const {sim,internal,feed}=feedingFixture();
  for (const [i,species] of (['wolf','tertiary','quaternary'] as const).entries()) {
    sim.introduceSpecies(species,1); Object.assign(sim.getSnapshot().agents[species][0],{x:3+i,y:3});
  }
  const ids=sim.getActiveSpecies().flatMap(s=>sim.getSnapshot().agents[s]!.map(a=>a.id));
  internal.random.next=()=>0; feed();
  assert.deepEqual(sim.getActiveSpecies().flatMap(s=>sim.getSnapshot().agents[s]!.map(a=>a.id)),ids);
  for (const species of ['wolf','tertiary','quaternary'] as const) {
    const isolated=feedingFixture().sim; isolated.introduceSpecies(species,1);
    Object.assign(isolated.getSnapshot().agents[species][0],{x:5,y:4});
    (isolated as any).processPredator(species);
    assert.equal(isolated.getSnapshot().agents.fox!.length,1);
  }
});

test('wolf/fox order is reproducible and approximately balanced; extinct fox consumes no order draw', () => {
  function order(seed:string) {
    const sim=new ForestSimulation({...DEFAULT_PARAMETERS,initialRabbits:0,initialWolves:0,seed}); sim.introduceSpecies('fox',1);
    const internal=sim as any, sequence:string[]=[];
    internal.growForest=()=>{}; internal.processRabbits=()=>{};
    internal.processPredator=(s:string)=>sequence.push(s); internal.processOmnivore=(s:string)=>sequence.push(s);
    advance(sim,1000);
    const first=sequence.filter((_,i)=>i%2===0);
    assert.ok(first.filter(s=>s==='fox').length>430 && first.filter(s=>s==='fox').length<570);
    sim.removeSpecies('fox'); const before=JSON.stringify(internal.random); sim.step();
    assert.equal(JSON.stringify(internal.random),before); return sequence;
  }
  assert.deepEqual(order('ORDER-CHECK'),order('ORDER-CHECK'));
});

test('food-flow records separate actual energies, 50-step diet is energy-weighted, bounded and zero-safe', () => {
  const {sim,internal}=feedingFixture();
  internal.recordFeeding('rabbit','fox',160); internal.recordFeeding('vegetation','fox',80); internal.stepNumber=1;
  assert.equal(sim.getFoxDiet().rabbitEnergy,160); assert.equal(sim.getFoxDiet().plantEnergy,80);
  assert.ok(Math.abs(sim.getFoxDiet().rabbitPercent! - 200/3) < 1e-10);
  assert.ok(Math.abs(sim.getFoxDiet().plantPercent! - 100/3) < 1e-10);
  assert.equal(sim.getEnergyFlow(50).find(f=>f.target==='fox'&&f.source==='rabbit')!.eventCount,1);
  // Force the legacy event buffer to evict entries: aggregate diet must remain complete.
  for(let i=0;i<8100;i++) internal.recordFeeding('vegetation','rabbit',5);
  assert.equal(sim.getFoxDiet().rabbitEnergy,160);
  internal.stepNumber=50; assert.equal(sim.getFoxDiet().rabbitEnergy,160);
  internal.stepNumber=51; assert.equal(sim.getFoxDiet().rabbitPercent,null);
  for(let step=52;step<1100;step++) { internal.stepNumber=step; internal.recordFeeding('vegetation','fox',.5); sim.step(); }
  assert.ok(internal.foxFoodWindow.size<=480); assert.ok(internal.feedingLog.length<=8000);
});

test('population cap, shared empty-cell limit and invalid introductions are atomic', () => {
  const sim=new ForestSimulation({...DEFAULT_PARAMETERS,initialRabbits:0,initialWolves:0});
  sim.introduceSpecies('fox',80); assert.equal(sim.getIntroductionLimit('fox'),0);
  const before=JSON.stringify(sim); assert.equal(sim.introduceSpecies('fox',1),false); assert.equal(JSON.stringify(sim),before);
  for(const amount of [0,-1,1.5,NaN,Infinity]) assert.equal(sim.removeSpecies('fox',amount),false);
  for (const fox of sim.getSnapshot().agents.fox!) Object.assign(fox,{energy:100});
  advance(sim,2); assert.ok(sim.getSnapshot().agents.fox!.length<=80);
  const snapshot=sim.getSnapshot(), cells=new Set<string>();
  for (const species of sim.getActiveSpecies()) for (const agent of snapshot.agents[species]!) {
    const cell=`${agent.x},${agent.y}`; assert.equal(cells.has(cell),false); cells.add(cell);
  }
});

test('fox extinct view has one count, omnivore label, zero-safe diet and two energy sources', () => {
  const {sim}=feedingFixture(); sim.removeSpecies('fox');
  const html=foodWebMarkup(sim.getSnapshot(),sim.getFoxDiet(),sim.getEnergyFlow(),'energy','core-chain');
  assert.equal((html.match(/data-fox-count/g)??[]).length,1); assert.match(html,/data-fox-count>0/);
  assert.match(html,/잡식/); assert.match(html,/최근 섭식 없음/); assert.match(html,/식물성 먹이 → 붉은여우/);
  assert.match(html,/토끼 → 붉은여우/); assert.doesNotMatch(html,/NaN|undefined/);
  assert.equal(populationChange(4,'fox',sim.getHistory()[0]).delta,4);
});

test('fox graph has pre-introduction zero, intervention markers, extinction zero and a 480-sample rolling window', t => {
  const prev=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{devicePixelRatio:1}});
  t.after(()=>prev?Object.defineProperty(globalThis,'window',prev):Reflect.deleteProperty(globalThis,'window'));
  const sim=new ForestSimulation({...DEFAULT_PARAMETERS}); advance(sim,5); sim.introduceSpecies('fox',4); sim.removeSpecies('fox',2); sim.removeSpecies('fox');
  const points:number[][]=[],colors:string[]=[];
  const ctx:any={strokeStyle:'',setTransform(){},clearRect(){},save(){},restore(){},translate(){},rotate(){},beginPath(){},moveTo(x:number,y:number){points.push([x,y])},lineTo(x:number,y:number){points.push([x,y])},setLineDash(){},stroke(){colors.push(this.strokeStyle)},fillText(){}};
  const canvas:any={width:640,height:260,title:'',getBoundingClientRect:()=>({width:640,height:260}),getContext:()=>ctx};
  drawPopulationChart(canvas,{history:sim.getHistory(),depth:2,runtimeSpecies:sim.getActiveSpecies(),visibleSeries:new Set(['fox']),interventions:sim.getInterventions()});
  assert.ok(colors.includes(SERIES_COLORS.fox)); assert.ok(points.flat().every(Number.isFinite));
  assert.match(canvas.title,/붉은여우 \+4/); assert.match(canvas.title,/붉은여우 −2/);
  assert.equal(sim.getHistory()[0].fox,undefined); assert.equal(sim.getHistory().at(-1)!.fox,0);
  advance(sim,500); assert.equal(sim.getHistory().length,480); assert.ok(sim.getHistory().every(m=>m.fox===0));
});

test('representative calibration guards plant-only growth, early crashes and cap pathology', () => {
  const seeds=Array.from({length:6},(_,i)=>`FOX-CAL-${String(i+1).padStart(3,'0')}`);
  for (const scenario of ['plant-only','plant-max-efficiency']) {
    const rows=seeds.map(seed=>runScenario(seed,scenario));
    assert.ok(rows.every(r=>r.births===0&&r.finalFox===0&&r.peakFox===4));
  }
  for (const scenario of ['rabbit-fox','full-web']) {
    const summary=summarize(seeds.map(seed=>runScenario(seed,scenario)));
    assert.equal(summary.capHits,0); assert.equal(summary.earlyFoxExtinct20,0); assert.equal(summary.earlyRabbitExtinct20,0);
  }
});
