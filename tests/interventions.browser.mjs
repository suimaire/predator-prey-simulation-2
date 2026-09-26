import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.env.TEST_ORIGIN ?? 'http://127.0.0.1:5176';
const base = `${origin}/predator-prey-simulation-2/tests/interventions.browser.html`;
const output = fileURLToPath(new URL('../verification.local/interventions/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER ?? 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
let externalWrites = 0;
await context.route('**/*', route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  if (route.request().method() !== 'GET') externalWrites++;
  return route.abort();
});
const page = await context.newPage();
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const read = () => page.evaluate(() => window.__runtime.read());
const snapshot = name => page.screenshot({ path: `${output}${name}.png`, fullPage: true });
const tick = ms => page.clock.runFor(ms);
const introduce = async (species, amount = 1) => {
  if (species === 'tertiary' || species === 'quaternary') await page.locator(`[data-introduce=${species}]`).click();
  else { await page.locator('#open-introduction').click(); await page.locator('#intervention-species').selectOption(species); }
  await page.locator('#introduction-amount').fill(String(amount));
  await page.locator('#confirm-intervention').click();
  await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
};
const remove = async species => {
  await page.locator('#open-removal').click(); await page.locator('#intervention-species').selectOption(species);
  await page.locator('#confirm-intervention').click(); await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
};
const geometry = () => page.evaluate(() => {
  const card = document.querySelector('#intervention-card');
  const dialog = document.querySelector('#intervention-dialog');
  const buttons = [...card.querySelectorAll('button')].map(button => button.getBoundingClientRect());
  const overlap = buttons.some((a, i) => buttons.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
  return { pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    cardOverflow: card.scrollWidth > card.clientWidth, dialogOverflow: dialog.open && dialog.scrollWidth > dialog.clientWidth, overlap };
});

try {
  await page.clock.install({ time: new Date('2026-09-26T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-26T00:00:01Z'));
  await page.goto(base); await page.locator('#intervention-card').waitFor();
  // Use the real parameter dialog to set a reproducible seed; initial depth stays two.
  await page.locator('#toggle-parameters').click(); await page.locator('[data-parameter-section=start]').click();
  await page.locator('#seed-input').fill('BROWSER-INTERVENTIONS'); await page.locator('#apply-parameters').click();
  const initial = await read(); assert.equal(initial.parameters.foodChainDepth, 2);
  await page.locator('#speed-control').fill('40');
  await page.locator('#run-button').click(); await tick(13000);
  assert.ok((await read()).snapshot.step >= 500);
  await page.locator('[data-introduce=tertiary]').click();
  const before = await read();
  await tick(1200);
  assert.deepEqual(await read(), before);
  assert.equal(await page.locator('#run-button').isDisabled(), false);
  await page.locator('#introduction-amount').fill('3'); await snapshot('running-paused-dialog-1440');
  await page.locator('#confirm-intervention').click(); await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
  const after = await read();
  assert.equal(after.snapshot.step, before.snapshot.step);
  assert.deepEqual(after.snapshot.forest, before.snapshot.forest);
  assert.deepEqual(after.snapshot.agents.rabbit, before.snapshot.agents.rabbit);
  assert.deepEqual(after.snapshot.agents.wolf, before.snapshot.agents.wolf);
  assert.deepEqual(after.snapshot.stats, before.snapshot.stats);
  assert.deepEqual(after.history.slice(0, before.history.length), before.history);
  assert.deepEqual(after.parameters, initial.parameters);
  assert.equal(after.snapshot.tertiary.length, 3);
  await tick(1200); assert.deepEqual(await read(), after);
  assert.match(await page.locator('#pyramid').textContent(), /3차 소비자/);
  assert.match(await page.locator('#population-chart').getAttribute('title'), /3차 소비자 \+3/);
  assert.equal(await page.locator('#speed-control').inputValue(), '40');
  await page.locator('#graph-card').scrollIntoViewIfNeeded(); await snapshot('introduced-graph-1440');
  await page.locator('#run-button').click(); await tick(100);
  await page.locator('#open-removal').click(); await page.locator('#intervention-species').selectOption('tertiary');
  const beforeRemove = await read(); await tick(1000); assert.deepEqual(await read(), beforeRemove);
  await page.locator('#confirm-intervention').click(); await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
  assert.equal((await read()).snapshot.tertiary.length, 0);
  await page.locator('#run-button').click(); await tick(250);
  await introduce('tertiary', 2);
  const reintroduced = await read();
  assert.ok(reintroduced.snapshot.step > beforeRemove.snapshot.step);
  assert.equal(reintroduced.snapshot.tertiary.length, 2);
  assert.deepEqual(reintroduced.parameters, initial.parameters);
  await introduce('quaternary');
  const fourth = (await read()).snapshot.quaternary;
  await remove('tertiary');
  assert.deepEqual((await read()).snapshot.quaternary, fourth);
  assert.equal((await read()).snapshot.tertiary.length, 0);
  await page.locator('#run-button').click(); await tick(50); await page.locator('#pause-button').click();
  assert.ok((await read()).snapshot.quaternary[0].age > 0);
  await page.locator('#reset-button').click();
  const reset = await read();
  assert.deepEqual(reset.snapshot, initial.snapshot); assert.deepEqual(reset.history, initial.history);
  assert.deepEqual(reset.parameters, initial.parameters); assert.equal(reset.storage.length, 0);
  await introduce('quaternary'); // No third consumers in a two-stage initial experiment.
  assert.equal((await read()).snapshot.quaternary.length, 1);
  await page.locator('#run-button').click(); await tick(50); await page.locator('#pause-button').click();
  assert.ok((await read()).snapshot.quaternary[0].age > 0);
  await remove('wolf'); await page.locator('#run-button').click(); await tick(100); await page.locator('#pause-button').click();
  await introduce('wolf', 2); assert.equal((await read()).snapshot.wolves.length, 2);
  assert.equal((await read()).parameters.initialWolves, 8);
  results.push({ scenario: 'runtime introduce/remove/reintroduce/reset, no-prey, higher consumer preservation', passed: true, interventionStep: before.snapshot.step });

  // Cancel/ESC running restoration and paused cancellation, with native focus cycling.
  for (const running of [true, false]) {
    if (running) await page.locator('#run-button').click();
    await page.locator('[data-introduce=tertiary]').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'intervention-species');
    await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'confirm-intervention');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'intervention-species');
    const atOpen = (await read()).snapshot.step; await tick(500); assert.equal((await read()).snapshot.step, atOpen);
    await page.keyboard.press('Escape'); await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.dataset.introduce), 'tertiary');
    await tick(100);
    assert.equal((await read()).snapshot.step > atOpen, running);
    if (running) await page.locator('#pause-button').click();
  }
  await page.locator('#run-button').click(); await page.locator('[data-introduce=tertiary]').click();
  await page.locator('#cancel-intervention').click(); await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
  const cancelStep = (await read()).snapshot.step; await tick(100); assert.ok((await read()).snapshot.step > cancelStep);
  await page.locator('#pause-button').click();
  results.push({ scenario: '40 step/s pause, Confirm stays paused, Cancel/ESC restores, keyboard focus loop/return', passed: true });

  // Parameter draft is unchanged by introduction; Apply creates a fresh experiment.
  await page.locator('#toggle-parameters').click();
  assert.equal(await page.locator('#param-initialTertiary').inputValue(), String(initial.parameters.initialTertiary));
  await page.locator('[data-parameter-section=start]').click();
  await page.locator('#seed-input').fill('BROWSER-NEXT'); await page.locator('#apply-parameters').click();
  assert.equal((await read()).snapshot.step, 0); assert.equal((await read()).snapshot.interventions.length, 0);
  assert.equal((await read()).snapshot.quaternary.length, 0);
  await introduce('tertiary', 3);
  await page.locator('[data-app-mode=apex]').click();
  assert.equal(await page.locator('#intervention-card').isVisible(), false);
  const apexBefore = await read();
  // Dispatching even a hidden entry cannot bypass the mode guard.
  await page.locator('[data-introduce=tertiary]').dispatchEvent('click');
  await page.locator('#open-removal').dispatchEvent('click');
  assert.equal(await page.locator('#intervention-dialog').isVisible(), false); assert.deepEqual(await read(), apexBefore);
  await page.locator('[data-app-mode=free]').click();
  assert.equal((await read()).snapshot.interventions.length, 0);
  results.push({ scenario: 'initial condition Apply and mode reset, Apex UI and mutation isolation', passed: true });

  for (const [width, height] of [[320, 740], [390, 844], [1024, 768], [1440, 1000]]) {
    await page.setViewportSize({ width, height }); await tick(100);
    await page.locator('#intervention-card').scrollIntoViewIfNeeded();
    const card = await geometry(); assert.deepEqual(card, { pageOverflow: false, cardOverflow: false, dialogOverflow: false, overlap: false });
    await snapshot(`card-${width}`);
    await page.locator('[data-introduce=quaternary]').click();
    assert.match(await page.locator('#intervention-warning').textContent(), /3차 소비자/);
    assert.equal(await page.locator('#confirm-intervention').isDisabled(), false);
    for (const invalid of ['0', '1.5', '21', '']) {
      await page.locator('#introduction-amount').fill(invalid); assert.equal(await page.locator('#confirm-intervention').isDisabled(), true);
    }
    await page.locator('#introduction-amount').fill('1');
    await page.locator('#increase-introduction').click(); assert.equal(await page.locator('#introduction-amount').inputValue(), '2');
    await page.locator('#decrease-introduction').click(); assert.equal(await page.locator('#introduction-amount').inputValue(), '1');
    const bounds = await geometry(); assert.deepEqual(bounds, { pageOverflow: false, cardOverflow: false, dialogOverflow: false, overlap: false });
    await snapshot(`dialog-${width}`); await page.keyboard.press('Escape'); await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
    const ids = await page.locator('[id]').evaluateAll(elements => elements.map(e => e.id)); assert.equal(new Set(ids).size, ids.length);
    assert.equal(await page.locator('[aria-controls]').evaluateAll(elements => elements.filter(e => !document.getElementById(e.getAttribute('aria-controls'))).length), 0);
    results.push({ viewport: [width, height], ...bounds });
  }
  // Check chart show/hide and runtime legend toggles still work after resize.
  await introduce('tertiary', 3); await page.locator('[data-series=tertiary]').click();
  assert.equal(await page.locator('[data-series=tertiary]').getAttribute('aria-pressed'), 'false');
  await page.locator('#toggle-graph').click(); assert.equal(await page.locator('#graph-card').isVisible(), false);
  await page.locator('#toggle-graph').click(); await tick(300); assert.equal(await page.locator('#graph-card').isVisible(), true);
  assert.deepEqual(errors, []); assert.equal(externalWrites, 0);
  await writeFile(`${output}results.json`, JSON.stringify({ results, errors, externalWrites }, null, 2));
  console.log(JSON.stringify({ results, errors, externalWrites }, null, 2));
} finally { await browser.close(); }
