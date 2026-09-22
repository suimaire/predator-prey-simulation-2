-- Manual cutover ONLY, after the v2 frontend and endpoint are confirmed ready.
do $finalize_guard$
begin
  if to_regclass('public.apex_leaderboard_public_v2') is null then
    raise exception 'Expand/v2 endpoint must be ready before finalize';
  end if;
  if to_regclass('public.apex_leaderboard_public') is not null
    and current_setting('apex.frontend_v2_confirmed', true) is distinct from 'yes' then
    raise exception 'Confirm deployed v2 frontend before manual finalize';
  end if;
end
$finalize_guard$;
alter table public.apex_leaderboard alter column school_name drop default;
alter table public.apex_leaderboard alter column school_key drop default;
-- No CASCADE. Unknown dependent views/RPCs must be reviewed, then closed explicitly.
drop view if exists public.apex_leaderboard_public;
