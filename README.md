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

record schema는 `ChallengeRecord<SimulationParameters>`와 `ApexSurvivalRecord`로 정의되어 있으며, 아래 중앙 기록판의 제출 payload가 이 구조를 그대로 재사용합니다.

## 중앙 leaderboard

Apex Survival 결과 화면에서 학번과 이름을 입력해 학급 공용 기록판에 제출할 수 있습니다. 저장소는 Supabase이고, 앱은 `src/leaderboard.ts`의 `LeaderboardTransport` 인터페이스만 알고 있으므로 다른 백엔드로 교체하거나 테스트에서 메모리 구현으로 바꿔 끼울 수 있습니다.

- 기록판은 학생마다 최고 기록 1개만 남기고 상위 10명을 보여 줍니다. 마지막 자리와 점수가 같은 학생이 더 있으면 그 학생들까지 함께 표시합니다. 동점은 같은 순위를 공유하고 먼저 제출한 기록이 앞에 옵니다.
- 학생별 최고 기록 1개로 접는 일은 **서버의 공개 view가** 합니다. 그래서 다른 학생이 몇 번 도전했고 예전 점수가 얼마였는지는 public API로도 알 수 없습니다. 원본 테이블에는 모든 제출이 그대로 남습니다.
- 학생의 고유 식별자는 `student_number`(학번) **하나**입니다. `student_name`은 기록판에 보여 주기 위한 표시 정보이며 동일인 판정에 쓰지 않습니다. 같은 학번으로 이름을 조금 다르게 적어 제출해도 같은 학생으로 봅니다. 반대로 이름이 같아도 학번이 다르면 다른 학생입니다.
- 같은 학번의 학생이 완전히 같은 제출을 두 번 등록하는 것은 unique index `apex_leaderboard_dedupe_idx`가 막습니다. 키는 `(challenge_id, simulation_version, seed, student_number, payload_hash)`이며 `student_name`은 들어가지 않습니다. 이름 표기만 바꿔 같은 기록을 다시 내는 길을 막기 위한 것입니다. 파라미터나 점수가 다른 진짜 새 도전은 `payload_hash`가 달라져 그대로 여러 행 남습니다.
- 학번은 자릿수나 숫자 형식을 강제하지 않고 문자열로 다룹니다. 학번 체계가 바뀌어도 스키마와 코드를 고치지 않아도 되게 하기 위한 것이며, 앞뒤 공백 정리 · 빈 값 금지 · 최대 24자 · 위험 문자 배제만 검사합니다.
- 읽기와 쓰기가 서로 다른 대상을 향합니다. 조회는 공개 view `apex_leaderboard_public`, 제출은 원본 테이블 `apex_leaderboard` 입니다.
- `VITE_SUPABASE_URL`과 `VITE_SUPABASE_ANON_KEY`가 없으면 `createLeaderboardTransport`가 `null`을 돌려주고, 기록판 자리에는 안내 문구만 표시되며 나머지 기능은 그대로 동작합니다.
- 학번과 이름은 공백을 정리한 뒤 길이와 문자 종류를 검사하고, 화면에 그릴 때 HTML escape합니다. 입력값은 브라우저에 기억해 두어 다음 제출에서 다시 입력하지 않아도 됩니다.
- 제출은 도전이 끝난 기록 하나당 한 번만 가능하며, 새 도전을 시작하면 제출 상태가 초기화됩니다.

### 공개 범위와 권한 구조

Apex Survival은 좋은 파라미터 조합을 찾는 활동이므로, 다른 학생의 `parameter_snapshot`이 보이면 활동이 성립하지 않습니다. 그래서 학생 키(publishable key)로는 원본 테이블을 **읽을 수 없게** 만들고, 공개해도 되는 열만 담은 view 하나만 열어 둡니다.

| 대상 | 학생 키 권한 | 담긴 열 |
| --- | --- | --- |
| `apex_leaderboard` (원본) | INSERT만 | 전체. `parameter_snapshot`, `payload_hash`, `verified_*` 포함 |
| `apex_leaderboard_public` (view) | SELECT만 | `id`, `challenge_id`, `simulation_version`, `seed`, `score`, `student_number`, `student_name`, `submitted_at`. 학번 하나당 최고 기록 1행 |

클라이언트의 `select=` 목록을 줄이는 것만으로는 부족합니다. 학생이 개발자 도구에서 원본 테이블에 `select=*`를 직접 보낼 수 있기 때문입니다. 그래서 서버에서 `revoke all on table public.apex_leaderboard from anon, authenticated` 로 SELECT 권한 자체를 회수하고 INSERT만 되돌려 줍니다. 공개 읽기 RLS 정책도 함께 제거합니다.

view는 `security_invoker = false`로 만듭니다. 이 값의 의미를 짚어 두면,

- `false`(사용): view가 **소유자(postgres) 권한**으로 원본 테이블을 읽습니다. 학생에게 원본 SELECT 권한이 없어도 view가 동작합니다. 소유자 권한이므로 원본 테이블의 RLS도 우회하는데, 기록판은 원래 전체 공개이므로 의도한 동작이며 노출 범위의 상한은 view의 SELECT 목록입니다.
- `true`: view가 **호출자(anon) 권한**으로 읽습니다. 그러면 원본 테이블 SELECT 권한이 다시 필요해지고, 그 권한을 주는 순간 `select=*`로 `parameter_snapshot`이 노출됩니다. 즉 이 구조에서는 쓸 수 없습니다.

view를 만들었다는 사실만으로 안전하다고 가정하면 안 됩니다. 실제로 확인해야 하는 것은 두 가지입니다. **(1)** 원본 테이블에 `select=*`를 보냈을 때 거부되는가, **(2)** view에는 비공개 열이 아예 존재하지 않는가. 아래 "권한 검증" 절차로 확인할 수 있습니다.

타입에도 같은 경계가 있습니다. `LeaderboardSubmission`(보내는 값)에만 `parameterSnapshot`과 `payloadHash`가 있고, `LeaderboardEntry`(읽는 값)에는 아예 없습니다. 화면 코드가 실수로 참조하면 컴파일이 실패합니다.

제출은 `Prefer: return=minimal`로 보냅니다. 삽입한 행을 되돌려받으려면 원본 테이블 SELECT 권한이 필요한데, 그 권한이 없는 것이 이 구조의 핵심이기 때문입니다. 본인 기록 강조는 반환된 행 id 대신 학번으로 판별합니다.

검증 상태(`verification`)는 현재 공개 view에 넣지 않아 기록판에 배지가 뜨지 않습니다. 공개하기로 하면 `supabase/schema.sql`의 view 정의에 열 한 줄만 추가하면 되고, 클라이언트는 그 열이 오면 배지를 그리고 없으면 그리지 않도록 이미 되어 있습니다. `verified_score`와 `verifier_version`은 교사용이므로 넣지 마세요.

교사가 `parameter_snapshot`을 조회하는 기능은 **아직 없습니다.** 현재는 Supabase 대시보드에서 직접 봐야 하며, 교사 로그인은 5단계(server-side verification)와 함께 설계할 예정입니다.

### 권한 검증

publishable key만으로 아래가 모두 기대대로 나와야 합니다.

| 요청 | 기대 결과 |
| --- | --- |
| `GET /rest/v1/apex_leaderboard_public?select=*` | 200 · 공개 8개 열만 |
| `GET /rest/v1/apex_leaderboard?select=*` | 401 · permission denied |
| `GET /rest/v1/apex_leaderboard?select=parameter_snapshot` | 401 · permission denied |
| `POST /rest/v1/apex_leaderboard` (정상 기록) | 201 |
| `PATCH` / `DELETE` | 반영 0건 |

### 제출 payload와 무결성

제출할 때 `challengeId`, `simulationVersion`, `seed`, `score`, `parameterSnapshot`만 key 순서까지 정규화한 뒤 SHA-256으로 요약한 `payloadHash`를 함께 보냅니다. 학생 이름이나 달성 시각은 해시에 들어가지 않으므로 표기를 고쳐도 해시는 그대로입니다.

이 해시는 점수를 증명하지 않습니다. 클라이언트가 계산하는 값이므로 위조가 가능하며, 목적은 저장된 snapshot과 제출된 점수가 서로 어긋났는지 드러내는 것과, 5단계에서 서버가 같은 정규화 규칙으로 재실행 결과를 대조할 자리를 미리 만들어 두는 것입니다. 실제 신뢰는 서버 재실행 검증이 들어올 때 생깁니다.

`apex_leaderboard` 테이블에는 `verification`, `verified_score`, `verified_at`, `verifier_version` 열이 미리 있습니다. 지금은 항상 `unverified`이며 anon key로는 이 열을 쓸 수 없습니다. 기록판은 이미 `검증됨 / 재현 불일치 / 미검증`을 구분해 표시하므로, 나중에 서버가 이 열만 채우면 클라이언트 변경 없이 검증 결과가 드러납니다.

### Supabase 설정

1. Supabase 프로젝트를 만들고 SQL Editor에서 [`supabase/schema.sql`](supabase/schema.sql)을 한 번 실행합니다. 테이블, 인덱스, 권한, RLS 정책, 공개 view, 제출 빈도 제한 트리거가 함께 만들어집니다. 여러 번 실행해도 안전하므로 스키마가 바뀌면 다시 실행하면 됩니다.
2. `.env.example`을 `.env.local`로 복사하고 프로젝트 URL과 **anon public key**를 채웁니다. `service_role` key는 RLS를 우회하므로 절대 클라이언트에 넣지 않습니다.
3. GitHub Pages 배포에는 저장소 secret `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 등록합니다. 테이블 이름을 바꿨다면 repository variable `VITE_LEADERBOARD_TABLE`도 함께 설정합니다.

RLS INSERT 정책은 현재 challenge 정의(`apex-survival` / `apex-v1` / seed `260903`)와 일치하며 검증 열을 건드리지 않는 행만 허용합니다. UPDATE와 DELETE 정책이 없으므로 학생 키로는 남의 기록을 고치거나 지울 수 없고, SELECT 권한 자체가 없으므로 원본 테이블을 읽을 수도 없습니다.

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

테스트에는 leaderboard 제출 해시의 key 순서 독립성, 학번·이름 정규화와 검증, 학번 기준 동일인 판정(이름 표기가 달라도 한 학생, 이름이 같아도 학번이 다르면 다른 학생), 학생별 최고 기록 집계와 상위 10명 + 동점자 표시, 조회가 공개 view만 향하고 비공개 열을 요청하지 않는지, 서버가 여분의 열을 보내도 entry에 새어 들어오지 않는지, 제출이 `return=minimal`로 원본 테이블에 가는지, 환경 변수 미설정 시 비활성화 동작과 함께 기본 2차 소비자 deterministic regression, 3·4차 활성화, 상위 포식자의 실제 섭식, 효율 적용, 종 제거 고정, Reset, intervention, 격자 불변식, Apex score 경계, 동시 붕괴, 설정 잠금, 속도 독립성, 동일 seed Retry, Personal Best 갱신 규칙, 10,000 step 이력 제한 검사가 포함됩니다.
