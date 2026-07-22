import assert from "node:assert/strict";
import * as THREE from "three";
import {
  mobiusShape,
  oddInteger,
  sampleAnimatedMobiusPoint,
  twistProgress
} from "../src/projects/mobius-core.js";
import {
  createMobiusVolumeIndices,
  MOBIUS_MAX_SURFACE_SEGMENTS,
  mobiusPreviewTessellation,
  mobiusTessellation,
  writeMobiusVolumePositions
} from "../src/projects/mobius-geometry.js";
import {
  createMobiusSurfaceGeometry,
  createMobiusVolumeGeometry,
  mobiusFlow11Project
} from "../src/projects/mobius-flow-1-1.js";

const TAU = Math.PI * 2;

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

assert.deepEqual(
  [1, 3, 5, 7, 9, 11, 13, 15].map((value) => oddInteger(value, 1, 15)),
  [1, 3, 5, 7, 9, 11, 13, 15]
);
assert.equal(oddInteger(2, 1, 15), 3);
assert.equal(oddInteger(14, 1, 15), 15);
assert.equal(
  mobiusFlow11Project.controls.find((control) => control.key === "halfTwists")?.max,
  15
);

for (const distribution of [0, 1, 2, 3]) {
  for (const halfTwists of [1, 3, 5, 7, 9, 11, 13, 15]) {
    const progressFrame = {
      width: 1000,
      height: 1000,
      parameters: {
        halfTwists,
        twistDistribution: distribution,
        twistPosition: 47,
        twistExtent: 0.16,
        twistIntensity: 0.94
      }
    };
    const progressShape = mobiusShape(progressFrame);
    let previousProgress = twistProgress(0, progressShape);
    assert.equal(previousProgress, 0);
    for (let step = 1; step <= 512; step += 1) {
      const currentProgress = twistProgress(step / 512, progressShape);
      assert.ok(
        currentProgress >= previousProgress,
        `twist progress reversed for distribution ${distribution}, twists ${halfTwists}`
      );
      previousProgress = currentProgress;
    }
    assert.equal(twistProgress(1, progressShape), 1);
    assert.ok(
      twistProgress(1 - Number.EPSILON, progressShape) > 0.999,
      `twist progress wrapped before the seam for distribution ${distribution}`
    );
  }
}

for (const motionMode of [0, 1, 2, 3]) {
  for (const distribution of [0, 1, 2, 3]) {
    for (const profileMode of [0, 1, 2, 3]) {
      for (const halfTwists of [1, 7, 15]) {
        const frame = {
          width: 1000,
          height: 1000,
          seed: 6437,
          elapsedTime: 1.25,
          parameters: {
            halfTwists,
            twistDistribution: distribution,
            twistPosition: -63,
            twistExtent: 0.18,
            twistIntensity: 0.9,
            profileMode,
            profileAmount: 0.32,
            profileFrequency: 7,
            motionMode,
            motionAmount: 0.8,
            motionSpeed: 1.1
          }
        };
        const shape = mobiusShape(frame);
        const tessellation = mobiusTessellation(frame, shape);
        for (const lane of [-1, -0.5, 0, 0.5, 1]) {
          const first = sampleAnimatedMobiusPoint(frame, 0, -lane, 0, shape).point;
          const last = sampleAnimatedMobiusPoint(frame, TAU, lane, 0, shape).point;
          assert.ok(
            distance(first, last) < 1e-5,
            `surface seam failed for motion ${motionMode}, distribution ${distribution}, ` +
            `profile ${profileMode}, twists ${halfTwists}, lane ${lane}`
          );

          const beforeSeam = sampleAnimatedMobiusPoint(
            frame,
            TAU * (tessellation.surfaceSegments - 1) / tessellation.surfaceSegments,
            lane,
            0,
            shape
          ).point;
          const seamPoint = sampleAnimatedMobiusPoint(frame, TAU, lane, 0, shape).point;
          assert.ok(
            distance(beforeSeam, seamPoint) < 0.12,
            `adaptive surface resolution failed for distribution ${distribution}, ` +
            `profile ${profileMode}, twists ${halfTwists}`
          );

          const currentStart = sampleAnimatedMobiusPoint(frame, 0, lane, 0, shape).point;
          const currentEnd = sampleAnimatedMobiusPoint(frame, TAU * 2, lane, 0, shape).point;
          assert.ok(
            distance(currentStart, currentEnd) < 1e-5,
            `current closure failed for profile ${profileMode}, twists ${halfTwists}, lane ${lane}`
          );
          assert.ok(first.every(Number.isFinite));
          assert.ok(last.every(Number.isFinite));
        }
      }
    }
  }
}

const lowDetail = mobiusTessellation({
  width: 1000,
  height: 1000,
  parameters: { halfTwists: 1 }
});
const highDetail = mobiusTessellation({
  width: 1000,
  height: 1000,
  parameters: {
    halfTwists: 15,
    twistDistribution: 1,
    twistIntensity: 0.9,
    twistExtent: 0.18,
    profileMode: 3,
    profileFrequency: 9
  }
});
assert.ok(highDetail.surfaceSegments > lowDetail.surfaceSegments);
assert.ok(highDetail.widthSegments > lowDetail.widthSegments);
assert.ok(highDetail.surfaceSegments <= MOBIUS_MAX_SURFACE_SEGMENTS);

for (const geometry of [
  createMobiusSurfaceGeometry(THREE, lowDetail),
  createMobiusVolumeGeometry(THREE, highDetail)
]) {
  const index = geometry.getIndex();
  assert.equal(index?.isBufferAttribute, true);
  assert.ok(index.array.byteLength > 0);
  geometry.dispose();
}

const volumeFrame = {
  width: 1000,
  height: 1000,
  seed: 6437,
  elapsedTime: 0.8,
  parameters: {
    halfTwists: 15,
    twistDistribution: 2,
    twistPosition: 38,
    twistExtent: 0.2,
    twistIntensity: 0.88,
    profileMode: 3,
    profileAmount: 0.24,
    profileFrequency: 7,
    thickness: 0.12,
    edgeRoundness: 0.5
  }
};
const volumeShape = mobiusShape(volumeFrame);
const volumeTessellation = mobiusTessellation(volumeFrame, volumeShape);
const volumeCenters = new Float32Array(volumeTessellation.vertexCount * 3);
const volumePositions = new Float32Array(volumeTessellation.vertexCount * 2 * 3);
writeMobiusVolumePositions(
  volumePositions,
  volumeCenters,
  volumeFrame,
  0.3,
  volumeShape,
  volumeTessellation
);
assert.ok(volumePositions.every(Number.isFinite));
const volumeIndices = createMobiusVolumeIndices(
  volumeTessellation.surfaceSegments,
  volumeTessellation.widthSegments
);
assert.equal(
  volumeIndices.length,
  volumeTessellation.triangleCount * 2 * 3 + volumeTessellation.surfaceSegments * 12
);
const volumeRow = volumeTessellation.widthSegments + 1;
const volumeLayerOffset = volumeTessellation.vertexCount * 3;
for (let vIndex = 0; vIndex <= volumeTessellation.widthSegments; vIndex += 1) {
  const mirroredV = volumeTessellation.widthSegments - vIndex;
  const endOffset = (volumeTessellation.surfaceSegments * volumeRow + vIndex) * 3;
  const startOffset = mirroredV * 3;
  assert.ok(distance(
    volumePositions.subarray(endOffset, endOffset + 3),
    volumePositions.subarray(volumeLayerOffset + startOffset, volumeLayerOffset + startOffset + 3)
  ) < 1e-5, `volume top/bottom seam failed at lane ${vIndex}`);
  assert.ok(distance(
    volumePositions.subarray(volumeLayerOffset + endOffset, volumeLayerOffset + endOffset + 3),
    volumePositions.subarray(startOffset, startOffset + 3)
  ) < 1e-5, `volume bottom/top seam failed at lane ${vIndex}`);
}

const legacyShape = mobiusShape({
  width: 0.61,
  twistConcentration: 0.41,
  twistPosition: 28
});
assert.equal(legacyShape.bandWidth, 1.22);
assert.equal(legacyShape.twistDistribution, 1);
assert.ok(legacyShape.twistIntensity > 0);

const svgFrame = {
  width: 500,
  height: 500,
  time: 0.2,
  elapsedTime: 1.4,
  timeMode: "loop",
  seed: 6437,
  transparent: false,
  palette: {
    background: "#11110f",
    foreground: "#f4f3ee",
    accent: "#aeb7ff",
    secondary: "#8ecfc2"
  },
  view: { zoom: 1, panX: 0, panY: 0, orbitYaw: 0, orbitPitch: 0 },
  parameters: {
    ...mobiusFlow11Project.defaults,
    renderMode: 0,
    halfTwists: 15,
    twistDistribution: 2,
    twistIntensity: 0.86,
    profileMode: 3,
    profileAmount: 0.25,
    profileFrequency: 7,
    thickness: 0.12
  }
};
const svgShape = mobiusShape(svgFrame);
const svgTessellation = mobiusTessellation(svgFrame, svgShape);
const svgPreviewTessellation = mobiusPreviewTessellation(svgFrame, svgShape);
const svg = mobiusFlow11Project.toSvg(svgFrame);
assert.equal(
  (svg.match(/<path /g) ?? []).length,
  svgTessellation.surfaceSegments * svgTessellation.widthSegments
);
assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
assert.ok(svgPreviewTessellation.surfaceSegments <= 320);
assert.ok(svgPreviewTessellation.surfaceSegments <= svgTessellation.surfaceSegments);
assert.ok(svgPreviewTessellation.widthSegments <= svgTessellation.widthSegments);
const svgPreview = mobiusFlow11Project.toSvgPreview(svgFrame);
assert.equal(
  (svgPreview.match(/<path /g) ?? []).length,
  svgPreviewTessellation.surfaceSegments * svgPreviewTessellation.widthSegments
);
assert.doesNotMatch(svgPreview, /NaN|Infinity|undefined/);
const movingSvgPreview = mobiusFlow11Project.toSvgPreview({
  ...svgFrame,
  time: 0.43,
  elapsedTime: 3.01
});
assert.notEqual(movingSvgPreview, svgPreview);

console.log(
  "Möbius geometry verified: 1–15 half-twists, monotone distributions, " +
  "seam-compatible profiles and volume, adaptive/live SVG tessellation, legacy parameters and SVG parity."
);
