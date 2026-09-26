// Decoration has fixed phases/variations, and never consumes the simulation RNG.
const FLAME_POOL_SIZE = 12;
const EMBER_POOL_SIZE = 4;
const SHAPES = [
  ['M6 0H8V5H10V8H12V17H10V20H3V18H1V11H3V7H5V12H6Z', 'M7 6H8V10H10V16H9V18H4V16H3V12H5V14H6V9H7Z', 'M7 12H8V15H9V17H5V15H6V13H7Z'],
  ['M4 1H6V4H8V8H11V11H12V17H10V20H3V18H1V12H2V9H4V12H6V8H4Z', 'M6 6H7V9H9V12H10V16H9V18H4V16H3V13H5V14H6Z', 'M6 12H8V14H9V17H5V15H6Z'],
  ['M8 0H10V4H8V7H10V10H12V16H11V18H9V20H3V18H1V10H3V6H4V11H6V8H7V4H8Z', 'M8 5V10H9V12H10V16H8V18H4V16H3V12H5V14H6V10H7V7H8Z', 'M7 11H8V15H9V17H5V14H6V12H7Z'],
];

export function createBorderFlames(layer: HTMLElement) {
  const motionPath = CSS.supports('offset-path', 'path("M 0 0 L 10 10")');
  layer.dataset.travel = motionPath ? 'motion-path' : 'keyframes';
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const flames = Array.from({ length: FLAME_POOL_SIZE }, (_, i) => {
    const mover = document.createElement('span');
    mover.className = 'apex-flame-orbit';
    // Interleave both halves so hiding odd entries on small panels keeps even spacing.
    const phase = Math.floor(i / 2) / 6 + (i % 2) / FLAME_POOL_SIZE;
    const start = (phase + .024 + (i % 3) * .007) % 1;
    mover.style.setProperty('--flame-delay', `calc(var(--apex-orbit-seconds) * -${start}s)`);
    mover.style.setProperty('--flame-size', String(.86 + (i * 7 % 12) * .02));
    mover.style.setProperty('--flame-beat', `${.83 + (i * 7 % 11) * .06}s`);
    mover.style.setProperty('--flame-beat-delay', `${-i * .237}s`);
    mover.innerHTML = `<span class="apex-flame-body"><svg viewBox="0 0 13 20" focusable="false">${SHAPES.map((shape, frame) => `<g class="apex-flame-frame apex-flame-frame-${frame}">${shape.map((d, color) => `<path class="apex-flame-color-${color}" d="${d}"/>`).join('')}</g>`).join('')}</svg></span>`;
    layer.append(mover);
    return { mover, body: mover.querySelector<HTMLElement>('.apex-flame-body')!, phase: start, fallback: null as Animation | null, corner: null as Animation | null };
  });
  const embers = Array.from({ length: EMBER_POOL_SIZE }, () => {
    const element = document.createElement('i');
    element.className = 'apex-border-ember';
    layer.append(element);
    return { element, animation: null as Animation | null };
  });
  let active = false, emitting = false, paused = false, reduced = false, disposed = false;
  let timer: number | undefined;
  let width = 0, height = 0, length = 0, serial = 0;
  let cornerRadius = 0, cornerFalloff = 30;
  let count = FLAME_POOL_SIZE, duration = 24000, emberInterval = 500;
  let fallbackFrames: Keyframe[] = [];
  let cornerFrames: Keyframe[] = [];

  function cornerWeight(x: number, y: number) {
    const distance = Math.max(Math.min(x, width - x), Math.min(y, height - y));
    return Math.max(0, Math.min(1, (cornerRadius + cornerFalloff - distance) / cornerFalloff));
  }

  function stopEmbers() {
    window.clearInterval(timer);
    timer = undefined;
  }

  function emitEmber() {
    if (!active || !emitting || paused || reduced || disposed || !length) return;
    const slot = embers.find(ember => !ember.animation || ember.animation.playState === 'finished');
    if (!slot) return;
    slot.animation?.cancel();
    const visible = flames.filter(({ mover }) => !mover.hidden);
    const source = visible[serial % visible.length];
    const progress = motionPath
      ? Number.parseFloat(getComputedStyle(source.mover).offsetDistance) / 100
      : ((Number(source.fallback?.currentTime ?? 0) / duration + source.phase) % 1);
    const point = path.getPointAtLength(progress * length);
    const corner = cornerWeight(point.x, point.y);
    // Thin only corner sparks; advancing the serial also avoids retrying one source.
    if (corner > .5 && serial % 2 === 0) { serial++; return; }
    const size = 2 + serial % 3;
    const dx = point.x < 8 ? -4 : point.x > width - 8 ? 4 : (serial % 3 - 1) * 3;
    // Bottom sparks drift outward; elsewhere they rise, always within the border band.
    const dy = point.y > height - 8 ? 5 : -5;
    slot.element.style.cssText = `left:${point.x}px;top:${point.y}px;width:${size}px;height:${size}px`;
    slot.animation = slot.element.animate([
      { transform: 'translate(-50%, -50%) scale(.7)', opacity: 0 },
      { opacity: .75 * (1 - corner * .3), offset: .18 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.4)`, opacity: 0 },
    ], { duration: 640 + serial % 4 * 90, easing: 'ease-out' });
    serial++;
  }

  function reconcile() {
    if (disposed) return;
    const running = active && emitting && !paused && !reduced;
    if (running && timer === undefined) timer = window.setInterval(emitEmber, emberInterval);
    if (!running) stopEmbers();
    for (const ember of embers) {
      if (reduced || !active) { ember.animation?.cancel(); ember.animation = null; }
      else if (paused && ember.animation?.playState === 'running') ember.animation.pause();
      else if (!paused && ember.animation?.playState === 'paused') ember.animation.play();
    }
    for (const item of flames) {
      if (!active || reduced || item.mover.hidden) {
        item.corner?.cancel(); item.corner = null;
      } else if (cornerFrames.length) {
        if (!item.corner) item.corner = item.body.animate(cornerFrames, {
          duration, delay: -item.phase * duration, iterations: Infinity, easing: 'linear',
        });
        // Share the travel clock so resizing, cooling reversals and pauses cannot
        // move the softened region away from the actual panel corners.
        const travel = motionPath ? item.mover.getAnimations()[0] : item.fallback;
        item.corner.currentTime = Number(travel?.currentTime ?? 0);
      }
      if (paused) item.corner?.pause();
      else if (item.corner?.playState === 'paused') item.corner.play();
      if (motionPath) continue;
      if (!active || reduced || item.mover.hidden) {
        item.fallback?.cancel(); item.fallback = null;
      } else if (fallbackFrames.length) {
        if (!item.fallback) item.fallback = item.mover.animate(fallbackFrames, {
          duration, delay: -item.phase * duration, iterations: Infinity, easing: 'linear',
        });
        if (paused) item.fallback.pause();
        else if (item.fallback.playState === 'paused') item.fallback.play();
      }
    }
  }

  function geometry(w: number, h: number, radius: number) {
    width = w; height = h;
    // A spark's old absolute position must not enlarge scrollable overflow after
    // a panel shrinks, even when its animation has already become transparent.
    for (const ember of embers) {
      ember.animation?.cancel(); ember.animation = null;
      ember.element.removeAttribute('style');
    }
    const r = Math.min(radius, w / 2, h / 2);
    const d = `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
    path.setAttribute('d', d);
    length = path.getTotalLength();
    layer.style.setProperty('--apex-orbit-path', `path("${d}")`);
    const styles = getComputedStyle(layer);
    const value = (name: string) => Number.parseFloat(styles.getPropertyValue(`--apex-${name}`));
    cornerRadius = r;
    cornerFalloff = Math.max(1, Math.min(value('corner-falloff'), w / 4, h / 4));
    // Only a few stops per corner, computed on resize. No per-frame JS or RNG.
    const arc = Math.PI * r / 2, horizontal = w - 2 * r, vertical = h - 2 * r;
    const corners = [horizontal, horizontal + arc + vertical,
      2 * horizontal + 2 * arc + vertical, 2 * horizontal + 3 * arc + 2 * vertical];
    const distances = [0, length, ...corners.flatMap(start =>
      [-cornerFalloff, 0, arc, arc + cornerFalloff].map(delta => (start + delta + length) % length))];
    cornerFrames = [...new Set(distances)].sort((a, b) => a - b).map(distance => {
      const point = path.getPointAtLength(distance);
      const weight = cornerWeight(point.x, point.y);
      const blend = (edge: number, corner: number) => edge + (corner - edge) * weight;
      return {
        offset: distance / length,
        scale: String(blend(1, value('corner-scale'))),
        opacity: value('flame-opacity') * blend(1, value('corner-opacity')),
        filter: `drop-shadow(0 0 ${blend(1.5, value('corner-glow-blur'))}px rgb(235 91 26 / ${value('flame-glow')})) brightness(${blend(1, value('corner-brightness'))}) saturate(${blend(1, value('corner-saturation'))})`,
      };
    });
    flames.forEach(item => (item.corner?.effect as KeyframeEffect | null)?.setKeyframes(cornerFrames));
    count = Math.max(1, Math.min(FLAME_POOL_SIZE, Number.parseInt(styles.getPropertyValue('--apex-orbit-count'))));
    duration = Number.parseFloat(styles.getPropertyValue('--apex-orbit-seconds')) * 1000;
    emberInterval = Number.parseFloat(styles.getPropertyValue('--apex-ember-interval'));
    // Spread the visible subset around the route; all nodes are reused.
    const visibleIndices = new Set(Array.from({ length: count }, (_, i) => Math.floor(i * FLAME_POOL_SIZE / count)));
    flames.forEach(({ mover }, i) => { mover.hidden = !visibleIndices.has(i); });
    if (!motionPath) {
      // Compatibility fallback: precompute the same curve once per resize. WAAPI
      // interpolates these positions; there is no application animation-frame loop.
      const steps = Math.ceil(length / 4);
      fallbackFrames = Array.from({ length: steps + 1 }, (_, i) => {
        const p = path.getPointAtLength(i / steps * length);
        return { transform: `translate(${p.x}px, ${p.y}px)`, offset: i / steps };
      });
      flames.forEach(item => (item.fallback?.effect as KeyframeEffect | null)?.setKeyframes(fallbackFrames));
    }
    reconcile();
  }

  return {
    geometry,
    sync(nextActive: boolean, nextPaused: boolean, nextReduced: boolean, nextEmitting: boolean) {
      active = nextActive; paused = nextPaused; reduced = nextReduced; emitting = nextEmitting;
      reconcile();
    },
    destroy() {
      disposed = true;
      stopEmbers();
      flames.forEach(item => item.fallback?.cancel());
      flames.forEach(item => item.corner?.cancel());
      embers.forEach(ember => ember.animation?.cancel());
    },
  };
}
