import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstPeakLag } from '../src/analysis.ts';
import { DEFAULT_PARAMETERS, derivatives, equilibrium, rk4Step, simulate } from '../src/model.ts';

describe('Lotka-Volterra calculation engine', () => {
  it('calculates the standard model derivatives', () => {
    const [preyChange, predatorChange] = derivatives(10, 5, DEFAULT_PARAMETERS, 'basic');
    assert.ok(Math.abs(preyChange - 6) < 1e-10);
    assert.ok(Math.abs(predatorChange + 2) < 1e-10);
  });

  it('keeps the coexistence equilibrium fixed with RK4', () => {
    const eq = equilibrium(DEFAULT_PARAMETERS, 'basic');
    const next = rk4Step({ time: 0, ...eq }, DEFAULT_PARAMETERS, 0.01, 'basic');
    assert.ok(Math.abs(next.prey - eq.prey) < 1e-10);
    assert.ok(Math.abs(next.predator - eq.predator) < 1e-10);
  });

  it('returns finite, non-negative values through 20 years', () => {
    const trajectory = simulate(DEFAULT_PARAMETERS, 20, 0.01, 'basic');
    assert.equal(trajectory.length, 2001);
    assert.ok(Math.abs((trajectory.at(-1)?.time ?? 0) - 20) < 1e-10);
    for (const point of trajectory) {
      assert.ok(Number.isFinite(point.prey));
      assert.ok(Number.isFinite(point.predator));
      assert.ok(point.prey >= 0);
      assert.ok(point.predator >= 0);
    }
  });

  it('shows the predator peak after the prey peak under default conditions', () => {
    const lag = firstPeakLag(simulate(DEFAULT_PARAMETERS));
    assert.ok(lag);
    assert.ok(lag.lag > 0);
  });

  it('limits prey growth in the logistic extension', () => {
    const trajectory = simulate({
      ...DEFAULT_PARAMETERS,
      predatorInitial: 2,
      carryingCapacity: 100,
    }, 20, 0.01, 'logistic');
    assert.ok(Math.max(...trajectory.map((point) => point.prey)) <= 101);
  });

  it('keeps all slider-edge scenarios finite and non-negative', () => {
    const edgeCases = [
      {
        alpha: 1.5,
        beta: 0.005,
        delta: 0.002,
        gamma: 0.1,
        preyInitial: 200,
        predatorInitial: 2,
        carryingCapacity: 500,
      },
      {
        alpha: 0.1,
        beta: 0.08,
        delta: 0.04,
        gamma: 1.2,
        preyInitial: 5,
        predatorInitial: 100,
        carryingCapacity: 50,
      },
    ];
    for (const parameters of edgeCases) {
      for (const model of ['basic', 'logistic'] as const) {
        for (const point of simulate(parameters, 20, 0.01, model)) {
          assert.ok(Number.isFinite(point.prey) && point.prey >= 0);
          assert.ok(Number.isFinite(point.predator) && point.predator >= 0);
        }
      }
    }
  });
});
