# Rabbits and Wolves Forest Simulation

고등학교 통합과학 2 수업에서 `숲 → 토끼 → 늑대` 먹이 관계와 개체군의 시간 지연을 탐구하는 격자 기반 agent-based simulation입니다.

## 핵심 모델

- 각 칸은 0–4단계의 숲 성장 상태를 가집니다.
- 숲과 동물은 같은 칸에 함께 존재할 수 있습니다.
- 토끼와 늑대는 한 칸에 한 마리만 존재합니다.
- 토끼는 숲이 많은 빈 칸을 선호하고 숲을 먹어 에너지를 얻습니다.
- 늑대는 탐색 범위의 토끼를 우선 사냥합니다.
- 두 동물은 에너지, 번식 확률, 최대 수명 규칙을 따릅니다.
- 한 step은 `숲 성장 → 토끼 이동·섭취·번식·사망 → 늑대 이동·사냥·번식·사망` 순서로 계산됩니다.
- seed를 포함한 모든 조건이 같으면 같은 결과를 재현할 수 있습니다.

## 로컬 실행

Windows에서는 `start-local.bat`을 더블 클릭하거나 다음 명령을 실행합니다.

```bash
npm install
npm run dev
```

브라우저에서 `http://127.0.0.1:5173/predator-prey-simulation-2/`를 엽니다.

## 포함 기능

- 고해상도 Canvas 격자와 5단계 숲 색상
- 작은 셀용 단순 실루엣 자동 전환
- 토끼 2안·늑대 2안 아이콘 비교와 A+A 조합 적용
- Run, Pause, Step, Reset, 속도 조절
- 시작 조건, 숲, 토끼, 늑대 파라미터 전체 조절
- 토로이드 경계 on/off와 랜덤 seed 재현
- 토끼·늑대·숲 밀도 실시간 그래프
- 출생, 사망, 사냥, 숲 섭취 누적 통계
- 클릭·터치 기반 칸 상태 확인
- 교육용 관찰 포인트, 행동 순서, 모형 한계 설명
- iPad와 작은 화면을 위한 반응형 UI

## 검증

```bash
npm test
npm run build
```

## GitHub Pages 배포

`.github/workflows/deploy.yml`이 포함되어 있습니다. 저장소의 **Settings → Pages → Build and deployment**에서 Source를 **GitHub Actions**로 선택한 뒤 `main` 브랜치에 push하면 테스트와 빌드 후 자동 배포됩니다.

배포 주소: <https://suimaire.github.io/predator-prey-simulation-2/>

현재 `vite.config.ts`의 기본 경로는 `/predator-prey-simulation-2/`입니다. GitHub 저장소 이름이 다르면 이 값을 `/<저장소 이름>/`으로 바꾸세요.
