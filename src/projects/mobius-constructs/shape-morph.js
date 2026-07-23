import { TAU, clamp, parameter, positiveModulo } from "../shared.js";

export const MOBIUS_MORPH_MODES = Object.freeze([
  { value: 0, label: "Mezcla manual" },
  { value: 1, label: "Loop A / B" }
]);

export function constructMorphProgress(frame) {
  if (parameter(frame, "morphEnabled", 0) < 0.5) return 0;

  const mode = Math.round(clamp(parameter(frame, "morphMode", 0), 0, 1));
  if (mode === 0) return clamp(parameter(frame, "morphMix", 0.5), 0, 1);
  const speed = clamp(parameter(frame, "morphSpeed", 1), 0.1, 3);
  return 0.5 - 0.5 * Math.cos(positiveModulo(frame.time, 1) * TAU * speed);
}

export function mobiusMorphShape(frame, baseShape) {
  const bandWidth = clamp(parameter(frame, "morphBandWidth", 0.58), 0.32, 1.44);
  return {
    ...baseShape,
    majorRadius: clamp(parameter(frame, "morphMajorRadius", 1.2), 0.65, 1.5),
    bandWidth,
    width: bandWidth * 0.5,
    ellipticity: clamp(parameter(frame, "morphEllipticity", 1.2), 0.72, 1.32),
    flattening: clamp(parameter(frame, "morphFlattening", 0.72), 0.5, 1.35),
    profileAmount: clamp(parameter(frame, "morphProfileAmount", 0.32), 0, 0.45),
    thickness: 0
  };
}

export function interpolateMobiusPoint(from, to, amount) {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount
  ];
}
