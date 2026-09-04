import assert from 'node:assert/strict';
import test from 'node:test';
import { APEX_CHALLENGE_CONFIG, apexParameters } from '../src/challenge.ts';
import { DEFAULT_PARAMETERS, ForestSimulation, validateParameters } from '../src/model.ts';
import { createFreeExplorationSeed, createInitialFreeParameters } from '../src/seed.ts';

test('자유 탐구 초기 seed는 유효한 형식으로 generator에서 만들어진다', () => {
  const parameters = createInitialFreeParameters(() => 583_721);

  assert.equal(parameters.seed, 'FOREST-583721');
  assert.match(parameters.seed, /^FOREST-\d{6}$/u);
  assert.notEqual(parameters.seed, DEFAULT_PARAMETERS.seed);
  assert.equal(validateParameters(parameters).seed, parameters.seed);
});

test('초기화 후 상태를 다시 읽어도 seed generator는 한 번만 호출된다', () => {
  let calls = 0;
  const parameters = createInitialFreeParameters(() => {
    calls += 1;
    return 42;
  });

  const firstRead = parameters.seed;
  const secondRead = parameters.seed;
  new ForestSimulation(parameters);
  new ForestSimulation(parameters);

  assert.equal(calls, 1);
  assert.equal(firstRead, 'FOREST-000042');
  assert.equal(secondRead, firstRead);
});

test('생성된 같은 seed는 시뮬레이션 결과를 재현한다', () => {
  const seed = createFreeExplorationSeed(() => 987_654);
  const parameters = { ...DEFAULT_PARAMETERS, seed };
  const first = new ForestSimulation(parameters);
  const second = new ForestSimulation(parameters);

  for (let step = 0; step < 100; step += 1) {
    first.step();
    second.step();
  }

  assert.deepEqual(first.getHistory(), second.getHistory());
  assert.deepEqual(first.getSnapshot().agents, second.getSnapshot().agents);
});

test('Apex Survival은 기존 challenge seed를 계속 강제한다', () => {
  const freeParameters = createInitialFreeParameters(() => 123_456);
  const apex = apexParameters(freeParameters);

  assert.equal(apex.seed, String(APEX_CHALLENGE_CONFIG.seed));
  assert.equal(apex.seed, '260903');
});
