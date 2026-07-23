import assert from "node:assert/strict";

import {
  createMobiusConstructScene,
  mobiusConstructsProject
} from "../src/projects/mobius-constructs.js";
import { widthRhythmScale } from "../src/projects/mobius-constructs/width-rhythm.js";
import {
  constructLaneIntervals,
  laneCutSettings
} from "../src/projects/mobius-constructs/lane-cut.js";
import { constructMorphProgress } from "../src/projects/mobius-constructs/shape-morph.js";
import { temporalEchoSettings } from "../src/projects/mobius-constructs/temporal-echo.js";
import { vectorWeaveGap } from "../src/projects/mobius-constructs/vector-weave.js";
import { CAUCE_PROJECTS } from "../src/projects/registry.js";

function frame(overrides = {}) {
  const parameters = {
    ...mobiusConstructsProject.defaults,
    ...(overrides.parameters ?? {})
  };
  return {
    width: 1280,
    height: 720,
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
    ...overrides,
    parameters
  };
}

assert.equal(CAUCE_PROJECTS.some((project) => project.id === "mobius-constructs"), true);
assert.equal(mobiusConstructsProject.index, "05.3");
const halfTwists = mobiusConstructsProject.controls.find((control) => control.key === "halfTwists");
assert.deepEqual(
  { min: halfTwists?.min, max: halfTwists?.max, step: halfTwists?.step },
  { min: 1, max: 15, step: 2 }
);
assert.deepEqual(
  ["widthRhythmEnabled", "laneCutEnabled", "weaveEnabled", "echoEnabled", "morphEnabled"]
    .map((key) => [key, mobiusConstructsProject.defaults[key]]),
  [
    ["widthRhythmEnabled", 1],
    ["laneCutEnabled", 0],
    ["weaveEnabled", 0],
    ["echoEnabled", 0],
    ["morphEnabled", 0]
  ]
);

assert.deepEqual(constructLaneIntervals(1, 0.7), [{ start: -1, end: 1 }]);
for (const laneCount of [2, 3, 4, 5]) {
  const lanes = constructLaneIntervals(laneCount, 0.18);
  assert.equal(lanes.length, laneCount);
  for (let index = 0; index < lanes.length; index += 1) {
    const lane = lanes[index];
    const mirrored = lanes[lanes.length - 1 - index];
    assert.ok(lane.start < lane.end);
    assert.ok(Math.abs(lane.start + mirrored.end) < 1e-12);
    assert.ok(Math.abs(lane.end + mirrored.start) < 1e-12);
    if (index > 0) assert.ok(lanes[index - 1].end < lane.start);
  }
}

const uniformFrame = frame({ parameters: { widthRhythmEnabled: 0, widthRhythmMode: 3 } });
assert.equal(widthRhythmScale(uniformFrame, 1.2), 1);
for (const mode of [1, 2, 3]) {
  const rhythmFrame = frame({
    parameters: {
      widthRhythmMode: mode,
      widthRhythmAmount: 0.72,
      widthRhythmLobes: 7,
      widthRhythmSpeed: 0.8
    }
  });
  const samples = Array.from({ length: 64 }, (_, index) =>
    widthRhythmScale(rhythmFrame, Math.PI * 2 * index / 64)
  );
  assert.ok(samples.every((value) => Number.isFinite(value) && value >= 0.24 && value <= 1.78));
  assert.ok(Math.max(...samples) - Math.min(...samples) > 0.1);
}

assert.equal(
  constructMorphProgress(frame({ parameters: { morphEnabled: 0, morphMode: 1 } })),
  0
);
assert.equal(
  constructMorphProgress(frame({ parameters: { morphEnabled: 1, morphMode: 0, morphMix: 0.37 } })),
  0.37
);
assert.ok(Math.abs(constructMorphProgress(frame({ time: 0, parameters: { morphEnabled: 1, morphMode: 1 } }))) < 1e-12);
assert.ok(Math.abs(constructMorphProgress(frame({ time: 0.5, parameters: { morphEnabled: 1, morphMode: 1 } })) - 1) < 1e-12);

assert.deepEqual(laneCutSettings(frame({ parameters: { laneCutEnabled: 0, laneCount: 5 } })).lanes, [
  { start: -1, end: 1 }
]);
assert.deepEqual(
  temporalEchoSettings(frame({ parameters: { echoEnabled: 0, echoCount: 8 } })),
  { count: 1, spacing: 0, persistence: 1 }
);
assert.equal(vectorWeaveGap(frame({ parameters: { weaveEnabled: 0, weaveGap: 18 } })), 0);

const scene = createMobiusConstructScene(frame());
assert.equal(scene.echoCount, 1);
assert.equal(scene.laneCount, 1);
assert.deepEqual(scene.layers.map((layer) => layer.echoIndex), [0]);
assert.equal(scene.layers.at(-1)?.opacity, 1);
assert.ok(scene.layers.every((layer) => layer.cells.length > 0));
assert.ok(scene.layers.every((layer) => layer.cells.every((cell) => (
  Number.isFinite(cell.depth) &&
  !/NaN|Infinity|undefined/.test(cell.path)
))));
const scenePoints = scene.layers.flatMap((layer) => layer.cells.flatMap((cell) => cell.points));
const sceneBounds = scenePoints.reduce((result, point) => ({
  minX: Math.min(result.minX, point.x),
  maxX: Math.max(result.maxX, point.x),
  minY: Math.min(result.minY, point.y),
  maxY: Math.max(result.maxY, point.y)
}), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
assert.ok(Math.abs((sceneBounds.minX + sceneBounds.maxX) * 0.5 - 640) < 1e-9);
assert.ok(Math.abs((sceneBounds.minY + sceneBounds.maxY) * 0.5 - 360) < 1e-9);

const pannedScene = createMobiusConstructScene(frame({ view: { zoom: 1, panX: 0.1, panY: 0, orbitYaw: 0, orbitPitch: 0 } }));
const pannedPoints = pannedScene.layers.flatMap((layer) => layer.cells.flatMap((cell) => cell.points));
assert.ok(Math.abs((Math.min(...pannedPoints.map((point) => point.x)) + Math.max(...pannedPoints.map((point) => point.x))) * 0.5 - 640) > 0.01);

const morphBase = {
  widthRhythmEnabled: 0,
  circulation: 0,
  morphEnabled: 1,
  morphMode: 1,
  morphSpeed: 1
};
const shapeA = createMobiusConstructScene(frame({ time: 0, parameters: morphBase }));
const shapeB = createMobiusConstructScene(frame({ time: 0.5, parameters: morphBase }));
assert.notEqual(shapeA.layers[0].cells[0].path, shapeB.layers[0].cells[0].path);
assert.equal(shapeA.layers[0].cells.length, shapeB.layers[0].cells.length);

const combinedScene = createMobiusConstructScene(frame({
  parameters: { laneCutEnabled: 1, laneCount: 3, echoEnabled: 1, echoCount: 3 }
}));
assert.equal(combinedScene.laneCount, 3);
assert.deepEqual(combinedScene.layers.map((layer) => layer.echoIndex), [2, 1, 0]);

const opaqueFrame = frame({ parameters: { weaveEnabled: 1, weaveGap: 4 } });
const opaqueScene = createMobiusConstructScene(opaqueFrame);
const opaqueSvg = mobiusConstructsProject.toSvg?.(opaqueFrame) ?? "";
assert.equal((opaqueSvg.match(/<path /g) ?? []).length, opaqueScene.layers[0].cells.length * 2);
assert.match(opaqueSvg, /<rect /);
assert.doesNotMatch(opaqueSvg, /NaN|Infinity|undefined/);

const transparentFrame = { ...opaqueFrame, transparent: true };
const transparentSvg = mobiusConstructsProject.toSvg?.(transparentFrame) ?? "";
assert.equal(
  (transparentSvg.match(/<path /g) ?? []).length,
  opaqueScene.layers[0].cells.length
);
assert.doesNotMatch(transparentSvg, /<rect /);

console.log(
  "Möbius Constructs verified: five independent neutral operators, mirrored lane seams, " +
  "bounded width rhythms, closed A/B morph topology, temporal echoes and SVG output."
);
