// Real browser / synthetic data only. Start fixture Vite with the runbook's local environment.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const origin = process.env.TEST_ORIGIN ?? 'http://127.0.0.1:5174';
const base = `${origin}/predator-prey-simulation-2/tests/browser.html`;
const output = new URL('../verification.local/leaderboard-v2/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TEST_BROWSER ?? 'msedge', headless: true });
const context = await browser.newContext();
let externalRequests = 0;
await context.route('**/*', route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  externalRequests++; return route.abort();
});
const page = await context.newPage();
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const ready = async () => {
  await page.waitForSelector('#summary-list-protector-national li');
  await page.waitForFunction(() => !document.querySelector('#summary-status-protector-national').textContent);
};
const screenshot = async name => {
  await page.evaluate(() => Promise.all([...document.querySelectorAll('dialog[open]')]
    .flatMap(dialog => dialog.getAnimations()).map(animation => animation.finished.catch(() => {}))));
  return page.screenshot({ path: fileURLToPath(new URL(name + '.png', output)), fullPage: false });
};
const geometry = () => page.evaluate(() => {
  const sections = [...document.querySelectorAll('#leaderboard-board-protector .ranking-scope-grid > section')].map(e => {
    const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width };
  });
  const rows = [...document.querySelectorAll('#leaderboard-board-protector li')];
  const overlap = rows.some(row => {
    const cells = [...row.children].filter(e => !e.classList.contains('leaderboard-meta')).map(e => e.getBoundingClientRect());
    return cells.some((r, i) => i > 0 && r.left < cells[i - 1].right - .5);
  });
  return { sections, overlap, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    dialogOverflow: document.querySelector('#leaderboard-panel').scrollWidth > document.querySelector('#leaderboard-panel').clientWidth };
});
try {
  for (const [width, height] of [[1440,900], [1024,768], [390,844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(base); await ready();
    assert.equal(await page.locator('#summary-list-protector-national li').count(), 3);
    assert.equal(await page.locator('#summary-list-protector-hafs li').count(), 3);
    assert.equal(await page.locator('#leaderboard-school').inputValue(), '');
    await screenshot(`summary-${width}`);
    await page.locator('#open-leaderboard').click();
    assert.equal(await page.locator('#leaderboard-form').isVisible(), false);
    for (const scope of ['national','hafs']) assert.equal(await page.locator(`#ranking-list-protector-${scope}`).isVisible(), true);
    const bounds = await geometry();
    assert.equal(bounds.overlap, false); assert.equal(bounds.overflow, false); assert.equal(bounds.dialogOverflow, false);
    if (width > 760) assert.ok(Math.abs(bounds.sections[0].y - bounds.sections[1].y) < 1);
    else assert.ok(bounds.sections[1].y > bounds.sections[0].y + 100);
    await screenshot(`dialog-${width}`);
    await page.locator('#ranking-heading-protector-hafs').scrollIntoViewIfNeeded();
    const hafsBounds = await page.locator('#ranking-heading-protector-hafs').boundingBox();
    assert.ok(hafsBounds.y > 0 && hafsBounds.y < height);
    await page.locator('#close-leaderboard').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('.ranking-body').evaluate(e => e === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'close-leaderboard');
    const ids = await page.locator('[id]').evaluateAll(els => els.map(e => e.id));
    assert.equal(new Set(ids).size, ids.length);
    const brokenControls = await page.locator('[aria-controls]').evaluateAll(els => els.filter(e => !document.getElementById(e.getAttribute('aria-controls'))).length);
    assert.equal(brokenControls, 0);
    await page.locator('#leaderboard-tab-protector').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#leaderboard-tab-manipulator').getAttribute('aria-selected'), 'true');
    for (const scope of ['national','hafs']) assert.equal(await page.locator(`#ranking-list-manipulator-${scope}`).isVisible(), true);
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#leaderboard-tab-protector').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#leaderboard-dialog').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'open-leaderboard');
    const callsBefore = await page.evaluate(() => window.__fixture.gets);
    await page.locator('#summary-tab-manipulator').click();
    assert.equal(await page.locator('#summary-list-manipulator-national').isVisible(), true);
    assert.equal(await page.locator('#summary-list-manipulator-hafs').isVisible(), true);
    assert.equal(await page.evaluate(() => window.__fixture.gets), callsBefore);
    results.push({ viewport: [width,height], ...bounds });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}?records=ties`); await ready();
  await page.locator('#open-leaderboard').click();
  assert.equal(await page.locator('#ranking-list-protector-national li').count(), 83);
  assert.equal(await page.locator('#ranking-list-protector-hafs li').count(), 42);
  assert.equal(await page.locator('#summary-list-protector-national li').count(), 3);
  await screenshot('boundary-ties');
  await page.evaluate(() => { window.__fixture.failHafs = true; });
  await page.locator('#leaderboard-refresh').click();
  await page.waitForFunction(() => document.querySelector('#ranking-status-protector-hafs').textContent.includes('이전 결과'));
  assert.equal(await page.locator('#ranking-list-protector-national li').count(), 83);
  assert.equal(await page.locator('#ranking-list-protector-hafs li').count(), 42);
  await screenshot('stale-hafs-error');

  for (const mode of ['0', 'partial', 'error', 'loading']) {
    await page.goto(`${base}?records=${mode}`);
    await page.waitForSelector('#open-leaderboard'); await page.locator('#open-leaderboard').click();
    if (mode === '0') {
      await page.waitForSelector('#ranking-list-protector-national .leaderboard-empty');
      assert.equal(await page.locator('#ranking-list-protector-hafs .leaderboard-empty').count(), 1);
    } else if (mode === 'partial') {
      await page.waitForSelector('#ranking-list-protector-national li');
      await page.waitForFunction(() => document.querySelector('#ranking-status-protector-hafs').textContent.includes('불러오지'));
      assert.equal(await page.locator('#ranking-list-protector-hafs .leaderboard-empty').count(), 0);
    } else {
      assert.equal(await page.locator('.leaderboard-empty').count(), 0);
      assert.ok(await page.locator('#ranking-status-protector-national').textContent());
    }
    await screenshot(`state-${mode}`);
  }

  await page.goto(`${base}?storage=broken`); await ready();
  assert.equal(await page.locator('#leaderboard-school').inputValue(), '');
  assert.equal(await page.locator('#leaderboard-student-number').inputValue(), '');
  await page.goto(`${base}?storage=legacy&submit=success`); await ready();
  assert.equal(await page.locator('#leaderboard-school').inputValue(), '');
  assert.equal(await page.locator('#leaderboard-student-number').inputValue(), '00314');
  assert.equal(await page.locator('#leaderboard-name').inputValue(), '합성학생');
  const publicHtml = await page.locator('.leaderboard-summary').innerHTML();
  assert.ok(!publicHtml.includes('00314') && !publicHtml.includes('합성학생'));
  // Complete a real ten-step challenge through the unchanged parameter dialog and controls.
  await page.locator('[data-app-mode=apex]').click();
  await page.locator('#toggle-parameters').click();
  await page.locator('[data-parameter-section=quaternary]').click();
  await page.locator('#param-quaternaryMaxAge').fill('10');
  await page.locator('#apply-parameters').click();
  await page.locator('#speed-control').fill('40');
  await page.locator('[data-challenge-action=start]').click();
  await page.waitForSelector('#challenge-panel[data-phase=over]');
  const beforePB = await page.evaluate(() => [...window.__fixture.storage].filter(([key]) => !key.endsWith(':participant')));
  assert.ok(beforePB.length > 0);
  await page.locator('#open-leaderboard').click();
  assert.equal(await page.locator('#leaderboard-form').isVisible(), true);
  await page.locator('#leaderboard-school').fill('가'.repeat(81));
  assert.equal(await page.locator('#leaderboard-school').evaluate(e => e.checkValidity()), false);
  await page.locator('#leaderboard-school').fill('😀'.repeat(80));
  assert.equal(await page.locator('#leaderboard-school').evaluate(e => e.checkValidity()), true);
  await page.locator('#leaderboard-school').fill('합성고등학교');
  for (const [width,height] of [[1440,900], [1024,768], [390,844]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#leaderboard-submit').scrollIntoViewIfNeeded();
    assert.equal((await geometry()).dialogOverflow, false);
    await screenshot(`form-${width}`);
  }
  await page.locator('#leaderboard-submit').click();
  assert.equal(await page.locator('#leaderboard-submit').isDisabled(), true);
  // A duplicate submit event while the first POST is pending must be ignored.
  await page.locator('#leaderboard-form').dispatchEvent('submit');
  await page.waitForFunction(() => document.querySelector('#leaderboard-status').textContent === '기록을 제출했습니다.');
  assert.equal(await page.evaluate(() => window.__fixture.posts), 1);
  assert.equal(await page.evaluate(() => window.__fixture.submitted.school_name), '합성고등학교');
  assert.equal(await page.evaluate(() => window.__fixture.submitted.student_number), '00314');
  assert.equal(await page.evaluate(() => 'school_key' in window.__fixture.submitted), false);
  assert.deepEqual(await page.evaluate(() => [...window.__fixture.storage].filter(([key]) => !key.endsWith(':participant'))), beforePB);
  const saved = await page.evaluate(() => JSON.parse(window.__fixture.storage.get('rabbits-wolves:apex-survival:participant')));
  assert.equal(saved.schoolName, '합성고등학교');
  const html = await page.locator('#leaderboard-panel').innerHTML();
  assert.ok(!html.includes('00314') && !html.includes('합성학생'));
  assert.equal(await page.locator('#leaderboard-form').isVisible(), false);
  assert.equal(externalRequests, 0);
  assert.deepEqual(errors, []);
  await writeFile(new URL('results.json', output), JSON.stringify({ results, scenarios: ['ties > 50', 'scope errors', 'empty', 'loading', 'storage', 'form', 'keyboard', 'PB', 'submit guard'], externalRequests, errors }, null, 2));
  console.log('Browser QA passed: 1440×900, 1024×768, 390×844; scopes, ties, errors, form, keyboard, PB; zero external requests.');
} finally { await browser.close(); }
