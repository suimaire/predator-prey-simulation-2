import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { RUNTIME_SPECIES, SPECIES_LABELS as INTERVENTION_LABELS, DEFAULT_PARAMETERS, ForestSimulation } from '../src/model.ts';
import { ParameterDraft } from '../src/parameterDraft.ts';
import { BOARD_TAB_MARKUP } from '../src/leaderboardView.ts';
import { simulationControlsMarkup } from '../src/simulationControls.ts';
import { APEX_CHALLENGE_CONFIG, apexParameters, challengeSettingsLocked } from '../src/challenge.ts';

// Exercise the actual markup, input listeners and navigation/apply functions with the
// same node:test + TypeScript/VM boundary used by the existing presentation tests.
const source = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const variables = new Set(['parameterDefinitions', 'groupInfo', 'initialStages']);
const names = new Set(['formatParameter', 'parameterGroupActive', 'parameterInputMarkup', 'parameterMarkup', 'initialEcosystemMarkup', 'parameterGroupMarkup',
  'selectParameterGroup', 'updateParameterNavigation', 'updateAllControls', 'editDraft', 'updateControlAvailability', 'challengeIsLocked', 'clearParameterDraft', 'applyParameterDraft']);
const statements = source.statements.filter(node =>
  ts.isFunctionDeclaration(node) && names.has(node.name!.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => variables.has(declaration.name.getText(source)))
  || ts.isForOfStatement(node) && node.getText(source).startsWith('for (const definition of parameterDefinitions)')
  || ts.isExpressionStatement(node) && /^(app\.innerHTML =|depthSelect\.addEventListener|element\('#restore-defaults'\)\.addEventListener)/.test(node.getText(source)));
const code = ts.transpile(statements.map(node => node.getText(source)).join('\n'), { target: ts.ScriptTarget.ES2022 });

class Control {
  value = ''; textContent = ''; disabled = false; hidden = false; checked = false; scrollTop = 0;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  classes = new Set<string>();
  classList = { toggle: (name: string, on: boolean) => { if (on) this.classes.add(name); else this.classes.delete(name); } };
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener(name: string, fn: () => void) { this.listeners.set(name, fn); }
  emit(name: string) { this.listeners.get(name)?.(); }
}

function setup(mode: 'free' | 'apex' = 'free', phase = 'setup') {
  const parameters = mode === 'apex' ? apexParameters({ ...DEFAULT_PARAMETERS }) : { ...DEFAULT_PARAMETERS };
  const simulation = new ForestSimulation(parameters);
  const controls = new Map<string, Control>();
  const element = (selector: string): Control => {
    if (!controls.has(selector)) controls.set(selector, new Control());
    return controls.get(selector)!;
  };
  const groups = ['quaternary', 'tertiary', 'wolf', 'rabbit', 'forest', 'start'];
  const buttons = groups.map(group => { const control = element(`button-${group}`); control.dataset.parameterSection = group; return control; });
  const panels = groups.map(group => { const control = element(`panel-${group}`); control.dataset.parameterPanel = group; return control; });
  let resets = 0;
  const context = vm.createContext({
    RUNTIME_SPECIES, SPECIES_LABELS: INTERVENTION_LABELS, DEFAULT_PARAMETERS, APEX_CHALLENGE_CONFIG, ParameterDraft, apexParameters, challengeSettingsLocked, element,
    app: { innerHTML: '' }, BOARD_GROUPS: [], BOARD_TAB_MARKUP, simulationControlsMarkup, initialFreeParameters: { ...DEFAULT_PARAMETERS },
    parameters, simulation, appMode: mode, phase, running: false, parameterIntent: 'edit', parameterDraftError: '', challengeMessage: '',
    parameterDraft: new ParameterDraft(parameters), apexSession: { getState: () => ({ phase: context.phase }), returnToSetup() {} },
    freeParameters: parameters, apexDesignParameters: parameters,
    applyParametersButton: element('#apply-parameters'), parameterToggle: element('#toggle-parameters'),
    depthSelect: element('#food-depth'), seedInput: element('#seed-input'), transferControl: element('#transfer-efficiency'), toroidalToggle: element('#toroidal-toggle'),
    runButton: {}, pauseButton: {}, stepButton: {},
    document: { activeElement: null, querySelectorAll: (selector: string) => selector === '[data-parameter-section]' ? buttons : panels },
    parametersDialog: { close() { run('clearParameterDraft()'); } },
    resetSimulation() { resets++; }, renderChallengePanel() {},
  });
  const run = (expression: string) => vm.runInContext(expression, context);
  run(code); run('updateAllControls(); selectParameterGroup("wolf")');
  const input = (key: string, value: number) => { const control = element(`#param-${key}`); control.value = String(value); context.document.activeElement = control; control.emit('input'); return control; };
  return { context, run, element, input, buttons, panels, resets: () => resets };
}

const initials = [
  ['quaternary', 'initialQuaternary', 0, 20, 1, 1],
  ['tertiary', 'initialTertiary', 0, 40, 1, 3],
  ['wolf', 'initialWolves', 0, 160, 2, 8],
  ['rabbit', 'initialRabbits', 0, 400, 2, 50],
  ['forest', 'initialForestDensity', 0, 100, 2, 78],
] as const;

test('all five initial stages render in descending trophic order, with one labelled slider per existing key and unchanged ranges/defaults', () => {
  const ui = setup();
  const markup = ui.context.app.innerHTML as string;
  const left = markup.slice(markup.indexOf('<section class="initial-ecosystem"'), markup.indexOf('<div class="parameter-scroll'));
  assert.deepEqual([...left.matchAll(/data-initial-stage="([^"]+)"/g)].map(match => match[1]), initials.map(([group]) => group));
  for (const [group, key, min, max, step, value] of initials) {
    const card = left.split(`data-initial-stage="${group}"`)[1].split('</article>')[0];
    assert.match(card, new RegExp(`<label[^>]+for="param-${key}"`));
    assert.match(card, new RegExp(`id="param-${key}"[^>]+min="${min}" max="${max}" step="${step}" value="${value}"`));
    assert.equal([...markup.matchAll(new RegExp(`id="param-${key}"`, 'g'))].length, 1);
    assert.doesNotMatch(card.split('</button>')[0], /type="range"/);
  }
  const right = markup.slice(markup.indexOf('<div class="parameter-scroll'), markup.indexOf('<div class="dialog-footer">'));
  assert.doesNotMatch(right, /data-parameter="initial|시작 조건|<details/);
  for (const id of ['food-depth', 'transfer-efficiency', 'param-gridColumns', 'seed-input', 'toroidal-toggle']) assert.ok(right.includes(`id="${id}"`));
});

test('every non-initial biological parameter appears once in its selected detail group', () => {
  const ui = setup();
  for (const group of ['forest', 'rabbit', 'wolf', 'tertiary', 'quaternary']) {
    const markup = ui.run(`parameterGroupMarkup('${group}')`) as string;
    const definitions = ui.run(`parameterDefinitions.filter(d => d.group === '${group}' && !initialStages.some(s => s.key === d.key))`);
    for (const definition of definitions) assert.equal([...markup.matchAll(new RegExp(`id="param-${definition.key}"`, 'g'))].length, 1);
    assert.doesNotMatch(markup, /data-parameter="initial/);
  }
});

test('all five slider listeners edit only the draft, preserve focus and selection, survive section switches and cancel', () => {
  const ui = setup('apex');
  const before = ui.context.simulation.getSnapshot();
  const values = { initialForestDensity: 80, initialRabbits: 70, initialWolves: 10, initialTertiary: 4, initialQuaternary: 2 };
  for (const [key, value] of Object.entries(values)) {
    const control = ui.input(key, value);
    assert.equal(ui.context.document.activeElement, control);
    assert.equal(ui.buttons.find(button => button.attributes.get('aria-pressed') === 'true')?.dataset.parameterSection, 'wolf');
    assert.equal(ui.context.parameterDraft.value[key], value);
    assert.ok(control.attributes.get('aria-valuetext')?.includes(String(value)));
  }
  ui.run('selectParameterGroup("rabbit"); selectParameterGroup("start"); selectParameterGroup("wolf")');
  for (const [key, value] of Object.entries(values)) assert.equal(ui.context.parameterDraft.value[key], value);
  assert.equal(ui.panels.filter(panel => !panel.hidden).length, 1);
  assert.deepEqual(ui.context.simulation.getSnapshot(), before);
  ui.run('parametersDialog.close()');
  assert.equal(ui.context.parameterDraft, null);
  assert.equal(ui.context.parameters.initialRabbits, 50);
  assert.equal(ui.resets(), 0);
});

test('apply sends all five original keys through the existing single-reset path', () => {
  const ui = setup();
  ui.context.depthSelect.value = '4'; ui.context.depthSelect.emit('change');
  for (const [, key, , , step, value] of initials) ui.input(key, value + step);
  ui.run('applyParameterDraft()');
  for (const [, key, , , step, value] of initials) assert.equal(ui.context.parameters[key], value + step);
  assert.equal(ui.context.parameters.foodChainDepth, 4);
  assert.equal(ui.resets(), 1);
});

test('restore updates both panes of the draft; cancelling preserves the applied settings and ecosystem', () => {
  const ui = setup('apex');
  ui.input('initialRabbits', 70); ui.input('wolfMaxAge', 150); ui.run('applyParameterDraft()');
  const applied = { ...ui.context.parameters };
  ui.context.parameterDraft = new ParameterDraft(ui.context.parameters);
  ui.element('#restore-defaults').emit('click');
  assert.equal(ui.element('#param-initialRabbits').value, '50');
  assert.equal(ui.element('#param-wolfMaxAge').value, '120');
  assert.equal(ui.context.parameterDraft.value.seed, apexParameters(DEFAULT_PARAMETERS).seed);
  ui.run('parametersDialog.close()');
  assert.deepEqual({ ...ui.context.parameters }, applied);
  assert.equal(ui.resets(), 1);
});

test('draft food-chain depth enables/disables upper consumers without dropping their values or selection', () => {
  const ui = setup();
  assert.equal(ui.element('#param-initialTertiary').disabled, true);
  assert.equal(ui.element('#param-initialQuaternary').disabled, true);
  ui.run('selectParameterGroup("quaternary")');
  assert.equal(ui.element('#inactive-note-quaternary').hidden, false);
  for (const depth of [3, 4, 2, 4]) {
    ui.context.depthSelect.value = String(depth); ui.context.depthSelect.emit('change');
    assert.equal(ui.element('#param-initialTertiary').disabled, depth < 3);
    assert.equal(ui.element('#param-initialQuaternary').disabled, depth < 4);
    assert.equal(ui.element('#param-quaternaryMaxAge').disabled, depth < 4);
    assert.equal(ui.context.parameterDraft.value.initialQuaternary, 1);
    assert.equal(ui.context.parameters.foodChainDepth, 2);
  }
  assert.equal(ui.buttons[0].attributes.get('aria-pressed'), 'true');
});

test('active and paused challenge inputs are locked; completion unlocks without changing results', () => {
  for (const running of [true, false]) {
    const ui = setup('apex', 'active'); ui.context.running = running;
    const before = ui.context.simulation.getSnapshot();
    for (const [, key] of initials) { assert.equal(ui.element(`#param-${key}`).disabled, true); ui.input(key, 0); }
    ui.element('#restore-defaults').emit('click');
    assert.equal(ui.context.parameterDraft.value.initialRabbits, 50);
    assert.equal(ui.context.applyParametersButton.disabled, true);
    ui.context.phase = 'over'; ui.run('updateControlAvailability()');
    for (const [, key] of initials) assert.equal(ui.element(`#param-${key}`).disabled, false);
    ui.input('initialRabbits', 70); ui.run('applyParameterDraft()');
    assert.equal(ui.resets(), 0);
    assert.deepEqual(ui.context.simulation.getSnapshot(), before);
  }
});
