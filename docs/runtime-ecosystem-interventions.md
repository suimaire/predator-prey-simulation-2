# 자유 탐구 런타임 생태계 개입

## 시작 상태와 범위

- 작업일: 2026-09-26.
- 저장소: `D:/Codex/260901 science/predator-prey-simulation-2`.
- origin: `https://github.com/suimaire/predator-prey-simulation-2.git`.
- 시작 시 working tree는 clean, `main`과 `origin/main`은 `19d0bac`였다. `git pull --ff-only` 결과 최신 상태였다.
- leaderboard schools v2의 main 병합을 확인했다. 적용 가능한 `AGENTS.md`는 없었다.
- 작업 branch: `feat/runtime-ecosystem-interventions`.
- 실제 동물 이름, 잡식, 새로운 먹이 관계, 에너지 모델은 추가하지 않았다.

## 구현 구조

`ForestSimulation`이 현재 실험의 개체, 런타임 활성 종과 개입 이력을 소유한다. 초기 `foodChainDepth`와 `initial*` 파라미터는 초기 개체 생성에 그대로 사용한다. 초기 2차 소비자 설정에서도 런타임 3차·4차 소비자 도입이 가능하다.

`getActiveSpecies()`는 초기 활성 종과 이번 실험에서 도입된 종을 영양 단계 순서대로 반환한다. 모델의 점유 칸 검사·동작 처리·에너지 흐름과 화면의 숲·개체 수·범례·그래프·피라미드가 이 목록을 공유한다. 한번 활성화된 종은 제거·멸종 후에도 0개체로 관찰할 수 있다.

`InterventionSession`은 UI의 일시정지/확인/취소를 관리한다. 실험 인스턴스와 step을 함께 확인하여 다른 실험이나 Apex에 남은 동작을 적용하지 않는다.

## 도입, 개체 생성과 RNG

- `introduceSpecies(species, amount)`는 현재 빈 칸을 seeded RNG로 섞어 새 개체를 배치한다. 기존 개체의 위치·나이·에너지·번식 관련 상태, 식생, 통계, 현재 step, 설정은 보존한다.
- 초기 생성과 런타임 도입이 `availablePositions()`, `populateSpecies()`, `createAgent()`를 공유한다. 기존 에너지 초기 비율, 나이 0, ID 발급 및 한 칸 한 동물 규칙을 사용한다.
- 기존 초기 개체 수 제한(토끼 400, 늑대 160, 3차 40, 4차 20)을 `POPULATION_LIMITS`로 공유한다. 한 번의 도입 상한은 이 값과 현재 빈 칸 수 중 작은 값이다. 현재 총 개체 수의 안전 상한은 기존 공간 규칙으로 제한된다.
- 정수가 아니거나 빈 칸 수/기존 한도를 초과하는 요청은 부분 적용 없이 거부하며 RNG를 소비하지 않는다.
- RNG 알고리즘이나 seed 생성 계약을 바꾸지 않는다. 도입은 해당 실험의 RNG를 소비하고, 제거는 RNG를 소비하지 않는다. 같은 초기 조건과 같은 개입 순서·step·종·수량이면 같은 결과를 재현한다.
- 주요 먹이가 없으면 안내만 표시하고 도입을 허용한다. 이후 변화는 기존 사냥·에너지·기아·자연사 규칙으로 결정된다.

## UI와 정지 의미론

생태계 설계와 실시간 생태 피라미드 사이에 작은 생태계 개입 카드를 추가했다. 3차·4차 바로 도입 버튼, 전체 종 도입·재도입, 종 제거와 최근 개입 한 건을 제공한다. 토끼·늑대도 같은 대화상자에서 다시 도입할 수 있다.

1. 개입 버튼의 클릭 처리 중 즉시 `setRunning(false)`를 호출한다. 같은 JavaScript 작업에서 step을 고정하므로 다음 animation tick 전에 정지한다.
2. 대화상자가 열려 있는 동안 simulation tick은 진행하지 않는다.
3. 확인하면 그 step에 개입하고 일시정지를 유지한다. 사용자가 Run을 눌러 재개한다.
4. 취소나 ESC는 열기 전 running 상태를 복원한다. 처음부터 paused였다면 그대로 유지한다.
5. 기존 `DialogController`의 native modal, Tab 순환, ESC, 스크롤 잠금과 opener focus 복원을 재사용한다.

시뮬레이션 속도와 초기 설정 modal 값은 개입으로 바뀌지 않는다. Apex에서는 카드를 숨기며, UI 외부에서 버튼 이벤트를 호출해도 session 경계에서 개입을 거부한다.

## 제거와 재도입

`removeSpecies()`는 대상의 현재 살아 있는 개체만 제거한다. 제거 수량과 결과 0을 이벤트에 저장한다. 다른 종, 식생, step, RNG와 기존 그래프 데이터는 유지한다. 3차 제거 시 4차는 그대로 남아 기존 규칙으로 이후 행동한다.

재도입은 새로운 ID·나이·초기 에너지를 가진 개체를 현재의 빈 칸에 넣는 새 이벤트다. 과거 생태계나 과거 개체를 복원하는 Undo가 아니다. 제거 표시를 해제하여 다시 동작·번식할 수 있게 한다.

## 이벤트, 그래프와 Reset

이벤트에는 `kind`, `step`, `species`, 실제 `amount`, `resultingCount`를 저장한다. 배열 순서로 같은 step 안의 개입 순서를 보존한다. wall-clock time, localStorage, leaderboard에 의존하거나 저장하지 않는다.

개입 시 기존 그래프 표본을 덮어쓰지 않고 같은 step의 변경 후 표본을 추가한다. 그 순간 기존 history를 자르지 않는다. 다음 일반 tick부터 기존 480개 표본 rolling window를 적용한다. 따라서 무한 전체 이력 보관으로 바뀌지 않는다. downsampling에서도 개입 step의 표본은 남긴다. 개체 수 증감 비교는 중복 표본 수가 아니라 실제 5 step을 기준으로 한다.

같은 step의 이벤트는 수직선 하나로 묶고 Step/종/수량을 표시한다. 화면 라벨은 최대 3개 이벤트와 나머지 건수로 제한하며, 전체 내용은 그래프의 native tooltip과 그래프 아래 텍스트에서 확인한다. 최근 개입 카드는 마지막 한 건만 표시한다.

Reset, 실험 조건 적용, 새 simulation 생성과 mode 전환 시 런타임 종과 이벤트·그래프를 초기화한다. 저장된 초기 파라미터로 다시 생성한다. 초기 2차 조건에서 추가했던 상위 소비자는 Reset 후 사라진다.

## Apex 및 변경 금지 영역

`src/challenge.ts`, `src/seed.ts`, leaderboard 구현·공개/개인정보 계약, Supabase, SQL, Pages workflow, `src/modeEffects.ts`, `src/borderFlames.ts`는 변경하지 않았다. `apex-v1`, challenge seed와 점수 규칙도 그대로다.

공유 모델의 초기 생성 코드 추출에 따른 회귀를 확인하기 위해 변경 전 `19d0bac:src/model.ts`로 baseline fixture를 만들었다. 무개입 4개 설정의 0–600 step 전체 상태·에너지 흐름 hash와 Apex 3개 설정의 모든 상태·최종 점수·붕괴 step이 일치한다. Apex 점수/붕괴 쌍은 43/44, 46/47, 9/10이다.

## 변경 파일

| 파일 | 변경 |
| --- | --- |
| `src/model.ts` | 런타임 활성 종, 도입/제거 이벤트, 초기 개체 생성 공유, history 보존 |
| `src/interventions.ts` | 일시정지 transaction, 모드/실험 검사, 이벤트 라벨/그룹 |
| `src/main.ts` | 개입 카드·대화상자, runtime 종에 따른 숲·피라미드·그래프 연결 |
| `src/charts.ts` | 동일 step 이벤트 묶음, marker, tooltip, 런타임 계열 |
| `src/feedback.ts` | 같은 step 표본이 여러 개일 때도 5 step 비교 유지 |
| `src/simulation.css` | 개입 카드/대화상자의 기존 디자인 적용과 반응형 배치 |
| `tests/interventions.test.ts` | 도입·제거·재도입·공간 제약·정지·재현성·Apex baseline 검사 |
| `tests/fixtures/intervention-baseline.json` | 변경 전 main 실행 hash와 Apex 점수/붕괴 fixture |
| `tests/interventions.browser.html`, `tests/interventions.browser.mjs` | production에서 제외되는 격리 브라우저 fixture와 실제 UI 검증 |
| `tests/model.test.ts`, `tests/feedback.test.ts` | 확장된 이벤트 필드와 변경 전·후 표본 검증 |
| `tests/challengeActions.test.ts`, `tests/modeNavigation.test.ts`, `tests/parameterLayout.test.ts` | 기존 VM 검증의 dialog 이름과 template 의존성 갱신 |
| `package.json` | `test:browser:interventions` 실행 명령 |
| `docs/runtime-ecosystem-interventions.md` | 이 구현·검증 기록 |

## 검증

- 단위/통합 테스트: `npm test` — 114개 통과. 기존 challenge, seed, leaderboard와 PGlite DB 테스트 포함.
- 타입/배포용 bundle: `npx tsc --noEmit`, `npm run build` 통과.
- whitespace: `git diff --check` 통과.
- 실제 Edge: `npm run test:browser:interventions` 통과. 테스트의 시간을 제어하면서 실제 animation loop·클릭·native dialog·DOM·canvas를 실행한다.
- 실제로 초기 2차 조건에서 40 step/s로 519 step까지 진행한 뒤 3차 3마리를 도입했다. 개입 전후 식생·다른 종·통계·history·초기 설정 보존, dialog 중 tick 없음과 confirm 후 paused를 검증했다.
- 제거 후 재개·재도입, 단독 4차 도입, 3차 제거 후 4차 유지, 늑대 재도입, Reset, 설정 적용과 mode 전환 초기화, Apex 강제 클릭 차단을 검증했다.
- 320×740, 390×844, 1024×768, 1440×1000: 페이지/카드/dialog 가로 overflow와 버튼 겹침 없음. 정수/범위 validation, 먹이 없음 안내, Tab/Shift+Tab, Enter, ESC, 취소와 focus 복원 통과.
- 기존 Apex mode transition 브라우저 테스트 9개 그룹, 불꽃 경계 테스트 11개 그룹 통과. 브라우저 JavaScript 오류와 외부 쓰기 없음.
- 화면 증거와 결과는 gitignore된 `verification.local/interventions/`, `verification.local/apex-transition/`에 저장하고 스크린샷을 직접 확인했다.

브라우저 재실행:

```powershell
npm run dev -- --host 127.0.0.1 --port 5176 --strictPort
# 다른 터미널
npm run test:browser:interventions
```

서버 주소는 `TEST_ORIGIN`, 브라우저 channel은 `TEST_BROWSER`로 조정할 수 있다. 기본 channel은 `msedge`다. fixture는 브라우저 저장소를 격리하고 runner는 외부 요청을 차단한다. 운영 점수 제출이나 DB 변경은 없다.

## 다음 단계의 확장 지점

- 새 종의 정의: `Species`, `SPECIES_ORDER`, `speciesConfigs()`, `POPULATION_LIMITS` 및 기존 색상/그리기 registry.
- 도입/제거 생명주기: `introduceSpecies()`, `removeSpecies()`, `InterventionSession`과 이벤트 그룹은 종 이름에 의존하지 않으므로 재사용 가능하다.
- 잡식 모델: 현재 `SpeciesConfig.preyType`과 `processPredator()`는 기존의 단일 먹이를 전제로 한다. 다음 단계에서 다중 먹이 선택·에너지 획득 계약을 별도로 설계하고 deterministic 검증을 추가해야 한다. 이번 변경에는 이 설계를 선행 적용하지 않았다.
- 초기 조건과 runtime 활성 종은 분리되어 있어, 새로운 먹이 관계를 추가하더라도 개입이 초기 설정이나 Reset 의미를 바꾸지 않는다.

main merge와 Pages 배포는 수행하지 않는다. feature branch commit/push 결과는 최종 응답과 Git 이력에 기록한다.
