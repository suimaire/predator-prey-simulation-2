export type Species = 'rabbit' | 'wolf' | 'tertiary' | 'quaternary';
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
  trophicLevel: 1 | 2 | 3 | 4;
  preyType: FoodSource;
  initialPopulation: number;
  movement: { probability: number; distance: number };
  basalEnergyCost: number;
  reproductionThreshold: number;
  reproductionProbability: number;
  nominalFoodGainAtTenPercent: number;
  maxAge: number;
}

export interface CumulativeStats {
  births: Record<Species, number>;
  deaths: Record<Species, number>;
  feedingEvents: Record<Species, number>;
  forestEaten: number;
}

export interface PopulationMetric {
  step: number;
  rabbits: number;
  wolves: number;
  tertiary: number;
  quaternary: number;
  forestPercent: number;
  forestAbundance: number;
}

export interface Intervention {
  step: number;
  species: Species;
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
  agents: Readonly<Record<Species, readonly Agent[]>>;
  rabbits: readonly Agent[];
  wolves: readonly Agent[];
  tertiary: readonly Agent[];
  quaternary: readonly Agent[];
  step: number;
  stats: Readonly<CumulativeStats>;
  removedSpecies: readonly Species[];
  interventions: readonly Intervention[];
}

export const SPECIES_ORDER: readonly Species[] = ['rabbit', 'wolf', 'tertiary', 'quaternary'];
export const SPECIES_LABELS: Readonly<Record<Species, string>> = Object.freeze({
  rabbit: '토끼',
  wolf: '늑대',
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
    initialRabbits: whole(input.initialRabbits, 0, 400),
    initialWolves: whole(input.initialWolves, 0, 160),
    initialTertiary: whole(input.initialTertiary, 0, 40),
    initialQuaternary: whole(input.initialQuaternary, 0, 20),
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

export function activeSpecies(depth: FoodChainDepth): Species[] {
  return SPECIES_ORDER.slice(0, depth);
}

export function speciesConfigs(parameters: SimulationParameters): Readonly<Record<Species, SpeciesConfig>> {
  return {
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

function emptySpeciesRecord(): Record<Species, number> {
  return { rabbit: 0, wolf: 0, tertiary: 0, quaternary: 0 };
}

function emptyStats(): CumulativeStats {
  return { births: emptySpeciesRecord(), deaths: emptySpeciesRecord(), feedingEvents: emptySpeciesRecord(), forestEaten: 0 };
}

function emptyAgents(): Record<Species, Agent[]> {
  return { rabbit: [], wolf: [], tertiary: [], quaternary: [] };
}

export class ForestSimulation {
  private parameters: SimulationParameters;
  private configs: Readonly<Record<Species, SpeciesConfig>>;
  private random: SeededRandom;
  private forest: Uint8Array = new Uint8Array();
  private agents: Record<Species, Agent[]> = emptyAgents();
  private width = 0;
  private height = 0;
  private stepNumber = 0;
  private nextAgentId = 1;
  private stats: CumulativeStats = emptyStats();
  private history: PopulationMetric[] = [];
  private removed = new Set<Species>();
  private interventions: Intervention[] = [];
  private feedingLog: FeedingEvent[] = [];

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
    this.interventions = [];
    this.feedingLog = [];
    this.initializeForest();
    this.initializeAgents();
    this.recordMetric();
  }

  getParameters(): SimulationParameters { return { ...this.parameters }; }
  getHistory(): readonly PopulationMetric[] { return this.history; }
  getInterventions(): readonly Intervention[] { return this.interventions; }

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
    for (const species of activeSpecies(this.parameters.foodChainDepth).slice(1)) {
      if (!this.removed.has(species)) this.processPredator(species);
    }
    this.stepNumber += 1;
    return this.recordMetric();
  }

  removeSpecies(species: Species): boolean {
    if (!activeSpecies(this.parameters.foodChainDepth).includes(species) || this.removed.has(species)) return false;
    this.agents[species] = [];
    this.removed.add(species);
    this.interventions.push({ step: this.stepNumber, species });
    this.recordMetric(true);
    return true;
  }

  getEnergyFlow(window = 20): readonly EnergyFlowMetric[] {
    const safeWindow = whole(window, 1, HISTORY_LIMIT);
    const firstStep = Math.max(0, this.stepNumber - safeWindow + 1);
    const elapsed = Math.max(1, Math.min(safeWindow, this.stepNumber || 1));
    const totals = new Map<string, { source: FoodSource; target: Species; energy: number; count: number }>();
    for (const species of activeSpecies(this.parameters.foodChainDepth)) {
      const config = this.configs[species];
      totals.set(`${config.preyType}:${species}`, { source: config.preyType, target: species, energy: 0, count: 0 });
    }
    for (const event of this.feedingLog) {
      if (event.step < firstStep) continue;
      const item = totals.get(`${event.source}:${event.target}`);
      if (item) { item.energy += event.energy; item.count += 1; }
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

  private initializeForest(): void {
    const target = (this.parameters.initialForestDensity / 100) * this.parameters.forestMaxStage;
    for (let index = 0; index < this.forest.length; index += 1) {
      const variation = (this.random.next() - 0.5) * 2.4;
      this.forest[index] = whole(target + variation, 0, this.parameters.forestMaxStage);
    }
  }

  private initializeAgents(): void {
    const positions: Position[] = [];
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) positions.push({ x, y });
    }
    this.random.shuffle(positions);
    for (const species of activeSpecies(this.parameters.foodChainDepth)) {
      const config = this.configs[species];
      const count = Math.min(config.initialPopulation, positions.length);
      for (let index = 0; index < count; index += 1) {
        const position = positions.pop();
        if (!position) break;
        const initialFraction = species === 'wolf' ? 0.52 : 0.55;
        const energy = config.reproductionThreshold * (initialFraction + this.random.next() * 0.3);
        this.agents[species].push(this.createAgent(species, position, energy));
      }
    }
  }

  private createAgent(species: Species, position: Position, energy: number): Agent {
    return { id: this.nextAgentId++, species, x: position.x, y: position.y, energy, age: 0 };
  }

  private index(x: number, y: number): number { return y * this.width + x; }
  private positionKey(position: Position): number { return this.index(position.x, position.y); }

  private occupiedMap(): Map<number, Agent> {
    const occupied = new Map<number, Agent>();
    for (const species of activeSpecies(this.parameters.foodChainDepth)) {
      for (const agent of this.agents[species]) occupied.set(this.index(agent.x, agent.y), agent);
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
    this.stats.feedingEvents[target] += 1;
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

      const cellIndex = this.index(rabbit.x, rabbit.y);
      if (this.forest[cellIndex] > 0) {
        this.forest[cellIndex] -= 1;
        rabbit.energy += this.recordFeeding('vegetation', 'rabbit', config.nominalFoodGainAtTenPercent);
        this.stats.forestEaten += 1;
      }

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
    const ordered = this.random.shuffle([...this.agents[species]]);

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
          this.stats.deaths[preySpecies] += 1;
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
        this.stats.deaths[species] += 1;
      }
    }
    this.agents[preySpecies] = this.agents[preySpecies].filter((agent) => !hunted.has(agent.id));
    this.agents[species] = this.agents[species].filter((agent) => !dead.has(agent.id));
    this.agents[species].push(...newborns);
  }

  private tryReproduce(agent: Agent, config: SpeciesConfig, occupied: Map<number, Agent>, newborns: Agent[]): void {
    if (this.removed.has(config.id)) return;
    if (agent.energy < config.reproductionThreshold || this.random.next() >= config.reproductionProbability) return;
    const birthCells = this.neighbors(agent, 1).filter((position) => !occupied.has(this.positionKey(position)));
    if (birthCells.length === 0) return;
    const position = birthCells[this.random.integer(birthCells.length)];
    const childEnergy = agent.energy * (config.id === 'rabbit' ? 0.4 : 0.42);
    agent.energy -= childEnergy;
    const child = this.createAgent(config.id, position, childEnergy);
    newborns.push(child);
    occupied.set(this.positionKey(position), child);
    this.stats.births[config.id] += 1;
  }

  private recordMetric(replaceSameStep = false): PopulationMetric {
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
    if (replaceSameStep && this.history.at(-1)?.step === this.stepNumber) this.history[this.history.length - 1] = metric;
    else this.history.push(metric);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    return metric;
  }
}
