import {
  TAU,
  appearanceParameters,
  canvasGradientStyle,
  clamp,
  createRandom,
  gradientControlDefinitions,
  parameter,
  svgGradientDefinition
} from "./shared.js";
import { compositionMetrics, shortSideScale } from "./composition.js";

const PROJECT_ID = "flow-compression";

function eventOverlapsComposition(event, composition) {
  const supportY = event.sy * 3.2;
  if (
    event.v + supportY < composition.worldTop ||
    event.v - supportY > composition.worldTop + composition.worldHeight
  ) return false;

  const supportX = (
    event.sx * 3.2 +
    Math.abs(event.drift) +
    Math.abs(event.tilt) * composition.worldHeight
  );
  return !(
    event.u + supportX < composition.worldLeft ||
    event.u - supportX > composition.worldLeft + composition.worldWidth
  );
}

function extendEvents(events, composition) {
  const xOffsets = composition.worldWidth > 1.0001 ? [-1, 0, 1] : [0];
  const yOffsets = composition.worldHeight > 1.0001 ? [-1, 0, 1] : [0];
  const extended = [];

  for (const event of events) {
    for (const offsetY of yOffsets) {
      for (const offsetX of xOffsets) {
        const shifted = offsetX === 0 && offsetY === 0
          ? event
          : { ...event, u: event.u + offsetX, v: event.v + offsetY };
        if (eventOverlapsComposition(shifted, composition)) extended.push(shifted);
      }
    }
  }
  return extended;
}

function createField(frame, composition) {
  const random = createRandom(frame.seed);
  const phases = Array.from({ length: 8 }, () => random() * TAU);
  const eventCount = Math.round(parameter(frame, "focus", 11));
  const motion = parameter(frame, "motion", 0.72);
  const cycle = frame.time * TAU;
  const events = [];

  for (let index = 0; index < eventCount; index += 1) {
    const compressive = random() < 0.72;
    const baseU = 0.08 + random() * 0.84;
    const baseV = 0.06 + random() * 0.88;
    const orbitX = motion * (0.012 + random() * 0.055);
    const orbitY = motion * (0.018 + random() * 0.075);
    const orbitPhase = random() * TAU;
    const harmonic = 1 + Math.floor(random() * 2);

    events.push({
      u: baseU + orbitX * Math.sin(cycle * harmonic + orbitPhase),
      v: baseV + orbitY * Math.cos(cycle * harmonic + orbitPhase),
      sx: 0.018 + random() * 0.09,
      sy: 0.06 + random() * 0.24,
      strength: (compressive ? -1 : 1) * (0.55 + random() * 1.25),
      drift: (random() - 0.5) * (0.12 + motion * 0.18),
      tilt: (random() - 0.5) * 0.34,
      frequency: 0.35 + random() * 1.25,
      phase: random() * TAU + cycle * (random() < 0.5 ? -1 : 1)
    });
  }

  return { phases, events: extendEvents(events, composition) };
}

function prepareEventsForRow(field, v, scaledV) {
  return field.events.map((event) => {
    const dv = v - event.v;
    const localWave = event.drift * Math.sin(event.phase + TAU * event.frequency * scaledV);
    return {
      center: event.u + event.tilt * dv + localWave,
      inverseSxSquared: 1 / (event.sx * event.sx),
      verticalDistance: (dv * dv) / (event.sy * event.sy),
      strength: event.strength
    };
  });
}

function logGap(u, scaledV, frame, field, rowEvents) {
  const flow = parameter(frame, "flow", 0.75);
  const compression = parameter(frame, "compression", 1.35);
  const cycle = frame.time * TAU;
  let result = flow * (
    0.46 * Math.sin(TAU * (0.82 * u + 0.34 * scaledV) + field.phases[0] + cycle) +
    0.31 * Math.sin(TAU * (1.63 * u - 0.52 * scaledV) + field.phases[1] - cycle * 2) +
    0.16 * Math.sin(TAU * (3.28 * u + 0.73 * scaledV) + field.phases[2] + cycle)
  );

  for (const event of rowEvents) {
    const du = u - event.center;
    const exponent = -0.5 * (du * du * event.inverseSxSquared + event.verticalDistance);
    result += compression * event.strength * Math.exp(exponent);
  }

  const longFold = Math.sin(TAU * (0.37 * scaledV) + field.phases[3] - cycle);
  result += flow * 0.14 * Math.sin(TAU * (u * 1.15 + longFold * 0.18) + field.phases[4] + cycle);
  return clamp(result, -4.4, 4.4);
}

export function createCompressionGeometry(frame, includeDensity = false) {
  const composition = compositionMetrics(frame);
  const lineCount = Math.max(2, Math.round(
    parameter(frame, "lines", 118) * composition.worldWidth
  ));
  const verticalFrequency = parameter(frame, "frequency", 1);
  const padding = 4 * shortSideScale(frame);
  const span = frame.width - padding * 2;
  const samples = Math.round(clamp(152 * composition.worldHeight, 150, 260));
  const intervals = lineCount - 1;
  const lines = Array.from({ length: lineCount }, () => new Float32Array(samples * 2));
  const densities = includeDensity
    ? Array.from({ length: lineCount }, () => new Float32Array(samples))
    : null;
  const field = createField(frame, composition);

  for (let sample = 0; sample < samples; sample += 1) {
    const normalizedV = sample / (samples - 1);
    const v = composition.worldTop + normalizedV * composition.worldHeight;
    const scaledV = v * verticalFrequency;
    const y = normalizedV * frame.height;
    const rowEvents = prepareEventsForRow(field, v, scaledV);
    const gaps = new Float32Array(intervals);
    let total = 0;

    for (let index = 0; index < intervals; index += 1) {
      const u = composition.worldLeft +
        (index + 0.5) / intervals * composition.worldWidth;
      const gap = Math.exp(logGap(u, scaledV, frame, field, rowEvents));
      gaps[index] = gap;
      total += gap;
    }

    const pointIndex = sample * 2;
    lines[0][pointIndex] = padding;
    lines[0][pointIndex + 1] = y;

    let cumulative = 0;
    for (let lineIndex = 1; lineIndex < lineCount; lineIndex += 1) {
      cumulative += gaps[lineIndex - 1];
      lines[lineIndex][pointIndex] = padding + span * cumulative / total;
      lines[lineIndex][pointIndex + 1] = y;
    }

    if (densities) {
      const referenceGap = span / intervals;
      for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
        const currentX = lines[lineIndex][pointIndex];
        const leftGap = lineIndex > 0
          ? currentX - lines[lineIndex - 1][pointIndex]
          : null;
        const rightGap = lineIndex < lineCount - 1
          ? lines[lineIndex + 1][pointIndex] - currentX
          : null;
        const localGap = leftGap !== null && rightGap !== null
          ? 2 * leftGap * rightGap / Math.max(0.0001, leftGap + rightGap)
          : leftGap ?? rightGap ?? referenceGap;
        densities[lineIndex][sample] = Math.log(
          referenceGap / Math.max(0.0001, localGap)
        );
      }
    }
  }

  return { lines, densities };
}

function createGeometry(frame) {
  return createCompressionGeometry(frame).lines;
}

function render(context, frame) {
  const lines = createGeometry(frame);
  if (!frame.transparent) {
    context.fillStyle = frame.palette.background;
    context.fillRect(0, 0, frame.width, frame.height);
  }
  context.strokeStyle = canvasGradientStyle(context, frame, appearanceParameters(frame));
  context.lineWidth = parameter(frame, "stroke", 1.55) * shortSideScale(frame);
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const line of lines) {
    context.beginPath();
    context.moveTo(line[0], line[1]);
    for (let index = 2; index < line.length; index += 2) {
      context.lineTo(line[index], line[index + 1]);
    }
    context.stroke();
  }
}

function lineToPath(line) {
  let path = `M${line[0].toFixed(2)} ${line[1].toFixed(2)}`;
  for (let index = 2; index < line.length; index += 2) {
    path += `L${line[index].toFixed(2)} ${line[index + 1].toFixed(2)}`;
  }
  return path;
}

function toSvg(frame) {
  const lines = createGeometry(frame);
  const gradient = svgGradientDefinition(
    frame,
    appearanceParameters(frame),
    "compression-field-gradient"
  );
  const stroke = parameter(frame, "stroke", 1.55) * shortSideScale(frame);
  const paths = lines.map((line) => `<path d="${lineToPath(line)}"/>`).join("");
  const background = frame.transparent
    ? ""
    : `<rect width="${frame.width}" height="${frame.height}" fill="${frame.palette.background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><title>Cauce 01 — Compression Field</title>${gradient.definition}${background}<g fill="none" stroke="${gradient.paint}" stroke-width="${stroke.toFixed(3)}" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
}

export const flowCompressionProject = {
  id: PROJECT_ID,
  index: "01",
  name: "Compression Field",
  label: "Cauce — Compression Field",
  description: "La presión móvil reorganiza un conjunto ordenado de líneas sin permitir cruces.",
  preferredFps: 30,
  controls: [
    { key: "lines", label: "Líneas", min: 40, max: 180, step: 1, defaultValue: 118, digits: 0 },
    { key: "focus", label: "Focos", min: 3, max: 20, step: 1, defaultValue: 11, digits: 0 },
    { key: "compression", label: "Compresión", min: 0, max: 2.6, step: 0.05, defaultValue: 1.35, digits: 2 },
    { key: "flow", label: "Flujo", min: 0, max: 1.6, step: 0.05, defaultValue: 0.75, digits: 2 },
    { key: "frequency", label: "Frecuencia vertical", min: 0.45, max: 2, step: 0.05, defaultValue: 1, digits: 2 },
    { key: "motion", label: "Deriva del cauce", min: 0, max: 1.4, step: 0.05, defaultValue: 0.72, digits: 2 },
    ...gradientControlDefinitions(0, 0, 0.46),
    { key: "stroke", label: "Trazo", min: 0.45, max: 3.2, step: 0.05, defaultValue: 1.55, digits: 2, group: "appearance" }
  ],
  defaults: {
    lines: 118,
    focus: 11,
    compression: 1.35,
    flow: 0.75,
    frequency: 1,
    motion: 0.72,
    gradientStrength: 0,
    gradientAngle: 0,
    gradientMidpoint: 0.46,
    stroke: 1.55
  },
  render,
  toSvg
};
