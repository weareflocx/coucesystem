import { clamp, parameter } from "../shared.js";

export function vectorWeaveGap(frame) {
  if (frame.transparent || parameter(frame, "weaveEnabled", 0) < 0.5) return 0;
  return clamp(parameter(frame, "weaveGap", 4), 0, 18);
}

function separationPath(points) {
  return `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}` +
    `L${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}` +
    `M${points[3].x.toFixed(2)} ${points[3].y.toFixed(2)}` +
    `L${points[2].x.toFixed(2)} ${points[2].y.toFixed(2)}`;
}

export function drawVectorWeaveCell(context, cell, background, gap) {
  const points = cell.points;
  if (gap > 0.01) {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    context.lineTo(points[1].x, points[1].y);
    context.moveTo(points[3].x, points[3].y);
    context.lineTo(points[2].x, points[2].y);
    context.strokeStyle = background;
    context.lineWidth = gap;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  }

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
  context.fillStyle = cell.color;
  context.fill();
  context.strokeStyle = cell.color;
  context.lineWidth = 0.8;
  context.stroke();
}

export function vectorWeaveSvgCell(cell, background, gap) {
  const separation = gap > 0.01
    ? `<path d="${separationPath(cell.points)}" fill="none" stroke="${background}" stroke-width="${gap.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`
    : "";
  return `${separation}<path d="${cell.path}" fill="${cell.color}" stroke="${cell.color}" stroke-width="0.8" stroke-linejoin="round"/>`;
}
