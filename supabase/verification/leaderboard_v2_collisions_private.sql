-- PRIVATE diagnostics only. Never publish results, screenshots or CI artifacts.
-- Run after a failed expand has rolled back; it works when school columns do not exist yet.
-- Supply approved school mappings in the same session first. This does not guess HAFS provenance.
begin;
set local statement_timeout = '30s';
create temporary table if not exists apex_v2_school_mapping (id uuid primary key, school_name text not null) on commit preserve rows;
-- For failures involving partial/draft school metadata, inspect these row IDs privately first.
select b.id, to_jsonb(b)->>'school_name' as school_name, to_jsonb(b)->>'school_key' as school_key,
  lower(regexp_replace(btrim(b.student_number), '\s+', ' ', 'g')) as normalized_student_number
from public.apex_leaderboard b
where to_jsonb(b)->>'school_name' is null or to_jsonb(b)->>'school_key' is null;
-- Candidate collisions using known keys, or the exact approved school label if no key exists.
-- For aliases/custom registry mappings, resolve canonical keys privately in a restored test DB
-- with the v2 resolver before approving any re-key. This conservative report is not an approval gate.
select b.challenge_id, b.simulation_version, b.seed,
  coalesce(to_jsonb(b)->>'school_key', to_jsonb(b)->>'school_name', m.school_name) as candidate_school,
  lower(regexp_replace(btrim(b.student_number), '\s+', ' ', 'g')) as normalized_student_number,
  b.payload_hash, array_agg(b.id order by b.id) as conflicting_ids
from public.apex_leaderboard b left join pg_temp.apex_v2_school_mapping m on m.id=b.id
group by 1,2,3,4,5,6 having count(*)>1;
commit;
