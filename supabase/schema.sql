-- Apex Survival 중앙 leaderboard 스키마
-- Supabase 프로젝트의 SQL Editor에 붙여넣어 한 번 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 권한 모델 요약
--   원본 테이블 apex_leaderboard : 학생(anon)은 INSERT만. 그것도 지정된 열에만.
--                                  SELECT/UPDATE/DELETE 전부 없음.
--   공개 view apex_leaderboard_public : 학생은 SELECT만. 공개해도 되는 열만 담고,
--                                       학생 한 명당 최고 기록 1행만 냅니다.
--
-- parameter_snapshot과 payload_hash는 원본 테이블에만 있고, 학생 키로는 원본 테이블을
-- 어떤 방식으로도 읽을 수 없으므로 select=* 로도 가져올 수 없습니다.
--
-- 시각 열 두 가지를 구분합니다.
--   submitted_at : 서버의 default now()로만 채워집니다. 학생 요청은 이 열에 INSERT 권한이
--                  없으므로 값을 지정할 수 없습니다. 공개 기록판이 보여 주는 제출 시각이며
--                  동점 tie-break 기준입니다. 즉 순위 공정성은 전적으로 서버 시계를 따릅니다.
--   achieved_at  : 학생 브라우저가 잰 도전 완료 시각. 참고용 메타데이터일 뿐이며 공개 view에
--                  포함되지 않고 순위 계산에도 쓰이지 않습니다.
--
-- 학생 식별 기준
--   student_number 하나입니다. student_name은 기록판에 보여 주기 위한 표시 정보이며
--   동일인 판정에 쓰지 않습니다. 같은 학번으로 이름을 조금 다르게 적어 제출해도 같은
--   학생으로 봅니다.
--   비교 전에 앞뒤 공백 정리 + 연속 공백 축약 + 소문자화를 거칩니다. 이는 클라이언트
--   participantKey() (src/leaderboard.ts)의 규칙과 같습니다.
--   학번은 자릿수나 숫자 형식을 강제하지 않고 문자열로 다룹니다. 학번 체계가 바뀌어도
--   스키마를 고치지 않아도 되게 하기 위한 것입니다.

-- ---------------------------------------------------------------------------
-- 1. 원본 테이블
-- ---------------------------------------------------------------------------

create table if not exists public.apex_leaderboard (
  id                 uuid primary key default gen_random_uuid(),
  challenge_id       text        not null,
  simulation_version text        not null,
  seed               integer     not null,
  score              integer     not null,
  parameter_snapshot jsonb       not null,
  -- 학생 고유 식별자. 형식은 강제하지 않습니다.
  student_number     text        not null,
  student_name       text        not null,
  -- 학생이 보내는 값. 참고용 메타데이터이며 순위에는 쓰지 않습니다.
  achieved_at        timestamptz not null,
  -- 실제 제출 시각. 서버 now()로만 채워지며 학생 INSERT는 이 열을 지정할 수 없습니다
  -- (아래 2번의 열 단위 GRANT 참고). 공개 제출 시각이자 동점 정렬 기준입니다.
  submitted_at       timestamptz not null default now(),
  payload_hash       text        not null,
  -- 5단계(server-side verification)에서 채워질 열입니다. 지금은 항상 기본값으로 남습니다.
  verification       text        not null default 'unverified',
  verified_score     integer,
  verified_at        timestamptz,
  verifier_version   text,
  created_at         timestamptz not null default now(),

  constraint apex_leaderboard_score_range   check (score between 0 and 1000000),
  constraint apex_leaderboard_number_length check (char_length(student_number) between 1 and 24),
  constraint apex_leaderboard_name_length   check (char_length(student_name) between 1 and 16),
  constraint apex_leaderboard_hash_format   check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint apex_leaderboard_verification  check (verification in ('unverified', 'verified', 'rejected'))
);

-- 이 스크립트를 예전 버전으로 이미 한 번 실행했다면 위 create table 은 아무 일도 하지 않으므로
-- 열을 따로 추가해 줍니다. 이미 있으면 조용히 넘어갑니다.
alter table public.apex_leaderboard
  add column if not exists submitted_at timestamptz not null default now();

-- class_label -> student_number 이름 변경. rename 이므로 저장된 값이 그대로 따라옵니다.
-- 열을 새로 만들고 복사한 뒤 예전 열을 DROP 하는 방식이 아니므로 데이터가 사라질 여지가
-- 없습니다. 인덱스와 제약도 Postgres가 알아서 새 이름을 따라갑니다.
-- 이미 student_number 인 설치본에서는 아무 일도 하지 않습니다.
do $migrate$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'apex_leaderboard' and column_name = 'class_label'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'apex_leaderboard' and column_name = 'student_number'
  ) then
    -- 공개 view가 예전 열 이름에 의존하므로 먼저 내립니다. 아래에서 새 정의로 다시 만듭니다.
    drop view if exists public.apex_leaderboard_public;
    alter table public.apex_leaderboard rename column class_label to student_number;
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.apex_leaderboard'::regclass and conname = 'apex_leaderboard_class_length'
  ) then
    alter table public.apex_leaderboard
      rename constraint apex_leaderboard_class_length to apex_leaderboard_number_length;
  end if;
end
$migrate$;

-- 정렬 기준이 achieved_at에서 submitted_at으로 바뀌었으므로 예전 인덱스를 지우고 다시 만듭니다.
drop index if exists public.apex_leaderboard_ranking_idx;
create index apex_leaderboard_ranking_idx
  on public.apex_leaderboard (challenge_id, simulation_version, seed, score desc, submitted_at asc);

-- 같은 학생이 완전히 같은 제출을 두 번 등록하지 못하게 막습니다.
--
-- payload_hash 는 canonicalScorePayload() (src/leaderboard.ts) 의 SHA-256 이며 다음만 담습니다.
--   challengeId, simulationVersion, seed, score, parameterSnapshot
-- 학번도 이름도 시각도 들어가지 않습니다. 시뮬레이션이 seed 결정론적이므로 "같은 파라미터
-- = 같은 점수 = 같은 해시" 이고, 따라서 같은 해시란 곧 "같은 도전을 그대로 다시 낸 것"입니다.
-- 파라미터나 점수가 조금이라도 다른 진짜 새 도전은 해시가 달라져 그대로 여러 행 남습니다.
--
-- 식별 요소는 student_number 뿐입니다. student_name 은 표시용이므로 빠졌습니다. 예전
-- 정의에는 student_name 이 들어 있어서, 같은 학번의 학생이 이름 표기만 바꿔 같은 기록을
-- 다시 낼 수 있었습니다. 그 구멍을 막는 것이 이번 변경입니다.
--
-- challenge_id / simulation_version / seed 는 payload_hash 안에 이미 들어 있으므로 유일성에
-- 보태는 것은 없습니다. 인덱스의 적용 범위를 눈으로 읽을 수 있게 남겨 둔 것입니다.
--
-- 예전 정의(student_name 포함)를 지우고 다시 만듭니다. drop 이 먼저라 재실행해도 안전합니다.
drop index if exists public.apex_leaderboard_dedupe_idx;

-- 아래 create 가 실패하면 원인이 무엇인지 바로 알 수 있도록 먼저 확인합니다. 이 블록은
-- 읽기만 하며 아무것도 지우지 않습니다. 정리 여부는 사람이 판단할 몫입니다.
do $dedupe_guard$
declare
  duplicate_groups integer;
begin
  select count(*) into duplicate_groups from (
    select 1
    from public.apex_leaderboard
    group by challenge_id, simulation_version, seed, student_number, payload_hash
    having count(*) > 1
  ) as duplicated;

  if duplicate_groups > 0 then
    raise exception using
      errcode = 'unique_violation',
      message = format('학번 기준 중복 제출 %s묶음이 남아 있어 인덱스를 만들 수 없습니다.', duplicate_groups),
      hint = '아래 쿼리로 확인한 뒤 남길 행만 두고 정리하고 다시 실행하세요: '
        || 'select challenge_id, simulation_version, seed, student_number, payload_hash, count(*), array_agg(id) '
        || 'from public.apex_leaderboard group by 1,2,3,4,5 having count(*) > 1;';
  end if;
end
$dedupe_guard$;

create unique index apex_leaderboard_dedupe_idx
  on public.apex_leaderboard (challenge_id, simulation_version, seed, student_number, payload_hash);

alter table public.apex_leaderboard enable row level security;

-- ---------------------------------------------------------------------------
-- 2. 원본 테이블 권한 — 학생은 INSERT만
-- ---------------------------------------------------------------------------

-- Supabase는 public 스키마의 새 테이블에 anon/authenticated 전체 권한을 기본 부여합니다.
-- 먼저 전부 회수한 뒤 INSERT만 되돌려 줍니다.
revoke all on table public.apex_leaderboard from anon, authenticated;

-- 테이블 전체가 아니라 열을 지정해서 INSERT를 허용합니다. 목록에 없는
-- submitted_at / created_at / verification / verified_* 는 학생 요청이 값을 넣을 수 없고
-- 서버 기본값만 들어갑니다. 학생이 개발자 도구에서 submitted_at을 직접 실어 보내면
-- PostgREST가 42501 permission denied 로 거절합니다. 즉 제출 시각 위조가 불가능합니다.
grant insert (
  challenge_id,
  simulation_version,
  seed,
  score,
  parameter_snapshot,
  student_number,
  student_name,
  achieved_at,
  payload_hash
) on table public.apex_leaderboard to anon, authenticated;

-- 예전 버전에서 만들었던 공개 읽기 정책이 있으면 제거합니다. 이 정책이 남아 있으면
-- 권한을 회수해도 나중에 실수로 GRANT SELECT가 붙는 순간 다시 새어 나갑니다.
drop policy if exists apex_leaderboard_read on public.apex_leaderboard;

-- 쓰기: 이번 challenge 정의와 일치하고 검증 열을 건드리지 않는 행의 INSERT만 허용합니다.
-- achieved_at 범위 검사는 말도 안 되는 값을 걸러 내기 위한 위생 검사일 뿐입니다. 순위는
-- 이 값이 아니라 서버가 채우는 submitted_at으로 매기므로, 학생이 achieved_at을 조작해도
-- 기록판 순서에는 영향을 주지 못합니다.
-- UPDATE / DELETE 정책이 없으므로 학생 키로는 기존 기록을 고치거나 지울 수 없습니다.
-- (관리용 service_role key는 RLS를 우회하므로 절대 클라이언트에 넣지 마세요.)
drop policy if exists apex_leaderboard_insert on public.apex_leaderboard;
create policy apex_leaderboard_insert
  on public.apex_leaderboard
  for insert
  to anon, authenticated
  with check (
    challenge_id = 'apex-survival'
    and simulation_version = 'apex-v1'
    and seed = 260903
    and verification = 'unverified'
    and verified_score is null
    and verified_at is null
    and verifier_version is null
    and achieved_at between now() - interval '1 day' and now() + interval '1 hour'
  );

-- ---------------------------------------------------------------------------
-- 3. 공개 view — 학생이 읽을 수 있는 유일한 창구
-- ---------------------------------------------------------------------------

-- security_invoker 를 명시적으로 false 로 둡니다(Postgres 기본값이지만 의존하지 않습니다).
--   false = 이 view는 소유자(postgres) 권한으로 원본 테이블을 읽습니다.
--           학생에게 원본 테이블 SELECT 권한이 없어도 view가 동작합니다.
--   true  = 호출자(anon) 권한으로 읽습니다. 그러면 원본 테이블 SELECT 권한이 필요해지고,
--           그 권한을 주는 순간 select=* 로 parameter_snapshot이 다시 노출됩니다.
--
-- 소유자 권한으로 읽는다는 것은 원본 테이블의 RLS도 우회한다는 뜻입니다. 여기서는
-- 기록판이 원래 전체 공개이므로 의도한 동작이며, 노출 범위는 아래 SELECT 목록이
-- 그대로 상한이 됩니다. view에 없는 열은 어떤 요청으로도 꺼낼 수 없습니다.
-- 학생(= student_number) 한 명당 최고 기록 1행만 냅니다. 원본 테이블에는 모든 제출이 그대로 남지만,
-- 학생 키로 볼 수 있는 것은 이 view 뿐이므로 "누가 몇 번 시도했고 예전 점수가 얼마였는지"는
-- 공개 API로 드러나지 않습니다. 시도 횟수 자체가 활동 중에는 알 필요 없는 정보입니다.
--
-- distinct on 을 씁니다. 같은 결과를 window function으로도 만들 수 있지만, distinct on 은
-- "정렬해서 각 그룹의 첫 행만" 이라는 의도가 한 줄에 그대로 드러나고 중간 서브쿼리가
-- 하나 덜 필요해서 이 스키마에서는 이쪽이 더 명확합니다.
--
-- 대표 기록 선택 순서는 score desc → submitted_at asc → id asc 입니다. 같은 학생이 같은
-- 최고점을 여러 번 냈다면 먼저 서버에 도착한 기록이 대표가 되고, 그것마저 같으면 id로
-- 결정론적으로 끊습니다.
drop view if exists public.apex_leaderboard_public;
create view public.apex_leaderboard_public
with (security_invoker = false) as
select distinct on (challenge_id, simulation_version, seed, participant_key)
  id,
  challenge_id,
  simulation_version,
  seed,
  score,
  student_number,
  student_name,
  -- 서버가 채운 제출 시각만 공개합니다. 학생이 보낸 achieved_at은 일부러 뺐습니다.
  -- 목록에 없으면 클라이언트가 어떤 요청으로도 꺼낼 수 없고, TypeScript 타입에도
  -- 존재하지 않으므로 화면 코드가 실수로 참조하면 컴파일 단계에서 걸립니다.
  submitted_at
from (
  -- participant_key는 여기서만 쓰고 위 select 목록에는 넣지 않습니다. 공개 열 목록을
  -- 늘리지 않으려는 것이며, distinct on 은 대상 식을 select 목록에 요구하지 않습니다.
  -- student_name은 들어가지 않습니다. 같은 학번이면 이름 표기가 달라도 한 학생입니다.
  select
    base.*,
    lower(regexp_replace(btrim(base.student_number), '\s+', ' ', 'g')) as participant_key
  from public.apex_leaderboard as base
) as normalized
order by
  challenge_id,
  simulation_version,
  seed,
  participant_key,
  score desc,
  submitted_at asc,
  id asc;

-- 검증 상태(verification)를 기록판에 보여 주고 싶어지면 위 목록에 한 줄 추가하면 됩니다.
-- 클라이언트는 이미 그 열이 오면 배지를 그리고, 없으면 그리지 않도록 되어 있습니다.
-- verified_score / verified_at / verifier_version 은 교사용이므로 넣지 마세요.

alter view public.apex_leaderboard_public owner to postgres;

revoke all on table public.apex_leaderboard_public from anon, authenticated;
grant select on table public.apex_leaderboard_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. 제출 빈도 제한
-- ---------------------------------------------------------------------------

-- security definer 이므로 학생에게 원본 테이블 SELECT 권한이 없어도 동작합니다.
create or replace function public.apex_leaderboard_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.apex_leaderboard
    where student_number = new.student_number
      and created_at > now() - interval '1 minute'
  ) >= 10 then
    raise exception '기록 제출이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists apex_leaderboard_rate_limit_trigger on public.apex_leaderboard;
create trigger apex_leaderboard_rate_limit_trigger
  before insert on public.apex_leaderboard
  for each row execute function public.apex_leaderboard_rate_limit();

-- ---------------------------------------------------------------------------
-- 5. PostgREST 스키마 캐시 갱신
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
