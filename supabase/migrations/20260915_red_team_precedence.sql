-- HAFS AI RED TEAM 우선 규칙 — 공개 기록판 view만 교체
--
-- 적용 대상: 이미 supabase/schema.sql 로 두 보드(board_group) 구조가 설치된 프로젝트.
-- Supabase SQL Editor 에 붙여넣어 실행합니다. 여러 번 실행해도 안전합니다.
-- 테이블 · 행 · 인덱스 · 권한 · RLS 정책은 건드리지 않습니다. DROP 은 한 줄도 없습니다.
-- 새로 설치하는 프로젝트는 이 파일 대신 schema.sql 을 실행하면 같은 view 가 만들어집니다.
--
-- 바뀌는 동작
--   같은 기록판 범위(challenge_id, simulation_version, seed) 안에서 board_group = 'manipulator'
--   기록이 하나라도 있는 학생(participant_key)은 'protector' 행이 공개 view에서 전부 빠집니다.
--   즉 그 학생은 HAFS AI RED TEAM 에만 나오고 생태 HAFS 보호단에는 나오지 않습니다.
--   원본 행은 지우거나 바꾸지 않습니다. 교사가 그 학생의 'manipulator' 지정을 모두 되돌리면
--   남아 있던 'protector' 기록이 다시 보호단에 나옵니다. 별도 명단 테이블은 없습니다.
--
-- 그대로인 것
--   공개 열 9개와 순서, hidden 제외, 보드별 학번당 최고 기록 1행(score desc → submitted_at asc → id asc),
--   participant_key 정규화 규칙(클라이언트 participantKey() 와 같음), security_invoker = false.
--
-- create or replace view 는 열 이름 · 순서 · 타입이 기존 view와 같을 때만 성공하며,
-- 소유자와 GRANT 를 그대로 유지합니다. 아래 권한 문장은 확인 차원에서 다시 적은 것입니다.

create or replace view public.apex_leaderboard_public
with (security_invoker = false) as
with normalized as (
  select
    base.*,
    lower(regexp_replace(btrim(base.student_number), '\s+', ' ', 'g')) as participant_key
  from public.apex_leaderboard as base
  where base.board_group <> 'hidden'
)
select distinct on (challenge_id, simulation_version, seed, board_group, participant_key)
  id,
  challenge_id,
  simulation_version,
  seed,
  score,
  student_number,
  student_name,
  submitted_at,
  board_group
from normalized
where normalized.board_group = 'manipulator'
  or not exists (
    select 1
    from normalized as red_team
    where red_team.board_group = 'manipulator'
      and red_team.challenge_id = normalized.challenge_id
      and red_team.simulation_version = normalized.simulation_version
      and red_team.seed = normalized.seed
      and red_team.participant_key = normalized.participant_key
  )
order by
  challenge_id,
  simulation_version,
  seed,
  board_group,
  participant_key,
  score desc,
  submitted_at asc,
  id asc;

alter view public.apex_leaderboard_public owner to postgres;

revoke all on table public.apex_leaderboard_public from anon, authenticated;
grant select on table public.apex_leaderboard_public to anon, authenticated;

notify pgrst, 'reload schema';
