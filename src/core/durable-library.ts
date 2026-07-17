import {
  createLibraryBackupDownload,
  listSavedColors,
  listSavedProjects,
  replaceLibraryBackup,
  type LibraryReplaceResult
} from "./storage";

const LIBRARY_ENDPOINT = "/__cauce/library";

export interface DurableLibraryResult extends LibraryReplaceResult {
  initialized: boolean;
}

async function responseSource(response: Response): Promise<string> {
  const source = await response.text();
  if (!response.ok) {
    let message = "No se pudo acceder al archivo local de biblioteca.";
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
      // Se conserva el mensaje genérico cuando la respuesta no contiene JSON.
    }
    throw new Error(message);
  }
  return source;
}

function emptyResult(initialized: boolean): DurableLibraryResult {
  return {
    added: 0,
    updated: 0,
    removed: 0,
    total: 0,
    colorsAdded: 0,
    colorsUpdated: 0,
    colorsRemoved: 0,
    colorsTotal: 0,
    initialized
  };
}

export async function persistDurableLibrary(): Promise<DurableLibraryResult | null> {
  if (!import.meta.env.DEV) return null;
  const backup = createLibraryBackupDownload();
  const response = await fetch(LIBRARY_ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: await backup.blob.text()
  });
  return {
    ...replaceLibraryBackup(await responseSource(response)),
    initialized: true
  };
}

export async function syncDurableLibrary(): Promise<DurableLibraryResult | null> {
  if (!import.meta.env.DEV) return null;
  const response = await fetch(LIBRARY_ENDPOINT, {
    method: "GET",
    cache: "no-store"
  });

  if (response.status === 404) {
    if (listSavedProjects().length === 0 && listSavedColors().length === 0) {
      return emptyResult(false);
    }
    return persistDurableLibrary();
  }

  return {
    ...replaceLibraryBackup(await responseSource(response)),
    initialized: true
  };
}

export async function deleteDurableProject(projectId: string): Promise<DurableLibraryResult | null> {
  if (!import.meta.env.DEV) return null;
  const response = await fetch(`${LIBRARY_ENDPOINT}?id=${encodeURIComponent(projectId)}`, {
    method: "DELETE"
  });
  if (response.status === 404) return emptyResult(false);
  return {
    ...replaceLibraryBackup(await responseSource(response)),
    initialized: true
  };
}

export async function deleteDurableColor(colorId: string): Promise<DurableLibraryResult | null> {
  if (!import.meta.env.DEV) return null;
  const response = await fetch(`${LIBRARY_ENDPOINT}?colorId=${encodeURIComponent(colorId)}`, {
    method: "DELETE"
  });
  if (response.status === 404) return emptyResult(false);
  return {
    ...replaceLibraryBackup(await responseSource(response)),
    initialized: true
  };
}
