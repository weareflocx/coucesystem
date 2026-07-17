import {
  TAU,
  appearanceParameters,
  canvasGradientStyle,
  clamp,
  gradientControlDefinitions,
  parameter,
  svgGradientDefinition
} from "./shared.js";
import { adaptiveAxisScale, fitBoundsToArtboard } from "./composition.js";

const PROJECT_ID = "orbital-basin";
const LAYOUT_SAMPLES = 24;
const layoutBoundsCache = new Map();

function transformPoint(rotation, x, y) {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return [
    x * cosine - y * sine,
    x * sine + y * cosine
  ];
}

function emptyBounds() {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
}

function includeInBounds(bounds, x, y) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function writeCycleGeometry(frame, cycle, formatScale, values, bounds) {
  const count = Math.round(parameter(frame, "rings", 24));
  const pinch = parameter(frame, "pinch", 0.76);
  const breathing = parameter(frame, "breathing", 0.08);
  const breath = breathing * Math.sin(cycle);
  const innerReach = parameter(frame, "cavity", 0.3) * (1 - breath * 0.22);
  const outerReach = parameter(frame, "envelope", 1.52) * (1 + breath * 0.12);
  const circulation = parameter(frame, "circulation", 0.85);
  const precession = parameter(frame, "precession", 2.5) * Math.sin(cycle);
  const rotation = (parameter(frame, "rotation", -47) + precession) * Math.PI / 180;
  const skew = parameter(frame, "skew", 0) * Math.PI / 180;
  const tangentX = Math.sin(skew);
  const tangentY = Math.cos(skew);
  let offset = 0;

  for (let index = 0; index < count; index += 1) {
    const base = (index + 0.5) / count;
    const wave = circulation * 0.72 / count * Math.sin(cycle - base * TAU);
    const mix = clamp(base + wave, 0.001, 0.999);
    const upperReach = innerReach + (outerReach - innerReach) * mix;
    const lowerReach = innerReach + (outerReach - innerReach) * (1 - mix);
    const localPoints = [
      [-pinch, 0],
      [-pinch + upperReach * tangentX, -upperReach * tangentY],
      [pinch - upperReach * tangentX, -upperReach * tangentY],
      [pinch, 0],
      [pinch + lowerReach * tangentX, lowerReach * tangentY],
      [-pinch - lowerReach * tangentX, lowerReach * tangentY]
    ];

    for (const [x, y] of localPoints) {
      const [rotatedX, rotatedY] = transformPoint(rotation, x, y);
      const localX = rotatedX * formatScale.x;
      const localY = rotatedY * formatScale.y;
      if (values) {
        values[offset] = localX;
        values[offset + 1] = localY;
      }
      if (bounds) includeInBounds(bounds, localX, localY);
      offset += 2;
    }
  }
}

function layoutCacheKey(frame) {
  return [
    frame.width,
    frame.height,
    parameter(frame, "rings", 24),
    parameter(frame, "pinch", 0.76),
    parameter(frame, "cavity", 0.3),
    parameter(frame, "envelope", 1.52),
    parameter(frame, "rotation", -47),
    parameter(frame, "skew", 0),
    parameter(frame, "circulation", 0.85),
    parameter(frame, "breathing", 0.08),
    parameter(frame, "precession", 2.5)
  ].join(":");
}

function getLayoutBounds(frame, formatScale) {
  const key = layoutCacheKey(frame);
  const cached = layoutBoundsCache.get(key);
  if (cached) return cached;

  const bounds = emptyBounds();
  for (let sample = 0; sample < LAYOUT_SAMPLES; sample += 1) {
    writeCycleGeometry(frame, sample / LAYOUT_SAMPLES * TAU, formatScale, null, bounds);
  }
  if (layoutBoundsCache.size >= 48) {
    layoutBoundsCache.delete(layoutBoundsCache.keys().next().value);
  }
  layoutBoundsCache.set(key, bounds);
  return bounds;
}

function createGeometry(frame) {
  const count = Math.round(parameter(frame, "rings", 24));
  const formatScale = adaptiveAxisScale(frame, 0.32, 1.28);
  const values = new Float32Array(count * 12);
  writeCycleGeometry(frame, frame.time * TAU, formatScale, values, null);

  const fit = fitBoundsToArtboard(frame, getLayoutBounds(frame, formatScale), 0.075);
  for (let index = 0; index < values.length; index += 2) {
    values[index] = values[index] * fit.scale + fit.offsetX;
    values[index + 1] = values[index + 1] * fit.scale + fit.offsetY;
  }

  return {
    values,
    strokeWidth: parameter(frame, "stroke", 1.25) * Math.min(frame.width, frame.height) / 500
  };
}

function render(context, frame) {
  const geometry = createGeometry(frame);
  if (!frame.transparent) {
    context.fillStyle = frame.palette.background;
    context.fillRect(0, 0, frame.width, frame.height);
  }
  context.strokeStyle = canvasGradientStyle(context, frame, appearanceParameters(frame));
  context.lineWidth = geometry.strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (let index = 0; index < geometry.values.length; index += 12) {
    context.beginPath();
    context.moveTo(geometry.values[index], geometry.values[index + 1]);
    context.bezierCurveTo(
      geometry.values[index + 2],
      geometry.values[index + 3],
      geometry.values[index + 4],
      geometry.values[index + 5],
      geometry.values[index + 6],
      geometry.values[index + 7]
    );
    context.bezierCurveTo(
      geometry.values[index + 8],
      geometry.values[index + 9],
      geometry.values[index + 10],
      geometry.values[index + 11],
      geometry.values[index],
      geometry.values[index + 1]
    );
    context.closePath();
    context.stroke();
  }
}

function curveToPath(values, index) {
  return `M${values[index].toFixed(2)} ${values[index + 1].toFixed(2)}C${values[index + 2].toFixed(2)} ${values[index + 3].toFixed(2)} ${values[index + 4].toFixed(2)} ${values[index + 5].toFixed(2)} ${values[index + 6].toFixed(2)} ${values[index + 7].toFixed(2)}C${values[index + 8].toFixed(2)} ${values[index + 9].toFixed(2)} ${values[index + 10].toFixed(2)} ${values[index + 11].toFixed(2)} ${values[index].toFixed(2)} ${values[index + 1].toFixed(2)}Z`;
}

function toSvg(frame) {
  const geometry = createGeometry(frame);
  const gradient = svgGradientDefinition(frame, appearanceParameters(frame), "orbital-basin-gradient");
  const paths = [];
  for (let index = 0; index < geometry.values.length; index += 12) {
    paths.push(`<path d="${curveToPath(geometry.values, index)}"/>`);
  }
  const background = frame.transparent
    ? ""
    : `<rect width="${frame.width}" height="${frame.height}" fill="${frame.palette.background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><title>Cauce 04 — Orbital Basin</title>${gradient.definition}${background}<g fill="none" stroke="${gradient.paint}" stroke-width="${geometry.strokeWidth.toFixed(3)}" stroke-linecap="round" stroke-linejoin="round">${paths.join("")}</g></svg>`;
}

export const orbitalBasinProject = {
  id: PROJECT_ID,
  index: "04",
  name: "Orbital Basin",
  label: "Cauce — Orbital Basin",
  description: "Órbitas cerradas comparten dos tangencias y hacen circular una cavidad diagonal.",
  preferredFps: 60,
  preferredFormatKey: "square",
  preferredLoopSeconds: 6,
  controls: [
    { key: "rings", label: "Órbitas", min: 5, max: 48, step: 1, defaultValue: 24, digits: 0 },
    { key: "pinch", label: "Distancia de tangencia", min: 0.45, max: 0.92, step: 0.01, defaultValue: 0.76, digits: 2 },
    { key: "cavity", label: "Cavidad", min: 0.12, max: 0.72, step: 0.01, defaultValue: 0.3, digits: 2 },
    { key: "envelope", label: "Envolvente", min: 0.8, max: 1.8, step: 0.01, defaultValue: 1.52, digits: 2 },
    { key: "rotation", label: "Rotación", min: -180, max: 180, step: 1, defaultValue: -47, digits: 0, suffix: "°" },
    { key: "skew", label: "Sesgo", min: -28, max: 28, step: 1, defaultValue: 0, digits: 0, suffix: "°" },
    { key: "circulation", label: "Circulación", min: 0, max: 1.8, step: 0.05, defaultValue: 0.85, digits: 2 },
    { key: "breathing", label: "Respiración", min: 0, max: 0.28, step: 0.01, defaultValue: 0.08, digits: 2 },
    { key: "precession", label: "Precesión", min: 0, max: 16, step: 0.5, defaultValue: 2.5, digits: 1, suffix: "°" },
    ...gradientControlDefinitions(0, 0, 0.46),
    { key: "stroke", label: "Trazo", min: 0.45, max: 20, step: 0.05, defaultValue: 1.25, digits: 2, group: "appearance" }
  ],
  defaults: {
    rings: 24,
    pinch: 0.76,
    cavity: 0.3,
    envelope: 1.52,
    rotation: -47,
    skew: 0,
    circulation: 0.85,
    breathing: 0.08,
    precession: 2.5,
    gradientStrength: 0,
    gradientAngle: 0,
    gradientMidpoint: 0.46,
    stroke: 1.25
  },
  render,
  toSvg
};
