import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { ParameterDraft } from '../src/parameterDraft.ts';
import { DEFAULT_PARAMETERS, ForestSimulation } from '../src/model.ts';
import { ApexChallengeSession, apexParameters, challengeSettingsLocked, createApexRecord } from '../src/challenge.ts';

const source = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const names = new Set(['applyParameterDraft', 'toggleParameters', 'clearParameterDraft', 'handleChallengeAction', 'beginApexChallenge', 'clearFinishedRecord', 'updateControlAvailability', 'challengeIsLocked']);
const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name!.text));
assert.equal(functions.length, names.size);
const code = ts.transpile(functions.map(node => node.getText(source)).join('\n'), { target: ts.ScriptTarget.ES2022 });

function completedUi() {
  const parameters = apexParameters({ ...DEFAULT_PARAMETERS, quaternaryMaxAge: 10 });
  const simulation = new ForestSimulation(parameters);
  const session = new ApexChallengeSession();
  session.start(parameters, simulation.getHistory().at(-1)!);
  while (session.getState().phase === 'active') session.acceptStep(simulation.step());
  const record = createApexRecord(session.getState());
  const controls = new Map<string, any>();
  const element = (selector: string) => {
    if (!controls.has(selector)) controls.set(selector, { disabled: false, textContent: '', setAttribute() {} });
    return controls.get(selector);
  };
  let initializations = 0, resets = 0, opens = 0, closes = 0;
  const context = vm.createContext({
    parameters, simulation, apexSession: session, appMode: 'apex', running: false,
    apexDesignParameters: parameters, freeParameters: DEFAULT_PARAMETERS,
    parameterIntent: 'edit', parameterDraft: null, parameterDraftError: '', ParameterDraft,
    apexParameters, challengeSettingsLocked,
    ForestSimulation: class extends ForestSimulation { constructor(value: typeof parameters) { super(value); initializations++; } },
    lastFinishedRecord: record, personalBest: record, bestResult: { finalScore: record.score },
    hasSubmittedFinishedRecord: false, challengeMessage: '', challengeSignature: '', bestEmphasisStartedAt: 0,
    challengePanel: { classList: { remove() {} } }, inspector: {},
    parametersDialog: { open: false, close() { closes++; context.parametersDialog.open = false; run('clearParameterDraft()'); } },
    leaderboardDialog: { open: false }, removalDialog: { open: false },
    dialogs: { open(_dialog: unknown, opener: unknown) { opens++; context.opener = opener; context.parametersDialog.open = true; return true; } },
    parameterToggle: element('#toggle-parameters'), applyParametersButton: element('#apply-parameters'),
    parameterDefinitions: [], transferControl: {}, toroidalToggle: {}, depthSelect: {}, seedInput: {},
    runButton: {}, pauseButton: {}, stepButton: {}, element,
    updateAllControls() { run('updateControlAvailability()'); },
    setRunning(value: boolean) { context.running = value; run('updateControlAvailability()'); },
    clearPopulationFeedback() {}, updateStructuralUi() {}, render() {}, renderChallengePanel() {},
    resetSimulation() { resets++; },
  });
  const run = (script: string) => vm.runInContext(script, context);
  vm.runInContext(code, context);
  const action = (name: string) => {
    const button = { dataset: { challengeAction: name } };
    context.event = { target: { closest: () => button } };
    run('handleChallengeAction(event)');
    return button;
  };
  return { context, run, action, record, element, counts: () => ({ initializations, resets, opens, closes }) };
}

test('edit action opens the existing modal in start context without clearing the completed result; cancel resets context', () => {
  const ui = completedUi();
  const state = ui.context.apexSession.getState();
  const simulation = ui.context.simulation;
  for (let i = 0; i < 3; i++) {
    const opener = ui.action('edit-and-start');
    assert.equal(ui.context.opener, opener);
    assert.equal(ui.context.parameterIntent, 'edit-and-start-challenge');
    assert.equal(ui.context.parametersDialog.open, true);
    assert.equal(ui.context.applyParametersButton.textContent, '설정 적용 및 도전 시작');
    assert.equal(ui.context.applyParametersButton.disabled, false);
    ui.context.parameterDraft.value.initialRabbits = 80;
    ui.run('parametersDialog.close()');
    assert.equal(ui.context.parameterIntent, 'edit');
    assert.equal(ui.context.parameterDraft, null);
    assert.equal(ui.context.apexSession.getState(), state);
    assert.equal(ui.context.lastFinishedRecord, ui.record);
    assert.equal(ui.context.simulation, simulation);
  }
  ui.run('toggleParameters()');
  assert.equal(ui.context.applyParametersButton.textContent, '설정 적용');
  assert.equal(ui.context.applyParametersButton.disabled, true);
  assert.equal(ui.counts().initializations, 0);
});

for (const changed of [false, true]) {
  test(`edit-and-start uses one canonical initialization, locks settings and preserves PB (changed=${changed})`, () => {
    const ui = completedUi();
    ui.action('edit-and-start');
    const before = ui.context.parameters;
    if (changed) Object.assign(ui.context.parameterDraft.value, { initialRabbits: 80, transferEfficiency: 0.2 });
    ui.run('applyParameterDraft(); applyParameterDraft()');
    assert.deepEqual(ui.counts(), { initializations: 1, resets: 0, opens: 1, closes: 1 });
    assert.equal(ui.context.apexSession.getState().phase, 'active');
    assert.equal(ui.context.apexSession.getState().score, 0);
    assert.equal(ui.run('challengeIsLocked()'), true);
    assert.equal(ui.context.transferControl.disabled, true);
    assert.equal(ui.context.parameterIntent, 'edit');
    assert.equal(ui.context.parameterDraft, null);
    assert.equal(ui.context.lastFinishedRecord, null);
    assert.equal(ui.context.personalBest, ui.record);
    assert.equal(ui.context.simulation.getParameters().initialRabbits, changed ? 80 : before.initialRabbits);
    assert.equal(ui.context.simulation.getParameters().transferEfficiency, changed ? 0.2 : before.transferEfficiency);
  });
}

test('invalid start draft stays open without clearing results or starting', () => {
  const ui = completedUi();
  ui.action('edit-and-start');
  ui.context.parameterDraft.value.initialRabbits = NaN;
  ui.run('applyParameterDraft()');
  assert.equal(ui.context.parametersDialog.open, true);
  assert.equal(ui.context.applyParametersButton.disabled, true);
  assert.equal(ui.context.lastFinishedRecord, ui.record);
  assert.equal(ui.counts().initializations, 0);
});

test('reproduction ignores edited next settings and reproduces every logical step, collapse and score with the completed seed', () => {
  const ui = completedUi();
  const history = ui.context.simulation.getHistory();
  const snapshot = ui.context.simulation.getSnapshot();
  const finished = ui.context.apexSession.getState();
  ui.run('toggleParameters()');
  Object.assign(ui.context.parameterDraft.value, { initialRabbits: 80, transferEfficiency: 0.2, quaternaryMaxAge: 30 });
  ui.run('applyParameterDraft()');
  assert.equal(ui.context.parameters.initialRabbits, 80);
  assert.equal(ui.context.apexSession.getState(), finished);
  const opens = ui.counts().opens;
  ui.action('retry');
  assert.equal(ui.counts().opens, opens);
  assert.equal(ui.context.parametersDialog.open, false);
  assert.deepEqual({ ...ui.context.simulation.getParameters() }, { ...finished.parameterSnapshot });
  assert.equal(ui.context.parameters.seed, ui.record.parameterSnapshot.seed);
  while (ui.context.apexSession.getState().phase === 'active') ui.context.apexSession.acceptStep(ui.context.simulation.step());
  assert.deepEqual(ui.context.simulation.getHistory(), history);
  assert.deepEqual(ui.context.simulation.getSnapshot(), snapshot);
  assert.deepEqual(ui.context.apexSession.getState(), finished);
  assert.equal(ui.context.personalBest, ui.record);
});
