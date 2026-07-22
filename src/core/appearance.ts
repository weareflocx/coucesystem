import type {
  AppearanceGradientStop,
  AppearanceMaterial,
  AppearanceMaterialPreset,
  AppearanceStyle,
  AppearanceTexture,
  Palette
} from "./types";

export const APPEARANCE_SCHEMA_VERSION = 1;
export const APPEARANCE_MIN_STOPS = 2;
export const APPEARANCE_MAX_STOPS = 4;

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeHexColor(value: unknown, fallback = "#f4f3ee"): string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
    ? value.toLowerCase()
    : fallback.toLowerCase();
}

function parseHexColor(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16)
  ];
}

function toHexChannel(value: number): string {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
}

function srgbChannelToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function linearChannelToSrgb(value: number): number {
  const channel = clamp(value, 0, 1);
  return (channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055) * 255;
}

function hexToOklab(value: string): [number, number, number] {
  const [red, green, blue] = parseHexColor(value);
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

function oklabToHex([lightness, axisA, axisB]: [number, number, number]): string {
  const l = Math.pow(lightness + 0.3963377774 * axisA + 0.2158037573 * axisB, 3);
  const m = Math.pow(lightness - 0.1055613458 * axisA - 0.0638541728 * axisB, 3);
  const s = Math.pow(lightness - 0.0894841775 * axisA - 1.291485548 * axisB, 3);
  const red = linearChannelToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = linearChannelToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = linearChannelToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`;
}

export function mixAppearanceColors(from: string, to: string, amount: number): string {
  const start = hexToOklab(normalizeHexColor(from));
  const end = hexToOklab(normalizeHexColor(to, from));
  const mix = clamp(amount, 0, 1);
  return oklabToHex([
    start[0] + (end[0] - start[0]) * mix,
    start[1] + (end[1] - start[1]) * mix,
    start[2] + (end[2] - start[2]) * mix
  ]);
}

function normalizeStops(value: unknown, fallback: AppearanceGradientStop[]): AppearanceGradientStop[] {
  if (!Array.isArray(value)) return structuredClone(fallback);
  const stops = value
    .slice(0, APPEARANCE_MAX_STOPS)
    .map((entry, index) => {
      const candidate = entry && typeof entry === "object"
        ? entry as Partial<AppearanceGradientStop>
        : {};
      return {
        color: normalizeHexColor(candidate.color, fallback[Math.min(index, fallback.length - 1)]!.color),
        position: clamp(finite(candidate.position, index / Math.max(1, value.length - 1)), 0, 1)
      };
    })
    .sort((a, b) => a.position - b.position);
  if (stops.length < APPEARANCE_MIN_STOPS) return structuredClone(fallback);
  stops[0]!.position = 0;
  stops[stops.length - 1]!.position = 1;
  return stops;
}

function materialPreset(roughness: number, metalness: number, clearcoat: number): AppearanceMaterialPreset {
  if (metalness >= 0.65) return "metal";
  if (clearcoat >= 0.65 && roughness <= 0.3) return "glass";
  if (roughness <= 0.42 || clearcoat >= 0.25) return "satin";
  return "matte";
}

function normalizeMaterial(value: unknown, parameters: Record<string, number>): AppearanceMaterial {
  const candidate = value && typeof value === "object"
    ? value as Partial<AppearanceMaterial>
    : {};
  const roughness = clamp(finite(candidate.roughness, parameters.materialRoughness ?? parameters.roughness ?? 0.65), 0, 1);
  const metalness = clamp(finite(candidate.metalness, parameters.materialMetalness ?? parameters.metalness ?? 0), 0, 1);
  const clearcoat = clamp(finite(candidate.clearcoat, parameters.clearcoat ?? 0), 0, 1);
  const allowed: AppearanceMaterialPreset[] = ["matte", "satin", "metal", "glass"];
  return {
    preset: allowed.includes(candidate.preset as AppearanceMaterialPreset)
      ? candidate.preset as AppearanceMaterialPreset
      : materialPreset(roughness, metalness, clearcoat),
    roughness,
    metalness,
    clearcoat
  };
}

function legacyTexture(parameters: Record<string, number>): AppearanceTexture {
  const mode = Math.round(parameters.textureMode ?? (parameters.materialMode ? 3 : 0));
  if (mode <= 0) return { type: "none" };
  return {
    type: "procedural",
    preset: mode === 1 ? "flow" : mode === 2 ? "grain" : "mineral",
    scale: clamp(parameters.textureScale ?? parameters.mineralScale ?? 4, 0.1, 24),
    strength: clamp(parameters.textureStrength ?? parameters.paletteMix ?? 0.5, 0, 1),
    motion: clamp(parameters.textureMotion ?? 1, -4, 4)
  };
}

function normalizeTexture(value: unknown, parameters: Record<string, number>): AppearanceTexture {
  if (!value || typeof value !== "object") return legacyTexture(parameters);
  const candidate = value as Partial<AppearanceTexture> & Record<string, unknown>;
  if (candidate.type === "none") return { type: "none" };
  if (candidate.type !== "procedural") return legacyTexture(parameters);
  const preset = candidate.preset === "grain" || candidate.preset === "mineral"
    ? candidate.preset
    : "flow";
  return {
    type: "procedural",
    preset,
    scale: clamp(finite(candidate.scale, 4), 0.1, 24),
    strength: clamp(finite(candidate.strength, 0.5), 0, 1),
    motion: clamp(finite(candidate.motion, 1), -4, 4)
  };
}

export function appearanceFromLegacy(
  palette: Palette,
  parameters: Record<string, number> = {}
): AppearanceStyle {
  const background = normalizeHexColor(palette.background, "#11110f");
  const foreground = normalizeHexColor(palette.foreground, "#f4f3ee");
  const accent = normalizeHexColor(palette.accent, foreground);
  const secondary = normalizeHexColor(palette.secondary, accent);
  const strength = clamp(parameters.gradientStrength ?? 0, 0, 1);
  const midpoint = clamp(parameters.gradientMidpoint ?? 0.46, 0.08, 0.92);
  return {
    schemaVersion: APPEARANCE_SCHEMA_VERSION,
    background: { color: background },
    paint: strength <= 0.001
      ? { type: "solid", color: foreground }
      : {
          type: "gradient",
          mapping: "screen",
          angle: clamp(parameters.gradientAngle ?? 0, -180, 180),
          stops: [
            { position: 0, color: foreground },
            { position: midpoint, color: mixAppearanceColors(foreground, accent, strength) },
            { position: 1, color: mixAppearanceColors(foreground, secondary, strength) }
          ]
        },
    material: normalizeMaterial(undefined, parameters),
    texture: legacyTexture(parameters)
  };
}

export function normalizeAppearance(
  value: unknown,
  palette: Palette,
  parameters: Record<string, number> = {}
): AppearanceStyle {
  const fallback = appearanceFromLegacy(palette, parameters);
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<AppearanceStyle>;
  const background = normalizeHexColor(candidate.background?.color, fallback.background.color);
  let paint = fallback.paint;
  if (candidate.paint?.type === "solid") {
    paint = { type: "solid", color: normalizeHexColor(candidate.paint.color, palette.foreground) };
  } else if (candidate.paint?.type === "gradient") {
    const fallbackStops = fallback.paint.type === "gradient"
      ? fallback.paint.stops
      : [
          { position: 0, color: fallback.paint.color },
          { position: 1, color: normalizeHexColor(palette.secondary, palette.accent) }
        ];
    paint = {
      type: "gradient",
      mapping: candidate.paint.mapping === "surface" ? "surface" : "screen",
      angle: clamp(finite(candidate.paint.angle, 0), -180, 180),
      stops: normalizeStops(candidate.paint.stops, fallbackStops)
    };
  }
  return {
    schemaVersion: APPEARANCE_SCHEMA_VERSION,
    background: { color: background },
    paint,
    material: normalizeMaterial(candidate.material, parameters),
    texture: normalizeTexture(candidate.texture, parameters)
  };
}

export function isAppearanceStyle(value: unknown): value is AppearanceStyle {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppearanceStyle>;
  if (candidate.schemaVersion !== APPEARANCE_SCHEMA_VERSION) return false;
  if (!candidate.background || !HEX_COLOR_PATTERN.test(candidate.background.color ?? "")) return false;
  if (!candidate.paint || !candidate.material || !candidate.texture) return false;
  const paintValid = candidate.paint.type === "solid"
    ? HEX_COLOR_PATTERN.test(candidate.paint.color)
    : candidate.paint.type === "gradient" &&
      (candidate.paint.mapping === "screen" || candidate.paint.mapping === "surface") &&
      Number.isFinite(candidate.paint.angle) &&
      Array.isArray(candidate.paint.stops) &&
      candidate.paint.stops.length >= APPEARANCE_MIN_STOPS &&
      candidate.paint.stops.length <= APPEARANCE_MAX_STOPS &&
      candidate.paint.stops.every((stop, index, stops) => HEX_COLOR_PATTERN.test(stop.color) &&
        Number.isFinite(stop.position) && stop.position >= 0 && stop.position <= 1 &&
        (index === 0 || stop.position >= stops[index - 1]!.position));
  const materialValid = ["matte", "satin", "metal", "glass"].includes(candidate.material.preset) &&
    [candidate.material.roughness, candidate.material.metalness, candidate.material.clearcoat]
      .every((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1);
  const textureValid = candidate.texture.type === "none" || (
    candidate.texture.type === "procedural" &&
    ["flow", "grain", "mineral"].includes(candidate.texture.preset) &&
    Number.isFinite(candidate.texture.scale) && candidate.texture.scale >= 0.1 && candidate.texture.scale <= 24 &&
    Number.isFinite(candidate.texture.strength) && candidate.texture.strength >= 0 && candidate.texture.strength <= 1 &&
    Number.isFinite(candidate.texture.motion) && candidate.texture.motion >= -4 && candidate.texture.motion <= 4
  );
  return paintValid && materialValid && textureValid;
}

export function paletteFromAppearance(appearance: AppearanceStyle): Palette {
  if (appearance.paint.type === "solid") {
    return {
      background: appearance.background.color,
      foreground: appearance.paint.color,
      accent: appearance.paint.color,
      secondary: appearance.paint.color
    };
  }
  const stops = appearance.paint.stops;
  const middle = stops.reduce((closest, stop) =>
    Math.abs(stop.position - 0.5) < Math.abs(closest.position - 0.5) ? stop : closest
  );
  return {
    background: appearance.background.color,
    foreground: stops[0]!.color,
    accent: middle.color,
    secondary: stops[stops.length - 1]!.color
  };
}

export function legacyParametersFromAppearance(appearance: AppearanceStyle): Record<string, number> {
  const middle = appearance.paint.type === "gradient"
    ? appearance.paint.stops.reduce((closest, stop) =>
        Math.abs(stop.position - 0.5) < Math.abs(closest.position - 0.5) ? stop : closest
      ).position
    : 0.5;
  const textureMode = appearance.texture.type === "none"
    ? 0
    : appearance.texture.preset === "flow" ? 1 : appearance.texture.preset === "grain" ? 2 : 3;
  return {
    gradientStrength: appearance.paint.type === "gradient" ? 1 : 0,
    gradientAngle: appearance.paint.type === "gradient" ? appearance.paint.angle : 0,
    gradientMidpoint: middle,
    materialRoughness: appearance.material.roughness,
    materialMetalness: appearance.material.metalness,
    roughness: appearance.material.roughness,
    metalness: appearance.material.metalness,
    clearcoat: appearance.material.clearcoat,
    textureMode,
    textureScale: appearance.texture.type === "procedural" ? appearance.texture.scale : 4,
    textureStrength: appearance.texture.type === "procedural" ? appearance.texture.strength : 0,
    textureMotion: appearance.texture.type === "procedural" ? appearance.texture.motion : 1,
    materialMode: appearance.texture.type === "procedural" && appearance.texture.preset === "mineral" ? 1 : 0,
    paletteMix: 1,
    colorMode: 1,
    mineralScale: appearance.texture.type === "procedural"
      ? 0.01 + clamp(appearance.texture.scale / 24, 0, 1) * 0.29
      : 0.075,
    mineralWarp: appearance.texture.type === "procedural" ? appearance.texture.strength * 2 : 0.65,
    mineralContrast: appearance.texture.type === "procedural" ? 0.5 + appearance.texture.strength * 2.5 : 1.35
  };
}

export function colorAtAppearancePosition(appearance: AppearanceStyle, position: number): string {
  if (appearance.paint.type === "solid") return appearance.paint.color;
  const stops = appearance.paint.stops;
  const value = clamp(position, 0, 1);
  const endIndex = stops.findIndex((stop) => stop.position >= value);
  if (endIndex <= 0) return stops[0]!.color;
  if (endIndex < 0) return stops[stops.length - 1]!.color;
  const start = stops[endIndex - 1]!;
  const end = stops[endIndex]!;
  const amount = (value - start.position) / Math.max(0.000001, end.position - start.position);
  return mixAppearanceColors(start.color, end.color, amount);
}

export function sampledAppearanceStops(
  appearance: AppearanceStyle,
  subdivisions = 8
): AppearanceGradientStop[] {
  if (appearance.paint.type === "solid") {
    return [
      { position: 0, color: appearance.paint.color },
      { position: 1, color: appearance.paint.color }
    ];
  }
  const steps = Math.max(1, Math.round(subdivisions));
  const stops: AppearanceGradientStop[] = [];
  for (let index = 0; index <= steps * 2; index += 1) {
    const position = index / (steps * 2);
    stops.push({ position, color: colorAtAppearancePosition(appearance, position) });
  }
  return stops;
}

export interface BuiltInAppearancePreset {
  key: string;
  name: string;
  appearance: AppearanceStyle;
}

function builtIn(
  key: string,
  name: string,
  background: string,
  colors: string[],
  texture: AppearanceTexture = { type: "none" },
  material: AppearanceMaterial = { preset: "matte", roughness: 0.72, metalness: 0, clearcoat: 0 }
): BuiltInAppearancePreset {
  const stops = colors.map((color, index) => ({
    color,
    position: index / Math.max(1, colors.length - 1)
  }));
  return {
    key,
    name,
    appearance: {
      schemaVersion: 1,
      background: { color: background },
      paint: colors.length === 1
        ? { type: "solid", color: colors[0]! }
        : { type: "gradient", stops, mapping: "screen", angle: 0 },
      material,
      texture
    }
  };
}

export const BUILT_IN_APPEARANCE_PRESETS: BuiltInAppearancePreset[] = [
  builtIn("ink", "Tinta", "#11110f", ["#f4f3ee"]),
  builtIn("lagoon", "Laguna", "#071716", ["#7ce2cd", "#3a8fa3", "#645ee8"]),
  builtIn("copper", "Cobre", "#17110d", ["#f3d3a2", "#c97945", "#592c28"], { type: "procedural", preset: "grain", scale: 5, strength: 0.24, motion: 0 }),
  builtIn("mineral", "Mineral", "#0c1113", ["#dce5e5", "#76929a", "#28353b"], { type: "procedural", preset: "mineral", scale: 4, strength: 0.56, motion: 0 }, { preset: "satin", roughness: 0.38, metalness: 0.08, clearcoat: 0.42 }),
  builtIn("signal", "Señal", "#100e18", ["#ff4d73", "#ffb347", "#66e0ff", "#7967ff"])
];
