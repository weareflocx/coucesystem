import { clamp } from "./shared.js";

export const MOBIUS_SHAPE_DEFAULTS = Object.freeze({
  majorRadius: 1,
  bandWidth: 0.92,
  halfTwists: 1,
  handedness: 1,
  twistPhase: 0,
  twistPosition: 0,
  twistDistribution: 0,
  twistExtent: 0.28,
  twistIntensity: 0,
  ellipticity: 1,
  flattening: 1,
  widthVariation: 0,
  profileMode: 0,
  profileAmount: 0,
  profileFrequency: 3,
  thickness: 0,
  edgeRoundness: 0.35
});

export const MOBIUS_TWIST_DISTRIBUTIONS = Object.freeze([
  { value: 0, label: "Uniforme", description: "Reparte la torsión por todo el recorrido." },
  { value: 1, label: "Localizada", description: "Concentra la torsión en una zona controlable." },
  { value: 2, label: "Doble", description: "Crea dos zonas de torsión opuestas." },
  { value: 3, label: "Ondulada", description: "Alterna suavemente zonas tensas y relajadas." }
]);

export const MOBIUS_PROFILE_MODES = Object.freeze([
  { value: 0, label: "Plano", description: "Mantiene una sección de cinta plana." },
  { value: 1, label: "Abombado", description: "Eleva el centro con una curva suave." },
  { value: 2, label: "Plegado", description: "Forma una arista longitudinal central." },
  { value: 3, label: "Corrugado", description: "Añade pliegues repetidos a lo ancho." }
]);

const TAU = Math.PI * 2;
const TWIST_LUT_SAMPLES = 256;
const twistLutCache = new Map();

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

function hasParameter(source, key) {
  const parameters = source?.parameters ?? source ?? {};
  return Number.isFinite(parameters[key]);
}

function positiveModulo(value, modulus = 1) {
  const remainder = value % modulus;
  return remainder < 0 ? remainder + modulus : remainder;
}

function wrappedUnitDistance(left, right) {
  const difference = Math.abs(positiveModulo(left - right + 0.5) - 0.5);
  return Math.min(0.5, difference);
}

function twistDensity(position, distribution, center, extent, intensity) {
  if (distribution === 0 || intensity <= 0.0001) return 1;
  const safeIntensity = clamp(intensity, 0, 1);
  const baseline = 1 - safeIntensity * 0.94;
  const sigma = Math.max(0.018, extent * 0.42);
  const gaussian = (location) => {
    const distance = wrappedUnitDistance(position, location);
    return Math.exp(-0.5 * (distance / sigma) ** 2);
  };
  if (distribution === 1) {
    return baseline + safeIntensity * 4 * gaussian(center);
  }
  if (distribution === 2) {
    return baseline + safeIntensity * 2.4 * (
      gaussian(center) + gaussian(positiveModulo(center + 0.5))
    );
  }
  const firstHarmonic = Math.cos(TAU * (position - center));
  const secondHarmonic = Math.cos(TAU * 2 * (position - center));
  const sharpness = 1 - clamp((extent - 0.08) / 0.72, 0, 1);
  return Math.max(
    0.04,
    1 + safeIntensity * (firstHarmonic * 0.72 + secondHarmonic * sharpness * 0.22)
  );
}

function twistLut(distribution, center, extent, intensity) {
  const key = [distribution, center, extent, intensity]
    .map((value) => Number(value).toFixed(5))
    .join(":");
  const cached = twistLutCache.get(key);
  if (cached) return cached;
  const values = new Float32Array(TWIST_LUT_SAMPLES + 1);
  let total = 0;
  for (let index = 0; index < TWIST_LUT_SAMPLES; index += 1) {
    const position = (index + 0.5) / TWIST_LUT_SAMPLES;
    total += twistDensity(position, distribution, center, extent, intensity);
    values[index + 1] = total;
  }
  const divisor = total || 1;
  for (let index = 1; index <= TWIST_LUT_SAMPLES; index += 1) {
    values[index] /= divisor;
  }
  if (twistLutCache.size >= 64) twistLutCache.delete(twistLutCache.keys().next().value);
  twistLutCache.set(key, values);
  return values;
}

function twistDetail(values) {
  let maximum = 1;
  for (let index = 0; index < TWIST_LUT_SAMPLES; index += 1) {
    maximum = Math.max(
      maximum,
      (values[index + 1] - values[index]) * TWIST_LUT_SAMPLES
    );
  }
  return maximum;
}

export function mobiusShape(frame) {
  const parameters = frame?.parameters ?? frame ?? {};
  const legacyWidth = readParameter(parameters, "width", 0.46);
  const bandWidth = hasParameter(parameters, "bandWidth")
    ? readParameter(parameters, "bandWidth", MOBIUS_SHAPE_DEFAULTS.bandWidth)
    : legacyWidth * 2;
  const legacyConcentration = clamp(readParameter(parameters, "twistConcentration", 0), 0, 0.82);
  const distribution = hasParameter(parameters, "twistDistribution")
    ? Math.round(clamp(readParameter(parameters, "twistDistribution", 0), 0, 3))
    : legacyConcentration > 0.0001 ? 1 : 0;
  const twistIntensity = hasParameter(parameters, "twistIntensity")
    ? clamp(readParameter(parameters, "twistIntensity", 0), 0, 1)
    : legacyConcentration / 0.82;
  const twistPosition = finite(readParameter(parameters, "twistPosition", 0), 0);
  const twistExtent = clamp(readParameter(parameters, "twistExtent", 0.28), 0.08, 0.8);
  const center = positiveModulo(twistPosition / 360);
  const twistProgressLut = twistLut(distribution, center, twistExtent, twistIntensity);
  return {
    majorRadius: clamp(finite(readParameter(parameters, "majorRadius", MOBIUS_SHAPE_DEFAULTS.majorRadius), 1), 0.65, 1.5),
    bandWidth: clamp(finite(bandWidth, MOBIUS_SHAPE_DEFAULTS.bandWidth), 0.32, 1.44),
    width: clamp(finite(bandWidth, MOBIUS_SHAPE_DEFAULTS.bandWidth) * 0.5, 0.16, 0.72),
    halfTwists: oddInteger(readParameter(parameters, "halfTwists", 1), 1, 15),
    handedness: readParameter(parameters, "handedness", 1) < 0 ? -1 : 1,
    twistPhase: finite(readParameter(parameters, "twistPhase", 0), 0) * Math.PI / 180,
    twistPosition: twistPosition * Math.PI / 180,
    twistDistribution: distribution,
    twistExtent,
    twistIntensity,
    twistProgressLut,
    twistDetail: twistDetail(twistProgressLut),
    ellipticity: clamp(finite(readParameter(parameters, "ellipticity", 1), 1), 0.72, 1.32),
    flattening: clamp(finite(readParameter(parameters, "flattening", 1), 1), 0.5, 1.35),
    widthVariation: clamp(finite(readParameter(parameters, "widthVariation", 0), 0), 0, 0.24),
    profileMode: Math.round(clamp(readParameter(parameters, "profileMode", 0), 0, 3)),
    profileAmount: clamp(readParameter(parameters, "profileAmount", 0), 0, 0.45),
    profileFrequency: Math.round(clamp(readParameter(parameters, "profileFrequency", 3), 1, 9)),
    thickness: clamp(readParameter(parameters, "thickness", 0), 0, 0.18),
    edgeRoundness: clamp(readParameter(parameters, "edgeRoundness", 0.35), 0, 1)
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
  return shape.handedness * shape.halfTwists * Math.PI * twistProgress(u / TAU, shape) +
    shape.twistPhase + phase;
}

export function twistProgress(turn, shape) {
  const cycle = Math.floor(turn);
  const local = positiveModulo(turn);
  const scaled = local * TWIST_LUT_SAMPLES;
  const index = Math.min(TWIST_LUT_SAMPLES - 1, Math.floor(scaled));
  const mix = scaled - index;
  const lut = shape.twistProgressLut;
  return cycle + lut[index] + (lut[index + 1] - lut[index]) * mix;
}

function normalize3(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

export function mobiusFrame(u, shape, phase = 0) {
  const cosineU = Math.cos(u);
  const sineU = Math.sin(u);
  const angle = crossSectionAngle(u, shape, phase);
  const cosineCrossSection = Math.cos(angle);
  const sineCrossSection = Math.sin(angle);
  const tangent = normalize3(
    -shape.majorRadius * sineU * shape.ellipticity,
    shape.majorRadius * cosineU / shape.ellipticity,
    0
  );
  const across = normalize3(
    cosineCrossSection * cosineU * shape.ellipticity,
    cosineCrossSection * sineU / shape.ellipticity,
    sineCrossSection * shape.flattening
  );
  const normal = normalize3(
    tangent[1] * across[2] - tangent[2] * across[1],
    tangent[2] * across[0] - tangent[0] * across[2],
    tangent[0] * across[1] - tangent[1] * across[0]
  );
  return { cosineU, sineU, angle, tangent, across, normal };
}

export function profileHeight(u, normalizedV, shape) {
  const v = clamp(normalizedV, -1, 1);
  const amount = shape.profileAmount * shape.width;
  if (shape.profileMode === 1) {
    return amount * (1 - v * v) * Math.cos(u * 0.5 - shape.twistPosition * 0.5);
  }
  if (shape.profileMode === 2) {
    return amount * (1 - Math.abs(v)) * Math.cos(u * 0.5 - shape.twistPosition * 0.5);
  }
  if (shape.profileMode === 3) {
    return amount * Math.sin(shape.profileFrequency * Math.PI * v);
  }
  return 0;
}

export function writeMobiusPoint(
  target,
  offset,
  u,
  v,
  shape,
  phase = 0,
  normalizedV = null,
  normalOffset = 0
) {
  const frame = mobiusFrame(u, shape, phase);
  const crossSection = frame.angle;
  const distance = shape.majorRadius + v * Math.cos(crossSection);
  const profileV = normalizedV ?? v / Math.max(0.0001, shape.width);
  const height = profileHeight(u, profileV, shape);
  const profileOffset = height + normalOffset;
  target[offset] = distance * frame.cosineU * shape.ellipticity + frame.normal[0] * profileOffset;
  target[offset + 1] = distance * frame.sineU / shape.ellipticity + frame.normal[1] * profileOffset;
  target[offset + 2] = v * Math.sin(crossSection) * shape.flattening + frame.normal[2] * profileOffset;
}

export function writeAnimatedMobiusPoint(
  target,
  offset,
  frame,
  u,
  normalizedV,
  cycle = 0,
  shape = mobiusShape(frame),
  motion = motionSample(frame, u, cycle, shape),
  normalOffset = 0
) {
  const width = shape.width * motion.widthScale;
  writeMobiusPoint(
    target,
    offset,
    u,
    normalizedV * width + motion.vOffset,
    shape,
    motion.phase,
    normalizedV,
    normalOffset
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
