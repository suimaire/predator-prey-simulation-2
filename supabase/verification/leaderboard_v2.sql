-- Read-only contract/ACL verification after expand and again after finalize. No student rows printed.
begin read only;
set local statement_timeout = '30s';
do $verify$
declare actual text[]; role_name text; col text; obj text;
begin
  select array_agg(attname::text order by attnum) into actual from pg_attribute
    where attrelid = 'public.apex_leaderboard_public_v2'::regclass and attnum > 0 and not attisdropped;
  if actual is distinct from array['id','challenge_id','simulation_version','seed','score','school_name',
    'display_name','submitted_at','board_group','is_hafs'] then raise exception 'Public projection mismatch'; end if;
  if exists (select 1 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
    where a.attrelid='public.apex_leaderboard'::regclass and a.attname in ('school_name','school_key')) then
    raise exception 'Temporary school defaults must be removed';
  end if;
  foreach role_name in array array['anon','authenticated'] loop
    if not has_table_privilege(role_name, 'public.apex_leaderboard_public_v2', 'SELECT') then raise exception 'v2 SELECT missing'; end if;
    if has_table_privilege(role_name, 'public.apex_leaderboard_public_v2', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Unexpected view write privileges'; end if;
    foreach obj in array array['apex_leaderboard','apex_schools','apex_school_aliases'] loop
      if has_table_privilege(role_name, 'public.' || obj, 'SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'Unexpected table privileges';
      end if;
      for col in select attname from pg_attribute where attrelid=('public.'||obj)::regclass and attnum>0 and not attisdropped loop
        if has_column_privilege(role_name, 'public.'||obj, col, 'SELECT,UPDATE,REFERENCES') then raise exception 'Unexpected column privileges'; end if;
        if (obj<>'apex_leaderboard' or col not in ('challenge_id','simulation_version','seed','score','parameter_snapshot',
          'school_name','student_number','student_name','achieved_at','payload_hash'))
          and has_column_privilege(role_name, 'public.'||obj, col, 'INSERT') then raise exception 'Unexpected INSERT privileges'; end if;
      end loop;
    end loop;
    if has_function_privilege(role_name,'public.apex_resolve_school(text)','EXECUTE')
      or has_function_privilege(role_name,'public.apex_leaderboard_resolve_school()','EXECUTE')
      or has_function_privilege(role_name,'public.apex_leaderboard_rate_limit()','EXECUTE') then raise exception 'Unexpected privileged RPC'; end if;
  end loop;
end
$verify$;
set local role anon;
select * from public.apex_leaderboard_public_v2 limit 0;
reset role;
set local role authenticated;
select * from public.apex_leaderboard_public_v2 limit 0;
reset role;
select to_regclass('public.apex_leaderboard_public') is null as legacy_endpoint_removed;
-- Must be true after finalize. False during expand means privacy cutover is NOT complete.
select board_group, count(*) as representative_count from public.apex_leaderboard_public_v2 group by board_group;
select board_group, count(*) as raw_count from public.apex_leaderboard group by board_group;
commit;
