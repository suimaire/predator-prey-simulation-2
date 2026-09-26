# Apex Survival 테두리 불꽃

`main.ts`의 기존 `appMode → modeEffects.sync(appMode)` 연결을 그대로 사용한다. `modeEffects.ts`가 모드 전환, 점화, 종료, 접근성 설정, 탭 숨김과 해제를 담당하며, `borderFlames.ts`는 전달받은 활성 상태에 맞춰 장식만 관리한다. 도전의 준비·실행·일시 정지 상태와 연결하지 않는다.

## 동작과 범위

- `.board-card` 안의 기존 `aria-hidden` 장식 레이어에만 추가한다. 레이아웃, 페이지 overflow, 격자, 다른 패널은 변경하지 않는다.
- CSS motion path의 닫힌 둥근 사각형을 24초에 순환한다. `offset-rotate: 0deg`로 불꽃은 항상 위를 향한다.
- 바깥 요소가 이동하고 안쪽 SVG가 약 0.76–1.24배로 변화한다. 크기·위상·0.83–1.43초 주기가 다르며, 같은 밝기의 SVG 실루엣 3개가 불꽃 끝과 중심 형태를 바꾼다.
- `ResizeObserver`에서만 패널 경로와 표시 개수를 갱신한다. 프레임마다 크기를 측정하거나 애플리케이션 상태를 변경하지 않는다.
- 12개 불꽃과 4개 불티 슬롯을 한 번 만들고 재사용한다. 패널 내용 너비 600px 이하에서는 불꽃 6개를 고르게 표시한다.
- 불티는 초당 2개, 2–4px, 수명 640–910ms이다. 모드를 떠날 때 새 발생을 즉시 중단하고 기존 레이어가 320ms에 사라진다. 종료 뒤 타이머와 장식 애니메이션이 남지 않는다.
- 고정된 개별 위상을 사용하므로 장식은 난수를 소비하지 않는다. 시뮬레이션 시드와 결과에 영향을 주지 않는다.
- 동작 줄이기에서는 순환·형태 변화·불티를 끄고 기존 정적 강조를 남긴다. 숨긴 탭에서는 장식만 일시 정지한다.
- motion path 미지원 시 같은 SVG 경로를 크기 변경 때 약 4px 간격으로 샘플링해 Web Animations API의 위치 키프레임으로 이동한다. 별도 프레임 루프나 라이브러리는 없다.

## 조정 위치

`src/simulation.css`의 `.board-card` 변수:

| 항목 | 변수 / 기본값 |
| --- | --- |
| 불꽃 개수 | `--apex-orbit-count: 12` (최대 12) |
| 한 바퀴 시간 | `--apex-orbit-seconds: 24` |
| 기본 크기 | `--apex-flame-width: 11px`, `--apex-flame-height: 18px` |
| 본체 강도 | `--apex-flame-opacity: .94` |
| 주변 빛 | `--apex-flame-glow: .22` |
| 불티 간격 | `--apex-ember-interval: 500` (밀리초) |
| 종료 시간 | `--apex-cool-ms: 320` |

`@container (max-width: 600px)`에서 작은 패널의 개수 6개와 크기 9×14px를 조절한다. `apex-flame-breathe` 키프레임은 크기 변화 폭과 흔들림, `.apex-flame-color-*`는 진한 빨강·주황·노랑을 지정한다. `borderFlames.ts`의 풀 상수, `SHAPES`, `--flame-size`·`--flame-beat` 설정은 최대 개수, SVG 형태, 개별 크기·주기를 지정한다. 튜닝 후에는 작은 화면에서 잘림과 가로 넘침을 다시 확인한다.

## 검증

```sh
npm test
npm run build
# Vite와 Playwright가 사용 가능한 환경에서:
node tests/borderFlames.browser.mjs
node tests/modeEffects.browser.mjs
```

브라우저 테스트는 격리된 저장소 fixture를 사용하고 외부 요청을 차단한다. 시간차 스크린샷과 실제 프레임별 좌표, 네 모서리 통과, 반복 전환, 종료 정리, 크기 변경, 격자 클릭, 키보드, 동작 줄이기, 숨김 이벤트, 40 step/s 실행 및 강제로 선택한 대체 경로를 검사한다. 결과는 Git에서 제외되는 `verification.local/border-flames/`에 저장한다. 숨김 검사는 이벤트 모의이며 실제 기기의 탭 전환을 대신하지 않는다.

현재 환경에서 기존 `modeEffects.browser.mjs`는 1440px에서 자유 탐구/Apex 탭의 y좌표가 6px 다른 기존 화면 동작 때문에 중단된다. 수정 전 HEAD의 CSS/효과 코드에서도 동일하게 재현했다. 이 변경은 기존 배치를 보존하며 해당 레이아웃을 수정하지 않는다.

이번 검증에서는 Edge 153에서 새 브라우저 검사 13개 그룹과 단위 테스트 123개가 통과했다. 40 step/s를 4초 동안 실행하며 동일 조건으로 재도전했을 때 장식 사용 시 156 STEP, 동작 줄이기 시 158 STEP을 처리했으며, 양쪽 모두 각 도전의 붕괴 STEP은 44로 동일했다. 헤드리스 환경의 측정이므로 실기기 성능 보증은 아니다. Safari·Firefox와 실제 기기의 탭 전환은 검증하지 않았다. Windows의 320px 데스크톱 뷰포트에서는 기존 스크롤바 여백 때문에 원래 패널도 일부 가려지므로, 추가로 터치 모바일 뷰포트 320px에서 온전한 표시를 확인했다.

샌드박스에서 기존 `node_modules/.vite-temp`와 `dist` 쓰기가 제한되어 빌드는 `npm run build -- --configLoader runner --outDir verification.local/flame-release-check`로 같은 설정을 읽고 별도 출력 경로에 생성했다.
