/**
 * Renders a PNG line chart of wound-area-% over time points using
 * node-canvas (already a backend dependency). Kept zero-dep on chart.js —
 * a plain line chart with grid/axes is all the export needs and adding a
 * second chart runtime (chartjs-node-canvas) would mean another native build.
 */

import { createCanvas } from 'canvas';
import type { WoundTimePoint } from './woundTimeSeries';

const WIDTH = 1200;
const HEIGHT = 600;
const PADDING = { top: 50, right: 40, bottom: 70, left: 80 };

export async function renderWoundAreaChart(
  points: WoundTimePoint[]
): Promise<Buffer> {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const chartLeft = PADDING.left;
  const chartRight = WIDTH - PADDING.right;
  const chartTop = PADDING.top;
  const chartBottom = HEIGHT - PADDING.bottom;
  const chartW = chartRight - chartLeft;
  const chartH = chartBottom - chartTop;

  const maxPct = Math.max(10, ...points.map(p => p.woundAreaPct));
  const yMax = Math.ceil(maxPct / 10) * 10;
  const xMax = Math.max(1, points.length - 1);

  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'center';
  ctx.fillText('Wound area over time', WIDTH / 2, 30);

  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 1;
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#333333';

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const frac = i / yTicks;
    const y = chartBottom - frac * chartH;
    const label = ((yMax * frac).toFixed(0)) + '%';
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(label, chartLeft - 8, y + 4);
  }

  const xTickCount = Math.min(points.length, 12);
  const xStep = xTickCount > 1 ? (points.length - 1) / (xTickCount - 1) : 0;
  for (let i = 0; i < xTickCount; i++) {
    const idx = Math.round(i * xStep);
    const px = chartLeft + (xMax === 0 ? 0.5 : idx / xMax) * chartW;
    ctx.beginPath();
    ctx.moveTo(px, chartBottom);
    ctx.lineTo(px, chartBottom + 6);
    ctx.stroke();
    ctx.textAlign = 'center';
    const label = points[idx]?.imageName?.slice(0, 12) ?? String(idx);
    ctx.fillText(label, px, chartBottom + 22);
  }

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(chartLeft, chartTop);
  ctx.lineTo(chartLeft, chartBottom);
  ctx.lineTo(chartRight, chartBottom);
  ctx.stroke();

  ctx.save();
  ctx.translate(24, chartTop + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.font = '14px sans-serif';
  ctx.fillText('Wound area (% of image)', 0, 0);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.font = '14px sans-serif';
  ctx.fillText('Frame (time order)', chartLeft + chartW / 2, HEIGHT - 18);

  const toCanvasXY = (
    p: WoundTimePoint,
    idx: number
  ): { x: number; y: number } => {
    const x = chartLeft + (xMax === 0 ? 0.5 : idx / xMax) * chartW;
    const y = chartBottom - (p.woundAreaPct / yMax) * chartH;
    return { x, y };
  };

  ctx.strokeStyle = '#d32f2f';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  points.forEach((p, idx) => {
    const { x, y } = toCanvasXY(p, idx);
    if (idx === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  ctx.fillStyle = '#d32f2f';
  points.forEach((p, idx) => {
    const { x, y } = toCanvasXY(p, idx);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  return canvas.toBuffer('image/png');
}
