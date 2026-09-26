// Deliberately independent of current model defaults: captured from Phase 1.1.
export const baselineCommit = '75bc12603b49d5a2723420ec887c600f804105d5';
export const scenarios = [
  { name: 'default', parameters: { seed: 'FOREST-2048' }, steps: 600 },
  { name: 'two-a', parameters: { seed: 'FOX-FREE-A' }, steps: 600 },
  { name: 'two-b', parameters: { seed: 'FOX-FREE-B', transferEfficiency: 0.15 }, steps: 600 },
  { name: 'four-a', parameters: { seed: 'FOUR-LEVEL-REPLAY', foodChainDepth: 4 }, steps: 600 },
  { name: 'four-b', parameters: { seed: 'FOX-FREE-B', foodChainDepth: 4 }, steps: 600 },
  { name: 'interventions', parameters: { seed: 'PARTIAL-BASELINE' }, steps: 600, interventions: true },
  { name: 'apex-default', parameters: {}, steps: 2000, apex: true },
  { name: 'apex-dense', parameters: { initialRabbits: 110, initialWolves: 30, initialTertiary: 10, initialQuaternary: 4 }, steps: 2000, apex: true },
  { name: 'apex-efficient', parameters: { transferEfficiency: 0.2 }, steps: 2000, apex: true },
];

export function intervene(simulation: any, step: number): void {
  if (step === 3) simulation.removeSpecies('rabbit', 10);
  if (step === 7) simulation.removeSpecies('wolf', 2);
  if (step === 12) simulation.introduceSpecies('tertiary', 3);
  if (step === 18) simulation.removeSpecies('wolf');
  if (step === 25) simulation.introduceSpecies('wolf', 4);
  if (step === 30) simulation.introduceSpecies('quaternary', 2);
}

export function exactState(simulation: any, challenge: any): string {
  return JSON.stringify({
    snapshot: simulation.getSnapshot(), history: simulation.getHistory(),
    flow: simulation.getEnergyFlow(50), active: simulation.getActiveSpecies(),
    random: simulation.random, nextAgentId: simulation.nextAgentId,
    feedingLog: simulation.feedingLog, challenge: challenge?.getState() ?? null,
  });
}
