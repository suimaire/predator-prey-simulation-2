// Optional browser regression suite: run against Vite with Playwright available.
// Uses the existing isolated storage fixture; all non-local requests are blocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)('playwright');
const origin = process.env.TEST_ORIGIN ?? 'http://127.0.0.1:5173';
const base = `${origin}/predator-prey-simulation-2/`;
const output = fileURLToPath(new URL('../verification.local/apex-transition/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER ?? 'msedge', headless: true });
const results = [];
const errors = [];
let externalWrites = 0;
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.route('**/*', route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  if (route.request().method() !== 'GET') externalWrites++;
  return route.abort();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const click = mode => page.locator(`[data-app-mode=${mode}]`).click();
const phase = () => page.locator('.board-card').getAttribute('data-mode-phase');
const state = () => page.evaluate(() => {
  const q = s => document.querySelector(s);
  const css = s => getComputedStyle(q(s));
  const rect = s => { const { x, y, width, height } = q(s).getBoundingClientRect(); return { x, y, width, height }; };
  return {
    mode: q('.board-card').dataset.modeEffects, phase: q('.board-card').dataset.modePhase,
    capsule: rect('.mode-capsule'), tabs: rect('.mode-switch'), label: rect('.apex-tab-label'),
    heat: +css('.apex-panel-heat').opacity, flame: +css('.apex-tab-ignition').opacity,
    sweep: parseFloat(css('.apex-heat-sweep').strokeDashoffset), steady: +css('.apex-heat-steady').opacity,
    step: q('#step-value').textContent, challengePhase: q('#challenge-panel').dataset.phase,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    animations: q('.board-card').getAnimations({ subtree: true }).filter(a => a.playState === 'running').length,
  };
});
const settled = async mode => {
  await page.waitForFunction(expected => document.querySelector('.board-card').dataset.modePhase === expected, mode === 'apex' ? 'steady' : 'idle');
};
const shot = name => page.screenshot({ path: `${output}/${name}.png`, fullPage: false });

try {
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [1920, 1080], [320, 740], [1180, 820]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}tests/browser.html`);
    await page.waitForSelector('.board-card[data-mode-phase=idle]');
    const free = await state();
    assert.equal(free.heat, 0); assert.equal(free.flame, 0); assert.equal(free.overflow, false);
    await shot(`free-${width}`);
    await click('apex');
    await settled('apex');
    const apex = await state();
    assert.deepEqual(apex.tabs, free.tabs, `tab bounds at ${width}`);
    assert.deepEqual(apex.label, free.label, `label bounds at ${width}`);
    assert.equal(apex.overflow, false); assert.equal(apex.challengePhase, 'setup'); assert.equal(apex.step, '000');
    assert.ok(apex.capsule.x > free.capsule.x + 90);
    assert.equal(apex.heat, 1); assert.equal(apex.flame, 1); assert.equal(apex.steady, 1);
    await shot(`apex-${width}`);
    await click('apex'); assert.equal(await phase(), 'steady');
    await page.locator('#reset-button').click(); assert.equal(await phase(), 'steady');
    await click('free'); await settled('free');
    const returned = await state();
    assert.equal(returned.heat, 0); assert.equal(returned.flame, 0);
    assert.deepEqual(returned.tabs, free.tabs);
    results.push({ viewport: [width, height], free, apex, returned });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}tests/browser.html`);
  await page.waitForSelector('.board-card[data-mode-phase=idle]');
  // Keep references across data rendering, reset and repeated selections.
  await page.evaluate(() => { window.capsuleBefore = document.querySelector('.mode-capsule'); });
  const before = await state();
  await shot('01-free');
  // Browser-side frame sampling verifies time ordering and continuous travel.
  const timeline = await page.evaluate(async () => {
    const q = s => document.querySelector(s);
    const sample = t => ({ t, x: q('.mode-capsule').getBoundingClientRect().x,
      flame: +getComputedStyle(q('.apex-tab-ignition')).opacity,
      heat: +getComputedStyle(q('.apex-panel-heat')).opacity,
      dash: parseFloat(getComputedStyle(q('.apex-heat-sweep')).strokeDashoffset),
      steady: +getComputedStyle(q('.apex-heat-steady')).opacity,
      phase: q('.board-card').dataset.modePhase });
    const samples = []; const start = performance.now();
    q('[data-app-mode=apex]').click();
    await new Promise(resolve => {
      function frame() { const t = performance.now() - start; samples.push(sample(t)); if (t < 1350) requestAnimationFrame(frame); else resolve(); }
      requestAnimationFrame(frame);
    });
    return samples;
  });
  const after = await state();
  assert.ok(timeline.some(s => s.x > before.capsule.x + 5 && s.x < after.capsule.x - 5), 'capsule passes intermediate positions');
  assert.ok(timeline.some(s => s.flame > .1 && s.heat === 0), 'tab ignites before panel');
  assert.ok(timeline.some(s => s.heat > .2 && s.dash > .1 && s.dash < .9 && s.steady === 0), 'outline progressively reveals before steady outline');
  assert.equal(timeline.at(-1).phase, 'steady');
  results.push({ timeline });

  // Freeze browser animations at meaningful points only for evidence screenshots.
  // The sampled run above executes without pausing or changing animation clocks.
  for (const [name, time] of [['02-capsule-moving', 130], ['03-panel-igniting', 640]]) {
    await click('free'); await settled('free');
    await page.evaluate(time => {
      document.querySelector('[data-app-mode=apex]').click();
      document.querySelector('.mode-capsule').getBoundingClientRect();
      for (const a of document.querySelector('.board-card').getAnimations({ subtree: true })) {
        a.pause(); a.currentTime = time;
      }
    }, time);
    await shot(name);
    await page.evaluate(() => document.querySelector('.board-card').getAnimations({ subtree: true }).forEach(a => a.play()));
    await settled('apex');
  }
  await shot('04-apex-steady');
  for (const wait of [60, 280, 640, 1000]) {
    await click('free'); await page.waitForTimeout(wait / 3);
    await click('apex'); await page.waitForTimeout(wait);
    await click('free'); await page.waitForTimeout(45);
    await click('apex'); await settled('apex');
    assert.equal((await state()).mode, 'apex');
  }
  await click('free'); await settled('free'); await shot('05-returned-free');
  await page.waitForTimeout(1300); assert.equal(await phase(), 'idle');

  await page.locator('#forest-board').click({ position: { x: 80, y: 80 } });
  assert.equal(await page.locator('#cell-inspector').isVisible(), true);
  await page.locator('#step-button').click(); assert.equal((await state()).step, '001');
  await page.locator('#run-button').click();
  await page.waitForFunction(() => Number(document.querySelector('#step-value').textContent) > 1);
  await page.locator('#pause-button').click();
  const paused = (await state()).step;
  await page.waitForTimeout(200); assert.equal((await state()).step, paused);
  await page.locator('#reset-button').click(); assert.equal((await state()).step, '000');
  await page.locator('[data-app-mode=apex]').focus(); await page.keyboard.press('Enter'); await settled('apex');
  await page.locator('[data-challenge-action=start]').click();
  assert.equal((await state()).challengePhase, 'active');
  await page.locator('#pause-button').click();
  const rejected = page.waitForEvent('dialog').then(d => d.dismiss());
  await click('free'); await rejected;
  assert.equal((await state()).mode, 'apex'); assert.equal(await phase(), 'steady');
  const accepted = page.waitForEvent('dialog').then(d => d.accept());
  await click('free'); await accepted; await settled('free');
  assert.equal((await state()).mode, 'free');
  assert.ok(await page.evaluate(() => window.capsuleBefore === document.querySelector('.mode-capsule')));

  await click('apex'); await page.waitForTimeout(500);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Emulation acknowledgement precedes the browser's MediaQueryList change event.
  await page.waitForFunction(() => document.querySelector('.board-card').dataset.modePhase === 'steady', null, { timeout: 400 });
  assert.equal(await phase(), 'steady'); assert.equal((await state()).animations, 0);
  await click('free'); assert.equal(await phase(), 'idle'); assert.equal((await state()).heat, 0);
  await click('apex'); assert.equal(await phase(), 'steady'); assert.equal((await state()).animations, 0);
  await shot('reduced-motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await phase(), 'steady');
  await page.setViewportSize({ width: 1024, height: 768 }); assert.equal(await phase(), 'steady');

  // Deterministically deliver visibility events; headless windows do not expose an
  // OS tab switch. This checks cancellation/pausing, rather than claiming device QA.
  await click('free'); await settled('free'); await click('apex');
  await page.waitForTimeout(480);
  const visibility = await page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const panel = document.querySelector('.board-card');
    const hidden = { phase: panel.dataset.modePhase,
      paused: getComputedStyle(panel.querySelector('.apex-tab-flame')).animationPlayState,
      active: panel.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length };
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { hidden, resumed: panel.dataset.modePhase };
  });
  assert.deepEqual(visibility, { hidden: { phase: 'steady', paused: 'paused', active: 0 }, resumed: 'steady' });
  results.push({ simulatedVisibility: visibility });

  // The app currently always opens in free mode. Exercise the decoration's initial
  // Apex contract directly, without adding persisted app mode or touching real storage.
  const restored = await page.evaluate(async () => {
    const { createModeEffects } = await import('/predator-prey-simulation-2/src/modeEffects.ts');
    const panel = document.querySelector('.board-card').cloneNode(true);
    panel.querySelector('.apex-panel-heat').remove();
    for (const key of Object.keys(panel.dataset)) delete panel.dataset[key];
    document.body.append(panel);
    panel.querySelector('.mode-capsule').getBoundingClientRect();
    const effects = createModeEffects(panel, 'apex', matchMedia('(prefers-reduced-motion: reduce)'));
    const result = { phase: panel.dataset.modePhase, opacity: getComputedStyle(panel.querySelector('.apex-panel-heat')).opacity,
      finite: panel.getAnimations({ subtree: true }).filter(a => Number.isFinite(a.effect.getTiming().iterations)).length };
    panel.remove(); await new Promise(resolve => setTimeout(resolve, 0));
    result.cleaned = !panel.querySelector('.apex-panel-heat');
    effects.destroy(); return result;
  });
  assert.deepEqual(restored, { phase: 'steady', opacity: '1', finite: 0, cleaned: true });
  results.push({ restored, functionalChecks: 'map, keyboard, run/pause/step/reset, challenge start, confirmation reject/accept, rapid reversal, repeated selection, reduced motion, resize' });
  assert.equal(externalWrites, 0);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors, externalWrites }, null, 2));
  console.log(`PASS: ${results.length} groups; no console errors or external writes. Evidence: ${output}`);
} finally {
  await browser.close();
}
