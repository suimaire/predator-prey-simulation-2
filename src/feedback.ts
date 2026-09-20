import type { PopulationMetric, SimulationSnapshot, Species } from './model.ts';

// Keep the strip's existing five-step comparison, including its startup window.
export function populationComparison(history: readonly PopulationMetric[]): PopulationMetric | undefined {
  return history[Math.max(0, history.length - 6)] ?? history[0];
}

export function populationChange(current: number, species: Species, comparison: PopulationMetric | undefined) {
  const previous = species === 'rabbit' ? comparison?.rabbits : species === 'wolf' ? comparison?.wolves
    : species === 'tertiary' ? comparison?.tertiary : comparison?.quaternary;
  const delta = current - (previous ?? current);
  return { previous: previous ?? current, delta, text: delta === 0 ? '순변화 0' : `${delta > 0 ? '+' : ''}${delta}` };
}

export interface RemovalFeedback {
  species: Species;
  step: number;
  count: number;
  positions: readonly { x: number; y: number }[];
  startedAt: number;
}

export const REMOVAL_FEEDBACK_MS = 600;

// Snapshot agent arrays belong to the model: copy only presentation data before removal.
export function captureRemovalFeedback(snapshot: SimulationSnapshot, species: Species, startedAt: number): RemovalFeedback {
  const agents = snapshot.agents[species];
  return { species, step: snapshot.step, count: agents.length, positions: agents.map(({ x, y }) => ({ x, y })), startedAt };
}

export function removalEmphasis(feedback: RemovalFeedback, now: number, reducedMotion: boolean): number {
  const elapsed = now - feedback.startedAt;
  if (elapsed < 0 || elapsed >= REMOVAL_FEEDBACK_MS) return 0;
  return reducedMotion ? 1 : 1 - elapsed / REMOVAL_FEEDBACK_MS;
}

export function personalBestImprovement(finalScore: number, previousBest: number | null): string | null {
  if (previousBest === null) return '첫 기록 달성';
  if (finalScore <= previousBest) return null;
  return `이전 최고보다 +${(finalScore - previousBest).toLocaleString()} step`;
}
