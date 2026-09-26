# Apex ember border + dynamic flame tongues

## 구현

기존 `appMode → modeEffects.sync(appMode)` 연결과 continuous ember line을 유지한다. Parameters 카드, 패널 레이아웃, 시뮬레이션 난수·점수·버튼·그래프는 변경하지 않았다.

- `src/borderFlames.ts`: 전체 둘레를 약 2px 간격으로 샘플링한 뒤, **세 개의 연결된 SVG contour**를 계속 변형한다. 불꽃 개별 객체나 동일한 SVG sprite를 배치하지 않는다.
- `src/modeEffects.ts`: 기존 모드 전환·수명 관리를 유지하고 바깥 clip 범위를 12px에서 26px로 넓혔다. 움직이는 hot line은 불꽃 위에 겹친다.
- `src/simulation.css`: 붉은 외곽, 주황 중간층, 제한적인 노랑 core의 색상과 높이 배율을 정의한다. 기존 glow 크기와 강도는 그대로다.

### 연속적인 형태 변화

둘레를 순환하는 다섯 개의 공간 noise field를 사용한다. 느린 field는 활성 구간의 위치와 길이를, 세밀한 field는 불꽃의 높이·폭·갈라지는 끝을 결정한다. 추가 field가 끝의 접선 방향 휘어짐과 core 높이를 바꾼다. 각 noise cell의 phase와 변화 시간은 다르다. 2차 곡선으로 연결된 전체 윤곽을 약 30fps 상한으로 갱신하므로 단순 opacity 또는 scaleY 애니메이션과 달리 실제 path가 변한다.

기본 테두리와 각 점의 바깥 법선은 같은 rounded rectangle을 기준으로 한다. 따라서 top/up, bottom/down, left/left, right/right와 코너의 대각 방향이 이어진다. 코너와 인접한 18px 구간에는 최대 12%의 부드러운 높이 보정만 적용하며 전체 높이는 여전히 22px로 제한한다. 네 코너를 동시에 점화하거나 별도 장식을 만들지 않는다.

### 높이·시간·밀도

| 항목 | 설정 |
| --- | --- |
| 작은 / 중간 / 높은 불꽃 | 5–9 / 9–15 / 드문 15–22px |
| 비활성 구간·발생/소멸 부분 | 약 0.65px부터 연속적으로 연결 |
| 600px 이하 패널 높이 | desktop의 65%, 최대 14.3px |
| 불꽃 형태 변화 | field별 0.5–1.4초 |
| 활성 구간 생성·소멸 변화 | 0.8–2초; 개별 불꽃 객체의 고정 수명은 없음 |
| hot segment drift | 8.2초 / 9.7초 |
| 불티 | 보통 지름 1–3px, 8% 확률로 4px; 0.5–1.2초 |
| 불티 발생 시도 | 약 160–300ms 간격, 실제 활성 구간에서만 생성 |
| 불티 이동 | 바깥으로 5–14px, 접선 방향으로 약간 흔들린 뒤 소멸 |
| 불티 resource cap | 재사용 circle 최대 6개; 실제 관찰 1–4개 |

활성 구간의 목표는 전체 둘레의 약 20–35%다. 최종 1877px 브라우저에서 5px 이상 돌출한 구간은 0/1/3/5초에 각각 21.0/25.5/18.1/23.0%, 평균 21.9%였다. 15px 이상인 구간은 전체 둘레의 약 3.4–5.5%다. 불꽃 수를 고정하지 않으므로 순간적인 밀도에는 변동이 있다.

## 수명과 접근성

- 패널 측정은 초기화와 ResizeObserver에서만 한다. 프레임 중에는 SVG 좌표 계산과 path 쓰기만 하며 DOM 크기 측정이나 앱 상태 갱신을 하지 않는다.
- 점화 780ms, 종료 320ms와 모드 선택 capsule의 기존 전환을 유지한다. 자유 탐구 선택 즉시 noise 갱신/불티 생성을 멈추고 현재 윤곽을 함께 fade out한다.
- 같은 모드 재선택, Reset, Run/Pause, STEP, graph는 효과 노드나 clock을 교체하지 않는다.
- reduced motion에서는 기존 따뜻한 정적 선만 남고, 불꽃·불티·hot segment·halo는 숨긴다. noise timer와 불티 animation도 정리한다.
- 숨긴 탭은 noise clock과 불티를 일시정지한다. 복귀 시 경과 시간을 건너뛰거나 점화를 재생하지 않는다.
- 자유 탐구, 패널 제거, pagehide 및 HMR 해제 시 timer/animation/observer/listener를 기존 수명 관리에 맞춰 정리한다.
- 독립적인 장식 noise/PRNG만 사용하므로 시뮬레이션의 seeded outcome은 영향을 받지 않는다.

## 조정 위치

`.board-card`의 `--apex-flame-scale`, `--apex-corner-gain`, `--apex-hot-seconds`와 `.apex-flame-outer/middle/core`가 크기·코너·drift·색을 담당한다. `borderFlames.ts`의 `field()` 설정은 phase와 변화 시간, `draw()`는 활성 구간과 윤곽, `emitSpark()`는 불티를 담당한다. Parameters 관련 규칙과 문구는 이번 수정에서 변경하지 않았다.

## 검증 — 2026-09-26

로컬 Vite 서버와 실제 Microsoft Edge 153.0.4234.48의 headless 브라우저에서 실행했다. 격리된 저장소 fixture를 사용하며 원격 요청을 차단했다.

- `npm test`: 기존 123개 모두 통과.
- `npm run build -- --configLoader runner --outDir verification.local/flame-tongue-build`: TypeScript 및 production build 통과.
- `tests/borderFlames.browser.mjs`: 11개 검증 그룹 통과. 5초 이상 관찰하며 0/1/3/5초 screenshot 저장. 24회 샘플에서 3개 contour 모두 변화하여 총 72개의 서로 다른 윤곽 확인.
- `tests/modeEffects.browser.mjs`: 기존 모드 전환 9개 검증 그룹 통과. console error 및 원격 쓰기 요청 없음. 결과는 `verification.local/apex-transition/results.json`에 기록.
- 1920/1440/1024/600/390/320px viewport의 테두리, 레이아웃 안정성, 가로 overflow 없음, Parameters 키보드 접근, reduced motion, 빠른 모드 반전, 탭 숨김/복귀, 제거 시 cleanup 확인.
- 최대 속도 4초 비교: 움직임 사용/줄이기에서 각각 158/159 step, 완료된 도전은 모두 44 step으로 동일. p95 frame 간격은 각각 13.4/10.0ms. 로컬 headless 관찰값이며 다른 기기의 프레임 성능을 보장하는 수치는 아니다.
- 브라우저 page error 없음. 코드 수정 및 로컬 검증만 수행하며 commit/push하지 않았다.

스크린샷과 측정 결과는 Git에서 제외된 `verification.local/flame-tongues/`에 있다. `desktop-t0.png`, `desktop-t1.png`, `desktop-t3.png`, `desktop-t5.png`, `apex-390.png`, `reduced-motion.png`, `results.json`을 확인한다.

재실행 시 Vite 서버를 열고 필요하면 `TEST_ORIGIN`에 origin을 설정한다. Playwright가 있는 환경에서 `node tests/borderFlames.browser.mjs`와 `node tests/modeEffects.browser.mjs`를 실행한다.
