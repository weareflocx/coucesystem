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
import { createFieldGrid, shortSideScale } from "./composition.js";

function smoothstep(edge0, edge1, value) {
  const normalized = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function signed(random) {
  return random() < 0.5 ? -1 : 1;
}

function createField(frame) {
  const random = createRandom((frame.seed ^ 0xA6C89B3D) >>> 0);
  const scale = parameter(frame, "scale", 1);
  const drift = parameter(frame, "drift", 1);
  const flowModes = [];
  const blobs = [];

  for (let index = 0; index < 6; index += 1) {
    const kx = signed(random) * scale * (0.28 + random() * 1.15);
    const ky = signed(random) * scale * (0.28 + random() * 1.15);
    const waveLength = Math.max(0.35, Math.hypot(kx, ky));
    flowModes.push({
      kx,
      ky,
      amplitude: (0.14 + random() * 0.22) / waveLength,
      harmonic: 1 + Math.floor(random() * 2),
      phase: random() * TAU
    });
  }

  for (let index = 0; index < 7; index += 1) {
    blobs.push({
      x: -0.12 + random() * 1.24,
      y: -0.12 + random() * 1.24,
      orbitX: drift * (0.08 + random() * 0.36),
      orbitY: drift * (0.08 + random() * 0.34),
      radiusX: (0.12 + random() * 0.28) / Math.sqrt(scale),
      radiusY: (0.12 + random() * 0.34) / Math.sqrt(scale),
      angle: random() * TAU,
      strength: 0.55 + random() * 1.15,
      harmonic: 1 + Math.floor(random() * 2),
      phase: random() * TAU
    });
  }

  return {
    flowModes,
    blobs,
    tidePhase: 0,
    wavePhaseA: random() * TAU,
    wavePhaseB: random() * TAU
  };
}

function sampleFlow(x, y, cycle, field, bend) {
  let velocityX = 0.78;
  let velocityY = 0.28;

  for (const mode of field.flowModes) {
    const phase = TAU * (mode.kx * x + mode.ky * y) + mode.phase + cycle * mode.harmonic;
    const derivative = Math.cos(phase) * mode.amplitude * bend;
    velocityX += mode.ky * derivative;
    velocityY -= mode.kx * derivative;
  }

  return [velocityX, velocityY];
}

function sampleMass(x, y, cycle, field, velocityX, velocityY, coverage, contrast) {
  const sampleX = x - velocityX * 0.055;
  const sampleY = y - velocityY * 0.055;
  let mass = 0;

  for (const blob of field.blobs) {
    const centerX = blob.x + blob.orbitX * Math.sin(cycle * blob.harmonic + blob.phase);
    const centerY = blob.y + blob.orbitY * Math.cos(cycle * blob.harmonic + blob.phase);
    const dx = sampleX - centerX;
    const dy = sampleY - centerY;
    const cosine = Math.cos(blob.angle);
    const sine = Math.sin(blob.angle);
    const localX = cosine * dx + sine * dy;
    const localY = -sine * dx + cosine * dy;
    const distance = (
      localX * localX / (blob.radiusX * blob.radiusX) +
      localY * localY / (blob.radiusY * blob.radiusY)
    );
    mass += blob.strength * Math.exp(-0.5 * distance);
  }

  const waveA = 0.5 + 0.5 * Math.sin(
    TAU * (sampleX * 0.48 - sampleY * 0.31) + cycle + field.wavePhaseA
  );
  const waveB = 0.5 + 0.5 * Math.sin(
    TAU * (sampleX * 0.23 + sampleY * 0.57) - cycle * 2 + field.wavePhaseB
  );
  const ridge = 0.5 + 0.5 * Math.sin(
    TAU * (sampleX * 1.12 + sampleY * 0.86) + cycle * 2 + field.wavePhaseA
  );
  const crossCurrent = 0.5 + 0.5 * Math.sin(
    TAU * (sampleX * 0.76 - sampleY * 1.18) - cycle + field.wavePhaseB
  );
  const tide = 0.04 + 0.96 * Math.pow(
    0.5 + 0.5 * Math.sin(cycle + field.tidePhase),
    2.2
  );
  const signal = (
    tide * mass * (0.44 + ridge * 0.34) +
    waveA * 0.14 +
    waveB * 0.08 +
    crossCurrent * 0.06
  );
  const threshold = 0.58 - coverage * 0.22;
  const softness = 0.34 / Math.max(0.6, contrast);
  const energy = smoothstep(threshold - softness, threshold + softness, signal);
  return Math.pow(energy, Math.max(0.55, contrast * 0.72));
}

function createGeometry(frame) {
  const grid = createFieldGrid(frame, parameter(frame, "density", 60));
  const bend = parameter(frame, "bend", 1.2);
  const coverage = parameter(frame, "coverage", 0.85);
  const contrast = parameter(frame, "contrast", 1.35);
  const dashLength = parameter(frame, "length", 0.68);
  const strokeWidth = parameter(frame, "stroke", 1.35) * shortSideScale(frame);
  const baseLength = grid.cellSize * dashLength;
  const cycle = frame.time * TAU;
  const field = createField(frame);
  const values = new Float32Array(grid.columns * grid.rows * 5);
  let offset = 0;

  for (let row = 0; row < grid.rows; row += 1) {
    const screenY = (row + 0.5) * grid.cellHeight;
    const worldY = grid.worldTop + (row + 0.5) * grid.worldCellHeight;
    for (let column = 0; column < grid.columns; column += 1) {
      const screenX = (column + 0.5) * grid.cellWidth;
      const worldX = grid.worldLeft + (column + 0.5) * grid.worldCellWidth;
      const [velocityX, velocityY] = sampleFlow(
        worldX,
        worldY,
        cycle,
        field,
        bend
      );
      const magnitude = Math.max(0.0001, Math.hypot(velocityX, velocityY));
      const directionX = velocityX / magnitude;
      const directionY = velocityY / magnitude;
      const energy = sampleMass(
        worldX,
        worldY,
        cycle,
        field,
        velocityX,
        velocityY,
        coverage,
        contrast
      );
      const halfLength = baseLength * (0.16 + energy * 0.84) * 0.5;

      values[offset] = screenX - directionX * halfLength;
      values[offset + 1] = screenY - directionY * halfLength;
      values[offset + 2] = screenX + directionX * halfLength;
      values[offset + 3] = screenY + directionY * halfLength;
      values[offset + 4] = 0.018 + energy * 0.982;
      offset += 5;
    }
  }

  return { values, strokeWidth };
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

  const opacityBins = 16;
  for (let bin = 0; bin < opacityBins; bin += 1) {
    context.globalAlpha = (bin + 0.35) / opacityBins;
    context.beginPath();
    for (let index = 0; index < geometry.values.length; index += 5) {
      const opacityBin = Math.min(
        opacityBins - 1,
        Math.floor(geometry.values[index + 4] * opacityBins)
      );
      if (opacityBin !== bin) continue;
      context.moveTo(geometry.values[index], geometry.values[index + 1]);
      context.lineTo(geometry.values[index + 2], geometry.values[index + 3]);
    }
    context.stroke();
  }
  context.globalAlpha = 1;
}

function toSvg(frame) {
  const geometry = createGeometry(frame);
  const gradient = svgGradientDefinition(
    frame,
    appearanceParameters(frame),
    "vector-currents-gradient"
  );
  const lines = [];
  for (let index = 0; index < geometry.values.length; index += 5) {
    lines.push(`<line x1="${geometry.values[index].toFixed(2)}" y1="${geometry.values[index + 1].toFixed(2)}" x2="${geometry.values[index + 2].toFixed(2)}" y2="${geometry.values[index + 3].toFixed(2)}" stroke-opacity="${geometry.values[index + 4].toFixed(3)}"/>`);
  }
  const background = frame.transparent
    ? ""
    : `<rect width="${frame.width}" height="${frame.height}" fill="${frame.palette.background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><title>Cauce 02 — Vector Currents</title>${gradient.definition}${background}<g fill="none" stroke="${gradient.paint}" stroke-width="${geometry.strokeWidth.toFixed(3)}" stroke-linecap="round">${lines.join("")}</g></svg>`;
}

export const flowAdvectionRenderer = {
  preferredFps: 60,
  preferredFormatKey: "square",
  preferredLoopSeconds: 5.6,
  controls: [
    { key: "density", label: "Densidad", min: 40, max: 92, step: 1, defaultValue: 60, digits: 0 },
    { key: "scale", label: "Escala del campo", min: 0.55, max: 2.1, step: 0.05, defaultValue: 1, digits: 2 },
    { key: "bend", label: "Curvatura", min: 0, max: 2.4, step: 0.05, defaultValue: 1.2, digits: 2 },
    { key: "drift", label: "Deriva", min: 0, max: 1.8, step: 0.05, defaultValue: 1, digits: 2 },
    { key: "coverage", label: "Cobertura", min: 0, max: 1.8, step: 0.05, defaultValue: 0.85, digits: 2 },
    { key: "contrast", label: "Contraste", min: 0.55, max: 2.8, step: 0.05, defaultValue: 1.35, digits: 2 },
    { key: "length", label: "Longitud", min: 0.3, max: 1.2, step: 0.05, defaultValue: 0.68, digits: 2 },
    ...gradientControlDefinitions(0, 0, 0.46),
    { key: "stroke", label: "Trazo", min: 0.45, max: 2.4, step: 0.05, defaultValue: 1.35, digits: 2, group: "appearance" }
  ],
  defaults: {
    density: 60,
    scale: 1,
    bend: 1.2,
    drift: 1,
    coverage: 0.85,
    contrast: 1.35,
    length: 0.68,
    gradientStrength: 0,
    gradientAngle: 0,
    gradientMidpoint: 0.46,
    stroke: 1.35
  },
  render,
  toSvg
};
