import assert from "node:assert/strict";
import {
  mobiusShape,
  oddInteger,
  sampleAnimatedMobiusPoint
} from "../src/projects/mobius-core.js";

const TAU = Math.PI * 2;
const SURFACE_SEGMENTS = 192;
const SIDE_SAMPLES = 288;

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

assert.deepEqual([1, 3, 5, 7].map((value) => oddInteger(value, 1, 7)), [1, 3, 5, 7]);
assert.equal(oddInteger(2, 1, 7), 3);
assert.equal(oddInteger(6, 1, 7), 7);

for (const motionMode of [0, 1, 2, 3]) {
  for (const halfTwists of [1, 3, 5, 7]) {
    const frame = {
      seed: 6437,
      elapsedTime: 1.25,
      parameters: {
        halfTwists,
        twistConcentration: 0.7,
        motionMode,
        motionAmount: 0.8,
        motionSpeed: 1.1
      }
    };
    const shape = mobiusShape(frame);
    for (const lane of [-1, -0.5, 0, 0.5, 1]) {
      const first = sampleAnimatedMobiusPoint(frame, 0, -lane, 0, shape).point;
      const last = sampleAnimatedMobiusPoint(frame, TAU, lane, 0, shape).point;
      assert.ok(
        distance(first, last) < 1e-5,
        `surface seam failed for mode ${motionMode}, twists ${halfTwists}, lane ${lane}`
      );

      const beforeSeam = sampleAnimatedMobiusPoint(
        frame,
        TAU * (SURFACE_SEGMENTS - 1) / SURFACE_SEGMENTS,
        lane,
        0,
        shape
      ).point;
      assert.ok(
        distance(beforeSeam, last) < 0.12,
        `surface zipper detected for mode ${motionMode}, twists ${halfTwists}, lane ${lane}`
      );

      const currentStart = sampleAnimatedMobiusPoint(frame, 0, lane, 0, shape).point;
      const currentEnd = sampleAnimatedMobiusPoint(frame, TAU * 2, lane, 0, shape).point;
      assert.ok(
        distance(currentStart, currentEnd) < 1e-5,
        `current closure failed for mode ${motionMode}, twists ${halfTwists}, lane ${lane}`
      );

      let previous = currentStart;
      for (let step = 1; step <= SIDE_SAMPLES; step += 1) {
        const current = sampleAnimatedMobiusPoint(
          frame,
          TAU * 2 * step / SIDE_SAMPLES,
          lane,
          0,
          shape
        ).point;
        assert.ok(
          distance(previous, current) < 0.16,
          `current jump detected for mode ${motionMode}, twists ${halfTwists}, lane ${lane}, step ${step}`
        );
        previous = current;
      }

      assert.ok(first.every(Number.isFinite));
      assert.ok(last.every(Number.isFinite));
    }
  }
}

console.log("Möbius core verified: surface seam, local continuity, current closure and finite bounds.");
