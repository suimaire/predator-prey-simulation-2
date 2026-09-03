import {
  validateParameters,
  type FoodChainDepth,
  type PopulationMetric,
  type SimulationParameters,
  type Species,
} from './model.ts';

export type ChallengePhase = 'setup' | 'active' | 'over';
export type RequiredTrophicLevel = 'vegetation' | Species;

export interface ChallengeDefinition {
  id: string;
  name: string;
  simulationVersion: string;
  seed: number;
  foodChainDepth: FoodChainDepth;
  requiredLevels: readonly RequiredTrophicLevel[];
}

export interface TrophicLevelStatus {
  level: RequiredTrophicLevel;
  label: string;
  present: boolean;
  value: number;
  unit: '성장 단계 합' | '개체';
}

export interface ChallengeState {
  phase: ChallengePhase;
  score: number;
  collapseStep: number | null;
  collapsedLevels: readonly RequiredTrophicLevel[];
  levelStatus: readonly TrophicLevelStatus[];
  parameterSnapshot: Readonly<SimulationParameters> | null;
}

export interface ChallengeRecord<TParameters = SimulationParameters> {
  challengeId: string;
  simulationVersion: string;
  score: number;
  seed: number;
  parameterSnapshot: Readonly<TParameters>;
  achievedAt: string;
}

export type ApexSurvivalRecord = ChallengeRecord<SimulationParameters>;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const APEX_CHALLENGE_CONFIG: Readonly<ChallengeDefinition> = Object.freeze({
  id: 'apex-survival',
  name: 'Apex Survival',
  simulationVersion: 'apex-v1',
  seed: 260903,
  foodChainDepth: 4,
  requiredLevels: Object.freeze(['vegetation', 'rabbit', 'wolf', 'tertiary', 'quaternary'] as const),
});

const LEVEL_LABELS: Readonly<Record<RequiredTrophicLevel, string>> = Object.freeze({
  vegetation: '식생',
  rabbit: '토끼',
  wolf: '늑대',
  tertiary: '3차 소비자',
  quaternary: '4차 소비자',
});

function populationForLevel(metric: PopulationMetric, level: RequiredTrophicLevel): number {
  if (level === 'vegetation') return metric.forestAbundance;
  if (level === 'rabbit') return metric.rabbits;
  if (level === 'wolf') return metric.wolves;
  if (level === 'tertiary') return metric.tertiary;
  return metric.quaternary;
}

export function apexParameters(parameters: SimulationParameters): SimulationParameters {
  return validateParameters({
    ...parameters,
    foodChainDepth: APEX_CHALLENGE_CONFIG.foodChainDepth,
    seed: String(APEX_CHALLENGE_CONFIG.seed),
  });
}

export function evaluateApexLevels(metric: PopulationMetric): TrophicLevelStatus[] {
  return APEX_CHALLENGE_CONFIG.requiredLevels.map((level) => ({
    level,
    label: LEVEL_LABELS[level],
    present: populationForLevel(metric, level) > 0,
    value: populationForLevel(metric, level),
    unit: level === 'vegetation' ? '성장 단계 합' : '개체',
  }));
}

export function challengeSettingsLocked(state: Readonly<ChallengeState>): boolean {
  return state.phase === 'active' || state.phase === 'over';
}

function initialState(): ChallengeState {
  return {
    phase: 'setup',
    score: 0,
    collapseStep: null,
    collapsedLevels: [],
    levelStatus: [],
    parameterSnapshot: null,
  };
}

export class ApexChallengeSession {
  private state: ChallengeState = initialState();

  getState(): Readonly<ChallengeState> { return this.state; }

  start(parameters: SimulationParameters, initialMetric: PopulationMetric): boolean {
    const parameterSnapshot = Object.freeze({ ...apexParameters(parameters) });
    const levelStatus = evaluateApexLevels(initialMetric);
    const collapsedLevels = levelStatus.filter((level) => !level.present).map((level) => level.level);
    if (collapsedLevels.length > 0 || initialMetric.step !== 0) {
      this.state = { ...initialState(), levelStatus, parameterSnapshot };
      return false;
    }
    this.state = {
      phase: 'active',
      score: 0,
      collapseStep: null,
      collapsedLevels: [],
      levelStatus,
      parameterSnapshot,
    };
    return true;
  }

  acceptStep(metric: PopulationMetric): boolean {
    if (this.state.phase !== 'active') return false;
    const expectedStep = this.state.score + 1;
    if (metric.step !== expectedStep) throw new Error(`Apex Survival은 logical step을 순서대로 평가해야 합니다. expected ${expectedStep}, received ${metric.step}`);
    const levelStatus = evaluateApexLevels(metric);
    const collapsedLevels = levelStatus.filter((level) => !level.present).map((level) => level.level);
    if (collapsedLevels.length > 0) {
      this.state = {
        ...this.state,
        phase: 'over',
        collapseStep: metric.step,
        collapsedLevels,
        levelStatus,
      };
      return true;
    }
    this.state = { ...this.state, score: metric.step, levelStatus };
    return false;
  }

  returnToSetup(): void {
    this.state = {
      ...initialState(),
      parameterSnapshot: this.state.parameterSnapshot,
    };
  }
}

export function createApexRecord(state: Readonly<ChallengeState>, achievedAt = new Date().toISOString()): ApexSurvivalRecord {
  if (state.phase !== 'over' || !state.parameterSnapshot) throw new Error('완료된 Apex Survival 도전만 기록할 수 있습니다.');
  return {
    challengeId: APEX_CHALLENGE_CONFIG.id,
    simulationVersion: APEX_CHALLENGE_CONFIG.simulationVersion,
    score: state.score,
    seed: APEX_CHALLENGE_CONFIG.seed,
    parameterSnapshot: { ...state.parameterSnapshot },
    achievedAt,
  };
}

export function personalBestStorageKey(definition: ChallengeDefinition = APEX_CHALLENGE_CONFIG): string {
  return `rabbits-wolves:${definition.id}:${definition.simulationVersion}:personal-best`;
}

function isApexRecord(value: unknown): value is ApexSurvivalRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ApexSurvivalRecord>;
  return record.challengeId === APEX_CHALLENGE_CONFIG.id
    && record.simulationVersion === APEX_CHALLENGE_CONFIG.simulationVersion
    && record.seed === APEX_CHALLENGE_CONFIG.seed
    && Number.isInteger(record.score)
    && Number(record.score) >= 0
    && typeof record.achievedAt === 'string'
    && Boolean(record.parameterSnapshot && typeof record.parameterSnapshot === 'object');
}

export function loadApexPersonalBest(storage: KeyValueStorage): ApexSurvivalRecord | null {
  try {
    const serialized = storage.getItem(personalBestStorageKey());
    if (!serialized) return null;
    const parsed: unknown = JSON.parse(serialized);
    return isApexRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveApexPersonalBest(
  storage: KeyValueStorage,
  record: ApexSurvivalRecord,
): { best: ApexSurvivalRecord; isNewBest: boolean } {
  const previous = loadApexPersonalBest(storage);
  if (previous && previous.score >= record.score) return { best: previous, isNewBest: false };
  storage.setItem(personalBestStorageKey(), JSON.stringify(record));
  return { best: record, isNewBest: true };
}
