import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { BOARD_TAB_MARKUP } from '../src/leaderboardView.ts';
import { SERIES_COLORS } from '../src/charts.ts';
import { APEX_CHALLENGE_CONFIG, ApexChallengeSession, apexParameters } from '../src/challenge.ts';
import { RUNTIME_SPECIES, DEFAULT_PARAMETERS, ForestSimulation, SPECIES_LABELS, activeSpecies, validateParameters } from '../src/model.ts';

// Reuse the project's node:test/VM boundary to exercise the actual template and
// click listeners. Geometry and native keyboard focus are checked in the browser.
const source = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const variables = new Set(['parameterDefinitions', 'groupInfo', 'initialStages']);
const names = new Set(['formatParameter', 'parameterInputMarkup', 'parameterMarkup', 'initialEcosystemMarkup', 'parameterGroupMarkup', 'updateStructuralUi', 'switchMode']);
const statements = source.statements.filter(node =>
  ts.isFunctionDeclaration(node) && names.has(node.name!.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => variables.has(declaration.name.getText(source)))
  || ts.isExpressionStatement(node) && (node.getText(source).startsWith('app.innerHTML =')
    || node.getText(source).startsWith("document.querySelectorAll<HTMLButtonElement>('[data-app-mode]')")));
const code = ts.transpile(statements.map(node => node.getText(source)).join('\n'), { target: ts.ScriptTarget.ES2022 });

class Control {
  hidden = false;
  innerHTML = '';
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  dataset: Record<string, string>;
  constructor(dataset: Record<string, string> = {}) { this.dataset = dataset; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener(name: string, fn: () => void) { this.listeners.set(name, fn); }
  click() { this.listeners.get('click')?.(); }
}

function setup() {
  const buttons = [new Control({ appMode: 'free' }), new Control({ appMode: 'apex' })];
  const controls = new Map<string, Control>();
  const element = (selector: string) => {
    assert.notEqual(selector, '#header-chain', 'removed food chain must not be updated');
    assert.notEqual(selector, '#mode-summary', 'removed toolbar must not be updated');
    if (!controls.has(selector)) controls.set(selector, new Control());
    return controls.get(selector)!;
  };
  const parameters = { ...DEFAULT_PARAMETERS, seed: 'navigation-test', initialRabbits: 72 };
  const context = vm.createContext({
    RUNTIME_SPECIES, DEFAULT_PARAMETERS, APEX_CHALLENGE_CONFIG, BOARD_TAB_MARKUP, BOARD_GROUPS: [],
    ForestSimulation, SPECIES_LABELS, SERIES_COLORS, activeSpecies, apexParameters, validateParameters,
    app: { innerHTML: '' }, initialFreeParameters: parameters, parameters, appMode: 'free',
    freeParameters: parameters, apexDesignParameters: apexParameters(parameters), hasApexDesign: false,
    simulation: new ForestSimulation(parameters), apexSession: new ApexChallengeSession(),
    leaderboardStatusPhase: 'disabled', visibleSeries: new Set(['forest', 'rabbit', 'wolf']),
    shell: { classList: { toggle() {} } }, element,
    document: { querySelectorAll: (selector: string) => selector === '[data-app-mode]' ? buttons : [] },
    window: { confirm: () => context.confirmed }, confirmed: false,
    modeEffects: { sync() {} },
    initializeIconCanvases() {}, updateControlAvailability() {}, clearFinishedRecord() {},
    clearPopulationFeedback() {}, setRunning() {}, render() {},
  });
  vm.runInContext(code, context);
  vm.runInContext('updateStructuralUi()', context);
  return { context, buttons, element };
}

test('branding stays in the banner and the single mode group belongs to the forest header', () => {
  const { context } = setup();
  const markup = context.app.innerHTML as string;
  const banner = markup.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0];
  assert.ok(banner);
  for (const label of ['Rabbits', 'Wolves', 'Extended forest population lab', '과학 수업 포털', '탐구 02', '통합과학 2']) assert.ok(banner.includes(label));
  assert.doesNotMatch(banner, /현재 먹이 관계|header-chain|data-app-mode/);
  assert.doesNotMatch(markup, /class="mode-bar"|id="mode-summary"/);
  const forestHeader = [...markup.matchAll(/<header\b[^>]*>[\s\S]*?<\/header>/g)].map(match => match[0]).find(header => header.includes('id="forest-heading"'));
  assert.ok(forestHeader);
  assert.match(forestHeader, /role="group" aria-label="모드 선택"/);
  for (const mode of ['free', 'apex']) {
    assert.equal(markup.match(new RegExp(`data-app-mode="${mode}"`, 'g'))?.length, 1);
    assert.match(forestHeader, new RegExp(`<button type="button" data-app-mode="${mode}" aria-pressed="(?:true|false)"`));
  }
});

test('the existing clicks update active state and restore free settings after an Apex round trip', () => {
  const { context, buttons, element } = setup();
  const freeParameters = { ...context.parameters };
  assert.deepEqual(buttons.map(button => button.attributes.get('aria-pressed')), ['true', 'false']);
  buttons[1].click();
  assert.equal(context.appMode, 'apex');
  assert.equal(context.parameters.seed, String(APEX_CHALLENGE_CONFIG.seed));
  assert.equal(context.parameters.foodChainDepth, 4);
  assert.equal(element('#experiment-heading').hidden, true);
  assert.deepEqual(buttons.map(button => button.attributes.get('aria-pressed')), ['false', 'true']);
  const simulation = context.simulation;
  buttons[1].click();
  assert.equal(context.simulation, simulation, 'clicking the selected mode does not reset it');
  buttons[0].click();
  assert.equal(context.appMode, 'free');
  assert.deepEqual({ ...context.parameters }, freeParameters);
  assert.equal(element('#experiment-heading').hidden, false);
  assert.deepEqual(buttons.map(button => button.attributes.get('aria-pressed')), ['true', 'false']);
});

test('moving the buttons preserves the confirmation when leaving an active challenge', () => {
  const { context, buttons } = setup();
  buttons[1].click();
  context.apexSession.start(context.parameters, context.simulation.getHistory().at(-1)!);
  const simulation = context.simulation;
  buttons[0].click();
  assert.equal(context.appMode, 'apex');
  assert.equal(context.simulation, simulation);
  assert.deepEqual(buttons.map(button => button.attributes.get('aria-pressed')), ['false', 'true']);
  context.confirmed = true;
  buttons[0].click();
  assert.equal(context.appMode, 'free');
  assert.equal(context.apexSession.getState().phase, 'setup');
  assert.deepEqual(buttons.map(button => button.attributes.get('aria-pressed')), ['true', 'false']);
});
