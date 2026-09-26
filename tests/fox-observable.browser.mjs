import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PARAMETERS, ForestSimulation } from '../src/model.ts';

const origin = process.env.TEST_ORIGIN ?? 'http://127.0.0.1:5177';
const output = fileURLToPath(new URL('../verification.local/fox-observable/', import.meta.url));
await mkdir(output, { recursive: true });
// Consume the deterministic representative rule's output, not a hand-picked seed.
const report = JSON.parse(await readFile(new URL('../docs/fox-observable-summary.json', import.meta.url), 'utf8'));
const representative = report.representatives.find(r => r.label === 'median');
assert.ok(representative);
const seed = representative.seed;
const oracle = new ForestSimulation({ ...DEFAULT_PARAMETERS, seed });
oracle.introduceSpecies('fox', 4);
const expected = new Map();
for (let step = 1; step <= representative.survival.duration; step++) {
  oracle.step();
  if ([25, 50, 100, representative.survival.duration].includes(step)) expected.set(step,
    { snapshot: structuredClone(oracle.getSnapshot()), diet: oracle.getFoxDiet(), rng: structuredClone(oracle.random) });
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
let externalWrites = 0;
await context.route('**/*', route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  if (route.request().method() !== 'GET') externalWrites++;
  return route.abort();
});
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const read = () => page.evaluate(() => window.__runtime.read());
const food = () => page.evaluate(() => window.__runtime.food());
try {
  await page.clock.install({ time: new Date('2026-09-26T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-26T00:00:01Z'));
  await page.goto(`${origin}/predator-prey-simulation-2/tests/interventions.browser.html`);
  await page.locator('#toggle-parameters').click();
  await page.locator('[data-parameter-section=start]').click();
  await page.locator('#seed-input').fill(seed);
  await page.locator('#apply-parameters').click();
  const initial = await read();
  for (const speed of [8, 20, 40]) {
    await page.locator('#reset-button').click(); assert.deepEqual(await read(), initial);
    await page.locator('#speed-control').fill(String(speed));
    assert.equal(await page.locator('#speed-output').textContent(), `${speed} step/s`);
    await page.locator('[data-introduce=fox]').click();
    assert.equal(await page.locator('#introduction-amount').inputValue(), '4');
    await page.locator('#confirm-intervention').click();
    await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
    assert.match(await page.locator('#population-chart').getAttribute('title'), /붉은여우 \+4/);
    const started = await page.evaluate(() => performance.now());
    await page.locator('#run-button').click();
    const samples = [];
    for (const target of expected.keys()) {
      let state = await read();
      // Virtual animation frames exercise the real UI scheduler. Each final
      // increment is under the fastest logical interval, preventing overshoot.
      while (state.snapshot.step < target) {
        const remaining = target - state.snapshot.step;
        await page.clock.runFor(remaining > 1 ? Math.max(16, Math.floor((remaining - 1) * 1000 / speed)) : 16);
        state = await read();
      }
      assert.equal(state.snapshot.step, target);
      const observed = await food(), wanted = expected.get(target);
      assert.deepEqual(state.snapshot, wanted.snapshot, `speed ${speed}, step ${target}: exact snapshot`);
      assert.deepEqual(observed.diet, wanted.diet);
      assert.deepEqual(observed.rng, wanted.rng);
      const milliseconds = await page.evaluate(() => performance.now()) - started;
      assert.ok(Math.abs(milliseconds - target * 1000 / speed) < 50, `timing: ${milliseconds}`);
      const metric = state.history.at(-1);
      samples.push({ step: target, milliseconds, rabbits: metric.rabbits, wolves: metric.wolves,
        fox: metric.fox, forestPercent: metric.forestPercent, diet: observed.diet });
      if (target === 50 && speed === 8) await page.screenshot({ path: `${output}median-step50-edge.png`, fullPage: true });
    }
    await page.locator('#pause-button').click();
    assert.equal((await read()).snapshot.agents.fox.length, 0);
    assert.ok(samples.some(s => s.fox > 0 && s.diet.rabbitEnergy > 0 && s.diet.plantEnergy > 0));
    results.push({ speed, seed, samples, exactStateDietAndRng: true });
  }
  // A separate ordinary running flow introduces after 5 steps, rather than
  // changing the calibrated introduction timing of the representative above.
  await page.locator('#reset-button').click();
  await page.locator('#speed-control').fill('8');
  await page.locator('#run-button').click(); await page.clock.runFor(640);
  await page.locator('[data-introduce=fox]').click();
  const paused = await read(); assert.equal(paused.snapshot.step, 5);
  await page.locator('#confirm-intervention').click();
  await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
  await page.locator('#run-button').click(); await page.clock.runFor(1250);
  await page.locator('#pause-button').click(); assert.ok((await read()).snapshot.agents.fox.length > 0);
  await page.locator('#open-removal').click(); await page.locator('#intervention-species').selectOption('fox');
  await page.locator('[data-removal-fraction="0.5"]').click(); await page.locator('#confirm-intervention').click();
  await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
  const removed = await read(); assert.ok(removed.snapshot.agents.fox.length > 0);
  assert.ok(removed.snapshot.interventions.some(e => e.kind === 'remove' && e.species === 'fox'));
  await page.locator('[data-introduce=fox]').click(); await page.locator('#confirm-intervention').click();
  await page.locator('#intervention-dialog').waitFor({ state: 'hidden' });
  assert.equal((await read()).snapshot.agents.fox.length, removed.snapshot.agents.fox.length + 4);
  await page.locator('#reset-button').click(); assert.deepEqual(await read(), initial);
  assert.deepEqual(errors, []); assert.equal(externalWrites, 0);
  await writeFile(`${output}edge-speed-results.json`, JSON.stringify({ browser: await browser.version(), results,
    runningIntroductionPartialRemovalReintroductionReset: true, virtualClock: true, errors, externalWrites }, null, 2));
  console.log(JSON.stringify({ browser: await browser.version(), seed, timing: results.map(r => ({ speed: r.speed,
    lastStep: r.samples.at(-1).step, milliseconds: r.samples.at(-1).milliseconds })), errors, externalWrites }));
} catch (error) {
  await page.screenshot({ path: `${output}edge-speed-failure.png`, fullPage: true }); throw error;
} finally { await browser.close(); }
