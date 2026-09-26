# Apex ember border

## 구조

`main.ts`의 기존 `appMode → modeEffects.sync(appMode)` 연결을 사용한다. 시뮬레이션 상태, 난수, Start Challenge, 점수, 그래프, 동물 아이콘은 변경하지 않는다.

- `modeEffects.ts`: 한 번 생성한 SVG, 모드 선택 애니메이션, 점화/종료, 환경 설정과 observer 수명을 관리한다.
- `borderFlames.ts`: 테두리 좌표를 계산하고 잠깐 생기는 미세 돌출부와 불티만 관리한다. 예전 12개 flame sprite, upright silhouette, orbit/offset-path, travel fallback, corner animation은 제거했다.
- `simulation.css`: 발열선과 glow, 밝은 구간, 미세 불꽃 및 모드별 Parameters 표현을 정의한다.

### 세 레이어

1. 좁은 바깥 glow: 6px stroke에 2px blur, opacity .22. SVG의 even-odd clip은 흰 패널 내부를 제외한다.
2. 연결된 발열선: 동일한 closed rounded perimeter 위에 붉은 바탕, 주황 gradient, 밝은 core를 겹친다. 하나의 연결된 미세 굴곡선이 지나치게 매끈한 경계를 완화한다. 불규칙한 길이의 짧은 hot segment 두 겹만 느리게 이동하고 밝기를 변화시킨다. 코너도 같은 선이며 별도 burst가 없다.
3. 미세 불꽃/불티: 최대 6개 path와 2개 circle을 재사용한다. 3–7px의 비대칭 곡선을 발생할 때마다 새로 계산하고 테두리의 바깥 법선으로 향하게 한다. 약 1.6–2.7초에 걸쳐 부드럽게 나타났다 사라진다. 드문 1.1–2.4px 불티는 바깥으로 4–9px 이동한다. 코너 부근의 돌출 높이는 최대 40% 감소하고 밝기도 줄어든다.

미세 불꽃은 약 350–660ms의 불규칙한 간격으로 발생하며 보통 3–5개가 보인다. 소형 패널은 더 천천히 발생하고 최대 높이가 5px이다. 별도 로컬 PRNG만 사용한다. 패널 둘레를 도는 독립된 불꽃은 없다.

## 성능과 수명

- 패널 크기는 초기화와 `ResizeObserver`에서만 측정한다. 곡선 샘플은 순수 좌표 계산을 사용한다. 프레임마다 DOM 측정, 앱 상태 갱신, JS animation loop를 실행하지 않는다.
- 점화 780ms, 종료 320ms. 모드 선택 capsule은 기존 애니메이션을 유지한다. 미세 효과 생성은 자유 탐구 선택 시 즉시 중지된다.
- STEP, Run/Pause, Reset, graph, 같은 모드 재선택은 SVG를 교체하거나 점화를 반복하지 않는다.
- 빠른 반전은 현재 보이는 속성을 동결한 뒤 이어서 전환한다. 이전 완료 콜백은 revision으로 무효화된다.
- 동작 줄이기에서는 따뜻한 정적 경계만 남는다. 이동 segment, 미세 불꽃, 불티, halo를 제거하고 생성 timer를 취소한다.
- 탭 숨김은 장식만 정지한다. 다시 보이면 점화를 재생하지 않는다. 시뮬레이션 실행 정책은 바꾸지 않는다.
- 자유 탐구에서는 생성 timer/장식 animation이 없다. 패널 제거, pagehide 및 HMR 해제 시 observer, event listener, timer, animation도 정리한다. 패널을 유지하는 동안 resize/removal observer는 다음 모드 전환을 위해 유지된다.

## 조절 위치

`src/simulation.css`의 `.board-card`:

| 변수 | 기본값 | 역할 |
| --- | --- | --- |
| `--apex-panel-delay` | `290` | 패널 점화 시작(ms) |
| `--apex-settle-ms` | `780` | 점화 완료(ms) |
| `--apex-cool-ms` | `320` | 종료(ms) |
| `--apex-panel-glow` | `.22` | 바깥 glow 강도 |
| `--apex-glow-blur` | `2px` | glow 범위 |
| `--apex-line-width` | `2.3px` | 주 발열선 두께 |
| `--apex-line-opacity` | `.96` | 주 발열선 강도 |
| `--apex-hot-seconds` | `54s` | 주 hot segment 주기 |
| `--apex-lick-interval` | `470` | 미세 불꽃 발생 간격 기준(ms) |
| `--apex-lick-height` | `7` | 미세 불꽃 최대 높이(px) |
| `--apex-corner-scale` | `.6` | 코너 미세 불꽃 높이 배율 |

600px 이하의 container 규칙은 간격 `700`, 높이 `5`로 덮어쓴다. `borderFlames.ts` 상단의 `LICK_POOL_SIZE` / `EMBER_POOL_SIZE`는 동시 최대 개수다. `emit()`에 수명, 형태, 불티 확률이 있으며 `modeEffects.ts` SVG gradient에 색상과 분포가 있다.

Parameters 색/테두리/아이콘 변수는 `.parameter-entry`, Apex 우선순위는 `.apex-mode .parameter-entry`, CTA는 `.parameter-entry-action`에 있다. 문구는 `main.ts`의 `updateControlAvailability()`에서 기존 모드와 설정 잠금 상태를 따른다.

## 검증 실행

Playwright가 설치된 환경에서 Vite 서버를 실행한 뒤:

```sh
npm test
npm run build -- --configLoader runner --outDir verification.local/ember-release
node tests/modeEffects.browser.mjs
node tests/borderFlames.browser.mjs
```

서버가 기본 5173이 아니면 `TEST_ORIGIN`에 해당 origin을 지정한다. 테스트는 원격 요청을 차단하고 기존 local storage fixture를 사용한다. 실제 순위 기록은 제출하지 않는다.

스크린샷과 시간/성능 측정은 Git에서 제외되는 `verification.local/ember-border/`, 모드 회귀 결과는 `verification.local/apex-transition/`에 저장한다. 실제 실행 결과와 검증 범위는 `ui-refinement.md`에 기록한다.
