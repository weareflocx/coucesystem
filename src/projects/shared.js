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
