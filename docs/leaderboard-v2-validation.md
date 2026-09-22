# Leaderboard v2 구현·검증 기록

검증일: 2026-09-22. 대상은 `suimaire/predator-prey-simulation-2`이며 EUREKA와 무관하다.

## 시작 상태

- 실제 root: `D:/CODEX/260901 science/predator-prey-simulation-2`
- 시작 branch/HEAD: `main`, `0a97961911d9709d448cda9256491775fbafc429`
- origin: `https://github.com/suimaire/predator-prey-simulation-2.git`
- origin fetch 후 main과 origin/main은 같은 HEAD였다.
- 적용 가능한 AGENTS.md를 찾지 못했다.
- 기존 미추적 `audit_output/`, `tools/`는 수정하거나 stage하지 않는다.
- 기능 branch: `feat/leaderboard-schools-v2`. main으로 승격하지 않는다.
- 기존 Pages push trigger는 main만이었다. 추가 gate는 main + `LEADERBOARD_V2_DB_READY=true`다.

## 구현한 파일

| 범위 | 파일 |
| --- | --- |
| 공개/제출 계약, validation, pagination, storage | `src/leaderboard.ts` |
| scope별 상태/오래된 응답 보호 | `src/leaderboardState.ts` |
| 마스킹 이름·학교 renderer | `src/leaderboardView.ts` |
| 두 scope, 공통 board, 제출 폼 연결 | `src/main.ts` |
| leaderboard 안의 responsive layout | `src/simulation.css` |
| v2 환경변수·배포 gate | `.env.example`, `src/vite-env.d.ts`, `.github/workflows/deploy.yml` |
| SQL 단일 원본 | `supabase/leaderboard-v2/contract.sql`, `install.sql`, `close-legacy.sql` |
| 신규 설치/기존 expand/수동 finalize | `supabase/schema.sql`, `supabase/migrations/20260922_leaderboard_schools_v2.sql`, `supabase/manual-cutover/20260922_finalize_leaderboard_v2.sql` |
| 사전 조사/검증/비공개 진단 | `supabase/preflight/leaderboard_v2.sql`, `supabase/verification/leaderboard_v2.sql`, `supabase/verification/leaderboard_v2_collisions_private.sql` |
| SQL 생성·동기화 | `scripts/build-leaderboard-sql.mjs` |
| 테스트 | `tests/leaderboard.test.ts`, `leaderboardView.test.ts`, `boardGroup.test.ts`, `leaderboardDb.test.ts`, `leaderboard.browser.mjs`, `browser.html`, `fixtures/leaderboardFixtures.ts`, `fixtures/leaderboard-legacy.sql` |
| 명령·검증 의존성 | `package.json`, `package-lock.json` |
| 사용법·운영 절차 | `README.md`, `supabase/LEADERBOARD_V2_RUNBOOK.md`, 이 문서 |

모델·RNG·seed·challenge 점수 및 시작/종료 규칙·parameterSnapshot·해시 알고리즘·그래프·종 제거·공통 DialogController·파라미터 modal·Apex 연출 구현은 변경하지 않았다. main.ts 변경은 leaderboard 연결에 한정한다.

## 실제 실행 결과

| 검사 | 결과 |
| --- | --- |
| 변경 전 `npm test` | 123/123 통과 |
| 변경 후 `npm run test:leaderboard` | 28/28 통과 |
| 변경 후 `npm test` | 96/96 통과 |
| `npx tsc --noEmit` | 통과 |
| `npm run build` | 통과, production bundle 생성. 배포하지 않음 |
| `npm run db:check` | 통과, 신규/expand/finalize와 SQL 원본 일치 |
| `git diff --check` | 통과 |
| `npm run test:browser:leaderboard` | 실제 Edge headless에서 통과, 외부 요청 0 |
| `node tests/modeEffects.browser.mjs` | 기존 연출 9개 그룹 통과, console 오류/외부 쓰기 0 |

DB 검사는 PostgreSQL 18.3 (PGlite 0.5.8) WASM에서 실제 SQL을 실행했다. 정적 SQL 문자열 검사를 DB 보안 검증으로 대신하지 않았다. 역할은 anon/authenticated를 생성하고 Supabase와 유사한 public schema default grants를 둔 뒤 SET ROLE로 검증했다.

실제 확인한 DB 동작: 새 설치와 upgrade의 열·view·index·정책·trigger·권한 계약 일치, id별 모든 기존 값 보존, 출처 미승인 rollback, 타교/부분 학교 정보 보존, 승인된 혼합 학교 mapping, 정규화 중복 rollback, HAFS 별칭·namespace·80자 Unicode·선행 0, 학교별 rate limit, RED TEAM 학교/challenge/version/seed 범위, hidden 및 분류 복원, 대표 최고점/서버 시각/id, 이름 마스킹, 원본/registry/관리 열/RPC 권한, 정상 INSERT, 학교 미입력 거절, finalize 확인 guard 및 구 endpoint 제거, schema 재실행 시 구 endpoint 미복원.

원본 쿼리 hash fixture는 변경 전 HEAD와 동일한 `6cbc2d568b519bf8ea6e8b470fae7e480df64ec378167bd3090a61f993f944fa`다. 학교·학번·이름을 바꾸어도 같은 simulation record의 hash가 유지된다.

기존 테스트 수 감소는 client identity/RED TEAM 중복 판정을 제거하면서 그 책임을 실제 DB 테스트로 옮긴 결과다. SQL 텍스트 검사 및 client raw 학번/실명 테스트를 서버 역할·identity·마스킹 실행 검사로 대체했다. 클라이언트에는 같은 학교/마스킹 이름을 합치지 않는 테스트를 추가했다. verification badge 노출 테스트는 verification을 받아도 복사·렌더링하지 않는 검사로 바꾸었다. 모델·개인 최고 기록·modal·파라미터·연출 회귀 테스트는 유지했다.

## 브라우저에서 확인한 내용

- 1440×900, 1024×768: 전국/HAFS 좌우 배치. 390×844: 세로 배치, 스크롤로 HAFS 접근.
- 요약 각각 최대 3행. 상세 전국 83행/HAFS 42행 경계 동점자 유지. 작은 서버 페이지(3행)로도 끝까지 수신.
- 80자 학교명, 1,000,000점, 학교/이름/점수 영역 겹침 및 수평 overflow 없음.
- 빈 결과, 로딩, 전체 오류, HAFS만 실패, 실패 시 이전 결과 표시.
- 공통 부문 전환, 올바른 aria-controls, 중복 id 없음, 화살표/Home, Tab/Shift+Tab 순환, ESC 닫기와 opener focus 복원.
- 첫 학교 빈칸, legacy 학번/이름 보존, 깨진 storage 안전 처리.
- 실제 도전을 10-step 설정으로 완료한 뒤 폼 표시, Unicode 학교 80/81자 경계, 제출 중복 클릭 방지, POST 학교 포함/key 제외, 제출 후 갱신과 PB 보존.
- 다른 참가자의 원본 학번/실명이 공개 목록에 없고 학교/표시 이름은 HTML escape됨.

스크린샷은 직접 열어 검토했다. 증거는 gitignore된 `verification.local/leaderboard-v2/`와 `verification.local/apex-transition/`에 있고 운영 학생 데이터는 없다.

## 운영 상태와 남은 조건

| 구분 | 상태 |
| --- | --- |
| 코드 구현 | 완료 |
| 가능한 로컬 검증 | 완료 |
| 운영 DB 전환 | 미실행 |
| 운영 개인정보 공개 경로 폐쇄 | 미실행·미확인 |
| Pages 배포 | 미실행 |

운영 단계 차단 조건: 실제 DB preflight 및 숨은 공개 view/RPC/role 상속 조사, legacy 학교 출처와 id mapping 승인, 복제 DB에서 실제 운영 데이터 보존·충돌 확인, 운영 expand 쓰기 승인, 실제 Supabase/PostgREST v2 HTTP 계약 확인, 환경변수 수정, 배포 승인/gate 설정, v2 frontend 확인 후 finalize 승인 및 구 경로 폐쇄 확인.

PGlite 검증으로 실제 운영 DB의 모든 데이터·role 상속·다중 연결 잠금/동시성·PostgREST HTTP를 통과했다고 주장하지 않는다. 운영 접근이나 가짜 점수 제출은 하지 않았다.

적용 순서는 [runbook](../supabase/LEADERBOARD_V2_RUNBOOK.md)의 preflight → 승인된 expand → v2 검증 → 승인된 frontend 배포 → 별도 수동 finalize → 최종 권한/API 검사다. Git commit/push 결과는 최종 작업 응답과 저장소 HEAD로 확인한다.
