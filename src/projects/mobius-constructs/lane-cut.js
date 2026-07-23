import { clamp, parameter } from "../shared.js";

export function constructLaneIntervals(count, gap) {
  const laneCount = Math.round(clamp(count, 1, 5));
  const slot = 2 / laneCount;
  const gapRatio = laneCount === 1 ? 0 : clamp(gap, 0, 0.72);
  const inset = slot * gapRatio * 0.5;
  return Array.from({ length: laneCount }, (_, index) => ({
    start: -1 + index * slot + inset,
    end: -1 + (index + 1) * slot - inset
  }));
}

export function laneCutSettings(frame) {
  if (parameter(frame, "laneCutEnabled", 0) < 0.5) {
    return {
      count: 1,
      gap: 0,
      lanes: constructLaneIntervals(1, 0)
    };
  }

  const count = Math.round(clamp(parameter(frame, "laneCount", 3), 1, 5));
  const gap = clamp(parameter(frame, "laneGap", 0.18), 0, 0.72);
  return { count, gap, lanes: constructLaneIntervals(count, gap) };
}
