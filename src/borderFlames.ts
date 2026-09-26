// Three continuous, deforming heat bands. No individual flame objects or sprites.
const EMBER_POOL_SIZE = 6;
const FRAME_MS = 1000 / 30;
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
  const bands = ['outer', 'middle', 'core'].map(name => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', `apex-flame-band apex-flame-${name}`);
    layer.append(path);
    return path;
  });
  const embers = pool('circle', 'apex-border-ember', EMBER_POOL_SIZE);
  let active = false, emitting = false, paused = false, reduced = false, disposed = false;
  let timer: number | undefined;
  let length = 0, time = 0, lastFrame = 0, nextSpark = 0;
  let perimeter: ReturnType<typeof createBorderSampler> | undefined;
  let flameScale = 1, cornerGain = .12;
  let samples: { distance: number; corner: number; height: number }[] = [];
  // Private decoration PRNG: no imports, shared seed, or simulation RNG consumption.
  let seed = 0x6d2b79f5;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };

  const smooth = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
  const hash = (cell: number, salt: number) => {
    let n = Math.imul(cell + 1, 374761393) ^ Math.imul(salt, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };

  // Periodic spatial noise: the last cell joins the first around the rounded
  // perimeter. Every cell has its own clock, so regions grow, split and recede
  // without a shared pulse or a fixed inventory of flame silhouettes.
  function field(spacing: number, minLife: number, maxLife: number, salt: number) {
    const count = Math.max(4, Math.round(length / spacing));
    const clocks = Array.from({ length: count }, (_, i) => ({
      phase: hash(i, salt) * 100,
      duration: minLife + hash(i, salt + 1) * (maxLife - minLife),
    }));
    const values = new Float64Array(count);
    return {
      update(t: number) {
        clocks.forEach(({ phase, duration }, i) => {
          const clock = t / duration + phase, frame = Math.floor(clock), blend = smooth(clock - frame);
          const a = hash(i, salt + frame * 31), b = hash(i, salt + (frame + 1) * 31);
          values[i] = a + (b - a) * blend;
        });
      },
      at(distance: number) {
        const position = ((distance % length + length) % length) / length * count;
        const i = Math.floor(position), blend = smooth(position - i);
        return values[i] + (values[(i + 1) % count] - values[i]) * blend;
      },
    };
  }
  let fields: ReturnType<typeof field>[] = [];

  function stop() { window.clearTimeout(timer); timer = undefined; lastFrame = 0; }
  function clearParticles() {
    for (const particle of embers) { particle.animation?.cancel(); particle.animation = null; }
  }

  function draw() {
    fields.forEach(f => f.update(time));
    const [regions, tongues, forks, sway, heat] = fields;
    const contours: { x: number; y: number }[][] = [[], [], []];
    for (const sample of samples) {
      const s = sample.distance;
      const activity = smooth((regions.at(s) - .43) / .32);
      // Fine folds over a slower envelope produce narrow tips, changing widths
      // and secondary peaks that merge again. Height is never a scaleY tween.
      const fold = tongues.at(s) * .82 + forks.at(s) * .18;
      const ridge = Math.pow(Math.max(0, 1 - Math.abs(fold - .52) * 2.7), 3);
      const rise = Math.min(22, .65 + activity * (1 + (15 + heat.at(s) * 9) * ridge) * (1 + sample.corner * cornerGain));
      sample.height = rise * flameScale;
      const lean = (sway.at(s) - .5) * 20 * activity;
      const coreHeat = heat.at(s);
      const heights = [sample.height, sample.height * (.58 + coreHeat * .16), Math.min(4.5, sample.height * (.15 + coreHeat * .14))];
      heights.forEach((out, band) => {
        const p = perimeter!.point(s + lean * Math.pow(out / 22, 1.5));
        contours[band].push({ x: p.x + p.ty * out, y: p.y - p.tx * out });
      });
    }
    contours.forEach((points, band) => {
      const first = points[0], last = points[points.length - 1];
      const commands = [`M ${((last.x + first.x) / 2).toFixed(2)} ${((last.y + first.y) / 2).toFixed(2)}`];
      points.forEach((p, i) => {
        const next = points[(i + 1) % points.length];
        commands.push(`Q ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${((p.x + next.x) / 2).toFixed(2)} ${((p.y + next.y) / 2).toFixed(2)}`);
      });
      // The shared outside clip cuts out the white panel, leaving a single
      // continuous ribbon rooted in the original hot line, on all four sides.
      bands[band].setAttribute('d', `${commands.join(' ')} Z`);
    });
  }

  function emitSpark() {
    const ember = embers.find(item => !item.animation || item.animation.playState === 'finished');
    if (!ember) return;
    let sample = samples[Math.floor(random() * samples.length)];
    for (let attempt = 0; sample.height < 7 * flameScale && attempt < 12; attempt++) sample = samples[Math.floor(random() * samples.length)];
    if (sample.height < 7 * flameScale) return;
    const { x, y, tx, ty } = perimeter!.point(sample.distance), nx = ty, ny = -tx;
    ember.animation?.cancel();
    const origin = sample.height * .5;
    ember.element.setAttribute('cx', String(x + nx * origin));
    ember.element.setAttribute('cy', String(y + ny * origin));
    ember.element.setAttribute('r', String((random() < .08 ? 2 : .5 + random()) * flameScale));
    const drift = (5 + random() * 9) * flameScale, sideways = (random() - .5) * 7;
    ember.animation = ember.element.animate([
      { opacity: 0, transform: 'translate(0, 0)' },
      { opacity: .88, offset: .18, transform: `translate(${nx * drift * .2 + tx * sideways}px, ${ny * drift * .2 + ty * sideways}px)` },
      { opacity: .55, offset: .56, transform: `translate(${nx * drift * .6 - tx * sideways * .3}px, ${ny * drift * .6 - ty * sideways * .3}px)` },
      { opacity: 0, transform: `translate(${nx * drift + tx * sideways}px, ${ny * drift + ty * sideways}px)` },
    ], { duration: 500 + random() * 700, easing: 'ease-out' });
  }

  function schedule() {
    if (timer !== undefined || !active || !emitting || paused || reduced || disposed || !length) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      const now = performance.now();
      time += lastFrame ? Math.min(80, now - lastFrame) / 1000 : FRAME_MS / 1000;
      lastFrame = now;
      draw();
      if (time >= nextSpark) { emitSpark(); nextSpark = time + .16 + random() * .14; }
      schedule();
    }, FRAME_MS);
  }

  function reconcile() {
    if (disposed) return;
    if (!active || !emitting || paused || reduced) stop();
    if (!active || reduced) {
      clearParticles();
      bands.forEach(path => path.removeAttribute('d'));
    } else for (const particle of embers) {
      if (paused && particle.animation?.playState === 'running') particle.animation.pause();
      else if (!paused && particle.animation?.playState === 'paused') particle.animation.play();
    }
    if (active && emitting && !paused && !reduced && length && timer === undefined) { draw(); schedule(); }
  }

  return {
    geometry(w: number, h: number, r: number) {
      clearParticles();
      perimeter = createBorderSampler(w, h, r);
      length = perimeter.length;
      const count = Math.ceil(length / 2);
      samples = Array.from({ length: count }, (_, i) => {
        const distance = i * length / count, p = perimeter!.point(distance);
        const cornerDistance = Math.max(Math.min(p.x, w - p.x), Math.min(p.y, h - p.y));
        return { distance, corner: smooth((r + 18 - cornerDistance) / 18), height: 0 };
      });
      fields = [field(52, .8, 2, 11), field(13, .5, 1.4, 23), field(6, .55, 1.1, 47), field(27, .6, 1.3, 71), field(38, .7, 1.4, 101)];
      const styles = getComputedStyle(layer);
      const value = (name: string) => Number.parseFloat(styles.getPropertyValue(`--apex-${name}`));
      flameScale = value('flame-scale') || 1;
      cornerGain = value('corner-gain') || .12;
      if (active && !reduced) draw();
      reconcile();
    },
    sync(nextActive: boolean, nextPaused: boolean, nextReduced: boolean, nextEmitting: boolean) {
      active = nextActive; paused = nextPaused; reduced = nextReduced; emitting = nextEmitting;
      reconcile();
    },
    destroy() { disposed = true; stop(); clearParticles(); bands.forEach(path => path.remove()); },
  };
}
