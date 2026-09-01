# 포식자-피식자 동역학 실험실

고등학교 통합과학 수업을 위한 Lotka-Volterra 개체군 동역학 시뮬레이션입니다. 표준 모형과 피식자의 환경수용력을 포함한 확장 모형을 비교할 수 있습니다.

## 로컬 실행

Windows에서는 `start-local.bat`을 더블 클릭하면 의존성을 설치하고 미리보기 서버를 시작합니다. 또는 터미널에서 다음 명령을 실행합니다.

```bash
npm install
npm run dev
```

브라우저에서 `http://127.0.0.1:5173/predator-prey-simulation/`을 엽니다.

## 포함 기능

- 표준 Lotka-Volterra 모형과 RK4 수치 적분
- 환경수용력 K를 포함한 로지스틱 확장 모형
- 시간 그래프, 위상 그래프, 동시 보기
- Run, Live, Pause, Reset, Step, 시간 탐색
- 현재 개체군 축약 그림과 음성 피드백 순환 설명
- 세 가지 예측-검증 탐구 질문
- PC, iPad, 터치 입력 대응 반응형 화면

## 검증

```bash
npm test
npm run build
```

## GitHub Pages

저장소 이름은 `predator-prey-simulation`을 기준으로 하며, `main` 브랜치에 푸시하면 GitHub Actions가 테스트와 빌드를 거쳐 Pages에 배포합니다. 저장소의 Settings, Pages, Build and deployment에서 Source를 GitHub Actions로 선택해야 합니다.
