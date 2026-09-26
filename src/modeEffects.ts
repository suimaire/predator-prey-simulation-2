import { createBorderFlames, createBorderSampler } from './borderFlames.ts';

type Mode = 'free' | 'apex';
type VisualElement = HTMLElement | SVGElement;
let effectId = 0;

/** Decoration only. The caller supplies the committed mode; this never changes it. */
export function createModeEffects(panel: HTMLElement, initialMode: Mode, motion: MediaQueryList) {
  const flame = panel.querySelector<HTMLElement>('.apex-tab-ignition')!;
  const glow = panel.querySelector<HTMLElement>('.apex-tab-glow')!;
  const layer = document.createElement('div');
  layer.className = 'apex-panel-heat';
  layer.setAttribute('aria-hidden', 'true');
  const id = `apex-ember-${++effectId}`;
  layer.innerHTML = `<div class="apex-heat-steady"><svg class="apex-panel-outline apex-static-outline" focusable="false">
    <defs>
      <linearGradient id="${id}-color" gradientUnits="userSpaceOnUse" x2="193" y2="137" spreadMethod="reflect">
        <stop stop-color="#a8311c"/><stop offset=".18" stop-color="#f25820"/>
        <stop offset=".43" stop-color="#ffb333"/><stop offset=".56" stop-color="#ffdb72"/>
        <stop offset=".7" stop-color="#ff7a23"/><stop offset="1" stop-color="#c63b1b"/>
      </linearGradient>
      <linearGradient id="${id}-core" gradientUnits="userSpaceOnUse" x2="271" y2="89" spreadMethod="reflect">
        <stop stop-color="#ff8730"/><stop offset=".34" stop-color="#ffe8a0"/>
        <stop offset=".53" stop-color="#fff1b6"/><stop offset=".78" stop-color="#ffb43c"/>
        <stop offset="1" stop-color="#ed6226"/>
      </linearGradient>
      <clipPath id="${id}-outside"><path class="apex-heat-clip" clip-rule="evenodd"/></clipPath>
    </defs>
    <g clip-path="url(#${id}-outside)">
        <path class="apex-perimeter apex-heat-halo"/>
        <path class="apex-perimeter apex-heat-base"/>
        <path class="apex-perimeter apex-heat-line" stroke="url(#${id}-color)"/>
        <path class="apex-perimeter apex-heat-core" stroke="url(#${id}-core)"/>
        <path class="apex-heat-grain" stroke="url(#${id}-core)"/>
    </g>
  </svg><svg class="apex-panel-outline apex-active-outline" focusable="false">
    <g clip-path="url(#${id}-outside)">
        <path class="apex-perimeter apex-heat-hot" pathLength="1000"/>
        <path class="apex-perimeter apex-heat-hot apex-heat-hot-secondary" pathLength="1000"/>
      <g class="apex-edge-flames"></g>
    </g>
  </svg></div>`;
  panel.append(layer);
  const outlines = layer.querySelectorAll<SVGSVGElement>('.apex-panel-outline');
  const steady = layer.querySelector<HTMLElement>('.apex-heat-steady')!;
  const flames = layer.querySelector<SVGGElement>('.apex-edge-flames')!;
  const borderFlames = createBorderFlames(flames);
  let mode = initialMode;
  let disposed = false;
  let revision = 0;
  // Values live in the board-card CSS block, including the timings used by WAAPI.
  const styles = getComputedStyle(panel);
  const value = (name: string) => Number.parseFloat(styles.getPropertyValue(`--apex-${name}`));
  const timing = {
    tab: value('tab-delay'), panel: value('panel-delay'),
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

  function syncBorderFlames() {
    borderFlames.sync(panel.dataset.modePhase !== 'idle', panel.dataset.effectsPaused === 'true', motion.matches, mode === 'apex');
  }

  function settle() {
    freeze();
    const apex = mode === 'apex';
    panel.dataset.modeEffects = mode;
    panel.dataset.modePhase = apex ? 'steady' : 'idle';
    layer.style.opacity = apex ? '1' : '0';
    steady.style.opacity = apex ? '1' : '0';
    flames.style.opacity = apex ? '1' : '0';
    flame.style.opacity = apex ? '1' : '0';
    flame.style.transform = apex ? 'scale(1)' : 'scale(.35)';
    glow.style.opacity = apex ? String(timing.tabGlow) : '0';
    syncBorderFlames();
  }

  function geometry() {
    if (disposed) return;
    // Only called on initial layout and ResizeObserver notifications, never per frame.
    const bounds = panel.getBoundingClientRect();
    const w = bounds.width - 2, h = bounds.height - 2;
    if (w <= 0 || h <= 0) return;
    const r = Math.max(1, Math.min(w / 2, h / 2, Number.parseFloat(getComputedStyle(panel).borderTopLeftRadius) - 1));
    outlines.forEach(svg => svg.setAttribute('viewBox', `0 0 ${w} ${h}`));
    const rounded = (inset: number) => {
      const cr = Math.max(.1, r - inset), right = w - inset, bottom = h - inset;
      return `M ${r} ${inset} H ${w - r} A ${cr} ${cr} 0 0 1 ${right} ${r} V ${h - r} A ${cr} ${cr} 0 0 1 ${w - r} ${bottom} H ${r} A ${cr} ${cr} 0 0 1 ${inset} ${h - r} V ${r} A ${cr} ${cr} 0 0 1 ${r} ${inset} Z`;
    };
    const d = rounded(0);
    layer.querySelectorAll('.apex-perimeter').forEach(path => path.setAttribute('d', d));
    // A single connected, slightly uneven hot edge, sampled only on resize.
    // Subpixel grain breaks the mechanically smooth outline without adding icons.
    const perimeter = createBorderSampler(w, h, r);
    const { length } = perimeter, samples = Math.ceil(length / 3);
    const grain = Array.from({ length: samples }, (_, i) => {
      const distance = i / samples * length;
      const p = perimeter.point(distance);
      const noise = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      const outward = .15 + (noise - Math.floor(noise)) * .9;
      return `${i ? 'L' : 'M'} ${(p.x + p.ty * outward).toFixed(2)} ${(p.y - p.tx * outward).toFixed(2)}`;
    }).join(' ');
    layer.querySelector('.apex-heat-grain')!.setAttribute('d', `${grain} Z`);
    // Exclude the white interior; retain at most .55px of the border's inner half.
    layer.querySelector('.apex-heat-clip')!.setAttribute('d', `M -12 -12 H ${w + 12} V ${h + 12} H -12 Z ${rounded(.55)}`);
    borderFlames.geometry(w, h, r);
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
    syncBorderFlames();
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
    animate(steady, [{ opacity: opacity(steady) }, { opacity: 1 }], timing.settle - delay, delay);
    const flickerDelay = resume ? 0 : delay + 180;
    const end = animate(flames, [{ opacity: opacity(flames) }, { opacity: 1 }], timing.settle - flickerDelay, flickerDelay);
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
    syncBorderFlames();
  }

  const resize = new ResizeObserver(geometry);
  resize.observe(panel);
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
    borderFlames.destroy();
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
