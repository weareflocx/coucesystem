import { isEngineState } from "./preset";
import type { EngineState, Palette } from "./types";

const STORAGE_KEY = "cauce-studio.projects.v2";
const LEGACY_STORAGE_KEY = "cauce-studio.projects.v1";
const COLOR_STORAGE_KEY = "cauce-studio.colors.v1";
const TOMBSTONE_STORAGE_KEY = "cauce-studio.tombstones.v1";
const SCHEMA_VERSION = 2;
const COLOR_SCHEMA_VERSION = 1;
const LIBRARY_SCHEMA_VERSION = 1;

export interface SavedProjectRecord {
  schemaVersion: 2;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  time: number;
  state: EngineState;
}

export interface SavedColorGradient {
  strength: number;
  angle: number;
  midpoint: number;
}

export interface SavedColorRecord {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  palette: Palette;
  gradient: SavedColorGradient;
}

export interface SavedLibraryTombstone {
  schemaVersion: 1;
  id: string;
  kind: "project" | "color";
  deletedAt: string;
}

interface LegacySavedProjectRecord {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  time: number;
  state: EngineState;
}

interface SavedLibraryBackup {
  kind: "cauce-library";
  schemaVersion: 1;
  createdAt: string;
  records: SavedProjectRecord[];
  colors: SavedColorRecord[];
  tombstones: SavedLibraryTombstone[];
}

export interface LibraryBackupDownload {
  blob: Blob;
  filename: string;
  count: number;
  colorCount: number;
}

export interface LibraryImportResult {
  added: number;
  updated: number;
  total: number;
  colorsAdded: number;
  colorsUpdated: number;
  colorsTotal: number;
}

export interface LibraryReplaceResult extends LibraryImportResult {
  removed: number;
  colorsRemoved: number;
}

export function isLibraryStorageKey(key: string | null): boolean {
  return key === STORAGE_KEY ||
    key === LEGACY_STORAGE_KEY ||
    key === COLOR_STORAGE_KEY ||
    key === TOMBSTONE_STORAGE_KEY;
}

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function isSavedColor(value: unknown): value is SavedColorRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedColorRecord>;
  const palette = candidate.palette;
  const gradient = candidate.gradient;
  return candidate.schemaVersion === COLOR_SCHEMA_VERSION &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    Boolean(palette) &&
    COLOR_PATTERN.test(palette!.background) &&
    COLOR_PATTERN.test(palette!.foreground) &&
    COLOR_PATTERN.test(palette!.accent) &&
    (palette!.secondary === undefined || COLOR_PATTERN.test(palette!.secondary)) &&
    Boolean(gradient) &&
    Number.isFinite(gradient!.strength) &&
    Number.isFinite(gradient!.angle) &&
    Number.isFinite(gradient!.midpoint);
}

function isSavedLibraryTombstone(value: unknown): value is SavedLibraryTombstone {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedLibraryTombstone>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    (candidate.kind === "project" || candidate.kind === "color") &&
    typeof candidate.deletedAt === "string" &&
    candidate.deletedAt.length > 0;
}

function normalizeSavedColor(record: SavedColorRecord): SavedColorRecord {
  return {
    ...record,
    palette: {
      ...record.palette,
      secondary: record.palette.secondary ?? record.palette.accent
    },
    gradient: {
      strength: Math.max(0, Math.min(1, record.gradient.strength)),
      angle: Math.max(-180, Math.min(180, record.gradient.angle)),
      midpoint: Math.max(0.08, Math.min(0.92, record.gradient.midpoint))
    }
  };
}

function hasRecordFields(value: unknown): value is Omit<SavedProjectRecord, "schemaVersion"> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedProjectRecord>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.time === "number" &&
    Number.isFinite(candidate.time) &&
    isEngineState(candidate.state)
  );
}

function isSavedProject(value: unknown): value is SavedProjectRecord {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Partial<SavedProjectRecord>).schemaVersion === SCHEMA_VERSION &&
    hasRecordFields(value)
  );
}

function isLegacySavedProject(value: unknown): value is LegacySavedProjectRecord {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Partial<LegacySavedProjectRecord>).schemaVersion === 1 &&
    hasRecordFields(value)
  );
}

function normalizeStoredProject(value: unknown): SavedProjectRecord | null {
  if (isSavedProject(value)) return value;
  if (isLegacySavedProject(value)) return { ...value, schemaVersion: 2 };
  return null;
}

function parseArray(source: string | null): unknown[] {
  if (!source) return [];
  try {
    const parsed: unknown = JSON.parse(source);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecords(records: SavedProjectRecord[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function writeColorRecords(records: SavedColorRecord[]): void {
  window.localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(records));
}

function writeTombstones(tombstones: SavedLibraryTombstone[]): void {
  window.localStorage.setItem(TOMBSTONE_STORAGE_KEY, JSON.stringify(tombstones));
}

function readColorRecords(): SavedColorRecord[] {
  return parseArray(window.localStorage.getItem(COLOR_STORAGE_KEY))
    .filter(isSavedColor)
    .map(normalizeSavedColor);
}

function readTombstones(): SavedLibraryTombstone[] {
  return parseArray(window.localStorage.getItem(TOMBSTONE_STORAGE_KEY))
    .filter(isSavedLibraryTombstone);
}

function tombstoneKey(tombstone: SavedLibraryTombstone): string {
  return `${tombstone.kind}:${tombstone.id}`;
}

function mergeTombstones(
  current: SavedLibraryTombstone[],
  incoming: SavedLibraryTombstone[]
): SavedLibraryTombstone[] {
  const merged = new Map(current.map((tombstone) => [tombstoneKey(tombstone), tombstone]));
  for (const tombstone of incoming) {
    const key = tombstoneKey(tombstone);
    const existing = merged.get(key);
    if (!existing || tombstone.deletedAt > existing.deletedAt) {
      merged.set(key, tombstone);
    }
  }
  return Array.from(merged.values());
}

function applyProjectTombstones(
  records: SavedProjectRecord[],
  tombstones: SavedLibraryTombstone[]
): SavedProjectRecord[] {
  const deletedAtById = new Map(tombstones
    .filter((tombstone) => tombstone.kind === "project")
    .map((tombstone) => [tombstone.id, tombstone.deletedAt]));
  return records.filter((record) => {
    const deletedAt = deletedAtById.get(record.id);
    return !deletedAt || record.updatedAt > deletedAt;
  });
}

function applyColorTombstones(
  records: SavedColorRecord[],
  tombstones: SavedLibraryTombstone[]
): SavedColorRecord[] {
  const deletedAtById = new Map(tombstones
    .filter((tombstone) => tombstone.kind === "color")
    .map((tombstone) => [tombstone.id, tombstone.deletedAt]));
  return records.filter((record) => {
    const deletedAt = deletedAtById.get(record.id);
    return !deletedAt || record.updatedAt > deletedAt;
  });
}

function addTombstone(id: string, kind: SavedLibraryTombstone["kind"]): void {
  const tombstone: SavedLibraryTombstone = {
    schemaVersion: 1,
    id,
    kind,
    deletedAt: new Date().toISOString()
  };
  writeTombstones(mergeTombstones(readTombstones(), [tombstone]));
}

function readRecords(): SavedProjectRecord[] {
  const recordsById = new Map<string, SavedProjectRecord>();
  const sources = [
    ...parseArray(window.localStorage.getItem(LEGACY_STORAGE_KEY)),
    ...parseArray(window.localStorage.getItem(STORAGE_KEY))
  ];

  for (const source of sources) {
    const record = normalizeStoredProject(source);
    if (!record) continue;
    const existing = recordsById.get(record.id);
    if (!existing || record.updatedAt > existing.updatedAt) recordsById.set(record.id, record);
  }
  return Array.from(recordsById.values());
}

function parseLibraryBackup(source: string): SavedLibraryBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("La copia de la biblioteca no contiene JSON válido.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("El archivo no es una copia de biblioteca válida.");
  }
  const candidate = parsed as Partial<SavedLibraryBackup>;
  if (
    candidate.kind !== "cauce-library" ||
    candidate.schemaVersion !== LIBRARY_SCHEMA_VERSION ||
    !Array.isArray(candidate.records)
  ) {
    throw new Error("El archivo no es una copia de biblioteca compatible.");
  }
  if (!candidate.records.every(isSavedProject)) {
    throw new Error("La copia contiene uno o más proyectos incompletos.");
  }
  const colors = candidate.colors ?? [];
  if (!Array.isArray(colors) || !colors.every(isSavedColor)) {
    throw new Error("La copia contiene una o más paletas incompletas.");
  }
  const tombstones = candidate.tombstones ?? [];
  if (!Array.isArray(tombstones) || !tombstones.every(isSavedLibraryTombstone)) {
    throw new Error("La copia contiene eliminaciones no válidas.");
  }
  return {
    kind: "cauce-library",
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    createdAt: typeof candidate.createdAt === "string"
      ? candidate.createdAt
      : new Date().toISOString(),
    records: structuredClone(candidate.records),
    colors: colors.map((record) => structuredClone(normalizeSavedColor(record))),
    tombstones: structuredClone(tombstones)
  };
}

export function listSavedProjects(): SavedProjectRecord[] {
  return applyProjectTombstones(readRecords(), readTombstones())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listSavedColors(): SavedColorRecord[] {
  return applyColorTombstones(readColorRecords(), readTombstones())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveColor(
  name: string,
  palette: Palette,
  gradient: SavedColorGradient
): SavedColorRecord {
  const now = new Date().toISOString();
  const record = normalizeSavedColor({
    schemaVersion: COLOR_SCHEMA_VERSION,
    id: window.crypto.randomUUID(),
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    palette: structuredClone(palette),
    gradient: structuredClone(gradient)
  });
  writeColorRecords([...readColorRecords(), record]);
  return record;
}

export function deleteColor(colorId: string): void {
  const records = readColorRecords();
  if (records.some((record) => record.id === colorId)) addTombstone(colorId, "color");
  writeColorRecords(records.filter((record) => record.id !== colorId));
}

export function saveProject(name: string, state: EngineState, time: number): SavedProjectRecord {
  const now = new Date().toISOString();
  const record: SavedProjectRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: window.crypto.randomUUID(),
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    time,
    state: structuredClone(state)
  };
  const records = readRecords();
  records.push(record);
  writeRecords(records);
  return record;
}

export function deleteProject(projectId: string): void {
  const records = readRecords();
  if (records.some((record) => record.id === projectId)) addTombstone(projectId, "project");
  writeRecords(records.filter((record) => record.id !== projectId));
}

export function createLibraryBackupDownload(): LibraryBackupDownload {
  const tombstones = readTombstones();
  const records = applyProjectTombstones(readRecords(), tombstones);
  const colors = applyColorTombstones(readColorRecords(), tombstones);
  const backup: SavedLibraryBackup = {
    kind: "cauce-library",
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    records: structuredClone(records),
    colors: structuredClone(colors),
    tombstones: structuredClone(tombstones)
  };
  return {
    blob: new Blob([`${JSON.stringify(backup, null, 2)}\n`], {
      type: "application/json;charset=utf-8"
    }),
    filename: `cauce-library-${backup.createdAt.slice(0, 10)}.json`,
    count: records.length,
    colorCount: colors.length
  };
}

export function importLibraryBackup(source: string): LibraryImportResult {
  const candidate = parseLibraryBackup(source);
  const tombstones = mergeTombstones(readTombstones(), candidate.tombstones);

  const recordsById = new Map(readRecords().map((record) => [record.id, record]));
  let added = 0;
  let updated = 0;
  for (const record of candidate.records) {
    const existing = recordsById.get(record.id);
    if (!existing) {
      recordsById.set(record.id, structuredClone(record));
      added += 1;
    } else if (record.updatedAt > existing.updatedAt) {
      recordsById.set(record.id, structuredClone(record));
      updated += 1;
    }
  }

  const records = applyProjectTombstones(Array.from(recordsById.values()), tombstones);
  const colorsById = new Map(readColorRecords().map((record) => [record.id, record]));
  let colorsAdded = 0;
  let colorsUpdated = 0;
  for (const record of candidate.colors) {
    const existing = colorsById.get(record.id);
    if (!existing) {
      colorsById.set(record.id, structuredClone(record));
      colorsAdded += 1;
    } else if (record.updatedAt > existing.updatedAt) {
      colorsById.set(record.id, structuredClone(record));
      colorsUpdated += 1;
    }
  }
  const colors = applyColorTombstones(Array.from(colorsById.values()), tombstones);
  writeRecords(records);
  writeColorRecords(colors);
  writeTombstones(tombstones);
  return {
    added,
    updated,
    total: records.length,
    colorsAdded,
    colorsUpdated,
    colorsTotal: colors.length
  };
}

export function replaceLibraryBackup(source: string): LibraryReplaceResult {
  const candidate = parseLibraryBackup(source);
  const records = applyProjectTombstones(candidate.records, candidate.tombstones);
  const colors = applyColorTombstones(candidate.colors, candidate.tombstones);
  const currentById = new Map(readRecords().map((record) => [record.id, record]));
  let added = 0;
  let updated = 0;

  for (const record of records) {
    const existing = currentById.get(record.id);
    if (!existing) added += 1;
    else if (record.updatedAt !== existing.updatedAt) updated += 1;
  }

  const nextIds = new Set(records.map((record) => record.id));
  const removed = Array.from(currentById.keys()).filter((id) => !nextIds.has(id)).length;
  const currentColorsById = new Map(readColorRecords().map((record) => [record.id, record]));
  let colorsAdded = 0;
  let colorsUpdated = 0;
  for (const record of colors) {
    const existing = currentColorsById.get(record.id);
    if (!existing) colorsAdded += 1;
    else if (record.updatedAt !== existing.updatedAt) colorsUpdated += 1;
  }
  const nextColorIds = new Set(colors.map((record) => record.id));
  const colorsRemoved = Array.from(currentColorsById.keys())
    .filter((id) => !nextColorIds.has(id)).length;
  writeRecords(records);
  writeColorRecords(colors);
  writeTombstones(candidate.tombstones);
  return {
    added,
    updated,
    removed,
    total: records.length,
    colorsAdded,
    colorsUpdated,
    colorsRemoved,
    colorsTotal: colors.length
  };
}
