import { APEX_CHALLENGE_CONFIG, type ChallengeDefinition, type ChallengeRecord } from './challenge.ts';
import type { SimulationParameters } from './model.ts';

/** Teacher-managed classification; hidden records never leave the public view. */
export type BoardGroup = 'protector' | 'manipulator';
export const BOARD_GROUPS: readonly BoardGroup[] = Object.freeze(['protector', 'manipulator']);
export type LeaderboardScope = 'national' | 'hafs';
export const LEADERBOARD_SCOPES: readonly LeaderboardScope[] = Object.freeze(['national', 'hafs']);

/**
 * Private submission input only. The DB resolves school + student number identity.
 */
export interface Participant {
  schoolName: string;
  studentNumber: string;
  studentName: string;
}

/** 학생 브라우저가 서버로 보내는 값. parameterSnapshot과 payloadHash는 여기에만 존재합니다. */
export interface LeaderboardSubmission extends ChallengeRecord<SimulationParameters> {
  schoolName: string;
  studentNumber: string;
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
  schoolName: string;
  displayName: string;
  /**
   * 서버가 INSERT 시점에 default now()로 채운 실제 제출 시각입니다. 학생 요청은 이 열을
   * 지정할 수 없으므로 공개 제출 시각과 동점 정렬 기준으로 안전하게 쓸 수 있습니다.
   * 학생이 보낸 achieved_at은 공개 view에 없으므로 이 타입에도 존재하지 않습니다.
   */
  submittedAt: string;
  /** 이 기록이 올라갈 기록판. 교사가 정한 값이며 학생 제출로는 바꿀 수 없습니다. */
  boardGroup: BoardGroup;
  isHafs: boolean;
}

export interface RankedLeaderboardEntry extends LeaderboardEntry {
  rank: number;
}

export interface LeaderboardQuery {
  /** Top positions plus every record tied at the boundary. */
  limit?: number;
  /** Default: protector. Each scope/board has independent request state. */
  boardGroup?: BoardGroup;
  scope?: LeaderboardScope;
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

/**
 * 학번은 자릿수나 숫자 형식을 강제하지 않습니다. 학번 체계가 바뀔 수 있으므로 문자열로
 * 다루고, 앞뒤 공백 정리 · 빈 값 금지 · 최대 길이 · 위험 문자 배제만 검사합니다.
 */
export const PARTICIPANT_LIMITS = Object.freeze({ schoolName: 80, studentNumber: 24, studentName: 16 });
/** 기본 표시 인원. 마지막 자리와 동점인 학생이 더 있으면 그 학생들까지 함께 보여 줍니다. */
export const DEFAULT_LEADERBOARD_LIMIT = 10;

/** 공개 view가 노출하는 열 전체. 이 목록 밖의 열은 학생 브라우저가 읽을 수 없습니다. */
export const PUBLIC_LEADERBOARD_COLUMNS: readonly string[] = Object.freeze([
  'id',
  'challenge_id',
  'simulation_version',
  'seed',
  'score',
  'school_name',
  'display_name',
  'submitted_at',
  'board_group',
  'is_hafs',
]);

const PARTICIPANT_PATTERN = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ()·._-]+$/u;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export function normalizeParticipant(input: Participant): Participant {
  return {
    schoolName: collapseWhitespace(input.schoolName),
    studentNumber: collapseWhitespace(input.studentNumber),
    studentName: collapseWhitespace(input.studentName),
  };
}

export type ParticipantValidation =
  | { ok: true; participant: Participant }
  | { ok: false; message: string };

export function validateParticipant(input: Participant): ParticipantValidation {
  const participant = normalizeParticipant(input);
  if (!participant.schoolName) return { ok: false, message: '학교명을 입력해 주세요' };
  // Unicode code points, matching PostgreSQL char_length. HTML input uses custom validity too.
  if ([...participant.schoolName].length > PARTICIPANT_LIMITS.schoolName) {
    return { ok: false, message: `학교명은 ${PARTICIPANT_LIMITS.schoolName}자 이내로 입력해 주세요.` };
  }
  if (!participant.studentNumber) return { ok: false, message: '학번을 입력해 주세요.' };
  if (!participant.studentName) return { ok: false, message: '이름을 입력해 주세요.' };
  if (participant.studentNumber.length > PARTICIPANT_LIMITS.studentNumber) {
    return { ok: false, message: `학번은 ${PARTICIPANT_LIMITS.studentNumber}자 이내로 입력해 주세요.` };
  }
  if (participant.studentName.length > PARTICIPANT_LIMITS.studentName) {
    return { ok: false, message: `이름은 ${PARTICIPANT_LIMITS.studentName}자 이내로 입력해 주세요.` };
  }
  if (!PARTICIPANT_PATTERN.test(participant.studentNumber) || !PARTICIPANT_PATTERN.test(participant.studentName)) {
    return { ok: false, message: '한글, 영문, 숫자와 . · - _ ( ) 기호만 사용할 수 있습니다.' };
  }
  return { ok: true, participant };
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
    schoolName: validation.participant.schoolName,
    studentNumber: validation.participant.studentNumber,
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

/** Preserve PostgreSQL microsecond ordering even for equivalent timezone offsets. */
function submittedMicros(value: string): bigint {
  const fraction = value.match(/\.(\d{1,6})/)?.[1] ?? '';
  return BigInt(Date.parse(value.replace(/\.\d+/, ''))) * 1000n + BigInt(fraction.padEnd(6, '0'));
}

function compareEntries(left: LeaderboardEntry, right: LeaderboardEntry): number {
  if (left.score !== right.score) return right.score - left.score;
  const leftTime = submittedMicros(left.submittedAt), rightTime = submittedMicros(right.submittedAt);
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export interface RankOptions { limit?: number }

/** The server already chose representatives. Never infer identity from masked names. */
export function rankEntries(
  entries: readonly LeaderboardEntry[],
  { limit = DEFAULT_LEADERBOARD_LIMIT }: RankOptions = {},
): RankedLeaderboardEntry[] {
  if (limit <= 0) return [];
  const pool = [...entries].sort(compareEntries);
  const cutoff = pool[limit - 1]?.score ?? -Infinity;
  let rank = 0;
  return pool.flatMap((entry, index) => {
    if (entry.score < cutoff) return [];
    if (index === 0 || entry.score !== pool[index - 1]!.score) rank = index + 1;
    return [{ ...entry, rank }];
  });
}

export type RankedBoards = Record<BoardGroup, RankedLeaderboardEntry[]>;
export function rankBoards(entries: readonly LeaderboardEntry[], options: RankOptions = {}): RankedBoards {
  return {
    protector: rankEntries(entries.filter(entry => entry.boardGroup === 'protector'), options),
    manipulator: rankEntries(entries.filter(entry => entry.boardGroup === 'manipulator'), options),
  };
}

export class LeaderboardError extends Error {}

export function rankAccentClass(rank: number): string {
  return rank === 1 ? 'rank-gold' : rank === 2 ? 'rank-silver' : rank === 3 ? 'rank-bronze' : '';
}

export interface SupabaseLeaderboardConfig {
  url: string;
  /** Publishable key goes in apikey, never substituted for a JWT. */
  anonKey: string;
  accessToken?: string;
  table?: string;
  /** Defaults to `${table}_public_v2`. Legacy overrides fail closed. */
  publicView?: string;
  definition?: ChallengeDefinition;
}
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function toRow(submission: LeaderboardSubmission): Record<string, unknown> {
  return {
    challenge_id: submission.challengeId, simulation_version: submission.simulationVersion,
    seed: submission.seed, score: submission.score, parameter_snapshot: submission.parameterSnapshot,
    school_name: submission.schoolName, student_number: submission.studentNumber, student_name: submission.studentName,
    achieved_at: submission.achievedAt, payload_hash: submission.payloadHash,
  };
}
const CONTRACT_ERROR = '기록판 응답 형식이 맞지 않습니다. 서버 준비 상태를 확인한 뒤 다시 시도해 주세요.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return false;
  if (!Number.isFinite(Date.parse(value))) return false;
  const day = new Date(value.slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value.slice(0, 10)
    && Number(value.slice(11,13)) < 24 && Number(value.slice(14,16)) < 60 && Number(value.slice(17,19)) < 60;
}
function publicString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && [...value].length <= max;
}

function toEntry(raw: unknown, boardGroup: BoardGroup, scope: LeaderboardScope, definition: ChallengeDefinition): LeaderboardEntry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new LeaderboardError(CONTRACT_ERROR);
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || !UUID.test(row.id)
    || !publicString(row.challenge_id, 200) || row.challenge_id !== definition.id
    || !publicString(row.simulation_version, 200) || row.simulation_version !== definition.simulationVersion
    || typeof row.seed !== 'number' || !Number.isInteger(row.seed) || row.seed < -2147483648 || row.seed > 2147483647 || row.seed !== definition.seed
    || typeof row.score !== 'number' || !Number.isInteger(row.score) || row.score < 0 || row.score > 1000000
    || !publicString(row.school_name, 80) || !publicString(row.display_name, 16)
    || !validTimestamp(row.submitted_at) || row.board_group !== boardGroup
    || typeof row.is_hafs !== 'boolean' || (scope === 'hafs' && !row.is_hafs)) {
    throw new LeaderboardError(CONTRACT_ERROR);
  }
  return { id: row.id, challengeId: row.challenge_id, simulationVersion: row.simulation_version,
    seed: row.seed, score: row.score, schoolName: row.school_name, displayName: row.display_name,
    submittedAt: row.submitted_at, boardGroup, isHafs: row.is_hafs };
}

async function describeFailure(response: Response, submission = false): Promise<LeaderboardError> {
  let code: unknown;
  try { code = ((await response.json()) as { code?: unknown })?.code; } catch { /* No raw server details in UI. */ }
  if (submission && code === '23505') return new LeaderboardError('이미 제출한 기록입니다.');
  if (submission && code === 'P0001') return new LeaderboardError('기록 제출이 너무 잦습니다. 잠시 후 다시 시도해 주세요.');
  if (submission && (code === '22023' || code === '23502')) return new LeaderboardError('학교명을 확인한 뒤 다시 제출해 주세요.');
  return new LeaderboardError(submission
    ? '기록을 제출하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    : '기록판을 불러오지 못했습니다. 서버 준비 상태를 확인하거나 잠시 후 새로고침해 주세요.');
}

export function createSupabaseLeaderboardTransport(
  config: SupabaseLeaderboardConfig,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): LeaderboardTransport {
  const definition = config.definition ?? APEX_CHALLENGE_CONFIG;
  const table = config.table ?? 'apex_leaderboard';
  const publicView = config.publicView ?? table + '_public_v2';
  const restRoot = config.url.replace(/\/+$/u, '') + '/rest/v1';
  const headers: Record<string, string> = { apikey: config.anonKey, 'Content-Type': 'application/json' };
  const accessToken = config.accessToken?.trim();
  if (accessToken) headers.Authorization = 'Bearer ' + accessToken;

  return {
    name: 'supabase',
    async list({ boardGroup = 'protector', scope = 'national', limit = DEFAULT_LEADERBOARD_LIMIT }: LeaderboardQuery = {}): Promise<LeaderboardEntry[]> {
      if (!BOARD_GROUPS.includes(boardGroup) || !LEADERBOARD_SCOPES.includes(scope) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new LeaderboardError('기록판 조회 설정이 올바르지 않습니다.');
      }
      // Fail closed when a deployment still overrides the endpoint with the private legacy view.
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*_public_v2$/u.test(publicView)) throw new LeaderboardError('공개 기록판 v2 설정이 필요합니다.');
      const collected = new Map<string, LeaderboardEntry>();
      let cursor: LeaderboardEntry | undefined;
      let cutoff: number | undefined;
      try {
        for (;;) {
          const search = new URLSearchParams({ select: PUBLIC_LEADERBOARD_COLUMNS.join(','),
            challenge_id: 'eq.' + definition.id, simulation_version: 'eq.' + definition.simulationVersion,
            seed: 'eq.' + definition.seed, board_group: 'eq.' + boardGroup,
            order: 'score.desc,submitted_at.asc,id.asc', limit: String(cutoff === undefined ? limit - collected.size : 50) });
          if (scope === 'hafs') search.set('is_hafs', 'eq.true');
          if (cutoff !== undefined) search.set('score', 'gte.' + cutoff);
          if (cursor) search.set('or', '(score.lt.' + cursor.score
            + ',and(score.eq.' + cursor.score + ',submitted_at.gt.' + cursor.submittedAt + ')'
            + ',and(score.eq.' + cursor.score + ',submitted_at.eq.' + cursor.submittedAt + ',id.gt.' + cursor.id + '))');
          const response = await fetchImpl(restRoot + '/' + publicView + '?' + search.toString(), { method: 'GET', headers, cache: 'no-store' });
          if (!response.ok) throw await describeFailure(response);
          const raw: unknown = await response.json();
          if (!Array.isArray(raw)) throw new LeaderboardError(CONTRACT_ERROR);
          if (!raw.length) break;
          const page = raw.map(row => toEntry(row, boardGroup, scope, definition));
          for (const [index, entry] of page.entries()) {
            if ((index > 0 && compareEntries(page[index - 1]!, entry) > 0) || (cutoff !== undefined && entry.score < cutoff)) throw new LeaderboardError(CONTRACT_ERROR);
            const previous = collected.get(entry.id);
            if (previous) {
              if (JSON.stringify(previous) !== JSON.stringify(entry)) throw new LeaderboardError(CONTRACT_ERROR);
              continue; // Network page overlap is not participant deduplication.
            }
            if (cursor && compareEntries(cursor, entry) >= 0) throw new LeaderboardError(CONTRACT_ERROR);
            collected.set(entry.id, entry);
          }
          const last = page.at(-1)!;
          if (cursor && compareEntries(cursor, last) >= 0) throw new LeaderboardError(CONTRACT_ERROR);
          cursor = last;
          if (collected.size >= limit) cutoff = [...collected.values()][limit - 1]!.score;
          // A short nonempty page may be the server's smaller max-rows setting. Keep going.
        }
        return rankEntries([...collected.values()], { limit }).map(({ rank: _rank, ...entry }) => entry);
      } catch (error) {
        if (error instanceof LeaderboardError) throw error;
        throw new LeaderboardError('기록판을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.');
      }
    },
    async submit(submission: LeaderboardSubmission): Promise<void> {
      try {
        const response = await fetchImpl(restRoot + '/' + table, { method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(toRow(submission)) });
        if (!response.ok) throw await describeFailure(response, true);
      } catch (error) {
        if (error instanceof LeaderboardError) throw error;
        throw new LeaderboardError('기록을 제출하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    },
  };
}

export interface LeaderboardEnvironment {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  table?: string;
  publicView?: string;
}

export function createLeaderboardTransport(environment: LeaderboardEnvironment, fetchImpl?: FetchLike): LeaderboardTransport | null {
  const url = environment.supabaseUrl?.trim(), anonKey = environment.supabaseAnonKey?.trim();
  if (!url || !anonKey) return null;
  return createSupabaseLeaderboardTransport({ url, anonKey,
    table: environment.table?.trim() || undefined, publicView: environment.publicView?.trim() || undefined }, fetchImpl);
}

export function participantStorageKey(definition: ChallengeDefinition = APEX_CHALLENGE_CONFIG): string {
  return `rabbits-wolves:${definition.id}:participant`;
}

/** Old saved participants keep their number/name, with an empty school until explicitly entered. */
export function loadParticipant(storage: Pick<Storage, 'getItem'>): Participant | null {
  try {
    const raw: unknown = JSON.parse(storage.getItem(participantStorageKey()) ?? 'null');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (typeof value.studentNumber !== 'string' || typeof value.studentName !== 'string'
      || (value.schoolName !== undefined && typeof value.schoolName !== 'string')) return null;
    return { schoolName: value.schoolName ?? '', studentNumber: value.studentNumber, studentName: value.studentName };
  } catch { return null; }
}
