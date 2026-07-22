import { clamp } from "./shared.js";

export const MOBIUS_SHAPE_DEFAULTS = Object.freeze({
  majorRadius: 1,
  width: 0.46,
  halfTwists: 1,
  handedness: 1,
  twistPhase: 0,
  twistPosition: 0,
  twistConcentration: 0,
  ellipticity: 1,
  flattening: 1,
  widthVariation: 0
});

export const MOBIUS_MOTION_MODES = Object.freeze([
  { value: 0, label: "Circulación" },
  { value: 1, label: "Onda viajera" },
  { value: 2, label: "Contracción localizada" },
  { value: 3, label: "Deriva orgánica" }
]);

export function oddInteger(value, fallback = 1, maximum = 7) {
  const safeValue = Number.isFinite(value) ? value : fallback;
  const rounded = Math.max(1, Math.round((safeValue - 1) / 2) * 2 + 1);
  return clamp(rounded, 1, maximum) | 1;
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function readParameter(source, key, fallback) {
  const parameters = source?.parameters ?? source ?? {};
  const value = parameters[key];
  return Number.isFinite(value) ? value : fallback;
}

export function mobiusShape(frame) {
  const parameters = frame?.parameters ?? frame ?? {};
  return {
    majorRadius: clamp(finite(readParameter(parameters, "majorRadius", MOBIUS_SHAPE_DEFAULTS.majorRadius), 1), 0.65, 1.5),
    width: clamp(finite(readParameter(parameters, "width", MOBIUS_SHAPE_DEFAULTS.width), 0.46), 0.08, 0.72),
    halfTwists: oddInteger(readParameter(parameters, "halfTwists", 1), 1, 7),
    handedness: readParameter(parameters, "handedness", 1) < 0 ? -1 : 1,
    twistPhase: finite(readParameter(parameters, "twistPhase", 0), 0) * Math.PI / 180,
    twistPosition: finite(readParameter(parameters, "twistPosition", 0), 0) * Math.PI / 180,
    twistConcentration: clamp(finite(readParameter(parameters, "twistConcentration", 0), 0), 0, 0.82),
    ellipticity: clamp(finite(readParameter(parameters, "ellipticity", 1), 1), 0.72, 1.32),
    flattening: clamp(finite(readParameter(parameters, "flattening", 1), 1), 0.5, 1.35),
    widthVariation: clamp(finite(readParameter(parameters, "widthVariation", 0), 0), 0, 0.24)
  };
}

export function motionSettings(frame, cycle = 0) {
  const parameters = frame?.parameters ?? frame ?? {};
  const motionMode = Math.round(clamp(readParameter(parameters, "motionMode", 0), 0, 3));
  const speed = clamp(readParameter(parameters, "motionSpeed", 1), 0, 4);
  const amount = clamp(readParameter(parameters, "motionAmount", 0.24), 0, 1);
  const circulation = Math.round(clamp(readParameter(parameters, "circulation", 1), 0, 4));
  const breathing = clamp(readParameter(parameters, "breathing", 0.06), 0, 0.25);
  const seed = finite(frame?.seed, 0) * 0.000017;
  const time = finite(frame?.elapsedTime, cycle) * speed;
  return { motionMode, speed, amount, circulation, breathing, seed, time };
}

export function motionSample(frame, u, cycle = 0, shape = mobiusShape(frame)) {
  const settings = motionSettings(frame, cycle);
  const basePhase = settings.circulation * cycle * 0.5;
  const phaseWave = settings.amount * 0.28 * Math.sin(
    u - settings.time * 0.9 + settings.seed
  );
  const travellingWave = settings.amount * 0.14 * Math.sin(
    u * 0.5 - settings.time * 1.35 + settings.seed * 2.1
  );
  let phaseOffset = basePhase;
  let widthScale = 1 + settings.breathing * Math.sin(cycle);
  let vOffset = 0;

  if (settings.motionMode === 1) {
    phaseOffset += phaseWave;
    vOffset = travellingWave * shape.width;
  } else if (settings.motionMode === 2) {
    const focus = settings.time * 0.48 + settings.seed;
    const wrappedDistance = 1 - Math.cos(u - focus);
    const localized = Math.exp(-wrappedDistance * 8) * Math.sin(settings.time * 0.9);
    widthScale *= 1 - localized * settings.amount * 0.34;
    phaseOffset += localized * settings.amount * 0.25;
  } else if (settings.motionMode === 3) {
    phaseOffset += settings.amount * 0.18 * (
      Math.sin(u - settings.time * 0.34 + settings.seed) +
      0.42 * Math.sin(u * 2 + settings.time * 0.21)
    );
    vOffset = settings.amount * shape.width * 0.11 * Math.sin(
      u * 0.5 - settings.time * 0.48 + settings.seed
    );
    widthScale *= 1 + settings.amount * 0.045 * Math.sin(u + settings.time * 0.31);
  }

  widthScale *= 1 + shape.widthVariation * Math.sin(u - shape.twistPosition);
  return {
    phase: phaseOffset,
    widthScale: Math.max(0.56, widthScale),
    vOffset
  };
}

export function crossSectionAngle(u, shape, phase = 0) {
  // The sinusoidal term redistributes the twist but integrates to zero over the seam.
  // The odd half-turn remains the invariant that closes a Möbius band.
  return shape.handedness * (
    shape.halfTwists * u * 0.5 +
    shape.twistConcentration * Math.sin(u - shape.twistPosition)
  ) + shape.twistPhase + phase;
}

export function writeMobiusPoint(target, offset, u, v, shape, phase = 0) {
  const crossSection = crossSectionAngle(u, shape, phase);
  const distance = shape.majorRadius + v * Math.cos(crossSection);
  target[offset] = distance * Math.cos(u) * shape.ellipticity;
  target[offset + 1] = distance * Math.sin(u) / shape.ellipticity;
  target[offset + 2] = v * Math.sin(crossSection) * shape.flattening;
}

export function writeAnimatedMobiusPoint(
  target,
  offset,
  frame,
  u,
  normalizedV,
  cycle = 0,
  shape = mobiusShape(frame),
  motion = motionSample(frame, u, cycle, shape)
) {
  const width = shape.width * motion.widthScale;
  writeMobiusPoint(
    target,
    offset,
    u,
    normalizedV * width + motion.vOffset,
    shape,
    motion.phase
  );
  return { motion, width };
}

export function sampleMobiusPoint(u, v, shape, phase = 0) {
  const point = [0, 0, 0];
  writeMobiusPoint(point, 0, u, v, shape, phase);
  return point;
}

export function sampleAnimatedMobiusPoint(frame, u, normalizedV, cycle, shape = mobiusShape(frame)) {
  const point = [0, 0, 0];
  const sample = writeAnimatedMobiusPoint(point, 0, frame, u, normalizedV, cycle, shape);
  return { point, ...sample };
}
