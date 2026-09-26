-- Final NEW-install schema. A legacy database must use the reviewed expand migration.
do $installation_guard$
begin
  if to_regclass('public.apex_leaderboard_public') is not null or (to_regclass('public.apex_leaderboard') is not null
    and to_regclass('public.apex_leaderboard_public_v2') is null) then
    raise exception 'Existing legacy database: run preflight and approved expand, not schema.sql';
  end if;
end
$installation_guard$;
create table if not exists public.apex_leaderboard (
  id uuid primary key default gen_random_uuid(),
  challenge_id text not null,
  simulation_version text not null,
  seed integer not null,
  score integer not null,
  parameter_snapshot jsonb not null,
  student_number text not null,
  student_name text not null,
  achieved_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  payload_hash text not null,
  verification text not null default 'unverified',
  verified_score integer,
  verified_at timestamptz,
  verifier_version text,
  board_group text not null default 'protector',
  created_at timestamptz not null default now(),
  school_name text,
  school_key text,
  constraint apex_leaderboard_score_range check (score between 0 and 1000000),
  constraint apex_leaderboard_number_length check (char_length(student_number) between 1 and 24),
  constraint apex_leaderboard_name_length check (char_length(student_name) between 1 and 16),
  constraint apex_leaderboard_hash_format check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint apex_leaderboard_verification check (verification in ('unverified', 'verified', 'rejected')),
  constraint apex_leaderboard_board_group check (board_group in ('protector', 'manipulator', 'hidden'))
);
