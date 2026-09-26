// Small, temporary deformations of the hot boundary, never travelling sprites.
const LICK_POOL_SIZE = 6;
const EMBER_POOL_SIZE = 2;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Analytic sampling avoids repeated SVG geometry queries during a resize.
export function createBorderSampler(w: number, h: number, r: number) {
  const horizontal = w - 2 * r, vertical = h - 2 * r, arc = Math.PI * r / 2;
  const lengths = [horizontal, arc, vertical, arc, horizontal, arc, vertical, arc];
  const length = lengths.reduce((sum, part) => sum + part, 0);
  return {
    length,
    point(distance: number) {
      let d = ((distance % length) + length) % length, part = 0;
      while (part < 7 && d > lengths[part]) d -= lengths[part++];
      if (part === 0) return { x: r + d, y: 0, tx: 1, ty: 0 };
      if (part === 2) return { x: w, y: r + d, tx: 0, ty: 1 };
      if (part === 4) return { x: w - r - d, y: h, tx: -1, ty: 0 };
      if (part === 6) return { x: 0, y: h - r - d, tx: 0, ty: -1 };
      const angle = (part - 3) * Math.PI / 4 + d / r;
      const cx = part < 4 ? w - r : r, cy = part === 1 || part === 7 ? r : h - r;
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), tx: -Math.sin(angle), ty: Math.cos(angle) };
    },
  };
}

export function createBorderFlames(layer: SVGGElement) {
  function pool(tag: 'path' | 'circle', className: string, count: number) {
    return Array.from({ length: count }, () => {
      const element = document.createElementNS(SVG_NS, tag);
      element.setAttribute('class', className);
      layer.append(element);
      return { element, animation: null as Animation | null };
    });
  }
  const licks = pool('path', 'apex-edge-lick', LICK_POOL_SIZE);
  const embers = pool('circle', 'apex-border-ember', EMBER_POOL_SIZE);
  const particles = [...licks, ...embers];
  let active = false, emitting = false, paused = false, reduced = false, disposed = false;
  let timer: number | undefined;
  let width = 0, height = 0, radius = 0, length = 0;
  let perimeter: ReturnType<typeof createBorderSampler> | undefined;
  let interval = 470, maxHeight = 7, cornerScale = .6;
  // Private decoration PRNG: no imports, shared seed, or simulation RNG consumption.
  let seed = 0x6d2b79f5;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };

  function stop() { window.clearTimeout(timer); timer = undefined; }
  function clearParticles() {
    for (const particle of particles) { particle.animation?.cancel(); particle.animation = null; }
  }

  function emit() {
    if (!active || !emitting || paused || reduced || disposed || !length) return;
    const slot = licks.find(item => !item.animation || item.animation.playState === 'finished');
    if (!slot) return;
    slot.animation?.cancel();
    const distance = random() * length;
    const point = perimeter!.point(distance);
    const { tx, ty } = point;
    const nx = ty, ny = -tx;
    const cornerDistance = Math.max(Math.min(point.x, width - point.x), Math.min(point.y, height - point.y));
    const corner = Math.max(0, Math.min(1, (radius + 24 - cornerDistance) / 24));
    const rise = (3 + random() * (maxHeight - 3)) * (1 - corner * (1 - cornerScale));
    const span = 6 + random() * 10, lean = (random() - .5) * span * .7;
    const p = (along: number, out: number) => `${(point.x + tx * along + nx * out).toFixed(2)} ${(point.y + ty * along + ny * out).toFixed(2)}`;
    // An asymmetrical sliver joined to the line at both ends. Its normal always
    // points outside, including on the sides, bottom and rounded corners.
    slot.element.setAttribute('d', `M ${p(-span / 2, 0)} Q ${p(-span * .16, .6)} ${p(lean - 1, rise * .48)} Q ${p(lean + 1.3, rise * .73)} ${p(lean, rise)} Q ${p(lean + 2, rise * .38)} ${p(span * .26, .8)} Q ${p(span * .4, .2)} ${p(span / 2, 0)} Z`);
    slot.animation = slot.element.animate([
      { opacity: 0 }, { opacity: .8 - corner * .22, offset: .28 },
      { opacity: .48, offset: .63 }, { opacity: 0 },
    ], { duration: 1600 + random() * 1100, easing: 'ease-in-out' });

    if (random() > .3 || corner > .5) return;
    const ember = embers.find(item => !item.animation || item.animation.playState === 'finished');
    if (!ember) return;
    ember.animation?.cancel();
    ember.element.setAttribute('cx', String(point.x + nx * 2));
    ember.element.setAttribute('cy', String(point.y + ny * 2));
    ember.element.setAttribute('r', String(.55 + random() * .65));
    const drift = 4 + random() * 5, sideways = (random() - .5) * 4;
    ember.animation = ember.element.animate([
      { opacity: 0, transform: 'translate(0, 0)' },
      { opacity: .7, offset: .2 },
      { opacity: 0, transform: `translate(${nx * drift + tx * sideways}px, ${ny * drift + ty * sideways}px)` },
    ], { duration: 650 + random() * 450, easing: 'ease-out' });
  }

  function schedule() {
    if (timer !== undefined || !active || !emitting || paused || reduced || disposed || !length) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      emit();
      schedule();
    }, interval * (.75 + random() * .65));
  }

  function reconcile() {
    if (disposed) return;
    if (!active || !emitting || paused || reduced) stop();
    if (!active || reduced) clearParticles();
    else for (const particle of particles) {
      if (paused && particle.animation?.playState === 'running') particle.animation.pause();
      else if (!paused && particle.animation?.playState === 'paused') particle.animation.play();
    }
    schedule();
  }

  return {
    geometry(w: number, h: number, r: number) {
      width = w; height = h; radius = r;
      clearParticles();
      perimeter = createBorderSampler(w, h, r);
      length = perimeter.length;
      const styles = getComputedStyle(layer);
      const value = (name: string) => Number.parseFloat(styles.getPropertyValue(`--apex-${name}`));
      interval = Math.max(250, value('lick-interval'));
      maxHeight = Math.max(3, Math.min(8, value('lick-height')));
      cornerScale = value('corner-scale');
      reconcile();
    },
    sync(nextActive: boolean, nextPaused: boolean, nextReduced: boolean, nextEmitting: boolean) {
      active = nextActive; paused = nextPaused; reduced = nextReduced; emitting = nextEmitting;
      reconcile();
    },
    destroy() { disposed = true; stop(); clearParticles(); },
  };
}
