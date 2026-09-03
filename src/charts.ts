import { SPECIES_LABELS, type FoodChainDepth, type Intervention, type PopulationMetric, type Species } from './model.ts';

export type ChartSeries = 'forest' | Species;

export const SERIES_COLORS: Readonly<Record<ChartSeries, string>> = Object.freeze({
  forest: '#2f7b4c',
  rabbit: '#dc7b2c',
  wolf: '#506b87',
  tertiary: '#8e4e78',
  quaternary: '#26243f',
});

interface ChartOptions {
  history: readonly PopulationMetric[];
  depth: FoodChainDepth;
  visibleSeries: ReadonlySet<ChartSeries>;
  interventions: readonly Intervention[];
  challengeCollapse?: { step: number; label: string } | null;
}

interface Geometry {
  cssWidth: number;
  cssHeight: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  plotWidth: number;
  plotHeight: number;
}

function configureCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; geometry: Geometry } | null {
  const bounds = canvas.getBoundingClientRect();
  const cssWidth = Math.max(300, Math.round(bounds.width || 640));
  const cssHeight = Math.max(220, Math.round(bounds.height || 260));
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const targetWidth = Math.round(cssWidth * ratio);
  const targetHeight = Math.round(cssHeight * ratio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const geometry = {
    cssWidth, cssHeight, left: 44, right: 45, top: 25, bottom: 33,
    plotWidth: cssWidth - 89, plotHeight: cssHeight - 58,
  };
  return { ctx, geometry };
}

function populationValue(metric: PopulationMetric, series: Species): number {
  if (series === 'rabbit') return metric.rabbits;
  if (series === 'wolf') return metric.wolves;
  if (series === 'tertiary') return metric.tertiary;
  return metric.quaternary;
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  values: readonly PopulationMetric[],
  xForIndex: (index: number) => number,
  yForValue: (value: number) => number,
  valueForMetric: (metric: PopulationMetric) => number,
  color: string,
): void {
  if (values.length === 0) return;
  ctx.beginPath();
  values.forEach((metric, index) => {
    const x = xForIndex(index);
    const y = yForValue(valueForMetric(metric));
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.35;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function drawPopulationChart(canvas: HTMLCanvasElement, options: ChartOptions): void {
  const configured = configureCanvas(canvas);
  if (!configured) return;
  const { ctx, geometry: g } = configured;
  const { history } = options;
  const species: Species[] = ['rabbit', 'wolf'];
  if (options.depth >= 3) species.push('tertiary');
  if (options.depth >= 4) species.push('quaternary');
  const visibleSpecies = species.filter((item) => options.visibleSeries.has(item));
  const maxPopulation = Math.max(20, ...history.flatMap((metric) => visibleSpecies.map((item) => populationValue(metric, item))));
  const roundedMaximum = Math.ceil(maxPopulation / 20) * 20;

  ctx.font = "600 10px system-ui, sans-serif";
  ctx.textBaseline = 'middle';
  for (let lineIndex = 0; lineIndex <= 4; lineIndex += 1) {
    const fraction = lineIndex / 4;
    const y = g.top + g.plotHeight * fraction;
    ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.cssWidth - g.right, y);
    ctx.strokeStyle = '#dce4dc'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#68766d';
    ctx.textAlign = 'right'; ctx.fillText(String(Math.round(roundedMaximum * (1 - fraction))), g.left - 8, y);
    ctx.textAlign = 'left'; ctx.fillText(`${Math.round(100 * (1 - fraction))}%`, g.cssWidth - g.right + 8, y);
  }

  const sampling = Math.max(1, Math.ceil(history.length / 260));
  const display = history.filter((_, index) => index % sampling === 0 || index === history.length - 1);
  const firstStep = display[0]?.step ?? 0;
  const lastStep = display.at(-1)?.step ?? 0;
  const stepSpan = Math.max(1, lastStep - firstStep);
  const xForStep = (step: number) => g.left + ((step - firstStep) / stepSpan) * g.plotWidth;
  const xForIndex = (index: number) => xForStep(display[index]?.step ?? firstStep);
  const yPopulation = (value: number) => g.top + g.plotHeight - (value / roundedMaximum) * g.plotHeight;
  const yForest = (value: number) => g.top + g.plotHeight - (value / 100) * g.plotHeight;

  if (options.visibleSeries.has('forest')) drawLine(ctx, display, xForIndex, yForest, (metric) => metric.forestPercent, SERIES_COLORS.forest);
  for (const item of visibleSpecies) drawLine(ctx, display, xForIndex, yPopulation, (metric) => populationValue(metric, item), SERIES_COLORS[item]);

  const visibleInterventions = options.interventions.filter((item) => item.step >= firstStep && item.step <= lastStep);
  visibleInterventions.forEach((item, index) => {
    const x = xForStep(item.step);
    ctx.save();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = SERIES_COLORS[item.species]; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, g.top); ctx.lineTo(x, g.top + g.plotHeight); ctx.stroke();
    ctx.setLineDash([]);
    const label = `t=${item.step} ${SPECIES_LABELS[item.species]} 제거`;
    ctx.translate(x + (index % 2 === 0 ? 5 : -5), g.top + 8 + (index % 3) * 12);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = SERIES_COLORS[item.species]; ctx.font = '700 9px system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.fillText(label, 0, 0);
    ctx.restore();
  });

  const collapse = options.challengeCollapse;
  if (collapse && collapse.step >= firstStep && collapse.step <= lastStep) {
    const x = xForStep(collapse.step);
    ctx.save();
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#a75432'; ctx.lineWidth = 1.75;
    ctx.beginPath(); ctx.moveTo(x, g.top); ctx.lineTo(x, g.top + g.plotHeight); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#8b452b'; ctx.font = '700 9px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(collapse.label, Math.min(g.cssWidth - g.right, x - 5), g.top + 8);
    ctx.restore();
  }

  ctx.fillStyle = '#68766d'; ctx.textBaseline = 'top'; ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.fillText(String(firstStep), g.left, g.cssHeight - g.bottom + 9);
  ctx.textAlign = 'center'; ctx.fillText('STEP', g.left + g.plotWidth / 2, g.cssHeight - g.bottom + 9);
  ctx.textAlign = 'right'; ctx.fillText(String(lastStep), g.cssWidth - g.right, g.cssHeight - g.bottom + 9);
}
