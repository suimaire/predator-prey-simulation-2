# Rabbits & Wolves · Extended Forest Lab

식생 → 토끼 → 늑대의 기존 격자형 agent-based ecosystem simulation을 최대 4차 소비자까지 확장한 교육용 생태계 실험실입니다.

자유 탐구에서는 **붉은여우(Red Fox)**를 도입하여 토끼와 식물성 먹이를 연결한 먹이그물도 실험할 수 있습니다. 여우는 기존 3차 소비자를 대체하지 않는 독립 종이며, Apex Survival에는 등장하지 않습니다.

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

## 붉은여우와 먹이그물

- 자유 탐구의 `＋ 붉은여우`는 기본 4마리를 현재 step에 도입합니다. 실행 중에는 dialog를 열며 일시정지하고, 확인 뒤에도 일시정지를 유지합니다. [기존 생태계 개입](docs/runtime-ecosystem-interventions.md)의 부분/전체 제거, 재도입, 그래프 marker를 그대로 사용합니다.
- 허용한 연결은 **토끼 → 붉은여우**, **식물성 먹이 → 붉은여우**입니다. 여우와 늑대는 직접 공격하지 않으며 토끼라는 공통 먹이를 통해 간접 경쟁합니다. 상위 소비자의 먹이 관계는 그대로입니다.
- **생물학적 사실:** 붉은여우는 작은 포유류·토끼류와 열매 등 식물성 먹이를 이용하는 잡식성 동물입니다. [미국 국립공원청](https://home.nps.gov/articles/red-fox.htm), [인디애나 자연자원부](https://secure.in.gov/dnr/fish-and-wildlife/wildlife-resources/animals/red-fox/).
- **모델의 단순화:** 붉은여우의 실제 식단 전체를 재현하지 않으며, 식물성 먹이는 현재 식생 자원을 이용해 단순화했습니다. `식생 → 여우`는 여우가 풀을 뜯어먹는다는 의미가 아닙니다. 섭식 시 실제 식생 성장 단계가 1 감소합니다.
- 여우는 주변 토끼 후보가 있으면 사냥을 시도합니다. 성공하면 한 마리를 먹고, 실패하면 그 step의 섭식이 끝납니다. 후보가 없을 때만 식물성 먹이를 이용하므로 이중 섭식이 없습니다.
- 여우가 살아 있을 때만 매 step seeded RNG로 늑대/여우 중 먼저 처리할 무리를 50:50으로 정합니다. 여우가 없으면 추가 난수 추첨이 없고 기존 궤적이 유지됩니다.
- 여우가 한 번 도입되면 **실시간 영양 구조**와 여우 그래프가 나타납니다. 최근 50 step의 실제 전달 에너지를 분모로 토끼/식물성 먹이 비율을 계산하며, 섭식이 없으면 `최근 섭식 없음`으로 표시합니다. 제거·멸종 후에도 0마리와 이력을 유지합니다.
- Reset은 원래 초기 조건·난수를 복원하고 여우와 개입 이력을 지웁니다. 기존 생태 피라미드로 돌아가며 초기 조건에 여우를 추가하지 않습니다.
- 에너지 소비/획득, 번식 문턱, 사냥 성공확률은 **단위 없는 교육용 조정값**입니다. 실제 생리값·사냥 성공률·개체군 밀도나 자연계 식단 비율을 예측하지 않습니다.

최종 수치, 기준 커밋과의 정확한 회귀 비교, 50-seed calibration 및 Edge 검증은 [Phase 2 구현·검증 보고서](docs/red-fox-food-web.md)에 정리했습니다. 토끼·여우 조건은 50개 seed 중 27개에서 600 step까지 여우가 생존했고, 기본 전체 먹이그물의 장기 공존은 드물었습니다. 식물만 있는 조건은 최대 전달 효율에서도 번식 0회였습니다.

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

## 개체 제거 실험과 그래프

자유 탐구의 ‘생태계 개입’에서 동물을 도입·재도입하거나 현재 개체군의 일부 또는 전체를 제거할 수 있습니다. 제거 대화상자는 현재 개체수의 10%를 기본값으로 사용하며 숫자 입력, −/＋, 슬라이더와 10%·25%·50%·전체 버튼을 제공합니다. 부분 제거는 simulation의 seeded RNG로 중복 없이 무작위 선택하며, 생존 개체의 ID·위치·나이·에너지를 보존합니다. 전체 제거는 선택용 RNG를 소비하지 않습니다.

실험적 제거는 자연사·포식 사망 통계에 포함되지 않습니다. `{ kind, step, species, amount, resultingCount }` 개입 이력과 그래프의 수직선·수량 라벨로 기록되며 같은 step의 변경 전·후 표본을 유지합니다. 확인 후에는 일시정지 상태를 유지하고, 취소/ESC는 열기 전 실행 상태를 복원합니다. 초기 설정은 변경하지 않으며 Reset은 초기 개체군을 복원하고 개입 이력을 지웁니다. 전체 제거 뒤에도 새 개체를 다시 도입할 수 있습니다. [구현·검증 문서](docs/runtime-ecosystem-interventions.md)를 참고하세요.

그래프 범례는 버튼이므로 마우스 hover 없이 터치로도 각 series를 표시하거나 숨길 수 있습니다.

## Challenge Mode · Apex Survival

자유 탐구와 분리된 `Apex Survival`은 식생부터 4차 소비자까지 모든 영양 단계를 동시에 유지한 logical step 수를 기록합니다.

- 도전 설정은 먹이사슬 깊이를 4차 소비자까지로 고정하고 `APEX_CHALLENGE_CONFIG`의 seed `260903`을 사용합니다.
- `Start Challenge`를 누르면 현재 파라미터의 snapshot을 저장하고 step 0에서 새 simulation을 시작합니다.
- 매 logical step 직후 식생의 `forestAbundance`와 네 소비자 population을 확인합니다. 어느 하나라도 처음 0이 된 step은 점수에 포함하지 않습니다.
- 진행 중에는 결과에 영향을 주는 설정을 잠그고, 종료 즉시 자동 해제합니다. Parameters에서 다음 도전의 조건을 수정해도 최종 결과와 숲·그래프는 새 도전 전까지 유지됩니다. 종료 후에는 primary `수정 후 도전`과 secondary `같은 조건 재현`을 표시합니다. 데스크톱에서는 같은 행에, 좁은 모바일에서는 위아래로 배치합니다.
- 화면 진행 속도는 1~40 step/s(기본 8)이며 score 계산에는 사용되지 않습니다.
- 종 제거 실험은 Apex Survival에서 비활성화되고 자유 탐구에서는 기존대로 동작합니다.
- 종료 시 마지막 숲, 그래프, 생태 피라미드와 설정을 보존하며 붕괴 step을 그래프에 표시합니다.
- Personal Best는 브라우저 `localStorage`에 score, parameter snapshot, challenge seed, simulation version, 달성 시각을 함께 저장합니다.
- 결과의 `수정 후 도전`은 Parameters를 `edit-and-start-challenge` 목적으로 열고, `설정 적용 및 도전 시작`에서 검증 후 기존 도전 시작 경로로 한 번 초기화합니다. 값 변경 없이도 시작할 수 있으며, 취소하면 결과를 유지하고 원래 버튼으로 포커스를 복귀합니다. 모달을 닫으면 일반 `edit` 목적으로 되돌립니다.
- 결과의 `같은 조건 재현`은 완료된 도전의 `parameterSnapshot`에 저장된 모든 파라미터와 동일 seed를 사용합니다. 다음 도전용 설정을 편집했어도 완료 도전의 조건으로 즉시 시작합니다.

record schema는 `ChallengeRecord<SimulationParameters>`와 `ApexSurvivalRecord`로 정의되어 있으며, 아래 중앙 기록판의 제출 payload가 이 구조를 그대로 재사용합니다.

## 중앙 leaderboard

Apex Survival 결과에서 **학교 → 학번 → 이름**을 입력해 제출합니다. 학교는 직접 입력하며 처음에는 빈칸입니다. 학교명은 공백 정리 후 최대 80자, 학번은 선행 0을 유지하는 문자열입니다. 기존 브라우저에 저장된 학번·이름은 유지하고 학교만 빈칸으로 승격합니다. Personal Best 저장 동작은 그대로입니다.

전국 랭킹은 **HAFS를 포함한 모든 학교**, HAFS 랭킹은 HAFS만 대상으로 합니다. 두 영역을 동시에 표시하고 공통 **생태계 수호단 / AI RED TEAM** 탭으로 함께 전환합니다. 요약은 최대 3행, 상세는 상위 10개 위치와 경계 점수 동점자 전원입니다. 동점은 1,1,3 순위이며 서버 제출 시각, id 순으로 정렬합니다. 두 scope는 서버에 독립적으로 조회하며 한쪽의 오류가 다른 쪽 결과를 지우지 않습니다.

공개 행은 **순위 / 학교 / 일부 가림 이름 / 점수**, 상세에는 기존 서버 제출 시각도 표시합니다. 학번과 전체 이름을 조회한 뒤 화면에서 숨기는 방식은 사용하지 않습니다.

| 대상 | 학생 권한과 계약 |
| --- | --- |
| `apex_leaderboard` | 기존 허용 제출 열 + `school_name`에만 INSERT. 원본 SELECT/UPDATE/DELETE 불가. `school_key`, `board_group`, 서버 시각, verification 열 지정 불가 |
| `apex_leaderboard_public_v2` | SELECT만. `id`, `challenge_id`, `simulation_version`, `seed`, `score`, `school_name`, `display_name`, `submitted_at`, `board_group`, `is_hafs` |
| `apex_schools`, `apex_school_aliases` | 관리자 전용 registry. 학생 조회·변조 불가 |

DB의 동일 참가자 기준은 `school_key + normalized student_number`입니다. 이름은 identity가 아닙니다. hidden을 제외하고 같은 challenge/version/seed/학교/학번에 manipulator가 있으면 protector를 제외한 다음, `score DESC, submitted_at ASC, id ASC`로 대표 최고 기록을 고릅니다. 모든 원본 제출은 보존합니다. 교사가 manipulator 지정을 모두 되돌리면 보존된 protector 기록이 다시 표시됩니다. 학생용 분류 UI는 없습니다.

HAFS 및 외대부고·용인외대부고·한국외대부고·용인한국외대부고·한국외국어대학교부설고등학교·용인한국외국어대학교부설고등학교는 등록 별칭으로 `hafs` / `HAFS`에 연결합니다. 다른 학교는 미등록 상태로도 제출할 수 있고 내부 키에 `free:` 접두사를 사용합니다. 별칭 등록은 기존 기록을 자동 re-key하지 않습니다. HAFS 입력은 재학 인증이 아니며, 미등록 학교의 다른 약칭도 자동 통합하지 않습니다. 일부 가림 이름은 완전한 익명화가 아닙니다.

제출은 `Prefer: return=minimal`로 원본에 POST합니다. 학교명·학번·이름은 simulation payload hash에 포함하지 않습니다. 점수·파라미터·challenge/version/seed의 기존 SHA-256 규칙은 유지합니다. 해시는 서버 점수 검증이나 인증 기능이 아닙니다. verification 열은 계속 비공개입니다.

### DB 설치와 운영 전환

**운영 상태는 별도 확인이 필요합니다.** 신규 빈 DB는 [`supabase/schema.sql`](supabase/schema.sql), 기존 DB는 [전환 runbook](supabase/LEADERBOARD_V2_RUNBOOK.md)의 **preflight → 승인된 expand → v2 frontend → 승인된 수동 finalize → 실제 REST/권한 검사** 순서를 따릅니다. schema.sql을 기존 DB에 다시 붙여 넣어 upgrade하지 않습니다.

- 운영 쓰기·Pages 배포는 별도 승인 단계입니다. 기능 브랜치 commit/push는 배포가 아닙니다.
- 학교 출처가 확인되지 않은 legacy 행은 HAFS로 추정하지 않습니다. 관리자가 승인한 id별 mapping 또는 모든 학교 미상 legacy 행의 HAFS 출처 확인이 필요합니다.
- expand는 bounded lock/단일 트랜잭션과 per-id 모든 기존 값 비교를 사용합니다. 정규화 중복이나 예상하지 못한 trigger/권한을 만나면 rollback합니다. 행 삭제·점수/hash 수정으로 충돌을 없애지 않습니다.
- 임시 HAFS default는 설치하지 않습니다. expand 후 구 클라이언트는 학교 미입력 제출이 실패하므로 유지보수 시간에 전환하고 새로고침을 안내합니다.
- 구 `apex_leaderboard_public` 및 다른 개인정보 공개 view/RPC를 닫기 전에는 개인정보 비공개 전환이 완료된 것이 아닙니다. finalize는 자동 migrations 밖에 있습니다.
- 복구는 원본과 개인정보 경계를 보존하는 forward-fix입니다. 구 개인정보 view를 다시 열거나 타교 기록을 삭제하지 않습니다.

### 환경변수와 Pages

`.env.example`을 참고해 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 설정합니다. service_role/secret key는 프론트엔드에 넣지 않습니다. 설정이 없으면 중앙 기록판만 비활성화되고 Personal Best는 유지됩니다.

원본은 기본 `apex_leaderboard`, 공개 endpoint는 `${VITE_LEADERBOARD_TABLE}_public_v2`입니다. `VITE_LEADERBOARD_PUBLIC_VIEW`를 지정하면 v2 endpoint여야 하며, 기존 `_public` override는 제거/수정해야 합니다. 오류 시 legacy fallback은 없습니다. GitHub Pages에서도 같은 repository variable을 확인합니다.

Pages는 main push/수동 실행 설정을 유지하되 **main + `LEADERBOARD_V2_DB_READY=true`**일 때만 배포 job을 실행합니다. 승인된 운영 expand와 실제 v2 API 검증을 마친 운영자가 이 변수를 설정합니다. feature branch push는 배포를 실행하지 않습니다. 상세 적용 파일·교사 분류·alias/re-key·충돌 진단·실패 복구·검증 재현 명령은 [runbook](supabase/LEADERBOARD_V2_RUNBOOK.md)에 있습니다.


## 대시보드와 모달

Forest 카드 내부에 STEP·식생량(성장 단계 합)·활성 소비자·최근 5 step 순변화를 표시합니다. 오른쪽은 현재 모드/점수 → 생태 피라미드 → 전국/HAFS Top 3 → 조작 순서입니다. 전체 격자는 논리 크기와 종 수를 바꾸지 않고 화면 높이에 맞춰 표시하며, 좁은 화면에서는 페이지가 정상 스크롤됩니다.

- 전체 순위 보기: 전국/HAFS를 함께 표시하며 각 영역은 Top 10과 경계 동점자 전체를 유지합니다. 조회와 제출은 분리돼 있으며 제출은 종료된 도전의 원본 기록을 사용합니다.
- Parameters: 현재 다음 도전 설정을 복사해 임시 편집합니다. 취소·닫기·Escape는 버리고, 설정 적용만 전체 검증 후 한 번 반영합니다. 변경이 없으면 초기화하지 않습니다. 배경 클릭으로는 닫히지 않습니다.
- Parameters 왼쪽에는 4차 → 3차 → 늑대 → 토끼 → 식생 순으로 초기 개체수·밀도 슬라이더를 모았습니다. 카드 폭은 영양 단계만 표현하며 값에 비례하지 않습니다. 비활성 단계도 표시하고 입력만 잠급니다. 제목 버튼을 선택하면 오른쪽에 해당 생물군의 이동·먹이/사냥·번식·사망 설정을 표시합니다. 공통 환경에는 격자·먹이사슬 단계·전달 효율·seed·토로이드 경계를 모았습니다.
- 데스크톱은 2-pane과 오른쪽 독립 스크롤, 760px 이하에서는 초기 구성 아래에 상세 설정을 배치합니다. 하단 복원·취소·적용 버튼은 항상 접근할 수 있습니다. 초기값과 기본 설정 복원도 임시 편집에만 반영되며, 섹션을 전환해도 값과 입력 요소를 유지합니다.
- 진행 중 및 일시정지된 Apex 설정은 잠깁니다. 종료 후 적용은 다음 설계만 바꾸며 점수, PB, 붕괴 정보, 제출 snapshot, 최종 숲·그래프를 보존합니다.
- native dialog를 한 번만 생성하고, 포커스 순환/복귀 및 페이지 스크롤 잠금/복원을 공유합니다. tick에서는 입력을 다시 만들거나 랭킹을 다시 조회하지 않습니다.

브라우저 fixture는 `tests/browser.html`이며 production build에 포함되지 않습니다. 합성 데이터·메모리 저장소로만 검사합니다. 서버 실행, 화면 크기, 브라우저 검사와 결과 경로는 [runbook](supabase/LEADERBOARD_V2_RUNBOOK.md#로컬-검증-재현)을 따릅니다.

## 교육적 가정과 한계

1. 기본 모형은 직선형 먹이사슬이며, 자유 탐구에서 붉은여우를 도입하면 두 먹이 연결을 더한 단순한 먹이그물이 됩니다.
2. 실제 생태계에서는 대부분 여러 종이 연결된 먹이그물을 형성합니다.
3. 영양 단계가 높아질수록 이용 가능한 에너지가 제한되는 경향이 있습니다.
4. 10%는 보편적인 자연법칙이 아니라 흔히 쓰는 교육적 대표값입니다.
5. 실제 영양 단계 간 전달 효율은 생태계와 종에 따라 달라집니다.
6. 이 simulation의 energy 값은 실제 Joule 측정치가 아닌 모델 내부 값입니다.
7. 종 제거 뒤의 변화는 실제 생태계 예측값이 아니라 이 모델의 가정과 파라미터에서 나타난 결과입니다.

## 검증

```bash
npm test
npm run test:fox
npm run calibrate:fox
npx tsc --noEmit
npm run build
```

테스트는 실제 PostgreSQL WASM 엔진에서 학교 resolver·마스킹·보존·rollback·anon/authenticated 권한을 실행하고, transport의 공개 계약·pagination·비동기 scope 상태·storage와 기존 모델/seed/도전/개인 최고 기록/파라미터/modal 회귀를 확인합니다. 운영 Supabase/PostgREST와 다중 연결 동시성은 별도 검증 대상입니다.
