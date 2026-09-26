/** Presentation only: main.ts owns all actions, availability and the clock. */
export function simulationControlsMarkup(): string {
  return `<nav class="sim-toolbar" aria-label="시뮬레이션 조작">
    <div class="run-controls"><button class="run-button" id="run-button" type="button" aria-label="시뮬레이션 실행"><span>▶</span><b>Run</b></button><button id="pause-button" type="button" aria-label="시뮬레이션 일시정지" disabled><span>Ⅱ</span><b>Pause</b></button><button id="step-button" type="button" aria-label="한 step 실행"><span>↦</span><b>Step</b></button><button id="reset-button" type="button" aria-label="시뮬레이션 Reset"><span>↺</span><b>Reset</b></button></div>
    <div class="toolbar-middle"><label for="speed-control"><span>속도</span><input id="speed-control" type="range" min="1" max="40" value="8" /><output id="speed-output">8 step/s</output></label></div>
    <div class="view-controls"><button type="button" id="toggle-graph" aria-label="개체군 그래프 표시 또는 숨기기" aria-pressed="true"><span>⌁</span><b>Graph</b></button></div>
  </nav>`;
}

/** Reparent the original nodes, preserving listeners, speed and pressed state. */
export function placeSimulationControls(toolbar: HTMLElement, free: boolean): void {
  const card = toolbar.closest('#experiment-controls');
  if (free && !card) {
    const section = document.createElement('section');
    section.id = 'experiment-controls';
    section.className = 'experiment-card experiment-controls';
    section.setAttribute('aria-labelledby', 'experiment-controls-heading');
    section.innerHTML = '<h2 id="experiment-controls-heading">실험 제어</h2>';
    toolbar.replaceWith(section);
    section.append(toolbar);
  } else if (!free && card) {
    card.replaceWith(toolbar);
  }
}
