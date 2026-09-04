import { DEFAULT_PARAMETERS, type SimulationParameters } from './model.ts';

export type RandomUint32 = () => number;

function secureRandomUint32(): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0];
}

export function createFreeExplorationSeed(randomUint32: RandomUint32 = secureRandomUint32): string {
  const suffix = randomUint32() % 1_000_000;
  return `FOREST-${String(suffix).padStart(6, '0')}`;
}

export function createInitialFreeParameters(randomUint32?: RandomUint32): SimulationParameters {
  return {
    ...DEFAULT_PARAMETERS,
    seed: createFreeExplorationSeed(randomUint32),
  };
}
