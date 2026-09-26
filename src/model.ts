export type CoreSpecies = 'rabbit' | 'wolf' | 'tertiary' | 'quaternary';
export type Species = CoreSpecies | 'fox';
export type SpeciesRecord<T> = Record<CoreSpecies, T> & { fox?: T };
export type ConsumerSpecies = Species;
export type FoodSource = 'vegetation' | Species;
export type FoodChainDepth = 2 | 3 | 4;

export interface Agent {
  id: number;
  species: Species;
  x: number;
  y: number;
  energy: number;
  age: number;
}

export interface SimulationParameters {
  gridColumns: number;
  foodChainDepth: FoodChainDepth;
  transferEfficiency: number;
  initialRabbits: number;
  initialWolves: number;
  initialTertiary: number;
  initialQuaternary: number;
  initialForestDensity: number;
  forestRegrowth: number;
  forestMaxStage: number;
  toroidal: boolean;
  seed: string;
  rabbitMoveProbability: number;
  rabbitMoveDistance: number;
  rabbitBreedProbability: number;
  rabbitBreedEnergy: number;
  rabbitEnergyCost: number;
  rabbitFoodEnergy: number;
  rabbitMaxAge: number;
  wolfMoveProbability: number;
  wolfMoveDistance: number;
  wolfBreedProbability: number;
  wolfBreedEnergy: number;
  wolfEnergyCost: number;
  wolfFoodEnergy: number;
  wolfMaxAge: number;
  tertiaryMoveProbability: number;
  tertiaryMoveDistance: number;
  tertiaryBreedProbability: number;
  tertiaryBreedEnergy: number;
  tertiaryEnergyCost: number;
  tertiaryFoodEnergy: number;
  tertiaryMaxAge: number;
  quaternaryMoveProbability: number;
  quaternaryMoveDistance: number;
  quaternaryBreedProbability: number;
  quaternaryBreedEnergy: number;
  quaternaryEnergyCost: number;
  quaternaryFoodEnergy: number;
  quaternaryMaxAge: number;
}

export interface SpeciesConfig {
  id: Species;
  label: string;
  trophicLevel: 1 | 2 | 3 | 4 | null;
  preyType: FoodSource;
  initialPopulation: number;
  movement: { probability: number; distance: number };
  basalEnergyCost: number;
  reproductionThreshold: number;
  reproductionProbability: number;
  nominalFoodGainAtTenPercent: number;
  maxAge: number;
  omnivory?: { huntSuccess: number; plantNominalGain: number };
  populationCap?: number;
}

export interface CumulativeStats {
  births: SpeciesRecord<number>;
  deaths: SpeciesRecord<number>;
  feedingEvents: SpeciesRecord<number>;
  forestEaten: number;
  foxPlantEaten?: number;
}

export interface PopulationMetric {
  step: number;
  rabbits: number;
  wolves: number;
  tertiary: number;
  quaternary: number;
  fox?: number;
  forestPercent: number;
  forestAbundance: number;
}

export interface Intervention {
  kind: 'introduce' | 'remove';
  step: number;
  species: Species;
  amount: number;
  resultingCount: number;
}

export interface EnergyFlowMetric {
  source: FoodSource;
  target: Species;
  transferredEnergy: number;
  eventCount: number;
  rate: number;
  window: number;
}

export interface SimulationSnapshot {
  width: number;
  height: number;
  maxForestStage: number;
  forest: Uint8Array;
  agents: Readonly<SpeciesRecord<readonly Agent[]>>;
  rabbits: readonly Agent[];
  wolves: readonly Agent[];
  tertiary: readonly Agent[];
  quaternary: readonly Agent[];
  step: number;
  stats: Readonly<CumulativeStats>;
  removedSpecies: readonly Species[];
  interventions: readonly Intervention[];
}

export const CORE_CHAIN_ORDER: readonly CoreSpecies[] = ['rabbit', 'wolf', 'tertiary', 'quaternary'];
// Compatibility name: depth always describes the original linear chain.
export const SPECIES_ORDER = CORE_CHAIN_ORDER;
export const RUNTIME_SPECIES: readonly Species[] = ['rabbit', 'wolf', 'fox', 'tertiary', 'quaternary'];
export const FOOD_SOURCES: Readonly<Record<Species, readonly FoodSource[]>> = Object.freeze({
  rabbit: ['vegetation'], wolf: ['rabbit'], fox: ['rabbit', 'vegetation'],
  tertiary: ['wolf'], quaternary: ['tertiary'],
});
// Dimensionless educational tuning values, not measured red-fox physiology.
// Vegetation stands in for plant-derived food such as berries, not grazing grass.
export const FOX_CONFIG: Readonly<SpeciesConfig> = Object.freeze({
  id: 'fox', label: '붉은여우', trophicLevel: null, preyType: 'rabbit', initialPopulation: 0,
  movement: Object.freeze({ probability: 0.94, distance: 1 }),
  basalEnergyCost: 1.7, reproductionThreshold: 24, reproductionProbability: 0.018,
  nominalFoodGainAtTenPercent: 8, maxAge: 110, populationCap: 80,
  omnivory: Object.freeze({ huntSuccess: 0.70, plantNominalGain: 0.5 }),
});
// Existing initial-population domain, also used as a per-introduction batch cap.
// Runtime occupancy is additionally limited by the shared one-animal-per-cell rule.
export const POPULATION_LIMITS: Readonly<Record<Species, number>> = Object.freeze({
  rabbit: 400, wolf: 160, tertiary: 40, quaternary: 20, fox: 80,
});
export const SPECIES_LABELS: Readonly<Record<Species, string>> = Object.freeze({
  rabbit: '토끼',
  wolf: '늑대',
  fox: '붉은여우',
  tertiary: '3차 소비자',
  quaternary: '4차 소비자',
});

export const DEFAULT_PARAMETERS: Readonly<SimulationParameters> = Object.freeze({
  gridColumns: 32,
  foodChainDepth: 2,
  transferEfficiency: 0.1,
  initialRabbits: 50,
  initialWolves: 8,
  initialTertiary: 3,
  initialQuaternary: 1,
  initialForestDensity: 78,
  forestRegrowth: 0.1,
  forestMaxStage: 4,
  toroidal: true,
  seed: 'FOREST-2048',
  rabbitMoveProbability: 0.86,
  rabbitMoveDistance: 1,
  rabbitBreedProbability: 0.12,
  rabbitBreedEnergy: 18,
  rabbitEnergyCost: 1.5,
  rabbitFoodEnergy: 5,
  rabbitMaxAge: 85,
  wolfMoveProbability: 0.94,
  wolfMoveDistance: 1,
  wolfBreedProbability: 0.02,
  wolfBreedEnergy: 28,
  wolfEnergyCost: 2.2,
  wolfFoodEnergy: 10,
  wolfMaxAge: 120,
  tertiaryMoveProbability: 0.96,
  tertiaryMoveDistance: 2,
  tertiaryBreedProbability: 0.014,
  tertiaryBreedEnergy: 30,
  tertiaryEnergyCost: 1.15,
  tertiaryFoodEnergy: 15,
  tertiaryMaxAge: 145,
  quaternaryMoveProbability: 0.97,
  quaternaryMoveDistance: 3,
  quaternaryBreedProbability: 0.008,
  quaternaryBreedEnergy: 34,
  quaternaryEnergyCost: 0.9,
  quaternaryFoodEnergy: 18,
  quaternaryMaxAge: 170,
});

const HISTORY_LIMIT = 480;
const ENERGY_EVENT_LIMIT = 8_000;
const REFERENCE_EFFICIENCY = 0.1;

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function whole(value: number, minimum: number, maximum: number): number {
  return Math.round(clamp(value, minimum, maximum));
}

export function validateParameters(input: SimulationParameters): SimulationParameters {
  const depth = whole(input.foodChainDepth, 2, 4) as FoodChainDepth;
  return {
    gridColumns: whole(input.gridColumns, 20, 48),
    foodChainDepth: depth,
    transferEfficiency: clamp(input.transferEfficiency, 0.05, 0.3),
    initialRabbits: whole(input.initialRabbits, 0, POPULATION_LIMITS.rabbit),
    initialWolves: whole(input.initialWolves, 0, POPULATION_LIMITS.wolf),
    initialTertiary: whole(input.initialTertiary, 0, POPULATION_LIMITS.tertiary),
    initialQuaternary: whole(input.initialQuaternary, 0, POPULATION_LIMITS.quaternary),
    initialForestDensity: whole(input.initialForestDensity, 0, 100),
    forestRegrowth: clamp(input.forestRegrowth, 0, 0.25),
    forestMaxStage: whole(input.forestMaxStage, 1, 4),
    toroidal: Boolean(input.toroidal),
    seed: String(input.seed || DEFAULT_PARAMETERS.seed).trim().slice(0, 40) || DEFAULT_PARAMETERS.seed,
    rabbitMoveProbability: clamp(input.rabbitMoveProbability, 0, 1),
    rabbitMoveDistance: whole(input.rabbitMoveDistance, 1, 3),
    rabbitBreedProbability: clamp(input.rabbitBreedProbability, 0, 0.8),
    rabbitBreedEnergy: clamp(input.rabbitBreedEnergy, 2, 80),
    rabbitEnergyCost: clamp(input.rabbitEnergyCost, 0.1, 8),
    rabbitFoodEnergy: clamp(input.rabbitFoodEnergy, 0.5, 25),
    rabbitMaxAge: whole(input.rabbitMaxAge, 10, 240),
    wolfMoveProbability: clamp(input.wolfMoveProbability, 0, 1),
    wolfMoveDistance: whole(input.wolfMoveDistance, 1, 4),
    wolfBreedProbability: clamp(input.wolfBreedProbability, 0, 0.6),
    wolfBreedEnergy: clamp(input.wolfBreedEnergy, 4, 120),
    wolfEnergyCost: clamp(input.wolfEnergyCost, 0.1, 10),
    wolfFoodEnergy: clamp(input.wolfFoodEnergy, 1, 50),
    wolfMaxAge: whole(input.wolfMaxAge, 10, 300),
    tertiaryMoveProbability: clamp(input.tertiaryMoveProbability, 0, 1),
    tertiaryMoveDistance: whole(input.tertiaryMoveDistance, 1, 5),
    tertiaryBreedProbability: clamp(input.tertiaryBreedProbability, 0, 0.3),
    tertiaryBreedEnergy: clamp(input.tertiaryBreedEnergy, 4, 160),
    tertiaryEnergyCost: clamp(input.tertiaryEnergyCost, 0.1, 10),
    tertiaryFoodEnergy: clamp(input.tertiaryFoodEnergy, 1, 80),
    tertiaryMaxAge: whole(input.tertiaryMaxAge, 10, 360),
    quaternaryMoveProbability: clamp(input.quaternaryMoveProbability, 0, 1),
    quaternaryMoveDistance: whole(input.quaternaryMoveDistance, 1, 6),
    quaternaryBreedProbability: clamp(input.quaternaryBreedProbability, 0, 0.3),
    quaternaryBreedEnergy: clamp(input.quaternaryBreedEnergy, 4, 200),
    quaternaryEnergyCost: clamp(input.quaternaryEnergyCost, 0.1, 10),
    quaternaryFoodEnergy: clamp(input.quaternaryFoodEnergy, 1, 100),
    quaternaryMaxAge: whole(input.quaternaryMaxAge, 10, 420),
  };
}

export function activeSpecies(depth: FoodChainDepth): CoreSpecies[] {
  return SPECIES_ORDER.slice(0, depth);
}

export function speciesConfigs(parameters: SimulationParameters): Readonly<Record<Species, SpeciesConfig>> {
  return {
    fox: FOX_CONFIG,
    rabbit: {
      id: 'rabbit', label: SPECIES_LABELS.rabbit, trophicLevel: 1, preyType: 'vegetation',
      initialPopulation: parameters.initialRabbits,
      movement: { probability: parameters.rabbitMoveProbability, distance: parameters.rabbitMoveDistance },
      basalEnergyCost: parameters.rabbitEnergyCost,
      reproductionThreshold: parameters.rabbitBreedEnergy,
      reproductionProbability: parameters.rabbitBreedProbability,
      nominalFoodGainAtTenPercent: parameters.rabbitFoodEnergy,
      maxAge: parameters.rabbitMaxAge,
    },
    wolf: {
      id: 'wolf', label: SPECIES_LABELS.wolf, trophicLevel: 2, preyType: 'rabbit',
      initialPopulation: parameters.initialWolves,
      movement: { probability: parameters.wolfMoveProbability, distance: parameters.wolfMoveDistance },
      basalEnergyCost: parameters.wolfEnergyCost,
      reproductionThreshold: parameters.wolfBreedEnergy,
      reproductionProbability: parameters.wolfBreedProbability,
      nominalFoodGainAtTenPercent: parameters.wolfFoodEnergy,
      maxAge: parameters.wolfMaxAge,
    },
    tertiary: {
      id: 'tertiary', label: SPECIES_LABELS.tertiary, trophicLevel: 3, preyType: 'wolf',
      initialPopulation: parameters.initialTertiary,
      movement: { probability: parameters.tertiaryMoveProbability, distance: parameters.tertiaryMoveDistance },
      basalEnergyCost: parameters.tertiaryEnergyCost,
      reproductionThreshold: parameters.tertiaryBreedEnergy,
      reproductionProbability: parameters.tertiaryBreedProbability,
      nominalFoodGainAtTenPercent: parameters.tertiaryFoodEnergy,
      maxAge: parameters.tertiaryMaxAge,
    },
    quaternary: {
      id: 'quaternary', label: SPECIES_LABELS.quaternary, trophicLevel: 4, preyType: 'tertiary',
      initialPopulation: parameters.initialQuaternary,
      movement: { probability: parameters.quaternaryMoveProbability, distance: parameters.quaternaryMoveDistance },
      basalEnergyCost: parameters.quaternaryEnergyCost,
      reproductionThreshold: parameters.quaternaryBreedEnergy,
      reproductionProbability: parameters.quaternaryBreedProbability,
      nominalFoodGainAtTenPercent: parameters.quaternaryFoodEnergy,
      maxAge: parameters.quaternaryMaxAge,
    },
  };
}

/**
 * Existing food-gain controls describe the amount gained at the educational 10% reference.
 * Dividing by that reference recovers available model energy; efficiency is applied exactly once.
 */
export function energyGainFromFood(nominalGainAtTenPercent: number, efficiency: number): number {
  const availableModelEnergy = nominalGainAtTenPercent / REFERENCE_EFFICIENCY;
  return availableModelEnergy * clamp(efficiency, 0.05, 0.3);
}

function seedToUint32(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x9e3779b9;
}

class SeededRandom {
  private state: number;

  constructor(seed: string) { this.state = seedToUint32(seed); }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 4294967296;
  }

  integer(maximumExclusive: number): number { return Math.floor(this.next() * maximumExclusive); }

  shuffle<T>(items: T[]): T[] {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swapIndex = this.integer(index + 1);
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    return items;
  }
}

interface Position { x: number; y: number }
interface FeedingEvent { step: number; source: FoodSource; target: Species; energy: number }

function emptySpeciesRecord(): SpeciesRecord<number> {
  return { rabbit: 0, wolf: 0, tertiary: 0, quaternary: 0 };
}

function emptyStats(): CumulativeStats {
  return { births: emptySpeciesRecord(), deaths: emptySpeciesRecord(), feedingEvents: emptySpeciesRecord(), forestEaten: 0 };
}

function emptyAgents(): SpeciesRecord<Agent[]> {
  return { rabbit: [], wolf: [], tertiary: [], quaternary: [] };
}

export class ForestSimulation {
  private parameters: SimulationParameters;
  private configs: Readonly<Record<Species, SpeciesConfig>>;
  private random: SeededRandom;
  private forest: Uint8Array = new Uint8Array();
  private agents: SpeciesRecord<Agent[]> = emptyAgents();
  private width = 0;
  private height = 0;
  private stepNumber = 0;
  private nextAgentId = 1;
  private stats: CumulativeStats = emptyStats();
  private history: PopulationMetric[] = [];
  private removed = new Set<Species>();
  private runtimeSpecies = new Set<Species>();
  private interventions: Intervention[] = [];
  private feedingLog: FeedingEvent[] = [];
  // Per-step aggregates keep complete fox diet energy even if the legacy event
  // log reaches its cap. At most 480 records; no unbounded event history.
  private foxFoodWindow = new Map<number, { rabbit: number; vegetation: number; rabbitCount: number; vegetationCount: number }>();

  constructor(parameters: SimulationParameters = { ...DEFAULT_PARAMETERS }) {
    this.parameters = validateParameters(parameters);
    this.configs = speciesConfigs(this.parameters);
    this.random = new SeededRandom(this.parameters.seed);
    this.reset(this.parameters);
  }

  reset(parameters: SimulationParameters = this.parameters): void {
    this.parameters = validateParameters(parameters);
    this.configs = speciesConfigs(this.parameters);
    this.random = new SeededRandom(this.parameters.seed);
    this.width = this.parameters.gridColumns;
    this.height = Math.max(14, Math.round(this.width * 0.67));
    this.forest = new Uint8Array(this.width * this.height);
    this.agents = emptyAgents();
    this.stepNumber = 0;
    this.nextAgentId = 1;
    this.stats = emptyStats();
    this.history = [];
    this.removed = new Set();
    this.runtimeSpecies = new Set(activeSpecies(this.parameters.foodChainDepth));
    this.interventions = [];
    this.feedingLog = [];
    this.foxFoodWindow.clear();
    this.initializeForest();
    this.initializeAgents();
    this.recordMetric();
  }

  getParameters(): SimulationParameters { return { ...this.parameters }; }
  getHistory(): readonly PopulationMetric[] { return this.history; }
  getInterventions(): readonly Intervention[] { return this.interventions; }
  getActiveSpecies(): Species[] { return RUNTIME_SPECIES.filter((species) => this.runtimeSpecies.has(species)); }

  getSnapshot(): SimulationSnapshot {
    return {
      width: this.width,
      height: this.height,
      maxForestStage: this.parameters.forestMaxStage,
      forest: this.forest,
      agents: this.agents,
      rabbits: this.agents.rabbit,
      wolves: this.agents.wolf,
      tertiary: this.agents.tertiary,
      quaternary: this.agents.quaternary,
      step: this.stepNumber,
      stats: this.stats,
      removedSpecies: [...this.removed],
      interventions: this.interventions,
    };
  }

  step(): PopulationMetric {
    this.growForest();
    if (!this.removed.has('rabbit')) this.processRabbits();
    // Absolutely no additional RNG draw without a living fox. Core predators
    // retain their Phase 1.1 algorithm and ordering relative to higher consumers.
    const predators: Species[] = this.getActiveSpecies().filter(species => species !== 'rabbit' && species !== 'fox');
    if ((this.agents.fox?.length ?? 0) > 0) {
      const wolfIndex = predators.indexOf('wolf');
      predators.splice(wolfIndex < 0 ? 0 : wolfIndex + (this.random.next() < 0.5 ? 0 : 1), 0, 'fox');
    }
    for (const species of predators) {
      if (!this.removed.has(species)) {
        if (this.configs[species].omnivory) this.processOmnivore(species);
        else this.processPredator(species);
      }
    }
    this.stepNumber += 1;
    for (const step of this.foxFoodWindow.keys()) {
      if (step <= this.stepNumber - HISTORY_LIMIT) this.foxFoodWindow.delete(step);
      else break;
    }
    return this.recordMetric();
  }

  removeSpecies(species: Species, amount = this.agents[species]?.length ?? 0): boolean {
    const agents = this.agents[species] ?? [];
    // Invalid actions are atomic, including the RNG and event/history state.
    if (!Number.isInteger(amount) || amount < 1 || amount > agents.length) return false;
    if (amount === agents.length) {
      // Preserve the original full-removal path without consuming selection RNG.
      this.agents[species] = [];
      this.removed.add(species);
    } else {
      // Partial Fisher–Yates: sample distinct indices using this experiment's RNG.
      const indices = agents.map((_, index) => index);
      const selected = new Set<number>();
      for (let index = 0; index < amount; index += 1) {
        const swapIndex = index + this.random.integer(indices.length - index);
        [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
        selected.add(indices[index]);
      }
      // Keep survivor objects and their order intact; they continue acting normally.
      this.agents[species] = agents.filter((_, index) => !selected.has(index));
    }
    this.interventions.push({ kind: 'remove', step: this.stepNumber, species, amount, resultingCount: this.agents[species]!.length });
    this.recordMetric(true);
    return true;
  }

  getIntroductionLimit(species: Species): number {
    const occupied = RUNTIME_SPECIES.reduce((count, item) => count + (this.agents[item]?.length ?? 0), 0);
    const capRoom = (this.configs[species].populationCap ?? Infinity) - (this.agents[species]?.length ?? 0);
    return Math.max(0, Math.min(POPULATION_LIMITS[species], capRoom, this.width * this.height - occupied));
  }

  introduceSpecies(species: Species, amount: number): boolean {
    // Reject the entire action before consuming RNG or changing any state.
    if (!Number.isInteger(amount) || amount < 1 || amount > this.getIntroductionLimit(species)) return false;
    const occupied = this.occupiedMap();
    const positions = this.availablePositions(occupied);
    this.random.shuffle(positions);
    if (!this.agents[species]) {
      this.agents[species] = [];
      this.stats.births[species] = 0; this.stats.deaths[species] = 0; this.stats.feedingEvents[species] = 0;
    }
    this.populateSpecies(species, amount, positions);
    this.runtimeSpecies.add(species);
    this.removed.delete(species);
    this.interventions.push({ kind: 'introduce', step: this.stepNumber, species, amount, resultingCount: this.agents[species]!.length });
    this.recordMetric(true);
    return true;
  }

  getEnergyFlow(window = 20): readonly EnergyFlowMetric[] {
    const safeWindow = whole(window, 1, HISTORY_LIMIT);
    const firstStep = Math.max(0, this.stepNumber - safeWindow + 1);
    const elapsed = Math.max(1, Math.min(safeWindow, this.stepNumber || 1));
    const totals = new Map<string, { source: FoodSource; target: Species; energy: number; count: number }>();
    for (const species of this.getActiveSpecies()) {
      for (const source of FOOD_SOURCES[species]) {
        totals.set(`${source}:${species}`, { source, target: species, energy: 0, count: 0 });
      }
    }
    for (const event of this.feedingLog) {
      if (event.step < firstStep || event.target === 'fox') continue;
      const item = totals.get(`${event.source}:${event.target}`);
      if (item) { item.energy += event.energy; item.count += 1; }
    }
    for (const [step, entry] of this.foxFoodWindow) {
      if (step < firstStep) continue;
      for (const source of ['rabbit', 'vegetation'] as const) {
        const item = totals.get(`${source}:fox`);
        if (item) { item.energy += entry[source]; item.count += entry[`${source}Count`]; }
      }
    }
    return [...totals.values()].map((item) => ({
      source: item.source,
      target: item.target,
      transferredEnergy: item.energy,
      eventCount: item.count,
      rate: item.energy / elapsed,
      window: safeWindow,
    }));
  }

  getFoxDiet(window = 50): { window: number; rabbitEnergy: number; plantEnergy: number; rabbitPercent: number | null; plantPercent: number | null } {
    const flows = this.getEnergyFlow(window).filter(flow => flow.target === 'fox');
    const rabbitEnergy = flows.find(flow => flow.source === 'rabbit')?.transferredEnergy ?? 0;
    const plantEnergy = flows.find(flow => flow.source === 'vegetation')?.transferredEnergy ?? 0;
    const total = rabbitEnergy + plantEnergy;
    return { window: whole(window, 1, HISTORY_LIMIT), rabbitEnergy, plantEnergy,
      rabbitPercent: total > 0 ? rabbitEnergy / total * 100 : null,
      plantPercent: total > 0 ? plantEnergy / total * 100 : null };
  }

  private initializeForest(): void {
    const target = (this.parameters.initialForestDensity / 100) * this.parameters.forestMaxStage;
    for (let index = 0; index < this.forest.length; index += 1) {
      const variation = (this.random.next() - 0.5) * 2.4;
      this.forest[index] = whole(target + variation, 0, this.parameters.forestMaxStage);
    }
  }

  private initializeAgents(): void {
    const positions = this.availablePositions();
    this.random.shuffle(positions);
    for (const species of activeSpecies(this.parameters.foodChainDepth)) {
      this.populateSpecies(species, this.configs[species].initialPopulation, positions);
    }
  }

  private availablePositions(occupied = new Map<number, Agent>()): Position[] {
    const positions: Position[] = [];
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (!occupied.has(this.index(x, y))) positions.push({ x, y });
      }
    }
    return positions;
  }

  private populateSpecies(species: Species, amount: number, positions: Position[]): void {
    const config = this.configs[species];
    const count = Math.min(amount, positions.length);
    for (let index = 0; index < count; index += 1) {
      const position = positions.pop()!;
      const initialFraction = species === 'wolf' ? 0.52 : 0.55;
      const energy = config.reproductionThreshold * (initialFraction + this.random.next() * 0.3);
      this.agents[species]!.push(this.createAgent(species, position, energy));
    }
  }

  private createAgent(species: Species, position: Position, energy: number): Agent {
    return { id: this.nextAgentId++, species, x: position.x, y: position.y, energy, age: 0 };
  }

  private index(x: number, y: number): number { return y * this.width + x; }
  private positionKey(position: Position): number { return this.index(position.x, position.y); }

  private occupiedMap(): Map<number, Agent> {
    const occupied = new Map<number, Agent>();
    for (const species of this.getActiveSpecies()) {
      for (const agent of this.agents[species] ?? []) occupied.set(this.index(agent.x, agent.y), agent);
    }
    return occupied;
  }

  private neighbors(agent: Agent, distance: number): Position[] {
    const unique = new Map<number, Position>();
    for (let deltaY = -distance; deltaY <= distance; deltaY += 1) {
      for (let deltaX = -distance; deltaX <= distance; deltaX += 1) {
        if (deltaX === 0 && deltaY === 0) continue;
        let x = agent.x + deltaX;
        let y = agent.y + deltaY;
        if (this.parameters.toroidal) {
          x = (x + this.width) % this.width;
          y = (y + this.height) % this.height;
        } else if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
        const position = { x, y };
        unique.set(this.positionKey(position), position);
      }
    }
    return [...unique.values()];
  }

  private growForest(): void {
    const { forestRegrowth, forestMaxStage } = this.parameters;
    for (let index = 0; index < this.forest.length; index += 1) {
      if (this.forest[index] < forestMaxStage && this.random.next() < forestRegrowth) this.forest[index] += 1;
    }
  }

  private recordFeeding(source: FoodSource, target: Species, nominalGain: number): number {
    const energy = energyGainFromFood(nominalGain, this.parameters.transferEfficiency);
    this.feedingLog.push({ step: this.stepNumber + 1, source, target, energy });
    if (this.feedingLog.length > ENERGY_EVENT_LIMIT) this.feedingLog.splice(0, this.feedingLog.length - ENERGY_EVENT_LIMIT);
    this.stats.feedingEvents[target] = (this.stats.feedingEvents[target] ?? 0) + 1;
    if (target === 'fox' && (source === 'rabbit' || source === 'vegetation')) {
      const step = this.stepNumber + 1;
      const entry = this.foxFoodWindow.get(step) ?? { rabbit: 0, vegetation: 0, rabbitCount: 0, vegetationCount: 0 };
      entry[source] += energy; entry[`${source}Count`] += 1;
      this.foxFoodWindow.set(step, entry);
    }
    return energy;
  }

  private processRabbits(): void {
    const config = this.configs.rabbit;
    const occupied = this.occupiedMap();
    const dead = new Set<number>();
    const newborns: Agent[] = [];
    const ordered = this.random.shuffle([...this.agents.rabbit]);

    for (const rabbit of ordered) {
      rabbit.age += 1;
      rabbit.energy -= config.basalEnergyCost;
      if (this.random.next() < config.movement.probability) {
        const available = this.neighbors(rabbit, config.movement.distance).filter((position) => !occupied.has(this.positionKey(position)));
        if (available.length > 0) {
          const richest = Math.max(...available.map((position) => this.forest[this.positionKey(position)]));
          const preferred = available.filter((position) => this.forest[this.positionKey(position)] >= Math.max(1, richest - 1));
          const choices = preferred.length > 0 ? preferred : available;
          const destination = choices[this.random.integer(choices.length)];
          occupied.delete(this.index(rabbit.x, rabbit.y));
          rabbit.x = destination.x; rabbit.y = destination.y;
          occupied.set(this.index(rabbit.x, rabbit.y), rabbit);
        }
      }

      this.eatPlant(rabbit, config.nominalFoodGainAtTenPercent);

      this.tryReproduce(rabbit, config, occupied, newborns);
      if (rabbit.energy <= 0 || rabbit.age >= config.maxAge) {
        dead.add(rabbit.id);
        occupied.delete(this.index(rabbit.x, rabbit.y));
        this.stats.deaths.rabbit += 1;
      }
    }
    this.agents.rabbit = this.agents.rabbit.filter((agent) => !dead.has(agent.id));
    this.agents.rabbit.push(...newborns);
  }

  private processPredator(species: Species): void {
    const config = this.configs[species];
    if (config.preyType === 'vegetation') return;
    const preySpecies = config.preyType;
    const occupied = this.occupiedMap();
    const dead = new Set<number>();
    const hunted = new Set<number>();
    const newborns: Agent[] = [];
    const ordered = this.random.shuffle([...(this.agents[species] ?? [])]);

    for (const predator of ordered) {
      predator.age += 1;
      predator.energy -= config.basalEnergyCost;
      const nearby = this.neighbors(predator, config.movement.distance);
      const preyCells = nearby.filter((position) => {
        const occupant = occupied.get(this.positionKey(position));
        return occupant?.species === preySpecies && !hunted.has(occupant.id);
      });

      if (preyCells.length > 0) {
        const destination = preyCells[this.random.integer(preyCells.length)];
        const prey = occupied.get(this.positionKey(destination));
        if (prey?.species === preySpecies) {
          hunted.add(prey.id);
          occupied.delete(this.index(predator.x, predator.y));
          predator.x = destination.x; predator.y = destination.y;
          occupied.set(this.positionKey(destination), predator);
          predator.energy += this.recordFeeding(preySpecies, species, config.nominalFoodGainAtTenPercent);
          this.stats.deaths[preySpecies] = (this.stats.deaths[preySpecies] ?? 0) + 1;
        }
      } else if (this.random.next() < config.movement.probability) {
        const available = nearby.filter((position) => !occupied.has(this.positionKey(position)));
        if (available.length > 0) {
          const destination = available[this.random.integer(available.length)];
          occupied.delete(this.index(predator.x, predator.y));
          predator.x = destination.x; predator.y = destination.y;
          occupied.set(this.positionKey(destination), predator);
        }
      }

      this.tryReproduce(predator, config, occupied, newborns);
      if (predator.energy <= 0 || predator.age >= config.maxAge) {
        dead.add(predator.id);
        occupied.delete(this.index(predator.x, predator.y));
        this.stats.deaths[species] = (this.stats.deaths[species] ?? 0) + 1;
      }
    }
    this.agents[preySpecies] = (this.agents[preySpecies] ?? []).filter((agent) => !hunted.has(agent.id));
    this.agents[species] = (this.agents[species] ?? []).filter((agent) => !dead.has(agent.id));
    this.agents[species]!.push(...newborns);
  }

  private eatPlant(agent: Agent, nominalGain: number): void {
    const cellIndex = this.index(agent.x, agent.y);
    if (this.forest[cellIndex] === 0) return;
    this.forest[cellIndex] -= 1;
    agent.energy += this.recordFeeding('vegetation', agent.species, nominalGain);
    this.stats.forestEaten += 1;
    if (agent.species === 'fox') this.stats.foxPlantEaten = (this.stats.foxPlantEaten ?? 0) + 1;
  }

  private processOmnivore(species: Species): void {
    const config = this.configs[species];
    const diet = config.omnivory!;
    const preySpecies = config.preyType as Species;
    const occupied = this.occupiedMap();
    const dead = new Set<number>(), hunted = new Set<number>();
    const newborns: Agent[] = [];
    for (const animal of this.random.shuffle([...(this.agents[species] ?? [])])) {
      animal.age += 1; animal.energy -= config.basalEnergyCost;
      const nearby = this.neighbors(animal, config.movement.distance);
      const preyCells = nearby.filter(position => occupied.get(this.positionKey(position))?.species === preySpecies);
      if (preyCells.length > 0) {
        // Match legacy seeded candidate selection, then one probabilistic hunt.
        const destination = preyCells[this.random.integer(preyCells.length)];
        if (this.random.next() < diet.huntSuccess) {
          const prey = occupied.get(this.positionKey(destination))!;
          hunted.add(prey.id);
          occupied.delete(this.index(animal.x, animal.y));
          animal.x = destination.x; animal.y = destination.y;
          occupied.set(this.positionKey(destination), animal);
          animal.energy += this.recordFeeding(preySpecies, species, config.nominalFoodGainAtTenPercent);
          this.stats.deaths[preySpecies] = (this.stats.deaths[preySpecies] ?? 0) + 1;
        }
        // Failed hunts end feeding: deliberately no plant fallback or second meal.
      } else {
        if (this.random.next() < config.movement.probability) {
          const available = nearby.filter(position => !occupied.has(this.positionKey(position)));
          if (available.length > 0) {
            const destination = available[this.random.integer(available.length)];
            occupied.delete(this.index(animal.x, animal.y));
            animal.x = destination.x; animal.y = destination.y;
            occupied.set(this.positionKey(destination), animal);
          }
        }
        this.eatPlant(animal, diet.plantNominalGain);
      }
      this.tryReproduce(animal, config, occupied, newborns);
      if (animal.energy <= 0 || animal.age >= config.maxAge) {
        dead.add(animal.id); occupied.delete(this.index(animal.x, animal.y));
        this.stats.deaths[species] = (this.stats.deaths[species] ?? 0) + 1;
      }
    }
    this.agents[preySpecies] = (this.agents[preySpecies] ?? []).filter(agent => !hunted.has(agent.id));
    this.agents[species] = (this.agents[species] ?? []).filter(agent => !dead.has(agent.id));
    this.agents[species]!.push(...newborns);
  }

  private tryReproduce(agent: Agent, config: SpeciesConfig, occupied: Map<number, Agent>, newborns: Agent[]): void {
    if (this.removed.has(config.id)) return;
    if (config.populationCap !== undefined && (this.agents[config.id]?.length ?? 0) + newborns.length >= config.populationCap) return;
    if (agent.energy < config.reproductionThreshold || this.random.next() >= config.reproductionProbability) return;
    const birthCells = this.neighbors(agent, 1).filter((position) => !occupied.has(this.positionKey(position)));
    if (birthCells.length === 0) return;
    const position = birthCells[this.random.integer(birthCells.length)];
    const childEnergy = agent.energy * (config.id === 'rabbit' ? 0.4 : 0.42);
    agent.energy -= childEnergy;
    const child = this.createAgent(config.id, position, childEnergy);
    newborns.push(child);
    occupied.set(this.positionKey(position), child);
    this.stats.births[config.id] = (this.stats.births[config.id] ?? 0) + 1;
  }

  private recordMetric(intervention = false): PopulationMetric {
    let forestTotal = 0;
    for (const stage of this.forest) forestTotal += stage;
    const maximumForest = this.forest.length * this.parameters.forestMaxStage;
    const metric: PopulationMetric = {
      step: this.stepNumber,
      rabbits: this.agents.rabbit.length,
      wolves: this.agents.wolf.length,
      tertiary: this.agents.tertiary.length,
      quaternary: this.agents.quaternary.length,
      forestPercent: maximumForest === 0 ? 0 : (forestTotal / maximumForest) * 100,
      forestAbundance: forestTotal,
    };
    if (this.runtimeSpecies.has('fox')) metric.fox = this.agents.fox?.length ?? 0;
    // Preserve every existing sample at the intervention boundary, including its
    // pre-action count. The next ordinary tick resumes the existing rolling window.
    this.history.push(metric);
    if (!intervention && this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
    return metric;
  }
}
