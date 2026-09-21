type Mode = 'free' | 'apex';
type VisualElement = HTMLElement | SVGElement;

/** Decoration only. The caller supplies the committed mode; this never changes it. */
export function createModeEffects(panel: HTMLElement, initialMode: Mode, motion: MediaQueryList) {
  const tab = panel.querySelector<HTMLButtonElement>('[data-app-mode="apex"]')!;
  const flame = panel.querySelector<HTMLElement>('.apex-tab-ignition')!;
  const glow = panel.querySelector<HTMLElement>('.apex-tab-glow')!;
  const layer = document.createElement('div');
  layer.className = 'apex-panel-heat';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `<svg class="apex-panel-outline" focusable="false">
    <g class="apex-heat-steady">
      ${Array.from({ length: 4 }, (_, i) => `<g class="apex-heat-section apex-heat-section-${i}"><path class="apex-heat-halo"/><path class="apex-heat-line"/></g>`).join('')}
    </g>
    <g class="apex-heat-sweep">
      <path class="apex-heat-halo" pathLength="1"/><path class="apex-heat-line" pathLength="1"/>
      <path class="apex-heat-halo" pathLength="1"/><path class="apex-heat-line" pathLength="1"/>
    </g>
  </svg><div class="apex-edge-flames">${Array.from({ length: 5 }, () => '<i></i>').join('')}</div>`;
  panel.append(layer);
  const svg = layer.querySelector<SVGSVGElement>('svg')!;
  const steady = layer.querySelector<SVGGElement>('.apex-heat-steady')!;
  const sweep = layer.querySelector<SVGGElement>('.apex-heat-sweep')!;
  const flames = layer.querySelector<HTMLElement>('.apex-edge-flames')!;
  let mode = initialMode;
  let disposed = false;
  let revision = 0;
  // Values live in the board-card CSS block, including the timings used by WAAPI.
  const styles = getComputedStyle(panel);
  const value = (name: string) => Number.parseFloat(styles.getPropertyValue(`--apex-${name}`));
  const timing = {
    tab: value('tab-delay'), panel: value('panel-delay'), spread: value('spread-ms'),
    settle: value('settle-ms'), cool: value('cool-ms'), tabGlow: value('tab-glow'), tabPeak: value('tab-peak'),
  };
  const animations = new Map<Animation, { target: VisualElement; properties: string[] }>();

  function animate(target: VisualElement, frames: Keyframe[], duration: number, delay = 0) {
    const animation = target.animate(frames, { duration, delay, easing: 'ease-out', fill: 'both' });
    const properties = Object.keys(frames[0]).filter(key => key !== 'offset' && key !== 'easing');
    animations.set(animation, { target, properties });
    return animation;
  }

  // Freeze only animated properties before cancellation, so rapid reversals start
  // at the visible state. No timers or old completion callbacks survive a revision.
  function freeze() {
    revision++;
    for (const [animation, { target, properties }] of animations) {
      const current = getComputedStyle(target);
      for (const property of properties) target.style.setProperty(property.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), current[property as keyof CSSStyleDeclaration] as string);
      animation.cancel();
    }
    animations.clear();
  }

  const opacity = (target: VisualElement) => Number(getComputedStyle(target).opacity);

  function settle() {
    freeze();
    const apex = mode === 'apex';
    panel.dataset.modeEffects = mode;
    panel.dataset.modePhase = apex ? 'steady' : 'idle';
    layer.style.opacity = apex ? '1' : '0';
    steady.style.opacity = apex ? '1' : '0';
    sweep.style.opacity = '0';
    sweep.style.strokeDashoffset = '1';
    flames.style.opacity = apex ? '1' : '0';
    flame.style.opacity = apex ? '1' : '0';
    flame.style.transform = apex ? 'scale(1)' : 'scale(.35)';
    glow.style.opacity = apex ? String(timing.tabGlow) : '0';
  }

  function geometry() {
    if (disposed) return;
    // Only called on initial layout and ResizeObserver notifications, never per frame.
    const bounds = panel.getBoundingClientRect();
    const tabBounds = tab.getBoundingClientRect();
    const w = bounds.width - 2, h = bounds.height - 2;
    const r = Math.max(1, Number.parseFloat(getComputedStyle(panel).borderTopLeftRadius) - 1);
    const x = Math.max(r, Math.min(w - r, tabBounds.x + tabBounds.width / 2 - bounds.x));
    const mid = w / 2;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const upperLeft = `M ${x} 0 H ${r} Q 0 0 0 ${r} V ${h / 2}`;
    const upperRight = `M ${x} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h / 2}`;
    const lowerLeft = `M 0 ${h / 2} V ${h - r} Q 0 ${h} ${r} ${h} H ${mid}`;
    const lowerRight = `M ${w} ${h / 2} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${mid}`;
    [upperLeft, upperRight, lowerLeft, lowerRight].forEach((d, i) => {
      layer.querySelectorAll(`.apex-heat-section-${i} path`).forEach(path => path.setAttribute('d', d));
    });
    const paths = sweep.querySelectorAll('path');
    const left = `${upperLeft} V ${h - r} Q 0 ${h} ${r} ${h} H ${mid}`;
    const right = `${upperRight} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${mid}`;
    paths.forEach((path, i) => path.setAttribute('d', i < 2 ? left : right));
  }

  function sync(next: Mode) {
    if (disposed || next === mode) return;
    const wasCooling = panel.dataset.modePhase === 'leaving';
    freeze();
    mode = next;
    panel.dataset.effectsStatic = String(motion.matches || document.hidden);
    panel.dataset.modeEffects = mode;
    if (motion.matches || document.hidden) { settle(); return; }
    const currentRevision = revision;
    panel.dataset.modePhase = mode === 'apex' ? 'entering' : 'leaving';
    if (mode === 'free') {
      animate(flame, [
        { opacity: opacity(flame), transform: getComputedStyle(flame).transform },
        { opacity: 0, transform: 'scale(.35)' },
      ], timing.cool * .65);
      animate(glow, [{ opacity: opacity(glow) }, { opacity: 0 }], timing.cool);
      const end = animate(layer, [{ opacity: opacity(layer) }, { opacity: 0 }], timing.cool);
      void end.finished.then(() => { if (currentRevision === revision && !disposed) settle(); }, () => {});
      return;
    }

    const resume = wasCooling && opacity(layer) > .01;
    if (!resume) steady.style.opacity = '0';
    const delay = resume ? 0 : timing.panel;
    animate(flame, [
      { opacity: opacity(flame), transform: getComputedStyle(flame).transform },
      { opacity: 1, transform: 'scale(1)' },
    ], timing.tab, resume ? 0 : timing.tab);
    animate(glow, [
      { opacity: opacity(glow) }, { opacity: timing.tabPeak, offset: .3 }, { opacity: timing.tabGlow },
    ], timing.settle - timing.tab, resume ? 0 : timing.tab);
    animate(layer, [{ opacity: opacity(layer) }, { opacity: 1 }], timing.tab, delay);
    const remaining = resume ? Number.parseFloat(getComputedStyle(sweep).strokeDashoffset) : 1;
    animate(sweep, [{ strokeDashoffset: remaining }, { strokeDashoffset: 0 }], timing.spread * remaining, delay);
    animate(sweep, [{ opacity: resume ? opacity(sweep) : 1 }, { opacity: 1, offset: .62 }, { opacity: 0 }], timing.settle - delay, delay);
    animate(flames, [{ opacity: opacity(flames) }, { opacity: 1 }], timing.settle - timing.panel, delay);
    const end = animate(steady, [{ opacity: opacity(steady) }, { opacity: 1 }], timing.settle - timing.panel - timing.spread, timing.panel + timing.spread);
    void end.finished.then(() => { if (currentRevision === revision && !disposed) settle(); }, () => {});
  }

  function environmentChanged() {
    panel.dataset.effectsStatic = 'true';
    panel.dataset.effectsPaused = String(document.hidden);
    // Finish past entrances on hide and on preference changes, never replay on return.
    settle();
  }

  function pageHidden(event: PageTransitionEvent) {
    if (!event.persisted) { destroy(); return; }
    environmentChanged();
    panel.dataset.effectsPaused = 'true';
  }

  const resize = new ResizeObserver(geometry);
  resize.observe(panel);
  resize.observe(tab);
  // Also releases resources when the owning panel is removed by a future UI mount.
  const removal = new MutationObserver(() => { if (!panel.isConnected) destroy(); });
  removal.observe(document.body, { childList: true, subtree: true });
  motion.addEventListener('change', environmentChanged);
  document.addEventListener('visibilitychange', environmentChanged);
  window.addEventListener('pagehide', pageHidden);
  window.addEventListener('pageshow', environmentChanged);

  function destroy() {
    if (disposed) return;
    freeze();
    disposed = true;
    resize.disconnect();
    removal.disconnect();
    motion.removeEventListener('change', environmentChanged);
    document.removeEventListener('visibilitychange', environmentChanged);
    window.removeEventListener('pagehide', pageHidden);
    window.removeEventListener('pageshow', environmentChanged);
    layer.remove();
    delete panel.dataset.modeEffects;
    delete panel.dataset.modePhase;
    delete panel.dataset.effectsPaused;
    delete panel.dataset.effectsStatic;
    [flame, glow].forEach(target => target.removeAttribute('style'));
  }

  environmentChanged();
  geometry();
  return { sync, destroy };
}
