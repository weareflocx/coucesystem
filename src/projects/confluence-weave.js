import {
  TAU,
  appearanceParameters,
  canvasGradientStyle,
  clamp,
  gradientControlDefinitions,
  parameter,
  positiveModulo,
  svgGradientDefinition
} from "./shared.js";
import { adaptiveAxisScale, fitBoundsToArtboard } from "./composition.js";

const PROJECT_ID = "confluence-weave";
const GRID_SIZE = 160;
const PATH_SAMPLES = 320;
const FIELD_EXTENT = 1.42;
const FIELD_THRESHOLD = 0.54;

function pointKey(point) {
  return `${point[0].toFixed(5)},${point[1].toFixed(5)}`;
}

function interpolate(level, valueA, valueB) {
  const difference = valueB - valueA;
  return Math.abs(difference) < 0.000001
    ? 0.5
    : clamp((level - valueA) / difference, 0, 1);
}

function createOrbitSampler(frame, channelIndex, channelCount, cycle) {
  const centeredIndex = channelCount === 1
    ? 0
    : channelIndex / (channelCount - 1) - 0.5;
  const squareness = parameter(frame, "squareness", 0.55);
  const aspect = parameter(frame, "aspect", 0.9);
  const weave = parameter(frame, "weave", 0.82);
  const separation = parameter(frame, "separation", 0.18);
  const circulation = Math.round(parameter(frame, "circulation", 1));
  const precession = parameter(frame, "precession", 3.5) * Math.sin(cycle);
  const channelPhase = circulation * cycle + channelIndex * TAU / channelCount;
  const baseRotation = parameter(frame, "rotation", 43) + precession;
  const spread = centeredIndex * weave * 55;
  const orbitalMotion = weave * 8 * Math.sin(channelPhase);
  const rotation = (baseRotation + spread + orbitalMotion) * Math.PI / 180;
  const exponent = 2 + squareness * 6;
  const power = 2 / exponent;
  const radius = 0.98 - Math.abs(centeredIndex) * 0.06;
  const offset = centeredIndex * separation * 2 +
    separation * 0.16 * Math.sin(channelPhase + Math.PI * 0.5);
  const offsetAngle = (baseRotation + 90) * Math.PI / 180;
  const offsetX = offset * Math.cos(offsetAngle);
  const offsetY = offset * Math.sin(offsetAngle);
  const cosineRotation = Math.cos(rotation);
  const sineRotation = Math.sin(rotation);

  return function sample(t) {
    const cosine = Math.cos(t);
    const sine = Math.sin(t);
    const localX = radius * Math.sign(cosine) * Math.pow(Math.abs(cosine), power);
    const localY = radius * aspect * Math.sign(sine) * Math.pow(Math.abs(sine), power);
    return [
      localX * cosineRotation - localY * sineRotation + offsetX,
      localX * sineRotation + localY * cosineRotation + offsetY
    ];
  };
}

function splatOrbit(target, sample, sigma) {
  const stride = GRID_SIZE + 1;
  const inverseExtent = GRID_SIZE / (FIELD_EXTENT * 2);
  const sigmaGrid = Math.max(0.42, sigma * inverseExtent);
  const inverseVariance = 1 / (2 * sigmaGrid * sigmaGrid);
  const radius = Math.max(2, Math.ceil(sigmaGrid * 3));

  let previous = sample(0);
  let previousX = (previous[0] + FIELD_EXTENT) * inverseExtent;
  let previousY = (previous[1] + FIELD_EXTENT) * inverseExtent;

  for (let step = 1; step <= PATH_SAMPLES; step += 1) {
    const current = sample(TAU * step / PATH_SAMPLES);
    const currentX = (current[0] + FIELD_EXTENT) * inverseExtent;
    const currentY = (current[1] + FIELD_EXTENT) * inverseExtent;
    const segmentX = currentX - previousX;
    const segmentY = currentY - previousY;
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
    const minimumX = Math.max(0, Math.floor(Math.min(previousX, currentX) - radius));
    const maximumX = Math.min(GRID_SIZE, Math.ceil(Math.max(previousX, currentX) + radius));
    const minimumY = Math.max(0, Math.floor(Math.min(previousY, currentY) - radius));
    const maximumY = Math.min(GRID_SIZE, Math.ceil(Math.max(previousY, currentY) + radius));

    for (let y = minimumY; y <= maximumY; y += 1) {
      const row = y * stride;
      for (let x = minimumX; x <= maximumX; x += 1) {
        const projection = segmentLengthSquared < 0.000001
          ? 0
          : clamp(
              ((x - previousX) * segmentX + (y - previousY) * segmentY) /
              segmentLengthSquared,
              0,
              1
            );
        const nearestX = previousX + segmentX * projection;
        const nearestY = previousY + segmentY * projection;
        const deltaX = x - nearestX;
        const deltaY = y - nearestY;
        const influence = Math.exp(-(deltaX * deltaX + deltaY * deltaY) * inverseVariance);
        const fieldIndex = row + x;
        if (influence > target[fieldIndex]) target[fieldIndex] = influence;
      }
    }
    previous = current;
    previousX = currentX;
    previousY = currentY;
  }
}

function createDensityField(frame) {
  const channelCount = Math.round(parameter(frame, "channels", 4));
  const cycle = positiveModulo(frame.time, 1) * TAU;
  const breathing = parameter(frame, "breathing", 0.1);
  const thickness = parameter(frame, "thickness", 0.01) * (1 + breathing * Math.sin(cycle));
  const fusion = parameter(frame, "fusion", 0.78);
  const fieldLength = (GRID_SIZE + 1) * (GRID_SIZE + 1);
  const sumField = new Float32Array(fieldLength);
  const maximumField = new Float32Array(fieldLength);
  const channelField = new Float32Array(fieldLength);

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    channelField.fill(0);
    const sample = createOrbitSampler(frame, channelIndex, channelCount, cycle);
    splatOrbit(channelField, sample, thickness);
    for (let fieldIndex = 0; fieldIndex < fieldLength; fieldIndex += 1) {
      const value = channelField[fieldIndex];
      sumField[fieldIndex] += value;
      if (value > maximumField[fieldIndex]) maximumField[fieldIndex] = value;
    }
  }

  for (let fieldIndex = 0; fieldIndex < fieldLength; fieldIndex += 1) {
    sumField[fieldIndex] = maximumField[fieldIndex] +
      fusion * (sumField[fieldIndex] - maximumField[fieldIndex]);
  }
  return sumField;
}

function edgePoint(edge, x, y, values) {
  const [topLeft, topRight, bottomRight, bottomLeft] = values;
  switch (edge) {
    case 0:
      return [x + interpolate(FIELD_THRESHOLD, topLeft, topRight), y];
    case 1:
      return [x + 1, y + interpolate(FIELD_THRESHOLD, topRight, bottomRight)];
    case 2:
      return [x + interpolate(FIELD_THRESHOLD, bottomLeft, bottomRight), y + 1];
    default:
      return [x, y + interpolate(FIELD_THRESHOLD, topLeft, bottomLeft)];
  }
}

function segmentEdges(cellCase, centerInside) {
  switch (cellCase) {
    case 1: return [[3, 0]];
    case 2: return [[0, 1]];
    case 3: return [[3, 1]];
    case 4: return [[1, 2]];
    case 5: return centerInside ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
    case 6: return [[0, 2]];
    case 7: return [[3, 2]];
    case 8: return [[2, 3]];
    case 9: return [[0, 2]];
    case 10: return centerInside ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]];
    case 11: return [[1, 2]];
    case 12: return [[3, 1]];
    case 13: return [[0, 1]];
    case 14: return [[3, 0]];
    default: return [];
  }
}

function extractSegments(field) {
  const stride = GRID_SIZE + 1;
  const segments = [];

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const topLeft = field[y * stride + x];
      const topRight = field[y * stride + x + 1];
      const bottomRight = field[(y + 1) * stride + x + 1];
      const bottomLeft = field[(y + 1) * stride + x];
      const values = [topLeft, topRight, bottomRight, bottomLeft];
      const cellCase =
        (topLeft >= FIELD_THRESHOLD ? 1 : 0) |
        (topRight >= FIELD_THRESHOLD ? 2 : 0) |
        (bottomRight >= FIELD_THRESHOLD ? 4 : 0) |
        (bottomLeft >= FIELD_THRESHOLD ? 8 : 0);
      if (cellCase === 0 || cellCase === 15) continue;
      const centerInside = (topLeft + topRight + bottomRight + bottomLeft) * 0.25 >= FIELD_THRESHOLD;
      for (const [edgeA, edgeB] of segmentEdges(cellCase, centerInside)) {
        segments.push([
          edgePoint(edgeA, x, y, values),
          edgePoint(edgeB, x, y, values)
        ]);
      }
    }
  }
  return segments;
}

function stitchLoops(segments) {
  const adjacency = new Map();
  const used = new Uint8Array(segments.length);

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    for (const point of segments[segmentIndex]) {
      const key = pointKey(point);
      const connected = adjacency.get(key) ?? [];
      connected.push(segmentIndex);
      adjacency.set(key, connected);
    }
  }

  const loops = [];
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    if (used[segmentIndex]) continue;
    const segment = segments[segmentIndex];
    const startKey = pointKey(segment[0]);
    const points = [segment[0], segment[1]];
    let currentKey = pointKey(segment[1]);
    used[segmentIndex] = 1;

    for (let guard = 0; guard <= segments.length; guard += 1) {
      if (currentKey === startKey) break;
      const nextIndex = (adjacency.get(currentKey) ?? []).find((candidate) => !used[candidate]);
      if (nextIndex === undefined) break;
      used[nextIndex] = 1;
      const nextSegment = segments[nextIndex];
      const nextPoint = pointKey(nextSegment[0]) === currentKey
        ? nextSegment[1]
        : nextSegment[0];
      points.push(nextPoint);
      currentKey = pointKey(nextPoint);
    }

    if (currentKey === startKey && points.length >= 4) loops.push(points);
  }
  return loops;
}

function createGeometry(frame) {
  const field = createDensityField(frame);
  const loops = stitchLoops(extractSegments(field));
  const formatScale = adaptiveAxisScale(frame, 0.34, 1.3);
  const localLoops = loops.map((loop) => loop.map(([x, y]) => {
    const localX = (x - GRID_SIZE * 0.5) * 2 / GRID_SIZE * formatScale.x;
    const localY = (y - GRID_SIZE * 0.5) * 2 / GRID_SIZE * formatScale.y;
    return [localX, localY];
  }));

  if (localLoops.length === 0) {
    return { loops: [], edgeWidth: Math.min(frame.width, frame.height) * 0.0008 };
  }

  const fit = fitBoundsToArtboard(frame, {
    minX: -formatScale.x,
    minY: -formatScale.y,
    maxX: formatScale.x,
    maxY: formatScale.y
  }, 0.08);

  return {
    loops: localLoops.map((loop) => loop.map(([x, y]) => [
      x * fit.scale + fit.offsetX,
      y * fit.scale + fit.offsetY
    ])),
    edgeWidth: Math.min(frame.width, frame.height) * 0.0008
  };
}

function appendLoop(context, loop) {
  context.moveTo(loop[0][0], loop[0][1]);
  for (let index = 1; index < loop.length; index += 1) {
    context.lineTo(loop[index][0], loop[index][1]);
  }
  context.closePath();
}

function render(context, frame) {
  const geometry = createGeometry(frame);
  if (!frame.transparent) {
    context.fillStyle = frame.palette.background;
    context.fillRect(0, 0, frame.width, frame.height);
  }
  if (geometry.loops.length === 0) return;

  context.beginPath();
  for (const loop of geometry.loops) appendLoop(context, loop);
  const paint = canvasGradientStyle(context, frame, appearanceParameters(frame));
  context.fillStyle = paint;
  context.fill("evenodd");
  context.strokeStyle = paint;
  context.lineWidth = geometry.edgeWidth;
  context.lineJoin = "round";
  context.stroke();
}

function loopToPath(loop) {
  let path = `M${loop[0][0].toFixed(2)} ${loop[0][1].toFixed(2)}`;
  for (let index = 1; index < loop.length; index += 1) {
    path += `L${loop[index][0].toFixed(2)} ${loop[index][1].toFixed(2)}`;
  }
  return `${path}Z`;
}

function toSvg(frame) {
  const geometry = createGeometry(frame);
  const gradient = svgGradientDefinition(frame, appearanceParameters(frame), "confluence-weave-gradient");
  const background = frame.transparent
    ? ""
    : `<rect width="${frame.width}" height="${frame.height}" fill="${frame.palette.background}"/>`;
  const path = geometry.loops.map(loopToPath).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><title>Cauce 06 — Confluence Weave</title>${gradient.definition}${background}<path d="${path}" fill="${gradient.paint}" fill-rule="evenodd" stroke="${gradient.paint}" stroke-width="${geometry.edgeWidth.toFixed(3)}" stroke-linejoin="round"/></svg>`;
}

export const confluenceWeaveProject = {
  id: PROJECT_ID,
  index: "06",
  name: "Confluence Weave",
  label: "Cauce — Confluence Weave",
  description: "Cauces orbitales se entrelazan y forman puentes líquidos cuando sus campos entran en contacto.",
  preferredFps: 60,
  preferredFormatKey: "square",
  preferredLoopSeconds: 8,
  controls: [
    { key: "channels", label: "Cauces", min: 2, max: 7, step: 1, defaultValue: 4, digits: 0 },
    { key: "squareness", label: "Cuadratura", min: 0, max: 1.2, step: 0.01, defaultValue: 0.55, digits: 2 },
    { key: "aspect", label: "Proporción", min: 0.65, max: 1.2, step: 0.01, defaultValue: 0.9, digits: 2 },
    { key: "weave", label: "Entrelazado", min: 0.1, max: 1.5, step: 0.01, defaultValue: 0.82, digits: 2 },
    { key: "separation", label: "Separación", min: 0, max: 0.42, step: 0.01, defaultValue: 0.18, digits: 2 },
    { key: "thickness", label: "Grosor", min: 0.006, max: 0.055, step: 0.001, defaultValue: 0.01, digits: 3 },
    { key: "fusion", label: "Fusión", min: 0, max: 1.2, step: 0.02, defaultValue: 0.78, digits: 2 },
    { key: "rotation", label: "Rotación", min: -180, max: 180, step: 1, defaultValue: 43, digits: 0, suffix: "°" },
    { key: "circulation", label: "Circulación", min: 0, max: 3, step: 1, defaultValue: 1, digits: 0 },
    { key: "breathing", label: "Respiración", min: 0, max: 0.25, step: 0.01, defaultValue: 0.1, digits: 2 },
    { key: "precession", label: "Precesión", min: 0, max: 18, step: 0.5, defaultValue: 3.5, digits: 1, suffix: "°" },
    ...gradientControlDefinitions(0, 0, 0.46)
  ],
  defaults: {
    channels: 4,
    squareness: 0.55,
    aspect: 0.9,
    weave: 0.82,
    separation: 0.18,
    thickness: 0.01,
    fusion: 0.78,
    rotation: 43,
    circulation: 1,
    breathing: 0.1,
    precession: 3.5,
    gradientStrength: 0,
    gradientAngle: 0,
    gradientMidpoint: 0.46
  },
  render,
  toSvg
};
