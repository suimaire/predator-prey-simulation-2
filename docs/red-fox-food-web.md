# Red Fox Food Web — Phase 2 / Phase 2.1 / Phase 2.1b

**최신 Phase 2.1b: 관찰 가능한 짧은 변화 흐름을 기준으로 재평가했으며, `.67 / 도입 4마리`의 제품 변경은 불필요하다.** 600-step 장기 공존은 여전히 낮고, 200-step 관찰을 대부분의 시행에 보장하는 것도 아니다. 아래 Phase 2.1의 BLOCKED 기록은 당시 장기 공존 목표에 대한 역사적 결론으로 그대로 보존한다. 새 판정과 한계는 문서 끝 **Observable Dynamics Reassessment** 절에 있다. main/Pages에는 반영하지 않는다.

**현재 Phase 2.1 판정: weighted choice 구현·회귀 검증은 통과했지만, 공존 기본값 튜닝은 BLOCKED다.**
이 feature branch의 평가값은 rabbitPreference **0.67**, plantGain **0.5**다. 정식 배포 기본값으로 채택했다는 뜻이 아니다.
Calibration의 작은 전체 먹이그물 개선이 holdout에서는 유지되지 않았다. 상세 결과는 아래 **Phase 2.1** 절에 있다.
그 절 전까지는 기존 **Phase 2의 역사적 설계·검증 기록**이며, 토끼 우선 fallback 설명과 당시 검증 수치는 현재 동작과 구분한다.

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

## Phase 2.1 — Coexistence calibration (2026-09-26)

### 기준, 실행 계약과 판정

- Branch: `feat/fox-coexistence-tuning`. Base: `e476ff83d08168a9f9e2d8d44fb49c73a3ec6c3d` (`Add red fox food-web simulation`). 원격 fetch 후 main/origin/main은 `2fce748`, Phase 2는 미병합이었다. 시작 상태 clean, 적용되는 AGENTS.md 없음.
- `scripts/calibrate-fox-coexistence.ts`는 기준 모델을 항상 위 Git object에서 읽는다. baseline 저장과 진단 후에만 모델을 수정했다. 기존 `calibrate-fox.ts`의 300-run 결과도 재실행하여 `docs/fox-calibration.json`의 **모든 summary와 모든 row가 exact equality**임을 확인했다. 이 역사적 JSON은 수정하지 않았다.
- Calibration: `FOX-CAL-001`–`FOX-CAL-050`; holdout: `FOX-HOLDOUT-001`–`FOX-HOLDOUT-050`. 수정 전에 확정했다. seed contract는 trim된 40자 이하 문자열이며, 100개 문자열과 초기 RNG 상태 모두 중복 없음. Holdout 결과를 이용한 재튜닝 없음.
- 각 run은 600 steps, 32×21 격자, 초기 여우4를 step0의 runtime introduction으로 도입한다. Plant-only는 토끼0·늑대0·식생100%; Rabbit+Fox는 토끼50·늑대0·식생78%; Full Web은 토끼50·늑대8·식생78%. 식생 재성장0.1, 기본 효율0.1. 대조군은 Full Web에서 여우만 도입하지 않는다. Phase 2와 같은 조건이다.
- 모든 후보는 같은 calibration 50개를 사용한다. 동일 seed 비교이나 source choice 이후 RNG 소비가 달라지므로 모든 후속 난수가 일대일로 대응하는 실험은 아니다.
- **기본값 튜닝 BLOCKED:** Stage A 9개와 진단용 Stage B 3개 중 Full Web 여우 10–25/50 목표에 도달한 후보가 없다. Holdout에서도 전체 먹이그물 개선을 확인하지 못했다. 이 목표는 교육용 탐구 trajectory에 대한 engineering target이며, 자연계 공존·생존 확률이나 측정 식단 비율이 아니다.
- `docs/fox-coexistence-selection.json`에 holdout 실행 **이전**의 평가 후보와 선택 이유를 고정했다. feature branch 평가값은 P=.67/G=.5, secondary parameter 변경 없음. 이 값은 출시 권고가 아니다.

### Baseline 재현과 멸종 진단

각 수치는 50 runs 기준이다. 처음부터 없던 종은 멸종으로 세지 않는다. 아래 단계 중앙값은 **600 step 이내 실제 멸종한 run에 한정**한다. 미멸종을 600으로 censor한 persistence 분포도 raw report에 별도로 저장한다.

| Phase 2 조건 | 여우 생존 | 토끼 멸종 | 늑대 생존 | 여우 멸종 step 중앙값 | 여우 평균 출생 | cap runs |
|---|---:|---:|---:|---:|---:|---:|
| Plant-only 10% | 0 | — | — | 16 | 0 | 0 |
| Plant-only 30% | 0 | — | — | 92 | 0 | 0 |
| Rabbit+Fox | 27 | 9 | — | 393 | 111.58 | 0 |
| Full Web | 1 | 38 | 2 | 149 | 13.66 | 0 |
| Wolf control | — | 38 | 3 | — | — | — |

Full Web 전체 붕괴는 38/50. 여우 persistence 중앙값은 150이며, 멸종 run만의 중앙값149와 구분한다.

- **A — 번식 전 기아만이 원인인가? 아니다.** 49/50 runs에서 출생이 있었다. 사망868 중 기아619·나이249였으며, 기아196개체는 관측된 생애 중 번식 문턱을 넘지 못했다. 나머지 기아423개체는 문턱에 도달한 적이 있었다. 원래 death-cause 필드는 없어서 harness가 기존 사망 조건을 관찰했다. 에너지≤0와 최대 나이가 겹치면 기아로 분류한다.
- **B — 번식 후 계통 유지 실패인가? 그렇다.** 총683 출생, 53,431 fox-agent feeding opportunities 중 37,436회(70.06%)에서 섭식 후·번식 전 에너지≥24였다. 이 시점의 개체-기회 가중 평균 에너지는59.63, 전체 최솟값−1.6832다. 음수는 섭식 이후에도 회복하지 못한 사망 직전 상태를 포함한다. 오래 생존한 개체가 평균에 더 많이 기여하므로 이를 일반 개체의 건강도라고 해석하지 않는다.
- **C — 식물 fallback이 거의 막혀 있는가? 아니다.** 토끼 후보는17,015회(31.84%), 현재 칸 식물도 있는 기회는7,017회(13.13%)였다. 실제 식물 섭식은25,890회, 그중20,110회는 전역 토끼가 아직 존재할 때 발생했다. fallback은 이미 자주 쓰였다. 가중 선택이 직접 바꾸는 것은 두 먹이가 동시에 가능한 일부 기회다.
- **D — 사냥 실패가 비정상적으로 높은가? 아니다.** 17,015 시도 중11,874 성공(69.79%),5,141 실패로 설정0.70과 부합한다. 토끼 에너지94,992·식물12,945, run별 토끼 비중 중앙값86.30%였다.
- **E — 늑대 경쟁 뒤 기회를 잃는가? 일부 관측되나 단독 원인으로 입증되지 않았다.** wolf-first 처리 전에는 이웃 토끼가 있었지만 직후 사라진 fox-step이192회였다. 여우가 없던 대조군도 토끼38/50 멸종이다. Full Web 토끼 멸종 중앙값109.5, 늑대160; 37개 run에서는 토끼가 먼저 사라진 후 여우도 멸종했다. 먹이 기반 붕괴와 제한된 계통 유지가 핵심이며, 이 관찰만으로 인과 기여도를 분리할 수 없다.

계측은 개발 harness의 메서드 래퍼에만 있다. 동작을 복제하거나 새 난수를 사용하지 않는다. `audit`은 기준/현재 모델 각각 세 시나리오에서 계측 유무의 전체 직렬화 상태·rolling diet·RNG 해시, 출생/사망 회계가 동일함을 검사한다. product bundle에는 이 진단·전역 탐색이 포함되지 않는다.

### 가중 선택과 RNG 순서

`chooseFoxFoodSource(rabbitAvailable, plantAvailable, preference, random)`가 선택을 담당하고 기존 사냥/`eatPlant()`가 실행한다.

1. Phase 2와 동일하게 나이+1, 기초 에너지 차감, 거리1의 이웃 토끼 후보를 찾는다.
2. 토끼 후보가 없을 때만 기존 확률0.94의 이동을 수행한다. 이동했다면 **도착한 현재 칸**의 식생을 확인한다. 후보가 있다면 이동하지 않고 현재 칸을 확인한다. 식물을 찾기 위한 추가 이동이나 이웃 칸 식물 검색은 없다.
3. 현재 칸 식생 단계≥1이 plant available이다. 두 먹이가 있으면 seeded draw 1회로 `draw < P`는 토끼, `draw >= P`는 식물을 선택한다. 하나만 있으면 그 먹이, 둘 다 없으면 null이며 source-choice draw는0회다.
4. 토끼 선택은 기존 candidate 선택 RNG 1회 → hunt RNG 1회 순서다. 성공이면 토끼1마리와 토끼 에너지, 실패이면 섭식 종료. 같은 step 식물 fallback/재시도/이중 식사는 없다.
5. 식물 선택은 candidate/hunt RNG를 소비하지 않으며 현재 칸 단계1만 감소한다. 에너지는 기존 `nominal / .1 × efficiency`로 한 번만 전달한다. 이후 번식·사망 순서는 기존 그대로다.

따라서 번식 등 공통 부분을 제외한 난수 순서는 `both→rabbit: choice,candidate,hunt`, `both→plant: choice`, `rabbit-only: candidate,hunt`, `no-rabbit: legacy movement(+destination), no choice/hunt`다. 여우가 없으면 새 선택·순서 RNG가 전혀 실행되지 않는다. 살아 있는 여우가 있을 때만 기존 seeded50:50 wolf/fox 처리 순서를 유지한다. 기본 Full Web 순서 횟수는 baseline **wolf-first4094 / fox-first4102**, 평가 후보 **4234 / 4169**, holdout **3724 / 3777**로 심각한 편향은 관측되지 않았다.

### Stage A matrix와 Stage B

Stage A는 P∈{.80,.75,.67} × G∈{.5,.7,.9}. 사냥0.70·기초소비1.7·토끼획득8·번식문턱24·번식확률0.018·자식이전42%·최대나이110·거리1·이동0.94·cap80과 모든 core species parameter를 고정했다. 모든 후보는 기본 효율10%에서 비교했다.

아래 `RF`는 Rabbit+Fox의 **여우 생존 / 토끼 멸종**, `Full 생존`은 **여우 / 늑대 / 토끼**다. 각 수치는 /50. 모든 A/B 후보의 Plant-only 결과는 여우 생존0·최종 중앙값0·출생0·cap0, 모든 시나리오에서 여우 cap0이었다.

| Stage | P | G | 번식확률 | RF | Full 생존 |
|---|---:|---:|---:|---|---|
| A | .80 | .5 | .018 | 37 / 4 | 0 / 6 / 17 |
| A | .80 | .7 | .018 | 33 / 4 | 2 / 6 / 14 |
| A | .80 | .9 | .018 | 30 / 13 | 2 / 5 / 13 |
| A | .75 | .5 | .018 | 39 / 4 | 1 / 6 / 18 |
| A | .75 | .7 | .018 | 34 / 8 | 1 / 2 / 11 |
| A | .75 | .9 | .018 | 31 / 14 | 3 / 3 / 14 |
| **A 평가점** | **.67** | **.5** | **.018** | **38 / 2** | **2 / 10 / 13** |
| A | .67 | .7 | .018 | 41 / 4 | 0 / 4 / 13 |
| A | .67 | .9 | .018 | 36 / 7 | 4 / 2 / 13 |
| B | .80 | .5 | .020 | 31 / 11 | 1 / 3 / 10 |
| B | .75 | .5 | .020 | 35 / 6 | 0 / 5 / 22 |
| B | .67 | .5 | .020 | 33 / 7 | 1 / 4 / 6 |

Full Web의 추가 지표다. 단계 중앙값은 멸종한 run에 한정; 에너지 비중은 각 run의 전체 누적 transferred-energy share의 중앙값이다. 식생은 run별 600-step 평균을 다시 평균한 값이다.

| Stage / P / G | 멸종 step 여우/토끼/늑대 | 여우 평균 출생 | 최고 개체수(max) | 토끼/식물 에너지 % | 평균 식생 % |
|---|---|---:|---:|---|---:|
| A/.80/.5 | 147.5 / 110 / 166 | 11.36 | 36 | 85.86 / 14.14 | 64.49 |
| A/.80/.7 | 149.5 / 101.5 / 156.5 | 17.92 | 42 | 79.94 / 20.06 | 68.88 |
| A/.80/.9 | 168.5 / 111 / 167 | 17.14 | 37 | 74.54 / 25.46 | 69.39 |
| A/.75/.5 | 144 / 117.5 / 160.5 | 12.28 | 41 | 85.93 / 14.07 | 58.62 |
| A/.75/.7 | 155 / 116 / 168.5 | 14.08 | 20 | 80.06 / 19.94 | 67.70 |
| A/.75/.9 | 161 / 123 / 172 | 21.22 | 47 | 74.35 / 25.65 | 66.28 |
| **A/.67/.5** | **145.5 / 118 / 170** | **10.84** | **24** | **86.08 / 13.92** | **66.27** |
| A/.67/.7 | 156.5 / 109 / 165 | 11.68 | 23 | 80.24 / 19.76 | 66.53 |
| A/.67/.9 | 162 / 112 / 162 | 23.14 | 42 | 75.97 / 24.03 | 65.27 |
| B/.80/.5 | 146 / 112.5 / 167 | 14.42 | 34 | 85.61 / 14.39 | 71.33 |
| B/.75/.5 | 143.5 / 113.5 / 169 | 12.02 | 21 | 85.71 / 14.29 | 55.82 |
| B/.67/.5 | 150 / 110 / 162.5 | 16.14 | 40 | 85.86 / 14.14 | 75.09 |

Stage A에서는 약66–70%의 fox-agent 기회에서 에너지가 번식 문턱 이상이었으나 계통이 남지 않았다. 이 진단에 따라 Stage B에서는 **번식 확률만** .020으로 바꿨다. G=.5는 최대 효율에서도1.5<1.7이라는 buffer 조건을 분석적으로 유지하므로 세 P를 그 조건에서 비교했다. 번식 규칙이 단독 원인이라는 증명은 아니다. 결과는 Full Web0–1/50이고 P=.67에서는 토끼 멸종44/50으로 악화해 채택하지 않았다. 기초 소비·사냥 성공률의 추가 sweep은 하지 않았다.

평가점은 여우 생존 수만 최대화해 고르지 않았다. G=.9의 최대4/50도 목표 미달이고, 최대 효율에서는 gain2.7>cost1.7이 되어 buffer-only 보장을 잃는다. 모든 후보를 최대 효율에서 sweep해 병리를 입증했다는 뜻은 아니다. 기존 gain을 유지하는 A 후보 중 P=.67이 Full Web 여우2·늑대10과 RF 여우38·토끼 멸종2를 얻어 **구현 평가점**으로 골랐다. 추가 파라미터를 늘려 겉보기 목표를 맞추지는 않는다.

### Holdout, before/after와 불확실성

| Set / 조건 | Phase 2 baseline | 평가점 P=.67/G=.5 | 변화 |
|---|---|---|---|
| Calibration / RF 여우 생존 | 27/50 (54%) | 38/50 (76%) | +22 pp |
| Calibration / RF 토끼 멸종 | 9/50 (18%) | 2/50 (4%) | −14 pp |
| Calibration / Full 여우 생존 | 1/50 (2%) | 2/50 (4%) | +2 pp |
| Calibration / Full 토끼 멸종 | 38/50 (76%) | 37/50 (74%) | −2 pp |
| Calibration / Full 늑대 멸종 | 48/50 (96%) | 40/50 (80%) | −16 pp |
| Holdout / RF 여우 생존 | 22/50 (44%) | 38/50 (76%) | +32 pp |
| Holdout / RF 토끼 멸종 | 18/50 (36%) | 5/50 (10%) | −26 pp |
| Holdout / Full 여우 생존 | 2/50 (4%) | 1/50 (2%) | −2 pp |
| Holdout / Full 토끼 멸종 | 36/50 (72%) | 36/50 (72%) | 0 pp |
| Holdout / Full 늑대 멸종 | 43/50 (86%) | 45/50 (90%) | +4 pp |

Full Web의 여우 멸종 단계 중앙값은 calibration149→145.5(−3.5), holdout153→142(−11); 토끼는109.5→118(+8.5),113.5→105(−8.5); 늑대는160→170(+10),163→158(−5)이다. 멸종 run 구성이 다르므로 이 중앙값 차이는 동일 개체의 수명 변화나 paired causal effect가 아니다. 전체 멸종 분포(q25/q75/min/max)와 censor한 분포는 raw report에 저장한다.

50-run Wilson95% 구간: fox1/50=2% **[0.35,10.50]%**,2/50=4% **[1.10,13.46]%**,RF27/50=54% **[40.40,67.03]%**,22/50=44% **[31.16,57.69]%**,38/50=76% **[62.59,85.70]%**. 희귀 생존1–2회의 차이를 성공 증거로 해석하지 않는다. 이 구간은 고정seed 표본에서의 변동성 참고이며 자연계 확률 추정이 아니다. 각 종의 count/percent/Wilson 구간도 machine-readable summary에 있다.

600 step에 **세 종이 동시에 남은 run**은 calibration baseline0→평가점2, holdout baseline0→평가점0이다. Holdout의 여우1 생존도 늑대와의 장기 공존은 아니다. Wolf control의 토끼 멸종은 calibration38, holdout35이며 현재/기준 모델의 대조군 결과는 같다.

### 식물·식단·식생 guardrail

| 평가점 / set | 효율 | Plant-only 생존/최종 중앙값/출생/cap | 멸종 step 중앙값 | 식생 최종 중앙값 |
|---|---:|---|---:|---:|
| Calibration | 10% | 0 / 0 / 0 / 0 | 16 | 100% |
| Calibration | 30% | 0 / 0 / 0 / 0 | 92 | 100% |
| Holdout | 10% | 0 / 0 / 0 / 0 | 16.5 | 100% |
| Holdout | 30% | 0 / 0 / 0 / 0 | 93 | 100% |

전체200 plant-only runs의 최고 개체수는 초기4, step400–600 개체수는0이었다. 현재 UI의 실제 최대 효율은30%이며 plant gain은1.5가 된다. 기초 소비1.7 미만이고 도입 에너지도 문턱24 미만이므로 plant-only에서 출생하지 않는다. 최대 효율의 평균 식생은 calibration99.61%, holdout99.61%. 전체 A/B/calibration/holdout에서 여우 cap hit는0이었다.

평가점의 식단 에너지 중앙 비율(토끼/식물): RF는 calibration **92.67/7.33%**, holdout **92.56/7.44%**; Full은 **86.08/13.92%**, **85.73/14.27%**다. P=.67은 실제 식단 비율이 아니다. UI는 기존처럼 최근50 logical steps의 실측 에너지만 표시하고, 분모0이면 "최근 섭식 없음"과 null 비율을 반환한다. P를 학생 조절 항목이나 자연계의67% 식단으로 표시하지 않는다.

| 조건 | 평균 식생 baseline→평가점 | run별 최소 식생 중앙값 baseline→평가점 | 최종 식생 중앙값 baseline→평가점 |
|---|---|---|---|
| Calibration RF | 26.36→19.19% | .186→.186% | 9.97→5.39% |
| Holdout RF | 34.41→22.31% | .186→.186% | 32.29→9.69% |
| Calibration Full | 72.28→66.27% | 1.004→.409% | 100→100% |
| Holdout Full | 62.16→69.28% | .521→.818% | 100→100% |

RF에서는 동물이 오래 남는 대신 식생의 평균·최종 상태가 낮아진다. Full에서는 calibration과 holdout의 변화 방향도 다르다. Wolf control의 최소 식생 중앙값은 .335%/.298%로 기존 모델 자체에도 깊은 자원 고갈이 있다. 새로운 plant-only 폭증이나 cap 병리는 관측되지 않았고, 여우 추가만으로 대다수 run이 극단적 고갈을 겪는다는 근거도 얻지 못했다. 그러나 자원 변동 문제가 해결됐다는 뜻은 아니다. 최종 식생100%는 소비자 멸종 뒤 회복도 포함하므로 건강한 공존의 지표로 볼 수 없다.

### 검증, 산출물과 재현

- Focused fox **33/33**, intervention **27/27**, 전체 **157/157**. 신규9 deterministic tests는 경계값 선택, 사냥 실패 시 no-fallback, 먹이1종류·0종류에서 choice RNG 없음, plant 선택 시 hunt RNG 없음, 현재 칸 제한, 최대 효율, 실제 식단 표시, 같은 개입 이력의 state/RNG replay를 검사한다. 확률 분포를 대량 반복하는 flaky test는 추가하지 않았다.
- 기존 fox-free exact regression의9개 시나리오/3,742시점 fixture는 갱신하지 않았다. 2/3/4단계, 도입·부분 제거, RNG, energy, graph를 포함한 기존 intervention exact 회귀도 통과했다. Apex trajectory/collapse/score/RNG는 exact 일치. 기본 collapse44/score43, 밀집18/17, 효율20%71/70.
- TypeScript, production build, 로컬DB generated-artifact check, `git diff --check` 통과. 기존dist에 대한 sandbox 쓰기 제약 때문에 build는 `--configLoader native --outDir verification.local/fox-coexistence/build`로 검증했다. SQL/DB 생성물은 변경하지 않았다.
- 실제 설치된 Microsoft Edge **153.0.4234.48**의 headless 실행에서 fox와 기존 intervention browser suite가 통과했다. 자연 진행15회 표본에서 여우·토끼가 있을 때 plant energy>0, 토끼가 풍부할 때 rabbit dominance를 확인했다. 평가값 P=.67에서 step49 토끼253마리·식물 에너지5.44%, step112 토끼1마리·15.54%, step140 토끼0마리·84.83%였다. 이는 한 trajectory의 관측이며 증가 방향을 강제하는 테스트는 두지 않았다.
- 1440×900, 1024×768, 390×844, 320×740에서 식단·영양 구조·legend·개입·부분 제거 dialog의 overflow/겹침 검사와 스크린샷 확인을 했다. Tab/Shift+Tab, Enter/Space, ESC, focus return, 실행/정지 복귀를 검증했다. 별도 screen reader나 모바일 실기기 검사는 하지 않았다.
- 여우 부분 제거·재도입·Reset과50-step 빈 식단, Apex의 fox UI 부재·강제 이벤트 무효·44/43을 검증했다. 두 browser suite 모두 JS errors0/외부writes0.
- 48열·rabbit200/wolf30/fox40의600-step model+energy/diet query 측정: 중앙값3.02ms, p95 5.79ms, max12.02ms. 이 기계에서1회 측정한 값이며 화면 렌더링 성능 보장은 아니다. 기존8–40step/s용 runtime에 새 전역scan은 없다.
- 변경 범위: `src/model.ts`, `src/main.ts` 설명1문장, `tests/fox.test.ts`, 신규`tests/fox-choice.test.ts`, `tests/fox.browser.mjs`, `scripts/calibrate-fox-coexistence.ts`, `package.json`, 이 문서, `docs/fox-coexistence-selection.json`. 종 추가, simulationVersion, Apex 로직, leaderboard, Supabase, main/Pages 변경·배포는 하지 않는다.
- final commit/push는 feature branch의 Git 이력과 최종 보고에 기록한다. raw JSON·로그·build는 `verification.local/fox-coexistence/`, 스크린샷과 Edge JSON은 `verification.local/fox/` 및 `verification.local/interventions/`에 있다. 이들은 gitignored이며 commit은 harness·선택 이유·요약·구현/검증으로 제한한다.

```text
npm run calibrate:fox:coexistence -- baseline
npm run calibrate:fox:coexistence -- audit
npm run calibrate:fox:coexistence -- stage-a
npm run calibrate:fox:coexistence -- stage-b
npm run calibrate:fox:coexistence -- validate
```

기존 raw report 덮어쓰기는 거부한다. 의도적으로 같은 조건을 재현할 때만 `FOX_OVERWRITE=1`을 지정한다. Stage B 후보와 holdout 이전 선택은 versioned selection JSON에 저장했다. `validate`는 선택 후보의 calibration 최대 효율과 holdout 각 조건, Git 기준 holdout 대조군을 실행한다. Holdout 이후 다시 tuning한다면 이번 holdout을 재사용하지 말고 제3의 seed set을 먼저 고정해야 한다.

### 남은 한계와 다음 단계

**weighted choice만으로 늑대와 장기 공존을 확보할 수 있다는 가설은 지지되지 않았다.** RF 개선과 Full Web 개선은 구분한다. Release default tuning은 계속 BLOCKED이며 이번에는 main merge/Pages deploy를 하지 않는다.

다음은 parameter 범위를 넓히기 전에 (1) 공유 토끼의 증가·자원 고갈·붕괴 과정, (2) 나이 상한과 에너지 조건부 번식의 계통 대체율, (3) 국소 이동/탐색 규모와 늑대·여우 간접 경쟁, (4) 현재 칸 식생 proxy의 자원 의미를 하나씩 독립 실험으로 재검토하는 것이다. 각 후보의 인과 가설과 비악화 조건을 먼저 정하고 별도의 제3 seed set으로 검증한다. 과일 객체·계절·직접 공격 등을 이번 변경에 추가하지 않는다.

## Observable Dynamics Reassessment — Phase 2.1b

### 목표, Git 기준과 사전 고정

이번 질문은 “600 step에 세 종이 공존하는가”에서 **“학생이 여우·토끼·늑대·식생의 변화 흐름을 보기 전에 여우가 사라지는가”**로 바꿨다. 이 모델에 장기 공존을 일반적 결과로 강제하지 않는다. 600 step은 여우 도입 이후의 분석 horizon이며 생존·공존 수는 보조 지표다. 위의 coexistence tuning BLOCKED 기록은 삭제하거나 성공으로 소급 변경하지 않는다.

- 시작: clean `feat/fox-coexistence-tuning`, 정확한 base `bc7787d5eafc4c0508424fbc4f081589f9f6670b`. 새 branch는 `feat/fox-observable-dynamics`. 적용할 AGENTS.md는 없었다.
- main/origin/main은 시작 시 `2fce748f38d734b9c1c0cfef800b1cb4ea91439b`. origin은 기존 GitHub 저장소 그대로다. main 병합·Pages 배포·Supabase·leaderboard 변경은 없다.
- **결과를 보기 전** [평가 규약](fox-observable-protocol.json)을 `b5fd0782bd155add9f67587a8d49831a99621b66`에 커밋했다. `FOX-OBS-001`부터 `FOX-OBS-100`까지 100개 문자열 seed를 전부 고정했다. 기존 FOX-CAL/FOX-HOLDOUT과 다른 domain이며 검증된 정규화와 초기 RNG 상태 100개도 모두 달랐다. 삭제·교체·선별은 하지 않았다.
- 이 set은 이번 평가와 2–3개 후보의 추가 guardrail에만 쓴다. 결과를 확인한 이후의 새로운 tuning에는 fresh seed domain이 필요하다. 별도 미사용 holdout 결과라고 주장하지 않는다.
- Full Web은 기존과 같은 32열, 토끼50, 늑대8, 초기 숲밀도78%, 재생.1, 전달효율10%, **step 0 도입**이다. 이전 calibration도 step 0이었다. 그러므로 도입 전 50-step 자료는 **없음/N/A**으로 기록하고, 실제 도입 직전 초기 상태와 post100/post200 endpoint 및 window mean을 비교했다. 도입 시점을 임의로500으로 바꾸지 않았다.
- Phase 2 `e476ff83d08168a9f9e2d8d44fb49c73a3ec6c3d` fallback과 Phase 2.1 base의 모델 원문을 gitignored 경로에 읽어 평가했다. 제품 코드를 되돌리거나 baseline용 toggle을 bundle에 넣지 않았다.
- fox basal1.7, rabbit gain8, plant gain.5, hunt.70, 번식문턱24/확률.018/이전42%, 최대나이110, 탐색1/이동.94, cap80은 그대로다. 변수는 preference .67/.75/.80과 도입4/6/8뿐이다.

**아래 수치는 교육용 모델의 관찰 시간·게임성 비교다. 자연계 여우 생존확률, 실제 수명·식단 추정치로 해석하면 안 된다.**

### 지표와 재현 가능한 산출물

여우 생존은 최초 도입 개체만의 수명이 아니라 **자손을 포함한 여우 개체군이 처음0이 될 때까지**의 경과 step이다. 예를 들어500에 도입해680에 멸종하면180이다. 절대 멸종 step과 경과 시간을 별도 저장하고, 도입 후600에도 남은 run은 right-censored로 기록한다. 정확히600에서 멸종한 event와 검열을 구분한다.

P(T≥100)은 정확히100에 멸종한 run도 포함한다. “100-step 종료 후 살아 있음”은 T>100으로 다른 경계다. 분위수는 **모든 run의 min(T,600)** 에 대한 type-7 선형 보간이다. 검열된 관측값이 보간에 들어간 분위수는 lower bound로 표시하며, 멸종 run만으로 중앙값을 다시 계산하지 않는다. 이번 Full Web은 Q75까지 검열되지 않았고 max만≥600이다. Rabbit+Fox의 검열된 중앙값≥600은 실제 중앙 멸종 시간이600이라는 뜻이 아니다.

상호작용은 도입 후1…50/100/200 step에 successful rabbit kill≥1 **또는** plant feeding event≥1로 정의했다. 사냥 시도, 성공, 식물 섭식, 두 먹이의 실제 전달에너지, 출생을 각 window마다 raw run과 집계에 기록한다. 개발용 관찰 wrapper는 실제 foraging map을 읽으며 추가 RNG를 뽑지 않는다. 두 commit × 네 scenario의 관찰 유/무가 전체 state hash·RNG·trajectory에서 같음을 audit했다.

- [전체 Markdown 표](fox-observable-results.md): 9개 후보·fallback, 모든 생존 분위수/threshold, 토끼·늑대50/100/200/300/600 멸종, 상호작용 window 총계, 식생, 식단, 변화 방향, 시간 환산, 대표 궤적.
- [CSV 요약](fox-observable-summary.csv), [JSON 요약](fox-observable-summary.json): count/비율, 분포, window별 평균·분위수, post100/200 endpoint와 window-mean 변화, raw 파일 SHA-256, 대표 seed. N/A 종은 멸종0%로 오인하지 않도록 denominator0/null로 기록한다.
- [선택 근거](fox-observable-selection.json). Raw 1,700회와 모든 step의 trajectory, baseline 원문, 대표 trajectory CSV, Edge 결과/스크린샷/build는 `verification.local/fox-observable/`에 있고 gitignored다. 결과 파일의 조용한 덮어쓰기는 거부한다.

### Full Web 결과와 선택

각 행100개 seed. 생존/멸종/상호작용 열의 숫자는 **count/100이며 같은 수치의 %**다. Cap은 도달 run 수이고 모든 후보에서 도달 step·번식 cap guard 호출도0이다.

| Preference | 도입 | Q25 | Median | ≥50 | ≥100 | ≥150 | ≥200 | ≥300 | 토끼≤200 | 늑대≤200 | 상호작용≤100 | peak max | cap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **.67 유지** | **4** | **134** | **145.5** | **100** | **100** | **40** | **11** | **7** | **60** | **72** | **100** | **35** | **0** |
| .67 | 6 | 140 | 150 | 100 | 100 | 51 | 12 | 5 | 62 | 69 | 100 | 38 | 0 |
| .67 | 8 | 138 | 153 | 100 | 100 | 52 | 20 | 12 | 41 | 62 | 100 | 41 | 0 |
| .75 | 4 | 134.75 | 149.5 | 100 | 100 | 50 | 15 | 10 | 57 | 68 | 100 | 37 | 0 |
| .75 | 6 | 138 | 149 | 100 | 100 | 48 | 19 | 11 | 53 | 68 | 100 | 38 | 0 |
| .75 | 8 | 140 | 150 | 100 | 100 | 50 | 17 | 12 | 63 | 73 | 100 | 39 | 0 |
| .80 | 4 | 134.5 | 145.5 | 100 | 100 | 42 | 12 | 7 | 65 | 71 | 100 | 33 | 0 |
| .80 | 6 | 141 | 155 | 100 | 100 | 58 | 16 | 13 | 61 | 74 | 100 | 40 | 0 |
| .80 | 8 | 144 | 163 | 100 | 100 | 62 | 25 | 18 | 52 | 64 | 100 | 36 | 0 |

| Reference | min | P10 | Q25 | median | Q75 | max | ≥500 | alive600 | 세 종 공존600 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Phase 2 fallback /4 | 110 | 126 | 140 | 149 | 165.25 | ≥600 검열 | 2/100 | 2/100 | 1/100 |
| Phase 2.1 weighted .67/4 | 110 | 119.8 | 134 | 145.5 | 155 | ≥600 검열 | 3/100 | 2/100 | 1/100 |

**선택은 Case A, `.67 / 4마리` 유지이며 product code 변경은 없다.** 가장 작은 변경을 우선하라는 원칙과 현재100/100의≥100, Q25=134, 모든 run의 실제 상호작용을 근거로 삼는다. 중앙값145.5는 soft target150의 아래쪽에 가깝지만 정확히 충족했다고 반올림하지 않는다. 200 step을 넘는 시행이11%라는 점도 분명한 한계다. 판정은 **8 step/s 또는 일시정지를 사용하는 100–150-step 정도의 짧은 관찰에는 충분**, 대다수 시행에서200-step 이상을 요구하는 수업 흐름에는 부족하다는 것이다. 실제 학생 사용성 실험의 증거는 아니다.

.67에서4→6은 중앙값+4.5, Q25+6, ≥200은+1pp에 그쳤다. 8 step/s에서 중앙 관찰 시간이 늘어나는 양은0.56초다. 4→8은 중앙값+7.5, ≥200은+9pp지만 도입량을2배로 하고 평균 식생도65.05→55.87%로 낮춘다. `.80/8`은 중앙163, ≥200=25%로 가장 긴 쪽이나 두 변수를 바꾸며 여전히75%는200 전에 끝난다. 이 표를 단일 점수로 정렬하거나 soft target 경계에 숫자를 맞추지 않았다. Weighted choice는 두 먹이를 실제 선택하는 현재 잡식 모델의 의미를 유지하고 결정적 실행을 보존하므로, 600 공존이 개선되지 않았다는 이유로 되돌리지 않는다.

### 상호작용과 토끼·늑대·식생의 부작용

현재 `.67/4`의 상호작용 확률은50/100/200 window 모두100/100이다. 첫50 step의 100-run 합계는 사냥시도12,378, 성공8,670, 식물섭식8,399, 토끼에너지69,360, 식물에너지4,199.5, 출생255다. 출생이 있는 run은84/100이다. 첫100/200의 출생은837/1,010이고 출생 run은98/98이다. 단순 생존만 한 것은 아니다. 모든 후보의 window별 수치는 별도 표와 JSON에 있다.

| 지표(count/100) | Fallback/4 | Current .67/4 | .67/6 | .67/8 |
|---|---:|---:|---:|---:|
| 토끼 멸종≤100 / ≤200 / ≤600 | 24 / 66 / 75 | 19 / 60 / 69 | 20 / 62 / 68 | 8 / 41 / 59 |
| 늑대 멸종≤100 / ≤200 / ≤600 | 0 / 79 / 93 | 0 / 72 / 86 | 0 / 69 / 87 | 0 / 62 / 88 |
| 식생 평균 / 중앙 / 최소 % | 69.25 / 98.96 / .04 | 65.05 / 91.18 / .07 | 65.35 / 92.11 / .07 | 55.87 / 68.34 / .07 |
| 초기 지속 저식생 flag | 80 | 91 | 87 | 83 |

현재 설정은 baseline 대비 토끼·늑대의 빠른 멸종 빈도가 낮았지만, 식생에는 불리한 변화가 있다. 결과 확인 전에 정의한 **도입 후200 이내 식생5% 미만10연속 step**의 비율이80→91%이고, 1% 미만을 한 번이라도 기록한 비율도48→67%다. 따라서 “부작용이 없다/식생이 안정적이다”라고 결론 내리지 않는다. 이 flag는 교육용 descriptive 기준이며 전 세계적 생태 붕괴의 측정값이 아니다. 토끼의 증식·고갈·소비자 멸종 뒤 식생 회복이 포함되어 최종100% 역시 건강한 공존을 뜻하지 않는다. 6/8 도입이 현재보다 초기 collapse flag를 늘리지는 않았고 cap 폭증도 없지만,8의 낮은 전체 평균 식생과 추가 RF 부작용은 default 확대를 피하는 근거다.

실제600-step 누적 전달에너지의 current 식단은 pooled **토끼87.44% / 식물12.56%**, run별 비율 중앙값은 **85.88 / 14.12%**다. 토끼가 에너지의 주된 비중인 run은100/100이다. `.67`을 실제67:33 식단으로 맞추지 않았다. UI는 계속 최근50 step의 실제 에너지를 보여준다.

### 추가 guardrail과 최대 효율

Full Web을 모두 본 다음 `.67/4`, `.67/6`, `.67/8`을 추가 검사 대상으로 명시했다. physiology를 바꾸기 전 도입량만 바꾸는 가장 단순한 대안을 비교하기 위해 preference를 고정했다. 다른6개 후보의 결과도 모두 남긴다. 각 후보×Rabbit+Fox/Plant-only×100회, 선택후보×최대효율Plant-only100회로 추가700회, 전체1,700회다.

| 조건 | 도입 | ≥100 | ≥200 | alive600 | 토끼≤100/200/600 | 여우 출생 합계 | peak max | cap |
|---|---:|---:|---:|---:|---|---:|---:|---:|
| Rabbit+Fox | 4 | 100/100 | 98/100 | 85/100 | 0 / 1 / 6 | 13,168 | 44 | 0 |
| Rabbit+Fox | 6 | 100/100 | 97/100 | 71/100 | 0 / 0 / 3 | 13,068 | 49 | 0 |
| Rabbit+Fox | 8 | 100/100 | 94/100 | 77/100 | 0 / 6 / 11 | 12,891 | 50 | 0 |
| Plant-only10% | 4 / 6 / 8 | 각각0 | 각각0 | 각각0 | N/A | 각각0 | 4 / 6 / 8 | 0 |
| Plant-only30% | 4 | 18/100 | 0/100 | 0/100 | N/A | 0 | 4 | 0 |

Plant-only10%는 세 도입량 모두 중앙17 step이고 population growth/repeated growth/birth/cap이 전부0이다. UI의 전달효율 상한은 실제 코드에서 **30%**임을 재확인했다. 그 조건의 current 생존 Q25=90, median=93.5, max=102이고 성장·번식·cap은0이다. plant gain1.5<basal1.7이어서 buffer로 오래 남을 수는 있어도 증식 엔진이 되지 않았다. 평균 식생99.60%, 초기collapse0이다.

RF의 current는 즉시 멸종하지 않고 토끼≤200 멸종1/100, cap0이지만, 세 도입량 모두 지속 저식생flag100/100이고 평균 식생은19.89/20.66/24.97%다. RF를 안정된 식생으로 기술하면 안 된다. Intro8은 토끼≤200/600 멸종이current1/6에서6/11로 늘어, Full Web의 긴 tail만 보고 채택하지 않는다.

### 실제 변화, 대표 seed와 재생 속도

Current의 step100 endpoint Δ 중앙값은 초기 대비 토끼−46, 늑대+18, 식생−20.70pp다. 증가/같음/감소 run 수는 토끼2/0/98, 늑대100/0/0, 식생0/0/100이다. step200에서는 토끼−50, 늑대−8, 식생+21.74pp이고 방향 수는39/0/61, 4/2/94, 61/0/39다. 초기 증식 후 붕괴·회복 방향이 보이며 seed별 후반 흐름도 달라진다. 이는 시간 변화의 관측이고 fox-free counterfactual을 사용한 인과 효과 추정이 아니다.

대표 seed는 **Q25에 가장 가까움 / 중앙값에 가장 가까움 / 최장 관측시간**, 동률은 seed 오름차순이라는 사전 규칙으로 골랐다. 전체 결과에서 다른 seed를 빼지 않았다.

- Q25 `FOX-OBS-086`: 134 step 멸종, peak11. 50 step에는 토끼186/늑대13/여우8, 식생1.90%;134에는토끼0/늑대4/여우0, 식생93.56%다.
- 중앙 `FOX-OBS-021`: 145 step 멸종, peak5. 50에는토끼251/늑대12/여우2, 식생.74%;100에는6/26/4, 식생48.85%;145에는0/6/0, 식생92.52%다. 여우 증가가 작아도 실제 두 먹이 섭식과 전체 궤적 변화가 있다.
- 긴 관측 `FOX-OBS-038`: 600에서검열, peak35. 200에는토끼200/늑대0/여우4, 식생.56%;600에는15/0/1, 식생85.97%다. 여우의 긴 생존이 늑대까지 포함한 공존이라는 뜻은 아니다.

| 재생 속도 | Current Q25=134 | Current median=145.5 | 200 steps |
|---|---:|---:|---:|
| 8 step/s | 16.75초 | 18.1875초 | 25초 |
| 20 step/s | 6.70초 | 7.275초 | 10초 |
| 40 step/s | 3.35초 | 3.6375초 | 5초 |

높은 속도에서는 짧다. 기존 속도/일시정지를 사용해야 관찰 시간을 확보할 수 있고, speed control 자체는 바꾸지 않았다. 새 Edge 검사에서 같은 중앙 대표 seed를8/20/40으로 재생했으며, 25/50/100/145 step의 **전체 snapshot·식단·RNG**가 headless oracle과 정확히 같았다. 145까지 브라우저 가상 시계 경과는18.134/7.260/3.630초다. 이는 실제 Edge renderer의 scheduler 검사이며 stopwatch로 실제 사용자 장치의 wall time을 측정한 것은 아니다. 백그라운드 throttling·렌더링 지연은 실제 시간을 늘릴 수 있다.

### 검증과 제품 변경 범위

- 새 통계/관찰 test10개: 늦은 도입의 경과시간,600 event와 censor 구분,threshold 경계,quantile 보간/검열bound,식생연속조건,seed·matrix,4/6/8 도입,실제pre50,계측의 state/RNG·에너지 회계. 전체 결과 숫자를 snapshot으로 고정하지 않았다. 과거 commit의 계측 검사는 명시적 audit에서만 하므로 일반 단위 test는 shallow checkout에서도 동작한다.
- Focused fox **43/43**, 전체 **167/167** 통과. 기존 fox-free9 scenario/**3,742시점** fixture를 갱신하지 않았다. RNG·graph·energy와 intervention exact 회귀 유지. Apex trajectory/RNG/collapse/score exact: 기본44/43, 밀집18/17, 효율20%71/70.
- 프로젝트 TypeScript와 production build 통과. 새로운 Node harness/test도 bundled Node type definitions로 별도 strict TypeScript 검사를 통과했다. 저장소 기본설정에는 Node type definitions가 없어 최초 별도 검사만 이를 찾지 못했으며, 제품 의존성을 추가하지 않고 번들 경로를 지정했다. Build 출력은 `verification.local/fox-observable/build`이다.
- Microsoft Edge **153.0.4234.48**, 설치된 실제 Edge의 headless 실행에서 기존fox suite와 새observable speed/flow suite 통과. step500 Run→여우 기본4 도입, 자연섭식/식단 변화, graph/intervention marker, 부분제거·재도입·Reset, Apex격리, JavaScript오류0/외부write0을 확인했다. 새 suite는 대표seed의 step5 실행중 도입→계속실행→부분제거→재도입→Reset도 검사했다.
- 제품UI 변경은 없으며 기존fox suite에 포함된1440×900,1024×768,390×844,320×740 overflow/겹침과 Tab/Shift+Tab/Enter/Space/ESC/focus복귀도 통과했다. 중앙대표step50 화면을 시각 확인했다. 별도screen reader·실기기 학생 관찰은 하지 않았다.
- `src/` 전체, 기존fixture, simulationVersion, Apex, leaderboard, Supabase, 배포workflow는 base와 동일하다. **기본 도입량4, preference.67, plantGain.5 모두 변경 불필요**다. 변경은 개발 평가 도구·통계/브라우저검사·package scripts·보고 문서뿐이다. 최종diff검사·commit/push 상태는 feature branch 이력과 최종 응답에 기록한다.

재현 순서(기존raw가 있는 경우 덮어쓰지 않으며 보존 후 별도 깨끗한 checkout에서 실행):

```text
npm run calibrate:fox:observable -- audit
npm run calibrate:fox:observable -- references
npm run calibrate:fox:observable -- matrix
npm run report:fox:observable
# Full Web 결과 검토 후 selection JSON에 guardrail 대상/선택 근거 기록
npm run calibrate:fox:observable -- guardrails
npm run calibrate:fox:observable -- max-efficiency
npm run report:fox:observable
npm run test:fox
npm test
npm run build -- --configLoader native --outDir verification.local/fox-observable/build
# 로컬 Vite origin 127.0.0.1:5177 실행 후
npm run test:browser:fox
npm run test:browser:fox-observable
```

### 결론과 다음 단계

**A. 600-step coexistence는 낮다.** Current의 여우생존2/100, 토끼·늑대·여우 동시공존1/100이다.

**B. 학생이 관찰 가능한 transient dynamics는 느린 재생에서 짧은100–150-step 관찰 목적에는 충분하다고 판단한다.** 100/100이100 step을 확보하고 실제섭식이 발생하며 Q25도134다. 다수 run의200-step 이상 관찰,40 step/s에서 여유로운 읽기,안정된 식생까지 확보했다는 뜻은 아니다.

따라서 default를 건드리지 않는다. 다음 단계는 새 parameter sweep보다8 step/s·일시정지에서 실제 학생이 먹이·식단·그래프 변화를 읽을 수 있는지 확인하는 사용성 관찰이다. 추가 생태 분석을 한다면 식생고갈과 토끼붕괴를 별도 fox-free 대조군/새 seed set으로 조사하고 도입시점 다양성도 독립 설계한다. 이번100 seeds는 이미 결과를 본 set이다. 과일·새종·피난처·handling time·life-history 변경을 이번 결론에서 추가하지 않는다.
