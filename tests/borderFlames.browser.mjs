// Run against Vite with Playwright available. Uses isolated local storage and blocks external requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const origin = process.env.TEST_ORIGIN ?? 'http://127.0.0.1:5173';
const base = `${origin}/predator-prey-simulation-2/`;
const output = fileURLToPath(new URL('../verification.local/flame-tongues/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER ?? 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1877, height: 1000 } });
await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const page = await context.newPage();
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
const choose = async mode => {
  await page.locator(`[data-app-mode=${mode}]`).click();
  await page.waitForFunction(phase => document.querySelector('.board-card').dataset.modePhase === phase, mode === 'apex' ? 'steady' : 'idle');
};
const capture = (name, fullPage = false) => page.screenshot({ path: `${output}/${name}.png`, fullPage });
const inspect = () => page.evaluate(() => {
  const panel = document.querySelector('.board-card'), layer = panel.querySelector('.apex-panel-heat');
  const p = panel.getBoundingClientRect(), svg = layer.querySelector('svg');
  return {
    phase: panel.dataset.modePhase, width: p.width - 2, height: p.height - 2,
    viewBox: svg.getAttribute('viewBox'), paths: [...layer.querySelectorAll('.apex-perimeter')].map(p => p.getAttribute('d')),
    sprites: layer.querySelectorAll('.apex-flame-orbit, .apex-flame-body, .apex-flame-frame').length,
    bands: [...layer.querySelectorAll('.apex-flame-band')].map(p => ({ d: p.getAttribute('d'), opacity: +getComputedStyle(p).fillOpacity })),
    embers: layer.querySelectorAll('.apex-border-ember').length,
    activeEmbers: [...layer.querySelectorAll('.apex-border-ember')].filter(p => +getComputedStyle(p).opacity > .05).length,
    hotOffset: parseFloat(getComputedStyle(layer.querySelector('.apex-heat-hot')).strokeDashoffset),
    running: panel.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    heat: +getComputedStyle(layer).opacity,
  };
});
function continuous(state) {
  assert.equal(state.sprites, 0, 'no travelling or nested flame sprites');
  assert.equal(new Set(state.paths).size, 1, 'all heat layers share one continuous rounded path');
  assert.ok(state.paths[0].endsWith('Z'));
  assert.equal((state.paths[0].match(/ A /g) ?? []).length, 4, 'four rounded arcs, no special corner assets');
  const [x, y, w, h] = state.viewBox.split(' ').map(Number);
  assert.equal(x, 0); assert.equal(y, 0);
  assert.ok(Math.abs(w - state.width) < .02 && Math.abs(h - state.height) < .02);
  assert.equal(state.bands.length, 3); assert.equal(state.embers, 6);
  assert.ok(state.bands.every(band => band.d?.endsWith(' Z')), 'each heat color is one closed, continuous contour');
  assert.equal(state.overflow, false);
}
const measureFlames = () => page.evaluate(() => {
  const panel = document.querySelector('.board-card'), svg = panel.querySelector('svg.apex-panel-outline');
  const [, , w, h] = svg.getAttribute('viewBox').split(' ').map(Number);
  const r = parseFloat(getComputedStyle(panel).borderTopLeftRadius) - 1;
  const d = panel.querySelector('.apex-flame-outer').getAttribute('d');
  // Signed distance from the actual rounded border, including all four arcs.
  const heights = [...d.matchAll(/Q ([\d.-]+) ([\d.-]+)/g)].map(m => {
    const qx = Math.abs(+m[1] - w / 2) - (w / 2 - r), qy = Math.abs(+m[2] - h / 2) - (h / 2 - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  });
  const scale = parseFloat(getComputedStyle(panel.querySelector('.apex-edge-flames')).getPropertyValue('--apex-flame-scale'));
  return { min: Math.min(...heights), max: Math.max(...heights),
    activeCoverage: heights.filter(h => h >= 5 * scale).length / heights.length,
    smallCoverage: heights.filter(h => h >= 5 * scale && h < 9 * scale).length / heights.length,
    mediumCoverage: heights.filter(h => h >= 9 * scale && h < 15 * scale).length / heights.length,
    tallCoverage: heights.filter(h => h >= 15 * scale).length / heights.length };
});
try {
  await page.goto(`${base}tests/browser.html`);
  await choose('apex');
  await page.evaluate(() => {
    window.originalHeat = document.querySelector('.apex-panel-heat');
    window.originalHot = document.querySelector('.apex-heat-hot').getAnimations()[0];
    window.originalParticles = [...document.querySelectorAll('.apex-flame-band, .apex-border-ember')];
  });
  const first = await inspect(); continuous(first);
  const geometry = await page.evaluate(async () => {
    const { createBorderSampler } = await import('/predator-prey-simulation-2/src/borderFlames.ts');
    const panel = document.querySelector('.board-card'), bounds = panel.getBoundingClientRect();
    const r = parseFloat(getComputedStyle(panel).borderTopLeftRadius) - 1;
    const sampler = createBorderSampler(bounds.width - 2, bounds.height - 2, r);
    const path = panel.querySelector('.apex-perimeter');
    let maxError = 0, maxNormalError = 0;
    for (let i = 0; i < 400; i++) {
      const d = sampler.length * i / 400, actual = sampler.point(d), expected = path.getPointAtLength(d);
      maxError = Math.max(maxError, Math.hypot(actual.x - expected.x, actual.y - expected.y));
      maxNormalError = Math.max(maxNormalError, Math.abs(Math.hypot(actual.tx, actual.ty) - 1));
    }
    return { maxError, maxNormalError };
  });
  assert.ok(geometry.maxError < .2 && geometry.maxNormalError < .001, 'contours follow the actual SVG boundary and its outward normals');
  await capture('desktop-t0');
  const started = Date.now(), measurements = [{ second: 0, ...await measureFlames() }];
  const temporalPromise = page.evaluate(async () => {
    const samples = [], shapes = new Set();
    for (let i = 0; i < 24; i++) {
      await new Promise(resolve => setTimeout(resolve, 220));
      const bands = [...document.querySelectorAll('.apex-flame-band')];
      bands.forEach(p => shapes.add(p.getAttribute('d')));
      samples.push({
        bands: bands.length,
        embers: [...document.querySelectorAll('.apex-border-ember')].filter(p => +getComputedStyle(p).opacity > .05).length,
      });
    }
    return { samples, uniqueShapes: shapes.size };
  });
  for (const second of [1, 3, 5]) {
    await page.waitForTimeout(Math.max(0, second * 1000 - (Date.now() - started)));
    await capture(`desktop-t${second}`);
    measurements.push({ second, ...await measureFlames() });
  }
  const temporal = await temporalPromise;
  const later = await inspect(); continuous(later);
  assert.notEqual(first.hotOffset, later.hotOffset, 'bright patches evolve without moving standalone icons');
  assert.ok(temporal.uniqueShapes >= 60, 'all three heat contours deform continuously');
  assert.ok(temporal.samples.every(s => s.bands === 3 && s.embers <= 6));
  assert.ok(temporal.samples.some(s => s.embers > 0));
  const coverage = measurements.reduce((sum, m) => sum + m.activeCoverage, 0) / measurements.length;
  assert.ok(coverage >= .2 && coverage <= .35, `active perimeter coverage ${coverage}`);
  assert.ok(measurements.every(m => m.min >= 0 && m.max <= 22.02 && m.max >= 15), 'visible tongues project outward, capped at 22px');
  assert.ok(measurements.every(m => m.smallCoverage + m.mediumCoverage > m.tallCoverage * 2), 'small/medium flames dominate');
  assert.ok(first.bands.every((band, i) => band.d !== later.bands[i].d));
  results.push({ continuousBoundary: { first, later, temporal, geometry, measurements } });

  const clockBefore = await page.evaluate(() => window.originalHot.currentTime);
  await choose('apex'); await page.locator('#reset-button').click();
  const identity = await page.evaluate(() => ({
    sameLayer: window.originalHeat === document.querySelector('.apex-panel-heat'),
    sameAnimation: window.originalHot === document.querySelector('.apex-heat-hot').getAnimations()[0],
    clock: window.originalHot.currentTime,
  }));
  assert.ok(identity.sameLayer && identity.sameAnimation && identity.clock >= clockBefore);
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => document.querySelector('[data-app-mode=free]').click());
    await page.waitForTimeout(30 + i * 9);
    await page.evaluate(() => document.querySelector('[data-app-mode=apex]').click());
    await page.waitForTimeout(40);
  }
  await choose('apex');
  assert.ok(await page.evaluate(() => window.originalParticles.every((n, i) => n === document.querySelectorAll('.apex-flame-band, .apex-border-ember')[i])));
  const exit = await page.evaluate(async () => {
    const layer = document.querySelector('.apex-panel-heat');
    const start = performance.now(); document.querySelector('[data-app-mode=free]').click();
    await new Promise(resolve => setTimeout(resolve, 140)); const midway = +getComputedStyle(layer).opacity;
    await new Promise(resolve => {
      function frame() { if (document.querySelector('.board-card').dataset.modePhase === 'idle') resolve(); else requestAnimationFrame(frame); }
      frame();
    });
    return { midway, elapsed: performance.now() - start };
  });
  console.log('Exit observation', exit);
  assert.ok(exit.midway > 0 && exit.midway < 1); assert.ok(exit.elapsed >= 250 && exit.elapsed < 480);
  await page.waitForTimeout(900);
  const free = await inspect(); assert.equal(free.heat, 0); assert.equal(free.running, 0); assert.equal(free.activeEmbers, 0);
  results.push({ identity, rapidReversalAndExit: exit, idle: free });

  for (const [width, height] of [[1920, 1080], [1440, 900], [1024, 768], [600, 850], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height }); await choose('apex'); await page.waitForTimeout(160);
    const state = await inspect(); continuous(state);
    const sizeMetrics = await measureFlames();
    assert.ok(sizeMetrics.min >= 0 && sizeMetrics.max <= (width <= 600 ? 14.32 : 22.02), 'resize keeps the full contour outside the content');
    assert.ok(await page.evaluate(() => {
      const selectors = ['.board-card', '.board-heading', '.mode-switch', '.population-hud', '.canvas-frame', '.board-footnote'];
      const boxes = () => selectors.map(s => JSON.stringify(document.querySelector(s).getBoundingClientRect()));
      const before = boxes(), layer = document.querySelector('.apex-panel-heat'); layer.hidden = true;
      const unchanged = JSON.stringify(boxes()) === JSON.stringify(before); layer.hidden = false; return unchanged;
    }));
    // Full-card hit area and keyboard access retain the existing dialog/return focus.
    const card = page.locator('#toggle-parameters');
    await card.focus();
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    assert.ok(await card.evaluate(e => e.matches(':focus-visible') && getComputedStyle(e).outlineStyle === 'solid'));
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#parameters-dialog').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.ok(await card.evaluate(e => document.activeElement === e));
    const cardBounds = await card.boundingBox(), cta = await page.locator('.parameter-entry-action').boundingBox();
    assert.ok(cta.x >= cardBounds.x && cta.x + cta.width <= cardBounds.x + cardBounds.width);
    await card.click(); assert.equal(await page.locator('#parameters-dialog').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.locator('.board-card').scrollIntoViewIfNeeded();
    await capture(`apex-${width}`, width <= 600);
    await choose('free');
    assert.match(await page.locator('#parameter-entry-hint').textContent(), /실험을 설계/);
    await card.click(); await page.keyboard.press('Escape');
    await capture(`free-${width}`, width <= 600);
    results.push({ resized: [width, height], state });
  }

  await page.setViewportSize({ width: 1877, height: 1000 }); await choose('apex');
  const card = page.locator('#toggle-parameters');
  await card.hover(); await page.waitForTimeout(200); await capture('parameters-hover');
  await page.mouse.move(1850, 10); await card.focus();
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); await capture('parameters-focus');
  assert.equal(await page.locator('.apex-panel-heat').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator('.apex-panel-heat').evaluate(e => getComputedStyle(e).pointerEvents), 'none');
  await page.locator('#forest-board').click({ position: { x: 80, y: 80 } });
  assert.equal(await page.locator('#cell-inspector').isVisible(), true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.board-card').getAnimations({ subtree: true }).filter(a => a.playState === 'running').length === 0);
  const reduced = await inspect(); assert.equal(reduced.heat, 1); assert.equal(reduced.activeEmbers, 0);
  assert.equal(await page.locator('.apex-edge-flames').isVisible(), false); await capture('reduced-motion');
  await choose('free'); await choose('apex'); assert.equal((await inspect()).running, 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForTimeout(180);
  const visibility = await page.evaluate(async () => {
    const hot = document.querySelector('.apex-heat-hot');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
    const clock = () => hot.getAnimations()[0].currentTime;
    const before = clock(), shapeBefore = document.querySelector('.apex-flame-outer').getAttribute('d'); document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve => setTimeout(resolve, 600));
    const after = clock(), running = document.querySelector('.board-card').getAnimations({ subtree: true }).filter(a => a.playState === 'running').length;
    const frozen = shapeBefore === document.querySelector('.apex-flame-outer').getAttribute('d');
    delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve => setTimeout(resolve, 160));
    return { before, after, running, frozen, resumed: clock(), deforming: shapeBefore !== document.querySelector('.apex-flame-outer').getAttribute('d') };
  });
  assert.ok(Math.abs(visibility.after - visibility.before) < 25); assert.equal(visibility.running, 0);
  assert.ok(visibility.frozen && visibility.deforming, 'hidden tabs freeze the procedural contour and resume without a jump');
  assert.ok(visibility.resumed > visibility.after + 50); results.push({ reduced, simulatedVisibility: visibility });

  // Actual application, same challenge seed, maximum speed, with/without animation.
  const highSpeed = [];
  for (const preference of ['no-preference', 'reduce']) {
    await choose('free'); await choose('apex'); await page.emulateMedia({ reducedMotion: preference });
    await page.locator('#speed-control').fill('40'); await page.locator('#speed-control').dispatchEvent('input');
    const performanceResult = await page.evaluate(async () => {
      const deltas = [], completedSteps = []; let last;
      const panel = document.querySelector('.board-card'), heat = panel.querySelector('.apex-panel-heat');
      const start = performance.now(); document.querySelector('[data-challenge-action=start]').click();
      await new Promise(resolve => {
        function frame(t) {
          if (last) deltas.push(t - last); last = t;
          if (performance.now() - start >= 4000) { resolve(); return; }
          if (document.querySelector('#challenge-panel').dataset.phase === 'over') {
            completedSteps.push(+document.querySelector('#step-value').textContent);
            document.querySelector('[data-challenge-action=retry]').click();
          }
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
      document.querySelector('#pause-button').click();
      deltas.sort((a, b) => a - b);
      const step = +document.querySelector('#step-value').textContent;
      return { step, completedSteps, totalSteps: completedSteps.reduce((a, b) => a + b, step),
        medianFrameMs: deltas[Math.floor(deltas.length / 2)], p95FrameMs: deltas[Math.floor(deltas.length * .95)],
        frames: deltas.length, sameHeat: heat === panel.querySelector('.apex-panel-heat'), phase: panel.dataset.modePhase };
    });
    assert.ok(performanceResult.totalSteps >= 120); assert.ok(performanceResult.sameHeat); assert.equal(performanceResult.phase, 'steady');
    await card.click();
    assert.equal(await page.locator('#parameter-entry-action').textContent(), '설정 보기');
    assert.equal(await page.locator('#apply-parameters').isDisabled(), true);
    await page.keyboard.press('Escape');
    highSpeed.push({ preference, ...performanceResult });
  }
  assert.ok(highSpeed.every(run => run.completedSteps.every(step => step === highSpeed[0].completedSteps[0])), 'animation cannot change seeded outcomes');
  results.push({ highSpeed });

  await choose('free'); await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#step-button').click(); assert.equal(await page.locator('#step-value').textContent(), '001');
  await page.locator('#run-button').click(); await page.waitForTimeout(160); await page.locator('#pause-button').click();
  const pausedStep = await page.locator('#step-value').textContent(); await page.waitForTimeout(150);
  assert.equal(await page.locator('#step-value').textContent(), pausedStep);
  await page.locator('#reset-button').click(); assert.equal(await page.locator('#step-value').textContent(), '000');
  await page.locator('#toggle-graph').click();
  assert.equal((await inspect()).phase, 'idle');
  await choose('free');
  const lifecycle = await page.evaluate(async () => {
    const { createModeEffects } = await import('/predator-prey-simulation-2/src/modeEffects.ts');
    const panel = document.querySelector('.board-card').cloneNode(true);
    panel.querySelector('.apex-panel-heat').remove();
    for (const key of Object.keys(panel.dataset)) delete panel.dataset[key];
    document.body.append(panel);
    const nativeSet = window.setTimeout, nativeClear = window.clearTimeout, timers = new Set();
    const NativeResize = window.ResizeObserver, NativeMutation = window.MutationObserver, observers = new Set();
    window.setTimeout = (fn, delay, ...args) => { const id = nativeSet(() => { timers.delete(id); fn(...args); }, delay); timers.add(id); return id; };
    window.clearTimeout = id => { timers.delete(id); nativeClear(id); };
    window.ResizeObserver = class extends NativeResize { constructor(fn) { super(fn); observers.add(this); } disconnect() { observers.delete(this); super.disconnect(); } };
    window.MutationObserver = class extends NativeMutation { constructor(fn) { super(fn); observers.add(this); } disconnect() { observers.delete(this); super.disconnect(); } };
    const delay = ms => new Promise(resolve => nativeSet(resolve, ms));
    let effects;
    try {
      effects = createModeEffects(panel, 'apex', matchMedia('(prefers-reduced-motion: reduce)'));
      const initial = { phase: panel.dataset.modePhase, timers: timers.size, observers: observers.size };
      effects.sync('free'); const emissionTimersOnExit = timers.size;
      await delay(420);
      const idle = { timers: timers.size, animations: panel.querySelector('.apex-panel-heat').getAnimations({ subtree: true }).length };
      effects.sync('apex'); const activeTimers = timers.size;
      const layer = panel.querySelector('.apex-panel-heat'); panel.remove(); await delay(0);
      return { initial, emissionTimersOnExit, idle, activeTimers, cleaned: !panel.querySelector('.apex-panel-heat'), timers: timers.size,
        observers: observers.size, animations: layer.getAnimations({ subtree: true }).length };
    } finally {
      effects?.destroy(); panel.remove(); window.setTimeout = nativeSet; window.clearTimeout = nativeClear;
      window.ResizeObserver = NativeResize; window.MutationObserver = NativeMutation;
    }
  });
  assert.deepEqual(lifecycle, { initial: { phase: 'steady', timers: 1, observers: 2 }, emissionTimersOnExit: 0,
    idle: { timers: 0, animations: 0 }, activeTimers: 1, cleaned: true, timers: 0, observers: 0, animations: 0 });
  results.push({ lifecycle });
  assert.deepEqual(errors, []);
  await choose('apex');
  await page.setViewportSize({width:1877,height:1000}); await page.locator('.board-card').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2400); await capture('final-desktop');
  await writeFile(`${output}/results.json`, JSON.stringify({ browser: browser.version(), results, errors }, null, 2));
  console.log(`PASS: ${results.length} groups; screenshots and measurements: ${output}`);
  console.log('High-speed observations:', highSpeed);
} finally { await browser.close(); }
