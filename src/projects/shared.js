export const TAU = Math.PI * 2;

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

export function createRandom(seed) {
  let state = seed >>> 0;

  return function random() {
    state += 0x6D2B79F5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function parameter(frame, key, fallback) {
  const value = frame.parameters[key];
  return Number.isFinite(value) ? value : fallback;
}

function parseHexColor(value, fallback) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return fallback;
  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16)
  ];
}

function toHexChannel(value) {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
}

export function mixHexColors(from, to, amount) {
  const start = parseHexColor(from, [244, 243, 238]);
  const end = parseHexColor(to, start);
  const mix = clamp(amount, 0, 1);
  return `#${toHexChannel(start[0] + (end[0] - start[0]) * mix)}${toHexChannel(start[1] + (end[1] - start[1]) * mix)}${toHexChannel(start[2] + (end[2] - start[2]) * mix)}`;
}

export function paletteAccent(frame) {
  return typeof frame.palette.accent === "string"
    ? frame.palette.accent
    : frame.palette.foreground;
}

export function appearanceParameters(frame) {
  return {
    gradientStrength: clamp(parameter(frame, "gradientStrength", 0), 0, 1),
    gradientAngle: parameter(frame, "gradientAngle", 0) * Math.PI / 180,
    textureMode: clamp(Math.round(parameter(frame, "textureMode", 0)), 0, 2),
    textureScale: clamp(Math.round(parameter(frame, "textureScale", 4)), 1, 12),
    textureStrength: clamp(parameter(frame, "textureStrength", 0), 0, 1),
    textureMotion: clamp(Math.round(parameter(frame, "textureMotion", 1)), -4, 4)
  };
}

function hashUnit(value) {
  let state = value >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x7feb352d);
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b);
  return ((state ^ (state >>> 16)) >>> 0) / 4294967295;
}

export function appearanceSample(frame, u, suppliedAppearance) {
  const appearance = suppliedAppearance ?? appearanceParameters(frame);
  const normalizedU = positiveModulo(u, 1);
  const gradientWave = 0.5 - 0.5 * Math.cos(normalizedU * TAU - appearance.gradientAngle);
  let textureTone = 1;

  if (appearance.textureMode === 1) {
    const movement = positiveModulo(frame.time, 1) * appearance.textureMotion;
    textureTone = 0.5 + 0.5 * Math.cos(
      TAU * (normalizedU * appearance.textureScale - movement)
    );
  } else if (appearance.textureMode === 2) {
    const cell = Math.floor(normalizedU * appearance.textureScale * 32);
    textureTone = 0.3 + 0.7 * hashUnit((frame.seed >>> 0) ^ Math.imul(cell + 1, 0x9e3779b1));
  }

  return {
    gradientMix: appearance.gradientStrength * gradientWave,
    textureDim: appearance.textureStrength * (1 - textureTone) * 0.78
  };
}

export function appearanceColor(frame, sample, fromColor = frame.palette.foreground, toColor = paletteAccent(frame)) {
  const gradientColor = mixHexColors(fromColor, toColor, sample.gradientMix);
  return mixHexColors(gradientColor, frame.palette.background, sample.textureDim);
}
