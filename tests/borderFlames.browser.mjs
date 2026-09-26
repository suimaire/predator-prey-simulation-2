// Run against Vite with Playwright available (same isolated fixture as modeEffects).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const origin = process.env.TEST_ORIGIN ?? 'http://127.0.0.1:5173';
const base = `${origin}/predator-prey-simulation-2/`;
const output = fileURLToPath(new URL('../verification.local/border-flames/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER ?? 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const page = await context.newPage();
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
const choose = async mode => {
  await page.locator(`[data-app-mode=${mode}]`).click();
  await page.waitForFunction(phase => document.querySelector('.board-card').dataset.modePhase === phase, mode === 'apex' ? 'steady' : 'idle');
};
const capture = name => page.screenshot({ path: `${output}/${name}.png`, fullPage: false });
const inspect = () => page.evaluate(() => {
  const panel = document.querySelector('.board-card'), layer = panel.querySelector('.apex-edge-flames');
  const p = panel.getBoundingClientRect();
  const flames = [...layer.querySelectorAll('.apex-flame-orbit')].filter(el => !el.hidden).map(el => {
    const body = el.firstElementChild, b = body.getBoundingClientRect(), m = el.getBoundingClientRect();
    return { x: m.x - p.x - 1, y: m.y - p.y - 1, width: b.width, height: b.height,
      bounds: { x: b.x, y: b.y, right: b.right, bottom: b.bottom },
      transform: getComputedStyle(body).transform,
      cornerScale: parseFloat(getComputedStyle(body).scale),
      opacity: +getComputedStyle(body).opacity,
      frames: [...body.querySelectorAll('g')].map(g => +getComputedStyle(g).opacity),
      rotate: getComputedStyle(el).offsetRotate,
    };
  });
  return { phase: panel.dataset.modePhase, travel: layer.dataset.travel, width: p.width - 2, height: p.height - 2,
    radius: parseFloat(getComputedStyle(panel).borderRadius) - 1, flames,
    pool: layer.querySelectorAll('.apex-flame-orbit').length, embers: layer.querySelectorAll('.apex-border-ember').length,
    activeEmbers: [...layer.querySelectorAll('.apex-border-ember')].filter(e => +getComputedStyle(e).opacity > 0).length,
    running: panel.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    heat: +getComputedStyle(panel.querySelector('.apex-panel-heat')).opacity };
});
function onBorder(state) {
  const { width: w, height: h, radius: r } = state;
  for (const { x, y, cornerScale, opacity } of state.flames) {
    const cx = Math.max(r, Math.min(w - r, x)), cy = Math.max(r, Math.min(h - r, y));
    assert.ok(Math.abs(Math.hypot(x - cx, y - cy) - r) < 1, `point (${x}, ${y}) follows rounded border ${w}×${h}`);
    const cornerDistance = Math.max(Math.min(x, w - x), Math.min(y, h - y));
    if (cornerDistance < r - 1) {
      assert.ok(cornerScale <= .66 && opacity < .7, 'corners soften size and brightness');
    } else if (cornerDistance > r + 32) {
      assert.ok(cornerScale > .99 && opacity > .93, `straight-edge flames retain their original strength: ${JSON.stringify({ w, h, r, x, y, cornerScale, opacity })}`);
    }
  }
}
try {
  await page.goto(`${base}tests/browser.html`);
  await choose('apex');
  await page.evaluate(() => { window.originalFlames = [...document.querySelectorAll('.apex-flame-orbit')]; });
  const first = await inspect(); onBorder(first);
  assert.equal(first.travel, 'motion-path'); assert.equal(first.flames.length, 12);
  await capture('desktop-t0');
  await page.waitForTimeout(2700);
  const later = await inspect(); onBorder(later);
  assert.ok(later.flames.every((f, i) => Math.hypot(f.x - first.flames[i].x, f.y - first.flames[i].y) > 30));
  assert.ok(later.flames.some((f, i) => Math.abs(f.height - first.flames[i].height) > 1));
  assert.ok(later.flames.some((f, i) => f.frames.join() !== first.flames[i].frames.join()));
  assert.ok(later.flames.every(f => f.rotate === '0deg'));
  await capture('desktop-t2700');
  results.push({ sustained: { first, later } });

  // Observe natural animation across all four corners; do not alter animation clocks.
  const continuity = await page.evaluate(async () => {
    const nodes = [...document.querySelectorAll('.apex-flame-orbit')];
    const panel = document.querySelector('.board-card'), rect = panel.getBoundingClientRect();
    const corners = new Set(), softenedCorners = new Set(); let last = null, lastTime = 0, maxSpeed = 0, activeEmbers = 0;
    const start = performance.now();
    await new Promise(resolve => {
      function sample(now) {
        const points = nodes.map(n => { const r = n.getBoundingClientRect(); return { x: r.x - rect.x - 1, y: r.y - rect.y - 1 }; });
        points.forEach((p, i) => {
          if ((p.x < 17 || p.x > rect.width - 19) && (p.y < 17 || p.y > rect.height - 19)) corners.add(`${p.x < 17 ? 'left' : 'right'}-${p.y < 17 ? 'top' : 'bottom'}`);
          if ((p.x < 14 || p.x > rect.width - 16) && (p.y < 14 || p.y > rect.height - 16)) {
            const scale = parseFloat(getComputedStyle(nodes[i].firstElementChild).scale);
            if (scale <= .66) softenedCorners.add(`${p.x < 14 ? 'left' : 'right'}-${p.y < 14 ? 'top' : 'bottom'}`);
          }
          if (last) maxSpeed = Math.max(maxSpeed, Math.hypot(p.x - last[i].x, p.y - last[i].y) / (now - lastTime));
        });
        activeEmbers = Math.max(activeEmbers, [...panel.querySelectorAll('.apex-border-ember')].filter(e => +getComputedStyle(e).opacity > 0).length);
        last = points; lastTime = now;
        if (now - start < 4400) requestAnimationFrame(sample); else resolve();
      }
      requestAnimationFrame(sample);
    });
    return { corners: [...corners].sort(), softenedCorners: [...softenedCorners].sort(), maxSpeed, activeEmbers };
  });
  assert.equal(continuity.corners.length, 4); assert.ok(continuity.maxSpeed < .6);
  assert.equal(continuity.softenedCorners.length, 4, 'all four corners soften during natural travel');
  assert.ok(continuity.activeEmbers > 0 && continuity.activeEmbers <= 4);
  results.push({ continuity });

  // Rendering, same-mode selection, and reversal must preserve the pool and clocks.
  const clockBefore = await page.evaluate(() => document.querySelector('.apex-flame-orbit').getAnimations()[0].currentTime);
  await choose('apex'); await page.locator('#reset-button').click();
  const clockAfter = await page.evaluate(() => document.querySelector('.apex-flame-orbit').getAnimations()[0].currentTime);
  assert.ok(clockAfter >= clockBefore);
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => document.querySelector('[data-app-mode=free]').click());
    await page.waitForTimeout(35 + i * 9);
    await page.evaluate(() => document.querySelector('[data-app-mode=apex]').click());
    await page.waitForTimeout(45);
  }
  await choose('apex'); await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => window.originalFlames.every((node, i) => node === document.querySelectorAll('.apex-flame-orbit')[i])));
  assert.equal((await inspect()).pool, 12); assert.equal((await inspect()).embers, 4);
  const exit = await page.evaluate(async () => {
    const layer = document.querySelector('.apex-panel-heat');
    const start = performance.now(); document.querySelector('[data-app-mode=free]').click();
    await new Promise(r => setTimeout(r, 140)); const midway = +getComputedStyle(layer).opacity;
    await new Promise(resolve => {
      function frame() { if (document.querySelector('.board-card').dataset.modePhase === 'idle') resolve(); else requestAnimationFrame(frame); }
      frame();
    });
    return { midway, elapsed: performance.now() - start };
  });
  assert.ok(exit.midway > 0 && exit.midway < 1); assert.ok(exit.elapsed >= 250 && exit.elapsed < 450);
  const free = await inspect(); assert.equal(free.heat, 0); assert.equal(free.running, 0); assert.equal(free.activeEmbers, 0);
  await page.waitForTimeout(1100); assert.equal((await inspect()).running, 0);
  results.push({ exit, idle: free });

  for (const [width, height] of [[1920, 1080], [1024, 768], [600, 850], [390, 844], [320, 740], [1440, 1000]]) {
    await page.setViewportSize({ width, height }); await choose('apex'); await page.waitForTimeout(100);
    const state = await inspect(); onBorder(state);
    if (state.overflow) {
      await capture(`overflow-${width}`);
      console.log('Overflow details', width, await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
        nodes: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth).map(e => ({ cls: e.className.baseVal ?? e.className, right: e.getBoundingClientRect().right })).slice(0, 20) })));
    }
    assert.equal(state.overflow, false);
    assert.equal(state.flames.length, state.width <= 600 ? 6 : 12);
    assert.ok(state.flames.every(f => f.bounds.x >= 0 && f.bounds.right <= width));
    // Removing decoration changes no content geometry, even at narrow breakpoints.
    assert.ok(await page.evaluate(() => {
      const selectors = ['.board-card', '.board-heading', '.mode-switch', '.population-hud', '.canvas-frame', '.board-footnote'];
      const boxes = () => selectors.map(s => JSON.stringify(document.querySelector(s).getBoundingClientRect()));
      const before = boxes(), layer = document.querySelector('.apex-panel-heat'); layer.hidden = true;
      const unchanged = JSON.stringify(boxes()) === JSON.stringify(before); layer.hidden = false; return unchanged;
    }));
    await capture(`resized-${width}`); results.push({ resized: [width, height], state });
  }

  await page.locator('#forest-board').click({ position: { x: 80, y: 80 } });
  assert.ok(await page.locator('#cell-inspector').isVisible());
  await page.locator('[data-app-mode=free]').focus(); await page.keyboard.press('Enter'); await choose('free');
  await page.locator('[data-app-mode=apex]').focus(); await page.keyboard.press('Enter'); await choose('apex');
  assert.ok(await page.evaluate(() => document.querySelector('.apex-panel-heat').getAttribute('aria-hidden') === 'true' && getComputedStyle(document.querySelector('.apex-panel-heat')).pointerEvents === 'none'));

  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(100);
  const reduced = await inspect(); assert.equal(reduced.running, 0); assert.equal(reduced.heat, 1);
  assert.equal(await page.locator('.apex-edge-flames').isVisible(), false); await capture('reduced-motion');
  await choose('free'); await choose('apex'); assert.equal((await inspect()).running, 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForTimeout(100);
  const visibility = await page.evaluate(async () => {
    const mover = document.querySelector('.apex-flame-orbit');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
    const clock = () => mover.getAnimations()[0].currentTime;
    const before = clock();
    // Repeated hidden notifications must not restart already-paused embers.
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 600));
    const after = clock();
    const running = document.querySelector('.board-card').getAnimations({ subtree: true }).filter(a => a.playState === 'running').length;
    delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 150));
    return { before, after, running, resumed: clock() };
  });
  assert.ok(Math.abs(visibility.after - visibility.before) < 25); assert.equal(visibility.running, 0);
  assert.ok(visibility.resumed > visibility.after + 50); results.push({ reduced, simulatedVisibility: visibility });

  // Same seed, real application at maximum speed, with and without decoration.
  const highSpeed = [];
  for (const preference of ['no-preference', 'reduce']) {
    await choose('free'); await choose('apex'); await page.emulateMedia({ reducedMotion: preference });
    await page.locator('#speed-control').fill('40'); await page.locator('#speed-control').dispatchEvent('input');
    const performanceResult = await page.evaluate(async () => {
      const deltas = [], completedSteps = []; let last;
      const panel = document.querySelector('.board-card'), flame = panel.querySelector('.apex-flame-orbit');
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
        frames: deltas.length, sameFlame: flame === panel.querySelector('.apex-flame-orbit'), phase: panel.dataset.modePhase,
        challengePhase: document.querySelector('#challenge-panel').dataset.phase };
    });
    console.log('High-speed observation', preference, performanceResult);
    assert.ok(performanceResult.totalSteps >= 120);
    assert.ok(performanceResult.sameFlame); assert.equal(performanceResult.phase, 'steady');
    highSpeed.push({ preference, ...performanceResult });
  }
  assert.ok(highSpeed.every(run => run.completedSteps.every(step => step === highSpeed[0].completedSteps[0])), 'same seed collapses at the same step with effects enabled/disabled');
  results.push({ highSpeed });

  // Force the capability branch to verify the fallback's real rendering and cleanup.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = (...args) => args[0] === 'offset-path' ? false : supports(...args);
  });
  await page.reload(); await choose('apex');
  const fallbackFirst = await inspect(); onBorder(fallbackFirst); assert.equal(fallbackFirst.travel, 'keyframes');
  await page.waitForTimeout(1400);
  const fallbackLater = await inspect(); onBorder(fallbackLater);
  assert.ok(fallbackLater.flames.every((f, i) => Math.hypot(f.x - fallbackFirst.flames[i].x, f.y - fallbackFirst.flames[i].y) > 20));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(100); onBorder(await inspect());
  await choose('free'); assert.equal((await inspect()).running, 0);
  await choose('apex'); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(100);
  assert.equal((await inspect()).running, 0); results.push({ fallbackFirst, fallbackLater });

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const lifecycle = await page.evaluate(async () => {
    const { createModeEffects } = await import('/predator-prey-simulation-2/src/modeEffects.ts');
    const panel = document.querySelector('.board-card').cloneNode(true);
    panel.querySelector('.apex-panel-heat').remove();
    for (const key of Object.keys(panel.dataset)) delete panel.dataset[key];
    document.body.append(panel);
    const nativeSet = window.setInterval, nativeClear = window.clearInterval, timers = new Set();
    window.setInterval = (...args) => { const id = nativeSet(...args); timers.add(id); return id; };
    window.clearInterval = id => { timers.delete(id); nativeClear(id); };
    let effects;
    try {
      effects = createModeEffects(panel, 'apex', matchMedia('(prefers-reduced-motion: reduce)'));
      const initial = { phase: panel.dataset.modePhase, timers: timers.size,
        finite: panel.getAnimations({ subtree: true }).filter(a => Number.isFinite(a.effect.getTiming().iterations)).length };
      effects.sync('free');
      await new Promise(resolve => setTimeout(resolve, 420));
      const idle = { timers: timers.size, animations: panel.querySelector('.apex-panel-heat').getAnimations({ subtree: true }).length };
      if (idle.animations) console.log('Lifecycle idle detail', panel.dataset.modePhase, panel.getAnimations({ subtree: true }).map(a => [a.animationName, a.playState, a.currentTime, a.effect.target.className.baseVal ?? a.effect.target.className]));
      effects.sync('apex');
      const activeTimers = timers.size;
      const layer = panel.querySelector('.apex-panel-heat'); panel.remove();
      await new Promise(resolve => setTimeout(resolve, 0));
      return { initial, idle, activeTimers, cleaned: !panel.querySelector('.apex-panel-heat'), timers: timers.size,
        animations: layer.getAnimations({ subtree: true }).length };
    } finally {
      effects?.destroy(); panel.remove(); window.setInterval = nativeSet; window.clearInterval = nativeClear;
    }
  });
  assert.deepEqual(lifecycle, { initial: { phase: 'steady', timers: 1, finite: 0 }, idle: { timers: 0, animations: 0 }, activeTimers: 1, cleaned: true, timers: 0, animations: 0 });
  results.push({ lifecycle });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ browser: browser.version(), results, errors }, null, 2));
  console.log(`PASS: ${results.length} groups; screenshots and temporal measurements: ${output}`);
} finally { await browser.close(); }
