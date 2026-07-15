import { isEngineState } from "./preset";
import type { EngineState } from "./types";

const STORAGE_KEY = "cauce-studio.projects.v2";
const LEGACY_STORAGE_KEY = "cauce-studio.projects.v1";
const SCHEMA_VERSION = 2;

export interface SavedProjectRecord {
  schemaVersion: 2;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  time: number;
  state: EngineState;
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

function migrateLegacyRecords(): SavedProjectRecord[] {
  const migrated = parseArray(window.localStorage.getItem(LEGACY_STORAGE_KEY))
    .filter(isLegacySavedProject)
    .map((record) => ({ ...record, schemaVersion: 2 as const }));
  writeRecords(migrated);
  return migrated;
}

function readRecords(): SavedProjectRecord[] {
  const source = window.localStorage.getItem(STORAGE_KEY);
  if (source === null) return migrateLegacyRecords();
  return parseArray(source).filter(isSavedProject);
}

export function listSavedProjects(): SavedProjectRecord[] {
  return readRecords().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  writeRecords(readRecords().filter((record) => record.id !== projectId));
}
