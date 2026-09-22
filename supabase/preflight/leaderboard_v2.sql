-- READ ONLY. Run privately as postgres before approving production writes.
begin read only;
set local statement_timeout = '30s';
select current_database(), current_user, version();
select column_name, data_type, is_nullable, column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'apex_leaderboard' order by ordinal_position;
select board_group, count(*) from public.apex_leaderboard group by board_group;
-- Counts identify partial states, but CANNOT establish which school owns old records.
select count(*) filter (where to_jsonb(b)->>'school_name' is null and to_jsonb(b)->>'school_key' is null) as no_school,
  count(*) filter (where to_jsonb(b)->>'school_name' is not null and to_jsonb(b)->>'school_key' is null) as name_only,
  count(*) filter (where to_jsonb(b)->>'school_name' is null and to_jsonb(b)->>'school_key' is not null) as key_only,
  count(*) filter (where to_jsonb(b)->>'school_name' is not null and to_jsonb(b)->>'school_key' is not null) as complete
from public.apex_leaderboard b;
select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'apex_leaderboard';
select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.apex_leaderboard'::regclass and not tgisinternal;
select * from pg_policies where schemaname = 'public' and tablename like 'apex_%';
select c.relname, c.relowner::regrole, c.reloptions, c.relacl from pg_class c
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'apex_%';
select * from information_schema.column_privileges where table_schema = 'public' and table_name like 'apex_%';
select member::regrole, roleid::regrole from pg_auth_members where member in ('anon'::regrole, 'authenticated'::regrole);
-- Inventory ALL public views/functions: look for legacy aliases or privileged RPCs before privacy sign-off.
select viewname, definition from pg_views where schemaname = 'public';
select p.oid::regprocedure, p.proowner::regrole, p.prosecdef, p.proconfig, p.proacl,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
commit;
