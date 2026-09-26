import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.env.TEST_ORIGIN ?? 'http://127.0.0.1:5176';
const base = `${origin}/predator-prey-simulation-2/tests/interventions.browser.html`;
const output = fileURLToPath(new URL('../verification.local/interventions/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER ?? 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
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
const remove = async (species, amount) => {
  await page.locator('#open-removal').click(); await page.locator('#intervention-species').selectOption(species);
  if (amount === undefined) await page.locator('[data-removal-fraction="1"]').click();
  else await page.locator('#removal-amount').fill(String(amount));
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
  await page.locator('[data-removal-fraction="1"]').click();
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

  // Partial removal through the real controls, after growing a population into the hundreds.
  await page.locator('#toggle-parameters').click();
  await page.locator('[data-parameter-section=rabbit]').click();
  await page.locator('#param-initialRabbits').fill('200');
  await page.locator('[data-parameter-section=start]').click();
  await page.locator('#seed-input').fill('BROWSER-PARTIAL'); await page.locator('#apply-parameters').click();
  const partialInitial = await read();
  await page.locator('#run-button').click(); await tick(250);
  await page.locator('#open-removal').click();
  const partialBefore = await read();
  const rabbitCount = partialBefore.snapshot.rabbits.length;
  assert.ok(rabbitCount >= 200);
  const defaultAmount = Math.max(1, Math.round(rabbitCount * .1));
  assert.equal(await page.locator('#removal-amount').inputValue(), String(defaultAmount));
  assert.equal(await page.locator('#removal-range').getAttribute('max'), String(rabbitCount));
  assert.equal(await page.locator('[data-removal-fraction="0.1"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-removal-fraction="0.1"]').click();
  await tick(1000); assert.deepEqual(await read(), partialBefore);
  await snapshot('partial-rabbit-dialog-1440');
  await page.locator('#confirm-intervention').click(); await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
  const partialAfter = await read();
  assert.equal(partialAfter.snapshot.rabbits.length, rabbitCount - defaultAmount);
  assert.equal(partialAfter.snapshot.step, partialBefore.snapshot.step);
  assert.deepEqual(partialAfter.snapshot.wolves, partialBefore.snapshot.wolves);
  assert.deepEqual(partialAfter.snapshot.forest, partialBefore.snapshot.forest);
  assert.deepEqual(partialAfter.snapshot.stats, partialBefore.snapshot.stats);
  assert.deepEqual(partialAfter.history.slice(0, partialBefore.history.length), partialBefore.history);
  assert.deepEqual(partialAfter.parameters, partialBefore.parameters);
  const survivorIds = new Set(partialAfter.snapshot.rabbits.map(agent => agent.id));
  assert.deepEqual(partialAfter.snapshot.rabbits, partialBefore.snapshot.rabbits.filter(agent => survivorIds.has(agent.id)));
  assert.match(await page.locator('#recent-intervention').textContent(), new RegExp(`토끼 −${defaultAmount}.*실험적 제거`));
  assert.match(await page.locator('#population-chart').getAttribute('title'), new RegExp(`토끼 −${defaultAmount}`));
  assert.match(await page.locator('#intervention-log').textContent(), new RegExp(`토끼 −${defaultAmount}`));
  assert.equal(await page.locator('#speed-control').inputValue(), '40');
  assert.equal(await page.locator('[data-population=rabbit] b').textContent(), `${rabbitCount} → ${rabbitCount - defaultAmount}`);
  assert.equal(await page.locator('[data-population=rabbit] em').textContent(), `-${defaultAmount} ↓`);
  assert.match(await page.locator('[data-population=rabbit]').getAttribute('title'), /실험적 제거/);
  await tick(1000); assert.deepEqual(await read(), partialAfter);
  await page.locator('#graph-card').scrollIntoViewIfNeeded(); await snapshot('partial-rabbit-graph-1440');
  results.push({ scenario: 'partial rabbit removal preserves step, survivors, forest, statistics, history, speed and pause', passed: true,
    step: partialBefore.snapshot.step, before: rabbitCount, amount: defaultAmount, after: rabbitCount - defaultAmount });

  const wolfStart = (await read()).snapshot.wolves.length;
  assert.ok(wolfStart >= 5);
  await remove('wolf', 2); assert.equal((await read()).snapshot.wolves.length, wolfStart - 2);
  await page.locator('#run-button').click(); await tick(50);
  await remove('wolf', 1);
  await page.locator('#run-button').click(); await tick(50);
  await remove('wolf'); assert.equal((await read()).snapshot.wolves.length, 0);
  await introduce('wolf', 3);
  const wolfHistory = (await read()).snapshot.interventions.filter(event => event.species === 'wolf');
  assert.deepEqual(wolfHistory.map(event => event.kind), ['remove', 'remove', 'remove', 'introduce']);
  assert.equal(wolfHistory[0].amount, 2); assert.equal(wolfHistory[1].amount, 1);
  assert.equal(wolfHistory[2].resultingCount, 0); assert.equal(wolfHistory[3].resultingCount, 3);
  assert.ok(wolfHistory[1].step > wolfHistory[0].step); assert.ok(wolfHistory[2].step > wolfHistory[1].step);
  await introduce('tertiary', 6); await remove('tertiary', 3);
  assert.equal((await read()).snapshot.tertiary.length, 3);
  await introduce('tertiary', 2); assert.equal((await read()).snapshot.tertiary.length, 5);
  await page.locator('#reset-button').click();
  assert.deepEqual(await read(), partialInitial);
  await introduce('quaternary', 4); await remove('quaternary', 2);
  assert.equal((await read()).snapshot.quaternary.length, 2); assert.equal((await read()).snapshot.tertiary.length, 0);
  await page.locator('#run-button').click(); await tick(100); await page.locator('#pause-button').click();
  assert.ok((await read()).snapshot.quaternary.every(agent => agent.age > 0));
  results.push({ scenario: 'repeated wolf partial/full removal and reintroduction, tertiary 6→3→5, Reset, lone fourth consumer 4→2 without prey', passed: true });

  // Removal keyboard controls, cancellation, focus restoration, zero and one populations.
  for (const running of [true, false]) for (const close of ['Escape', 'cancel']) {
    if (running) await page.locator('#run-button').click();
    await page.locator('#open-removal').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'intervention-species');
    await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'confirm-intervention');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'intervention-species');
    const frozen = await read(); await tick(500); assert.deepEqual(await read(), frozen);
    if (close === 'Escape') await page.keyboard.press('Escape');
    else await page.locator('#cancel-intervention').click();
    await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'open-removal');
    await tick(100); assert.equal((await read()).snapshot.step > frozen.snapshot.step, running);
    if (running) await page.locator('#pause-button').click();
  }
  await page.locator('#reset-button').click();
  await page.locator('#open-removal').click(); await page.locator('#intervention-species').selectOption('tertiary');
  assert.equal(await page.locator('#removal-population').textContent(), '0마리');
  for (const selector of ['#removal-amount', '#removal-range', '#decrease-removal', '#increase-removal', '#confirm-intervention', '[data-removal-fraction="0.1"]']) {
    assert.equal(await page.locator(selector).isDisabled(), true);
  }
  assert.match(await page.locator('#removal-validation').textContent(), /제거할 개체가 없습니다/);
  const emptyState = await read();
  await page.locator('#intervention-form').dispatchEvent('submit'); assert.deepEqual(await read(), emptyState);
  await page.keyboard.press('Escape'); await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
  await introduce('tertiary', 3); await page.locator('#open-removal').click();
  await page.locator('#intervention-species').selectOption('tertiary');
  assert.equal(await page.locator('#removal-amount').inputValue(), '1');
  await page.locator('[data-removal-fraction="0.5"]').focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator('#removal-amount').inputValue(), '2');
  await page.locator('#confirm-intervention').focus(); await page.keyboard.press('Enter');
  await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
  assert.equal((await read()).snapshot.tertiary.length, 1);
  await page.locator('#open-removal').click(); await page.locator('#intervention-species').selectOption('tertiary');
  for (const fraction of ['0.1', '0.25', '0.5', '1']) {
    await page.locator(`[data-removal-fraction="${fraction}"]`).click();
    assert.equal(await page.locator('#removal-amount').inputValue(), '1');
  }
  assert.equal(await page.locator('#decrease-removal').isDisabled(), true);
  assert.equal(await page.locator('#increase-removal').isDisabled(), true);
  assert.equal(await page.locator('#confirm-intervention').textContent(), '3차 소비자 전체 제거');
  await page.locator('#confirm-intervention').click(); await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
  assert.equal((await read()).snapshot.tertiary.length, 0);
  results.push({ scenario: 'removal Tab/Enter/Space/ESC/focus, running/paused cancel, zero disabled, small presets and last individual', passed: true });

  await introduce('quaternary', 20);
  for (const [width, height] of [[320, 740], [390, 844], [1024, 768], [1440, 900]]) {
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
    await page.locator('#open-removal').click();
    await page.locator('#intervention-species').selectOption('rabbit');
    const count = (await read()).snapshot.rabbits.length;
    for (const [fraction, expected] of [['0.1', Math.round(count * .1)], ['0.25', Math.round(count * .25)], ['0.5', Math.round(count * .5)], ['1', count]]) {
      await page.locator(`[data-removal-fraction="${fraction}"]`).click();
      assert.equal(await page.locator('#removal-amount').inputValue(), String(expected));
      assert.equal(await page.locator('#removal-range').inputValue(), String(expected));
      assert.equal(await page.locator('#removal-preview').textContent(), `${count - expected}마리`);
      assert.equal(await page.locator(`[data-removal-fraction="${fraction}"]`).getAttribute('aria-pressed'), 'true');
    }
    assert.equal(await page.locator('#confirm-intervention').textContent(), '토끼 전체 제거');
    for (const invalid of ['', '0', '-1', '1.5', String(count + 1), '1e308']) {
      await page.locator('#removal-amount').fill(invalid);
      assert.equal(await page.locator('#confirm-intervention').isDisabled(), true);
      const unchanged = await read();
      await page.locator('#intervention-form').dispatchEvent('submit'); assert.deepEqual(await read(), unchanged);
    }
    await page.locator('#removal-amount').fill('25');
    await page.locator('#increase-removal').click(); assert.equal(await page.locator('#removal-amount').inputValue(), '26');
    await page.locator('#decrease-removal').click(); assert.equal(await page.locator('#removal-amount').inputValue(), '25');
    await page.locator('#removal-range').fill('50'); assert.equal(await page.locator('#removal-amount').inputValue(), '50');
    await page.locator('#removal-range').focus(); await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#removal-amount').inputValue(), '49');
    await page.locator('#intervention-species').selectOption('wolf');
    assert.equal(await page.locator('#removal-population').textContent(), '8마리');
    assert.equal(await page.locator('#removal-amount').inputValue(), '1');
    assert.equal(await page.locator('#removal-range').getAttribute('max'), '8');
    assert.equal(await page.locator('#removal-preview').textContent(), '7마리');
    assert.equal(await page.locator('#confirm-intervention').textContent(), '늑대 1마리 제거');
    assert.equal(await page.locator('[data-removal-fraction="0.1"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#intervention-species').selectOption('rabbit');
    assert.equal(await page.locator('#removal-amount').inputValue(), String(Math.round(count * .1)));
    const removalBounds = await geometry();
    assert.deepEqual(removalBounds, { pageOverflow: false, cardOverflow: false, dialogOverflow: false, overlap: false });
    const controlBounds = await page.locator('#removal-controls').evaluate(controls => {
      const rect = controls.getBoundingClientRect();
      const children = [...controls.querySelectorAll('button,input')].map(item => item.getBoundingClientRect());
      return { clipping: children.some(item => item.left < rect.left || item.right > rect.right),
        overlap: children.some((a, index) => children.slice(index + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)) };
    });
    assert.deepEqual(controlBounds, { clipping: false, overlap: false });
    assert.equal(await page.locator('#confirm-intervention').evaluate(button => button.scrollWidth > button.clientWidth), false);
    await snapshot(`removal-dialog-${width}`);
    await page.locator('#intervention-species').selectOption('quaternary');
    await page.locator('[data-removal-fraction="0.5"]').click();
    assert.equal(await page.locator('#confirm-intervention').textContent(), '4차 소비자 10마리 제거');
    assert.equal(await page.locator('#confirm-intervention').evaluate(button => button.scrollWidth > button.clientWidth || button.scrollHeight > button.clientHeight), false);
    assert.equal((await geometry()).dialogOverflow, false);
    if (width === 320) await snapshot('removal-long-label-320');
    await page.keyboard.press('Escape'); await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
    const ids = await page.locator('[id]').evaluateAll(elements => elements.map(e => e.id)); assert.equal(new Set(ids).size, ids.length);
    assert.equal(await page.locator('[aria-controls]').evaluateAll(elements => elements.filter(e => !document.getElementById(e.getAttribute('aria-controls'))).length), 0);
    results.push({ viewport: [width, height], ...removalBounds, ...controlBounds });
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
