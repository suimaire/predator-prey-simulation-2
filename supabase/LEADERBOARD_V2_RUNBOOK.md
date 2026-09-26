# 전국 / HAFS leaderboard v2 전환

이 문서는 적용 절차이며 운영 적용 결과가 아니다. 운영 Supabase의 상태·데이터 출처·기존 공개 경로는 별도 확인해야 한다. **운영 쓰기는 단계별 명시적 승인 후 수행한다.** 코드를 기능 브랜치에 push하는 것과 운영 DB 적용·Pages 배포는 별개다.

## 계약

학교를 직접 입력한다. 최초 브라우저의 학교는 빈칸이고 HAFS를 자동 입력하지 않는다. 사용자가 직접 저장한 값만 복원한다. 학번은 문자열이고 선행 0을 유지한다. 이름은 참가자 identity에 포함하지 않는다.

| 대상 | 계약 |
| --- | --- |
| 원본 `apex_leaderboard` | 모든 제출 보존. 학생에게 SELECT/UPDATE/DELETE 없음. 허용된 기존 INSERT 열 + `school_name`만 입력 가능 |
| 내부 identity | `school_key` + `apex_normalize_student_number(student_number)` |
| 공개 `apex_leaderboard_public_v2` | `id, challenge_id, simulation_version, seed, score, school_name, display_name, submitted_at, board_group, is_hafs` 10개 열만 SELECT |
| 비공개 | 학번, 전체 이름, school_key, snapshot, hash, achieved_at, 모든 verification 열. 공개 응답·DOM·tooltip에 전달하지 않음 |
| national | HAFS를 **포함한** 모든 학교. `is_hafs` 필터 없음 |
| hafs | 독립적인 서버 query에 `is_hafs=eq.true`. 전국 Top N에서 추출하지 않음 |
| board | 공통 `protector` / `manipulator` 선택이 전국/HAFS를 함께 전환. 학생은 분류를 지정할 수 없음 |

DB는 hidden 제외 → 동일 범위의 RED TEAM 우선 → 참가자 대표 기록 선택 → 이름 마스킹 → 공개 열 projection 순으로 처리한다. RED TEAM 우선 범위는 `challenge_id + simulation_version + seed + school_key + normalized student_number`다. 다른 학교의 같은 학번이나 다른 도전에는 전파되지 않는다. 대표 기록은 `score DESC, submitted_at ASC, id ASC`. 교사가 manipulator를 모두 protector/hidden으로 되돌리면 보존된 protector 대표가 다시 보인다.

동점 순위는 1,1,3이다. 상세는 상위 10개 위치 + 경계 점수 전원, 요약은 그 결과의 최대 3행이다. timestamp는 PostgreSQL의 마이크로초와 시간대까지 비교한다. keyset pagination은 score/time/id 다음 행부터 이어 받고, 경계 점수를 알면 낮은 점수를 요청하지 않는다. 짧은 응답도 서버 페이지 제한일 수 있으므로 비어 있는 페이지까지 확인한다. 동시 관리자 수정·새 제출 중 여러 HTTP 요청은 한 DB snapshot이 아니므로 새로고침이 필요할 수 있다. 변경/정렬 오류가 감지되면 오류로 처리하며 결과 없음으로 위장하지 않는다.

## 정규화와 한계

- 학교: ECMAScript 공백 문자(ASCII whitespace, NBSP, U+1680, U+2000–200A, U+2028/2029, U+202F, U+205F, U+3000, BOM)를 공백 하나로 축약하고 앞뒤 공백 제거. alias는 PostgreSQL `lower`로 비교한다. Unicode NFKC나 fuzzy matching은 하지 않는다.
- 학교 길이: 정리 후 1–80 Unicode code points. DB `char_length`, TS `[...value].length`, 폼 custom validity를 일치시켰다. HTML maxlength는 UTF-16 단위이므로 학교 입력에는 쓰지 않는다. 학번 24/이름 16과 기존 허용 문자 패턴은 유지한다.
- 학번 DB 정규화는 기존 식 **`lower(regexp_replace(btrim(value), '\s+', ' ', 'g'))` 그대로**다. btrim을 먼저 실행하는 순서도 유지한다. 레거시의 앞뒤 tab 같은 비정상 입력은 클라이언트 공백 정리와 다를 수 있다. 이를 새 규칙으로 자동 수정하거나 합치지 않는다. 기존 dedupe index는 raw 학번이었으므로 새 normalized index 충돌은 전체 rollback한다.
- 등록 키: `hafs` 또는 `school:<stable-key>`; 미등록 키: `free:<normalized-school-name>`. 예를 들어 사용자가 `school:known`을 입력하면 `free:school:known`이므로 canonical 키를 차지하지 못한다. school_key 제한 85자는 현재 resolver의 `free:` 5자 + 정규화된 80자를 수용한다.
- HAFS 별칭: HAFS, 외대부고, 용인외대부고, 한국외대부고, 용인한국외대부고, 한국외국어대학교부설고등학교, 용인한국외국어대학교부설고등학교. 대소문자·앞뒤 공백 차이는 무시하고 신규 제출은 `hafs` / `HAFS`로 저장한다.
- `apex_schools`는 key별 대표 표기 하나를 관리하고, `apex_school_aliases`는 정규화 alias→key만 참조한다. 기존 alias가 다른 학교를 가리키면 설치가 중단된다. 조용한 `ON CONFLICT DO UPDATE`는 없다.
- 이름 마스킹은 원본을 수정하지 않고 공백을 모두 제거한 뒤 PostgreSQL code point 길이를 사용한다. 1자 `○`, 2자 첫 글자+`○`, 3자 이상 첫/끝 글자만 유지한다. `홍길동→홍○동`, `박준→박○`, `제갈공명→제○○명`. 결합문자와 emoji도 code point 기준이며 grapheme cluster 처리는 아니다. 클라이언트는 원본 이름으로 마스킹하지 않는다.
- 일부 가림 이름은 **완전한 익명화가 아니다.** HAFS 입력은 **재학 인증이 아니다.** 미등록 학교의 서로 다른 약칭은 자동 통합되지 않는다. 로그인·인증·초대 코드·교사용 대시보드·서버 재실행 검증을 추가하지 않았다.
- 제출 제한은 동일 학교+정규화 학번에 최근 1분 10건이다. alias 변경으로 우회하지 못하지만 count 기반 동시 INSERT 경쟁의 한계는 남는다. 인증이나 완전한 악용 방지를 제공하지 않는다.

## 단계별 적용 순서

| 단계 | 파일/작업 | 완료 조건 |
| --- | --- | --- |
| 1. 조사 | `preflight/leaderboard_v2.sql` | postgres로 비공개 실행, 실제 열·인덱스·트리거·RLS·ACL·role 상속·공개 view/RPC 확인. 학교 출처를 별도 확인 |
| 2. 격리 복원 시험 | 승인된 비공개 DB 복제본 + 아래 expand/finalize | 값 보존·충돌·대표 기록·권한 확인. 학생 정보는 저장소/CI/로그/스크린샷에 넣지 않음 |
| 3. 운영 expand | `migrations/20260922_leaderboard_schools_v2.sql` | 명시적 쓰기 승인 + 출처/mapping 승인. 원자적 전환과 내부 per-id 보존 검사 성공 |
| 4. DB 준비 검사 | `verification/leaderboard_v2.sql` + 실제 v2 REST GET | 새 계약/권한 확인. 이 시점에는 구 공개 view가 남으므로 개인정보 전환 미완료 |
| 5. frontend | v2 환경변수, 배포 승인, `LEADERBOARD_V2_DB_READY=true`, 승인된 main 승격/Pages | 공개 URL에서 전국/HAFS·학교 제출 폼·v2 요청 확인. 실제 학생 기록으로 가짜 POST 테스트 금지 |
| 6. 수동 finalize | `manual-cutover/20260922_finalize_leaderboard_v2.sql` | 배포 확인값 + 별도 승인 후 구 공개 view 삭제, default 제거, schema cache reload |
| 7. 최종 검증 | verification SQL + REST 권한 검사 + legacy view/RPC 재조사 | 모든 구 개인정보 경로가 닫힌 것을 확인한 뒤에만 개인정보 전환 완료 판정 |

신규 빈 DB만 `schema.sql`을 실행한다. expand/finalize를 완료한 최종 DB에 schema를 재실행해도 구 view는 생기지 않는다. 기존 legacy view가 남은 DB에는 schema.sql이 거절되므로 frontend 이전에 hardening을 우회 적용할 수 없다. 오래된 `20260915_red_team_precedence.sql`이나 테스트 전용 `tests/fixtures/leaderboard-legacy.sql`을 운영에 재실행하지 않는다. 기존 migration은 이력이며 전체 파일을 처음부터 재생하는 배포 명령이 없다. manual-cutover는 자동 migration 폴더 밖에 있다.

### 1. Preflight와 보존 기준

실제 운영 DB 연결 대상을 확인하고 백업/복원 가능성을 검증한다. preflight 결과에는 role/스키마 정보가 있으므로 비공개로 보관한다. 기존 행 수나 HAFS라는 UI 제목만으로 출처를 확정하지 않는다.

expand가 기대하는 기존 열은 현재 저장소의 legacy schema와 같다. `class_label` 같은 더 오래된 구조, 검증 열 누락, 다른 이름의 40자 학교 제약, 예상하지 못한 trigger/registry가 있으면 별도 조사가 선행되어야 한다. 자동 DROP CASCADE나 사용자 변경 제거로 진행하지 않는다.

마이그레이션은 잠금 후 기존 행의 모든 열을 JSONB로 session 임시 테이블에 복사한다. 동일 id의 기존 값 전부를 비교하고, 이미 존재한 school_name/key도 별도로 비교한다. 이는 count만 확인하는 검증이 아니다. board_group·hidden 분포, verification 값, snapshot/hash/시각/학번/이름도 비교 대상이다. 신규 값만 채우며 기존 행 삭제·재삽입을 하지 않는다. 임시 snapshot은 commit/rollback 시 제거된다.

대표 기록 선택은 개인정보를 출력하지 않고 비공개 복제본에서 학교별 기대 id 집합과 비교한다. 동일 학교의 raw 학번 변형은 새 normalized unique index에서 충돌할 수 있다. 출처나 충돌이 불명확하면 쓰기를 승인하지 않는다.

### 2. Legacy 출처 승인 전달

동일 SQL 세션에서 관리자 확인을 기록한 뒤 expand를 실행한다. 운영자 이름·승인 시각·백업 식별자·행 id mapping은 공개 저장소 밖에 보관한다.

모든 **학교 정보가 전혀 없는 legacy 행**이 HAFS임을 확인했을 때만:

```sql
set apex.legacy_all_hafs_confirmed = 'yes';
-- 이제 같은 세션에서 expand SQL 전체 실행
-- 완료/실패 후 이 세션의 확인값 정리:
reset apex.legacy_all_hafs_confirmed;
```

외부 학교 혼합 또는 key-only 부분 상태에는 확인한 id별 mapping을 준비한다:

```sql
create temporary table apex_v2_school_mapping (
  id uuid primary key, school_name text not null
) on commit preserve rows;
-- 비공개로 확인한 id와 실제 학교명만 매핑한다. 추측 값으로 채우지 않는다.
-- insert into pg_temp.apex_v2_school_mapping values (<approved uuid>, <approved school name>);
-- 같은 세션에서 expand SQL 전체 실행
-- 완료 후 drop table pg_temp.apex_v2_school_mapping;
```

name-only는 이름을 유지하고 resolver로 key만 채운다. key-only는 HAFS 일괄 확인이 있어도 별도 mapping이 필요하며 기존 key와 일치해야 한다. 둘 다 채워진 타교 기록은 변경하지 않는다. 기존 표시명의 공백/길이/키 일관성이 v2와 맞지 않으면 중단하고 별도 승인을 구한다. 기존 표시가 HAFS 별칭인 경우 값 보존을 위해 legacy 표시를 유지하며, 신규 요청에만 대표 표기를 적용한다.

### 3. 잠금·원자성·실패

expand는 `BEGIN`, `lock_timeout=5s`, `statement_timeout=120s`, 원본 `ACCESS EXCLUSIVE` 잠금을 사용한다. 열 추가·승인된 backfill·NOT NULL·index 교체·resolver/rate trigger·권한·view·보존 검사를 한 트랜잭션에서 수행한다. 다른 INSERT가 중간 상태를 보지 못한다. 일반 CREATE INDEX를 사용하며 CONCURRENTLY와 섞지 않는다. 잠금 중 읽기/쓰기가 대기하므로 사전 복제 시험으로 시간을 측정하고 짧은 유지보수 시간을 잡는다. 무제한 기다리지 않는다.

잠금/시간 초과/충돌/권한 문제 시 `ROLLBACK`하고 원인을 해결한 다음 전체 expand를 다시 실행한다. 기존 unique index를 먼저 제거하지 않는다. 결과를 확인하지 않고 같은 세션에서 뒷부분만 실행하지 않는다. DB Editor의 세션을 분리하면 temp mapping/GUC도 이어지지 않는다는 점을 확인한다. psql은 `-v ON_ERROR_STOP=1` 사용을 권장한다.

**임시 HAFS DEFAULT는 구현하지 않는다.** legacy 출처 확인과 미래 제출의 학교는 별개다. expand 이후 학교를 보내지 않는 오래된 브라우저는 실패한다. 운영 전환을 한 유지보수 시간에 묶고 새로고침/다시 제출 안내를 제공한다. 최종 default는 없고 finalize에서도 제거한다. 구 버전의 영구 호환을 위해 자동 HAFS를 넣지 않는다.

### 4. 권한과 실제 HTTP 확인

`verification/leaderboard_v2.sql`은 anon/authenticated 역할로 실제 view SELECT를 실행하며 원본/registry의 유효 권한과 private projection을 검사한다. `PUBLIC` 직접 grant는 설치가 회수하고, PUBLIC을 통한 유효 권한과 상속 역할의 권한도 `has_*_privilege` 검사에 반영된다. 예상하지 못한 상속 권한은 관련 없는 Supabase 공통 역할을 전역 수정하지 않고 적용을 중단시킨다.

view는 신뢰하는 postgres 소유자, `security_invoker=false`, `security_barrier=true`로 원본을 읽는다. 원본 SELECT를 학생에게 부여하지 않는다. registry resolver는 `STABLE SECURITY DEFINER`, trigger 함수는 SECURITY DEFINER이며 `search_path=pg_catalog`, schema-qualified 참조, postgres 소유권, PUBLIC/학생 EXECUTE 회수를 생성과 같은 트랜잭션에서 수행한다. 순수 문자열 함수의 EXECUTE만 view/index/constraint 평가를 위해 허용한다.

운영에서는 승인된 **읽기** 검사로 아래를 확인하되 응답 원문을 공개 로그에 남기지 않는다. publishable key는 `apikey`, 실제 로그인 JWT만 `Authorization: Bearer`다. service_role/secret은 프론트엔드에 넣지 않는다.

| HTTP 요청 | 기대 결과 |
| --- | --- |
| v2 `?select=*&limit=1` | 200, 공개 10열만 |
| v2 `?select=student_number` / student_name / school_key / parameter_snapshot | 열 없음 오류 |
| 원본 `?select=*` | 권한 거부 |
| registry SELECT | 권한 거부 |
| legacy `apex_leaderboard_public?select=*&limit=0` (finalize 후) | endpoint 없음/거부, 학생 정보 반환 없음 |
| privileged resolver RPC (격리 DB에서만 실행) | 권한 거부 |

정상 INSERT·학교 누락·서버 열 지정·UPDATE/DELETE·중복/rate 검증은 **격리 DB**에서 한다. 운영에 가짜 학생/점수를 보내지 않는다. 실제 Supabase/PostgREST에는 키 종류·schema cache·role 상속 같은 배포 설정이 있으므로 PGlite 결과만으로 운영 HTTP 검증을 대체하지 않는다.

### 5. Frontend 및 finalize

frontend 기본 endpoint는 `${VITE_LEADERBOARD_TABLE}_public_v2`다. 원본 기본값은 `apex_leaderboard`. 기존 GitHub repository variable `VITE_LEADERBOARD_PUBLIC_VIEW=apex_leaderboard_public`은 삭제하거나 `apex_leaderboard_public_v2`로 바꾼다. custom table이라면 동일 table 이름의 `_public_v2` view를 지정한다. `_public` fallback은 없고 잘못된 override는 준비 오류를 표시한다.

Pages workflow는 main push 또는 수동 실행으로 정의되지만 job은 `github.ref == refs/heads/main` 및 `LEADERBOARD_V2_DB_READY == true`일 때만 실행된다. 이 저장소 변수는 승인된 expand·live v2 검사 이후 운영자가 설정한다. feature branch push는 운영 배포하지 않는다. workflow가 생략되었다고 배포 성공이라고 해석하지 않는다.

v2 frontend가 실제 공개 URL에서 조회하는 것을 확인하고 finalize 쓰기 승인을 받은 뒤, 같은 세션에서:

```sql
set apex.frontend_v2_confirmed = 'yes';
-- manual-cutover/20260922_finalize_leaderboard_v2.sql 전체 실행
reset apex.frontend_v2_confirmed;
```

finalize는 구 view를 CASCADE 없이 DROP한다. 의존 객체가 있으면 rollback하므로 해당 view/RPC의 공개 권한·정의를 비공개 검토하고 개별 폐쇄한 후 재시도한다. 두 SQL 단계 모두 `NOTIFY pgrst, 'reload schema'`를 commit과 함께 보낸다. verification의 `legacy_endpoint_removed`가 true인지, 실제 HTTP의 구 경로가 닫혔는지 재확인한다. 알려진 하나의 view만 삭제했다고 기존 별칭 view/RPC까지 모두 사라졌다고 추정하지 않는다.

## Alias 등록과 별도 re-key

관리자만 registry를 바꿀 수 있다. canonical 학교를 먼저 등록하고 normalized alias를 연결한다. alias 키 충돌은 일반 INSERT의 unique 오류로 드러나게 두며 다른 학교를 가리키는 기존 값을 덮어쓰지 않는다. key별 대표 표기를 바꾸려면 이미 저장된 표시명과 정책까지 별도로 검토한다.

새 alias는 기존 `free:` 제출을 자동 이동하지 않는다. 기존 기록 re-key는 별도 승인된 유지보수 작업이다:

1. 비공개 복제 DB에서 대상 id를 명시하고 예상 school_name/key를 만든다. 기존 raw 열 snapshot을 보존한다.
2. 새 `(challenge,version,seed,key,normalized number,hash)`로 원본 전체와 충돌 여부를 확인한다. RED TEAM 우선·rate identity·대표 id 변화도 확인한다.
3. 충돌 시 자동 DELETE, hidden 처리, score/hash 변경으로 해결하지 않는다. 출처 확인으로 잘못된 학교만 정정할 수 있다. 확인된 중복이라면 모든 원본을 보존할 별도 정책/스키마 결정을 먼저 받는다.
4. 짧은 트랜잭션/잠금에서 승인된 id에 school_name을 **변경**하면 resolver가 key를 함께 정한다. school_key 단독 변경은 거절된다. 이름이 이미 같은 경우 trigger가 자동 re-key하지 않으므로, 검토된 전용 관리자 SQL을 별도로 작성·격리 검증해야 한다. 학생용 RPC를 열거나 trigger를 무심코 비활성화하지 않는다.
5. id별 보호 열 비교, key/표기, raw 분포와 대표 id를 확인한 뒤 commit한다.

`verification/leaderboard_v2_collisions_private.sql`은 private 진단 출발점이다. 아직 resolver가 설치되지 않은 rollback 상태에서 원본 id/정규화 학번과 candidate 중복을 보여 준다. custom alias까지 최종 판정하는 도구는 아니므로 승인된 mapping/registry를 복제 DB에 적용하여 실제 resolver 기준으로 다시 확인한다.

교사의 기존 분류 작업은 `UPDATE public.apex_leaderboard SET board_group = 'manipulator' | 'protector' | 'hidden' WHERE id IN (...)` 그대로다. 학교/학번을 기준으로 여러 행을 무조건 바꾸지 않는다. 원본 snapshot 조회는 승인된 관리자만 한다.

## 복구

- expand 실패: 전체 rollback을 확인하고 구 원본·index·trigger·권한이 보존되었는지 검사한다. 운영 배포 gate를 열지 않는다.
- expand 성공/새 frontend 실패: 새 데이터는 보존하고 배포를 보류하거나 기록판 점검 안내를 내보낸다. v2 frontend를 forward-fix한다. 개인정보가 있는 구 view를 새로 열지 않는다.
- finalize 실패: rollback 상태에서는 기존 공개 경로가 남을 수 있으므로 개인정보 전환 완료라고 발표하지 않는다. 의존성/권한을 확인해 폐쇄를 완료한다.
- finalize 후 문제: v2 경계 안에서 권한/쿼리/화면을 고친다. raw SELECT grant 복구, 구 private view 재생성, 타교 기록 삭제, 전체 DB를 예전 상태로 덮어쓰기하는 rollback은 하지 않는다. 필요하면 기록판만 일시 비활성화한다.

## 로컬 검증 재현

```text
npm ci
npm run db:check
npm run test:leaderboard
npm test
npx tsc --noEmit
npm run build
git diff --check
```

PGlite는 문자열 mock이 아닌 PostgreSQL WASM 엔진이다. [PGlite 설명](https://pglite.dev/docs/about). 테스트는 PostgreSQL 18.3/PGlite 0.5.8에서 합성 데이터로 실제 SQL/트랜잭션/SET ROLE/권한을 실행했다. PostgreSQL/Supabase 서버의 다중 연결 잠금 대기, PostgREST HTTP, 실제 운영 role 상속은 여기서 검증하지 않았으므로 운영 사전 확인이 필요하다. 작은 서버 페이지를 고려하는 이유는 [PostgREST pagination 계약](https://docs.postgrest.org/en/stable/references/api/pagination_count.html)에 따른다.

SQL 단일 원본은 `leaderboard-v2/contract.sql`, `install.sql`, `close-legacy.sql`이다. 수정 후 `npm run db:generate`로 독립 실행 가능한 schema/expand/finalize를 생성하고 `db:check`로 일치를 확인한다. 테스트 fixture의 legacy SQL은 변경 전 HEAD의 스키마만 포함하며 실제 학생 데이터는 없다.

브라우저 검증용 PowerShell (실제 운영 환경변수 사용 금지):

```powershell
$env:VITE_SUPABASE_URL='http://127.0.0.1:5174/fixture'
$env:VITE_SUPABASE_ANON_KEY='fixture'
$env:VITE_LEADERBOARD_TABLE='apex_leaderboard'
$env:VITE_LEADERBOARD_PUBLIC_VIEW='apex_leaderboard_public_v2'
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
# 다른 터미널:
npm run test:browser:leaderboard
$env:TEST_ORIGIN='http://127.0.0.1:5174'
node tests/modeEffects.browser.mjs
```

기본 브라우저는 설치된 Edge. `TEST_BROWSER`로 Playwright channel을 바꿀 수 있다. fixture는 메모리 저장소·합성 v2 결과를 사용하며 모든 외부 요청을 차단한다. `?submit=success`도 메모리 응답이다. 스크린샷과 결과는 gitignore된 `verification.local/`에만 저장한다. 1440×900, 1024×768, 390×844에서 두 scope, Top 3, 83/42 경계 동점자, 80자 학교명, 큰 점수, 오류/로딩/빈 결과, ESC/화살표/focus 복원, 학교 입력 길이, localStorage 승격, 도전 완료→제출→갱신 및 PB 보존을 검사한다.

기존 client identity/dedupe/RED TEAM 테스트의 책임은 `tests/leaderboardDb.test.ts` 실제 DB 검사로 옮겼다. TS 테스트는 마스킹 이름으로 합치지 않는지와 공개 allowlist/runtime validation을 검사한다. optional verification badge 테스트는 v2에서 verification을 받지도 렌더링하지도 않는 검사로 교체했다. 기존 modal/모델/seed/개인 최고 기록/파라미터/연출 회귀 테스트는 유지한다.
