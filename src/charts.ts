import type { PopulationMetric } from './model.ts';

const COLORS = {
  rabbit: '#d77a2f',
  wolf: '#536b86',
  forest: '#2f7b4c',
  grid: '#dce4dc',
  text: '#68766d',
};

function line(
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
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function drawPopulationChart(canvas: HTMLCanvasElement, history: readonly PopulationMetric[]): void {
  const bounds = canvas.getBoundingClientRect();
  const cssWidth = Math.max(300, Math.round(bounds.width || 640));
  const cssHeight = Math.max(190, Math.round(bounds.height || 240));
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const targetWidth = Math.round(cssWidth * ratio);
  const targetHeight = Math.round(cssHeight * ratio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const padding = { top: 18, right: 44, bottom: 30, left: 44 };
  const plotWidth = cssWidth - padding.left - padding.right;
  const plotHeight = cssHeight - padding.top - padding.bottom;
  const maxPopulation = Math.max(20, ...history.flatMap((metric) => [metric.rabbits, metric.wolves]));
  const roundedMaximum = Math.ceil(maxPopulation / 20) * 20;

  ctx.font = "600 10px 'DM Sans', sans-serif";
  ctx.textBaseline = 'middle';
  for (let lineIndex = 0; lineIndex <= 4; lineIndex += 1) {
    const fraction = lineIndex / 4;
    const y = padding.top + plotHeight * fraction;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(cssWidth - padding.right, y);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(roundedMaximum * (1 - fraction))), padding.left - 9, y);
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(100 * (1 - fraction))}%`, cssWidth - padding.right + 9, y);
  }

  const display = history.length > 240
    ? history.filter((_, index) => index % Math.ceil(history.length / 240) === 0 || index === history.length - 1)
    : history;
  const xForIndex = (index: number) => padding.left + (display.length <= 1 ? 0 : (index / (display.length - 1)) * plotWidth);
  const yPopulation = (value: number) => padding.top + plotHeight - (value / roundedMaximum) * plotHeight;
  const yForest = (value: number) => padding.top + plotHeight - (value / 100) * plotHeight;
  line(ctx, display, xForIndex, yPopulation, (metric) => metric.rabbits, COLORS.rabbit);
  line(ctx, display, xForIndex, yPopulation, (metric) => metric.wolves, COLORS.wolf);
  line(ctx, display, xForIndex, yForest, (metric) => metric.forestPercent, COLORS.forest);

  const firstStep = history[0]?.step ?? 0;
  const lastStep = history.at(-1)?.step ?? 0;
  ctx.fillStyle = COLORS.text;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(String(firstStep), padding.left, cssHeight - padding.bottom + 9);
  ctx.textAlign = 'center';
  ctx.fillText('STEP', padding.left + plotWidth / 2, cssHeight - padding.bottom + 9);
  ctx.textAlign = 'right';
  ctx.fillText(String(lastStep), cssWidth - padding.right, cssHeight - padding.bottom + 9);
}
