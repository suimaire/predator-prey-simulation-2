export type Species = 'rabbit' | 'wolf';

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
  initialRabbits: number;
  initialWolves: number;
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
}

export interface CumulativeStats {
  rabbitBirths: number;
  wolfBirths: number;
  rabbitDeaths: number;
  wolfDeaths: number;
  rabbitsHunted: number;
  forestEaten: number;
}

export interface PopulationMetric {
  step: number;
  rabbits: number;
  wolves: number;
  forestPercent: number;
}

export interface SimulationSnapshot {
  width: number;
  height: number;
  maxForestStage: number;
  forest: Uint8Array;
  rabbits: readonly Agent[];
  wolves: readonly Agent[];
  step: number;
  stats: Readonly<CumulativeStats>;
}

export const DEFAULT_PARAMETERS: Readonly<SimulationParameters> = Object.freeze({
  gridColumns: 32,
  initialRabbits: 50,
  initialWolves: 8,
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
});

const HISTORY_LIMIT = 480;

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function whole(value: number, minimum: number, maximum: number): number {
  return Math.round(clamp(value, minimum, maximum));
}

export function validateParameters(input: SimulationParameters): SimulationParameters {
  return {
    gridColumns: whole(input.gridColumns, 20, 48),
    initialRabbits: whole(input.initialRabbits, 0, 400),
    initialWolves: whole(input.initialWolves, 0, 160),
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
  };
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

  constructor(seed: string) {
    this.state = seedToUint32(seed);
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 4294967296;
  }

  integer(maximumExclusive: number): number {
    return Math.floor(this.next() * maximumExclusive);
  }

  shuffle<T>(items: T[]): T[] {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swapIndex = this.integer(index + 1);
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    return items;
  }
}

interface Position {
  x: number;
  y: number;
}

function emptyStats(): CumulativeStats {
  return {
    rabbitBirths: 0,
    wolfBirths: 0,
    rabbitDeaths: 0,
    wolfDeaths: 0,
    rabbitsHunted: 0,
    forestEaten: 0,
  };
}

export class ForestSimulation {
  private parameters: SimulationParameters;
  private random: SeededRandom;
  private forest: Uint8Array = new Uint8Array();
  private rabbits: Agent[] = [];
  private wolves: Agent[] = [];
  private width = 0;
  private height = 0;
  private stepNumber = 0;
  private nextAgentId = 1;
  private stats: CumulativeStats = emptyStats();
  private history: PopulationMetric[] = [];

  constructor(parameters: SimulationParameters = { ...DEFAULT_PARAMETERS }) {
    this.parameters = validateParameters(parameters);
    this.random = new SeededRandom(this.parameters.seed);
    this.reset(this.parameters);
  }

  reset(parameters: SimulationParameters = this.parameters): void {
    this.parameters = validateParameters(parameters);
    this.random = new SeededRandom(this.parameters.seed);
    this.width = this.parameters.gridColumns;
    this.height = Math.max(14, Math.round(this.width * 0.67));
    this.forest = new Uint8Array(this.width * this.height);
    this.rabbits = [];
    this.wolves = [];
    this.stepNumber = 0;
    this.nextAgentId = 1;
    this.stats = emptyStats();
    this.history = [];
    this.initializeForest();
    this.initializeAgents();
    this.recordMetric();
  }

  getParameters(): SimulationParameters {
    return { ...this.parameters };
  }

  getSnapshot(): SimulationSnapshot {
    return {
      width: this.width,
      height: this.height,
      maxForestStage: this.parameters.forestMaxStage,
      forest: this.forest,
      rabbits: this.rabbits,
      wolves: this.wolves,
      step: this.stepNumber,
      stats: this.stats,
    };
  }

  getHistory(): readonly PopulationMetric[] {
    return this.history;
  }

  step(): PopulationMetric {
    this.growForest();
    this.processRabbits();
    this.processWolves();
    this.stepNumber += 1;
    return this.recordMetric();
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
    const rabbitCount = Math.min(this.parameters.initialRabbits, positions.length);
    const wolfCount = Math.min(this.parameters.initialWolves, positions.length - rabbitCount);
    for (let index = 0; index < rabbitCount; index += 1) {
      const position = positions.pop();
      if (!position) break;
      this.rabbits.push(this.createAgent('rabbit', position, this.parameters.rabbitBreedEnergy * (0.55 + this.random.next() * 0.3)));
    }
    for (let index = 0; index < wolfCount; index += 1) {
      const position = positions.pop();
      if (!position) break;
      this.wolves.push(this.createAgent('wolf', position, this.parameters.wolfBreedEnergy * (0.52 + this.random.next() * 0.3)));
    }
  }

  private createAgent(species: Species, position: Position, energy: number): Agent {
    return {
      id: this.nextAgentId++,
      species,
      x: position.x,
      y: position.y,
      energy,
      age: 0,
    };
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  private positionKey(position: Position): number {
    return this.index(position.x, position.y);
  }

  private occupiedMap(): Map<number, Agent> {
    const occupied = new Map<number, Agent>();
    for (const agent of this.rabbits) occupied.set(this.index(agent.x, agent.y), agent);
    for (const agent of this.wolves) occupied.set(this.index(agent.x, agent.y), agent);
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
        } else if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
          continue;
        }
        const position = { x, y };
        unique.set(this.positionKey(position), position);
      }
    }
    return [...unique.values()];
  }

  private growForest(): void {
    const { forestRegrowth, forestMaxStage } = this.parameters;
    for (let index = 0; index < this.forest.length; index += 1) {
      if (this.forest[index] < forestMaxStage && this.random.next() < forestRegrowth) {
        this.forest[index] += 1;
      }
    }
  }

  private processRabbits(): void {
    const occupied = this.occupiedMap();
    const dead = new Set<number>();
    const newborns: Agent[] = [];
    const ordered = this.random.shuffle([...this.rabbits]);

    for (const rabbit of ordered) {
      rabbit.age += 1;
      rabbit.energy -= this.parameters.rabbitEnergyCost;

      if (this.random.next() < this.parameters.rabbitMoveProbability) {
        const available = this.neighbors(rabbit, this.parameters.rabbitMoveDistance)
          .filter((position) => !occupied.has(this.positionKey(position)));
        if (available.length > 0) {
          const richest = Math.max(...available.map((position) => this.forest[this.positionKey(position)]));
          const preferred = available.filter((position) => this.forest[this.positionKey(position)] >= Math.max(1, richest - 1));
          const choices = preferred.length > 0 ? preferred : available;
          const destination = choices[this.random.integer(choices.length)];
          occupied.delete(this.index(rabbit.x, rabbit.y));
          rabbit.x = destination.x;
          rabbit.y = destination.y;
          occupied.set(this.index(rabbit.x, rabbit.y), rabbit);
        }
      }

      const cellIndex = this.index(rabbit.x, rabbit.y);
      if (this.forest[cellIndex] > 0) {
        this.forest[cellIndex] -= 1;
        rabbit.energy += this.parameters.rabbitFoodEnergy;
        this.stats.forestEaten += 1;
      }

      if (rabbit.energy >= this.parameters.rabbitBreedEnergy && this.random.next() < this.parameters.rabbitBreedProbability) {
        const birthCells = this.neighbors(rabbit, 1).filter((position) => !occupied.has(this.positionKey(position)));
        if (birthCells.length > 0) {
          const position = birthCells[this.random.integer(birthCells.length)];
          const childEnergy = rabbit.energy * 0.4;
          rabbit.energy *= 0.6;
          const child = this.createAgent('rabbit', position, childEnergy);
          newborns.push(child);
          occupied.set(this.positionKey(position), child);
          this.stats.rabbitBirths += 1;
        }
      }

      if (rabbit.energy <= 0 || rabbit.age >= this.parameters.rabbitMaxAge) {
        dead.add(rabbit.id);
        occupied.delete(this.index(rabbit.x, rabbit.y));
        this.stats.rabbitDeaths += 1;
      }
    }

    this.rabbits = this.rabbits.filter((rabbit) => !dead.has(rabbit.id));
    this.rabbits.push(...newborns);
  }

  private processWolves(): void {
    const occupied = this.occupiedMap();
    const deadWolves = new Set<number>();
    const huntedRabbits = new Set<number>();
    const newborns: Agent[] = [];
    const ordered = this.random.shuffle([...this.wolves]);

    for (const wolf of ordered) {
      wolf.age += 1;
      wolf.energy -= this.parameters.wolfEnergyCost;
      const nearby = this.neighbors(wolf, this.parameters.wolfMoveDistance);
      const preyCells = nearby.filter((position) => {
        const occupant = occupied.get(this.positionKey(position));
        return occupant?.species === 'rabbit' && !huntedRabbits.has(occupant.id);
      });

      if (preyCells.length > 0) {
        const destination = preyCells[this.random.integer(preyCells.length)];
        const prey = occupied.get(this.positionKey(destination));
        if (prey?.species === 'rabbit') {
          huntedRabbits.add(prey.id);
          occupied.delete(this.index(wolf.x, wolf.y));
          wolf.x = destination.x;
          wolf.y = destination.y;
          occupied.set(this.positionKey(destination), wolf);
          wolf.energy += this.parameters.wolfFoodEnergy;
          this.stats.rabbitsHunted += 1;
          this.stats.rabbitDeaths += 1;
        }
      } else if (this.random.next() < this.parameters.wolfMoveProbability) {
        const available = nearby.filter((position) => !occupied.has(this.positionKey(position)));
        if (available.length > 0) {
          const destination = available[this.random.integer(available.length)];
          occupied.delete(this.index(wolf.x, wolf.y));
          wolf.x = destination.x;
          wolf.y = destination.y;
          occupied.set(this.positionKey(destination), wolf);
        }
      }

      if (wolf.energy >= this.parameters.wolfBreedEnergy && this.random.next() < this.parameters.wolfBreedProbability) {
        const birthCells = this.neighbors(wolf, 1).filter((position) => !occupied.has(this.positionKey(position)));
        if (birthCells.length > 0) {
          const position = birthCells[this.random.integer(birthCells.length)];
          const childEnergy = wolf.energy * 0.42;
          wolf.energy *= 0.58;
          const child = this.createAgent('wolf', position, childEnergy);
          newborns.push(child);
          occupied.set(this.positionKey(position), child);
          this.stats.wolfBirths += 1;
        }
      }

      if (wolf.energy <= 0 || wolf.age >= this.parameters.wolfMaxAge) {
        deadWolves.add(wolf.id);
        occupied.delete(this.index(wolf.x, wolf.y));
        this.stats.wolfDeaths += 1;
      }
    }

    this.rabbits = this.rabbits.filter((rabbit) => !huntedRabbits.has(rabbit.id));
    this.wolves = this.wolves.filter((wolf) => !deadWolves.has(wolf.id));
    this.wolves.push(...newborns);
  }

  private recordMetric(): PopulationMetric {
    let forestTotal = 0;
    for (const stage of this.forest) forestTotal += stage;
    const maximumForest = this.forest.length * this.parameters.forestMaxStage;
    const metric = {
      step: this.stepNumber,
      rabbits: this.rabbits.length,
      wolves: this.wolves.length,
      forestPercent: maximumForest === 0 ? 0 : (forestTotal / maximumForest) * 100,
    };
    this.history.push(metric);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    return metric;
  }
}
