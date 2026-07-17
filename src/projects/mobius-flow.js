import {
  TAU,
  appearanceParameters,
  canvasGradientStyle,
  clamp,
  linearGradientGeometry,
  parameter,
  positiveModulo,
  svgGradientDefinition
} from "./shared.js";
import { adaptiveAxisScale, fitBoundsToArtboard } from "./composition.js";

const PROJECT_ID = "mobius-flow";
const DEPTH_BINS = 12;
const RADIAL_SAMPLES = 288;
const LAYOUT_CYCLE_SAMPLES = 16;
const LAYOUT_RADIAL_SAMPLES = 192;
const layoutBoundsCache = new Map();

function oddInteger(value, fallback) {
  const safeValue = Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.round((safeValue - 1) / 2) * 2 + 1);
}

function createProjector(frame, stripWidth, cycle) {
  const view = frame.view ?? {};
  const tilt = (
    parameter(frame, "tilt", 58) + (Number.isFinite(view.orbitPitch) ? view.orbitPitch : 0)
  ) * Math.PI / 180;
  const yaw = (
    parameter(frame, "yaw", -16) +
    parameter(frame, "precession", 4) * Math.sin(cycle) +
    (Number.isFinite(view.orbitYaw) ? view.orbitYaw : 0)
  ) * Math.PI / 180;
  const rotation = parameter(frame, "rotation", -32) * Math.PI / 180;
  const perspective = parameter(frame, "perspective", 0.48);
  const formatScale = adaptiveAxisScale(frame, 0.4, 1.32);
  const depthRange = 1 + stripWidth;

  const cosineTilt = Math.cos(tilt);
  const sineTilt = Math.sin(tilt);
  const cosineYaw = Math.cos(yaw);
  const sineYaw = Math.sin(yaw);
  const cosineRotation = Math.cos(rotation);
  const sineRotation = Math.sin(rotation);

  return function project(x, y, z) {
    const tiltedY = y * cosineTilt - z * sineTilt;
    const tiltedZ = y * sineTilt + z * cosineTilt;
    const turnedX = x * cosineYaw + tiltedZ * sineYaw;
    const turnedZ = -x * sineYaw + tiltedZ * cosineYaw;
    const perspectiveScale = 1 / (1 - perspective * turnedZ / (2.4 * depthRange));
    const projectedX = turnedX * perspectiveScale;
    const projectedY = tiltedY * perspectiveScale;

    return [
      (projectedX * cosineRotation - projectedY * sineRotation) * formatScale.x,
      (projectedX * sineRotation + projectedY * cosineRotation) * formatScale.y,
      turnedZ
    ];
  };
}

export function mobiusViewTransform(frame) {
  const view = frame.view ?? {};
  const centerX = frame.width * 0.5;
  const centerY = frame.height * 0.5;
  const zoom = Number.isFinite(view.zoom) ? clamp(view.zoom, 0.35, 4) : 1;
  const panX = frame.width * (Number.isFinite(view.panX) ? view.panX : 0);
  const panY = frame.height * (Number.isFinite(view.panY) ? view.panY : 0);
  return {
    zoom,
    translateX: centerX + panX - centerX * zoom,
    translateY: centerY + panY - centerY * zoom
  };
}

function sampleSurface(project, u, v, halfTwists, phase) {
  const crossSection = halfTwists * u * 0.5 + phase;
  const distance = 1 + v * Math.cos(crossSection);
  return project(
    distance * Math.cos(u),
    distance * Math.sin(u),
    v * Math.sin(crossSection)
  );
}

function mobiusLayoutCacheKey(frame) {
  const view = frame.view ?? {};
  return [
    frame.width,
    frame.height,
    parameter(frame, "width", 0.46),
    parameter(frame, "halfTwists", 1),
    parameter(frame, "tilt", 58),
    parameter(frame, "yaw", -16),
    parameter(frame, "rotation", -32),
    parameter(frame, "circulation", 1),
    parameter(frame, "breathing", 0.07),
    parameter(frame, "precession", 4),
    parameter(frame, "perspective", 0.48),
    Number.isFinite(view.orbitYaw) ? view.orbitYaw : 0,
    Number.isFinite(view.orbitPitch) ? view.orbitPitch : 0
  ].join(":");
}

function getMobiusLayoutBounds(frame) {
  const key = mobiusLayoutCacheKey(frame);
  const cached = layoutBoundsCache.get(key);
  if (cached) return cached;

  const halfTwists = oddInteger(parameter(frame, "halfTwists", 1), 1);
  const baseWidth = parameter(frame, "width", 0.46);
  const breathing = parameter(frame, "breathing", 0.07);
  const circulation = Math.round(parameter(frame, "circulation", 1));
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };

  for (let cycleIndex = 0; cycleIndex < LAYOUT_CYCLE_SAMPLES; cycleIndex += 1) {
    const cycle = cycleIndex / LAYOUT_CYCLE_SAMPLES * TAU;
    const stripWidth = baseWidth * (1 + breathing * Math.sin(cycle));
    const phase = circulation * cycle * 0.5;
    const project = createProjector(frame, stripWidth, cycle);
    const offsets = [0, stripWidth * 0.5, stripWidth];

    for (const offset of offsets) {
      const revolutions = offset === 0 ? 1 : 2;
      const end = TAU * revolutions;
      for (let step = 0; step <= LAYOUT_RADIAL_SAMPLES; step += 1) {
        const point = sampleSurface(
          project,
          end * step / LAYOUT_RADIAL_SAMPLES,
          offset,
          halfTwists,
          phase
        );
        bounds.minX = Math.min(bounds.minX, point[0]);
        bounds.minY = Math.min(bounds.minY, point[1]);
        bounds.maxX = Math.max(bounds.maxX, point[0]);
        bounds.maxY = Math.max(bounds.maxY, point[1]);
      }
    }
  }

  const expansionX = (bounds.maxX - bounds.minX) * 0.012;
  const expansionY = (bounds.maxY - bounds.minY) * 0.012;
  bounds.minX -= expansionX;
  bounds.maxX += expansionX;
  bounds.minY -= expansionY;
  bounds.maxY += expansionY;

  if (layoutBoundsCache.size >= 48) {
    layoutBoundsCache.delete(layoutBoundsCache.keys().next().value);
  }
  layoutBoundsCache.set(key, bounds);
  return bounds;
}

export function mobiusLoopTime(frame) {
  return positiveModulo(frame.time + parameter(frame, "loopPhase", 0), 1);
}

export function createMobiusGeometry(frame) {
  const visibleCurrentCount = clamp(Math.round(parameter(frame, "currents", 15)), 3, 35);
  const halfTwists = oddInteger(parameter(frame, "halfTwists", 1), 1);
  const cycle = mobiusLoopTime(frame) * TAU;
  const breathing = parameter(frame, "breathing", 0.07);
  const stripWidth = parameter(frame, "width", 0.46) * (1 + breathing * Math.sin(cycle));
  const circulation = Math.round(parameter(frame, "circulation", 1));
  // A half-turn returns the unoriented strip to the same visible surface.
  // Using it as the animation period avoids repeating the same motion twice.
  const phase = circulation * cycle * 0.5;
  const depthFade = parameter(frame, "depthFade", 0.46);
  const project = createProjector(frame, stripWidth, cycle);
  const bins = Array.from({ length: DEPTH_BINS }, () => []);
  const depthRange = 1 + stripWidth;

  function addCurrent(v, revolutions, samples) {
    const end = TAU * revolutions;
    let previous = sampleSurface(project, 0, v, halfTwists, phase);

    for (let step = 1; step <= samples; step += 1) {
      const u = end * step / samples;
      const current = sampleSurface(project, u, v, halfTwists, phase);
      const depth = (previous[2] + current[2]) * 0.5;
      const normalizedDepth = clamp(0.5 + depth / (2 * depthRange), 0, 0.999999);
      const bin = Math.floor(normalizedDepth * DEPTH_BINS);
      bins[bin].push(previous[0], previous[1], current[0], current[1]);
      previous = current;
    }
  }

  const currentOffsets = mobiusCurrentOffsets(stripWidth, visibleCurrentCount);
  for (const offset of currentOffsets) {
    const isCenterCurrent = offset === 0;
    addCurrent(
      offset,
      isCenterCurrent ? 1 : 2,
      isCenterCurrent ? RADIAL_SAMPLES / 2 : RADIAL_SAMPLES
    );
  }

  const fit = fitBoundsToArtboard(frame, getMobiusLayoutBounds(frame), 0.085);
  for (const segments of bins) {
    for (let index = 0; index < segments.length; index += 4) {
      segments[index] = segments[index] * fit.scale + fit.offsetX;
      segments[index + 1] = segments[index + 1] * fit.scale + fit.offsetY;
      segments[index + 2] = segments[index + 2] * fit.scale + fit.offsetX;
      segments[index + 3] = segments[index + 3] * fit.scale + fit.offsetY;
    }
  }

  return {
    bins,
    depthFade,
    strokeWidth: parameter(frame, "stroke", 1.15) * Math.min(frame.width, frame.height) / 500
  };
}

export function mobiusCurrentOffsets(stripWidth, currentCount) {
  const visibleCurrentCount = clamp(Math.round(currentCount), 3, 35);
  const pairCount = Math.floor(visibleCurrentCount / 2);
  const hasCenterCurrent = visibleCurrentCount % 2 === 1;
  const offsets = hasCenterCurrent ? [0] : [];

  for (let index = 1; index <= pairCount; index += 1) {
    const crossSectionIndex = hasCenterCurrent ? index * 2 : index * 2 - 1;
    offsets.push(stripWidth * crossSectionIndex / (visibleCurrentCount - 1));
  }

  return offsets;
}

export function mobiusOpacityForBin(bin, depthFade) {
  const depth = bin / (DEPTH_BINS - 1);
  return 1 - depthFade * (1 - depth) * 0.82;
}

export function mobiusGradientGeometry(frame, appearance) {
  return linearGradientGeometry(frame, appearance.gradientAngle);
}

function createStrokeGradient(context, frame, appearance) {
  return canvasGradientStyle(context, frame, appearance);
}

export function mobiusTextureStroke(frame, appearance, strokeWidth) {
  if (appearance.textureMode === 0 || appearance.textureStrength <= 0.001) {
    return { pattern: [], offset: 0 };
  }
  const unit = Math.min(frame.width, frame.height) / (10 + appearance.textureScale * 8);
  if (appearance.textureMode === 1) {
    return {
      pattern: [unit * 0.68, unit * 0.32],
      offset: -mobiusLoopTime(frame) * appearance.textureMotion * unit
    };
  }
  return {
    pattern: [Math.max(strokeWidth * 0.7, 0.5), unit * 0.26, Math.max(strokeWidth * 0.35, 0.35), unit * 0.18],
    offset: 0
  };
}

function strokeGeometry(context, geometry, baseOpacity) {
  for (let bin = 0; bin < geometry.bins.length; bin += 1) {
    const segments = geometry.bins[bin];
    if (segments.length === 0) continue;
    context.globalAlpha = mobiusOpacityForBin(bin, geometry.depthFade) * baseOpacity;
    context.beginPath();
    for (let index = 0; index < segments.length; index += 4) {
      context.moveTo(segments[index], segments[index + 1]);
      context.lineTo(segments[index + 2], segments[index + 3]);
    }
    context.stroke();
  }
}

function render(context, frame) {
  const geometry = createMobiusGeometry(frame);
  const appearance = appearanceParameters(frame);
  if (!frame.transparent) {
    context.fillStyle = frame.palette.background;
    context.fillRect(0, 0, frame.width, frame.height);
  }

  const viewTransform = mobiusViewTransform(frame);
  context.save();
  context.transform(
    viewTransform.zoom,
    0,
    0,
    viewTransform.zoom,
    viewTransform.translateX,
    viewTransform.translateY
  );
  context.strokeStyle = createStrokeGradient(context, frame, appearance);
  context.lineWidth = geometry.strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";

  const texture = mobiusTextureStroke(frame, appearance, geometry.strokeWidth);
  if (texture.pattern.length > 0) {
    context.setLineDash([]);
    strokeGeometry(context, geometry, 1 - appearance.textureStrength * 0.82);
    context.setLineDash(texture.pattern);
    context.lineDashOffset = texture.offset;
    strokeGeometry(context, geometry, appearance.textureStrength);
  } else {
    strokeGeometry(context, geometry, 1);
  }
  context.setLineDash([]);
  context.lineDashOffset = 0;
  context.globalAlpha = 1;
  context.restore();
}

function segmentsToPath(segments) {
  let path = "";
  for (let index = 0; index < segments.length; index += 4) {
    path += `M${segments[index].toFixed(2)} ${segments[index + 1].toFixed(2)}L${segments[index + 2].toFixed(2)} ${segments[index + 3].toFixed(2)}`;
  }
  return path;
}

function toSvg(frame) {
  const geometry = createMobiusGeometry(frame);
  const appearance = appearanceParameters(frame);
  const viewTransform = mobiusViewTransform(frame);
  const gradient = svgGradientDefinition(frame, appearance, "mobius-flow-gradient");
  const texture = mobiusTextureStroke(frame, appearance, geometry.strokeWidth);
  const paths = geometry.bins.map((segments, bin) => {
    if (segments.length === 0) return "";
    return `<path d="${segmentsToPath(segments)}" stroke-opacity="${mobiusOpacityForBin(bin, geometry.depthFade).toFixed(3)}"/>`;
  });
  const texturePaths = texture.pattern.length > 0
    ? `<g opacity="${appearance.textureStrength.toFixed(3)}" stroke-dasharray="${texture.pattern.map((value) => value.toFixed(3)).join(" ")}" stroke-dashoffset="${texture.offset.toFixed(3)}">${paths.join("")}</g>`
    : "";
  const baseOpacity = texture.pattern.length > 0
    ? 1 - appearance.textureStrength * 0.82
    : 1;
  const background = frame.transparent
    ? ""
    : `<rect width="${frame.width}" height="${frame.height}" fill="${frame.palette.background}"/>`;
  const artworkTransform = `matrix(${viewTransform.zoom.toFixed(6)} 0 0 ${viewTransform.zoom.toFixed(6)} ${viewTransform.translateX.toFixed(3)} ${viewTransform.translateY.toFixed(3)})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><title>Cauce 05 — Möbius Flow</title>${gradient.definition}${background}<g transform="${artworkTransform}" fill="none" stroke="${gradient.paint}" stroke-width="${geometry.strokeWidth.toFixed(3)}" stroke-linecap="round" stroke-linejoin="round"><g opacity="${baseOpacity.toFixed(3)}">${paths.join("")}</g>${texturePaths}</g></svg>`;
}

export const mobiusFlowProject = {
  id: PROJECT_ID,
  index: "05",
  name: "Möbius Flow",
  label: "Cauce — Möbius Flow",
  description: "Una única superficie no orientable conduce corrientes cerradas a través de media torsión.",
  preferredFps: 60,
  preferredFormatKey: "square",
  preferredLoopSeconds: 7,
  viewControls: true,
  controls: [
    { key: "loopPhase", label: "Inicio del bucle", min: 0, max: 0.999999, step: 0.001, defaultValue: 0, digits: 3, hidden: true },
    { key: "currents", label: "Corrientes", min: 3, max: 35, step: 1, defaultValue: 15, digits: 0 },
    { key: "width", label: "Anchura de banda", min: 0.16, max: 0.72, step: 0.01, defaultValue: 0.46, digits: 2 },
    { key: "halfTwists", label: "Medias torsiones", min: 1, max: 5, step: 2, defaultValue: 1, digits: 0 },
    { key: "tilt", label: "Inclinación", min: -85, max: 85, step: 1, defaultValue: 58, digits: 0, suffix: "°" },
    { key: "yaw", label: "Giro 3D", min: -90, max: 90, step: 1, defaultValue: -16, digits: 0, suffix: "°" },
    { key: "rotation", label: "Rotación", min: -180, max: 180, step: 1, defaultValue: -32, digits: 0, suffix: "°" },
    { key: "circulation", label: "Circulación", min: 0, max: 4, step: 1, defaultValue: 1, digits: 0 },
    { key: "breathing", label: "Respiración", min: 0, max: 0.25, step: 0.01, defaultValue: 0.07, digits: 2 },
    { key: "precession", label: "Precesión", min: 0, max: 20, step: 0.5, defaultValue: 4, digits: 1, suffix: "°" },
    { key: "perspective", label: "Perspectiva", min: 0, max: 0.9, step: 0.01, defaultValue: 0.48, digits: 2 },
    { key: "depthFade", label: "Profundidad", min: 0, max: 0.85, step: 0.01, defaultValue: 0.46, digits: 2, group: "appearance" },
    { key: "stroke", label: "Trazo", min: 0.45, max: 20, step: 0.05, defaultValue: 1.15, digits: 2, group: "appearance" },
    { key: "gradientStrength", label: "Intensidad", min: 0, max: 1, step: 0.01, defaultValue: 0.7, digits: 2, group: "gradient" },
    { key: "gradientAngle", label: "Dirección", min: -180, max: 180, step: 1, defaultValue: -35, digits: 0, suffix: "°", group: "gradient" },
    { key: "gradientMidpoint", label: "Punto medio", min: 0.08, max: 0.92, step: 0.01, defaultValue: 0.46, digits: 2, group: "gradient" },
    { key: "textureMode", label: "Textura", min: 0, max: 2, step: 1, defaultValue: 0, digits: 0, group: "appearance", options: [
      { value: 0, label: "Lisa" },
      { value: 1, label: "Flujo" },
      { value: 2, label: "Grano" }
    ] },
    { key: "textureScale", label: "Escala de textura", min: 1, max: 12, step: 1, defaultValue: 4, digits: 0, group: "appearance" },
    { key: "textureStrength", label: "Intensidad de textura", min: 0, max: 1, step: 0.01, defaultValue: 0, digits: 2, group: "appearance" },
    { key: "textureMotion", label: "Movimiento de textura", min: -4, max: 4, step: 1, defaultValue: 1, digits: 0, group: "appearance" }
  ],
  defaults: {
    loopPhase: 0,
    currents: 15,
    width: 0.46,
    halfTwists: 1,
    tilt: 58,
    yaw: -16,
    rotation: -32,
    circulation: 1,
    breathing: 0.07,
    precession: 4,
    perspective: 0.48,
    depthFade: 0.46,
    stroke: 1.15,
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
