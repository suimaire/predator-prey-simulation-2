import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.env.TEST_ORIGIN ?? 'http://127.0.0.1:5176';
const output = fileURLToPath(new URL('../verification.local/experiment-log/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER ?? 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await context.addInitScript(() => {
  window.__rankingMounts = [];
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      const selector = '.leaderboard-summary, #leaderboard-dialog';
      const mounted = [...node.querySelectorAll(selector)];
      if (node.matches(selector)) mounted.push(node);
      window.__rankingMounts.push(...mounted.map(element => element.id || element.className));
    }
  }).observe(document, { childList: true, subtree: true });
});
await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const read = () => page.evaluate(() => window.__runtime.read());
const events = () => page.evaluate(() => window.__runtime.events());
const rows = () => page.locator('#experiment-log li').allTextContents();
const tick = ms => page.clock.runFor(ms);
async function introduce(species, amount) {
  await page.locator('#open-introduction').click();
  await page.locator('#intervention-species').selectOption(species);
  await page.locator('#introduction-amount').fill(String(amount));
  await page.locator('#confirm-intervention').click();
  await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
}
async function remove(species, amount) {
  await page.locator('#open-removal').click();
  await page.locator('#intervention-species').selectOption(species);
  if (amount === undefined) await page.locator('[data-removal-fraction="1"]').click();
  else await page.locator('#removal-amount').fill(String(amount));
  await page.locator('#confirm-intervention').click();
  await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
}
async function freeLayout() {
  assert.equal(await page.locator('.leaderboard-summary').count(), 0);
  assert.equal(await page.locator('#leaderboard-dialog, #leaderboard-panel, [id^="ranking-"], [id^="summary-"]').count(), 0);
  assert.equal(await page.locator('#open-leaderboard').count(), 0);
  assert.equal(await page.locator('.sim-toolbar').count(), 1);
  assert.equal(await page.locator('#experiment-controls .sim-toolbar').count(), 1);
  assert.equal(await page.locator('#simulation-console > .sim-toolbar').count(), 0);
  const order = await page.locator('#simulation-console > :is(.parameter-entry, .intervention-card, .pyramid-card, .experiment-card)').evaluateAll(elements => elements.map(e => e.id || 'pyramid'));
  assert.deepEqual(order, ['toggle-parameters', 'intervention-card', 'pyramid', 'experiment-controls', 'experiment-log']);
}
const nutrition = [];
async function nutritionLayout() {
  assert.equal(await page.locator('.pyramid-toolbar h2').textContent(), '실시간 영양 구조');
  assert.equal(await page.locator('.pyramid-card .pyramid-note, .pyramid-card .pyramid-help, .pyramid-card .chain-summary, .fox-proxy-help').count(), 0);
  assert.equal(await page.locator('#pyramid').getAttribute('aria-describedby'), null);
  assert.equal(await page.locator('.fox-card').count(), 1);
  assert.match(await page.locator('.food-web-edges').textContent(), /식물성 먹이 → 붉은여우/u);
  assert.match(await page.locator('.food-web-edges').textContent(), /토끼 → 붉은여우/u);
  const geometry = await page.evaluate(() => {
    const card = document.querySelector('.pyramid-card'), pyramid = document.querySelector('#pyramid');
    const edges = pyramid.querySelector('.food-web-edges');
    const css = getComputedStyle(card), pyramidCss = getComputedStyle(pyramid);
    return {
      trailingNodes: pyramid.nextElementSibling !== null || edges.nextElementSibling !== null,
      cardBottom: card.getBoundingClientRect().bottom - pyramid.getBoundingClientRect().bottom,
      expectedCardBottom: parseFloat(css.paddingBottom) + parseFloat(css.borderBottomWidth),
      pyramidBottom: pyramid.getBoundingClientRect().bottom - edges.getBoundingClientRect().bottom,
      expectedPyramidBottom: parseFloat(pyramidCss.paddingBottom) + parseFloat(pyramidCss.borderBottomWidth),
    };
  });
  assert.equal(geometry.trailingNodes, false);
  assert.ok(Math.abs(geometry.cardBottom - geometry.expectedCardBottom) <= 1, 'no reserved footer space in the card');
  assert.ok(Math.abs(geometry.pyramidBottom - geometry.expectedPyramidBottom) <= 1, 'no reserved footer gap inside the food web');
  nutrition.push(geometry);
}
try {
  await page.clock.install({ time: new Date('2026-09-26T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-26T00:00:01Z'));
  await page.goto(`${origin}/predator-prey-simulation-2/tests/interventions.browser.html`);
  await page.locator('#experiment-log').waitFor();
  await freeLayout();
  assert.deepEqual(await page.evaluate(() => window.__rankingMounts), [], 'initial Free Exploration never mounts either ranking surface');
  assert.match(await page.locator('#experiment-log').textContent(), /아직 기록된 사건이 없습니다/u);
  await page.evaluate(() => { window.__originalControls = document.querySelector('.sim-toolbar'); });

  await page.locator('#step-button').click();
  assert.equal((await read()).snapshot.step, 1);
  await page.locator('#speed-control').fill('40');
  assert.equal(await page.locator('#speed-output').textContent(), '40 step/s');
  await page.locator('#run-button').click();
  assert.equal(await page.locator('#run-button').isDisabled(), true);
  await tick(1000);
  await page.locator('#pause-button').click();
  const fastStep = (await read()).snapshot.step;
  assert.ok(fastStep >= 40 && fastStep <= 41, '40 step/s, allowing the final pending animation frame');
  await tick(1000);
  assert.equal((await read()).snapshot.step, fastStep);
  assert.equal(await page.locator('#pause-button').isDisabled(), true);
  await page.locator('#speed-control').fill('2');
  await page.locator('#run-button').click(); await tick(1000); await page.locator('#pause-button').click();
  const slowAdvance = (await read()).snapshot.step - fastStep;
  assert.ok(slowAdvance >= 1 && slowAdvance <= 2);
  await page.locator('#toggle-graph').click(); await tick(250);
  assert.equal(await page.locator('#graph-card').isVisible(), false);
  await page.locator('#toggle-graph').click(); await tick(250);
  assert.equal(await page.locator('#graph-card').isVisible(), true);
  await page.locator('#reset-button').click();
  assert.equal((await read()).snapshot.step, 0);
  assert.deepEqual(await events(), []);

  await introduce('fox', 4);
  assert.match((await rows())[0], /Step 0.*붉은여우 \+4 도입/u);
  await nutritionLayout();
  await page.locator('[data-pyramid-mode=energy]').click();
  await nutritionLayout();
  assert.equal(await page.locator('.fox-energy p').count(), 2);
  await page.locator('[data-pyramid-mode=numbers]').click();
  await remove('rabbit', 10);
  assert.match((await rows())[0], /토끼 −10 제거/u);
  await remove('fox');
  assert.match((await rows())[0], /붉은여우 전체 제거/u);
  assert.equal((await events()).length, 3);
  await page.locator('#step-button').click();
  assert.equal((await events()).some(event => event.kind === 'extinction' && event.species === 'fox'), false);
  await introduce('fox', 2);
  assert.match((await rows())[0], /Step 1.*붉은여우 \+2 재도입/u);
  assert.match(await page.locator('#population-chart').getAttribute('title'), /붉은여우 \+2/u);
  assert.equal((await read()).snapshot.interventions.length, 4);

  // Each mode round trip must move the same control nodes and mount only its cards.
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-app-mode=apex]').click();
    assert.equal(await page.locator('.leaderboard-summary').isVisible(), true);
    assert.equal(await page.locator('#leaderboard-dialog').count(), 1);
    assert.equal(await page.locator('.sim-toolbar').count(), 1);
    await page.locator('#open-leaderboard').click();
    assert.equal(await page.locator('#leaderboard-dialog').isVisible(), true);
    await page.locator('#close-leaderboard').click();
    assert.equal(await page.locator('#simulation-console > .sim-toolbar').count(), 1);
    assert.equal(await page.locator('#experiment-log, #experiment-controls').count(), 0);
    assert.equal(await page.locator('#intervention-card').isVisible(), false);
    const before = await read();
    await page.locator('#open-introduction').dispatchEvent('click');
    assert.equal(await page.locator('#intervention-dialog').isVisible(), false);
    assert.deepEqual(await read(), before);
    await page.locator('#summary-tab-manipulator').click();
    assert.equal(await page.locator('#summary-tab-manipulator').getAttribute('aria-selected'), 'true');
    await page.locator('[data-app-mode=free]').click();
    await freeLayout();
    assert.deepEqual(await events(), []);
    assert.equal(await page.evaluate(() => window.__originalControls === document.querySelector('.sim-toolbar')), true);
    assert.equal(await page.locator('#speed-control').inputValue(), '2');
    await page.locator('#step-button').click();
    assert.equal((await read()).snapshot.step, 1, 'one click still executes exactly one step after mode switches');
  }
  await page.locator('#run-button').click(); await tick(1000); await page.locator('#pause-button').click();
  assert.ok((await read()).snapshot.step <= 3, 'mode switches do not duplicate the simulation clock');

  // Make a naturally food-free ecosystem through the real parameter dialog.
  await page.locator('#toggle-parameters').click();
  await page.locator('#param-initialRabbits').fill('0');
  await page.locator('#param-initialWolves').fill('0');
  await page.locator('#param-initialForestDensity').fill('0');
  await page.locator('[data-parameter-section=forest]').click();
  await page.locator('#param-forestRegrowth').fill('0');
  await page.locator('[data-parameter-section=start]').click();
  await page.locator('#seed-input').fill('BROWSER-EXPERIMENT-LOG');
  await page.locator('#apply-parameters').click();
  assert.deepEqual(await events(), []);
  for (let cycle = 0; cycle < 2; cycle++) {
    await introduce('fox', 1);
    await page.locator('#speed-control').fill('40');
    await page.locator('#run-button').click(); await tick(2500); await page.locator('#pause-button').click();
    const currentEvents = await events();
    const extinctions = currentEvents.filter(event => event.kind === 'extinction');
    assert.equal(extinctions.length, cycle + 1);
    const last = extinctions.at(-1);
    const history = (await read()).history;
    const zero = history.findIndex((metric, index) => metric.step === last.step && metric.fox === 0 && (history[index - 1]?.fox ?? 0) > 0);
    assert.ok(zero > 0, 'extinction carries the exact positive-to-zero step');
    assert.match((await rows())[0], new RegExp(`Step ${last.step}.*붉은여우 멸종`));
    assert.equal((await read()).snapshot.interventions.length, cycle + 1, 'no extinction graph marker');
  }
  assert.match((await rows())[1], /붉은여우 \+1 재도입/u);
  for (let i = 0; i < 7; i++) { await introduce('rabbit', 2); await remove('rabbit'); }
  assert.equal(await page.locator('.experiment-log-body').evaluate(e => e.scrollHeight > e.clientHeight), true);
  await page.locator('.experiment-log-body').evaluate(e => { e.scrollTop = e.scrollHeight; });
  const scroll = await page.locator('.experiment-log-body').evaluate(e => e.scrollTop);
  await page.locator('#step-button').click();
  assert.equal(await page.locator('.experiment-log-body').evaluate(e => e.scrollTop), scroll);
  await page.locator('.experiment-log-body').evaluate(e => { e.scrollTop = 0; });

  const geometry = [];
  for (const [width, height] of [[1440, 900], [1280, 720], [1024, 768], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height }); await tick(250);
    await nutritionLayout();
    const result = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.experiment-card')];
      const buttons = [...document.querySelectorAll('#experiment-controls button')].map(e => e.getBoundingClientRect());
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        cardOverflow: cards.some(e => e.scrollWidth > e.clientWidth),
        overlap: buttons.some((a, i) => buttons.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)),
        logHeight: document.querySelector('.experiment-log-body').clientHeight,
      };
    });
    assert.equal(result.overflow, false); assert.equal(result.cardOverflow, false); assert.equal(result.overlap, false);
    assert.ok(result.logHeight <= 240);
    geometry.push({ width, height, ...result });
    await page.screenshot({ path: `${output}workspace-${width}.png`, fullPage: true });
  }
  await page.locator('#reset-button').click();
  assert.deepEqual(await events(), []);
  assert.deepEqual((await read()).snapshot.interventions, []);
  assert.equal(await page.locator('#experiment-log li').count(), 0);
  assert.match(await page.locator('#experiment-log').textContent(), /아직 기록된 사건이 없습니다/u);
  assert.equal(await page.locator('#population-chart').getAttribute('title'), '');
  assert.deepEqual(errors, []);
  await writeFile(`${output}results.json`, JSON.stringify({ geometry, nutrition, initialRankingMounts: [], freeRankingNodes: await page.locator('.leaderboard-summary, #leaderboard-dialog, #leaderboard-panel').count(), errors }, null, 2));
  console.log('Experiment workspace passed: controls, mode round trips, intervention log, repeated natural extinction, graph markers, reset, scrolling, 5 viewport sizes.');
} finally { await browser.close(); }
