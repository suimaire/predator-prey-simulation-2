import { APEX_CHALLENGE_CONFIG, type ChallengeDefinition, type ChallengeRecord } from './challenge.ts';
import type { SimulationParameters } from './model.ts';

export type VerificationStatus = 'unverified' | 'verified' | 'rejected';

export interface Participant {
  classLabel: string;
  studentName: string;
}

/** 학생 브라우저가 서버로 보내는 값. parameterSnapshot과 payloadHash는 여기에만 존재합니다. */
export interface LeaderboardSubmission extends ChallengeRecord<SimulationParameters> {
  classLabel: string;
  studentName: string;
  payloadHash: string;
}

/**
 * 학생 브라우저가 서버에서 읽을 수 있는 값. 공개 view가 제공하는 열만 담습니다.
 * parameterSnapshot과 payloadHash는 의도적으로 없으며, 타입에도 존재하지 않으므로
 * 화면 코드가 실수로 참조하면 컴파일 단계에서 걸립니다.
 */
export interface LeaderboardEntry {
  id: string;
  challengeId: string;
  simulationVersion: string;
  seed: number;
  score: number;
  classLabel: string;
  studentName: string;
  achievedAt: string;
  /** 공개 view가 검증 상태를 내보내기로 한 경우에만 존재합니다. */
  verification?: VerificationStatus;
}

export interface RankedLeaderboardEntry extends LeaderboardEntry {
  rank: number;
}

export interface LeaderboardQuery {
  limit?: number;
}

/**
 * 저장소 교체 지점. Supabase REST 대신 다른 백엔드를 붙이거나
 * 테스트에서 메모리 구현으로 바꿔 끼울 수 있습니다.
 *
 * 읽기와 쓰기가 서로 다른 대상을 향합니다. 읽기는 공개 view, 쓰기는 원본 테이블입니다.
 * submit이 아무것도 돌려주지 않는 것은 의도적입니다. 삽입한 행을 되돌려받으려면
 * 원본 테이블 SELECT 권한이 필요한데, 그 권한을 회수하는 것이 이 구조의 핵심입니다.
 */
export interface LeaderboardTransport {
  readonly name: string;
  list(query?: LeaderboardQuery): Promise<LeaderboardEntry[]>;
  submit(submission: LeaderboardSubmission): Promise<void>;
}

export const PARTICIPANT_LIMITS = Object.freeze({ classLabel: 24, studentName: 16 });
export const DEFAULT_LEADERBOARD_LIMIT = 20;

/** 공개 view가 노출하는 열 전체. 이 목록 밖의 열은 학생 브라우저가 읽을 수 없습니다. */
export const PUBLIC_LEADERBOARD_COLUMNS: readonly string[] = Object.freeze([
  'id',
  'challenge_id',
  'simulation_version',
  'seed',
  'score',
  'class_label',
  'student_name',
  'achieved_at',
]);

const PARTICIPANT_PATTERN = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ()·._-]+$/u;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export function normalizeParticipant(input: Participant): Participant {
  return {
    classLabel: collapseWhitespace(input.classLabel),
    studentName: collapseWhitespace(input.studentName),
  };
}

export type ParticipantValidation =
  | { ok: true; participant: Participant }
  | { ok: false; message: string };

export function validateParticipant(input: Participant): ParticipantValidation {
  const participant = normalizeParticipant(input);
  if (!participant.classLabel) return { ok: false, message: '학급 또는 학번을 입력해 주세요.' };
  if (!participant.studentName) return { ok: false, message: '이름을 입력해 주세요.' };
  if (participant.classLabel.length > PARTICIPANT_LIMITS.classLabel) {
    return { ok: false, message: `학급 또는 학번은 ${PARTICIPANT_LIMITS.classLabel}자 이내로 입력해 주세요.` };
  }
  if (participant.studentName.length > PARTICIPANT_LIMITS.studentName) {
    return { ok: false, message: `이름은 ${PARTICIPANT_LIMITS.studentName}자 이내로 입력해 주세요.` };
  }
  if (!PARTICIPANT_PATTERN.test(participant.classLabel) || !PARTICIPANT_PATTERN.test(participant.studentName)) {
    return { ok: false, message: '한글, 영문, 숫자와 . · - _ ( ) 기호만 사용할 수 있습니다.' };
  }
  return { ok: true, participant };
}

export function participantKey(participant: Participant): string {
  const normalized = normalizeParticipant(participant);
  return `${normalized.classLabel.toLocaleLowerCase('ko')}::${normalized.studentName.toLocaleLowerCase('ko')}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = canonicalize(source[key]);
    return sorted;
  }
  return value;
}

/**
 * 서버가 재실행으로 검증할 때 필요한 값만 정규화합니다. 학생 이름처럼
 * 점수 계산과 무관한 값은 포함하지 않으므로, 이름을 고쳐도 해시는 그대로입니다.
 */
export function canonicalScorePayload(record: ChallengeRecord<SimulationParameters>): string {
  return JSON.stringify(canonicalize({
    challengeId: record.challengeId,
    simulationVersion: record.simulationVersion,
    seed: record.seed,
    score: record.score,
    parameterSnapshot: record.parameterSnapshot,
  }));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function subtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('이 환경에서는 제출 해시를 계산할 수 없습니다. HTTPS 주소에서 열어 주세요.');
  return subtle;
}

export async function computePayloadHash(
  record: ChallengeRecord<SimulationParameters>,
  subtle: SubtleCrypto = subtleCrypto(),
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalScorePayload(record));
  return toHex(await subtle.digest('SHA-256', bytes));
}

export async function createSubmission(
  record: ChallengeRecord<SimulationParameters>,
  participant: Participant,
  subtle: SubtleCrypto = subtleCrypto(),
): Promise<LeaderboardSubmission> {
  const validation = validateParticipant(participant);
  if (!validation.ok) throw new Error(validation.message);
  return {
    ...record,
    parameterSnapshot: { ...record.parameterSnapshot },
    classLabel: validation.participant.classLabel,
    studentName: validation.participant.studentName,
    payloadHash: await computePayloadHash(record, subtle),
  };
}

export async function submissionMatchesScore(
  submission: LeaderboardSubmission,
  subtle: SubtleCrypto = subtleCrypto(),
): Promise<boolean> {
  return submission.payloadHash === await computePayloadHash(submission, subtle);
}

function compareEntries(left: LeaderboardEntry, right: LeaderboardEntry): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.achievedAt !== right.achievedAt) return left.achievedAt < right.achievedAt ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function bestPerParticipant(entries: readonly LeaderboardEntry[]): LeaderboardEntry[] {
  const best = new Map<string, LeaderboardEntry>();
  for (const entry of entries) {
    const key = participantKey(entry);
    const previous = best.get(key);
    if (!previous || compareEntries(entry, previous) < 0) best.set(key, entry);
  }
  return [...best.values()];
}

export interface RankOptions {
  collapseToBest?: boolean;
  limit?: number;
}

/** 동점은 같은 순위를 공유하고 다음 순위는 건너뜁니다(1, 1, 3). */
export function rankEntries(
  entries: readonly LeaderboardEntry[],
  { collapseToBest = true, limit = DEFAULT_LEADERBOARD_LIMIT }: RankOptions = {},
): RankedLeaderboardEntry[] {
  const pool = collapseToBest ? bestPerParticipant(entries) : [...entries];
  pool.sort(compareEntries);
  const ranked: RankedLeaderboardEntry[] = [];
  let rank = 0;
  let previousScore: number | null = null;
  for (const [index, entry] of pool.entries()) {
    if (previousScore === null || entry.score !== previousScore) rank = index + 1;
    previousScore = entry.score;
    ranked.push({ ...entry, rank });
  }
  return ranked.slice(0, limit);
}

export interface SupabaseLeaderboardConfig {
  url: string;
  anonKey: string;
  /** 제출(INSERT) 대상 원본 테이블. 학생은 이 테이블을 읽을 수 없습니다. */
  table?: string;
  /** 조회(SELECT) 대상 공개 view. 기본값은 `${table}_public` 입니다. */
  publicView?: string;
  definition?: ChallengeDefinition;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface PublicLeaderboardRow {
  id: string;
  challenge_id: string;
  simulation_version: string;
  seed: number;
  score: number;
  class_label: string;
  student_name: string;
  achieved_at: string;
  verification?: VerificationStatus | null;
}

const VERIFICATION_VALUES: readonly VerificationStatus[] = ['unverified', 'verified', 'rejected'];

function toEntry(row: PublicLeaderboardRow): LeaderboardEntry {
  const entry: LeaderboardEntry = {
    id: String(row.id),
    challengeId: row.challenge_id,
    simulationVersion: row.simulation_version,
    seed: Number(row.seed),
    score: Number(row.score),
    classLabel: row.class_label,
    studentName: row.student_name,
    achievedAt: row.achieved_at,
  };
  if (VERIFICATION_VALUES.includes(row.verification as VerificationStatus)) {
    entry.verification = row.verification as VerificationStatus;
  }
  return entry;
}

function toRow(submission: LeaderboardSubmission): Record<string, unknown> {
  return {
    challenge_id: submission.challengeId,
    simulation_version: submission.simulationVersion,
    seed: submission.seed,
    score: submission.score,
    parameter_snapshot: submission.parameterSnapshot,
    class_label: submission.classLabel,
    student_name: submission.studentName,
    achieved_at: submission.achievedAt,
    payload_hash: submission.payloadHash,
  };
}

async function describeFailure(response: Response): Promise<string> {
  const fallback = `leaderboard 요청이 실패했습니다. (HTTP ${response.status})`;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string' && message) return message;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function createSupabaseLeaderboardTransport(
  config: SupabaseLeaderboardConfig,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): LeaderboardTransport {
  const definition = config.definition ?? APEX_CHALLENGE_CONFIG;
  const table = config.table ?? 'apex_leaderboard';
  const publicView = config.publicView ?? `${table}_public`;
  const restRoot = `${config.url.replace(/\/+$/u, '')}/rest/v1`;
  const headers: Record<string, string> = {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
    'Content-Type': 'application/json',
  };

  return {
    name: 'supabase',
    async list(query: LeaderboardQuery = {}): Promise<LeaderboardEntry[]> {
      const limit = query.limit ?? DEFAULT_LEADERBOARD_LIMIT * 5;
      const search = new URLSearchParams({
        select: PUBLIC_LEADERBOARD_COLUMNS.join(','),
        challenge_id: `eq.${definition.id}`,
        simulation_version: `eq.${definition.simulationVersion}`,
        seed: `eq.${definition.seed}`,
        order: 'score.desc,achieved_at.asc',
        limit: String(limit),
      });
      const response = await fetchImpl(`${restRoot}/${publicView}?${search.toString()}`, { method: 'GET', headers });
      if (!response.ok) throw new Error(await describeFailure(response));
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error('leaderboard 응답 형식을 이해할 수 없습니다.');
      return (rows as PublicLeaderboardRow[]).map(toEntry);
    },
    async submit(submission: LeaderboardSubmission): Promise<void> {
      // return=minimal: 삽입한 행을 되돌려받지 않습니다. 되돌려받으려면 원본 테이블
      // SELECT 권한이 필요한데, 그 권한이 없어야 parameter_snapshot이 보호됩니다.
      const response = await fetchImpl(`${restRoot}/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(toRow(submission)),
      });
      if (!response.ok) throw new Error(await describeFailure(response));
    },
  };
}

export interface LeaderboardEnvironment {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  table?: string;
  publicView?: string;
}

/** 환경 변수가 없으면 null을 돌려주고, 앱은 leaderboard 없이 그대로 동작합니다. */
export function createLeaderboardTransport(
  environment: LeaderboardEnvironment,
  fetchImpl?: FetchLike,
): LeaderboardTransport | null {
  const url = environment.supabaseUrl?.trim();
  const anonKey = environment.supabaseAnonKey?.trim();
  if (!url || !anonKey) return null;
  return createSupabaseLeaderboardTransport({
    url,
    anonKey,
    table: environment.table?.trim() || undefined,
    publicView: environment.publicView?.trim() || undefined,
  }, fetchImpl);
}

export function participantStorageKey(definition: ChallengeDefinition = APEX_CHALLENGE_CONFIG): string {
  return `rabbits-wolves:${definition.id}:participant`;
}
