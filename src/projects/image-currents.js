import {
  TAU,
  appearanceParameters,
  canvasGradientStyle,
  clamp,
  gradientControlDefinitions,
  parameter,
  svgGradientDefinition
} from "./shared.js";

const PROJECT_ID = "image-currents";
const TONE_BINS = 12;
let toneFieldCache = null;

function fallbackLuminance(u, v) {
  const x = (u - 0.5) / 0.34;
  const y = (v - 0.51) / 0.43;
  const insideHead = x * x + y * y < 1;
  if (!insideHead) return 1;

  const gaussian = (centerX, centerY, radiusX, radiusY) => Math.exp(
    -Math.pow((x - centerX) / radiusX, 2) - Math.pow((y - centerY) / radiusY, 2)
  );
  const sideShadow = clamp((x + 0.18) * 0.22, 0, 0.22);
  const hair = gaussian(0, -0.82, 0.9, 0.34) * 0.52;
  const eyes = (
    gaussian(-0.34, -0.18, 0.18, 0.1) +
    gaussian(0.34, -0.18, 0.18, 0.1)
  ) * 0.55;
  const nose = gaussian(0.03, 0.12, 0.08, 0.27) * 0.22;
  const mouth = gaussian(0, 0.48, 0.3, 0.07) * 0.48;
  const chin = gaussian(0, 0.78, 0.45, 0.18) * 0.12;
  return 1 - clamp(0.2 + sideShadow + hair + eyes + nose + mouth + chin, 0, 0.94);
}

function bilinearLuminance(field, u, v) {
  if (u < 0 || u > 1 || v < 0 || v > 1) return 1;
  const x = u * (field.width - 1);
  const y = v * (field.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(field.width - 1, x0 + 1);
  const y1 = Math.min(field.height - 1, y0 + 1);
  const mixX = x - x0;
  const mixY = y - y0;
  const top = field.luminance[y0 * field.width + x0] * (1 - mixX) +
    field.luminance[y0 * field.width + x1] * mixX;
  const bottom = field.luminance[y1 * field.width + x0] * (1 - mixX) +
    field.luminance[y1 * field.width + x1] * mixX;
  return (top * (1 - mixY) + bottom * mixY) / 255;
}

function sourceCoordinates(frame, u, v) {
  const field = frame.imageField;
  const artAspect = frame.width / frame.height;
  const imageAspect = field ? field.width / field.height : 1;
  let imageU = u;
  let imageV = v;

  if (imageAspect > artAspect) {
    imageU = 0.5 + (u - 0.5) * artAspect / imageAspect;
  } else {
    imageV = 0.5 + (v - 0.5) * imageAspect / artAspect;
  }

  const zoom = parameter(frame, "imageZoom", 1);
  imageU = 0.5 + (imageU - 0.5) / zoom + parameter(frame, "imageX", 0) * 0.35;
  imageV = 0.5 + (imageV - 0.5) / zoom + parameter(frame, "imageY", 0) * 0.35;
  return [imageU, imageV];
}

function rawLuminance(frame, u, v) {
  const [imageU, imageV] = sourceCoordinates(frame, u, v);
  return frame.imageField
    ? bilinearLuminance(frame.imageField, imageU, imageV)
    : fallbackLuminance(imageU, imageV);
}

function sourceTone(frame, u, v) {
  const softness = parameter(frame, "softness", 1.5);
  const radius = softness / Math.min(frame.width, frame.height);
  const luminance = radius > 0
    ? (
        rawLuminance(frame, u, v) * 4 +
        rawLuminance(frame, u - radius, v) +
        rawLuminance(frame, u + radius, v) +
        rawLuminance(frame, u, v - radius) +
        rawLuminance(frame, u, v + radius)
      ) / 8
    : rawLuminance(frame, u, v);
  const contrast = parameter(frame, "contrast", 1.45);
  const gamma = parameter(frame, "gamma", 0.9);
  let tone = clamp((1 - luminance - 0.5) * contrast + 0.5, 0, 1);
  tone = Math.pow(tone, gamma);
  if (parameter(frame, "invertImage", 0) >= 0.5) tone = 1 - tone;
  return tone;
}

function toneFieldKey(frame, density, lineCount, sampleCount) {
  return [
    frame.width,
    frame.height,
    density,
    lineCount,
    sampleCount,
    parameter(frame, "contrast", 1.45),
    parameter(frame, "gamma", 0.9),
    parameter(frame, "softness", 1.5),
    parameter(frame, "invertImage", 0),
    parameter(frame, "imageZoom", 1),
    parameter(frame, "imageX", 0),
    parameter(frame, "imageY", 0)
  ].join(":");
}

function getToneField(frame, density, lineSpacing, lineCount, sampleCount) {
  const key = toneFieldKey(frame, density, lineCount, sampleCount);
  if (
    toneFieldCache &&
    toneFieldCache.key === key &&
    toneFieldCache.imageField === frame.imageField
  ) {
    return toneFieldCache.tones;
  }

  const samplesPerLine = sampleCount + 1;
  const tones = new Float32Array(lineCount * samplesPerLine);
  for (let lineSlot = 0; lineSlot < lineCount; lineSlot += 1) {
    const lineIndex = lineSlot - 1;
    const baseY = (lineIndex + 0.5) * lineSpacing;
    const v = clamp(baseY / frame.height, 0, 1);
    for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
      tones[lineSlot * samplesPerLine + sampleIndex] = sourceTone(
        frame,
        sampleIndex / sampleCount,
        v
      );
    }
  }

  toneFieldCache = { key, imageField: frame.imageField, tones };
  return tones;
}

function createGeometry(frame) {
  const shortSide = Math.min(frame.width, frame.height);
  const density = Math.max(12, Math.round(parameter(frame, "lines", 96)));
  const lineSpacing = shortSide / density;
  const lineCount = Math.ceil(frame.height / lineSpacing) + 2;
  const sampleCount = Math.max(80, Math.ceil(frame.width / shortSide * 230));
  const amplitude = parameter(frame, "amplitude", 0.52);
  const relief = parameter(frame, "relief", 0.28);
  const frequency = Math.round(parameter(frame, "frequency", 5));
  const motion = Math.round(parameter(frame, "motion", 1));
  const phase = frame.time * motion;
  const seedPhase = (frame.seed % 8192) / 8192;
  const bins = Array.from({ length: TONE_BINS }, () => []);
  const tones = getToneField(frame, density, lineSpacing, lineCount, sampleCount);
  const samplesPerLine = sampleCount + 1;

  for (let lineSlot = 0; lineSlot < lineCount; lineSlot += 1) {
    const lineIndex = lineSlot - 1;
    const baseY = (lineIndex + 0.5) * lineSpacing;
    let previous = null;

    for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
      const u = sampleIndex / sampleCount;
      const tone = tones[lineSlot * samplesPerLine + sampleIndex];
      const wavePhase = TAU * (
        frequency * u +
        lineIndex * 0.021 +
        seedPhase +
        phase
      );
      const wave = Math.sin(wavePhase) * 0.78 + Math.sin(wavePhase * 2 - 0.7) * 0.22;
      const y = baseY + lineSpacing * (
        relief * (tone - 0.5) +
        amplitude * (0.18 + tone * 0.82) * wave
      );
      const point = { x: u * frame.width, y, tone };

      if (previous) {
        const segmentTone = (previous.tone + tone) * 0.5;
        const bin = clamp(Math.floor(segmentTone * TONE_BINS), 0, TONE_BINS - 1);
        bins[bin].push(previous.x, previous.y, point.x, point.y);
      }
      previous = point;
    }
  }

  return {
    bins,
    stroke: parameter(frame, "stroke", 1.05) * shortSide / 760,
    minimumInk: parameter(frame, "minimumInk", 0.035)
  };
}

function render(context, frame) {
  if (!frame.transparent) {
    context.fillStyle = frame.palette.background;
    context.fillRect(0, 0, frame.width, frame.height);
  }

  const geometry = createGeometry(frame);
  context.save();
  context.strokeStyle = canvasGradientStyle(context, frame, appearanceParameters(frame));
  context.lineCap = "butt";
  context.lineJoin = "round";

  for (let binIndex = 0; binIndex < geometry.bins.length; binIndex += 1) {
    const segments = geometry.bins[binIndex];
    if (segments.length === 0) continue;
    const tone = (binIndex + 0.5) / TONE_BINS;
    context.globalAlpha = geometry.minimumInk + (1 - geometry.minimumInk) * tone;
    context.lineWidth = geometry.stroke * (0.68 + tone * 0.92);
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
  const geometry = createGeometry(frame);
  const gradient = svgGradientDefinition(frame, appearanceParameters(frame), "image-currents-gradient");
  const background = frame.transparent
    ? ""
    : `<rect width="${frame.width}" height="${frame.height}" fill="${frame.palette.background}"/>`;
  const paths = geometry.bins.map((segments, binIndex) => {
    if (segments.length === 0) return "";
    const tone = (binIndex + 0.5) / TONE_BINS;
    const opacity = geometry.minimumInk + (1 - geometry.minimumInk) * tone;
    const width = geometry.stroke * (0.68 + tone * 0.92);
    return `<path d="${segmentsToPath(segments)}" fill="none" stroke="${gradient.paint}" stroke-width="${width.toFixed(3)}" stroke-opacity="${opacity.toFixed(3)}" stroke-linecap="butt" stroke-linejoin="round"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><title>Cauce 07 — Image Currents</title>${gradient.definition}${background}${paths}</svg>`;
}

export const imageCurrentsProject = {
  id: PROJECT_ID,
  index: "07",
  name: "Image Currents",
  label: "Cauce — Image Currents",
  description: "Interpreta una fotografía como un campo de corrientes vectoriales modulado por luminancia.",
  preferredFps: 30,
  preferredFormatKey: "portrait",
  preferredLoopSeconds: 6,
  controls: [
    { key: "lines", label: "Líneas", min: 36, max: 180, step: 1, defaultValue: 96, digits: 0 },
    { key: "contrast", label: "Contraste", min: 0.5, max: 3, step: 0.05, defaultValue: 1.45, digits: 2 },
    { key: "gamma", label: "Gamma", min: 0.4, max: 2.4, step: 0.05, defaultValue: 0.9, digits: 2 },
    { key: "softness", label: "Suavizado", min: 0, max: 8, step: 0.25, defaultValue: 1.5, digits: 2 },
    { key: "invertImage", label: "Interpretación", min: 0, max: 1, step: 1, defaultValue: 0, digits: 0, options: [{ value: 0, label: "Oscuro = tinta" }, { value: 1, label: "Claro = tinta" }] },
    { key: "imageZoom", label: "Zoom de imagen", min: 0.75, max: 3, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "imageX", label: "Encuadre X", min: -0.6, max: 0.6, step: 0.01, defaultValue: 0, digits: 2 },
    { key: "imageY", label: "Encuadre Y", min: -0.6, max: 0.6, step: 0.01, defaultValue: 0, digits: 2 },
    { key: "amplitude", label: "Amplitud", min: 0, max: 1.2, step: 0.01, defaultValue: 0.52, digits: 2 },
    { key: "relief", label: "Relieve", min: 0, max: 0.9, step: 0.01, defaultValue: 0.28, digits: 2 },
    { key: "frequency", label: "Frecuencia", min: 1, max: 12, step: 1, defaultValue: 5, digits: 0 },
    { key: "motion", label: "Flujo", min: -4, max: 4, step: 1, defaultValue: 1, digits: 0 },
    ...gradientControlDefinitions(0, 0, 0.46),
    { key: "stroke", label: "Grosor", min: 0.4, max: 3.5, step: 0.05, defaultValue: 1.05, digits: 2, group: "appearance" },
    { key: "minimumInk", label: "Tinta mínima", min: 0, max: 0.35, step: 0.005, defaultValue: 0.035, digits: 3, group: "appearance" }
  ],
  defaults: {
    lines: 96,
    contrast: 1.45,
    gamma: 0.9,
    softness: 1.5,
    invertImage: 0,
    imageZoom: 1,
    imageX: 0,
    imageY: 0,
    amplitude: 0.52,
    relief: 0.28,
    frequency: 5,
    motion: 1,
    gradientStrength: 0,
    gradientAngle: 0,
    gradientMidpoint: 0.46,
    stroke: 1.05,
    minimumInk: 0.035
  },
  render,
  toSvg
};
