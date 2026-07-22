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

const PROJECT_ID = "orbital-basin-flow";
const LAYOUT_SAMPLES = 32;
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

function orbitalState(frame, cycle, base) {
  const flow = parameter(frame, "flow", 0.9);
  const phaseOffset = parameter(frame, "phaseOffset", 1);
  const basePhase = base * TAU;
  const transportPhase = cycle - basePhase * phaseOffset;
  const primaryWave = Math.sin(transportPhase);
  const secondaryWave = Math.sin(
    cycle * 2 + basePhase * (1.35 + phaseOffset * 0.3) + 0.65
  );
  const densityShift = flow * (
    primaryWave * 0.11 +
    secondaryWave * 0.035
  );
  const asymmetry = flow * 0.05 * Math.sin(
    cycle * 2 - basePhase * (0.75 + phaseOffset * 0.2) - 0.4
  );
  const depthWave = 0.5 + 0.5 * Math.cos(
    transportPhase - 0.26 * Math.sin(cycle + basePhase * 0.5)
  );

  return {
    upperMix: clamp(base + densityShift, 0.001, 0.999),
    lowerMix: clamp(1 - base - densityShift + asymmetry, 0.001, 0.999),
    depthWave
  };
}

function writeCycleGeometry(frame, cycle, formatScale, values, bounds, styles) {
  const count = Math.round(parameter(frame, "rings", 24));
  const pinch = parameter(frame, "pinch", 0.76);
  const breathing = parameter(frame, "breathing", 0.1);
  const breath = breathing * (
    Math.sin(cycle - 0.35) * 0.72 +
    Math.sin(cycle * 2 + 0.8) * 0.28
  );
  const innerReach = parameter(frame, "cavity", 0.3) * (1 - breath * 0.22);
  const outerReach = parameter(frame, "envelope", 1.52) * (1 + breath * 0.12);
  const precession = parameter(frame, "precession", 4) * (
    Math.sin(cycle) + Math.sin(cycle * 2 + 0.45) * 0.24
  );
  const rotation = (parameter(frame, "rotation", -47) + precession) * Math.PI / 180;
  const skew = parameter(frame, "skew", 0) * Math.PI / 180;
  const tangentX = Math.sin(skew);
  const tangentY = Math.cos(skew);
  const tangentMobility = parameter(frame, "tangentMobility", 0.55);
  const tangentSqueeze = tangentMobility * 0.075 * Math.sin(cycle - 0.25);
  const tangentLift = tangentMobility * 0.095 * (
    Math.sin(cycle * 2 + 0.35) * 0.72 +
    Math.sin(cycle - 0.6) * 0.28
  );
  const leftTangent = [
    -pinch * (1 + tangentSqueeze),
    tangentLift
  ];
  const rightTangent = [
    pinch * (1 - tangentSqueeze),
    -tangentLift
  ];
  const depth = parameter(frame, "depth", 0.95);
  let offset = 0;

  for (let index = 0; index < count; index += 1) {
    const base = (index + 0.5) / count;
    const state = orbitalState(frame, cycle, base);
    const upperReach = innerReach + (outerReach - innerReach) * state.upperMix;
    const lowerReach = innerReach + (outerReach - innerReach) * state.lowerMix;
    const localPoints = [
      leftTangent,
      [
        leftTangent[0] + upperReach * tangentX,
        leftTangent[1] - upperReach * tangentY
      ],
      [
        rightTangent[0] - upperReach * tangentX,
        rightTangent[1] - upperReach * tangentY
      ],
      rightTangent,
      [
        rightTangent[0] + lowerReach * tangentX,
        rightTangent[1] + lowerReach * tangentY
      ],
      [
        leftTangent[0] - lowerReach * tangentX,
        leftTangent[1] + lowerReach * tangentY
      ]
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

    if (styles) {
      styles[index] = {
        depth: state.depthWave,
        opacity: clamp(1 - depth * 0.52 * (1 - state.depthWave), 0.24, 1),
        widthFactor: Math.exp((state.depthWave - 0.5) * depth * 1.1)
      };
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
    parameter(frame, "flow", 0.9),
    parameter(frame, "phaseOffset", 1),
    parameter(frame, "tangentMobility", 0.55),
    parameter(frame, "breathing", 0.1),
    parameter(frame, "precession", 4)
  ].join(":");
}

function getLayoutBounds(frame, formatScale) {
  const key = layoutCacheKey(frame);
  const cached = layoutBoundsCache.get(key);
  if (cached) return cached;

  const bounds = emptyBounds();
  for (let sample = 0; sample < LAYOUT_SAMPLES; sample += 1) {
    writeCycleGeometry(frame, sample / LAYOUT_SAMPLES * TAU, formatScale, null, bounds, null);
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
  const styles = new Array(count);
  writeCycleGeometry(frame, frame.time * TAU, formatScale, values, null, styles);

  const fit = fitBoundsToArtboard(frame, getLayoutBounds(frame, formatScale), 0.075);
  for (let index = 0; index < values.length; index += 2) {
    values[index] = values[index] * fit.scale + fit.offsetX;
    values[index + 1] = values[index + 1] * fit.scale + fit.offsetY;
  }

  const baseStrokeWidth = parameter(frame, "stroke", 1.3) * Math.min(frame.width, frame.height) / 500;
  const order = Array.from({ length: count }, (_, index) => index)
    .sort((a, b) => styles[a].depth - styles[b].depth || a - b);

  return { values, styles, order, baseStrokeWidth };
}

function traceCurve(context, values, index) {
  context.beginPath();
  context.moveTo(values[index], values[index + 1]);
  context.bezierCurveTo(
    values[index + 2],
    values[index + 3],
    values[index + 4],
    values[index + 5],
    values[index + 6],
    values[index + 7]
  );
  context.bezierCurveTo(
    values[index + 8],
    values[index + 9],
    values[index + 10],
    values[index + 11],
    values[index],
    values[index + 1]
  );
  context.closePath();
}

function render(context, frame) {
  const geometry = createGeometry(frame);
  if (!frame.transparent) {
    context.fillStyle = frame.palette.background;
    context.fillRect(0, 0, frame.width, frame.height);
  }

  context.save();
  context.strokeStyle = canvasGradientStyle(context, frame, appearanceParameters(frame));
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const ringIndex of geometry.order) {
    const style = geometry.styles[ringIndex];
    context.globalAlpha = style.opacity;
    context.lineWidth = geometry.baseStrokeWidth * style.widthFactor;
    traceCurve(context, geometry.values, ringIndex * 12);
    context.stroke();
  }
  context.restore();
}

function curveToPath(values, index) {
  return `M${values[index].toFixed(2)} ${values[index + 1].toFixed(2)}C${values[index + 2].toFixed(2)} ${values[index + 3].toFixed(2)} ${values[index + 4].toFixed(2)} ${values[index + 5].toFixed(2)} ${values[index + 6].toFixed(2)} ${values[index + 7].toFixed(2)}C${values[index + 8].toFixed(2)} ${values[index + 9].toFixed(2)} ${values[index + 10].toFixed(2)} ${values[index + 11].toFixed(2)} ${values[index].toFixed(2)} ${values[index + 1].toFixed(2)}Z`;
}

function toSvg(frame) {
  const geometry = createGeometry(frame);
  const gradient = svgGradientDefinition(frame, appearanceParameters(frame), "orbital-basin-flow-gradient");
  const paths = geometry.order.map((ringIndex) => {
    const style = geometry.styles[ringIndex];
    return `<path d="${curveToPath(geometry.values, ringIndex * 12)}" fill="none" stroke="${gradient.paint}" stroke-width="${(geometry.baseStrokeWidth * style.widthFactor).toFixed(3)}" stroke-opacity="${style.opacity.toFixed(3)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  const background = frame.transparent
    ? ""
    : `<rect width="${frame.width}" height="${frame.height}" fill="${frame.palette.background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><title>Cauce 04.1 — Orbital Basin Flow</title>${gradient.definition}${background}${paths}</svg>`;
}

export const orbitalBasinFlowProject = {
  id: PROJECT_ID,
  index: "04.1",
  name: "Orbital Basin Flow",
  label: "Cauce — Orbital Basin Flow",
  description: "Una onda de densidad circula entre órbitas de profundidad variable y desplaza sus tangencias compartidas.",
  preferredFps: 60,
  preferredFormatKey: "square",
  preferredLoopSeconds: 7,
  controls: [
    { key: "rings", label: "Órbitas", min: 5, max: 48, step: 1, defaultValue: 24, digits: 0 },
    { key: "pinch", label: "Distancia de tangencia", min: 0.45, max: 0.92, step: 0.01, defaultValue: 0.76, digits: 2 },
    { key: "cavity", label: "Cavidad", min: 0.12, max: 0.72, step: 0.01, defaultValue: 0.3, digits: 2 },
    { key: "envelope", label: "Envolvente", min: 0.8, max: 1.8, step: 0.01, defaultValue: 1.52, digits: 2 },
    { key: "rotation", label: "Rotación", min: -180, max: 180, step: 1, defaultValue: -47, digits: 0, suffix: "°" },
    { key: "skew", label: "Sesgo", min: -28, max: 28, step: 1, defaultValue: 0, digits: 0, suffix: "°" },
    { key: "flow", label: "Flujo", min: 0, max: 1.8, step: 0.05, defaultValue: 0.9, digits: 2 },
    { key: "depth", label: "Profundidad", min: 0, max: 1.5, step: 0.05, defaultValue: 0.95, digits: 2 },
    { key: "phaseOffset", label: "Desfase", min: 0.25, max: 2.5, step: 0.05, defaultValue: 1, digits: 2 },
    { key: "tangentMobility", label: "Movilidad de tangencia", min: 0, max: 1.5, step: 0.05, defaultValue: 0.55, digits: 2 },
    { key: "breathing", label: "Respiración", min: 0, max: 0.28, step: 0.01, defaultValue: 0.1, digits: 2 },
    { key: "precession", label: "Precesión", min: 0, max: 16, step: 0.5, defaultValue: 4, digits: 1, suffix: "°" },
    ...gradientControlDefinitions(0, 0, 0.46),
    { key: "stroke", label: "Trazo base", min: 0.45, max: 20, step: 0.05, defaultValue: 1.3, digits: 2, group: "appearance" }
  ],
  defaults: {
    rings: 24,
    pinch: 0.76,
    cavity: 0.3,
    envelope: 1.52,
    rotation: -47,
    skew: 0,
    flow: 0.9,
    depth: 0.95,
    phaseOffset: 1,
    tangentMobility: 0.55,
    breathing: 0.1,
    precession: 4,
    gradientStrength: 0,
    gradientAngle: 0,
    gradientMidpoint: 0.46,
    stroke: 1.3
  },
  render,
  toSvg
};
