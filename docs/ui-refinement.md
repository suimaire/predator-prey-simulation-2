# 자유 탐구 / Apex UI 미세 조정

## 기존 렌더링 위치

- `src/main.ts`: `.board-heading .mode-switch`에서 모드 선택, `.simulation-console`에서 우측 패널, `#toggle-parameters`에서 설정창 진입을 렌더링한다.
- `src/modeEffects.ts`: 기존 모드 상태를 받아 `.board-card` 안의 발열선과 불꽃 레이어를 관리한다. 이번 조정에서는 수정하지 않았다.
- `src/borderFlames.ts`: 재사용하는 불꽃 12개와 불티 4개, 이동 경로와 수명을 관리한다.
- `src/simulation.css`: 패널, 버튼, 발열선, 불꽃 표현 및 반응형 규칙을 정의한다.

## 설계 진입점

기존 `#toggle-parameters` 버튼을 하단 Graph 옆에서 콘솔 상단으로 이동했다. 버튼과 이벤트, `ParameterDraft`, 설정창, 적용·취소·도전 잠금 로직은 그대로 사용한다.

- 자유 탐구: 모드 제목 바로 아래에 연한 그린 카드로 표시한다. ‘생태계 설계 / Parameters’, 슬라이더 아이콘, 개체수·환경 조건 안내로 기능을 설명한다.
- Apex: 기존 도전 패널 바로 아래에 같은 형태로 표시한다. 배경과 테두리를 한 단계 옅게 해 진한 ‘도전 시작’ 버튼이 최우선으로 유지된다. 진행·일시정지 중에도 열 수 있지만 안내는 설정 확인으로 바뀌고 입력은 기존대로 잠긴다.
- 최소 높이 66px, 분명한 hover/active/expanded/focus-visible 상태를 제공한다. 주목을 유도하는 반복 애니메이션은 추가하지 않았다.
- 작은 화면은 기존 ‘격자판 → 콘솔 → 하단 조작’ 순서를 유지한다. 설계 진입점은 피라미드·랭킹·Run/Pause보다 먼저 보인다. 화면 높이와 모드에 따라 콘솔까지 스크롤이 필요할 수 있다.

## 코너 감쇠

얇은 발열선, 직선 구간의 불꽃, 색상 계열, 이동 경로, 풀 크기와 속도를 유지한다. 모서리 전후 30px에서만 부드럽게 감쇠하여 둥근 코너에서 최대 감소한다.

- 크기: 기존의 64%로 줄여 돌출을 줄인다.
- 불투명도: 기존의 72%로 줄인다.
- 불꽃 그림자 blur: 1.5px → 0.55px.
- 밝기 92%, 채도 86%.
- 코너 근처 불티 발생 기회는 절반만 사용하며, 남은 불티의 최대 불투명도도 최대 30% 줄인다.

감쇠 키프레임은 크기 변경 때 계산하고 브라우저 애니메이션으로 재생한다. 이동 애니메이션과 시계를 맞추며 별도 프레임 루프·시뮬레이션 난수를 사용하지 않는다. 모드 종료·동작 줄이기·숨김·제거의 기존 수명 관리에 함께 연결된다.

## 조정 위치

`src/simulation.css`의 `.board-card`:

| 변수 | 기본값 | 역할 |
| --- | --- | --- |
| `--apex-corner-falloff` | `30` | 둥근 모서리 전후 감쇠 거리(px) |
| `--apex-corner-scale` | `.64` | 코너 크기 배율 |
| `--apex-corner-opacity` | `.72` | 코너 불투명도 배율 |
| `--apex-corner-glow-blur` | `.55` | 코너 불꽃 blur(px) |
| `--apex-corner-brightness` | `.92` | 코너 밝기 |
| `--apex-corner-saturation` | `.86` | 코너 채도 |

같은 파일의 `.parameter-entry`에서 배경·테두리·hover·아이콘 배경 변수, 버튼 높이·간격·글자 크기를 조정한다. `.apex-mode .parameter-entry`가 Apex의 낮은 강조 수준을 덮어쓴다. 모드/잠금 안내 문구는 `src/main.ts`의 `updateControlAvailability()`에 있다. 불티 감쇠 기준은 `src/borderFlames.ts`의 `emitEmber()`에 있다.

## 확인

- 기존 단위 테스트 123개 통과.
- 설정창 키보드 열기·Escape 닫기·포커스 복귀, 취소·적용, Step/Reset/Graph, 모드별 설정 보존, 도전 중 읽기 전용을 실제 Edge에서 확인.
- 320/390/600/1024/1440/1920px에서 설계 버튼의 배치·줄바꿈·추가 가로 넘침을 확인. 320/390px 터치 뷰포트에서 두 모드의 설정창 열기·닫기도 확인했다.
- `tests/borderFlames.browser.mjs`의 13개 검증 그룹 통과. 자연스럽게 이동할 때 네 코너의 감쇠, 직선 구간 강도 유지, 크기 변경, 전환, 종료, 동작 줄이기 및 대체 이동 경로를 검증했다.
- Edge 153에서 확인했으며, Firefox/Safari는 검증하지 않았다.
- 최종 UI 스크린샷·측정 결과는 Git에서 제외되는 `verification.local/ui-refinement/`, 불꽃 검증 결과는 `verification.local/border-flames/`에 저장한다.

이 환경에서는 기존 `node_modules/.vite-temp` 쓰기가 제한되므로 배포 빌드는 다음처럼 같은 Vite 설정을 직접 읽고 별도 검증 디렉터리에 생성한다.

```sh
npm run build -- --configLoader runner --outDir verification.local/ui-release-check
npm test
node tests/borderFlames.browser.mjs
```
