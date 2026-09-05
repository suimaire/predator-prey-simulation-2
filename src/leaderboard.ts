import { APEX_CHALLENGE_CONFIG, type ChallengeDefinition, type ChallengeRecord } from './challenge.ts';
import type { SimulationParameters } from './model.ts';

export type VerificationStatus = 'unverified' | 'verified' | 'rejected';

/**
 * 학번이 학생의 고유 식별자입니다. 이름은 기록판에 보여 주기 위한 표시 정보이며
 * 동일인 판정에는 쓰지 않습니다(참조: participantKey).
 */
export interface Participant {
  studentNumber: string;
  studentName: string;
}

/** 학생 브라우저가 서버로 보내는 값. parameterSnapshot과 payloadHash는 여기에만 존재합니다. */
export interface LeaderboardSubmission extends ChallengeRecord<SimulationParameters> {
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
  studentNumber: string;
  studentName: string;
  /**
   * 서버가 INSERT 시점에 default now()로 채운 실제 제출 시각입니다. 학생 요청은 이 열을
   * 지정할 수 없으므로 공개 제출 시각과 동점 정렬 기준으로 안전하게 쓸 수 있습니다.
   * 학생이 보낸 achieved_at은 공개 view에 없으므로 이 타입에도 존재하지 않습니다.
   */
  submittedAt: string;
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

/**
 * 학번은 자릿수나 숫자 형식을 강제하지 않습니다. 학번 체계가 바뀔 수 있으므로 문자열로
 * 다루고, 앞뒤 공백 정리 · 빈 값 금지 · 최대 길이 · 위험 문자 배제만 검사합니다.
 */
export const PARTICIPANT_LIMITS = Object.freeze({ studentNumber: 24, studentName: 16 });
/** 기본 표시 인원. 마지막 자리와 동점인 학생이 더 있으면 그 학생들까지 함께 보여 줍니다. */
export const DEFAULT_LEADERBOARD_LIMIT = 10;

/** 공개 view가 노출하는 열 전체. 이 목록 밖의 열은 학생 브라우저가 읽을 수 없습니다. */
export const PUBLIC_LEADERBOARD_COLUMNS: readonly string[] = Object.freeze([
  'id',
  'challenge_id',
  'simulation_version',
  'seed',
  'score',
  'student_number',
  'student_name',
  'submitted_at',
]);

const PARTICIPANT_PATTERN = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ()·._-]+$/u;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export function normalizeParticipant(input: Participant): Participant {
  return {
    studentNumber: collapseWhitespace(input.studentNumber),
    studentName: collapseWhitespace(input.studentName),
  };
}

export type ParticipantValidation =
  | { ok: true; participant: Participant }
  | { ok: false; message: string };

export function validateParticipant(input: Participant): ParticipantValidation {
  const participant = normalizeParticipant(input);
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

/**
 * 동일인 판정 기준은 학번 하나입니다. 같은 학번으로 이름을 조금 다르게 적어 제출해도
 * 같은 학생으로 봅니다. 서버의 공개 view도 같은 규칙(학번 정규화 후 그룹)으로 접습니다.
 */
export function participantKey(participant: Participant): string {
  return normalizeParticipant(participant).studentNumber.toLocaleLowerCase('ko');
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

function compareEntries(left: LeaderboardEntry, right: LeaderboardEntry): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.submittedAt !== right.submittedAt) return left.submittedAt < right.submittedAt ? -1 : 1;
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
  /**
   * 학생별 최고 기록 1개로 접습니다. 공개 view가 서버에서 이미 접어서 보내 주지만,
   * 다른 백엔드를 끼우거나 view가 잘못 배포된 경우에도 화면에 같은 학생이 두 번
   * 나오지 않도록 클라이언트에서 한 번 더 접습니다.
   */
  collapseToBest?: boolean;
  limit?: number;
}

/**
 * 마지막 자리와 점수가 같은 학생은 잘라 내지 않고 함께 남깁니다. 10위가 842점인데
 * 11위와 12위도 842점이라면 12명을 돌려줍니다. 같은 점수인데 화면에 누구는 있고
 * 누구는 없는 상태를 만들지 않기 위한 것입니다.
 */
function sliceWithTies(ranked: readonly RankedLeaderboardEntry[], limit: number): RankedLeaderboardEntry[] {
  if (limit <= 0) return [];
  if (ranked.length <= limit) return [...ranked];
  const cutoffScore = ranked[limit - 1]!.score;
  let end = limit;
  while (end < ranked.length && ranked[end]!.score === cutoffScore) end += 1;
  return ranked.slice(0, end);
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
  return sliceWithTies(ranked, limit);
}

/**
 * 상위 3위에만 붙는 장식용 클래스입니다. 표시 순서가 아니라 rank 값으로 판정하므로
 * 동점으로 같은 rank를 나눠 가진 학생은 모두 같은 테두리를 받습니다(1, 1, 3이면 금 · 금 · 동).
 * 색은 장식일 뿐이고 순위 정보 자체는 계속 숫자로 함께 표시합니다.
 */
export function rankAccentClass(rank: number): string {
  if (rank === 1) return 'rank-gold';
  if (rank === 2) return 'rank-silver';
  if (rank === 3) return 'rank-bronze';
  return '';
}

export interface SupabaseLeaderboardConfig {
  url: string;
  /** publishable key(구 anon key). apikey 헤더로만 나갑니다. */
  anonKey: string;
  /**
   * 나중에 Supabase Auth 로그인을 붙였을 때 발급되는 사용자 access token(JWT)입니다.
   * 값이 있을 때만 Authorization: Bearer 헤더를 붙입니다. publishable key는 JWT가
   * 아니므로 이 자리에 넣지 마세요.
   */
  accessToken?: string;
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
  student_number: string;
  student_name: string;
  submitted_at: string;
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
    studentNumber: row.student_number,
    studentName: row.student_name,
    submittedAt: row.submitted_at,
  };
  if (VERIFICATION_VALUES.includes(row.verification as VerificationStatus)) {
    entry.verification = row.verification as VerificationStatus;
  }
  return entry;
}

/**
 * 제출 payload. submitted_at / created_at / verification / verified_* 는 일부러 넣지 않습니다.
 * 서버가 열 단위 GRANT로 이 열들의 INSERT를 막고 있으므로 보내면 요청 자체가 거절됩니다.
 * achieved_at은 학생 브라우저가 잰 도전 완료 시각이며 순위 계산에는 쓰이지 않습니다.
 */
function toRow(submission: LeaderboardSubmission): Record<string, unknown> {
  return {
    challenge_id: submission.challengeId,
    simulation_version: submission.simulationVersion,
    seed: submission.seed,
    score: submission.score,
    parameter_snapshot: submission.parameterSnapshot,
    student_number: submission.studentNumber,
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
  // 익명 요청에는 publishable key를 apikey 헤더로만 보냅니다. sb_publishable_ key는 JWT가
  // 아니므로 Authorization: Bearer 자리에 넣지 않습니다. 로그인 사용자가 생기면 그때 발급되는
  // 실제 access token(JWT)만 Authorization으로 보냅니다.
  const headers: Record<string, string> = {
    apikey: config.anonKey,
    'Content-Type': 'application/json',
  };
  const accessToken = config.accessToken?.trim();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  return {
    name: 'supabase',
    async list(query: LeaderboardQuery = {}): Promise<LeaderboardEntry[]> {
      // 공개 view가 이미 학생별 최고 기록 1행만 내므로 여기서 받는 행 수는 곧 학생 수입니다.
      // 표시 인원보다 넉넉히 받아 두어야 마지막 자리 동점자까지 빠짐없이 계산할 수 있습니다.
      const limit = query.limit ?? DEFAULT_LEADERBOARD_LIMIT * 5;
      const search = new URLSearchParams({
        select: PUBLIC_LEADERBOARD_COLUMNS.join(','),
        challenge_id: `eq.${definition.id}`,
        simulation_version: `eq.${definition.simulationVersion}`,
        seed: `eq.${definition.seed}`,
        order: 'score.desc,submitted_at.asc',
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
