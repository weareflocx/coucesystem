#!/usr/bin/env node

import assert from "node:assert/strict";
import { paletteGradientStops, svgGradientDefinition } from "../src/projects/shared.js";
import { mobiusFlow11Project } from "../src/projects/mobius-flow-1-1.js";
import { scalarDriftProject } from "../src/projects/scalar-drift.js";

const appearance = {
  schemaVersion: 1,
  background: { color: "#101418" },
  paint: {
    type: "gradient",
    mapping: "surface",
    angle: -32,
    stops: [
      { position: 0, color: "#ef476f" },
      { position: 0.28, color: "#ffd166" },
      { position: 0.67, color: "#06d6a0" },
      { position: 1, color: "#118ab2" }
    ]
  },
  material: { preset: "satin", roughness: 0.38, metalness: 0.08, clearcoat: 0.4 },
  texture: { type: "procedural", preset: "grain", scale: 5, strength: 0.24, motion: 0 }
};

function frameFor(project) {
  return {
    width: 480,
    height: 480,
    time: 0.27,
    elapsedTime: 1.8,
    timeMode: "loop",
    seed: 6437,
    palette: {
      background: appearance.background.color,
      foreground: appearance.paint.stops[0].color,
      accent: appearance.paint.stops[2].color,
      secondary: appearance.paint.stops[3].color
    },
    appearance,
    view: { zoom: 1, panX: 0, panY: 0, orbitYaw: 0, orbitPitch: 0 },
    parameters: { ...project.defaults },
    lighting: null
  };
}

const ramp = paletteGradientStops(frameFor(mobiusFlow11Project));
assert.equal(ramp.length, 17, "the shared GPU/vector ramp must keep 17 samples");
assert.equal(ramp[0].color, appearance.paint.stops[0].color);
assert.equal(ramp.at(-1).color, appearance.paint.stops.at(-1).color);
assert.ok(new Set(ramp.map((stop) => stop.color)).size >= 12, "the ramp collapsed to too few colors");

const scalarFrame = frameFor(scalarDriftProject);
scalarFrame.appearance = {
  ...appearance,
  paint: { ...appearance.paint, mapping: "screen" }
};
const gradient = svgGradientDefinition(scalarFrame, undefined, "appearance-test");
assert.match(gradient.definition, /linearGradient/);
assert.match(gradient.definition, /#ef476f/);
assert.match(gradient.definition, /#118ab2/);

const scalarSvg = scalarDriftProject.toSvg(scalarFrame);
assert.match(scalarSvg, /url\(#scalar-drift-gradient\)/);
assert.match(scalarSvg, /#ef476f/);
assert.match(scalarSvg, /#118ab2/);

const mobiusSvg = mobiusFlow11Project.toSvgColorMesh(frameFor(mobiusFlow11Project));
const meshBands = Array.from(mobiusSvg.matchAll(/id="mobius-flow-1-1-band-/g));
const meshColors = Array.from(mobiusSvg.matchAll(/stop-color="(#[0-9a-f]{6})"/gi), (match) => match[1]);
assert.ok(meshBands.length >= 190, "the Möbius color mesh did not emit its polygon bands");
assert.ok(meshColors.length >= 380, "the Möbius color mesh did not emit vector color stops");
assert.ok(new Set(meshColors).size >= 16, "the Möbius color mesh collapsed to a flat color");
assert.ok(meshColors.some((color) => color.toLowerCase() !== "#ffffff"), "the Möbius mesh stayed white");

const solidFrame = frameFor(scalarDriftProject);
solidFrame.appearance = {
  ...appearance,
  paint: { type: "solid", color: "#8ecfc2" }
};
const solidRamp = paletteGradientStops(solidFrame);
assert.ok(solidRamp.every((stop) => stop.color === "#8ecfc2"));

console.log("Appearance verified: solid, four-stop OKLab ramp, Canvas/SVG and Möbius color mesh.");
