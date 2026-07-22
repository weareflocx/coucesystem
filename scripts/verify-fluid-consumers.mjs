#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CAUCE_PROJECTS } from "../src/projects/registry.js";

const project = CAUCE_PROJECTS.find((candidate) => candidate.id === "chromatic-fluid");
assert(project, "08.5 · Chromatic Fluid debe estar registrado.");
assert.equal(project.index, "08.5");
assert.equal(project.backend, "webgpu");
assert.equal(project.exportCapabilities?.web, false, "El runtime anidado aún no puede exportarse como ZIP web.");
assert.equal(project.exportCapabilities?.svg, false, "El renderer físico no debe declarar una falsa salida SVG.");
assert.equal(
  project.appearanceCapabilities?.proceduralTextures,
  undefined,
  "Chromatic Fluid no debe anunciar texturas procedurales sin una función visual propia."
);
const shapeControl = project.controls.find((control) => control.key === "particleShape");
assert.equal(shapeControl?.max, 1);
assert.equal(shapeControl?.options?.length, 2);
assert(project.controls.some((control) => control.key === "colorBehavior"));
assert(!project.controls.some((control) => control.key === "channelSpread"));
assert(!project.controls.some((control) => control.key === "opacity"));

const runtimeUrl = new URL("../src/projects/chromatic-fluid/runtime.js", import.meta.url);
const engineUrl = new URL("../src/engine/fluid/cauce-fluid-engine.js", import.meta.url);
const [runtimeSource, engineSource] = await Promise.all([
  readFile(runtimeUrl, "utf8"),
  readFile(engineUrl, "utf8")
]);

assert.equal(
  (runtimeSource.match(/const fluid = createCauceFluidEngine\(/g) ?? []).length,
  1,
  "Chromatic Fluid debe crear exactamente una instancia del motor."
);
assert.match(runtimeSource, /visualMode:\s*"none"/);
assert.doesNotMatch(runtimeSource, /flow-cauce/i, "El segundo consumidor no puede importar el runtime de Flow Cauce.");
assert.match(runtimeSource, /const \{ particleBuffer, uniforms: physicsUniforms \} = fluid/);
assert.match(runtimeSource, /engineInstances:\s*1/);
assert.match(runtimeSource, /physicalBuffers:\s*1/);
assert.match(runtimeSource, /visualBuffers:\s*0/);
assert.match(runtimeSource, /renderLayers:\s*1/);
assert.match(runtimeSource, /renderedFrames/);
assert.match(runtimeSource, /sharesParticleBuffer:/);
assert.match(runtimeSource, /createFlowRoundedBoxGeometry/);
assert.match(runtimeSource, /colorBehavior/);
assert.match(runtimeSource, /solidPaint/);
assert.doesNotMatch(runtimeSource, /AdditiveBlending/);
assert.doesNotMatch(runtimeSource, /opacityNode/);
assert.doesNotMatch(runtimeSource, /textureSignal/);
assert.doesNotMatch(runtimeSource, /dropPosition|dropTaper/);
assert.match(engineSource, /version:\s*"0\.2"/);
assert.match(engineSource, /visualMode:\s*visualEnabled \? visualMode : "none"/);

console.log("✓ 08.5 está registrado como segundo consumidor WebGPU.");
console.log("✓ Una instancia de Cauce Fluid Engine 0.2 y un único particleBuffer físico.");
console.log("✓ Una representación opaca por partícula, sin buffer visual ni dependencias de Flow Cauce.");
