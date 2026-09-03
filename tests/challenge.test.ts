import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APEX_CHALLENGE_CONFIG,
  ApexChallengeSession,
  apexParameters,
  challengeSettingsLocked,
  createApexRecord,
  loadApexPersonalBest,
  saveApexPersonalBest,
  type ApexSurvivalRecord,
  type KeyValueStorage,
} from '../src/challenge.ts';
import { DEFAULT_PARAMETERS, ForestSimulation, type PopulationMetric, type SimulationParameters } from '../src/model.ts';

class MemoryStorage implements KeyValueStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function metric(step: number, overrides: Partial<PopulationMetric> = {}): PopulationMetric {
  return {
    step,
    rabbits: 10,
    wolves: 5,
    tertiary: 2,
    quaternary: 1,
    forestPercent: 70,
    forestAbundance: 900,
    ...overrides,
  };
}

function runApex(parameterSource: SimulationParameters, stepsPerDisplayUpdate: number) {
  const parameters = apexParameters(parameterSource);
  const simulation = new ForestSimulation(parameters);
  const session = new ApexChallengeSession();
  assert.equal(session.start(parameters, simulation.getHistory().at(-1)!), true);
  let guard = 0;
  while (session.getState().phase === 'active' && guard < 10_000) {
    for (let index = 0; index < stepsPerDisplayUpdate && session.getState().phase === 'active'; index += 1) {
      session.acceptStep(simulation.step());
      guard += 1;
    }
  }
  assert.equal(session.getState().phase, 'over', '10,000 step 안에 테스트용 먹이사슬이 붕괴해야 합니다.');
  return { state: session.getState(), history: simulation.getHistory(), snapshot: simulation.getSnapshot() };
}

test('Apex 설정은 전체 먹이사슬과 하나의 고정 seed를 강제한다', () => {
  const parameters = apexParameters({ ...DEFAULT_PARAMETERS, foodChainDepth: 2, seed: '사용자-seed' });
  assert.equal(parameters.foodChainDepth, 4);
  assert.equal(parameters.seed, String(APEX_CHALLENGE_CONFIG.seed));
  const simulation = new ForestSimulation(parameters);
  const snapshot = simulation.getSnapshot();
  assert.ok(snapshot.rabbits.length > 0);
  assert.ok(snapshot.wolves.length > 0);
  assert.ok(snapshot.tertiary.length > 0);
  assert.ok(snapshot.quaternary.length > 0);
  assert.ok(simulation.getHistory().at(-1)!.forestAbundance > 0);
});

test('초기 영양 단계가 하나라도 없으면 Challenge를 시작하지 않는다', () => {
  const parameters = apexParameters({ ...DEFAULT_PARAMETERS, initialQuaternary: 0 });
  const simulation = new ForestSimulation(parameters);
  const session = new ApexChallengeSession();
  assert.equal(session.start(parameters, simulation.getHistory().at(-1)!), false);
  assert.equal(session.getState().phase, 'setup');
  assert.deepEqual(session.getState().levelStatus.filter((level) => !level.present).map((level) => level.level), ['quaternary']);
});

test('붕괴가 발생한 logical step은 점수에 포함하지 않는다', () => {
  const session = new ApexChallengeSession();
  assert.equal(session.start(apexParameters({ ...DEFAULT_PARAMETERS }), metric(0)), true);
  assert.equal(session.acceptStep(metric(1)), false);
  assert.equal(session.getState().score, 1);
  assert.equal(session.acceptStep(metric(2, { tertiary: 0 })), true);
  assert.equal(session.getState().collapseStep, 2);
  assert.equal(session.getState().score, 1);
  assert.deepEqual(session.getState().collapsedLevels, ['tertiary']);
});

test('같은 step에 붕괴한 영양 단계를 모두 기록한다', () => {
  const session = new ApexChallengeSession();
  session.start(apexParameters({ ...DEFAULT_PARAMETERS }), metric(0));
  session.acceptStep(metric(1, { rabbits: 0, wolves: 0, forestAbundance: 0, forestPercent: 0 }));
  assert.deepEqual(session.getState().collapsedLevels, ['vegetation', 'rabbit', 'wolf']);
  assert.equal(session.getState().score, 0);
});

test('active와 over에서는 설정이 잠기고 setup으로 돌아오면 해제된다', () => {
  const session = new ApexChallengeSession();
  assert.equal(challengeSettingsLocked(session.getState()), false);
  session.start(apexParameters({ ...DEFAULT_PARAMETERS }), metric(0));
  assert.equal(challengeSettingsLocked(session.getState()), true);
  session.acceptStep(metric(1, { quaternary: 0 }));
  assert.equal(challengeSettingsLocked(session.getState()), true);
  session.returnToSetup();
  assert.equal(challengeSettingsLocked(session.getState()), false);
});

test('화면 진행 속도와 무관하게 동일한 최종 score를 만든다', () => {
  const fragile = {
    ...DEFAULT_PARAMETERS,
    initialTertiary: 2,
    initialQuaternary: 1,
    quaternaryEnergyCost: 10,
    quaternaryFoodEnergy: 1,
    quaternaryMaxAge: 10,
  };
  const slow = runApex(fragile, 1);
  const fast = runApex(fragile, 20);
  assert.equal(fast.state.score, slow.state.score);
  assert.equal(fast.state.collapseStep, slow.state.collapseStep);
  assert.deepEqual(fast.state.collapsedLevels, slow.state.collapsedLevels);
  assert.deepEqual(fast.history, slow.history);
  assert.deepEqual(fast.snapshot.agents, slow.snapshot.agents);
});

test('동일 설정으로 Retry하면 동일한 결과가 재현된다', () => {
  const parameters = { ...DEFAULT_PARAMETERS, initialTertiary: 5, initialQuaternary: 2, quaternaryEnergyCost: 5 };
  const first = runApex(parameters, 7);
  const retry = runApex({ ...first.state.parameterSnapshot! }, 3);
  assert.equal(retry.state.score, first.state.score);
  assert.equal(retry.state.collapseStep, first.state.collapseStep);
  assert.deepEqual(retry.state.collapsedLevels, first.state.collapsedLevels);
});

test('중단된 run은 완료 기록으로 만들거나 Personal Best에 저장할 수 없다', () => {
  const storage = new MemoryStorage();
  const session = new ApexChallengeSession();
  session.start(apexParameters({ ...DEFAULT_PARAMETERS }), metric(0));
  session.acceptStep(metric(1));
  session.returnToSetup();
  assert.throws(() => createApexRecord(session.getState()));
  assert.equal(loadApexPersonalBest(storage), null);
});

test('낮은 점수는 Personal Best를 덮어쓰지 않고 높은 점수는 parameter snapshot도 갱신한다', () => {
  const storage = new MemoryStorage();
  const record = (score: number, initialRabbits: number): ApexSurvivalRecord => ({
    challengeId: APEX_CHALLENGE_CONFIG.id,
    simulationVersion: APEX_CHALLENGE_CONFIG.simulationVersion,
    score,
    seed: APEX_CHALLENGE_CONFIG.seed,
    parameterSnapshot: apexParameters({ ...DEFAULT_PARAMETERS, initialRabbits }),
    achievedAt: `2026-09-03T00:00:0${score % 10}.000Z`,
  });
  assert.equal(saveApexPersonalBest(storage, record(100, 40)).isNewBest, true);
  assert.equal(saveApexPersonalBest(storage, record(80, 20)).isNewBest, false);
  assert.equal(loadApexPersonalBest(storage)!.score, 100);
  assert.equal(loadApexPersonalBest(storage)!.parameterSnapshot.initialRabbits, 40);
  assert.equal(saveApexPersonalBest(storage, record(120, 90)).isNewBest, true);
  assert.equal(loadApexPersonalBest(storage)!.score, 120);
  assert.equal(loadApexPersonalBest(storage)!.parameterSnapshot.initialRabbits, 90);
});
