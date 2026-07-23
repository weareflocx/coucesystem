import {
  TAU,
  appearanceParameters,
  appearanceSample,
  clamp,
  mixOklabColors,
  paletteGradientStops,
  parameter,
  positiveModulo
} from "./shared.js";
import {
  MOBIUS_PROFILE_MODES,
  MOBIUS_TWIST_DISTRIBUTIONS,
  mobiusShape,
  sampleMobiusPoint
} from "./mobius-core.js";
import { mobiusVectorTessellation } from "./mobius-geometry.js";
import { createMobiusProjector } from "./mobius-projection.js";
import {
  MOBIUS_WIDTH_RHYTHMS,
  widthRhythmScale
} from "./mobius-constructs/width-rhythm.js";
import {
  constructLaneIntervals,
  laneCutSettings
} from "./mobius-constructs/lane-cut.js";
import {
  MOBIUS_MORPH_MODES,
  constructMorphProgress,
  interpolateMobiusPoint,
  mobiusMorphShape
} from "./mobius-constructs/shape-morph.js";
import {
  temporalEchoFrame,
  temporalEchoSettings
} from "./mobius-constructs/temporal-echo.js";
import {
  drawVectorWeaveCell,
  vectorWeaveGap,
  vectorWeaveSvgCell
} from "./mobius-constructs/vector-weave.js";

export { MOBIUS_WIDTH_RHYTHMS, widthRhythmScale } from "./mobius-constructs/width-rhythm.js";
export { constructLaneIntervals, laneCutSettings } from "./mobius-constructs/lane-cut.js";
export {
  MOBIUS_MORPH_MODES,
  constructMorphProgress,
  interpolateMobiusPoint,
  mobiusMorphShape
} from "./mobius-constructs/shape-morph.js";
export { temporalEchoFrame, temporalEchoSettings } from "./mobius-constructs/temporal-echo.js";
export {
  drawVectorWeaveCell,
  vectorWeaveGap,
  vectorWeaveSvgCell
} from "./mobius-constructs/vector-weave.js";

const PROJECT_ID = "mobius-constructs";
const MAX_SURFACE_SEGMENTS = 384;
const FUNCTION_STATE_OPTIONS = Object.freeze([
  { value: 0, label: "Desactivado" },
  { value: 1, label: "Activo" }
]);

function shapeAtRhythm(shape, scale) {
  const width = shape.width * scale;
  return { ...shape, bandWidth: width * 2, width };
}

function rampColor(stops, position) {
  const value = clamp(position, 0, 1);
  const endIndex = stops.findIndex((stop) => stop.offset >= value);
  if (endIndex <= 0) return stops[0].color;
  if (endIndex < 0) return stops[stops.length - 1].color;
  const start = stops[endIndex - 1];
  const end = stops[endIndex];
  const progress = (value - start.offset) / Math.max(0.000001, end.offset - start.offset);
  return mixOklabColors(start.color, end.color, progress);
}

function surfaceColor(frame, normalizedU, appearance, ramp) {
  const sample = appearanceSample(frame, normalizedU, appearance);
  const color = rampColor(ramp, sample.gradientPosition);
  return sample.textureDim > 0.0001
    ? mixOklabColors(color, frame.palette.background, sample.textureDim)
    : color;
}

function constructTessellation(frame, shape, laneCount) {
  const source = mobiusVectorTessellation(frame, shape);
  return {
    surfaceSegments: Math.min(MAX_SURFACE_SEGMENTS, source.surfaceSegments),
    laneWidthSegments: Math.max(1, Math.ceil(source.widthSegments / laneCount))
  };
}

function sampleConstructPoint(frame, u, normalizedV, cycle, shapeA, shapeB, morph, project) {
  const rhythm = widthRhythmScale(frame, u);
  const phase = parameter(frame, "circulation", 1) * cycle * 0.5;
  const rhythmicA = shapeAtRhythm(shapeA, rhythm);
  const rhythmicB = shapeAtRhythm(shapeB, rhythm);
  const pointA = sampleMobiusPoint(u, normalizedV * rhythmicA.width, rhythmicA, phase);
  if (morph <= 0.0001) return project(pointA);
  const pointB = sampleMobiusPoint(u, normalizedV * rhythmicB.width, rhythmicB, phase);
  return project(interpolateMobiusPoint(pointA, pointB, morph));
}

function polygonPath(points) {
  return points.map((point, index) =>
    `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  ).join("") + "Z";
}

function centerConstructScene(frame, layers) {
  const view = frame.view ?? {};
  const hasManualView = ["panX", "panY", "orbitYaw", "orbitPitch"].some((key) => (
    Math.abs(Number(view[key]) || 0) > 0.0001
  ));
  if (hasManualView) return;

  const points = layers.flatMap((layer) => layer.cells.flatMap((cell) => cell.points));
  if (points.length === 0) return;
  const bounds = points.reduce((result, point) => ({
    minX: Math.min(result.minX, point.x),
    maxX: Math.max(result.maxX, point.x),
    minY: Math.min(result.minY, point.y),
    maxY: Math.max(result.maxY, point.y)
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity
  });
  const offsetX = frame.width * 0.5 - (bounds.minX + bounds.maxX) * 0.5;
  const offsetY = frame.height * 0.5 - (bounds.minY + bounds.maxY) * 0.5;
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;
  const shiftedPoints = new Set();
  for (const layer of layers) {
    for (const cell of layer.cells) {
      for (const point of cell.points) {
        if (shiftedPoints.has(point)) continue;
        shiftedPoints.add(point);
        point.x += offsetX;
        point.y += offsetY;
      }
      cell.path = polygonPath(cell.points);
    }
  }
}

export function createMobiusConstructScene(frame) {
  const shapeA = mobiusShape(frame);
  const shapeB = mobiusMorphShape(frame, shapeA);
  const laneCut = laneCutSettings(frame);
  const laneCount = laneCut.count;
  const lanes = laneCut.lanes;
  const tessellation = constructTessellation(frame, shapeA, laneCount);
  const echo = temporalEchoSettings(frame);
  const echoCount = echo.count;
  const layers = [];

  for (let echoIndex = echoCount - 1; echoIndex >= 0; echoIndex -= 1) {
    const sampledFrame = temporalEchoFrame(frame, echoIndex, echo.spacing);
    const speed = clamp(parameter(frame, "motionSpeed", 1), 0, 3);
    const cycle = positiveModulo(sampledFrame.time, 1) * TAU * speed;
    const project = createMobiusProjector(sampledFrame, cycle);
    const morph = constructMorphProgress(sampledFrame);
    const appearance = appearanceParameters(sampledFrame);
    const ramp = paletteGradientStops(sampledFrame, appearance, 10);
    const cells = [];

    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const lane = lanes[laneIndex];
      const rows = [];
      for (let uIndex = 0; uIndex <= tessellation.surfaceSegments; uIndex += 1) {
        const u = TAU * uIndex / tessellation.surfaceSegments;
        const row = [];
        for (let vIndex = 0; vIndex <= tessellation.laneWidthSegments; vIndex += 1) {
          const progress = vIndex / tessellation.laneWidthSegments;
          const normalizedV = lane.start + (lane.end - lane.start) * progress;
          row.push(sampleConstructPoint(
            sampledFrame,
            u,
            normalizedV,
            cycle,
            shapeA,
            shapeB,
            morph,
            project
          ));
        }
        rows.push(row);
      }

      for (let uIndex = 0; uIndex < tessellation.surfaceSegments; uIndex += 1) {
        const normalizedU = (uIndex + 0.5) / tessellation.surfaceSegments;
        const color = surfaceColor(sampledFrame, normalizedU, appearance, ramp);
        for (let vIndex = 0; vIndex < tessellation.laneWidthSegments; vIndex += 1) {
          const points = [
            rows[uIndex][vIndex],
            rows[uIndex + 1][vIndex],
            rows[uIndex + 1][vIndex + 1],
            rows[uIndex][vIndex + 1]
          ];
          cells.push({
            color,
            depth: points.reduce((sum, point) => sum + point.depth, 0) / points.length,
            laneIndex,
            normalizedU,
            path: polygonPath(points),
            points
          });
        }
      }
    }

    cells.sort((a, b) => b.depth - a.depth);
    layers.push({
      echoIndex,
      opacity: echoIndex === 0 ? 1 : Math.pow(echo.persistence, echoIndex),
      cells
    });
  }

  centerConstructScene(frame, layers);
  return {
    echoCount,
    laneCount,
    layers,
    surfaceSegments: tessellation.surfaceSegments,
    laneWidthSegments: tessellation.laneWidthSegments
  };
}

function render(context, frame) {
  const scene = createMobiusConstructScene(frame);
  const weaveGap = vectorWeaveGap(frame);
  context.globalAlpha = 1;
  if (!frame.transparent) {
    context.fillStyle = frame.palette.background;
    context.fillRect(0, 0, frame.width, frame.height);
  }
  for (const layer of scene.layers) {
    context.globalAlpha = layer.opacity;
    for (const cell of layer.cells) {
      drawVectorWeaveCell(context, cell, frame.palette.background, weaveGap);
    }
  }
}

function toSvg(frame) {
  const scene = createMobiusConstructScene(frame);
  const weaveGap = vectorWeaveGap(frame);
  const background = frame.transparent
    ? ""
    : `<rect width="${frame.width}" height="${frame.height}" fill="${frame.palette.background}"/>`;
  const layers = scene.layers.map((layer) => {
    const cells = layer.cells.map((cell) => (
      vectorWeaveSvgCell(cell, frame.palette.background, weaveGap)
    )).join("");
    return `<g opacity="${layer.opacity.toFixed(4)}">${cells}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><title>Cauce 05.3 — Möbius Constructs</title>${background}${layers}</svg>`;
}

/** @type {import("../core/types").ProjectDefinition} */
export const mobiusConstructsProject = {
  id: PROJECT_ID,
  index: "05.3",
  name: "Möbius Constructs",
  label: "Cauce — Möbius Constructs",
  description: "Construcción vectorial Möbius con cinco operadores independientes y combinables.",
  preferredFps: 30,
  preferredFormatKey: "story-horizontal",
  preferredLoopSeconds: 7,
  preferredPlaybackMode: /** @type {"loop"} */ ("loop"),
  supportsLoopTime: true,
  viewControls: true,
  exportCapabilities: { svg: true, png: true, video: true, web: true },
  appearanceCapabilities: {
    paint: true,
    gradientMapping: /** @type {Array<"surface">} */ (["surface"]),
    proceduralTextures: /** @type {Array<"flow" | "grain" | "mineral">} */ (["flow", "grain", "mineral"])
  },
  controls: [
    { key: "widthRhythmEnabled", label: "Ritmo de anchura", min: 0, max: 1, step: 1, defaultValue: 1, digits: 0, inspectorSection: "essential", subsection: "Funciones", options: FUNCTION_STATE_OPTIONS.map((option) => ({ ...option })) },
    { key: "laneCutEnabled", label: "Corte longitudinal", min: 0, max: 1, step: 1, defaultValue: 0, digits: 0, inspectorSection: "essential", subsection: "Funciones", options: FUNCTION_STATE_OPTIONS.map((option) => ({ ...option })) },
    { key: "weaveEnabled", label: "Entrelazado vectorial", min: 0, max: 1, step: 1, defaultValue: 0, digits: 0, inspectorSection: "essential", subsection: "Funciones", options: FUNCTION_STATE_OPTIONS.map((option) => ({ ...option })) },
    { key: "echoEnabled", label: "Eco temporal", min: 0, max: 1, step: 1, defaultValue: 0, digits: 0, inspectorSection: "essential", subsection: "Funciones", options: FUNCTION_STATE_OPTIONS.map((option) => ({ ...option })) },
    { key: "morphEnabled", label: "Morph A / B", min: 0, max: 1, step: 1, defaultValue: 0, digits: 0, inspectorSection: "essential", subsection: "Funciones", options: FUNCTION_STATE_OPTIONS.map((option) => ({ ...option })) },

    { key: "majorRadius", label: "Radio", min: 0.65, max: 1.5, step: 0.01, defaultValue: 1, digits: 2, inspectorSection: "shape", subsection: "Forma A" },
    { key: "bandWidth", label: "Anchura total", min: 0.32, max: 1.44, step: 0.01, defaultValue: 0.92, digits: 2, inspectorSection: "shape", subsection: "Forma A" },
    { key: "ellipticity", label: "Ovalado", min: 0.72, max: 1.32, step: 0.01, defaultValue: 1, digits: 2, inspectorSection: "shape", subsection: "Forma A" },
    { key: "flattening", label: "Profundidad", min: 0.5, max: 1.35, step: 0.01, defaultValue: 1, digits: 2, inspectorSection: "shape", subsection: "Forma A" },
    { key: "halfTwists", label: "Medias torsiones", min: 1, max: 15, step: 2, defaultValue: 5, digits: 0, inspectorSection: "shape", subsection: "Torsión" },
    { key: "handedness", label: "Lateralidad", min: -1, max: 1, step: 2, defaultValue: 1, digits: 0, inspectorSection: "shape", subsection: "Torsión", options: [
      { value: 1, label: "Derecha" },
      { value: -1, label: "Izquierda" }
    ] },
    { key: "twistDistribution", label: "Distribución", min: 0, max: 3, step: 1, defaultValue: 0, digits: 0, inspectorSection: "shape", subsection: "Torsión", options: MOBIUS_TWIST_DISTRIBUTIONS.map((option) => ({ ...option })) },
    { key: "twistPosition", label: "Posición", min: -180, max: 180, step: 1, defaultValue: 0, digits: 0, suffix: "°", inspectorSection: "shape", subsection: "Torsión", visibleWhen: { key: "twistDistribution", notEquals: 0 } },
    { key: "twistExtent", label: "Extensión", min: 0.08, max: 0.8, step: 0.01, defaultValue: 0.28, digits: 2, inspectorSection: "shape", subsection: "Torsión", visibleWhen: { key: "twistDistribution", notEquals: 0 } },
    { key: "twistIntensity", label: "Intensidad", min: 0, max: 1, step: 0.01, defaultValue: 0.7, digits: 2, inspectorSection: "shape", subsection: "Torsión", visibleWhen: { key: "twistDistribution", notEquals: 0 } },
    { key: "profileMode", label: "Perfil", min: 0, max: 3, step: 1, defaultValue: 0, digits: 0, inspectorSection: "shape", subsection: "Perfil", options: MOBIUS_PROFILE_MODES.map((option) => ({ ...option })) },
    { key: "profileAmount", label: "Relieve", min: 0, max: 0.45, step: 0.01, defaultValue: 0.18, digits: 2, inspectorSection: "shape", subsection: "Perfil", visibleWhen: { key: "profileMode", notEquals: 0 } },
    { key: "profileFrequency", label: "Frecuencia", min: 1, max: 9, step: 1, defaultValue: 3, digits: 0, inspectorSection: "shape", subsection: "Perfil", visibleWhen: { key: "profileMode", equals: 3 } },

    { key: "widthRhythmMode", label: "Ritmo", min: 1, max: 3, step: 1, defaultValue: 3, digits: 0, inspectorSection: "shape", subsection: "Ritmo de anchura", options: MOBIUS_WIDTH_RHYTHMS.map((option) => ({ ...option })), visibleWhen: { key: "widthRhythmEnabled", equals: 1 } },
    { key: "widthRhythmAmount", label: "Intensidad", min: 0, max: 0.72, step: 0.01, defaultValue: 0.38, digits: 2, inspectorSection: "shape", subsection: "Ritmo de anchura", visibleWhen: { key: "widthRhythmEnabled", equals: 1 } },
    { key: "widthRhythmLobes", label: "Lóbulos", min: 1, max: 12, step: 1, defaultValue: 5, digits: 0, inspectorSection: "shape", subsection: "Ritmo de anchura", visibleWhen: { key: "widthRhythmEnabled", equals: 1 } },
    { key: "widthRhythmPosition", label: "Posición", min: -180, max: 180, step: 1, defaultValue: 0, digits: 0, suffix: "°", inspectorSection: "shape", subsection: "Ritmo de anchura", visibleWhen: { key: "widthRhythmEnabled", equals: 1 } },
    { key: "widthRhythmSpeed", label: "Velocidad", min: -2, max: 2, step: 0.05, defaultValue: 0.3, digits: 2, inspectorSection: "motion", subsection: "Ritmo de anchura", visibleWhen: { key: "widthRhythmEnabled", equals: 1 } },

    { key: "laneCount", label: "Carriles", min: 2, max: 5, step: 1, defaultValue: 3, digits: 0, inspectorSection: "shape", subsection: "Corte longitudinal", visibleWhen: { key: "laneCutEnabled", equals: 1 } },
    { key: "laneGap", label: "Separación", min: 0, max: 0.72, step: 0.01, defaultValue: 0.18, digits: 2, inspectorSection: "shape", subsection: "Corte longitudinal", visibleWhen: { key: "laneCutEnabled", equals: 1 } },
    { key: "weaveGap", label: "Separación de cruce", min: 0, max: 18, step: 0.5, defaultValue: 4, digits: 1, suffix: "px", inspectorSection: "shape", subsection: "Entrelazado vectorial", visibleWhen: { key: "weaveEnabled", equals: 1 } },

    { key: "echoCount", label: "Ecos", min: 2, max: 8, step: 1, defaultValue: 3, digits: 0, inspectorSection: "motion", subsection: "Eco temporal", visibleWhen: { key: "echoEnabled", equals: 1 } },
    { key: "echoSpacing", label: "Separación temporal", min: 0, max: 20, step: 0.5, defaultValue: 4, digits: 1, suffix: "%", inspectorSection: "motion", subsection: "Eco temporal", visibleWhen: { key: "echoEnabled", equals: 1 } },
    { key: "echoPersistence", label: "Persistencia", min: 0.08, max: 0.92, step: 0.01, defaultValue: 0.62, digits: 2, inspectorSection: "motion", subsection: "Eco temporal", visibleWhen: { key: "echoEnabled", equals: 1 } },
    { key: "circulation", label: "Circulación", min: 0, max: 4, step: 1, defaultValue: 1, digits: 0, inspectorSection: "motion", subsection: "Movimiento" },
    { key: "motionSpeed", label: "Velocidad", min: 0, max: 3, step: 0.05, defaultValue: 1, digits: 2, inspectorSection: "motion", subsection: "Movimiento" },

    { key: "morphMode", label: "Movimiento", min: 0, max: 1, step: 1, defaultValue: 1, digits: 0, inspectorSection: "motion", subsection: "Morph A / B", options: MOBIUS_MORPH_MODES.map((option) => ({ ...option })), visibleWhen: { key: "morphEnabled", equals: 1 } },
    { key: "morphMix", label: "Mezcla manual", min: 0, max: 1, step: 0.01, defaultValue: 0.5, digits: 2, inspectorSection: "motion", subsection: "Morph A / B", visibleWhen: { key: "morphEnabled", equals: 1 } },
    { key: "morphSpeed", label: "Velocidad del loop", min: 0.1, max: 3, step: 0.05, defaultValue: 1, digits: 2, inspectorSection: "motion", subsection: "Morph A / B", visibleWhen: { key: "morphEnabled", equals: 1 } },
    { key: "morphMajorRadius", label: "Radio B", min: 0.65, max: 1.5, step: 0.01, defaultValue: 1.2, digits: 2, inspectorSection: "shape", subsection: "Forma B", visibleWhen: { key: "morphEnabled", equals: 1 } },
    { key: "morphBandWidth", label: "Anchura B", min: 0.32, max: 1.44, step: 0.01, defaultValue: 0.58, digits: 2, inspectorSection: "shape", subsection: "Forma B", visibleWhen: { key: "morphEnabled", equals: 1 } },
    { key: "morphEllipticity", label: "Ovalado B", min: 0.72, max: 1.32, step: 0.01, defaultValue: 1.2, digits: 2, inspectorSection: "shape", subsection: "Forma B", visibleWhen: { key: "morphEnabled", equals: 1 } },
    { key: "morphFlattening", label: "Profundidad B", min: 0.5, max: 1.35, step: 0.01, defaultValue: 0.72, digits: 2, inspectorSection: "shape", subsection: "Forma B", visibleWhen: { key: "morphEnabled", equals: 1 } },
    { key: "morphProfileAmount", label: "Relieve B", min: 0, max: 0.45, step: 0.01, defaultValue: 0.32, digits: 2, inspectorSection: "shape", subsection: "Forma B", visibleWhen: { key: "morphEnabled", equals: 1 } },

    { key: "projection", label: "Proyección", min: 0, max: 1, step: 1, defaultValue: 0, digits: 0, group: "camera", options: [
      { value: 0, label: "Perspectiva" },
      { value: 1, label: "Ortográfica" }
    ] },
    { key: "tilt", label: "Orientación X", min: -85, max: 85, step: 1, defaultValue: 48, digits: 0, suffix: "°", group: "camera" },
    { key: "yaw", label: "Orientación Y", min: -90, max: 90, step: 1, defaultValue: -12, digits: 0, suffix: "°", group: "camera" },
    { key: "rotation", label: "Orientación Z", min: -180, max: 180, step: 1, defaultValue: -24, digits: 0, suffix: "°", group: "camera" },
    { key: "precession", label: "Precesión", min: 0, max: 20, step: 0.5, defaultValue: 0, digits: 1, suffix: "°", group: "camera" },
    { key: "fov", label: "Campo de visión", min: 20, max: 72, step: 1, defaultValue: 38, digits: 0, suffix: "°", group: "camera" },
    { key: "cameraDistance", label: "Distancia", min: 3.4, max: 8, step: 0.05, defaultValue: 5.1, digits: 2, group: "camera" },

    { key: "gradientStrength", label: "Intensidad", min: 0, max: 1, step: 0.01, defaultValue: 0.7, digits: 2, group: "gradient" },
    { key: "gradientAngle", label: "Posición", min: -180, max: 180, step: 1, defaultValue: -35, digits: 0, suffix: "°", group: "gradient" },
    { key: "gradientMidpoint", label: "Punto medio", min: 0.08, max: 0.92, step: 0.01, defaultValue: 0.46, digits: 2, group: "gradient" },
    { key: "textureMode", label: "Textura", min: 0, max: 3, step: 1, defaultValue: 0, digits: 0, group: "appearance" },
    { key: "textureScale", label: "Escala", min: 1, max: 12, step: 1, defaultValue: 4, digits: 0, group: "appearance" },
    { key: "textureStrength", label: "Intensidad", min: 0, max: 1, step: 0.01, defaultValue: 0, digits: 2, group: "appearance" },
    { key: "textureMotion", label: "Movimiento", min: -4, max: 4, step: 1, defaultValue: 1, digits: 0, group: "appearance" }
  ],
  defaults: {
    widthRhythmEnabled: 1,
    laneCutEnabled: 0,
    weaveEnabled: 0,
    echoEnabled: 0,
    morphEnabled: 0,
    majorRadius: 1,
    bandWidth: 0.92,
    ellipticity: 1,
    flattening: 1,
    halfTwists: 5,
    handedness: 1,
    twistDistribution: 0,
    twistPosition: 0,
    twistExtent: 0.28,
    twistIntensity: 0.7,
    profileMode: 0,
    profileAmount: 0.18,
    profileFrequency: 3,
    thickness: 0,
    edgeRoundness: 0,
    widthVariation: 0,
    twistPhase: 0,
    widthRhythmMode: 3,
    widthRhythmAmount: 0.38,
    widthRhythmLobes: 5,
    widthRhythmPosition: 0,
    widthRhythmSpeed: 0.3,
    laneCount: 3,
    laneGap: 0.18,
    weaveGap: 4,
    echoCount: 3,
    echoSpacing: 4,
    echoPersistence: 0.62,
    circulation: 1,
    motionSpeed: 1,
    morphMode: 1,
    morphMix: 0.5,
    morphSpeed: 1,
    morphMajorRadius: 1.2,
    morphBandWidth: 0.58,
    morphEllipticity: 1.2,
    morphFlattening: 0.72,
    morphProfileAmount: 0.32,
    projection: 0,
    tilt: 48,
    yaw: -12,
    rotation: -24,
    precession: 0,
    fov: 38,
    cameraDistance: 5.1,
    gradientStrength: 0.7,
    gradientAngle: -35,
    gradientMidpoint: 0.46,
    textureMode: 0,
    textureScale: 4,
    textureStrength: 0,
    textureMotion: 1
  },
  render,
  toSvg
};
