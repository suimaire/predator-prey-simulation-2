import type { Agent, PopulationMetric, SimulationSnapshot, Species } from './model.ts';

// Keep the strip's existing five-step comparison, including its startup window.
export function populationComparison(history: readonly PopulationMetric[]): PopulationMetric | undefined {
  const target = (history.at(-1)?.step ?? 0) - 5;
  // Several intervention samples can share a step; comparison remains five logical steps.
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].step <= target) return history[index];
  }
  return history[0];
}

export function populationChange(current: number, species: Species, comparison: PopulationMetric | undefined) {
  const previous = species === 'rabbit' ? comparison?.rabbits : species === 'wolf' ? comparison?.wolves
    : species === 'fox' ? comparison?.fox ?? 0 : species === 'tertiary' ? comparison?.tertiary : comparison?.quaternary;
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

export const POPULATION_FEEDBACK_MS = 900;
export const REMOVAL_FEEDBACK_MS = 950;
export const REMOVAL_MARKER_MS = 1300;
export const PERSONAL_BEST_FEEDBACK_MS = 1200;

// Retain the pre-action count, but only highlight individuals actually removed.
export function captureRemovalFeedback(snapshot: SimulationSnapshot, species: Species, startedAt: number, survivors: readonly Agent[] = []): RemovalFeedback {
  const agents = snapshot.agents[species] ?? [];
  const remainingIds = new Set(survivors.map(agent => agent.id));
  return { species, step: snapshot.step, count: agents.length, positions: agents.filter(agent => !remainingIds.has(agent.id)).map(({ x, y }) => ({ x, y })), startedAt };
}

export function removalEmphasis(feedback: RemovalFeedback, now: number, reducedMotion: boolean, duration = REMOVAL_FEEDBACK_MS): number {
  const elapsed = now - feedback.startedAt;
  if (elapsed < 0 || elapsed >= duration) return 0;
  return reducedMotion ? 1 : 1 - elapsed / duration;
}

// A completed result outlives its animation. Only a new run or mode clears it.
export interface PersonalBestFeedback {
  finalScore: number;
  previousBest: number | null;
  improvement: number | null;
  description: string;
}

export function personalBestFeedback(finalScore: number, previousBest: number | null): PersonalBestFeedback | null {
  const description = personalBestImprovement(finalScore, previousBest);
  return description === null ? null : {
    finalScore, previousBest, improvement: previousBest === null ? null : finalScore - previousBest, description,
  };
}

// A re-render at the same step must neither start nor extend the current effect.
export function populationFeedbackDeadline(now: number, until: number | undefined, changedStep: boolean, changedValue: boolean, delta: number): number | undefined {
  if (delta === 0) return undefined;
  if (until !== undefined && now < until) return until;
  return changedStep && changedValue ? now + POPULATION_FEEDBACK_MS : undefined;
}

export function personalBestImprovement(finalScore: number, previousBest: number | null): string | null {
  if (previousBest === null) return '첫 기록 달성';
  if (finalScore <= previousBest) return null;
  return `이전 최고보다 +${(finalScore - previousBest).toLocaleString()} step`;
}
