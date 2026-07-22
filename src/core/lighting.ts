import { clamp } from "./random";
import type {
  AmbientLightType,
  LightColorSource,
  LightingRigState,
  SpatialLightState,
  SpatialLightType,
  Vector3State
} from "./types";

export const MAX_SPATIAL_LIGHTS = 6;

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const LIGHT_TYPES = new Set<SpatialLightType>(["spot", "point", "directional", "rect-area"]);
const COLOR_SOURCES = new Set<LightColorSource>(["custom", "foreground", "accent", "secondary"]);
const AMBIENT_TYPES = new Set<AmbientLightType>(["none", "ambient", "hemisphere"]);
const SHADOW_MAP_SIZES = new Set([256, 512, 1024]);

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function colorValue(value: unknown, fallback: string): string {
  return typeof value === "string" && COLOR_PATTERN.test(value)
    ? value.toLowerCase()
    : fallback.toLowerCase();
}

function vectorValue(value: unknown, fallback: Vector3State, minimum: number, maximum: number): Vector3State {
  const candidate = value && typeof value === "object"
    ? value as Partial<Vector3State>
    : {};
  return {
    x: clamp(finiteNumber(candidate.x, fallback.x), minimum, maximum),
    y: clamp(finiteNumber(candidate.y, fallback.y), minimum, maximum),
    z: clamp(finiteNumber(candidate.z, fallback.z), minimum, maximum)
  };
}

export function cloneLightingRig(rig: LightingRigState | null | undefined): LightingRigState | null {
  return rig ? structuredClone(rig) : null;
}

export function normalizeSpatialLight(
  value: unknown,
  fallback: SpatialLightState,
  fallbackId: string
): SpatialLightState {
  const candidate = value && typeof value === "object"
    ? value as Partial<SpatialLightState>
    : {};
  const type = LIGHT_TYPES.has(candidate.type as SpatialLightType)
    ? candidate.type as SpatialLightType
    : fallback.type;
  const colorSource = COLOR_SOURCES.has(candidate.colorSource as LightColorSource)
    ? candidate.colorSource as LightColorSource
    : fallback.colorSource;
  const shadowMapSize = SHADOW_MAP_SIZES.has(candidate.shadowMapSize as number)
    ? candidate.shadowMapSize as 256 | 512 | 1024
    : fallback.shadowMapSize;
  const id = typeof candidate.id === "string" && candidate.id.trim()
    ? candidate.id.trim().slice(0, 80)
    : fallbackId;
  const name = typeof candidate.name === "string" && candidate.name.trim()
    ? candidate.name.trim().replace(/\s+/g, " ").slice(0, 48)
    : fallback.name;
  return {
    id,
    name,
    type,
    enabled: booleanValue(candidate.enabled, fallback.enabled),
    solo: booleanValue(candidate.solo, fallback.solo),
    colorSource,
    color: colorValue(candidate.color, fallback.color),
    intensity: clamp(finiteNumber(candidate.intensity, fallback.intensity), 0, 24),
    position: vectorValue(candidate.position, fallback.position, -4, 4),
    target: vectorValue(candidate.target, fallback.target, -3, 3),
    distance: clamp(finiteNumber(candidate.distance, fallback.distance), 0.1, 30),
    angle: clamp(finiteNumber(candidate.angle, fallback.angle), 5, 89),
    penumbra: clamp(finiteNumber(candidate.penumbra, fallback.penumbra), 0, 1),
    width: clamp(finiteNumber(candidate.width, fallback.width), 0.1, 8),
    height: clamp(finiteNumber(candidate.height, fallback.height), 0.1, 8),
    castShadow: booleanValue(candidate.castShadow, fallback.castShadow),
    shadowMapSize
  };
}

function legacyLight(defaultLight: SpatialLightState, parameters: Record<string, number> | undefined): SpatialLightState {
  if (!parameters) return defaultLight;
  return normalizeSpatialLight({
    ...defaultLight,
    position: {
      x: finiteNumber(parameters.lightX, defaultLight.position.x),
      y: finiteNumber(parameters.lightY, defaultLight.position.y),
      z: finiteNumber(parameters.lightZ, defaultLight.position.z)
    },
    target: {
      x: finiteNumber(parameters.lightTargetX, defaultLight.target.x),
      y: finiteNumber(parameters.lightTargetY, defaultLight.target.y),
      z: finiteNumber(parameters.lightTargetZ, defaultLight.target.z)
    },
    intensity: finiteNumber(parameters.lightIntensity, defaultLight.intensity),
    angle: finiteNumber(parameters.lightAngle, defaultLight.angle),
    penumbra: finiteNumber(parameters.lightPenumbra, defaultLight.penumbra),
    castShadow: finiteNumber(parameters.lightShadows, defaultLight.castShadow ? 1 : 0) >= 0.5
  }, defaultLight, defaultLight.id);
}

export function normalizeLightingRig(
  value: unknown,
  fallback: LightingRigState | null | undefined,
  legacyParameters?: Record<string, number>
): LightingRigState | null {
  if (!fallback) return null;
  const candidate = value && typeof value === "object"
    ? value as Partial<LightingRigState>
    : {};
  const environment: Partial<LightingRigState["environment"]> = candidate.environment && typeof candidate.environment === "object"
    ? candidate.environment
    : {};
  const ambient: Partial<LightingRigState["ambient"]> = candidate.ambient && typeof candidate.ambient === "object"
    ? candidate.ambient
    : {};
  const ambientType = AMBIENT_TYPES.has(ambient.type as AmbientLightType)
    ? ambient.type as AmbientLightType
    : fallback.ambient.type;
  const suppliedLights = Array.isArray(candidate.lights)
    ? candidate.lights.slice(0, MAX_SPATIAL_LIGHTS)
    : null;
  const fallbackLight = fallback.lights[0]!;
  const sourceLights = suppliedLights ?? [legacyLight(fallbackLight, legacyParameters)];
  const usedIds = new Set<string>();
  const lights = sourceLights.map((light, index) => {
    const sourceFallback = fallback.lights[index] ?? {
      ...fallbackLight,
      id: `light-${index + 1}`,
      name: `Luz ${index + 1}`,
      castShadow: false
    };
    const normalized = normalizeSpatialLight(light, sourceFallback, `light-${index + 1}`);
    let id = normalized.id;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${normalized.id}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return { ...normalized, id };
  });
  return {
    environment: {
      enabled: booleanValue(environment.enabled, fallback.environment.enabled),
      intensity: clamp(finiteNumber(environment.intensity, fallback.environment.intensity), 0, 3),
      rotation: clamp(finiteNumber(environment.rotation, fallback.environment.rotation), -180, 180)
    },
    ambient: {
      enabled: booleanValue(ambient.enabled, fallback.ambient.enabled),
      type: ambientType,
      color: colorValue(ambient.color, fallback.ambient.color),
      groundColor: colorValue(ambient.groundColor, fallback.ambient.groundColor),
      intensity: clamp(finiteNumber(ambient.intensity, fallback.ambient.intensity), 0, 5)
    },
    lights
  };
}

export function isLightingRigState(value: unknown): value is LightingRigState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<LightingRigState>;
  if (!candidate.environment || !candidate.ambient || !Array.isArray(candidate.lights)) return false;
  if (candidate.lights.length > MAX_SPATIAL_LIGHTS) return false;
  return candidate.lights.every((light) => (
    Boolean(light) &&
    typeof light === "object" &&
    typeof light.id === "string" &&
    typeof light.name === "string" &&
    LIGHT_TYPES.has(light.type) &&
    typeof light.enabled === "boolean" &&
    typeof light.solo === "boolean" &&
    COLOR_SOURCES.has(light.colorSource) &&
    COLOR_PATTERN.test(light.color) &&
    typeof light.intensity === "number" && Number.isFinite(light.intensity) &&
    Boolean(light.position) && Boolean(light.target)
  ));
}
