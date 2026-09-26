import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as model from '../src/model.ts';
import { quantile, survivalObservation, summarizeSurvival, earlyVegetationCollapse } from '../scripts/fox-observable-metrics.ts';
import { protocol, runObservable } from '../scripts/calibrate-fox-observable.ts';

test('survival duration uses elapsed steps after introduction, including late introductions', () => {
  assert.deepEqual(survivalObservation(500, 680, 600), { duration: 180, censored: false });
  assert.deepEqual(survivalObservation(500, null, 600), { duration: 600, censored: true });
  assert.deepEqual(survivalObservation(500, 1101, 600), { duration: 600, censored: true });
  assert.throws(() => survivalObservation(500, 500, 600));
});

test('extinction at the horizon is an event; survival past it is right-censored', () => {
  const rows = [survivalObservation(500, 1100, 600), survivalObservation(500, null, 600)];
  const result = summarizeSurvival(rows, 600, [600]);
  assert.equal(result.surviveAtLeast[600].count, 2);
  assert.equal(result.aliveAtHorizon.count, 1);
  assert.equal(result.extinctExactlyAtHorizon.count, 1);
  assert.equal(result.quantileLowerBounds.median, true);
});

test('thresholds use >= while the early-extinction flag uses strictly before 50', () => {
  const rows = [49, 50, 99, 100, 150].map(duration => ({ duration, censored: false }));
  const result = summarizeSurvival(rows, 600);
  assert.equal(result.extinctBefore50.count, 1);
  assert.equal(result.surviveAtLeast[50].count, 4);
  assert.equal(result.surviveAtLeast[100].count, 2);
  assert.equal(result.surviveAtLeast[150].count, 1);
});

test('type-7 quantiles use all observations and do not mutate their order', () => {
  const values = [200, 50, 150, 100];
  assert.equal(quantile(values, .1), 65);
  assert.equal(quantile(values, .25), 87.5);
  assert.equal(quantile(values, .5), 125);
  assert.equal(quantile(values, .75), 162.5);
  assert.deepEqual(values, [200, 50, 150, 100]);
  assert.equal(quantile([], .5), null);
  assert.equal(quantile([7], .5), 7);
  assert.throws(() => quantile(values, 2));
});

test('interpolation involving a censored value is explicitly a lower bound', () => {
  const result = summarizeSurvival([{ duration: 100, censored: false }, { duration: 600, censored: true }], 600);
  assert.equal(result.restrictedDuration.median, 350);
  assert.equal(result.quantileLowerBounds.median, true);
  assert.equal(result.quantileLowerBounds.min, false);
  assert.throws(() => summarizeSurvival([{ duration: 100, censored: true }], 600));
  assert.throws(() => summarizeSurvival([], 600, [601]));
});

test('vegetation collapse requires ten consecutive samples strictly below 5% within 200', () => {
  assert.equal(earlyVegetationCollapse(Array(10).fill(4.99)), true);
  assert.equal(earlyVegetationCollapse(Array(10).fill(5)), false);
  assert.equal(earlyVegetationCollapse([...Array(9).fill(0), 5, ...Array(9).fill(0)]), false);
  assert.equal(earlyVegetationCollapse([...Array(191).fill(10), ...Array(10).fill(0)]), false);
  assert.equal(earlyVegetationCollapse([...Array(190).fill(10), ...Array(10).fill(0)]), true);
});

test('fixed seed domain is disjoint from previous calibration and holdout; matrix is 3 by 3', () => {
  assert.deepEqual(protocol.seeds, Array.from({ length: 100 }, (_, i) => `FOX-OBS-${String(i + 1).padStart(3, '0')}`));
  assert.equal(protocol.candidates.length, 9);
  assert.deepEqual([...new Set(protocol.candidates.map((c: any) => c.preference))], [.67, .75, .8]);
  assert.deepEqual([...new Set(protocol.candidates.map((c: any) => c.introductionAmount))], [4, 6, 8]);
  for (const seed of protocol.seeds) assert.equal(model.validateParameters({ ...model.DEFAULT_PARAMETERS, seed }).seed, seed);
});

test('introduction amount is parameterized without changing fox life history or product default', () => {
  const config = JSON.stringify(model.FOX_CONFIG);
  for (const amount of [4, 6, 8]) {
    const run = runObservable(model, 'FOX-OBS-UNIT', 'plant-only', { id: 'test', preference: .67, introductionAmount: amount }, { horizon: 200 });
    assert.equal(run.trajectory[0].fox, amount);
    assert.equal(run.foxPeak, amount);
    assert.equal(run.events.foxBirths, 0);
    assert.equal(run.final.fox, 0);
    assert.equal(run.pre50Available, false);
    assert.equal(run.deltas[100].versusPre50Mean, null);
  }
  assert.equal(JSON.stringify(model.FOX_CONFIG), config);
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(source, /species === 'fox' \? '4' : '1'/);
});

test('late-introduction harness stores absolute extinction separately and captures an actual pre-window', () => {
  const run = runObservable(model, 'FOX-OBS-UNIT', 'plant-only', protocol.candidates[0], { introductionStep: 500, horizon: 200 });
  assert.ok(run.foxExtinctAt! > 500);
  assert.equal(run.survival.duration, run.foxExtinctAt! - 500);
  assert.equal(run.final.step, 700);
  assert.equal(run.final.elapsed, 200);
  assert.equal(run.pre50Available, true);
  assert.ok(run.deltas[100].versusPre50Mean);
});

test('observation preserves complete state/RNG and event accounting across weighted candidates', () => {
  // Unit tests also work in shallow checkouts. The explicit calibration audit
  // separately validates both historical strategies using their Git commits.
  for (const candidate of [protocol.candidates[0], protocol.candidates[8]]) {
    const observed = runObservable(model, 'FOX-OBS-UNIT', 'full-web', candidate, { horizon: 200 });
    const plain = runObservable(model, 'FOX-OBS-UNIT', 'full-web', candidate, { horizon: 200, observe: false });
    assert.equal(observed.stateHash, plain.stateHash);
    assert.equal(observed.rng, plain.rng);
    assert.deepEqual(observed.trajectory, plain.trajectory);
    assert.ok(observed.events.rabbitKills > 0);
    assert.ok(observed.events.rabbitHuntAttempts >= observed.events.rabbitKills);
    assert.ok(observed.events.plantFeedingEvents > 0);
    assert.equal(observed.events.rabbitEnergy, observed.events.rabbitKills * 8);
    assert.equal(observed.events.plantEnergy, observed.events.plantFeedingEvents * .5);
    assert.deepEqual(observed.windows[200], observed.events);
    assert.ok(observed.windows[50].rabbitKills <= observed.windows[100].rabbitKills);
    assert.ok(observed.windows[100].rabbitKills <= observed.windows[200].rabbitKills);
  }
});
