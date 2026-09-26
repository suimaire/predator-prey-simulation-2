import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const origin=process.env.TEST_ORIGIN??'http://127.0.0.1:5177';
const output=fileURLToPath(new URL('../verification.local/fox/',import.meta.url)); await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
let externalWrites=0;
await context.route('**/*',route=>{ if(new URL(route.request().url()).origin===origin)return route.continue(); if(route.request().method()!=='GET')externalWrites++; return route.abort(); });
const page=await context.newPage(), errors=[],results=[];
page.on('pageerror',error=>errors.push(error.message));
const read=()=>page.evaluate(()=>window.__runtime.read());
const food=()=>page.evaluate(()=>window.__runtime.food());
const tick=ms=>page.clock.runFor(ms);
const shot=name=>page.screenshot({path:`${output}${name}.png`,fullPage:true});
async function introduce(species,count) {
  if(species==='fox')await page.locator('[data-introduce=fox]').click();
  else {await page.locator('#open-introduction').click(); await page.locator('#intervention-species').selectOption(species);}
  if(count!==undefined)await page.locator('#introduction-amount').fill(String(count));
  await page.locator('#confirm-intervention').click(); await page.locator('#intervention-dialog').waitFor({state:'hidden'});
}
async function remove(species,fraction) {
  await page.locator('#open-removal').click(); await page.locator('#intervention-species').selectOption(species);
  await page.locator(`[data-removal-fraction="${fraction}"]`).click();
  await page.locator('#confirm-intervention').click(); await page.locator('#intervention-dialog').waitFor({state:'hidden'});
}
async function runSteps(n) {await page.locator('#run-button').click();await tick(n*25+5);await page.locator('#pause-button').click();}
const geometry=()=>page.evaluate(()=>{
  const selectors=['#intervention-card','.hud-readings','.pyramid-card','#graph-legend'];
  const overflow=selectors.filter(selector=>{const e=document.querySelector(selector);return e.scrollWidth>e.clientWidth+1;});
  const buttons=[...document.querySelectorAll('#intervention-card button')].map(e=>e.getBoundingClientRect());
  return {pageOverflow:document.documentElement.scrollWidth>innerWidth,overflow,
    buttonOverlap:buttons.some((a,i)=>buttons.slice(i+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top))};
});
try {
  await page.clock.install({time:new Date('2026-09-26T00:00:00Z')});await page.clock.pauseAt(new Date('2026-09-26T00:00:01Z'));
  await page.goto(`${origin}/predator-prey-simulation-2/tests/interventions.browser.html`);
  await page.locator('#toggle-parameters').click();await page.locator('[data-parameter-section=start]').click();
  await page.locator('#seed-input').fill('FOX-CAL-001');await page.locator('#apply-parameters').click();
  await page.locator('#speed-control').fill('40'); const initial=await read();
  assert.equal(await page.locator('.pyramid-toolbar h2').textContent(),'실시간 생태 피라미드');
  assert.equal(await page.locator('[data-series=fox]').count(),0);
  // Required running introduction after hundreds of real logical steps.
  await page.locator('#run-button').click();await tick(12500);await page.locator('[data-introduce=fox]').focus();await page.keyboard.press('Enter');
  const paused=await read();assert.ok(paused.snapshot.step>=490);await tick(500);assert.deepEqual(await read(),paused);
  assert.equal(await page.locator('#introduction-amount').inputValue(),'4');
  await page.locator('#confirm-intervention').click();await page.locator('#intervention-dialog').waitFor({state:'hidden'});
  const introduced=await read();assert.equal(introduced.snapshot.step,paused.snapshot.step);assert.equal(introduced.snapshot.agents.fox.length,4);
  assert.deepEqual(introduced.snapshot.rabbits,paused.snapshot.rabbits);assert.deepEqual(introduced.snapshot.wolves,paused.snapshot.wolves);
  assert.deepEqual(introduced.history.slice(0,paused.history.length),paused.history);await tick(200);assert.deepEqual(await read(),introduced);
  assert.equal(await page.locator('.pyramid-toolbar h2').textContent(),'실시간 영양 구조');
  assert.equal(await page.locator('[data-series=fox]').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('#population-chart').getAttribute('title'),/붉은여우 \+4/);
  results.push({scenario:'running Step 500 introduction preserves state, pause and history; food web and graph appear',passed:true});
  await page.locator('#reset-button').click();assert.deepEqual(await read(),initial);
  // Observe an unmodified trajectory: UI diet is rolling transferred energy,
  // not the source-choice constant. Record trends without forcing their sign.
  await introduce('fox');
  const dietSamples=[];
  for(let i=0;i<15;i++) {
    await runSteps(10);
    const state=await read(), {diet}=await food();
    dietSamples.push({step:state.snapshot.step,rabbits:state.snapshot.rabbits.length,
      wolves:state.snapshot.wolves.length,fox:state.snapshot.agents.fox.length,...diet});
    assert.doesNotMatch(await page.locator('.fox-diet').textContent(),/NaN|undefined/);
  }
  assert.ok(dietSamples.some(s=>s.rabbits>0&&s.fox>0&&s.plantEnergy>0));
  assert.ok(dietSamples.some(s=>s.rabbits>=50&&s.rabbitPercent>50));
  results.push({scenario:'unforced diet observations with rabbit/fox present and rabbit-dominant energy',passed:true,dietSamples});
  await page.locator('#reset-button').click();assert.deepEqual(await read(),initial);
  // Use a living ecosystem to exercise all requested competition interventions.
  await introduce('fox');await runSteps(20);
  await remove('rabbit',.5);await runSteps(3);await remove('wolf',.5);await runSteps(3);
  assert.ok((await read()).snapshot.agents.fox.length>0);
  await remove('wolf',1); assert.equal((await read()).snapshot.wolves.length,0);await runSteps(3);
  await remove('fox',.5);await remove('fox',1);
  assert.equal(await page.locator('[data-fox-count]').textContent(),'0마리');assert.equal(await page.locator('.pyramid-toolbar h2').textContent(),'실시간 영양 구조');
  await introduce('fox',4);await introduce('wolf',4);await runSteps(3);
  const events=(await read()).snapshot.interventions;assert.ok(events.some(e=>e.species==='rabbit'&&e.kind==='remove'));
  const diet=(await food()).diet; assert.ok(diet.rabbitEnergy+diet.plantEnergy>0);
  await page.locator('[data-pyramid-mode=energy]').click();
  assert.match(await page.locator('.fox-energy').textContent(),/토끼 → 붉은여우/);assert.match(await page.locator('.fox-energy').textContent(),/식물성 먹이 → 붉은여우/);
  await page.locator('[data-series=fox]').click();assert.equal(await page.locator('[data-series=fox]').getAttribute('aria-pressed'),'false');await page.locator('[data-series=fox]').click();
  results.push({scenario:'rabbit/wolf 50%, wolf full, fox partial/full/reintroduce, wolf reintroduce, actual diet and energy flows',passed:true,diet});
  // Keyboard cancellation restores the running state and focus; confirmation stays paused.
  for(const running of [false,true]) {
    if(running)await page.locator('#run-button').click();
    await page.locator('[data-introduce=fox]').focus();await page.keyboard.press('Space');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'intervention-species');
    await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'confirm-intervention');
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'intervention-species');
    await page.keyboard.press('Escape');await page.locator('#intervention-dialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.introduce),'fox');
    assert.equal(await page.locator('#pause-button').isDisabled(),!running);
    if(running)await page.locator('#pause-button').click();
  }
  await introduce('tertiary',3);await introduce('quaternary',1);
  assert.match(await page.locator('.food-web-edges').textContent(),/늑대 → 3차 소비자/);
  assert.match(await page.locator('.food-web-edges').textContent(),/3차 소비자 → 4차 소비자/);
  for(const [width,height] of [[1440,900],[1024,768],[390,844],[320,740]]) {
    await page.setViewportSize({width,height});await tick(100);
    for (const mode of ['numbers','energy']) {
      await page.locator(`[data-pyramid-mode=${mode}]`).click();
      assert.deepEqual(await geometry(),{pageOverflow:false,overflow:[],buttonOverlap:false});
      await shot(`${mode}-${width}`);
    }
    for(const kind of ['introduce','remove']) {
      if(kind==='introduce') await page.locator('[data-introduce=fox]').click();
      else {await page.locator('#open-removal').click();await page.locator('#intervention-species').selectOption('fox');}
      const bounds=await page.locator('#intervention-dialog').evaluate(e=>{
        const buttons=[...e.querySelectorAll('button,input,select')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.getBoundingClientRect());
        return {overflow:e.scrollWidth>e.clientWidth,overlap:buttons.some((a,i)=>buttons.slice(i+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top))};
      });assert.deepEqual(bounds,{overflow:false,overlap:false});await shot(`${kind}-${width}`);
      await page.keyboard.press('Escape');await page.locator('#intervention-dialog').waitFor({state:'hidden'});
    }
    results.push({viewport:[width,height],passed:true});
  }
  // Keep the experiment's history through the extinction window, then reset below.
  await remove('fox',1);assert.equal(await page.locator('[data-fox-count]').textContent(),'0마리');
  await runSteps(55);assert.match(await page.locator('.fox-diet').textContent(),/최근 섭식 없음/);
  await page.locator('#reset-button').click();assert.deepEqual(await read(),initial);assert.equal(await page.locator('.fox-card').count(),0);
  assert.equal(await page.locator('.pyramid-toolbar h2').textContent(),'실시간 생태 피라미드');
  await page.locator('[data-app-mode=apex]').click();
  assert.equal(await page.locator('[data-introduce=fox]').isVisible(),false);assert.equal(await page.locator('#intervention-species option[value=fox]').count(),0);
  assert.equal(await page.locator('.fox-card').count(),0);assert.equal(await page.locator('[data-series=fox]').count(),0);
  const apex=await read();await page.locator('[data-introduce=fox]').dispatchEvent('click');assert.deepEqual(await read(),apex);
  await page.locator('[data-challenge-action=start]').click();await tick(4000);
  assert.equal((await read()).snapshot.step,44);assert.equal(await page.locator('.challenge-score > strong').textContent(),'43');
  assert.equal((await read()).snapshot.agents.fox,undefined);await shot('apex-isolated');
  results.push({scenario:'extinction, 50-step empty diet, reset pyramid; Apex no fox, unchanged collapse44/score43',passed:true});
  assert.deepEqual(errors,[]);assert.equal(externalWrites,0);
  await writeFile(`${output}results.json`,JSON.stringify({browser:await browser.version(),results,errors,externalWrites},null,2));
  console.log(JSON.stringify({results,errors,externalWrites},null,2));
} catch(error) { await shot('failure');throw error; } finally {await browser.close();}
