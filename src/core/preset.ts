import type { EngineState } from "./types";
import { isLightingRigState } from "./lighting";
import { isAppearanceStyle } from "./appearance";

export const PRESET_SCHEMA_VERSION = 2;

export interface SharedPresetV2 {
  kind: "cauce-preset";
  schemaVersion: 2;
  name: string;
  createdAt: string;
  time: number;
  elapsedTime?: number;
  state: EngineState;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(isFiniteNumber);
}

function isCompatibleView(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return ["zoom", "panX", "panY", "orbitYaw", "orbitPitch"]
    .every((key) => isFiniteNumber(candidate[key]));
}

export function isEngineState(value: unknown): value is EngineState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EngineState>;
  return (
    typeof candidate.projectId === "string" &&
    typeof candidate.formatKey === "string" &&
    isFiniteNumber(candidate.seed) &&
    typeof candidate.palette === "object" &&
    candidate.palette !== null &&
    typeof candidate.palette.background === "string" &&
    typeof candidate.palette.foreground === "string" &&
    (candidate.palette.accent === undefined || typeof candidate.palette.accent === "string") &&
    (candidate.palette.secondary === undefined || typeof candidate.palette.secondary === "string") &&
    (candidate.appearance === undefined || isAppearanceStyle(candidate.appearance)) &&
    isCompatibleView(candidate.view) &&
    typeof candidate.playback === "object" &&
    candidate.playback !== null &&
    typeof candidate.playback.playing === "boolean" &&
    isFiniteNumber(candidate.playback.speed) &&
    isFiniteNumber(candidate.playback.loopSeconds) &&
    (
      candidate.playback.mode === undefined ||
      candidate.playback.mode === "loop" ||
      candidate.playback.mode === "continuous"
    ) &&
    isNumberRecord(candidate.parameters) &&
    (
      candidate.lighting === undefined ||
      candidate.lighting === null ||
      isLightingRigState(candidate.lighting)
    )
  );
}

function normalizeName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("El preset necesita un nombre.");
  return normalized.slice(0, 80);
}

function normalizeTime(time: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.min(0.999999, time));
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "preset";
}

export function createSharedPreset(
  name: string,
  state: EngineState,
  time: number,
  elapsedTime = time * state.playback.loopSeconds
): SharedPresetV2 {
  return {
    kind: "cauce-preset",
    schemaVersion: PRESET_SCHEMA_VERSION,
    name: normalizeName(name),
    createdAt: new Date().toISOString(),
    time: normalizeTime(time),
    elapsedTime: Math.max(0, isFiniteNumber(elapsedTime) ? elapsedTime : 0),
    state: structuredClone(state)
  };
}

export function parseSharedPreset(source: string): SharedPresetV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("El archivo no contiene JSON válido.");
  }

  if (!parsed || typeof parsed !== "object") throw new Error("El preset no es válido.");
  const candidate = parsed as Partial<SharedPresetV2>;
  if (candidate.kind !== "cauce-preset" || candidate.schemaVersion !== PRESET_SCHEMA_VERSION) {
    throw new Error("Versión de preset no compatible.");
  }
  if (typeof candidate.name !== "string" || !isEngineState(candidate.state)) {
    throw new Error("El preset está incompleto o contiene parámetros no válidos.");
  }

  return {
    kind: "cauce-preset",
    schemaVersion: PRESET_SCHEMA_VERSION,
    name: normalizeName(candidate.name),
    createdAt: typeof candidate.createdAt === "string"
      ? candidate.createdAt
      : new Date().toISOString(),
    time: normalizeTime(candidate.time ?? 0),
    elapsedTime: isFiniteNumber(candidate.elapsedTime)
      ? Math.max(0, candidate.elapsedTime)
      : normalizeTime(candidate.time ?? 0) * candidate.state.playback.loopSeconds,
    state: structuredClone(candidate.state)
  };
}

export function createPresetDownload(
  name: string,
  state: EngineState,
  time: number,
  elapsedTime = time * state.playback.loopSeconds
): { blob: Blob; filename: string; preset: SharedPresetV2 } {
  const preset = createSharedPreset(name, state, time, elapsedTime);
  return {
    blob: new Blob([`${JSON.stringify(preset, null, 2)}\n`], {
      type: "application/json;charset=utf-8"
    }),
    filename: `${slugify(preset.name)}.cauce.json`,
    preset
  };
}
