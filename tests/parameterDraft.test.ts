import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { ParameterDraft } from '../src/parameterDraft.ts';
import { DEFAULT_PARAMETERS, ForestSimulation } from '../src/model.ts';
import { apexParameters, ApexChallengeSession, createApexRecord } from '../src/challenge.ts';

test('opening, editing and discarding a draft cannot mutate its source or ecosystem', () => {
  const current = { ...DEFAULT_PARAMETERS };
  const simulation = new ForestSimulation(current);
  simulation.step();
  const snapshot = simulation.getSnapshot();
  const draft = new ParameterDraft(current);
  assert.notEqual(draft.value, current);
  draft.value.initialRabbits = 80;
  draft.value.seed = 'draft-only';
  assert.deepEqual(current, DEFAULT_PARAMETERS);
  assert.deepEqual(simulation.getSnapshot(), snapshot);
  assert.deepEqual(new ParameterDraft(current).value, current);
});

test('unchanged values (including normalized seed whitespace) are a no-op', () => {
  const draft = new ParameterDraft({ ...DEFAULT_PARAMETERS });
  assert.equal(draft.prepare({ ...DEFAULT_PARAMETERS }, 'free', 'setup').status, 'unchanged');
  draft.value.seed = ` ${draft.value.seed} `;
  assert.equal(draft.prepare({ ...DEFAULT_PARAMETERS }, 'free', 'setup').status, 'unchanged');
});

for (const [name, change] of Object.entries({
  nan: { forestRegrowth: NaN }, infinity: { initialRabbits: Infinity },
  range: { transferEfficiency: 0.4 }, fractionalGrid: { gridColumns: 24.5 },
  emptySeed: { seed: ' ' }, longSeed: { seed: 'x'.repeat(41) },
})) {
  test(`invalid draft is rejected without clamping or applying: ${name}`, () => {
    const draft = new ParameterDraft({ ...DEFAULT_PARAMETERS, ...change });
    assert.equal(draft.prepare({ ...DEFAULT_PARAMETERS }, 'free', 'setup').status, 'invalid');
  });
}

test('active and paused Apex both lock at commit, with fixed seed/depth checked after completion', () => {
  const current = apexParameters({ ...DEFAULT_PARAMETERS });
  const draft = new ParameterDraft(current);
  draft.value.initialRabbits = 80;
  for (const running of [true, false]) {
    assert.equal(draft.prepare(current, 'apex', 'active').status, 'locked', `running=${running}`);
  }
  draft.value.seed = 'other';
  assert.equal(draft.prepare(current, 'apex', 'over').status, 'invalid');
  draft.value.seed = current.seed;
  draft.value.foodChainDepth = 2;
  assert.equal(draft.prepare(current, 'apex', 'over').status, 'invalid');
});

const source = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const handler = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'applyParameterDraft')!;
const code = ts.transpile(handler.getText(source), { target: ts.ScriptTarget.ES2022 });

function commitUi(mode: 'free' | 'apex', phase: 'setup' | 'active' | 'over') {
  const parameters = mode === 'apex' ? apexParameters({ ...DEFAULT_PARAMETERS }) : { ...DEFAULT_PARAMETERS };
  let resets = 0; let closes = 0;
  const context = vm.createContext({
    parameters, parameterDraft: new ParameterDraft(parameters), appMode: mode,
    apexSession: { getState: () => ({ phase }), returnToSetup() {} },
    parameterDraftError: '', challengeMessage: '', freeParameters: parameters, apexDesignParameters: parameters,
    updateControlAvailability() {}, renderChallengePanel() {}, resetSimulation() { resets++; },
    parametersDialog: { close() { closes++; context.parameterDraft = null; } },
  });
  vm.runInContext(code, context);
  return { context, apply: () => vm.runInContext('applyParameterDraft()', context), resets: () => resets, closes: () => closes };
}

test('the actual Apply handler batches multiple changes into exactly one reset and closes once', () => {
  const ui = commitUi('free', 'setup');
  ui.context.parameterDraft.value.initialRabbits = 80;
  ui.context.parameterDraft.value.transferEfficiency = 0.2;
  ui.apply(); ui.apply();
  assert.equal(ui.resets(), 1); assert.equal(ui.closes(), 1);
  assert.equal(ui.context.parameters.initialRabbits, 80);
  assert.equal(ui.context.parameters.transferEfficiency, 0.2);
});

test('the actual Apply handler cannot reset on unchanged, invalid or active settings', () => {
  const unchanged = commitUi('free', 'setup'); unchanged.apply();
  const invalid = commitUi('free', 'setup'); invalid.context.parameterDraft.value.initialRabbits = -1; invalid.apply();
  const active = commitUi('apex', 'active'); active.context.parameterDraft.value.initialRabbits = 80; active.apply();
  for (const ui of [unchanged, invalid, active]) { assert.equal(ui.resets(), 0); assert.equal(ui.closes(), 0); }
});

test('completed design apply preserves the final ecosystem, score, collapse, seed and submission snapshot', () => {
  const ui = commitUi('apex', 'over');
  const session = new ApexChallengeSession();
  const simulation = new ForestSimulation(ui.context.parameters);
  session.start(ui.context.parameters, simulation.getHistory().at(-1)!);
  while (session.getState().phase === 'active') session.acceptStep(simulation.step());
  const record = createApexRecord(session.getState());
  const state = session.getState(); const history = simulation.getHistory();
  ui.context.apexSession = session; ui.context.lastFinishedRecord = record; ui.context.simulation = simulation;
  ui.context.parameterDraft.value.initialRabbits = 80;
  ui.apply();
  assert.equal(ui.resets(), 0); assert.equal(ui.closes(), 1);
  assert.equal(ui.context.lastFinishedRecord, record);
  assert.equal(session.getState(), state); assert.deepEqual(simulation.getHistory(), history);
  assert.equal(record.parameterSnapshot.initialRabbits, DEFAULT_PARAMETERS.initialRabbits);
  assert.equal(ui.context.parameters.initialRabbits, 80);
});
