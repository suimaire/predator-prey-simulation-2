import { apexParameters, type ChallengePhase } from './challenge.ts';
import { validateParameters, type SimulationParameters } from './model.ts';

export function sameParameters(a: SimulationParameters, b: SimulationParameters): boolean {
  return (Object.keys(a) as (keyof SimulationParameters)[]).every((key) => a[key] === b[key]);
}

export type DraftResult = { status: 'locked' | 'unchanged' | 'invalid'; message?: string }
  | { status: 'apply'; parameters: SimulationParameters; preserveResult: boolean };

/** A dialog owns its copy. Validation and the latest phase are checked again at commit time. */
export class ParameterDraft {
  value: SimulationParameters;
  constructor(source: SimulationParameters) { this.value = { ...source }; }

  prepare(current: SimulationParameters, mode: 'free' | 'apex', phase: ChallengePhase): DraftResult {
    if (mode === 'apex' && phase === 'active') return { status: 'locked' };
    const value = this.value;
    if (typeof value.seed !== 'string' || !value.seed.trim() || value.seed.length > 40
      || typeof value.toroidal !== 'boolean'
      || Object.values(value).some((item) => typeof item === 'number' && !Number.isFinite(item))) {
      return { status: 'invalid', message: '유효한 숫자와 1~40자의 seed를 입력하세요.' };
    }
    const normalized = validateParameters({ ...value, seed: value.seed.trim() });
    if (!sameParameters({ ...value, seed: value.seed.trim() }, normalized)
      || (mode === 'apex' && !sameParameters(normalized, apexParameters(normalized)))) {
      return { status: 'invalid', message: '설정 범위와 Apex의 고정 seed·먹이사슬 단계를 확인하세요.' };
    }
    if (sameParameters(normalized, current)) return { status: 'unchanged' };
    return { status: 'apply', parameters: normalized, preserveResult: mode === 'apex' && phase === 'over' };
  }
}
