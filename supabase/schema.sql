-- Apex Survival 중앙 leaderboard 스키마
-- Supabase 프로젝트의 SQL Editor에 붙여넣어 한 번 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 권한 모델 요약
--   원본 테이블 apex_leaderboard : 학생(anon)은 INSERT만. SELECT/UPDATE/DELETE 전부 없음.
--   공개 view apex_leaderboard_public : 학생은 SELECT만. 공개해도 되는 열만 담습니다.
--
-- parameter_snapshot과 payload_hash는 원본 테이블에만 있고, 학생 키로는 원본 테이블을
-- 어떤 방식으로도 읽을 수 없으므로 select=* 로도 가져올 수 없습니다.

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
  class_label        text        not null,
  student_name       text        not null,
  achieved_at        timestamptz not null,
  payload_hash       text        not null,
  -- 5단계(server-side verification)에서 채워질 열입니다. 지금은 항상 기본값으로 남습니다.
  verification       text        not null default 'unverified',
  verified_score     integer,
  verified_at        timestamptz,
  verifier_version   text,
  created_at         timestamptz not null default now(),

  constraint apex_leaderboard_score_range   check (score between 0 and 1000000),
  constraint apex_leaderboard_class_length  check (char_length(class_label) between 1 and 24),
  constraint apex_leaderboard_name_length   check (char_length(student_name) between 1 and 16),
  constraint apex_leaderboard_hash_format   check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint apex_leaderboard_verification  check (verification in ('unverified', 'verified', 'rejected'))
);

create index if not exists apex_leaderboard_ranking_idx
  on public.apex_leaderboard (challenge_id, simulation_version, seed, score desc, achieved_at asc);

-- 같은 학생이 같은 점수를 중복 제출해도 기록판이 지저분해지지 않도록 막습니다.
create unique index if not exists apex_leaderboard_dedupe_idx
  on public.apex_leaderboard (challenge_id, simulation_version, seed, class_label, student_name, payload_hash);

alter table public.apex_leaderboard enable row level security;

-- ---------------------------------------------------------------------------
-- 2. 원본 테이블 권한 — 학생은 INSERT만
-- ---------------------------------------------------------------------------

-- Supabase는 public 스키마의 새 테이블에 anon/authenticated 전체 권한을 기본 부여합니다.
-- 먼저 전부 회수한 뒤 INSERT만 되돌려 줍니다.
revoke all on table public.apex_leaderboard from anon, authenticated;
grant insert on table public.apex_leaderboard to anon, authenticated;

-- 예전 버전에서 만들었던 공개 읽기 정책이 있으면 제거합니다. 이 정책이 남아 있으면
-- 권한을 회수해도 나중에 실수로 GRANT SELECT가 붙는 순간 다시 새어 나갑니다.
drop policy if exists apex_leaderboard_read on public.apex_leaderboard;

-- 쓰기: 이번 challenge 정의와 일치하고 검증 열을 건드리지 않는 행의 INSERT만 허용합니다.
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
drop view if exists public.apex_leaderboard_public;
create view public.apex_leaderboard_public
with (security_invoker = false) as
select
  id,
  challenge_id,
  simulation_version,
  seed,
  score,
  class_label,
  student_name,
  achieved_at
from public.apex_leaderboard;

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
    where class_label = new.class_label
      and student_name = new.student_name
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
