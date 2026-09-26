// Development-only statistics. A censored run contributes its observed duration,
// never an invented extinction event. No product module imports this file.
export interface SurvivalObservation { duration: number; censored: boolean }

export function quantile(values: number[], probability: number): number | null {
  if (probability < 0 || probability > 1 || !Number.isFinite(probability)) throw new RangeError('Invalid quantile');
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  return sorted[Math.floor(position)] + (sorted[Math.ceil(position)] - sorted[Math.floor(position)]) * (position % 1);
}

export const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export const distribution = (values: number[]) => ({
  min: quantile(values, 0), p10: quantile(values, .1), q25: quantile(values, .25),
  median: quantile(values, .5), q75: quantile(values, .75), max: quantile(values, 1),
});
export const proportion = (count: number, total: number) => ({ count, total, proportion: total ? count / total : null });

export function survivalObservation(introducedAt: number, extinctAt: number | null, horizon: number): SurvivalObservation {
  if (!Number.isInteger(horizon) || horizon < 1 || !Number.isInteger(introducedAt) || introducedAt < 0) throw new RangeError('Invalid time');
  if (extinctAt !== null && (!Number.isInteger(extinctAt) || extinctAt <= introducedAt)) throw new RangeError('Extinction must follow introduction');
  const censored = extinctAt === null || extinctAt > introducedAt + horizon;
  return { duration: censored ? horizon : extinctAt! - introducedAt, censored };
}

export function summarizeSurvival(rows: SurvivalObservation[], horizon: number, thresholds = [50, 100, 150, 200, 300, 500]) {
  if (rows.some(r => r.duration < 1 || r.duration > horizon || (r.censored && r.duration !== horizon))) throw new RangeError('Inconsistent censoring');
  if (thresholds.some(t => t > horizon || t < 1)) throw new RangeError('Threshold beyond observation');
  const restricted = distribution(rows.map(r => r.duration));
  return {
    restrictedDuration: restricted,
    // Interpolation involving censored observations is also a lower bound,
    // including when the interpolated value itself is below the horizon.
    quantileLowerBounds: Object.fromEntries(Object.entries({ min: 0, p10: .1, q25: .25, median: .5, q75: .75, max: 1 }).map(([key, q]) => {
      const sorted = [...rows].sort((a, b) => a.duration - b.duration || Number(a.censored) - Number(b.censored));
      const position = (sorted.length - 1) * q;
      return [key, sorted.length > 0 && (sorted[Math.floor(position)].censored || sorted[Math.ceil(position)].censored)];
    })),
    surviveAtLeast: Object.fromEntries(thresholds.map(t => [t, proportion(rows.filter(r => r.duration >= t).length, rows.length)])),
    extinctBefore50: proportion(rows.filter(r => !r.censored && r.duration < 50).length, rows.length),
    aliveAtHorizon: proportion(rows.filter(r => r.censored).length, rows.length),
    extinctExactlyAtHorizon: proportion(rows.filter(r => !r.censored && r.duration === horizon).length, rows.length),
  };
}

export function earlyVegetationCollapse(values: number[], threshold = 5, consecutive = 10, window = 200): boolean {
  let streak = 0;
  for (const value of values.slice(0, window)) {
    streak = value < threshold ? streak + 1 : 0;
    if (streak >= consecutive) return true;
  }
  return false;
}
