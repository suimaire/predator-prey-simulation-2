# Rabbits & Wolves · Extended Forest Lab

식생 → 토끼 → 늑대의 기존 격자형 agent-based ecosystem simulation을 최대 4차 소비자까지 확장한 교육용 생태계 실험실입니다.

## 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173/predator-prey-simulation-2/`를 엽니다.

## 모델 구조

- 각 동물은 위치, 에너지, 나이, species를 가진 개별 agent입니다.
- `SpeciesConfig`가 먹이 종류, 영양 단계, 이동, 에너지 소비, 번식 조건, 수명을 정의합니다.
- 토끼는 식생을 먹고, 늑대는 토끼를 먹고, 3차 소비자는 늑대를, 4차 소비자는 3차 소비자를 먹습니다.
- 늑대와 상위 소비자는 하나의 공통 포식자 처리 루틴을 사용합니다.
- 격자 좌표를 key로 하는 점유 맵과 이웃 칸 탐색을 사용하므로 전체 agent 쌍을 매 step 비교하지 않습니다.
- seed 문자열로 고정된 난수 생성기를 초기화하므로 같은 seed와 파라미터는 같은 결과를 만듭니다.

## 에너지 전달 효율

먹이가 제공하는 가용 모델 에너지에 사용자가 선택한 전달 효율(5~30%)을 한 번만 적용합니다. 기존 `rabbitFoodEnergy`, `wolfFoodEnergy` 설정은 10% 기준의 식사당 획득량으로 보존되며, 내부에서는 다음과 같이 일관되게 계산합니다.

```text
가용 모델 에너지 = 10% 기준 획득량 ÷ 0.10
실제 획득량 = 가용 모델 에너지 × 선택한 전달 효율
```

따라서 기본 10%에서 기존 토끼·늑대 simulation의 에너지 동작과 deterministic 궤적이 유지되고, 같은 섭식 사건에 효율을 두 번 적용하지 않습니다.

## 실시간 생태 피라미드

- **개체수**: 소비자는 실제 agent 수를 사용합니다. 식생은 개별 나무 수가 아니라 모든 격자 칸의 현재 성장 단계 합(`forestAbundance`)입니다.
- **에너지 흐름**: 최근 20 step 동안 실제로 발생한 섭식 이벤트의 전달 에너지를 합산한 뒤 경과 step으로 나눈 `모델 에너지/step`입니다.
- 상위 단계의 작은 값도 볼 수 있도록 막대 폭에는 제곱근 척도와 최소 가시 폭을 적용하지만, 실제 숫자는 그대로 표시합니다.

## 종 제거 실험과 그래프

종 제거는 해당 species의 현재 agent 배열을 즉시 비우고 `removedSpecies` 집합에 기록합니다. 이후 처리와 번식을 건너뛰므로 Reset 전에는 자동으로 되살아나지 않습니다. 제거 시점은 `{ step, species }` intervention으로 저장되며 개체군 그래프의 수직선과 하단 기록으로 표시됩니다. Reset은 agent, 통계, 에너지 이벤트, 제거 상태와 intervention history를 모두 초기화합니다.

그래프 범례는 버튼이므로 마우스 hover 없이 터치로도 각 series를 표시하거나 숨길 수 있습니다.

## Challenge Mode · Apex Survival

자유 탐구와 분리된 `Apex Survival`은 식생부터 4차 소비자까지 모든 영양 단계를 동시에 유지한 logical step 수를 기록합니다.

- 도전 설정은 먹이사슬 깊이를 4차 소비자까지로 고정하고 `APEX_CHALLENGE_CONFIG`의 seed `260903`을 사용합니다.
- `Start Challenge`를 누르면 현재 파라미터의 snapshot을 저장하고 step 0에서 새 simulation을 시작합니다.
- 매 logical step 직후 식생의 `forestAbundance`와 네 소비자 population을 확인합니다. 어느 하나라도 처음 0이 된 step은 점수에 포함하지 않습니다.
- 진행 중과 결과 화면에서는 결과에 영향을 주는 설정을 잠급니다. 화면 진행 속도만 바꿀 수 있으며 score 계산에는 사용되지 않습니다.
- 종 제거 실험은 Apex Survival에서 비활성화되고 자유 탐구에서는 기존대로 동작합니다.
- 종료 시 마지막 숲, 그래프, 생태 피라미드와 설정을 보존하며 붕괴 step을 그래프에 표시합니다.
- Personal Best는 브라우저 `localStorage`에 score, parameter snapshot, challenge seed, simulation version, 달성 시각을 함께 저장합니다.
- 결과의 `같은 설정으로 다시 도전`은 동일 파라미터와 동일 seed를 사용합니다.

현재 record schema는 `ChallengeRecord<SimulationParameters>`와 `ApexSurvivalRecord`로 정의되어 있어 이후 서버 leaderboard 제출 구조로 재사용할 수 있지만, 이번 버전에는 서버 전송이나 학생 식별 정보를 포함하지 않습니다.

## 교육적 가정과 한계

1. 이 확장 모형은 학습을 위해 먹이 관계를 직선형 먹이사슬로 단순화합니다.
2. 실제 생태계에서는 대부분 여러 종이 연결된 먹이그물을 형성합니다.
3. 영양 단계가 높아질수록 이용 가능한 에너지가 제한되는 경향이 있습니다.
4. 10%는 보편적인 자연법칙이 아니라 흔히 쓰는 교육적 대표값입니다.
5. 실제 영양 단계 간 전달 효율은 생태계와 종에 따라 달라집니다.
6. 이 simulation의 energy 값은 실제 Joule 측정치가 아닌 모델 내부 값입니다.
7. 종 제거 뒤의 변화는 실제 생태계 예측값이 아니라 이 모델의 가정과 파라미터에서 나타난 결과입니다.

## 검증

```bash
npm test
npx tsc --noEmit
npm run build
```

테스트에는 기본 2차 소비자 deterministic regression, 3·4차 활성화, 상위 포식자의 실제 섭식, 효율 적용, 종 제거 고정, Reset, intervention, 격자 불변식, Apex score 경계, 동시 붕괴, 설정 잠금, 속도 독립성, 동일 seed Retry, Personal Best 갱신 규칙, 10,000 step 이력 제한 검사가 포함됩니다.
