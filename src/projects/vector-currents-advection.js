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

const PROJECT_ID = "vector-currents-advection";
const BACKTRACE_STEPS = 2;
const OPACITY_BINS = 16;

function smoothstep(edge0, edge1, value) {
  const normalized = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function signed(random) {
  return random() < 0.5 ? -1 : 1;
}

function createField(frame) {
  const random = createRandom((frame.seed ^ 0xD1B54A35) >>> 0);
  const scale = parameter(frame, "scale", 1);
  const modes = [];
  const vortices = [];
  const emitters = [];

  for (let index = 0; index < 7; index += 1) {
    const angle = random() * TAU;
    const frequency = scale * (0.42 + random() * 1.35);
    modes.push({
      kx: Math.cos(angle) * frequency,
      ky: Math.sin(angle) * frequency,
      amplitude: (0.11 + random() * 0.21) / frequency,
      rate: signed(random) * (0.11 + random() * 0.33),
      phase: random() * TAU
    });
  }

  for (let index = 0; index < 5; index += 1) {
    vortices.push({
      x: -0.18 + random() * 1.36,
      y: -0.18 + random() * 1.36,
      orbitX: 0.05 + random() * 0.17,
      orbitY: 0.05 + random() * 0.17,
      radius: (0.13 + random() * 0.25) / Math.sqrt(scale),
      strength: signed(random) * (0.18 + random() * 0.46),
      rateX: 0.07 + random() * 0.2,
      rateY: 0.06 + random() * 0.18,
      phaseX: random() * TAU,
      phaseY: random() * TAU
    });
  }

  for (let index = 0; index < 9; index += 1) {
    emitters.push({
      x: -0.28 + random() * 1.56,
      y: -0.28 + random() * 1.56,
      orbitX: 0.06 + random() * 0.24,
      orbitY: 0.06 + random() * 0.24,
      radiusX: (0.11 + random() * 0.25) / Math.sqrt(scale),
      radiusY: (0.1 + random() * 0.27) / Math.sqrt(scale),
      angle: random() * TAU,
      spin: signed(random) * (0.025 + random() * 0.08),
      strength: index % 5 === 4
        ? -(0.28 + random() * 0.35)
        : 0.58 + random() * 0.88,
      rateX: 0.05 + random() * 0.18,
      rateY: 0.06 + random() * 0.17,
      phaseX: random() * TAU,
      phaseY: random() * TAU
    });
  }

  return {
    modes,
    vortices,
    emitters,
    densityPhaseA: random() * TAU,
    densityPhaseB: random() * TAU
  };
}

function sampleVelocity(x, y, time, field, settings) {
  const direction = settings.directionAngle * Math.PI / 180;
  let velocityX = Math.cos(direction) * settings.directionality * 0.42;
  let velocityY = Math.sin(direction) * settings.directionality * 0.42;

  for (const mode of field.modes) {
    const phase = (
      TAU * (mode.kx * x + mode.ky * y) +
      time * settings.motion * mode.rate +
      mode.phase
    );
    const derivative = Math.cos(phase) * mode.amplitude * settings.bend;
    velocityX += mode.ky * derivative;
    velocityY -= mode.kx * derivative;
  }

  for (const vortex of field.vortices) {
    const centerX = vortex.x + vortex.orbitX * Math.sin(
      time * settings.motion * vortex.rateX + vortex.phaseX
    );
    const centerY = vortex.y + vortex.orbitY * Math.cos(
      time * settings.motion * vortex.rateY + vortex.phaseY
    );
    const dx = x - centerX;
    const dy = y - centerY;
    const radiusSquared = vortex.radius * vortex.radius;
    const falloff = Math.exp(
      -(dx * dx + dy * dy) / Math.max(0.000001, radiusSquared)
    );
    const force = settings.vorticity * vortex.strength * falloff /
      Math.max(0.000001, vortex.radius);
    velocityX -= dy * force;
    velocityY += dx * force;
  }

  return [velocityX, velocityY];
}

function advectPoint(x, y, time, deltaTime, field, settings, initialVelocity) {
  const [velocityX, velocityY] = initialVelocity ?? sampleVelocity(
    x,
    y,
    time,
    field,
    settings
  );
  const midpointX = x + velocityX * deltaTime * 0.5;
  const midpointY = y + velocityY * deltaTime * 0.5;
  const [midpointVelocityX, midpointVelocityY] = sampleVelocity(
    midpointX,
    midpointY,
    time + deltaTime * 0.5,
    field,
    settings
  );
  return [
    x + midpointVelocityX * deltaTime,
    y + midpointVelocityY * deltaTime
  ];
}

function sampleSeedDensity(x, y, time, field, settings) {
  let density = 0;

  for (const emitter of field.emitters) {
    const centerX = emitter.x + emitter.orbitX * Math.sin(
      time * settings.motion * emitter.rateX + emitter.phaseX
    );
    const centerY = emitter.y + emitter.orbitY * Math.cos(
      time * settings.motion * emitter.rateY + emitter.phaseY
    );
    const rotation = emitter.angle + time * settings.motion * emitter.spin;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const dx = x - centerX;
    const dy = y - centerY;
    const localX = cosine * dx + sine * dy;
    const localY = -sine * dx + cosine * dy;
    const distance = (
      localX * localX / (emitter.radiusX * emitter.radiusX) +
      localY * localY / (emitter.radiusY * emitter.radiusY)
    );
    density += emitter.strength * Math.exp(-distance * 0.72);
  }

  const waveA = 0.5 + 0.5 * Math.sin(
    TAU * (x * 0.47 - y * 0.33) +
    time * settings.motion * 0.19 +
    field.densityPhaseA
  );
  const waveB = 0.5 + 0.5 * Math.sin(
    TAU * (x * 0.29 + y * 0.53) -
    time * settings.motion * 0.13 +
    field.densityPhaseB
  );
  return density * 0.42 + waveA * 0.12 + waveB * 0.07;
}

function sampleAdvectedEnergy(x, y, time, field, settings) {
  let sampleX = x;
  let sampleY = y;
  let sampleTime = time;
  const stepTime = -settings.memory / BACKTRACE_STEPS;

  for (let step = 0; step < BACKTRACE_STEPS; step += 1) {
    [sampleX, sampleY] = advectPoint(
      sampleX,
      sampleY,
      sampleTime,
      stepTime,
      field,
      settings
    );
    sampleTime += stepTime;
  }

  const localDensity = sampleSeedDensity(x, y, time, field, settings);
  const upstreamDensity = sampleSeedDensity(
    sampleX,
    sampleY,
    sampleTime,
    field,
    settings
  );
  const density = (
    localDensity * (1 - settings.coherence * 0.82) +
    upstreamDensity * (0.18 + settings.coherence * 0.82)
  );
  const threshold = 0.78 - settings.coverage * 0.18;
  const softness = 0.3 / Math.max(0.6, settings.contrast);
  const energy = smoothstep(threshold - softness, threshold + softness, density);
  return Math.pow(energy, Math.max(0.55, settings.contrast * 0.72));
}

function createGeometry(frame) {
  const grid = createFieldGrid(frame, parameter(frame, "density", 48));
  const elapsedTime = Number.isFinite(frame.elapsedTime)
    ? frame.elapsedTime
    : frame.time * 8;
  const settings = {
    bend: parameter(frame, "bend", 1.35),
    vorticity: parameter(frame, "vorticity", 1),
    directionality: parameter(frame, "directionality", 0.28),
    directionAngle: parameter(frame, "directionAngle", 18),
    motion: parameter(frame, "motion", 1),
    memory: parameter(frame, "memory", 0.48),
    coherence: parameter(frame, "coherence", 0.9),
    coverage: parameter(frame, "coverage", 0.9),
    contrast: parameter(frame, "contrast", 1.4)
  };
  const baseLength = grid.cellSize * parameter(frame, "length", 0.82) /
    grid.shortSide;
  const field = createField(frame);
  const values = new Float32Array(grid.columns * grid.rows * 7);
  let offset = 0;

  for (let row = 0; row < grid.rows; row += 1) {
    const screenY = (row + 0.5) * grid.cellHeight;
    const worldY = grid.worldTop + (row + 0.5) * grid.worldCellHeight;
    for (let column = 0; column < grid.columns; column += 1) {
      const screenX = (column + 0.5) * grid.cellWidth;
      const worldX = grid.worldLeft + (column + 0.5) * grid.worldCellWidth;
      const velocity = sampleVelocity(
        worldX,
        worldY,
        elapsedTime,
        field,
        settings
      );
      const magnitude = Math.max(0.0001, Math.hypot(velocity[0], velocity[1]));
      const energy = sampleAdvectedEnergy(
        worldX,
        worldY,
        elapsedTime,
        field,
        settings
      );
      const displayEnergy = Math.pow(energy, 1.9);
      const halfLength = baseLength * (0.18 + displayEnergy * 0.92) * 0.5;
      const travelTime = clamp(halfLength / magnitude, 0.003, 0.16);
      const start = advectPoint(
        worldX,
        worldY,
        elapsedTime,
        -travelTime,
        field,
        settings,
        velocity
      );
      const end = advectPoint(
        worldX,
        worldY,
        elapsedTime,
        travelTime,
        field,
        settings,
        velocity
      );
      const startX = screenX + (start[0] - worldX) * grid.shortSide;
      const startY = screenY + (start[1] - worldY) * grid.shortSide;
      const endX = screenX + (end[0] - worldX) * grid.shortSide;
      const endY = screenY + (end[1] - worldY) * grid.shortSide;

      values[offset] = startX;
      values[offset + 1] = startY;
      values[offset + 2] = screenX * 2 - (startX + endX) * 0.5;
      values[offset + 3] = screenY * 2 - (startY + endY) * 0.5;
      values[offset + 4] = endX;
      values[offset + 5] = endY;
      values[offset + 6] = 0.018 + displayEnergy * 0.982;
      offset += 7;
    }
  }

  return {
    values,
    strokeWidth: parameter(frame, "stroke", 1.2) * shortSideScale(frame)
  };
}

function opacityBin(value) {
  return Math.min(OPACITY_BINS - 1, Math.floor(value * OPACITY_BINS));
}

function render(context, frame) {
  const geometry = createGeometry(frame);
  if (!frame.transparent) {
    context.fillStyle = frame.palette.background;
    context.fillRect(0, 0, frame.width, frame.height);
  }

  context.save();
  context.strokeStyle = canvasGradientStyle(context, frame, appearanceParameters(frame));
  context.lineWidth = geometry.strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (let bin = 0; bin < OPACITY_BINS; bin += 1) {
    context.globalAlpha = (bin + 0.35) / OPACITY_BINS;
    context.beginPath();
    for (let index = 0; index < geometry.values.length; index += 7) {
      if (opacityBin(geometry.values[index + 6]) !== bin) continue;
      context.moveTo(geometry.values[index], geometry.values[index + 1]);
      context.quadraticCurveTo(
        geometry.values[index + 2],
        geometry.values[index + 3],
        geometry.values[index + 4],
        geometry.values[index + 5]
      );
    }
    context.stroke();
  }
  context.restore();
}

function toSvg(frame) {
  const geometry = createGeometry(frame);
  const gradient = svgGradientDefinition(
    frame,
    appearanceParameters(frame),
    "vector-currents-advection-gradient"
  );
  const paths = Array.from({ length: OPACITY_BINS }, () => []);

  for (let index = 0; index < geometry.values.length; index += 7) {
    const bin = opacityBin(geometry.values[index + 6]);
    paths[bin].push(
      `M${geometry.values[index].toFixed(2)} ${geometry.values[index + 1].toFixed(2)}` +
      `Q${geometry.values[index + 2].toFixed(2)} ${geometry.values[index + 3].toFixed(2)} ` +
      `${geometry.values[index + 4].toFixed(2)} ${geometry.values[index + 5].toFixed(2)}`
    );
  }

  const currents = paths.map((segments, bin) => {
    if (segments.length === 0) return "";
    const opacity = (bin + 0.35) / OPACITY_BINS;
    return `<path d="${segments.join("")}" stroke-opacity="${opacity.toFixed(3)}"/>`;
  }).join("");
  const background = frame.transparent
    ? ""
    : `<rect width="${frame.width}" height="${frame.height}" fill="${frame.palette.background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><title>Cauce 02.1 — Vector Currents Advection</title>${gradient.definition}${background}<g fill="none" stroke="${gradient.paint}" stroke-width="${geometry.strokeWidth.toFixed(3)}" stroke-linecap="round" stroke-linejoin="round">${currents}</g></svg>`;
}

export const vectorCurrentsAdvectionProject = {
  id: PROJECT_ID,
  index: "02.1",
  name: "Vector Currents Advection",
  label: "Cauce — Vector Currents Advection",
  description: "Corrientes curvas transportan densidad mediante una advección continua de memoria finita.",
  preferredFps: 60,
  preferredFormatKey: "square",
  preferredLoopSeconds: 8,
  preferredPlaybackMode: /** @type {"continuous"} */ ("continuous"),
  supportsContinuousTime: true,
  supportsLoopTime: false,
  controls: [
    { key: "density", label: "Densidad", min: 32, max: 86, step: 1, defaultValue: 48, digits: 0 },
    { key: "scale", label: "Escala del campo", min: 0.5, max: 2.1, step: 0.05, defaultValue: 1, digits: 2 },
    { key: "bend", label: "Curvatura", min: 0, max: 2.8, step: 0.05, defaultValue: 1.35, digits: 2 },
    { key: "vorticity", label: "Vorticidad", min: 0, max: 2.2, step: 0.05, defaultValue: 1, digits: 2 },
    { key: "directionality", label: "Dirección dominante", min: 0, max: 1.5, step: 0.05, defaultValue: 0.28, digits: 2 },
    { key: "directionAngle", label: "Ángulo del cauce", min: -180, max: 180, step: 1, defaultValue: 18, digits: 0, suffix: "°" },
    { key: "motion", label: "Velocidad orgánica", min: -2, max: 3, step: 0.05, defaultValue: 1, digits: 2 },
    { key: "memory", label: "Memoria de advección", min: 0.05, max: 1.2, step: 0.05, defaultValue: 0.48, digits: 2 },
    { key: "coherence", label: "Coherencia", min: 0, max: 1, step: 0.05, defaultValue: 0.9, digits: 2 },
    { key: "coverage", label: "Cobertura", min: 0, max: 1.8, step: 0.05, defaultValue: 0.9, digits: 2 },
    { key: "contrast", label: "Contraste", min: 0.55, max: 2.8, step: 0.05, defaultValue: 1.4, digits: 2 },
    { key: "length", label: "Longitud", min: 0.3, max: 1.4, step: 0.05, defaultValue: 0.82, digits: 2 },
    ...gradientControlDefinitions(0, 0, 0.46),
    { key: "stroke", label: "Trazo", min: 0.45, max: 2.4, step: 0.05, defaultValue: 1.2, digits: 2, group: "appearance" }
  ],
  defaults: {
    density: 48,
    scale: 1,
    bend: 1.35,
    vorticity: 1,
    directionality: 0.28,
    directionAngle: 18,
    motion: 1,
    memory: 0.48,
    coherence: 0.9,
    coverage: 0.9,
    contrast: 1.4,
    length: 0.82,
    gradientStrength: 0,
    gradientAngle: 0,
    gradientMidpoint: 0.46,
    stroke: 1.2
  },
  render,
  toSvg
};
