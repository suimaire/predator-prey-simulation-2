import { firstPeakLag } from './analysis.ts';
import { equilibrium, nearestState, type ModelKind, type ModelParameters, type PopulationState } from './model.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface ChartOptions {
  trajectory: PopulationState[];
  visibleUntil: number;
  selectedTime: number;
  parameters: ModelParameters;
  model: ModelKind;
  onSelectTime: (time: number) => void;
}

interface PlotGeometry {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function addText(
  svg: SVGSVGElement,
  text: string,
  x: number,
  y: number,
  className: string,
  anchor: 'start' | 'middle' | 'end' = 'start',
): SVGTextElement {
  const node = svgElement('text', { x, y, class: className, 'text-anchor': anchor });
  node.textContent = text;
  svg.append(node);
  return node;
}

function geometry(svg: SVGSVGElement): PlotGeometry {
  const width = Math.max(320, Math.round(svg.parentElement?.clientWidth ?? 760));
  const height = width < 520 ? 330 : 390;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('height', String(height));
  return { width, height, left: width < 520 ? 58 : 68, right: 20, top: 24, bottom: 54 };
}

function scaleLinear(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number) {
  const span = domainMax - domainMin || 1;
  return (value: number) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

function pathFrom(
  points: PopulationState[],
  x: (point: PopulationState) => number,
  y: (point: PopulationState) => number,
): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point).toFixed(2)},${y(point).toFixed(2)}`).join(' ');
}

function niceMaximum(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 10;
  const exponent = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / exponent * 2) / 2 * exponent;
}

function formatAxis(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  if (value >= 100) return value.toFixed(0);
  return value.toFixed(value < 10 ? 1 : 0);
}

function addFrameAndGrid(
  svg: SVGSVGElement,
  plot: PlotGeometry,
  xTicks: number[],
  yTicks: number[],
  xScale: (value: number) => number,
  yScale: (value: number) => number,
  xFormatter = formatAxis,
  yFormatter = formatAxis,
) {
  const xEnd = plot.width - plot.right;
  const yEnd = plot.height - plot.bottom;
  svg.append(svgElement('rect', {
    x: plot.left,
    y: plot.top,
    width: xEnd - plot.left,
    height: yEnd - plot.top,
    class: 'chart-frame',
  }));

  for (const tick of yTicks) {
    const y = yScale(tick);
    svg.append(svgElement('line', { x1: plot.left, x2: xEnd, y1: y, y2: y, class: 'chart-grid' }));
    addText(svg, yFormatter(tick), plot.left - 10, y + 4, 'chart-tick', 'end');
  }
  for (const tick of xTicks) {
    const x = xScale(tick);
    svg.append(svgElement('line', { x1: x, x2: x, y1: plot.top, y2: yEnd, class: 'chart-grid chart-grid-vertical' }));
    addText(svg, xFormatter(tick), x, yEnd + 23, 'chart-tick', 'middle');
  }
}

function addSelectedTooltip(
  svg: SVGSVGElement,
  plot: PlotGeometry,
  state: PopulationState,
  markerX: number,
  preyY: number,
  predatorY: number,
) {
  const yEnd = plot.height - plot.bottom;
  svg.append(svgElement('line', {
    x1: markerX,
    x2: markerX,
    y1: plot.top,
    y2: yEnd,
    class: 'chart-selection-guide',
  }));
  svg.append(svgElement('circle', { cx: markerX, cy: preyY, r: 5, class: 'chart-marker prey-stroke' }));
  svg.append(svgElement('rect', {
    x: markerX - 5,
    y: predatorY - 5,
    width: 10,
    height: 10,
    rx: 2,
    class: 'chart-marker predator-stroke',
  }));

  const tooltipWidth = 174;
  const tooltipX = markerX + tooltipWidth + 18 < plot.width ? markerX + 12 : markerX - tooltipWidth - 12;
  const tooltipY = Math.max(plot.top + 8, Math.min(yEnd - 82, Math.min(preyY, predatorY) - 32));
  const group = svgElement('g', { class: 'chart-tooltip', 'aria-hidden': 'true' });
  group.append(svgElement('rect', { x: tooltipX, y: tooltipY, width: tooltipWidth, height: 76, rx: 8 }));
  const rows = [
    `${state.time.toFixed(2)}년`,
    `● 피식자 ${state.prey.toFixed(1)}`,
    `◆ 포식자 ${state.predator.toFixed(1)}`,
  ];
  rows.forEach((row, index) => {
    const text = svgElement('text', { x: tooltipX + 12, y: tooltipY + 21 + index * 22, class: `chart-tooltip-row row-${index}` });
    text.textContent = row;
    group.append(text);
  });
  svg.append(group);
}

export function drawTimeChart(svg: SVGSVGElement, options: ChartOptions): void {
  svg.replaceChildren();
  const title = svgElement('title');
  title.textContent = '시간에 따른 피식자와 포식자 개체수';
  const desc = svgElement('desc');
  desc.textContent = '피식자는 원, 포식자는 마름모와 선으로 표시되며 피식자 정점 뒤 포식자 정점이 나타납니다.';
  svg.append(title, desc);

  const plot = geometry(svg);
  const xEnd = plot.width - plot.right;
  const yEnd = plot.height - plot.bottom;
  const duration = options.trajectory.at(-1)?.time ?? 20;
  const yMax = niceMaximum(Math.max(...options.trajectory.flatMap((point) => [point.prey, point.predator])) * 1.08);
  const xScale = scaleLinear(0, duration, plot.left, xEnd);
  const yScale = scaleLinear(0, yMax, yEnd, plot.top);
  const xTickCount = plot.width < 520 ? 5 : 6;
  const xTicks = Array.from({ length: xTickCount }, (_, index) => duration * index / (xTickCount - 1));
  const yTicks = Array.from({ length: 5 }, (_, index) => yMax * index / 4);
  addFrameAndGrid(svg, plot, xTicks, yTicks, xScale, yScale, (value) => value.toFixed(0), formatAxis);

  const visible = options.trajectory.filter((point) => point.time <= options.visibleUntil + 1e-9);
  const preyPath = svgElement('path', { class: 'series-line prey-line', d: pathFrom(visible, (point) => xScale(point.time), (point) => yScale(point.prey)) });
  const predatorPath = svgElement('path', { class: 'series-line predator-line', d: pathFrom(visible, (point) => xScale(point.time), (point) => yScale(point.predator)) });
  svg.append(preyPath, predatorPath);

  const lag = firstPeakLag(options.trajectory);
  if (lag && lag.predatorPeak.time <= options.visibleUntil) {
    const preyX = xScale(lag.preyPeak.time);
    const predatorX = xScale(lag.predatorPeak.time);
    svg.append(svgElement('rect', {
      x: preyX,
      y: plot.top,
      width: Math.max(1, predatorX - preyX),
      height: yEnd - plot.top,
      class: 'lag-band',
    }));
    svg.append(
      svgElement('line', { x1: preyX, x2: preyX, y1: plot.top, y2: yEnd, class: 'peak-guide prey-stroke' }),
      svgElement('line', { x1: predatorX, x2: predatorX, y1: plot.top, y2: yEnd, class: 'peak-guide predator-stroke' }),
    );
    addText(svg, `정점 간 지연 ${lag.lag.toFixed(2)}년`, (preyX + predatorX) / 2, plot.top + 18, 'lag-label', 'middle');
  }

  const selected = nearestState(options.trajectory, options.selectedTime);
  addSelectedTooltip(svg, plot, selected, xScale(selected.time), yScale(selected.prey), yScale(selected.predator));
  addText(svg, '시간 (년)', (plot.left + xEnd) / 2, plot.height - 12, 'chart-axis-title', 'middle');
  const yTitle = addText(svg, '개체수 (상대 단위)', 18, (plot.top + yEnd) / 2, 'chart-axis-title', 'middle');
  yTitle.setAttribute('transform', `rotate(-90 18 ${(plot.top + yEnd) / 2})`);

  const hit = svgElement('rect', {
    x: plot.left,
    y: plot.top,
    width: xEnd - plot.left,
    height: yEnd - plot.top,
    class: 'chart-hit-area',
  });
  const select = (event: PointerEvent) => {
    const bounds = svg.getBoundingClientRect();
    const localX = ((event.clientX - bounds.left) / bounds.width) * plot.width;
    const time = Math.max(0, Math.min(duration, ((localX - plot.left) / (xEnd - plot.left)) * duration));
    options.onSelectTime(time);
  };
  svg.onpointerdown = (event) => {
    event.preventDefault();
    svg.setPointerCapture(event.pointerId);
    select(event);
  };
  svg.onpointermove = (event) => {
    if (event.pointerType === 'mouse' || svg.hasPointerCapture(event.pointerId)) select(event);
  };
  svg.append(hit);
}

export function drawPhaseChart(svg: SVGSVGElement, options: ChartOptions): void {
  svg.replaceChildren();
  const title = svgElement('title');
  title.textContent = '피식자-포식자 위상 그래프';
  const desc = svgElement('desc');
  desc.textContent = '가로축은 피식자, 세로축은 포식자 개체수이며 시간에 따른 궤적을 나타냅니다.';
  svg.append(title, desc);

  const plot = geometry(svg);
  const xEnd = plot.width - plot.right;
  const yEnd = plot.height - plot.bottom;
  const preyMax = niceMaximum(Math.max(...options.trajectory.map((point) => point.prey)) * 1.08);
  const predatorMax = niceMaximum(Math.max(...options.trajectory.map((point) => point.predator)) * 1.08);
  const xScale = scaleLinear(0, preyMax, plot.left, xEnd);
  const yScale = scaleLinear(0, predatorMax, yEnd, plot.top);
  const xTicks = Array.from({ length: 5 }, (_, index) => preyMax * index / 4);
  const yTicks = Array.from({ length: 5 }, (_, index) => predatorMax * index / 4);
  addFrameAndGrid(svg, plot, xTicks, yTicks, xScale, yScale);

  const visible = options.trajectory.filter((point) => point.time <= options.visibleUntil + 1e-9);
  svg.append(svgElement('path', {
    class: 'series-line phase-line',
    d: pathFrom(visible, (point) => xScale(point.prey), (point) => yScale(point.predator)),
  }));

  const eq = equilibrium(options.parameters, options.model);
  if (eq.predator >= 0 && eq.prey <= preyMax && eq.predator <= predatorMax) {
    const x = xScale(eq.prey);
    const y = yScale(eq.predator);
    svg.append(
      svgElement('line', { x1: x - 7, x2: x + 7, y1: y, y2: y, class: 'equilibrium-mark' }),
      svgElement('line', { x1: x, x2: x, y1: y - 7, y2: y + 7, class: 'equilibrium-mark' }),
    );
    addText(svg, '공존 평형', x + 10, y - 10, 'equilibrium-label');
  }

  const selected = nearestState(options.trajectory, options.selectedTime);
  const selectedX = xScale(selected.prey);
  const selectedY = yScale(selected.predator);
  svg.append(svgElement('circle', { cx: selectedX, cy: selectedY, r: 7, class: 'phase-marker' }));
  addText(svg, `${selected.time.toFixed(2)}년`, selectedX + 10, selectedY + 4, 'phase-time-label');
  addText(svg, '피식자 개체수 N (상대 단위)', (plot.left + xEnd) / 2, plot.height - 12, 'chart-axis-title', 'middle');
  const yTitle = addText(svg, '포식자 개체수 P (상대 단위)', 18, (plot.top + yEnd) / 2, 'chart-axis-title', 'middle');
  yTitle.setAttribute('transform', `rotate(-90 18 ${(plot.top + yEnd) / 2})`);

  const hit = svgElement('rect', {
    x: plot.left,
    y: plot.top,
    width: xEnd - plot.left,
    height: yEnd - plot.top,
    class: 'chart-hit-area',
  });
  const selectNearest = (event: PointerEvent) => {
    const bounds = svg.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * plot.width;
    const pointerY = ((event.clientY - bounds.top) / bounds.height) * plot.height;
    let best = visible[0] ?? options.trajectory[0];
    let bestDistance = Infinity;
    for (const point of visible) {
      const dx = xScale(point.prey) - pointerX;
      const dy = yScale(point.predator) - pointerY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        best = point;
        bestDistance = distance;
      }
    }
    options.onSelectTime(best.time);
  };
  svg.onpointerdown = (event) => {
    event.preventDefault();
    svg.setPointerCapture(event.pointerId);
    selectNearest(event);
  };
  svg.onpointermove = (event) => {
    if (event.pointerType === 'mouse' || svg.hasPointerCapture(event.pointerId)) selectNearest(event);
  };
  svg.append(hit);
}
