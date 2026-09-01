export type ModelKind = 'basic' | 'logistic';

export interface ModelParameters {
  alpha: number;
  beta: number;
  delta: number;
  gamma: number;
  preyInitial: number;
  predatorInitial: number;
  carryingCapacity: number;
}

export interface PopulationState {
  time: number;
  prey: number;
  predator: number;
}

export interface ParameterLimit {
  min: number;
  max: number;
  step: number;
}

export const DEFAULT_PARAMETERS: Readonly<ModelParameters> = Object.freeze({
  alpha: 0.8,
  beta: 0.04,
  delta: 0.02,
  gamma: 0.6,
  preyInitial: 40,
  predatorInitial: 9,
  carryingCapacity: 180,
});

export const PARAMETER_LIMITS: Readonly<Record<keyof ModelParameters, ParameterLimit>> = Object.freeze({
  alpha: { min: 0.1, max: 1.5, step: 0.05 },
  beta: { min: 0.005, max: 0.08, step: 0.005 },
  delta: { min: 0.002, max: 0.04, step: 0.002 },
  gamma: { min: 0.1, max: 1.2, step: 0.05 },
  preyInitial: { min: 5, max: 200, step: 1 },
  predatorInitial: { min: 2, max: 100, step: 1 },
  carryingCapacity: { min: 50, max: 500, step: 10 },
});

export const DEFAULT_DURATION = 20;
export const DEFAULT_DT = 0.01;
const POPULATION_CEILING = 1_000_000;

export function clampParameter(key: keyof ModelParameters, value: number): number {
  const limit = PARAMETER_LIMITS[key];
  if (!Number.isFinite(value)) return DEFAULT_PARAMETERS[key];
  return Math.min(limit.max, Math.max(limit.min, value));
}

export function validateParameters(parameters: ModelParameters): ModelParameters {
  return {
    alpha: clampParameter('alpha', parameters.alpha),
    beta: clampParameter('beta', parameters.beta),
    delta: clampParameter('delta', parameters.delta),
    gamma: clampParameter('gamma', parameters.gamma),
    preyInitial: clampParameter('preyInitial', parameters.preyInitial),
    predatorInitial: clampParameter('predatorInitial', parameters.predatorInitial),
    carryingCapacity: clampParameter('carryingCapacity', parameters.carryingCapacity),
  };
}

export function derivatives(
  prey: number,
  predator: number,
  parameters: ModelParameters,
  model: ModelKind,
): readonly [number, number] {
  const preyGrowth = model === 'logistic'
    ? parameters.alpha * prey * (1 - prey / parameters.carryingCapacity)
    : parameters.alpha * prey;
  const preyChange = preyGrowth - parameters.beta * prey * predator;
  const predatorChange = parameters.delta * prey * predator - parameters.gamma * predator;
  return [preyChange, predatorChange] as const;
}

function safePopulation(value: number): number {
  if (!Number.isFinite(value)) return POPULATION_CEILING;
  if (value < 0) return 0;
  return Math.min(value, POPULATION_CEILING);
}

export function rk4Step(
  state: PopulationState,
  parameters: ModelParameters,
  dt: number,
  model: ModelKind,
): PopulationState {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) {
    throw new RangeError('dt는 0보다 크고 0.1 이하여야 합니다.');
  }

  const { prey: n, predator: p } = state;
  const [k1n, k1p] = derivatives(n, p, parameters, model);
  const [k2n, k2p] = derivatives(n + (dt * k1n) / 2, p + (dt * k1p) / 2, parameters, model);
  const [k3n, k3p] = derivatives(n + (dt * k2n) / 2, p + (dt * k2p) / 2, parameters, model);
  const [k4n, k4p] = derivatives(n + dt * k3n, p + dt * k3p, parameters, model);

  return {
    time: state.time + dt,
    prey: safePopulation(n + (dt / 6) * (k1n + 2 * k2n + 2 * k3n + k4n)),
    predator: safePopulation(p + (dt / 6) * (k1p + 2 * k2p + 2 * k3p + k4p)),
  };
}

export function simulate(
  inputParameters: ModelParameters,
  duration = DEFAULT_DURATION,
  dt = DEFAULT_DT,
  model: ModelKind = 'basic',
): PopulationState[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 100) {
    throw new RangeError('시뮬레이션 시간은 0보다 크고 100년 이하여야 합니다.');
  }

  const parameters = validateParameters(inputParameters);
  const steps = Math.ceil(duration / dt);
  const trajectory: PopulationState[] = [{
    time: 0,
    prey: parameters.preyInitial,
    predator: parameters.predatorInitial,
  }];

  let state = trajectory[0];
  for (let index = 1; index <= steps; index += 1) {
    state = rk4Step(state, parameters, dt, model);
    trajectory.push({
      time: Math.min(duration, index * dt),
      prey: state.prey,
      predator: state.predator,
    });
  }
  return trajectory;
}

export function equilibrium(parameters: ModelParameters, model: ModelKind): { prey: number; predator: number } {
  const prey = parameters.gamma / parameters.delta;
  const basicPredator = parameters.alpha / parameters.beta;
  if (model === 'basic') return { prey, predator: basicPredator };
  return {
    prey,
    predator: Math.max(0, basicPredator * (1 - prey / parameters.carryingCapacity)),
  };
}

export function nearestState(trajectory: PopulationState[], time: number): PopulationState {
  const boundedTime = Math.min(trajectory.at(-1)?.time ?? 0, Math.max(0, time));
  let low = 0;
  let high = trajectory.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (trajectory[middle].time < boundedTime) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return trajectory[0];
  const before = trajectory[low - 1];
  const after = trajectory[low];
  return boundedTime - before.time <= after.time - boundedTime ? before : after;
}
