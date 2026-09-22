-- Shared v2 contract. scripts/build-leaderboard-sql.mjs embeds this in both entry points.
-- Never execute this fragment separately: its caller holds the table lock in one transaction.

create or replace function public.apex_normalize_student_number(value text)
returns text language sql immutable strict parallel safe
set search_path = pg_catalog
as $$ select lower(regexp_replace(btrim(value), '\s+', ' ', 'g')) $$;
-- Deliberately identical to the previous DB identity expression, including btrim order.

create or replace function public.apex_clean_school_name(value text)
returns text language sql immutable strict parallel safe
set search_path = pg_catalog
as $$ select btrim(regexp_replace(value, U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')) $$;

create or replace function public.apex_school_alias_key(value text)
returns text language sql immutable strict parallel safe
set search_path = pg_catalog
as $$ select lower(public.apex_clean_school_name(value)) $$;

-- The separate canonical table makes conflicting display names for one key impossible.
create table if not exists public.apex_schools (
  school_key text primary key,
  display_name text not null,
  constraint apex_schools_key check (school_key = 'hafs' or school_key ~ '^school:[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint apex_schools_name check (char_length(display_name) between 1 and 80
    and display_name = public.apex_clean_school_name(display_name)),
  constraint apex_schools_hafs check (school_key <> 'hafs' or display_name = 'HAFS')
);
create table if not exists public.apex_school_aliases (
  alias_key text primary key,
  school_key text not null references public.apex_schools(school_key),
  constraint apex_school_aliases_key check (char_length(alias_key) between 1 and 80
    and alias_key = public.apex_school_alias_key(alias_key))
);
alter table public.apex_schools owner to postgres;
alter table public.apex_school_aliases owner to postgres;
alter table public.apex_schools enable row level security;
alter table public.apex_school_aliases enable row level security;
revoke all on public.apex_schools, public.apex_school_aliases from public, anon, authenticated;
-- Prevent a concurrent administrator from racing the alias-conflict check and seed INSERT.
lock table public.apex_schools, public.apex_school_aliases in share row exclusive mode;

do $registry$
declare alias text;
begin
  if exists (select 1 from public.apex_schools where school_key = 'hafs' and display_name <> 'HAFS') then
    raise exception 'HAFS canonical display conflict; inspect privately';
  end if;
  insert into public.apex_schools values ('hafs', 'HAFS') on conflict do nothing;
  foreach alias in array array['HAFS', '외대부고', '용인외대부고', '한국외대부고', '용인한국외대부고',
    '한국외국어대학교부설고등학교', '용인한국외국어대학교부설고등학교'] loop
    if exists (select 1 from public.apex_school_aliases
      where alias_key = public.apex_school_alias_key(alias) and school_key <> 'hafs') then
      raise exception 'HAFS alias conflict; inspect registry privately (no overwrite)';
    end if;
    insert into public.apex_school_aliases values (public.apex_school_alias_key(alias), 'hafs') on conflict do nothing;
  end loop;
end
$registry$;

-- Registry lookup is STABLE, never IMMUTABLE. Only trusted trigger/admin callers may execute it.
create or replace function public.apex_resolve_school(value text)
returns table(school_key text, school_name text)
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare cleaned text := public.apex_clean_school_name(value);
begin
  if cleaned is null or char_length(cleaned) not between 1 and 80 then
    raise exception 'School name required (1..80 characters)' using errcode = '22023';
  end if;
  return query select s.school_key, s.display_name
    from public.apex_school_aliases a join public.apex_schools s on s.school_key = a.school_key
    where a.alias_key = public.apex_school_alias_key(cleaned);
  if not found then
    return query select 'free:' || public.apex_school_alias_key(cleaned), cleaned;
  end if;
end
$$;
alter function public.apex_resolve_school(text) owner to postgres;
revoke all on function public.apex_resolve_school(text) from public, anon, authenticated;

-- Capture every old value in session-local temporary storage, never in output or repository files.
create temporary table apex_v2_before on commit drop as
  select id, to_jsonb(b) - 'school_name' - 'school_key' as original,
    school_name as old_name, school_key as old_key from public.apex_leaderboard b;

-- Operator may pre-create this TEMP table and populate approved row-id mappings in the SAME session.
create temporary table if not exists apex_v2_school_mapping (
  id uuid primary key, school_name text not null
) on commit preserve rows;

do $backfill$
declare r record; resolved record; mapped text;
begin
  for r in select id, school_name, school_key from public.apex_leaderboard loop
    select m.school_name into mapped from pg_temp.apex_v2_school_mapping m where m.id = r.id;
    if r.school_name is null and r.school_key is null then
      if mapped is null and current_setting('apex.legacy_all_hafs_confirmed', true) = 'yes' then mapped := 'HAFS'; end if;
      if mapped is null then
        raise exception 'Legacy school provenance unconfirmed; supply approved row-id mapping or explicitly confirm all legacy rows are HAFS';
      end if;
      select * into resolved from public.apex_resolve_school(mapped);
      update public.apex_leaderboard set school_name = resolved.school_name, school_key = resolved.school_key where id = r.id;
    elsif r.school_name is not null and r.school_key is null then
      -- Preserve an already supplied display value; add only the missing key.
      select * into resolved from public.apex_resolve_school(r.school_name);
      update public.apex_leaderboard set school_key = resolved.school_key where id = r.id;
    elsif r.school_name is null then
      -- A key alone is NOT evidence that the row is HAFS. Require an approved display mapping.
      if mapped is null then raise exception 'Partial school row needs approved row-id mapping'; end if;
      select * into resolved from public.apex_resolve_school(mapped);
      if resolved.school_key <> r.school_key then raise exception 'School mapping conflicts with existing key'; end if;
      update public.apex_leaderboard set school_name = resolved.school_name where id = r.id;
    end if;
  end loop;
end
$backfill$;

-- Existing keys/displays are not silently canonicalized or re-keyed by this migration.
-- A pre-existing free: key remains valid after a new registry alias is added.
do $guards$
begin
  if exists (select 1 from public.apex_leaderboard b where
    b.school_name is null or char_length(b.school_name) not between 1 and 80
    or b.school_name <> public.apex_clean_school_name(b.school_name)
    or b.school_key is null or char_length(b.school_key) > 85
    or not (b.school_key = 'free:' || public.apex_school_alias_key(b.school_name)
      or exists (select 1 from public.apex_school_aliases a where a.alias_key = public.apex_school_alias_key(b.school_name) and a.school_key = b.school_key)
      or exists (select 1 from public.apex_schools s where s.school_key = b.school_key and s.display_name = b.school_name))) then
    raise exception 'Existing school values conflict with v2 contract; preserve data and review privately before re-key';
  end if;
  if exists (select 1 from public.apex_leaderboard group by challenge_id, simulation_version, seed,
    school_key, public.apex_normalize_student_number(student_number), payload_hash having count(*) > 1) then
    raise exception 'Normalized submission collision; transaction rolled back, no records removed' using errcode = '23505';
  end if;
end
$guards$;

alter table public.apex_leaderboard
  alter column school_name set not null,
  alter column school_name drop default,
  alter column school_key set not null,
  alter column school_key drop default;
alter table public.apex_leaderboard drop constraint if exists apex_leaderboard_school_name_length;
alter table public.apex_leaderboard add constraint apex_leaderboard_school_name_length
  check (char_length(school_name) between 1 and 80 and school_name = public.apex_clean_school_name(school_name));
alter table public.apex_leaderboard drop constraint if exists apex_leaderboard_school_key_length;
alter table public.apex_leaderboard add constraint apex_leaderboard_school_key_length check (char_length(school_key) between 1 and 85);

-- Ordinary indexes are intentional: atomic replacement under a bounded ACCESS EXCLUSIVE lock.
drop index if exists public.apex_leaderboard_dedupe_idx;
create unique index apex_leaderboard_dedupe_idx on public.apex_leaderboard
  (challenge_id, simulation_version, seed, school_key, public.apex_normalize_student_number(student_number), payload_hash);
drop index if exists public.apex_leaderboard_ranking_idx;
create index apex_leaderboard_ranking_idx on public.apex_leaderboard
  (challenge_id, simulation_version, seed, board_group, score desc, submitted_at, id);
create index if not exists apex_leaderboard_school_rate_idx on public.apex_leaderboard
  (school_key, public.apex_normalize_student_number(student_number), created_at);

create or replace function public.apex_leaderboard_resolve_school()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare resolved record;
begin
  if tg_op = 'INSERT' or new.school_name is distinct from old.school_name then
    select * into resolved from public.apex_resolve_school(new.school_name);
    new.school_name := resolved.school_name;
    new.school_key := resolved.school_key;
  elsif new.school_key is distinct from old.school_key then
    raise exception 'Direct school_key update forbidden; use reviewed school-name re-key procedure' using errcode = '22023';
  end if;
  return new;
end
$$;

create or replace function public.apex_leaderboard_rate_limit()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if (select count(*) from public.apex_leaderboard b
    where b.school_key = new.school_key
      and public.apex_normalize_student_number(b.student_number) = public.apex_normalize_student_number(new.student_number)
      and b.created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Submission rate limit' using errcode = 'P0001';
  end if;
  return new;
end
$$;
alter function public.apex_leaderboard_resolve_school() owner to postgres;
alter function public.apex_leaderboard_rate_limit() owner to postgres;
revoke all on function public.apex_leaderboard_resolve_school(), public.apex_leaderboard_rate_limit() from public, anon, authenticated;

-- Trigger names define PostgreSQL execution order. Unknown draft triggers abort rather than run twice.
drop trigger if exists apex_leaderboard_rate_limit_trigger on public.apex_leaderboard;
drop trigger if exists apex_10_resolve_school on public.apex_leaderboard;
drop trigger if exists apex_20_rate_limit on public.apex_leaderboard;
do $trigger_guard$
begin
  if exists (select 1 from pg_trigger where tgrelid = 'public.apex_leaderboard'::regclass and not tgisinternal) then
    raise exception 'Unexpected leaderboard trigger: inspect preflight and explicitly reconcile before migration';
  end if;
end
$trigger_guard$;
create trigger apex_10_resolve_school before insert or update of school_name, school_key on public.apex_leaderboard
  for each row execute function public.apex_leaderboard_resolve_school();
create trigger apex_20_rate_limit before insert on public.apex_leaderboard
  for each row execute function public.apex_leaderboard_rate_limit();

create or replace function public.apex_mask_name(value text)
returns text language sql immutable strict parallel safe set search_path = pg_catalog
as $$
  select case char_length(n)
    when 0 then '○' when 1 then '○' when 2 then left(n, 1) || '○'
    else left(n, 1) || repeat('○', char_length(n) - 2) || right(n, 1) end
  from (select replace(public.apex_clean_school_name(value), ' ', '') n) cleaned
$$;
-- PostgreSQL char_length counts Unicode code points, not UTF-16 units or grapheme clusters.

create or replace view public.apex_leaderboard_public_v2
with (security_invoker = false, security_barrier = true) as
with normalized as (
  select b.*, public.apex_normalize_student_number(b.student_number) as participant_key
  from public.apex_leaderboard b where b.board_group <> 'hidden'
), representatives as (
  select distinct on (challenge_id, simulation_version, seed, school_key, participant_key)
    * from normalized n
  where n.board_group = 'manipulator' or not exists (
    select 1 from normalized r where r.board_group = 'manipulator'
      and r.challenge_id = n.challenge_id and r.simulation_version = n.simulation_version
      and r.seed = n.seed and r.school_key = n.school_key and r.participant_key = n.participant_key
  )
  order by challenge_id, simulation_version, seed, school_key, participant_key, score desc, submitted_at asc, id asc
)
select id, challenge_id, simulation_version, seed, score, school_name,
  public.apex_mask_name(student_name) as display_name, submitted_at, board_group, school_key = 'hafs' as is_hafs
from representatives;
alter view public.apex_leaderboard_public_v2 owner to postgres;
revoke all on public.apex_leaderboard_public_v2 from public, anon, authenticated;
grant select on public.apex_leaderboard_public_v2 to anon, authenticated;

-- REVOKE at table level does not clear old column grants. Clear BOTH, only for our own objects.
revoke all on public.apex_leaderboard from public, anon, authenticated;
do $column_acl$
declare obj text; col text;
begin
  foreach obj in array array['apex_leaderboard', 'apex_schools', 'apex_school_aliases', 'apex_leaderboard_public_v2'] loop
    for col in select attname from pg_attribute where attrelid = ('public.' || obj)::regclass and attnum > 0 and not attisdropped loop
      execute format('revoke all (%I) on public.%I from public, anon, authenticated', col, obj);
    end loop;
  end loop;
end
$column_acl$;
grant insert (challenge_id, simulation_version, seed, score, parameter_snapshot,
  student_number, student_name, achieved_at, payload_hash, school_name)
  on table public.apex_leaderboard to anon, authenticated;
alter table public.apex_leaderboard enable row level security;
drop policy if exists apex_leaderboard_read on public.apex_leaderboard;
drop policy if exists apex_leaderboard_insert on public.apex_leaderboard;
create policy apex_leaderboard_insert on public.apex_leaderboard for insert to anon, authenticated with check (
  challenge_id = 'apex-survival' and simulation_version = 'apex-v1' and seed = 260903
  and verification = 'unverified' and verified_score is null and verified_at is null and verifier_version is null
  and board_group = 'protector' and achieved_at between now() - interval '1 day' and now() + interval '1 hour'
);

-- Pure string helpers contain no privileged data; the view/index/check constraints need EXECUTE.
alter function public.apex_normalize_student_number(text) owner to postgres;
alter function public.apex_clean_school_name(text) owner to postgres;
alter function public.apex_school_alias_key(text) owner to postgres;
alter function public.apex_mask_name(text) owner to postgres;
revoke all on function public.apex_normalize_student_number(text), public.apex_clean_school_name(text),
  public.apex_school_alias_key(text), public.apex_mask_name(text) from public, anon, authenticated;
grant execute on function public.apex_normalize_student_number(text), public.apex_clean_school_name(text),
  public.apex_school_alias_key(text), public.apex_mask_name(text) to anon, authenticated;

-- Effective privileges include PUBLIC and inherited roles. Unexpected inheritance blocks the cutover;
-- do not modify unrelated Supabase roles to make this check pass.
do $effective_acl$
declare student text; obj text; col text;
begin
  foreach student in array array['anon', 'authenticated'] loop
    if has_table_privilege(student, 'public.apex_leaderboard_public_v2', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'Unexpected public view write privileges';
    end if;
    foreach obj in array array['apex_leaderboard', 'apex_schools', 'apex_school_aliases'] loop
      if has_table_privilege(student, 'public.' || obj, 'SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'Unexpected effective table privileges; inspect role inheritance privately';
      end if;
      for col in select attname from pg_attribute where attrelid = ('public.' || obj)::regclass and attnum > 0 and not attisdropped loop
        if has_column_privilege(student, 'public.' || obj, col, 'SELECT,UPDATE,REFERENCES') then
          raise exception 'Unexpected effective column privileges';
        end if;
        if (obj <> 'apex_leaderboard' or col not in ('challenge_id', 'simulation_version', 'seed', 'score',
          'parameter_snapshot', 'student_number', 'student_name', 'achieved_at', 'payload_hash', 'school_name'))
          and has_column_privilege(student, 'public.' || obj, col, 'INSERT') then
          raise exception 'Unexpected effective INSERT privileges';
        end if;
      end loop;
    end loop;
    if has_function_privilege(student, 'public.apex_resolve_school(text)', 'EXECUTE')
      or has_function_privilege(student, 'public.apex_leaderboard_resolve_school()', 'EXECUTE')
      or has_function_privilege(student, 'public.apex_leaderboard_rate_limit()', 'EXECUTE') then
      raise exception 'Unexpected privileged function access';
    end if;
  end loop;
end
$effective_acl$;

do $preservation$
begin
  if exists (select 1 from pg_temp.apex_v2_before old full join public.apex_leaderboard b on b.id = old.id
    where old.id is null or b.id is null or old.original is distinct from (to_jsonb(b) - 'school_name' - 'school_key')
      or (old.old_name is not null and old.old_name is distinct from b.school_name)
      or (old.old_key is not null and old.old_key is distinct from b.school_key)) then
    raise exception 'Per-id preservation check failed; rolling back';
  end if;
end
$preservation$;
