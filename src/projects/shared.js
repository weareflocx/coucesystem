export const TAU = Math.PI * 2;

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

export function createRandom(seed) {
  let state = seed >>> 0;

  return function random() {
    state += 0x6D2B79F5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function parameter(frame, key, fallback) {
  const value = frame.parameters[key];
  return Number.isFinite(value) ? value : fallback;
}

function parseHexColor(value, fallback) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return fallback;
  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16)
  ];
}

function toHexChannel(value) {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
}

function srgbChannelToLinear(value) {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function linearChannelToSrgb(value) {
  const channel = clamp(value, 0, 1);
  const encoded = channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
  return encoded * 255;
}

function hexToOklab(value, fallback) {
  const [red, green, blue] = parseHexColor(value, fallback);
  const r = srgbChannelToLinear(red);
  const g = srgbChannelToLinear(green);
  const b = srgbChannelToLinear(blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

function oklabToHex([lightness, axisA, axisB]) {
  const l = Math.pow(lightness + 0.3963377774 * axisA + 0.2158037573 * axisB, 3);
  const m = Math.pow(lightness - 0.1055613458 * axisA - 0.0638541728 * axisB, 3);
  const s = Math.pow(lightness - 0.0894841775 * axisA - 1.291485548 * axisB, 3);
  const red = linearChannelToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = linearChannelToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = linearChannelToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`;
}

export function mixOklabColors(from, to, amount) {
  const fallback = parseHexColor(from, [244, 243, 238]);
  const start = hexToOklab(from, fallback);
  const end = hexToOklab(to, fallback);
  const mix = clamp(amount, 0, 1);
  return oklabToHex([
    start[0] + (end[0] - start[0]) * mix,
    start[1] + (end[1] - start[1]) * mix,
    start[2] + (end[2] - start[2]) * mix
  ]);
}

export function mixHexColors(from, to, amount) {
  const start = parseHexColor(from, [244, 243, 238]);
  const end = parseHexColor(to, start);
  const mix = clamp(amount, 0, 1);
  return `#${toHexChannel(start[0] + (end[0] - start[0]) * mix)}${toHexChannel(start[1] + (end[1] - start[1]) * mix)}${toHexChannel(start[2] + (end[2] - start[2]) * mix)}`;
}

export function paletteAccent(frame) {
  return typeof frame.palette.accent === "string"
    ? frame.palette.accent
    : frame.palette.foreground;
}

export function paletteSecondary(frame) {
  return typeof frame.palette.secondary === "string"
    ? frame.palette.secondary
    : paletteAccent(frame);
}

export function appearanceParameters(frame) {
  const style = frame.appearance;
  if (style?.paint && style?.texture) {
    const gradient = style.paint.type === "gradient";
    const stops = gradient ? style.paint.stops : [];
    const middle = stops.length > 2
      ? stops.reduce((closest, stop) => (
        Math.abs(stop.position - 0.5) < Math.abs(closest.position - 0.5) ? stop : closest
      )).position
      : 0.5;
    const textureMode = style.texture.type === "none"
      ? 0
      : style.texture.preset === "flow" ? 1 : style.texture.preset === "grain" ? 2 : 3;
    return {
      gradientStrength: gradient ? 1 : 0,
      gradientAngle: (gradient ? style.paint.angle : 0) * Math.PI / 180,
      gradientMidpoint: middle,
      textureMode,
      textureScale: style.texture.type === "procedural" ? style.texture.scale : 4,
      textureStrength: style.texture.type === "procedural" ? style.texture.strength : 0,
      textureMotion: style.texture.type === "procedural" ? style.texture.motion : 1
    };
  }
  return {
    gradientStrength: clamp(parameter(frame, "gradientStrength", 0), 0, 1),
    gradientAngle: parameter(frame, "gradientAngle", 0) * Math.PI / 180,
    gradientMidpoint: clamp(parameter(frame, "gradientMidpoint", 0.46), 0.08, 0.92),
    textureMode: clamp(Math.round(parameter(frame, "textureMode", 0)), 0, 3),
    textureScale: clamp(Math.round(parameter(frame, "textureScale", 4)), 1, 12),
    textureStrength: clamp(parameter(frame, "textureStrength", 0), 0, 1),
    textureMotion: clamp(Math.round(parameter(frame, "textureMotion", 1)), -4, 4)
  };
}

export function linearGradientGeometry(frame, angle) {
  const centerX = frame.width * 0.5;
  const centerY = frame.height * 0.5;
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const halfSpan = Math.abs(directionX) * frame.width * 0.5 +
    Math.abs(directionY) * frame.height * 0.5;
  return {
    x1: centerX - directionX * halfSpan,
    y1: centerY - directionY * halfSpan,
    x2: centerX + directionX * halfSpan,
    y2: centerY + directionY * halfSpan
  };
}

export function paletteGradientStops(frame, suppliedAppearance, subdivisions = 8) {
  const appearance = suppliedAppearance ?? appearanceParameters(frame);
  if (frame.appearance?.paint?.type === "solid") {
    const count = Math.max(2, Math.round(subdivisions) * 2 + 1);
    return Array.from({ length: count }, (_, index) => ({
      offset: index / (count - 1),
      color: frame.appearance.paint.color,
      opacity: 1
    }));
  }
  if (frame.appearance?.paint?.type === "gradient") {
    const anchors = frame.appearance.paint.stops;
    const count = Math.max(2, Math.round(subdivisions) * 2 + 1);
    return Array.from({ length: count }, (_, index) => {
      const offset = index / (count - 1);
      const endIndex = anchors.findIndex((stop) => stop.position >= offset);
      if (endIndex <= 0) return { offset, color: anchors[0].color, opacity: 1 };
      if (endIndex < 0) return { offset, color: anchors[anchors.length - 1].color, opacity: 1 };
      const start = anchors[endIndex - 1];
      const end = anchors[endIndex];
      const progress = (offset - start.position) / Math.max(0.000001, end.position - start.position);
      return { offset, color: mixOklabColors(start.color, end.color, progress), opacity: 1 };
    });
  }
  const foreground = frame.palette.foreground;
  const anchors = [
    { offset: 0, color: foreground },
    {
      offset: appearance.gradientMidpoint,
      color: mixOklabColors(foreground, paletteAccent(frame), appearance.gradientStrength)
    },
    {
      offset: 1,
      color: mixOklabColors(foreground, paletteSecondary(frame), appearance.gradientStrength)
    }
  ];
  const stops = [];
  const steps = Math.max(1, Math.round(subdivisions));
  for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex += 1) {
    const start = anchors[anchorIndex];
    const end = anchors[anchorIndex + 1];
    for (let step = anchorIndex === 0 ? 0 : 1; step <= steps; step += 1) {
      const progress = step / steps;
      stops.push({
        offset: start.offset + (end.offset - start.offset) * progress,
        color: mixOklabColors(start.color, end.color, progress),
        opacity: 1
      });
    }
  }
  return stops;
}

export function canvasGradientStyle(context, frame, suppliedAppearance) {
  const appearance = suppliedAppearance ?? appearanceParameters(frame);
  if (frame.appearance?.paint?.type === "solid") return frame.appearance.paint.color;
  if (appearance.gradientStrength <= 0.001) return frame.palette.foreground;
  const vector = linearGradientGeometry(frame, appearance.gradientAngle);
  const gradient = context.createLinearGradient(vector.x1, vector.y1, vector.x2, vector.y2);
  for (const stop of paletteGradientStops(frame, appearance)) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  return gradient;
}

export function svgGradientDefinition(frame, suppliedAppearance, id) {
  const appearance = suppliedAppearance ?? appearanceParameters(frame);
  if (frame.appearance?.paint?.type === "solid") {
    return { definition: "", paint: frame.appearance.paint.color };
  }
  if (appearance.gradientStrength <= 0.001) {
    return { definition: "", paint: frame.palette.foreground };
  }
  const vector = linearGradientGeometry(frame, appearance.gradientAngle);
  const stops = paletteGradientStops(frame, appearance)
    .map((stop) => `<stop offset="${stop.offset.toFixed(4)}" stop-color="${stop.color}"/>`)
    .join("");
  return {
    definition: `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${vector.x1.toFixed(2)}" y1="${vector.y1.toFixed(2)}" x2="${vector.x2.toFixed(2)}" y2="${vector.y2.toFixed(2)}">${stops}</linearGradient></defs>`,
    paint: `url(#${id})`
  };
}

export function gradientControlDefinitions(
  defaultStrength = 0,
  defaultAngle = 0,
  defaultMidpoint = 0.46
) {
  return [
    { key: "gradientStrength", label: "Intensidad", min: 0, max: 1, step: 0.01, defaultValue: defaultStrength, digits: 2, group: "gradient" },
    { key: "gradientAngle", label: "Dirección", min: -180, max: 180, step: 1, defaultValue: defaultAngle, digits: 0, suffix: "°", group: "gradient" },
    { key: "gradientMidpoint", label: "Punto medio", min: 0.08, max: 0.92, step: 0.01, defaultValue: defaultMidpoint, digits: 2, group: "gradient" }
  ];
}

function hashUnit(value) {
  let state = value >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x7feb352d);
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b);
  return ((state ^ (state >>> 16)) >>> 0) / 4294967295;
}

export function appearanceSample(frame, u, suppliedAppearance) {
  const appearance = suppliedAppearance ?? appearanceParameters(frame);
  const normalizedU = positiveModulo(u, 1);
  const gradientWave = 0.5 - 0.5 * Math.cos(normalizedU * TAU - appearance.gradientAngle);
  let textureTone = 1;

  if (appearance.textureMode === 1) {
    const movement = positiveModulo(frame.time, 1) * appearance.textureMotion;
    textureTone = 0.5 + 0.5 * Math.cos(
      TAU * (normalizedU * appearance.textureScale - movement)
    );
  } else if (appearance.textureMode === 2) {
    const cell = Math.floor(normalizedU * appearance.textureScale * 32);
    textureTone = 0.3 + 0.7 * hashUnit((frame.seed >>> 0) ^ Math.imul(cell + 1, 0x9e3779b1));
  } else if (appearance.textureMode === 3) {
    const cell = Math.floor(normalizedU * appearance.textureScale * 8);
    const coarse = hashUnit((frame.seed >>> 0) ^ Math.imul(cell + 1, 0x85ebca6b));
    const vein = 0.5 + 0.5 * Math.cos(TAU * normalizedU * appearance.textureScale + coarse * TAU);
    textureTone = clamp(coarse * 0.58 + vein * 0.42, 0, 1);
  }

  return {
    gradientMix: appearance.gradientStrength * gradientWave,
    gradientPosition: gradientWave,
    textureDim: appearance.textureStrength * (1 - textureTone) * 0.78
  };
}

export function appearanceColor(frame, sample, fromColor = frame.palette.foreground, toColor = paletteAccent(frame)) {
  const gradientColor = mixHexColors(fromColor, toColor, sample.gradientMix);
  return mixHexColors(gradientColor, frame.palette.background, sample.textureDim);
}
