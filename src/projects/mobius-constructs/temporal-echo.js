import { clamp, parameter, positiveModulo } from "../shared.js";

export function temporalEchoSettings(frame) {
  if (parameter(frame, "echoEnabled", 0) < 0.5) {
    return { count: 1, spacing: 0, persistence: 1 };
  }

  return {
    count: Math.round(clamp(parameter(frame, "echoCount", 3), 1, 8)),
    spacing: clamp(parameter(frame, "echoSpacing", 4), 0, 20) / 100,
    persistence: clamp(parameter(frame, "echoPersistence", 0.62), 0.08, 0.92)
  };
}

export function temporalEchoFrame(frame, echoIndex, spacing) {
  const offset = echoIndex * spacing;
  return {
    ...frame,
    time: positiveModulo(frame.time - offset, 1),
    elapsedTime: frame.elapsedTime - offset
  };
}
