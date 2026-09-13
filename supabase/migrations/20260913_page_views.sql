-- HAFS 과학 수업 포털 공통 조회수 스키마
--
-- 적용 대상: predator-prey-simulation-2 가 사용하는 Supabase 프로젝트(Apex Survival 과 같은 프로젝트).
-- Supabase SQL Editor 에 붙여넣어 실행합니다. 여러 번 실행해도 안전합니다.
-- 기존 apex_leaderboard 관련 객체는 전혀 건드리지 않고, 이름이 page_view(s)_ 로 시작하는
-- 새 객체만 만듭니다. DROP 은 한 줄도 없습니다.
--
-- 프런트엔드: https://suimaire.github.io/assets/js/page-views.js
--   (저장소 suimaire/suimaire.github.io — 포털과 모든 학습 앱이 이 파일 하나를 공유합니다)
--
-- 권한 모델 요약
--   page_views_daily / page_views_total : anon/authenticated 권한 없음(SELECT 도 없음). RLS 켜짐, 정책 없음.
--   record_page_view(text)      : anon 호출 가능. 오늘(KST)·전체 조회수를 원자적으로 +1 하고 현재 값을 돌려줌.
--   get_page_view_counts(text)  : anon 호출 가능. 증가 없이 현재 값만 돌려줌(30분 이내 재방문 표시용).
--   두 RPC 는 SECURITY DEFINER(소유자 postgres 권한)로 테이블에 접근하므로, 학생 키로 할 수 있는 일은
--   "형식이 올바른 page_key 하나를 1 증가시키거나 읽기" 뿐입니다. 임의 값 UPDATE/DELETE 는 불가능합니다.
--
-- 날짜 기준
--   오늘 조회수의 날짜 경계는 Asia/Seoul 00:00 입니다. 서버 TimeZone 설정이나 클라이언트 날짜와 무관하게
--   함수 안에서 (시각 AT TIME ZONE 'Asia/Seoul')::date 로 계산합니다.
--
-- 동시성
--   INSERT ... ON CONFLICT DO UPDATE SET views = <table>.views + 1 은 충돌 행을 잠근 뒤 최신 값에 +1 하므로
--   동시에 요청이 몰려도 증가분이 유실되지 않습니다(read-then-write 없음).
--   한 호출 안에서 항상 daily → total 순서로 잠그므로 호출끼리 교착 상태가 생기지 않습니다.
--
-- 공개 사이트이므로 부정 조회를 완벽히 막을 수는 없습니다. 30분 중복 방지는 브라우저 localStorage 기반의
-- "실수로 누른 새로고침" 방지일 뿐 보안 기능이 아닙니다.

-- ---------------------------------------------------------------------------
-- 1. page_key 형식 검사
-- ---------------------------------------------------------------------------
-- 프런트엔드 normalizePageKey() 가 만드는 형식과 같습니다.
--   '/'  또는  '/segment/.../'  (소문자 영숫자와 . _ ~ % - 만, 반드시 '/' 로 끝남, 최대 200자)
--   세그먼트는 '.' 으로 시작할 수 없으므로 '..' 경로도 거부됩니다. 태그·따옴표·공백은 들어갈 수 없습니다.

create or replace function public.page_views_valid_key(p_page_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_page_key is not null
     and char_length(p_page_key) between 1 and 200
     and p_page_key ~ '^/([a-z0-9_~%-][a-z0-9._~%-]*/)*$';
$$;

comment on function public.page_views_valid_key(text) is
  '조회수 page_key 형식 검사. "/" 또는 "/a/b/" 형태, 소문자 영숫자와 ._~%- 만, 200자 이하.';

-- ---------------------------------------------------------------------------
-- 2. 테이블
-- ---------------------------------------------------------------------------

create table if not exists public.page_views_daily (
  page_key   text        not null,
  view_date  date        not null,
  views      bigint      not null default 0,
  updated_at timestamptz not null default now(),
  constraint page_views_daily_pkey primary key (page_key, view_date),
  constraint page_views_daily_key_format check (public.page_views_valid_key(page_key)),
  constraint page_views_daily_views_nonnegative check (views >= 0)
);

comment on table public.page_views_daily is
  '페이지별 일일 조회수. view_date 는 Asia/Seoul 기준 날짜. 쓰기는 record_page_view() 로만.';
comment on column public.page_views_daily.view_date is 'Asia/Seoul(KST) 기준 날짜';

create table if not exists public.page_views_total (
  page_key        text        not null,
  views           bigint      not null default 0,
  first_viewed_at timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint page_views_total_pkey primary key (page_key),
  constraint page_views_total_key_format check (public.page_views_valid_key(page_key)),
  constraint page_views_total_views_nonnegative check (views >= 0)
);

comment on table public.page_views_total is
  '페이지별 전체 누적 조회수. 일일 테이블 합계를 매번 계산하지 않도록 따로 누적합니다. 쓰기는 record_page_view() 로만.';

-- 날짜별 집계·정리용(예: 오래된 daily 행 조회). 페이지 단위 조회는 기본키 인덱스가 담당합니다.
create index if not exists page_views_daily_view_date_idx on public.page_views_daily (view_date);

-- ---------------------------------------------------------------------------
-- 3. 테이블 권한 — 학생 키로는 직접 접근 불가
-- ---------------------------------------------------------------------------
-- Supabase 는 public 스키마 새 테이블에 anon/authenticated 권한을 기본 부여하므로 명시적으로 회수합니다.
-- RLS 를 켜고 정책을 만들지 않으므로, 권한이 실수로 다시 붙더라도 행은 보이지도 바뀌지도 않습니다.

revoke all on table public.page_views_daily from public, anon, authenticated;
revoke all on table public.page_views_total from public, anon, authenticated;
alter table public.page_views_daily enable row level security;
alter table public.page_views_total enable row level security;

-- ---------------------------------------------------------------------------
-- 4. 내부 함수 — 시각을 인자로 받음(테스트에서 KST 자정 경계를 재현하기 위함). anon 호출 불가.
-- ---------------------------------------------------------------------------

create or replace function public.page_views_record_at(p_page_key text, p_at timestamptz)
returns table (kst_date date, today_views bigint, total_views bigint)
language plpgsql
set search_path = ''
as $$
declare
  v_date  date := (p_at at time zone 'Asia/Seoul')::date;
  v_today bigint;
  v_total bigint;
begin
  if not public.page_views_valid_key(p_page_key) then
    raise exception 'invalid page_key' using errcode = '22023';
  end if;

  insert into public.page_views_daily as d (page_key, view_date, views)
  values (p_page_key, v_date, 1)
  on conflict on constraint page_views_daily_pkey
  do update set views = d.views + 1, updated_at = now()
  returning d.views into v_today;

  insert into public.page_views_total as t (page_key, views)
  values (p_page_key, 1)
  on conflict on constraint page_views_total_pkey
  do update set views = t.views + 1, updated_at = now()
  returning t.views into v_total;

  kst_date    := v_date;
  today_views := v_today;
  total_views := v_total;
  return next;
end;
$$;

create or replace function public.page_views_counts_at(p_page_key text, p_at timestamptz)
returns table (kst_date date, today_views bigint, total_views bigint)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_date date := (p_at at time zone 'Asia/Seoul')::date;
begin
  if not public.page_views_valid_key(p_page_key) then
    raise exception 'invalid page_key' using errcode = '22023';
  end if;

  kst_date := v_date;
  select coalesce(max(d.views), 0) into today_views
    from public.page_views_daily as d
   where d.page_key = p_page_key and d.view_date = v_date;
  select coalesce(max(t.views), 0) into total_views
    from public.page_views_total as t
   where t.page_key = p_page_key;
  return next;
end;
$$;

comment on function public.page_views_record_at(text, timestamptz) is
  '내부용. 주어진 시각의 KST 날짜로 일일·전체 조회수를 원자적으로 +1. anon 에게 공개하지 않음.';
comment on function public.page_views_counts_at(text, timestamptz) is
  '내부용. 주어진 시각의 KST 날짜 기준 조회수 읽기. anon 에게 공개하지 않음.';

-- ---------------------------------------------------------------------------
-- 5. 공개 RPC — 시각은 항상 서버 now(). 클라이언트는 page_key 만 보낼 수 있습니다.
-- ---------------------------------------------------------------------------

create or replace function public.record_page_view(p_page_key text)
returns table (kst_date date, today_views bigint, total_views bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query select r.kst_date, r.today_views, r.total_views
                 from public.page_views_record_at(p_page_key, now()) as r;
end;
$$;

create or replace function public.get_page_view_counts(p_page_key text)
returns table (kst_date date, today_views bigint, total_views bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query select c.kst_date, c.today_views, c.total_views
                 from public.page_views_counts_at(p_page_key, now()) as c;
end;
$$;

comment on function public.record_page_view(text) is
  '공개 RPC. page_key 의 오늘(Asia/Seoul)·전체 조회수를 원자적으로 1 증가시키고 증가 후 값을 반환.';
comment on function public.get_page_view_counts(text) is
  '공개 RPC. 증가 없이 page_key 의 오늘(Asia/Seoul)·전체 조회수를 반환.';

-- ---------------------------------------------------------------------------
-- 6. 함수 실행 권한 — 공개 RPC 두 개만 anon/authenticated 에게
-- ---------------------------------------------------------------------------
-- PostgreSQL 은 새 함수에 PUBLIC EXECUTE 를, Supabase 는 anon/authenticated EXECUTE 를 기본 부여하므로
-- 전부 회수한 뒤 필요한 것만 되돌려 줍니다. 소유자(postgres)와 service_role 권한은 그대로입니다.

revoke all on function public.page_views_valid_key(text)                    from public, anon, authenticated;
revoke all on function public.page_views_record_at(text, timestamptz)       from public, anon, authenticated;
revoke all on function public.page_views_counts_at(text, timestamptz)       from public, anon, authenticated;
revoke all on function public.record_page_view(text)                        from public, anon, authenticated;
revoke all on function public.get_page_view_counts(text)                    from public, anon, authenticated;

grant execute on function public.record_page_view(text)     to anon, authenticated;
grant execute on function public.get_page_view_counts(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. PostgREST 스키마 캐시 갱신
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
