import { TAU, clamp, createRandom, parameter } from "./shared.js";

const PROJECT_ID = "scalar-drift";

function smoothstep(edge0, edge1, value) {
  const normalized = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function signedInteger(random, minimum, maximum) {
  const magnitude = minimum + Math.floor(random() * (maximum - minimum + 1));
  return random() < 0.5 ? -magnitude : magnitude;
}

function createModes(random, count, options) {
  const modes = [];
  let normalizer = 0;

  for (let index = 0; index < count; index += 1) {
    const amplitude = options.amplitudeMin + random() * options.amplitudeRange;
    const kx = options.xMin + Math.floor(random() * (options.xMax - options.xMin + 1));
    const ky = options.allowZeroY && random() < 0.18
      ? 0
      : signedInteger(random, options.yMin, options.yMax);
    modes.push({
      amplitude,
      kx,
      ky,
      phase: random() * TAU
    });
    normalizer += amplitude;
  }

  return { modes, normalizer };
}

function createField(frame) {
  const random = createRandom((frame.seed ^ 0x53CA1A7) >>> 0);
  return {
    broad: createModes(random, 8, {
      xMin: 1,
      xMax: 3,
      yMin: 1,
      yMax: 4,
      allowZeroY: true,
      amplitudeMin: 0.55,
      amplitudeRange: 0.75
    }),
    bands: createModes(random, 15, {
      xMin: 1,
      xMax: 5,
      yMin: 5,
      yMax: 22,
      allowZeroY: false,
      amplitudeMin: 0.22,
      amplitudeRange: 0.7
    }),
    grain: createModes(random, 10, {
      xMin: 5,
      xMax: 13,
      yMin: 6,
      yMax: 30,
      allowZeroY: false,
      amplitudeMin: 0.12,
      amplitudeRange: 0.46
    }),
    flowPhase: -TAU * 0.28 + (random() - 0.5) * 0.28,
    warpPhaseX: random() * TAU,
    warpPhaseY: random() * TAU
  };
}

function sampleModes(group, x, y, cycle, scale, drift) {
  let value = 0;
  for (const mode of group.modes) {
    const phase = (
      TAU * scale * (mode.kx * x + mode.ky * y) -
      cycle * mode.kx * drift +
      mode.phase
    );
    value += Math.sin(phase) * mode.amplitude;
  }
  return value / Math.max(0.000001, group.normalizer);
}

function sampleEnergy(x, y, cycle, field, settings) {
  const horizontalWarp = settings.turbulence * 0.018 * Math.sin(
    TAU * (2 * x - 3 * y) - cycle * 2 + field.warpPhaseX
  );
  const verticalWarp = settings.turbulence * 0.014 * Math.sin(
    TAU * (x + 2 * y) - cycle + field.warpPhaseY
  );
  const sampleX = x + horizontalWarp;
  const sampleY = y + verticalWarp;
  const courseWarp = settings.turbulence * (
    0.14 * Math.sin(TAU * sampleY - cycle + field.warpPhaseY) +
    0.045 * Math.sin(TAU * sampleY * 3 + cycle * 2 + field.warpPhaseX)
  );
  const course = Math.cos(
    TAU * settings.scale * (sampleX + courseWarp) -
    cycle * settings.drift +
    field.flowPhase
  );
  const broad = sampleModes(
    field.broad,
    sampleX,
    sampleY,
    cycle,
    settings.scale,
    settings.drift
  );
  const bands = sampleModes(
    field.bands,
    sampleX,
    sampleY,
    cycle,
    settings.scale,
    settings.drift
  );
  const grain = sampleModes(
    field.grain,
    sampleX,
    sampleY,
    cycle,
    settings.scale,
    settings.drift
  );
  const tide = (
    Math.cos(cycle) * 0.38 -
    Math.sin(cycle) * 0.06 -
    0.05
  );
  const mass = course * 0.88 + broad * 0.34 + tide;
  const threshold = 0.18 - settings.coverage * 0.35;
  const softness = 0.38 / Math.max(0.65, settings.contrast);
  const envelope = smoothstep(threshold - softness, threshold + softness, mass);
  const texture = smoothstep(-0.5, 0.38, bands * 1.35 + grain * 0.8);
  const fragmentationMix = clamp(settings.fragmentation / 1.5, 0, 1);
  const fragmented = (
    envelope * (1 - fragmentationMix * 0.68 * (1 - texture)) +
    (1 - envelope) * texture * fragmentationMix * 0.075
  );
  return Math.pow(fragmented, Math.max(0.58, settings.contrast * 0.68));
}

function createGeometry(frame) {
  const columns = Math.round(parameter(frame, "density", 100));
  const rows = Math.max(20, Math.round(columns * frame.height / frame.width));
  const cellWidth = frame.width / columns;
  const cellHeight = frame.height / rows;
  const cycle = frame.time * TAU;
  const settings = {
    scale: parameter(frame, "scale", 1),
    drift: Math.round(parameter(frame, "drift", 1)),
    turbulence: parameter(frame, "turbulence", 0.75),
    fragmentation: parameter(frame, "fragmentation", 1.15),
    coverage: parameter(frame, "coverage", 0.85),
    contrast: parameter(frame, "contrast", 1.7)
  };
  const minimumFill = parameter(frame, "minimumFill", 0.16);
  const maximumFill = Math.max(
    minimumFill,
    parameter(frame, "maximumFill", 0.82)
  );
  const levels = Math.max(2, Math.round(parameter(frame, "levels", 4)));
  const cellSize = Math.min(cellWidth, cellHeight);
  const field = createField(frame);
  const values = new Float32Array(columns * rows * 3);
  let offset = 0;

  for (let row = 0; row < rows; row += 1) {
    const y = (row + 0.5) / rows;
    const centerY = y * frame.height;

    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) / columns;
      const centerX = x * frame.width;
      const energy = sampleEnergy(x, y, cycle, field, settings);
      const fillEnergy = Math.pow(energy, 2);
      const level = Math.round(fillEnergy * (levels - 1)) / (levels - 1);
      const size = cellSize * (
        minimumFill + level * (maximumFill - minimumFill)
      );

      values[offset] = centerX - size * 0.5;
      values[offset + 1] = centerY - size * 0.5;
      values[offset + 2] = size;
      offset += 3;
    }
  }

  return values;
}

function render(context, frame) {
  const values = createGeometry(frame);
  if (!frame.transparent) {
    context.fillStyle = frame.palette.background;
    context.fillRect(0, 0, frame.width, frame.height);
  }
  context.fillStyle = frame.palette.foreground;
  for (let index = 0; index < values.length; index += 3) {
    context.fillRect(
      values[index],
      values[index + 1],
      values[index + 2],
      values[index + 2]
    );
  }
}

function toSvg(frame) {
  const values = createGeometry(frame);
  const pixels = [];
  for (let index = 0; index < values.length; index += 3) {
    pixels.push(`<rect x="${values[index].toFixed(2)}" y="${values[index + 1].toFixed(2)}" width="${values[index + 2].toFixed(2)}" height="${values[index + 2].toFixed(2)}"/>`);
  }
  const background = frame.transparent
    ? ""
    : `<rect width="${frame.width}" height="${frame.height}" fill="${frame.palette.background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><title>Cauce 03 — Scalar Drift</title>${background}<g fill="${frame.palette.foreground}">${pixels.join("")}</g></svg>`;
}

export const scalarDriftProject = {
  id: PROJECT_ID,
  index: "03",
  name: "Scalar Drift",
  label: "Cauce — Scalar Drift",
  description: "Una densidad escalar rellena por niveles los píxeles cuadrados de una retícula fija.",
  preferredFps: 20,
  preferredFormatKey: "square",
  preferredLoopSeconds: 4.5,
  controls: [
    { key: "density", label: "Densidad", min: 56, max: 132, step: 1, defaultValue: 100, digits: 0 },
    { key: "scale", label: "Escala de masa", min: 0.55, max: 1.8, step: 0.05, defaultValue: 1, digits: 2 },
    { key: "drift", label: "Deriva horizontal", min: 0, max: 3, step: 1, defaultValue: 1, digits: 0 },
    { key: "turbulence", label: "Turbulencia", min: 0, max: 2, step: 0.05, defaultValue: 0.75, digits: 2 },
    { key: "fragmentation", label: "Fragmentación", min: 0, max: 2.4, step: 0.05, defaultValue: 1.15, digits: 2 },
    { key: "coverage", label: "Cobertura", min: 0, max: 2, step: 0.05, defaultValue: 0.85, digits: 2 },
    { key: "contrast", label: "Contraste", min: 0.65, max: 3, step: 0.05, defaultValue: 1.7, digits: 2 },
    { key: "minimumFill", label: "Relleno mínimo", min: 0.04, max: 0.35, step: 0.01, defaultValue: 0.16, digits: 2 },
    { key: "maximumFill", label: "Relleno máximo", min: 0.35, max: 0.96, step: 0.01, defaultValue: 0.82, digits: 2 },
    { key: "levels", label: "Niveles de relleno", min: 2, max: 8, step: 1, defaultValue: 4, digits: 0 }
  ],
  defaults: {
    density: 100,
    scale: 1,
    drift: 1,
    turbulence: 0.75,
    fragmentation: 1.15,
    coverage: 0.85,
    contrast: 1.7,
    minimumFill: 0.16,
    maximumFill: 0.82,
    levels: 4
  },
  render,
  toSvg
};
