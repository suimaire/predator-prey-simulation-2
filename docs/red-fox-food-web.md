# Phase 2 — Red Fox Omnivore & Food-Web v1

## 작업 기준과 범위

- 저장소: `D:/Codex/260901 science/predator-prey-simulation-2`.
- origin: `https://github.com/suimaire/predator-prey-simulation-2.git`.
- 작업 branch: `feat/red-fox-food-web`.
- 최신 원격 조회 후 base: `2fce748f38d734b9c1c0cfef800b1cb4ea91439b` (main/origin/main).
- Phase 1.1 `75bc12603b49d5a2723420ec887c600f804105d5`가 이미 main에 병합되어 있었다. 두 커밋의 파일 내용은 동일했다. 시작 working tree는 clean이며 적용할 AGENTS.md는 없었다.
- 완성 커밋과 push 결과는 feature branch의 Git 이력 및 최종 작업 응답에 기록한다. main 병합, Pages 배포, 운영 DB 작업은 이 작업에 포함하지 않는다.

## 생물학적 사실과 교육용 가정

붉은여우는 잡식성이며 작은 포유류·토끼류와 열매 같은 식물성 먹이를 이용한다. 출처: [미국 국립공원청의 Red Fox](https://home.nps.gov/articles/red-fox.htm), [인디애나 자연자원부의 Red fox](https://secure.in.gov/dnr/fish-and-wildlife/wildlife-resources/animals/red-fox/).

이 구현은 실제 식단 전체를 재현하지 않는다. 열매 등 **식물성 먹이**는 별도 fruit object 없이 현재 식생 자원을 proxy로 쓴다. 여우가 풀을 뜯어먹는다는 뜻이 아니다. 아래 에너지, 확률, 수명, 밀도, 개체수 상한은 실제 측정값이 아닌 **단위 없는 교육용 model tuning 값**이다. 늑대와의 직접 공격이 없다는 것은 이번 모델의 범위이며 자연계 모든 상호작용에 대한 주장이 아니다.

## 기존 핵심 값과 최종 여우 값

기존 네 종의 파라미터는 변경하지 않았다. 표의 음식 에너지는 전달 효율 10% 기준이다.

| 종 | step당 소비 | 식사 획득 | 번식 문턱 | 조건 충족 시 번식 확률 | 자식에게 이전하는 현재 에너지 | 최대 나이 |
|---|---:|---:|---:|---:|---:|---:|
| 토끼 | 1.5 | 식생 5 | 18 | 0.12 | 40% | 85 |
| 늑대 | 2.2 | 토끼 10 | 28 | 0.02 | 42% | 120 |
| 3차 소비자 | 1.15 | 늑대 15 | 30 | 0.014 | 42% | 145 |
| 4차 소비자 | 0.9 | 3차 18 | 34 | 0.008 | 42% | 170 |
| **붉은여우** | **1.7** | **토끼 8 / 식물성 0.5** | **24** | **0.018** | **42%** | **110** |

여우의 최종 사냥 성공확률은 **0.70**, 탐색 거리 1칸(주변 8칸), 먹이 후보가 없을 때 이동 확률 0.94, 개체수 상한 80, 기본 도입량 4다. 최대 나이는 토끼 85와 늑대 120 사이로 시작했다. 기본 도입 에너지는 기존 spawn helper의 `24 × (0.55 + RNG × 0.30)`이며 나이는 0이다. 독립 초기 설정/생성 항목은 없다.

식물 획득량을 0.5로 둔 이유는 효율 slider의 최대 30%에서도 `0.5 / 0.1 × 0.3 = 1.5 < 소비 1.7`이기 때문이다. 토끼 없이 매 step 식물을 먹더라도 에너지가 순증하지 않고, 도입 에너지는 번식 문턱보다 낮으므로 plant-only 도입 집단은 번식하지 않는다. 토끼를 먹고 고에너지를 축적한 집단은 토끼가 사라진 직후 한동안 번식할 수 있지만, 식물만으로 에너지가 장기 순증하는 구조는 아니다.

## 종 구조와 행동

`CoreSpecies`와 `CORE_CHAIN_ORDER`는 `rabbit → wolf → tertiary → quaternary`다. 기존 `SPECIES_ORDER`는 이 순서의 호환 이름이며 `activeSpecies(depth)`는 여기만 사용한다. `RUNTIME_SPECIES`는 별도로 `rabbit, wolf, fox, tertiary, quaternary`를 정의한다. 따라서 “2차 소비자까지”는 여전히 토끼+늑대다.

`fox`는 독립 `Species`이며 `FOX_CONFIG`에 별도 정의를 둔다. 고정 영양 단계 대신 `trophicLevel: null`과 잡식 표기를 사용한다. `FOOD_SOURCES`가 허용된 edge 목록을 모으고, 기존 `preyType`은 기존 포식자 루틴과 여우의 우선 동물성 먹이를 지정한다. `SpeciesConfig.omnivory`를 가진 종은 새 잡식 행동을 사용한다. 기존 포식자를 새 generic 알고리즘으로 교체하지 않았다.

허용 연결:

```text
식생 → 토끼 → 늑대 → 3차 소비자 → 4차 소비자
          └→ 붉은여우 ← 식물성 먹이(식생 proxy)
```

여우·늑대 사이와 여우·상위 소비자 사이에는 직접 포식 edge가 없다. 공통 토끼와 공유 공간을 통한 상호작용만 발생한다. 다른 새 종, scavenging/carrion, 계절, 질병, 성별, 영역, numeric trophic position은 추가하지 않았다.

여우 한 step:

1. 기존처럼 나이 +1, 기초 에너지 차감.
2. 기존 이웃 칸/점유 맵에서 토끼 후보 탐색.
3. 후보가 있으면 기존 방식의 seeded 균등 선택 후 성공확률 0.70 판정. 성공하면 토끼 정확히 한 마리를 제거하고 그 칸으로 이동하며 에너지를 전달한다. 실패하면 섭식 종료, 같은 step에 식물을 먹거나 재시도하지 않는다.
4. 후보가 없을 때만 기존 확률 이동 후 현재 칸의 식물성 먹이 확인.
5. `eatPlant()`를 토끼와 공유한다. 현재 칸의 식생 단계가 1 이상일 때만 정확히 1 줄이고 에너지를 전달한다. 단계 0에서는 얻는 에너지가 없다.
6. 기존 `tryReproduce()`로 번식, 이어 에너지 고갈/최대 나이 사망 판정. 자식 에너지는 부모에게서 이전한다. 80마리 상한은 여우에게만 적용한다.

## 처리 순서, 난수와 정확한 회귀

식생 성장 → 토끼 → 늑대/여우 → 기존 상위 소비자 순서를 사용한다. 살아 있는 여우가 있을 때만 동일 seeded RNG로 50:50 무리 순서를 결정한다. 한 무리는 기존 seeded shuffle로 개체 순서를 섞는다. 개체 단위 교차 처리는 도입하지 않아 기존 포식자 semantics를 보존했다. 여우가 사라지면 무리 순서 RNG를 더 이상 소비하지 않는다. 배치/사냥/먹이 선택/번식/순서/부분 제거 모두 기존 RNG를 사용하며 새 `Math.random()`은 없다.

여우를 도입하기 전에는 snapshot의 `agents`, 누적 통계, 그래프 표본에 fox 필드도 추가하지 않는다. 도입 후에만 선택적 필드가 생긴다. Apex의 parameter snapshot과 challenge ID/version/seed/score 알고리즘을 보존했다. `challenge.ts` 변경은 필요한 영양 단계 타입을 `CoreSpecies`로 한정한 것뿐이다.

**구현 전에** `git show 75bc126...:src/model.ts` / `challenge.ts`를 로드하여 고정 fixture를 확보했다. `scripts/capture-fox-free-baseline.ts`는 언제나 그 Git object를 읽고 기존 파일 덮어쓰기를 거부한다. 현재 결과로 baseline을 갱신하지 않는다.

9개 시나리오의 **3,742개 시점**에서 SHA-256으로 완전 직렬화 상태가 일치했다. 여기에는 모든 식생 칸, 네 종의 ID/좌표/에너지/나이/순서, 출생/사망/섭식 통계, 다음 ID, RNG 내부 상태, 기존 섭식 로그, 전체 rolling 그래프, 개입 이력, 에너지 흐름, Apex 상태가 포함된다. 기본/다른 seed/전달 효율/4단계/부분 제거·전체 제거·재도입의 조합을 포함한다.

| Apex 조건 (고정 seed 260903) | 붕괴 step | score | 비교 |
|---|---:|---:|---|
| 기본 | 44 | 43 | exact |
| 토끼110·늑대30·3차10·4차4 | 18 | 17 | exact |
| 전달 효율20% | 71 | 70 | exact |

대표 회귀 fixture는 유한한 시나리오 검사이며 모든 가능한 입력에 대한 수학적 증명은 아니다. 다만 여우가 없는 경로에서는 새 난수·동물·자원 행동을 실행하지 않도록 구조적으로 분리했다.

## 에너지 흐름과 UI

두 여우 먹이원 모두 기존 `energyGainFromFood(nominal, efficiency)`를 사용한다. 실제 획득 에너지는 `nominal / 0.1 × efficiency`다. `rabbit → fox`와 `vegetation → fox`는 서로 다른 edge로 기록된다. UI는 후자를 **식물성 먹이 → 붉은여우**라고 표시한다.

기존 소비자 에너지 지표와 8,000개 event 제한을 유지했다. 여우는 별도로 **step별 두 edge 에너지/횟수 합계**를 최대 480개 기록만 보관하여 event 폭주로 최근 식단 자료가 잘리는 문제를 피한다. 메모리는 실행 길이에 비례해 증가하지 않는다. 기존 종의 event cap 특성은 변경하지 않았다.

- 에너지 흐름: 최근 20 step의 실제 전달 에너지 합 / 경과 step.
- 여우 식단: 최근 50 logical steps의 `각 먹이 전달 에너지 / 두 먹이 전달 에너지 합 × 100`. 사건 횟수 비율이 아니다. 정수 표시 시 두 비율 합은 100%다. 합이 0이면 비율은 null이고 “최근 섭식 없음”이다.
- 여우가 한 번도 없으면 기존 피라미드와 기존 graph series를 유지한다. 여우 도입 후 제목은 “실시간 영양 구조”이고 기존 core 막대와 별도 잡식 카드가 함께 표시된다. 여우를 두 영양 층에 중복 배치하지 않는다.
- 여우 count와 두 음식의 실제 에너지 rate, 최근 식단, 허용된 edge, proxy 설명을 표시한다. 기존 영양 단계와 여우를 같은 고정 단계로 세지 않는다.
- 상단 population summary는 여우가 있을 때 자동 줄바꿈하는 grid를 사용한다. 독립 여우 얼굴 아이콘과 갈색 주황 계열 색을 추가했다.
- 그래프의 도입 전 fox 표본은 absent로 저장하고 렌더링은 0이다. 이후 멸종/제거 시 0이 계속 기록된다. 범례 toggle, 기존 intervention marker, 480-sample window를 유지했다. 개입 순간 기존처럼 같은 step 표본을 추가 보존하고 다음 일반 tick에서 window 제한을 적용한다.
- 누적 “동물 사냥 성공”에는 여우 식물 섭식을 포함하지 않는다. 식생 소비 누적치는 여우가 도입되면 “동물이 먹은 식생”으로 설명한다.

## 개입, 제거와 Reset

기존 [생태계 개입 계약](runtime-ecosystem-interventions.md)을 그대로 사용한다. `InterventionSession`, spawn/빈칸 배치/ID, `introduceSpecies`, seeded partial Fisher–Yates 제거, 기존 events와 graph markers를 재사용한다. 여우 전용 제거 경로는 없다. 일반 selector에도 여우가 포함된다.

실행 중 버튼 → 현재 step pause → dialog → confirm → 같은 생태계에 도입 → paused 유지. 취소/ESC는 기존 실행 여부를 복원하고 opener로 focus를 돌린다. 다른 종의 상태와 기존 graph samples를 초기화하지 않는다. 여우 도입 시 새 0 통계 필드를 추가하지만 기존 통계 값은 보존한다.

8마리 중 50% 제거는 4마리를 남긴다. 전체 제거는 선택 RNG를 소비하지 않는다. 부분/전체 제거, 자연 멸종 후에도 runtime-active history를 보존하므로 Reset 전까지 여우 0, 식단 window, 영양 구조, 범례가 남는다. 다시 도입하면 새 ID를 발급한다. Reset은 원래 초기 조건, 식생, RNG, 통계를 복원하고 여우 활성 이력·섭식 기록·개입 기록을 없앤다.

Apex에서는 개입 카드가 숨겨지고 selector에 fox option이 없다. hidden button 강제 이벤트도 `InterventionSession` mode guard에 막힌다. 신규 실험 생성 후 여우/먹이그물/여우 난수는 없다. leaderboard와 Supabase 파일, simulationVersion은 변경하지 않았다.

## Calibration 결과와 tuning

`npm run calibrate:fox`: 제품 UI와 분리된 deterministic 개발 harness. `FOX-CAL-001`–`050`, 각 **600 steps**, 최종 6개 조건 × 50 seeds = **300 runs / 180,000 steps**. 전체 결과는 [fox-calibration.json](fox-calibration.json), 초기 30-seed tuning 비교는 [fox-tuning.json](fox-tuning.json). `FOX_SEEDS`, `FOX_TUNING`, `FOX_REPORT` 환경변수는 이 개발 script에서만 사용한다. seed 목록과 결과 모두 저장한다.

아래 “멸종”은 step 600까지의 발생 여부이며 초기부터 없는 종은 —로 표시한다. cap은 여우 80마리다.

| 조건 | Seeds | 600 step 여우 생존 | 토끼 멸종 | 늑대 멸종 | cap 도달 | 여우 생존 중앙값 | 평균 출생 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 먹이 전혀 없음 | 50 | 0 | — | — | 0 | 12 | 0 |
| 식물만 / 효율10% | 50 | 0 | — | — | 0 | 16 | 0 |
| 식물만 / 효율30% | 50 | 0 | — | — | 0 | 92 | 0 |
| 토끼 + 여우 | 50 | 27 | 9 | — | 0 | ≥600 | 111.58 |
| 토끼 + 늑대 + 여우 | 50 | 1 | 38 | 48 | 0 | 150 | 13.66 |
| 토끼 + 늑대 대조군 | 50 | — | 38 | 47 | — | — | — |

식물성 먹이는 기아를 완화하지만 최대 효율에서도 출생이 없었다. 토끼가 있는 두 여우 조건 모두 20 step 이내 여우·토끼 멸종이 없고, 전체 먹이그물에서도 늑대의 20 step 이내 멸종은 없었다. 여우 최고 개체수는 토끼+여우에서 45, 전체 먹이그물에서 32였다. 조건별 식물성 에너지 비중은 각 seed의 **전체 실행 누적 에너지 비율**을 평균/중앙값으로 요약했다(UI의 rolling 50-step 값과 다름).

| 조건 | 식물성 비중 평균 / 중앙값 | 토끼 비중 평균 / 중앙값 | 평균 식생 밀도 |
|---|---:|---:|---:|
| 식물만10% | 100 / 100% | 0 / 0% | 99.84% |
| 토끼 + 여우 | 7.61 / 7.48% | 92.39 / 92.52% | 26.36% |
| 전체 먹이그물 | 13.59 / 13.70% | 86.41 / 86.30% | 72.28% |
| 토끼 + 늑대 대조군 | — | — | 70.21% |

전체 먹이그물은 step50에서 50/50 공존, step100에서 38/50 공존 및 12/50 토끼 소실 후 포식자 잔존, step200에서 공존3 / 토끼+늑대4 / 토끼6 / 모두 소실37이었다. step600에는 모두 소실38 / 토끼만9 / 토끼+늑대2 / 토끼+여우1이다. 동일 국소 규칙+seed 차이로 결과가 나뉘며 결과를 강제하는 분기 코드는 없다.

**조정 과정:** 처음 0.65 사냥 성공확률, 소비1.7, 토끼획득8에서 전체 먹이그물 30 seeds 모두 여우가 600 step 전에 소실했다. 성공확률만 0.70으로 바꾸면 1/30이 생존했다. 소비1.6·획득9까지 바꾸는 대안은 4/30 생존했지만 토끼 멸종이 23/30에서 26/30으로 늘었다. 그 대안에 사냥0.60을 적용한 경우도 1/30 생존·토끼26/30 멸종이었다. 추가 parameter 변경의 이득보다 토끼 붕괴와 복잡성이 커, **성공확률만 0.70으로 변경**했다. 기존 네 종의 값은 전혀 조정하지 않았다.

기본 전체 먹이그물의 장기 공존은 드물다는 한계가 남는다. 대조군의 토끼 멸종도 38/50이므로 여우가 거의 모든 seed에서 즉시 붕괴를 강제하는 현상과 구분해야 한다. 이 수치를 자연계 빈도·예측으로 해석하지 않는다. 고정된 무리 우선순위를 쓰지 않으며, 1,000-step 순서 검사에서 양쪽 모두 43–57% 범위와 동일 seed 재현을 확인했다.

## 검증과 재현

- `npm run test:fox`: **24/24** (새 행동 15 + exact 회귀 9). 섭식 성공/실패/이중 섭식 금지/무식량/효율/자원 단계, 종 관계, 개입·제거·Reset, cap/점유, 순서/RNG, rolling 비율/메모리, UI/graph, 6-seed 축소 calibration을 포함한다.
- `npm test`: 기존 124 + 신규24 = **148/148**.
- `npx tsc --noEmit`, `npm run build`, `npm run db:check`, `git diff --check`: 통과. DB 검사는 로컬 생성 SQL 일치 검사다.
- 실제 설치된 **Microsoft Edge 153.0.4234.48**, Playwright headless에서 `npm run test:browser:fox`와 기존 `npm run test:browser:interventions`를 통과했다. 테스트 시간 제어는 실제 앱 animation loop를 구동하며 모델 테스트용 setter를 제품에 노출하지 않는다.
- 40 step/s로 수백 step 진행 → 여우4 도입 → 현재 step/기존 개체/graph 보존·paused 확인. 토끼50%, 늑대50%/전체, 여우50%/전체/재도입, 늑대 재도입을 같은 history에서 검사했다. 실제 diet 예시는 토끼224 / 식물45 에너지 = 83.27 / 16.73%였다.
- 자연 멸종은 model test, 전체 제거 후 fox0 영양 구조 및 50-step 경과 후 빈 식단, Reset 피라미드 복귀는 Edge에서 검사했다. 상위 두 종까지 도입한 화면에서 먹이 연결을 확인했다.
- **1440×900, 1024×768, 390×844, 320×740**의 population summary, 개입 카드, 두 영양 구조 모드, 범례, 식단, 여우 도입·제거 dialog를 검사했다. 가로 overflow/버튼 겹침/입력 겹침 없음. 생성한 스크린샷도 육안으로 확인했다.
- Tab/Shift+Tab 순환, Enter/Space, ESC, 실행·일시정지 각각의 취소 복원, focus 복귀를 검사했다. 기존 `DialogController`를 재사용한다. 별도 screen reader나 실제 모바일 하드웨어 검사는 수행하지 않았다.
- Apex UI에 여우가 없고 강제 hidden event로 상태 변경이 되지 않으며, 기본 붕괴44/score43을 실제 브라우저에서 확인했다. JavaScript 오류 **0**, 외부 쓰기 **0**.
- 로컬 결과/스크린샷: `verification.local/fox/results.json`, `numbers-{width}.png`, `energy-{width}.png`, `introduce-{width}.png`, `remove-{width}.png`, `apex-isolated.png`; 기존 개입 검사는 `verification.local/interventions/`. 이 임시 자료는 gitignore된다.
- 모델+에너지 질의 600-step 측정(48열, 토끼200·늑대30·여우40 시작): 중앙값 3.17ms, p95 5.33ms, 최대8.03ms. 해당 기계의 1회 측정이며 화면 렌더링 성능 보장은 아니다. 새 전체-grid×species 순회는 추가하지 않았고 기존 local neighborhood/점유 맵을 재사용한다.

로컬 브라우저 재현 예:

```text
npm run dev -- --host 127.0.0.1 --port 5177
npm run test:browser:fox
```

기존 개입 브라우저 검사는 기본5176을 쓰므로 같은 서버를 사용하려면 `TEST_ORIGIN=http://127.0.0.1:5177`을 설정한다. 사용자 환경에서 포트가 다르면 두 script의 `TEST_ORIGIN`을 맞춘다. 브라우저 script는 모든 외부 요청을 차단한다.

## 변경 파일과 다음 확장 지점

모델/UI: `src/model.ts`, `src/charts.ts`, `src/feedback.ts`, `src/main.ts`, `src/simulation.css`, `src/foodWebView.ts`. Apex 타입 한정: `src/challenge.ts`.

검증: `tests/fox.test.ts`, `tests/fox-regression.test.ts`, `tests/fox.browser.mjs`, `tests/fixtures/fox-free-scenarios.ts`, `tests/fixtures/fox-free-baseline.json`, `tests/interventions.browser.html`. 기존 VM 테스트의 종 registry 주입만 `tests/modeNavigation.test.ts`, `tests/parameterLayout.test.ts`에서 확장했다.

개발·문서: `scripts/capture-fox-free-baseline.ts`, `scripts/calibrate-fox.ts`, `package.json`, `README.md`, `docs/runtime-ecosystem-interventions.md`, 이 문서, `docs/fox-calibration.json`, `docs/fox-tuning.json`.

다음 Phase는 `FOOD_SOURCES`/종 config와 별도 feeding strategy, step별 에너지 집계, 기존 intervention infrastructure를 확장할 수 있다. 새 종을 core trophic depth에 끼워 넣을 필요가 없다. 이번에는 붉은여우 한 종만 구현했다. 식물 자원 분리, 실제 먹이 가용성/계절 변화, 개체 단위 경쟁 순서는 별도 가정과 검증이 필요한 후속 범위다.
