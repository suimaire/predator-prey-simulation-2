import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { ApexChallengeSession, apexParameters, challengeSettingsLocked, evaluateApexLevels } from '../src/challenge.ts';
import { DEFAULT_PARAMETERS, ForestSimulation } from '../src/model.ts';
import { personalBestFeedback, PERSONAL_BEST_FEEDBACK_MS } from '../src/feedback.ts';

// Exercise the real rendering/lifecycle functions with a small DOM boundary.
// TypeScript is already a project dependency; no browser or snapshot framework is needed.
const source = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const names = new Set(['formatSteps', 'challengeIsLocked', 'renderChallengePanel', 'clearFinishedRecord', 'beginApexChallenge', 'switchMode', 'animationLoop']);
const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name!.text));
assert.equal(functions.length, names.size);
const code = ts.transpile(functions.map((node) => node.getText(source)).join('\n'), { target: ts.ScriptTarget.ES2022 });

function completedPresentation(previousBest: number | null) {
  const parameters = apexParameters({ ...DEFAULT_PARAMETERS, quaternaryMaxAge: 10 });
  const simulation = new ForestSimulation(parameters);
  const session = new ApexChallengeSession();
  session.start(parameters, simulation.getHistory().at(-1)!);
  while (session.getState().phase === 'active') session.acceptStep(simulation.step());
  const score = session.getState().score;
  let writes = 0;
  let markup = '';
  const classes = new Set<string>();
  const panel = {
    hidden: false, dataset: {} as Record<string, string>,
    style: { setProperty() {} },
    classList: {
      toggle(name: string, on: boolean) { if (on) classes.add(name); else classes.delete(name); },
      remove(...names: string[]) { names.forEach((name) => classes.delete(name)); },
    },
    get innerHTML() { return markup; },
    set innerHTML(value: string) { writes += 1; markup = value; },
  };
  let now = 100;
  const context = vm.createContext({
    appMode: 'apex', running: false, challengePanel: panel, challengeSignature: '', challengeMessage: '',
    bestResult: personalBestFeedback(score, previousBest), bestEmphasisStartedAt: now,
    personalBest: { score: Math.max(score, previousBest ?? 0) },
    apexSession: session, simulation, parameters, apexDesignParameters: parameters, freeParameters: DEFAULT_PARAMETERS,
    lastFinishedRecord: { score }, hasSubmittedFinishedRecord: true, leaderboardStatusPhase: 'disabled',
    ForestSimulation, apexParameters, challengeSettingsLocked, evaluateApexLevels, PERSONAL_BEST_FEEDBACK_MS,
    performance: { now: () => now }, window: { clearTimeout() {} }, resetTimer: 0,
    inspector: { hidden: false }, element: () => ({ hidden: false }),
    renderLeaderboardPanel() {}, clearPopulationFeedback() {}, toggleParameters() {}, updateAllControls() {},
    setRunning(value: boolean) { context.running = value; },
    render() { vm.runInContext('renderChallengePanel()', context); },
    lastAnimationTime: 0, accumulatedTime: 0, populationFeedbackUntil: new Map(), removalNeedsRedraw: false,
    requestAnimationFrame() {}, validateParameters: (value: unknown) => value,
  });
  vm.runInContext(code, context);
  return { context, panel, classes, score, writes: () => writes, time: (value: number) => { now = value; }, run: (expression: string) => vm.runInContext(expression, context) };
}

test('best result survives animation expiry and redraws without replaying or replacing its DOM', () => {
  const ui = completedPresentation(4);
  ui.run('renderChallengePanel()');
  assert.equal(ui.classes.has('best-emphasis'), true);
  assert.match(ui.panel.innerHTML, /NEW PERSONAL BEST/u);
  assert.match(ui.panel.innerHTML, /이전 최고보다 \+5 step/u);
  assert.match(ui.panel.innerHTML, /4 → 9/u);
  const markup = ui.panel.innerHTML;
  ui.time(100 + PERSONAL_BEST_FEEDBACK_MS + 1);
  ui.run('animationLoop(performance.now()); renderChallengePanel(); renderChallengePanel()');
  assert.equal(ui.classes.has('best-emphasis'), false);
  assert.equal(ui.classes.has('is-new-best'), true);
  assert.equal(ui.panel.innerHTML, markup);
  assert.equal(ui.writes(), 1);
  assert.equal(ui.context.bestResult.previousBest, 4);
});

test('first, equal and lower results keep the correct final score and best distinction', () => {
  const first = completedPresentation(null);
  first.run('renderChallengePanel()');
  assert.match(first.panel.innerHTML, /NEW PERSONAL BEST/u);
  assert.match(first.panel.innerHTML, /첫 기록 달성/u);
  assert.doesNotMatch(first.panel.innerHTML, /Previous Best/u);
  for (const previous of [9, 20]) {
    const ui = completedPresentation(previous);
    ui.run('renderChallengePanel()');
    assert.doesNotMatch(ui.panel.innerHTML, /NEW PERSONAL BEST/u);
    assert.match(ui.panel.innerHTML, /<strong>9<\/strong>/u);
    assert.ok(ui.panel.innerHTML.includes(`Personal Best <b>${previous} step</b>`));
  }
});

test('starting the next challenge clears completed presentation while preserving Personal Best', () => {
  const ui = completedPresentation(4);
  ui.run('renderChallengePanel(); beginApexChallenge()');
  assert.equal(ui.context.bestResult, null);
  assert.equal(ui.context.lastFinishedRecord, null);
  assert.equal(ui.context.hasSubmittedFinishedRecord, false);
  assert.equal(ui.context.apexSession.getState().phase, 'active');
  assert.equal(ui.context.apexSession.getState().score, 0);
  assert.equal(ui.context.personalBest.score, 9);
  assert.doesNotMatch(ui.panel.innerHTML, /NEW PERSONAL BEST|Previous Best|FINAL SCORE/u);
  assert.equal(ui.classes.has('best-emphasis'), false);
});

test('switching from a completed challenge to free exploration clears and hides the result', () => {
  const ui = completedPresentation(4);
  ui.run('renderChallengePanel(); switchMode("free")');
  assert.equal(ui.context.bestResult, null);
  assert.equal(ui.panel.hidden, true);
  assert.equal(ui.classes.has('is-new-best'), false);
  assert.equal(ui.context.personalBest.score, 9);
});
