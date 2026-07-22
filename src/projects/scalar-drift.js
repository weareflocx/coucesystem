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
import { createFieldGrid } from "./composition.js";

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

function createVortices(random, count) {
  return Array.from({ length: count }, () => ({
    centerX: -0.1 + random() * 1.2,
    centerY: -0.1 + random() * 1.2,
    radius: 0.14 + random() * 0.3,
    strength: (random() < 0.5 ? -1 : 1) * (0.35 + random() * 0.8),
    orbitX: 0.035 + random() * 0.13,
    orbitY: 0.035 + random() * 0.13,
    rateX: 0.16 + random() * 0.31,
    rateY: 0.13 + random() * 0.29,
    phaseX: random() * TAU,
    phaseY: random() * TAU
  }));
}

function createSources(random, count) {
  return Array.from({ length: count }, (_, index) => ({
    centerX: -0.18 + random() * 1.36,
    centerY: -0.18 + random() * 1.36,
    radiusX: 0.12 + random() * 0.24,
    radiusY: 0.1 + random() * 0.22,
    orbitX: 0.08 + random() * 0.22,
    orbitY: 0.08 + random() * 0.22,
    rateX: 0.07 + random() * 0.19,
    rateY: 0.06 + random() * 0.17,
    phaseX: random() * TAU,
    phaseY: random() * TAU,
    rotation: random() * TAU,
    spin: (random() - 0.5) * 0.18,
    pulse: 0.08 + random() * 0.18,
    pulseRate: 0.11 + random() * 0.28,
    pulsePhase: random() * TAU,
    strength: index % 4 === 3
      ? -(0.4 + random() * 0.55)
      : 0.65 + random() * 0.85
  }));
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
    warpPhaseY: random() * TAU,
    vortices: createVortices(random, 6),
    sources: createSources(random, 10)
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

function sampleVortexFlow(x, y, time, field, vorticity) {
  let flowX = 0;
  let flowY = 0;
  for (const vortex of field.vortices) {
    const centerX = vortex.centerX + vortex.orbitX * Math.sin(
      time * vortex.rateX + vortex.phaseX
    );
    const centerY = vortex.centerY + vortex.orbitY * Math.cos(
      time * vortex.rateY + vortex.phaseY
    );
    const dx = x - centerX;
    const dy = y - centerY;
    const radiusSquared = vortex.radius * vortex.radius;
    const falloff = Math.exp(-(dx * dx + dy * dy) / Math.max(0.000001, radiusSquared));
    const force = vortex.strength * falloff / Math.max(0.000001, vortex.radius);
    flowX -= dy * force;
    flowY += dx * force;
  }
  return [flowX * vorticity, flowY * vorticity];
}

function sampleContinuousModes(group, x, y, time, scale, drift, temporalScale) {
  let value = 0;
  for (const mode of group.modes) {
    const temporalRate = temporalScale * (
      mode.kx * 0.17 + mode.ky * 0.071
    );
    const phase = (
      TAU * scale * (mode.kx * x + mode.ky * y) -
      time * drift * temporalRate +
      mode.phase
    );
    value += Math.sin(phase) * mode.amplitude;
  }
  return value / Math.max(0.000001, group.normalizer);
}

function sampleSourceField(x, y, time, field, settings) {
  let value = 0;
  const orbitScale = 0.7 + settings.vorticity * 0.3;
  const radiusScale = 1 / Math.max(0.65, settings.scale);

  for (const source of field.sources) {
    const centerX = source.centerX + source.orbitX * orbitScale * Math.sin(
      time * source.rateX * settings.drift + source.phaseX
    );
    const centerY = source.centerY + source.orbitY * orbitScale * Math.cos(
      time * source.rateY * settings.drift + source.phaseY
    );
    const pulse = 1 + source.pulse * Math.sin(
      time * source.pulseRate * settings.drift + source.pulsePhase
    );
    const radiusX = Math.max(0.04, source.radiusX * pulse * radiusScale);
    const radiusY = Math.max(0.04, source.radiusY * (2 - pulse) * radiusScale);
    const rotation = source.rotation + time * source.spin * settings.drift;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const dx = x - centerX;
    const dy = y - centerY;
    const localX = dx * cosine + dy * sine;
    const localY = -dx * sine + dy * cosine;
    const distance = (
      localX * localX / (radiusX * radiusX) +
      localY * localY / (radiusY * radiusY)
    );
    value += source.strength * Math.exp(-distance * 1.25);
  }

  return Math.tanh(value * 0.9);
}

function sampleContinuousEnergy(x, y, time, field, settings) {
  const [flowX, flowY] = sampleVortexFlow(
    x,
    y,
    time,
    field,
    settings.vorticity
  );
  const slowWarpX = Math.sin(
    TAU * (1.35 * x - 0.8 * y) + time * 0.31 + field.warpPhaseX
  );
  const slowWarpY = Math.cos(
    TAU * (0.65 * x + 1.45 * y) - time * 0.23 + field.warpPhaseY
  );
  const warpStrength = settings.organicity * settings.turbulence;
  const sampleX = x + warpStrength * (flowX * 0.105 + slowWarpX * 0.022);
  const sampleY = y + warpStrength * (flowY * 0.105 + slowWarpY * 0.022);
  const sourceField = sampleSourceField(sampleX, sampleY, time, field, settings);
  const broad = sampleContinuousModes(
    field.broad,
    sampleX,
    sampleY,
    time,
    settings.scale,
    settings.drift,
    0.52
  );
  const bands = sampleContinuousModes(
    field.bands,
    sampleX,
    sampleY,
    time,
    settings.scale,
    settings.drift,
    0.31
  );
  const grain = sampleContinuousModes(
    field.grain,
    sampleX,
    sampleY,
    time,
    settings.scale,
    settings.drift,
    0.18
  );
  const localPulse = Math.sin(
    time * 0.37 + TAU * (sampleX * 0.43 - sampleY * 0.29) + field.warpPhaseX
  );
  const tide = (
    Math.cos(time * 0.29 + field.warpPhaseY) * 0.22 +
    Math.sin(time * 0.17 + field.warpPhaseX) * 0.12 +
    localPulse * 0.08 -
    0.07
  );
  const sourceWeight = 0.78 + settings.organicity * 0.5;
  const broadWeight = 0.62 - settings.organicity * 0.24;
  const mass = sourceField * sourceWeight + broad * broadWeight + tide;
  const threshold = 0.18 - settings.coverage * 0.35;
  const softness = 0.42 / Math.max(0.65, settings.contrast);
  const envelope = smoothstep(threshold - softness, threshold + softness, mass);
  const texture = smoothstep(-0.55, 0.42, bands * 1.25 + grain * 0.72);
  const fragmentationMix = clamp(settings.fragmentation / 1.5, 0, 1);
  const fragmented = (
    envelope * (1 - fragmentationMix * 0.6 * (1 - texture)) +
    (1 - envelope) * texture * fragmentationMix * 0.09
  );
  return Math.pow(fragmented, Math.max(0.58, settings.contrast * 0.68));
}

function createGeometry(frame) {
  const grid = createFieldGrid(frame, parameter(frame, "density", 100));
  const cycle = frame.time * TAU;
  const continuous = frame.timeMode === "continuous";
  const elapsedTime = Number.isFinite(frame.elapsedTime)
    ? frame.elapsedTime
    : frame.time * 4.5;
  const settings = {
    scale: parameter(frame, "scale", 1),
    drift: continuous
      ? parameter(frame, "drift", 1)
      : Math.round(parameter(frame, "drift", 1)),
    turbulence: parameter(frame, "turbulence", 0.75),
    organicity: parameter(frame, "organicity", 1),
    vorticity: parameter(frame, "vorticity", 1),
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
  const field = createField(frame);
  const values = new Float32Array(grid.columns * grid.rows * 3);
  let offset = 0;

  for (let row = 0; row < grid.rows; row += 1) {
    const screenY = (row + 0.5) * grid.cellHeight;
    const worldY = grid.worldTop + (row + 0.5) * grid.worldCellHeight;
    for (let column = 0; column < grid.columns; column += 1) {
      const screenX = (column + 0.5) * grid.cellWidth;
      const worldX = grid.worldLeft + (column + 0.5) * grid.worldCellWidth;
      const energy = continuous
        ? sampleContinuousEnergy(worldX, worldY, elapsedTime, field, settings)
        : sampleEnergy(worldX, worldY, cycle, field, settings);
      const fillEnergy = Math.pow(energy, 2);
      const level = Math.round(fillEnergy * (levels - 1)) / (levels - 1);
      const size = grid.cellSize * (
        minimumFill + level * (maximumFill - minimumFill)
      );

      values[offset] = screenX - size * 0.5;
      values[offset + 1] = screenY - size * 0.5;
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
  context.fillStyle = canvasGradientStyle(context, frame, appearanceParameters(frame));
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
  const gradient = svgGradientDefinition(frame, appearanceParameters(frame), "scalar-drift-gradient");
  const pixels = [];
  for (let index = 0; index < values.length; index += 3) {
    pixels.push(`<rect x="${values[index].toFixed(2)}" y="${values[index + 1].toFixed(2)}" width="${values[index + 2].toFixed(2)}" height="${values[index + 2].toFixed(2)}"/>`);
  }
  const background = frame.transparent
    ? ""
    : `<rect width="${frame.width}" height="${frame.height}" fill="${frame.palette.background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><title>Cauce 03 — Scalar Drift</title>${gradient.definition}${background}<g fill="${gradient.paint}">${pixels.join("")}</g></svg>`;
}

export const scalarDriftProject = {
  id: PROJECT_ID,
  index: "03",
  name: "Scalar Drift",
  label: "Cauce — Scalar Drift",
  description: "Masas escalares orgánicas se cruzan, se fusionan y abren vacíos sobre una retícula fija.",
  preferredFps: 20,
  appearanceCapabilities: {
    paint: true,
    gradientMapping: /** @type {Array<"screen" | "surface">} */ (["screen"]),
    proceduralTextures: /** @type {Array<"flow" | "grain" | "mineral">} */ (["flow", "grain", "mineral"])
  },
  preferredFormatKey: "square",
  preferredLoopSeconds: 4.5,
  preferredPlaybackMode: /** @type {"continuous"} */ ("continuous"),
  supportsContinuousTime: true,
  controls: [
    { key: "density", label: "Densidad", min: 56, max: 132, step: 1, defaultValue: 100, digits: 0 },
    { key: "scale", label: "Escala de masa", min: 0.55, max: 1.8, step: 0.05, defaultValue: 1, digits: 2 },
    { key: "drift", label: "Deriva", min: -2, max: 3, step: 0.1, defaultValue: 1, digits: 1 },
    { key: "turbulence", label: "Turbulencia", min: 0, max: 2, step: 0.05, defaultValue: 0.75, digits: 2 },
    { key: "organicity", label: "Organicidad", min: 0, max: 1, step: 0.05, defaultValue: 1, digits: 2, timeMode: /** @type {"continuous"} */ ("continuous") },
    { key: "vorticity", label: "Vorticidad", min: 0, max: 2, step: 0.05, defaultValue: 1, digits: 2, timeMode: /** @type {"continuous"} */ ("continuous") },
    { key: "fragmentation", label: "Fragmentación", min: 0, max: 2.4, step: 0.05, defaultValue: 1.15, digits: 2 },
    { key: "coverage", label: "Cobertura", min: 0, max: 2, step: 0.05, defaultValue: 0.85, digits: 2 },
    { key: "contrast", label: "Contraste", min: 0.65, max: 3, step: 0.05, defaultValue: 1.7, digits: 2 },
    { key: "minimumFill", label: "Relleno mínimo", min: 0.04, max: 0.35, step: 0.01, defaultValue: 0.16, digits: 2 },
    { key: "maximumFill", label: "Relleno máximo", min: 0.35, max: 0.96, step: 0.01, defaultValue: 0.82, digits: 2 },
    { key: "levels", label: "Niveles de relleno", min: 2, max: 8, step: 1, defaultValue: 4, digits: 0 },
    ...gradientControlDefinitions(0, 0, 0.46)
  ],
  defaults: {
    density: 100,
    scale: 1,
    drift: 1,
    turbulence: 0.75,
    organicity: 1,
    vorticity: 1,
    fragmentation: 1.15,
    coverage: 0.85,
    contrast: 1.7,
    minimumFill: 0.16,
    maximumFill: 0.82,
    levels: 4,
    gradientStrength: 0,
    gradientAngle: 0,
    gradientMidpoint: 0.46
  },
  render,
  toSvg
};
