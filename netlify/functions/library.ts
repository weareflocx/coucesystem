import { createHash, timingSafeEqual } from "node:crypto";

import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

const STORE_NAME = "cauce-system";
const LIBRARY_KEY = "workspace/library.v1.json";
const MAX_LIBRARY_BYTES = 5 * 1024 * 1024;
const MAX_WRITE_ATTEMPTS = 4;

interface LibraryRecord {
  id: string;
  updatedAt: string;
  [key: string]: unknown;
}

interface LibraryFile {
  kind: "cauce-library";
  schemaVersion: 1;
  createdAt: string;
  records: LibraryRecord[];
  colors: LibraryRecord[];
  tombstones: LibraryTombstone[];
}

interface LibraryTombstone {
  schemaVersion: 1;
  id: string;
  kind: "project" | "color";
  deletedAt: string;
}

class LibraryInputError extends Error {}
class LibraryConflictError extends Error {}

function responseHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Authorization"
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(value, null, 2)}\n`, {
    status,
    headers: responseHeaders()
  });
}

function emptyLibrary(): LibraryFile {
  return {
    kind: "cauce-library",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    records: [],
    colors: [],
    tombstones: []
  };
}

function isLibraryRecord(value: unknown): value is LibraryRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LibraryRecord>;
  return typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.updatedAt === "string" &&
    candidate.updatedAt.length > 0;
}

function isLibraryTombstone(value: unknown): value is LibraryTombstone {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LibraryTombstone>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    (candidate.kind === "project" || candidate.kind === "color") &&
    typeof candidate.deletedAt === "string" &&
    candidate.deletedAt.length > 0;
}

function isLibraryFile(value: unknown): value is LibraryFile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LibraryFile>;
  return candidate.kind === "cauce-library" &&
    candidate.schemaVersion === 1 &&
    Array.isArray(candidate.records) &&
    candidate.records.every(isLibraryRecord) &&
    (candidate.colors === undefined || (
      Array.isArray(candidate.colors) && candidate.colors.every(isLibraryRecord)
    )) &&
    (candidate.tombstones === undefined || (
      Array.isArray(candidate.tombstones) && candidate.tombstones.every(isLibraryTombstone)
    ));
}

function normalizeLibrary(value: unknown): LibraryFile {
  if (!isLibraryFile(value)) {
    throw new LibraryInputError("La biblioteca no tiene un formato compatible.");
  }
  return {
    kind: "cauce-library",
    schemaVersion: 1,
    createdAt: typeof value.createdAt === "string"
      ? value.createdAt
      : new Date().toISOString(),
    records: structuredClone(value.records),
    colors: structuredClone(value.colors ?? []),
    tombstones: structuredClone(value.tombstones ?? [])
  };
}

function mergeRecords(
  current: LibraryRecord[],
  incoming: LibraryRecord[]
): LibraryRecord[] {
  const records = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) {
    const existing = records.get(record.id);
    if (!existing || record.updatedAt > existing.updatedAt) {
      records.set(record.id, record);
    }
  }
  return Array.from(records.values());
}

function tombstoneKey(tombstone: LibraryTombstone): string {
  return `${tombstone.kind}:${tombstone.id}`;
}

function mergeTombstones(
  current: LibraryTombstone[],
  incoming: LibraryTombstone[]
): LibraryTombstone[] {
  const tombstones = new Map(current.map((item) => [tombstoneKey(item), item]));
  for (const tombstone of incoming) {
    const key = tombstoneKey(tombstone);
    const existing = tombstones.get(key);
    if (!existing || tombstone.deletedAt > existing.deletedAt) {
      tombstones.set(key, tombstone);
    }
  }
  return Array.from(tombstones.values());
}

function applyTombstones(
  records: LibraryRecord[],
  tombstones: LibraryTombstone[],
  kind: LibraryTombstone["kind"]
): LibraryRecord[] {
  const deletedAtById = new Map(tombstones
    .filter((tombstone) => tombstone.kind === kind)
    .map((tombstone) => [tombstone.id, tombstone.deletedAt]));
  return records.filter((record) => {
    const deletedAt = deletedAtById.get(record.id);
    return !deletedAt || record.updatedAt > deletedAt;
  });
}

function mergeLibraries(current: LibraryFile, incoming: LibraryFile): LibraryFile {
  const tombstones = mergeTombstones(current.tombstones, incoming.tombstones);
  return {
    kind: "cauce-library",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    records: applyTombstones(
      mergeRecords(current.records, incoming.records),
      tombstones,
      "project"
    ),
    colors: applyTombstones(
      mergeRecords(current.colors, incoming.colors),
      tombstones,
      "color"
    ),
    tombstones
  };
}

function secureEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function authorize(request: Request): Response | null {
  const configuredKey = process.env.CAUCE_LIBRARY_KEY?.trim();
  if (!configuredKey) {
    return jsonResponse({
      error: "La sincronización remota no está configurada en este sitio."
    }, 503);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const suppliedKey = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!suppliedKey || !secureEqual(configuredKey, suppliedKey)) {
    const response = jsonResponse({ error: "La clave de biblioteca no es válida." }, 401);
    response.headers.set("WWW-Authenticate", "Bearer");
    return response;
  }
  return null;
}

async function requestLibrary(request: Request): Promise<LibraryFile> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LIBRARY_BYTES) {
    throw new LibraryInputError("La biblioteca supera el límite de 5 MB.");
  }
  const source = await request.text();
  if (new TextEncoder().encode(source).byteLength > MAX_LIBRARY_BYTES) {
    throw new LibraryInputError("La biblioteca supera el límite de 5 MB.");
  }
  try {
    return normalizeLibrary(JSON.parse(source));
  } catch (error) {
    if (error instanceof LibraryInputError) throw error;
    throw new LibraryInputError("La petición no contiene JSON válido.");
  }
}

async function readStoredLibrary(): Promise<{
  library: LibraryFile;
  etag?: string;
  exists: boolean;
}> {
  const store = getStore(STORE_NAME, { consistency: "strong" });
  const stored = await store.getWithMetadata(LIBRARY_KEY, { type: "json" });
  if (!stored) return { library: emptyLibrary(), exists: false };
  return {
    library: normalizeLibrary(stored.data),
    etag: stored.etag,
    exists: true
  };
}

async function updateStoredLibrary(
  transform: (current: LibraryFile) => LibraryFile
): Promise<LibraryFile> {
  const store = getStore(STORE_NAME, { consistency: "strong" });
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const current = await readStoredLibrary();
    const next = transform(current.library);
    const conditions = current.exists && current.etag
      ? { onlyIfMatch: current.etag }
      : current.exists
        ? undefined
        : { onlyIfNew: true as const };
    const result = await store.setJSON(LIBRARY_KEY, next, {
      ...conditions,
      metadata: {
        schemaVersion: 1,
        updatedAt: next.createdAt
      }
    });
    if (result.modified) return next;
  }
  throw new LibraryConflictError(
    "La biblioteca cambió durante la sincronización. Vuelve a intentarlo."
  );
}

async function handleGet(): Promise<Response> {
  return jsonResponse((await readStoredLibrary()).library);
}

async function handlePut(request: Request): Promise<Response> {
  const incoming = await requestLibrary(request);
  return jsonResponse(await updateStoredLibrary((current) => (
    mergeLibraries(current, incoming)
  )));
}

async function handleDelete(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("id");
  const colorId = url.searchParams.get("colorId");
  if ((!projectId && !colorId) || (projectId && colorId)) {
    throw new LibraryInputError("Indica un único identificador de guardado.");
  }

  return jsonResponse(await updateStoredLibrary((current) => ({
    ...current,
    createdAt: new Date().toISOString(),
    records: projectId
      ? current.records.filter((record) => record.id !== projectId)
      : current.records,
    colors: colorId
      ? current.colors.filter((record) => record.id !== colorId)
      : current.colors,
    tombstones: mergeTombstones(current.tombstones, [{
      schemaVersion: 1,
      id: projectId ?? colorId!,
      kind: projectId ? "project" : "color",
      deletedAt: new Date().toISOString()
    }])
  })));
}

export default async function libraryFunction(
  request: Request,
  _context: Context
): Promise<Response> {
  const authenticationError = authorize(request);
  if (authenticationError) return authenticationError;

  try {
    if (request.method === "GET") return await handleGet();
    if (request.method === "PUT") return await handlePut(request);
    if (request.method === "DELETE") return await handleDelete(request);
    return jsonResponse({ error: "Método no permitido." }, 405);
  } catch (error) {
    if (error instanceof LibraryInputError) {
      return jsonResponse({ error: error.message }, 400);
    }
    if (error instanceof LibraryConflictError) {
      return jsonResponse({ error: error.message }, 409);
    }
    console.error("Cauce remote library error", error);
    return jsonResponse({ error: "No se pudo sincronizar la biblioteca remota." }, 500);
  }
}

export const config: Config = {
  path: "/api/library",
  method: ["GET", "PUT", "DELETE"]
};
