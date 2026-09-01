import type { ModelKind, ModelParameters, PopulationState } from './model.ts';
import { derivatives, equilibrium } from './model.ts';

export interface Peak {
  time: number;
  value: number;
  index: number;
}

export interface PeakLag {
  preyPeak: Peak;
  predatorPeak: Peak;
  lag: number;
}

export function findPeaks(
  trajectory: PopulationState[],
  field: 'prey' | 'predator',
  minimumSeparation = 0.6,
): Peak[] {
  const peaks: Peak[] = [];
  let lastPeakTime = -Infinity;
  for (let index = 1; index < trajectory.length - 1; index += 1) {
    const previous = trajectory[index - 1][field];
    const current = trajectory[index][field];
    const next = trajectory[index + 1][field];
    if (current > previous && current >= next && trajectory[index].time - lastPeakTime >= minimumSeparation) {
      peaks.push({ time: trajectory[index].time, value: current, index });
      lastPeakTime = trajectory[index].time;
    }
  }
  return peaks;
}

export function firstPeakLag(trajectory: PopulationState[]): PeakLag | null {
  const preyPeaks = findPeaks(trajectory, 'prey').filter((peak) => peak.time > 0.2);
  const predatorPeaks = findPeaks(trajectory, 'predator').filter((peak) => peak.time > 0.2);
  for (const preyPeak of preyPeaks) {
    const predatorPeak = predatorPeaks.find((peak) => peak.time > preyPeak.time);
    if (predatorPeak) {
      return { preyPeak, predatorPeak, lag: predatorPeak.time - preyPeak.time };
    }
  }
  return null;
}

export function describeState(
  state: PopulationState,
  parameters: ModelParameters,
  model: ModelKind,
): {
  preyTrend: '증가' | '감소' | '거의 일정';
  predatorTrend: '증가' | '감소' | '거의 일정';
  activeStage: number;
  explanation: string;
} {
  const [preyChange, predatorChange] = derivatives(state.prey, state.predator, parameters, model);
  const preyThreshold = Math.max(0.02, state.prey * 0.01);
  const predatorThreshold = Math.max(0.02, state.predator * 0.01);
  const classify = (change: number, threshold: number): '증가' | '감소' | '거의 일정' => {
    if (change > threshold) return '증가';
    if (change < -threshold) return '감소';
    return '거의 일정';
  };
  const preyTrend = classify(preyChange, preyThreshold);
  const predatorTrend = classify(predatorChange, predatorThreshold);

  let activeStage = 0;
  let explanation = '피식자의 자연 증가 효과가 포식으로 인한 감소보다 큽니다.';
  if (predatorTrend === '증가' && preyTrend !== '감소') {
    activeStage = 1;
    explanation = '이용할 피식자가 충분하여 포식자 개체군이 뒤따라 증가합니다.';
  } else if (preyTrend === '감소') {
    activeStage = 2;
    explanation = '포식자가 많아져 피식자에 대한 포식 압력이 커졌습니다.';
  } else if (predatorTrend === '감소') {
    activeStage = 3;
    explanation = '피식자 부족으로 포식자의 증가보다 자연 사망의 영향이 큽니다.';
  }

  return { preyTrend, predatorTrend, activeStage, explanation };
}

export function trajectorySummary(trajectory: PopulationState[], parameters: ModelParameters, model: ModelKind) {
  const preyValues = trajectory.map((state) => state.prey);
  const predatorValues = trajectory.map((state) => state.predator);
  const eq = equilibrium(parameters, model);
  return {
    preyMin: Math.min(...preyValues),
    preyMax: Math.max(...preyValues),
    predatorMin: Math.min(...predatorValues),
    predatorMax: Math.max(...predatorValues),
    equilibrium: eq,
    peakLag: firstPeakLag(trajectory),
  };
}
