import { TAU, clamp, parameter, positiveModulo } from "../shared.js";

export const MOBIUS_WIDTH_RHYTHMS = Object.freeze([
  { value: 1, label: "Pulso" },
  { value: 2, label: "Doble" },
  { value: 3, label: "Ondulado" }
]);

function wrappedAngle(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

export function widthRhythmScale(frame, u) {
  if (parameter(frame, "widthRhythmEnabled", 1) < 0.5) return 1;

  const mode = Math.round(clamp(parameter(frame, "widthRhythmMode", 0), 0, 3));
  if (mode === 0) return 1;
  const amount = clamp(parameter(frame, "widthRhythmAmount", 0.38), 0, 0.72);
  const position = parameter(frame, "widthRhythmPosition", 0) * Math.PI / 180;
  const speed = parameter(frame, "widthRhythmSpeed", 0.3);
  const phase = u - position - positiveModulo(frame.time, 1) * TAU * speed;
  let wave = 0;
  if (mode === 1) {
    const distance = wrappedAngle(phase) / 0.72;
    wave = Math.exp(-distance * distance) * 1.08 - 0.2;
  } else if (mode === 2) {
    wave = Math.pow(0.5 + 0.5 * Math.cos(phase * 2), 3) * 1.2 - 0.35;
  } else {
    const lobes = Math.round(clamp(parameter(frame, "widthRhythmLobes", 5), 1, 12));
    wave = Math.sin(phase * lobes) * 0.72;
  }
  return clamp(1 + amount * wave, 0.24, 1.78);
}
