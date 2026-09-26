# UI refinement verification — continuous ember boundary

## 변경 범위

- `src/modeEffects.ts`: 기존 앱 모드를 받아 연속된 rounded SVG border와 점화/종료를 제어한다. 정적인 gradient/glow와 움직이는 segment/미세 효과를 별도 SVG로 분리해 blur 재계산을 줄인다.
- `src/borderFlames.ts`: 반복 flame sprite/궤도 이동을 제거했다. 바깥쪽을 향하는 짧은 비대칭 경계 돌출과 드문 불티를 생성한다. 좌표 계산은 패널 layout 측정 없이 수행한다.
- `src/simulation.css`: 좁은 glow, 약 1–3px 발열선, 밝은 구간, 코너 감쇠, reduced motion, Parameters의 시각적 위계를 조절한다.
- `src/main.ts`: 기존 Parameters 버튼의 CTA와 모드/잠금별 안내 문구만 변경한다.
- `tests/borderFlames.browser.mjs`, `tests/modeEffects.browser.mjs`: 새 효과의 연속성, 시간 변화, 접근성, 모드 전환과 cleanup을 검증한다.
- `docs/apex-border-flames.md`: 구조와 조절 변수를 설명한다.

시뮬레이션 규칙, grid, seed, 개체 수/점수/순위, Start Challenge, 조작/그래프 로직, 동물 sprite와 통계 배치는 변경하지 않았다. commit/push는 수행하지 않았다.

## Parameters

우측 기존 위치와 하나의 native button 구조를 유지했다. 아이콘 박스, 테두리 대비, 연한 초록 배경과 제목을 강화하고 오른쪽에 작은 `설계 열기 →` 표시를 추가했다. CTA는 별도 중첩 버튼이 아니며 카드 전체가 같은 설정창을 연다.

자유 탐구: “개체수와 환경 조건을 조정해 실험을 설계하세요.”
Apex 준비/종료: “다음 도전의 개체수와 환경 조건을 설계하세요.”
Apex 실행/일시정지: 기존 잠금 안내와 “설정 보기 →”.

Apex의 진한 Start Challenge 버튼이 우선한다. Hover는 1px 상승과 작은 그림자, 키보드 focus는 진한 초록 outline이다. 작은 화면에서는 CTA가 같은 카드 안에서 줄바꿈된다. 동작 줄이기에서는 hover 이동도 제거한다.

## 실제 검증

- 기존 단위 테스트 123개 통과.
- TypeScript 검사와 Vite production build 통과. 현재 환경의 기존 `node_modules/.vite-temp` 쓰기 제한을 피해 `--configLoader runner`와 `verification.local/ember-release` 출력 경로를 사용했다.
- Edge 153의 border 브라우저 테스트 11개 그룹 통과. 320/390/600/1024/1440/1920px에서 두 모드, 크기 변경, 가로 넘침, 클릭, 키보드 포커스, 설정창 열기/닫기/포커스 복귀를 확인했다.
- 모드 브라우저 테스트 9개 그룹 통과. 반복 선택, rapid toggle, 전환 취소/반전, 초기 Apex 복원, 셀 클릭, 키보드, Run/Pause/Step/Reset, Start Challenge, 활성 도전 이탈 확인과 reduced motion을 검증했다.
- 5초 이상 실제 시간으로 hot segment 이동과 불규칙한 미세 효과 변화를 측정했다. 폐기한 flame sprite DOM은 0개이며, 현재 효과 DOM은 재렌더링/Reset/반복 전환 중 재사용된다.
- 패널 바깥 효과와 코너, 작은 화면, hover/focus, 정적 reduced motion 스크린샷을 직접 확인했다. 둥근 경계는 연결되고 큰 코너 burst/넓은 붉은 halo가 없으며 내부의 가독성은 유지된다.
- 종료 약 340ms, 자유 탐구의 생성 timer/장식 animation 0. 패널 제거 시 timer, observer와 장식 animation 모두 0.
- Page Visibility는 합성 이벤트로 숨김/복귀를 검증했다. 실제 OS 탭 전환을 했다는 의미는 아니다.
- 40 step/s, 각 4초 관찰에서 animation 사용 시 158 step, reduced motion 시 159 step 진행했다. 각 도전의 종료 step은 양쪽 모두 44로 동일했다. 동일한 생태계와 seed를 유지했다.
- 해당 headless 관찰의 frame 간격: animation 사용 median 10.0ms / p95 26.7ms, reduced motion median 3.4ms / p95 23.3ms. 이는 로컬 관찰값이며 모든 기기에서의 무손실 성능 보장은 아니다.
- 브라우저 console/page error 및 실제 외부 순위 제출 없음.

### 기존 테스트의 독립적인 문제

수정 전 `modeEffects.browser.mjs`는 1440px에서 탭의 절대 y좌표가 6px 달라 실패했다. 모드별 legend 줄바꿈이 header 높이를 바꾸기 때문이다. 앱 배치는 유지하고 테스트를 header 중심에 대한 상대 위치 비교로 수정했다. 새 점화 방식에 맞춰 이전 sweep 검증은 `tab → boundary → micro effects` 순서 검증으로 교체했다.

### 검증하지 않은 범위

Firefox/Safari, 실제 모바일 하드웨어/저성능 기기, 실제 OS 탭 숨김/복귀, 실제 외부 순위 서버 연동은 이번 실행에서 검증하지 않았다. 브라우저 검증은 외부 요청을 차단한 기존 fixture를 사용했다.

스크린샷/측정 결과: `verification.local/ember-border/`, `verification.local/apex-transition/` (Git 제외).
로컬 확인: `http://127.0.0.1:5174/predator-prey-simulation-2/`에서 Apex Survival을 선택한다.
