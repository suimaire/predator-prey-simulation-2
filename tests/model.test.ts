import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PARAMETERS, ForestSimulation, validateParameters } from '../src/model.ts';

test('같은 seed와 파라미터는 같은 변화를 만든다', () => {
  const first = new ForestSimulation({ ...DEFAULT_PARAMETERS });
  const second = new ForestSimulation({ ...DEFAULT_PARAMETERS });
  for (let index = 0; index < 80; index += 1) {
    first.step();
    second.step();
  }
  assert.deepEqual(first.getHistory(), second.getHistory());
  assert.deepEqual([...first.getSnapshot().forest], [...second.getSnapshot().forest]);
  assert.deepEqual(first.getSnapshot().rabbits, second.getSnapshot().rabbits);
  assert.deepEqual(first.getSnapshot().wolves, second.getSnapshot().wolves);
});

test('다른 seed는 다른 초기 숲 분포를 만든다', () => {
  const first = new ForestSimulation({ ...DEFAULT_PARAMETERS, seed: 'FOREST-A' });
  const second = new ForestSimulation({ ...DEFAULT_PARAMETERS, seed: 'FOREST-B' });
  assert.notDeepEqual([...first.getSnapshot().forest], [...second.getSnapshot().forest]);
});

test('모든 동물은 격자 안에서 한 칸에 한 마리만 존재한다', () => {
  const simulation = new ForestSimulation({ ...DEFAULT_PARAMETERS, seed: 'INVARIANT-CHECK' });
  for (let step = 0; step < 180; step += 1) {
    simulation.step();
    const snapshot = simulation.getSnapshot();
    const occupied = new Set<string>();
    for (const agent of [...snapshot.rabbits, ...snapshot.wolves]) {
      assert.ok(agent.x >= 0 && agent.x < snapshot.width);
      assert.ok(agent.y >= 0 && agent.y < snapshot.height);
      assert.ok(agent.energy >= 0);
      const key = `${agent.x},${agent.y}`;
      assert.equal(occupied.has(key), false, `${key} 칸에 동물이 겹쳤습니다.`);
      occupied.add(key);
    }
    for (const stage of snapshot.forest) {
      assert.ok(stage >= 0 && stage <= snapshot.maxForestStage);
    }
  }
});

test('동물이 없으면 숲은 확률적으로 다시 자란다', () => {
  const simulation = new ForestSimulation({
    ...DEFAULT_PARAMETERS,
    initialRabbits: 0,
    initialWolves: 0,
    initialForestDensity: 0,
    forestRegrowth: 0.25,
    seed: 'REGROWTH',
  });
  const initialTotal = [...simulation.getSnapshot().forest].reduce((sum, stage) => sum + stage, 0);
  for (let index = 0; index < 20; index += 1) simulation.step();
  const grownTotal = [...simulation.getSnapshot().forest].reduce((sum, stage) => sum + stage, 0);
  assert.ok(grownTotal > initialTotal);
});

test('늑대의 사냥은 누적 통계에 기록된다', () => {
  const simulation = new ForestSimulation({
    ...DEFAULT_PARAMETERS,
    gridColumns: 20,
    initialRabbits: 80,
    initialWolves: 35,
    wolfMoveDistance: 4,
    seed: 'HUNT-CHECK',
  });
  for (let index = 0; index < 5; index += 1) simulation.step();
  const stats = simulation.getSnapshot().stats;
  assert.ok(stats.rabbitsHunted > 0);
  assert.ok(stats.rabbitDeaths >= stats.rabbitsHunted);
});

test('잘못된 파라미터는 안전 범위로 제한된다', () => {
  const validated = validateParameters({
    ...DEFAULT_PARAMETERS,
    gridColumns: 999,
    initialRabbits: -100,
    forestRegrowth: Number.POSITIVE_INFINITY,
    wolfEnergyCost: -5,
    seed: '',
  });
  assert.equal(validated.gridColumns, 48);
  assert.equal(validated.initialRabbits, 0);
  assert.equal(validated.forestRegrowth, 0);
  assert.equal(validated.wolfEnergyCost, 0.1);
  assert.equal(validated.seed, DEFAULT_PARAMETERS.seed);
});
