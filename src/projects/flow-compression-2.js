import { createCompressionGeometry } from "./flow-compression.js";
import {
  appearanceParameters,
  canvasGradientStyle,
  clamp,
  parameter,
  svgGradientDefinition
} from "./shared.js";
import { shortSideScale } from "./composition.js";

const PROJECT_ID = "flow-compression-2";
const WIDTH_BINS = 12;
const HORIZONTAL_SEED_OFFSET = 0x85ebca6b;

function horizontalFrame(frame) {
  return {
    ...frame,
    width: frame.height,
    height: frame.width,
    seed: (frame.seed ^ HORIZONTAL_SEED_OFFSET) >>> 0
  };
}

function appendFamily(frame, orientation, bins) {
  const familyFrame = orientation === "horizontal" ? horizontalFrame(frame) : frame;
  const geometry = createCompressionGeometry(familyFrame, true);
  const response = parameter(frame, "strokeResponse", 1.1);
  const invertPressure = parameter(frame, "widthDirection", 0) >= 0.5;

  for (let lineIndex = 0; lineIndex < geometry.lines.length; lineIndex += 1) {
    const line = geometry.lines[lineIndex];
    const densities = geometry.densities[lineIndex];

    for (let sample = 1; sample < densities.length; sample += 1) {
      const density = (densities[sample - 1] + densities[sample]) * 0.5;
      let tone = 0.5 + 0.5 * Math.tanh(density * response * 0.72);
      if (invertPressure) tone = 1 - tone;
      const binIndex = clamp(Math.floor(tone * WIDTH_BINS), 0, WIDTH_BINS - 1);
      const pointIndex = sample * 2;
      const previousIndex = pointIndex - 2;

      if (orientation === "horizontal") {
        bins[binIndex].push(
          line[previousIndex + 1],
          line[previousIndex],
          line[pointIndex + 1],
          line[pointIndex]
        );
      } else {
        bins[binIndex].push(
          line[previousIndex],
          line[previousIndex + 1],
          line[pointIndex],
          line[pointIndex + 1]
        );
      }
    }
  }
}

function createVariableGeometry(frame) {
  const orientation = Math.round(parameter(frame, "orientation", 2));
  const bins = Array.from({ length: WIDTH_BINS }, () => []);
  if (orientation === 0 || orientation === 2) appendFamily(frame, "vertical", bins);
  if (orientation === 1 || orientation === 2) appendFamily(frame, "horizontal", bins);
  return bins;
}

function strokeWidth(frame, tone) {
  const base = parameter(frame, "stroke", 1.45) * shortSideScale(frame);
  const range = parameter(frame, "strokeRange", 0.78);
  return base * Math.exp(range * (tone * 2 - 1));
}

function render(context, frame) {
  if (!frame.transparent) {
    context.fillStyle = frame.palette.background;
    context.fillRect(0, 0, frame.width, frame.height);
  }

  const bins = createVariableGeometry(frame);
  const appearance = appearanceParameters(frame);
  context.save();
  context.strokeStyle = canvasGradientStyle(context, frame, appearance);
  context.lineCap = "butt";
  context.lineJoin = "round";

  for (let binIndex = 0; binIndex < bins.length; binIndex += 1) {
    const segments = bins[binIndex];
    if (segments.length === 0) continue;
    const tone = (binIndex + 0.5) / WIDTH_BINS;
    context.lineWidth = strokeWidth(frame, tone);
    context.beginPath();
    for (let index = 0; index < segments.length; index += 4) {
      context.moveTo(segments[index], segments[index + 1]);
      context.lineTo(segments[index + 2], segments[index + 3]);
    }
    context.stroke();
  }
  context.restore();
}

function segmentsToPath(segments) {
  let path = "";
  for (let index = 0; index < segments.length; index += 4) {
    path += `M${segments[index].toFixed(2)} ${segments[index + 1].toFixed(2)}` +
      `L${segments[index + 2].toFixed(2)} ${segments[index + 3].toFixed(2)}`;
  }
  return path;
}

function toSvg(frame) {
  const bins = createVariableGeometry(frame);
  const appearance = appearanceParameters(frame);
  const gradient = svgGradientDefinition(frame, appearance, "compression-field-2-gradient");
  const background = frame.transparent
    ? ""
    : `<rect width="${frame.width}" height="${frame.height}" fill="${frame.palette.background}"/>`;
  const paths = bins.map((segments, binIndex) => {
    if (segments.length === 0) return "";
    const tone = (binIndex + 0.5) / WIDTH_BINS;
    return `<path d="${segmentsToPath(segments)}" fill="none" stroke="${gradient.paint}" stroke-width="${strokeWidth(frame, tone).toFixed(3)}" stroke-linecap="butt" stroke-linejoin="round"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><title>Cauce 01.1 — Compression Field 2</title>${gradient.definition}${background}${paths}</svg>`;
}

export const flowCompression2Project = {
  id: PROJECT_ID,
  index: "01.1",
  name: "Compression Field 2",
  label: "Cauce — Compression Field 2",
  description: "La presión modifica la posición y el grosor de dos familias opcionales de corrientes perpendiculares.",
  preferredFps: 30,
  preferredFormatKey: "square",
  preferredLoopSeconds: 8,
  controls: [
    {
      key: "orientation",
      label: "Dirección",
      min: 0,
      max: 2,
      step: 1,
      defaultValue: 2,
      digits: 0,
      options: [
        { value: 0, label: "Vertical" },
        { value: 1, label: "Horizontal" },
        { value: 2, label: "Vertical + horizontal" }
      ]
    },
    { key: "lines", label: "Líneas por dirección", min: 24, max: 180, step: 1, defaultValue: 72, digits: 0 },
    { key: "focus", label: "Focos", min: 3, max: 20, step: 1, defaultValue: 9, digits: 0 },
    { key: "compression", label: "Compresión", min: 0, max: 2.6, step: 0.05, defaultValue: 1.25, digits: 2 },
    { key: "flow", label: "Flujo", min: 0, max: 1.6, step: 0.05, defaultValue: 0.68, digits: 2 },
    { key: "frequency", label: "Frecuencia", min: 0.45, max: 2, step: 0.05, defaultValue: 1, digits: 2 },
    { key: "motion", label: "Deriva del cauce", min: 0, max: 1.4, step: 0.05, defaultValue: 0.72, digits: 2 },
    { key: "gradientStrength", label: "Intensidad", min: 0, max: 1, step: 0.01, defaultValue: 0.72, digits: 2, group: "gradient" },
    { key: "gradientAngle", label: "Dirección", min: -180, max: 180, step: 1, defaultValue: -24, digits: 0, suffix: "°", group: "gradient" },
    { key: "gradientMidpoint", label: "Punto medio", min: 0.08, max: 0.92, step: 0.01, defaultValue: 0.42, digits: 2, group: "gradient" },
    { key: "stroke", label: "Trazo base", min: 0.35, max: 4.5, step: 0.05, defaultValue: 1.45, digits: 2, group: "appearance" },
    { key: "strokeRange", label: "Rango de grosor", min: 0, max: 1.5, step: 0.02, defaultValue: 0.78, digits: 2, group: "appearance" },
    { key: "strokeResponse", label: "Respuesta de presión", min: 0.2, max: 3, step: 0.05, defaultValue: 1.1, digits: 2, group: "appearance" },
    {
      key: "widthDirection",
      label: "Relación de presión",
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 0,
      digits: 0,
      group: "appearance",
      options: [
        { value: 0, label: "Presión = grueso" },
        { value: 1, label: "Presión = fino" }
      ]
    }
  ],
  defaults: {
    orientation: 2,
    lines: 72,
    focus: 9,
    compression: 1.25,
    flow: 0.68,
    frequency: 1,
    motion: 0.72,
    gradientStrength: 0.72,
    gradientAngle: -24,
    gradientMidpoint: 0.42,
    stroke: 1.45,
    strokeRange: 0.78,
    strokeResponse: 1.1,
    widthDirection: 0
  },
  render,
  toSvg
};
