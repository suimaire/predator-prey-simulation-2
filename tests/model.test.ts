import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PARAMETERS,
  ForestSimulation,
  activeSpecies,
  energyGainFromFood,
  validateParameters,
  type Species,
} from '../src/model.ts';

test('기본 2차 소비자 모드는 기존 deterministic 궤적을 유지한다', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS });
  const expected = [
    [50, 8, 2068], [46, 8, 2064], [44, 9, 2072],
    [47, 9, 2068], [47, 9, 2065], [46, 9, 2058],
  ];
  for (let step = 0; step < expected.length; step += 1) {
    const metric = simulation.getHistory().at(-1)!;
    assert.deepEqual([metric.rabbits, metric.wolves, metric.forestAbundance], expected[step]);
    if (step < expected.length - 1) simulation.step();
  }
});

test('같은 seed와 모든 파라미터는 4단계 먹이사슬에서도 같은 결과를 만든다', () => {
  const parameters = { ...DEFAULT_PARAMETERS, foodChainDepth: 4 as const, seed: 'FOUR-LEVEL-REPLAY' };
  const first = new ForestSimulation(parameters);
  const second = new ForestSimulation(parameters);
  for (let index = 0; index < 120; index += 1) { first.step(); second.step(); }
  assert.deepEqual(first.getHistory(), second.getHistory());
  assert.deepEqual(first.getSnapshot().agents, second.getSnapshot().agents);
  assert.deepEqual(first.getEnergyFlow(), second.getEnergyFlow());
});

test('먹이사슬 깊이에 따라 필요한 species만 생성한다', () => {
  const basic = new ForestSimulation({ ...DEFAULT_PARAMETERS, foodChainDepth: 2 });
  const tertiary = new ForestSimulation({ ...DEFAULT_PARAMETERS, foodChainDepth: 3 });
  const quaternary = new ForestSimulation({ ...DEFAULT_PARAMETERS, foodChainDepth: 4 });
  assert.deepEqual(activeSpecies(2), ['rabbit', 'wolf']);
  assert.equal(basic.getSnapshot().tertiary.length, 0);
  assert.equal(tertiary.getSnapshot().tertiary.length, DEFAULT_PARAMETERS.initialTertiary);
  assert.equal(tertiary.getSnapshot().quaternary.length, 0);
  assert.equal(quaternary.getSnapshot().quaternary.length, DEFAULT_PARAMETERS.initialQuaternary);
});

test('상위 소비자는 실제 하위 species 섭식 사건으로 에너지를 얻는다', () => {
  const simulation = new ForestSimulation({
    ...DEFAULT_PARAMETERS,
    foodChainDepth: 4,
    gridColumns: 20,
    initialRabbits: 110,
    initialWolves: 45,
    initialTertiary: 14,
    initialQuaternary: 5,
    tertiaryMoveDistance: 5,
    quaternaryMoveDistance: 6,
    seed: 'ENERGY-FLOW-CHECK',
  });
  for (let index = 0; index < 8; index += 1) simulation.step();
  const flows = simulation.getEnergyFlow(20);
  assert.ok(flows.find((flow) => flow.target === 'tertiary')!.eventCount > 0);
  assert.ok(flows.find((flow) => flow.target === 'quaternary')!.eventCount > 0);
  assert.ok(flows.every((flow) => Number.isFinite(flow.rate) && flow.rate >= 0));
});

test('전달 효율은 섭식 에너지에 정확히 한 번 선형 적용된다', () => {
  assert.equal(energyGainFromFood(10, 0.1), 10);
  assert.equal(energyGainFromFood(10, 0.05), 5);
  assert.equal(energyGainFromFood(10, 0.3), 30);
});

test('종 제거는 개체를 즉시 0으로 만들고 Reset 전까지 고정한다', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, foodChainDepth: 4, seed: 'REMOVAL' });
  for (let index = 0; index < 5; index += 1) simulation.step();
  assert.equal(simulation.removeSpecies('wolf'), true);
  const interventionStep = simulation.getSnapshot().step;
  assert.equal(simulation.getSnapshot().wolves.length, 0);
  for (let index = 0; index < 100; index += 1) simulation.step();
  assert.equal(simulation.getSnapshot().wolves.length, 0);
  assert.deepEqual(simulation.getInterventions(), [{ step: interventionStep, species: 'wolf' }]);
  assert.equal(simulation.removeSpecies('wolf'), false);
});

test('Reset은 제거 상태와 개입 이력을 함께 초기화한다', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, foodChainDepth: 4 });
  simulation.removeSpecies('quaternary');
  simulation.reset();
  assert.deepEqual(simulation.getSnapshot().removedSpecies, []);
  assert.deepEqual(simulation.getInterventions(), []);
  assert.equal(simulation.getSnapshot().quaternary.length, DEFAULT_PARAMETERS.initialQuaternary);
});

test('모든 활성 동물은 격자 안에서 한 칸에 한 마리만 존재한다', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, foodChainDepth: 4, seed: 'INVARIANT-CHECK' });
  for (let step = 0; step < 250; step += 1) {
    simulation.step();
    const snapshot = simulation.getSnapshot();
    const occupied = new Set<string>();
    for (const species of activeSpecies(4)) {
      for (const agent of snapshot.agents[species]) {
        assert.ok(agent.x >= 0 && agent.x < snapshot.width && agent.y >= 0 && agent.y < snapshot.height);
        assert.ok(Number.isFinite(agent.energy) && agent.energy >= 0);
        const key = `${agent.x},${agent.y}`;
        assert.equal(occupied.has(key), false, `${key} 칸에 동물이 겹쳤습니다.`);
        occupied.add(key);
      }
    }
    for (const stage of snapshot.forest) assert.ok(stage >= 0 && stage <= snapshot.maxForestStage);
  }
});

test('잘못된 파라미터는 안전 범위로 제한된다', () => {
  const validated = validateParameters({
    ...DEFAULT_PARAMETERS,
    gridColumns: 999,
    foodChainDepth: 9 as 4,
    transferEfficiency: Number.POSITIVE_INFINITY,
    initialTertiary: -5,
    quaternaryEnergyCost: -1,
    seed: '',
  });
  assert.equal(validated.gridColumns, 48);
  assert.equal(validated.foodChainDepth, 4);
  assert.equal(validated.transferEfficiency, 0.05);
  assert.equal(validated.initialTertiary, 0);
  assert.equal(validated.quaternaryEnergyCost, 0.1);
  assert.equal(validated.seed, DEFAULT_PARAMETERS.seed);
});

test('여러 seed 장시간 실행에서 NaN, 음수, runaway population이 없다', () => {
  const seeds = ['STABILITY-A', 'STABILITY-B', 'STABILITY-C', 'STABILITY-D', 'STABILITY-E'];
  for (const seed of seeds) {
    const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, foodChainDepth: 4, seed });
    for (let index = 0; index < 600; index += 1) simulation.step();
    assert.equal(simulation.getHistory().length, 480, '장시간 실행에서도 그래프 이력은 제한되어야 합니다.');
    for (const metric of simulation.getHistory()) {
      const values = [metric.rabbits, metric.wolves, metric.tertiary, metric.quaternary, metric.forestPercent, metric.forestAbundance];
      assert.ok(values.every((value) => Number.isFinite(value) && value >= 0));
      assert.ok((['rabbit', 'wolf', 'tertiary', 'quaternary'] as Species[]).every((species) => simulation.getSnapshot().agents[species].length <= simulation.getSnapshot().width * simulation.getSnapshot().height));
    }
  }
});

test('10,000 step 실행에서도 그래프 이력 저장량은 고정된다', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, foodChainDepth: 4, seed: '260903' });
  for (let index = 0; index < 10_000; index += 1) simulation.step();
  assert.equal(simulation.getSnapshot().step, 10_000);
  assert.equal(simulation.getHistory().length, 480);
  assert.equal(simulation.getHistory().at(-1)!.step, 10_000);
});
