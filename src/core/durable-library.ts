import {
  createLibraryBackupDownload,
  importLibraryBackup,
  listSavedColors,
  listSavedProjects,
  replaceLibraryBackup,
  type LibraryReplaceResult
} from "./storage";

const LOCAL_LIBRARY_ENDPOINT = "/__cauce/library";
const REMOTE_LIBRARY_ENDPOINT = "/api/library";
const REMOTE_KEY_SESSION_STORAGE = "cauce-library.remote-key.v1";

export type DurableLibraryMode = "local-file" | "netlify";

export interface DurableLibraryResult extends LibraryReplaceResult {
  initialized: boolean;
  mode: DurableLibraryMode;
}

interface LibraryTarget {
  endpoint: string;
  mode: DurableLibraryMode;
  authorization?: string;
}

let memoryRemoteKey = "";

function storedRemoteKey(): string {
  if (memoryRemoteKey) return memoryRemoteKey;
  try {
    memoryRemoteKey = window.sessionStorage.getItem(REMOTE_KEY_SESSION_STORAGE)?.trim() ?? "";
  } catch {
    // El modo privado puede bloquear sessionStorage; se conserva la copia en memoria.
  }
  return memoryRemoteKey;
}

export function hasRemoteLibraryKey(): boolean {
  return storedRemoteKey().length > 0;
}

export function setRemoteLibraryKey(value: string): void {
  const key = value.trim();
  if (key.length < 12) {
    throw new Error("La clave de biblioteca debe tener al menos 12 caracteres.");
  }
  memoryRemoteKey = key;
  try {
    window.sessionStorage.setItem(REMOTE_KEY_SESSION_STORAGE, key);
  } catch {
    // La conexión seguirá activa en memoria durante la vida de esta página.
  }
}

export function clearRemoteLibraryKey(): void {
  memoryRemoteKey = "";
  try {
    window.sessionStorage.removeItem(REMOTE_KEY_SESSION_STORAGE);
  } catch {
    // No hay nada más que limpiar si sessionStorage no está disponible.
  }
}

function libraryTarget(): LibraryTarget | null {
  const remoteKey = storedRemoteKey();
  if (remoteKey) {
    return {
      endpoint: REMOTE_LIBRARY_ENDPOINT,
      mode: "netlify",
      authorization: `Bearer ${remoteKey}`
    };
  }
  if (import.meta.env.DEV) {
    return { endpoint: LOCAL_LIBRARY_ENDPOINT, mode: "local-file" };
  }
  return null;
}

function requestHeaders(target: LibraryTarget, includeContentType = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (includeContentType) headers["Content-Type"] = "application/json";
  if (target.authorization) headers.Authorization = target.authorization;
  return headers;
}

async function responseSource(response: Response, mode: DurableLibraryMode): Promise<string> {
  const source = await response.text();
  if (!response.ok) {
    let message = mode === "netlify"
      ? "No se pudo acceder a la biblioteca sincronizada."
      : "No se pudo acceder al archivo local de biblioteca.";
    try {
      const candidate: unknown = JSON.parse(source);
      if (
        candidate &&
        typeof candidate === "object" &&
        typeof (candidate as { error?: unknown }).error === "string"
      ) {
        message = (candidate as { error: string }).error;
      }
    } catch {
      // Se conserva el mensaje de contexto cuando la respuesta no contiene JSON.
    }
    throw new Error(message);
  }
  return source;
}

function emptyResult(
  initialized: boolean,
  mode: DurableLibraryMode
): DurableLibraryResult {
  return {
    added: 0,
    updated: 0,
    removed: 0,
    total: 0,
    colorsAdded: 0,
    colorsUpdated: 0,
    colorsRemoved: 0,
    colorsTotal: 0,
    initialized,
    mode
  };
}

export async function persistDurableLibrary(): Promise<DurableLibraryResult | null> {
  const target = libraryTarget();
  if (!target) return null;
  const backup = createLibraryBackupDownload();
  const response = await fetch(target.endpoint, {
    method: "PUT",
    headers: requestHeaders(target, true),
    body: await backup.blob.text()
  });
  return {
    ...replaceLibraryBackup(await responseSource(response, target.mode)),
    initialized: true,
    mode: target.mode
  };
}

export async function syncDurableLibrary(): Promise<DurableLibraryResult | null> {
  const target = libraryTarget();
  if (!target) return null;
  const response = await fetch(target.endpoint, {
    method: "GET",
    headers: requestHeaders(target),
    cache: "no-store"
  });

  if (response.status === 404) {
    if (listSavedProjects().length === 0 && listSavedColors().length === 0) {
      return emptyResult(false, target.mode);
    }
    return persistDurableLibrary();
  }

  importLibraryBackup(await responseSource(response, target.mode));
  return persistDurableLibrary();
}

export async function deleteDurableProject(
  projectId: string
): Promise<DurableLibraryResult | null> {
  const target = libraryTarget();
  if (!target) return null;
  const response = await fetch(`${target.endpoint}?id=${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    headers: requestHeaders(target)
  });
  if (response.status === 404) return emptyResult(false, target.mode);
  return {
    ...replaceLibraryBackup(await responseSource(response, target.mode)),
    initialized: true,
    mode: target.mode
  };
}

export async function deleteDurableColor(
  colorId: string
): Promise<DurableLibraryResult | null> {
  const target = libraryTarget();
  if (!target) return null;
  const response = await fetch(`${target.endpoint}?colorId=${encodeURIComponent(colorId)}`, {
    method: "DELETE",
    headers: requestHeaders(target)
  });
  if (response.status === 404) return emptyResult(false, target.mode);
  return {
    ...replaceLibraryBackup(await responseSource(response, target.mode)),
    initialized: true,
    mode: target.mode
  };
}
