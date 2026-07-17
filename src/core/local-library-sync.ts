import {
  createLibraryBackupDownload,
  importLibraryBackup,
  type LibraryImportResult
} from "./storage";

const CHANNEL = "cauce-library-sync.v1";
const BRIDGE_PARAMETER = "cauce-library-bridge";
const SESSION_KEY = "cauce-library-sync.completed.v2";
const CANONICAL_ORIGIN = "http://localhost:5173";
const LOOPBACK_ORIGINS = new Set([
  CANONICAL_ORIGIN,
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174"
]);

interface BridgeMessage {
  channel: typeof CHANNEL;
  type: "export-request" | "export-response" | "import-request" | "import-response";
  requestId: string;
  backupSource?: string;
  result?: LibraryImportResult;
  error?: string;
}

export interface LoopbackLibrarySyncResult extends LibraryImportResult {
  sourceOrigin: string;
  canonicalUrl: string | null;
}

function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BridgeMessage>;
  return candidate.channel === CHANNEL &&
    typeof candidate.type === "string" &&
    typeof candidate.requestId === "string";
}

function allowedOrigin(origin: string): boolean {
  return import.meta.env.DEV && LOOPBACK_ORIGINS.has(origin);
}

async function libraryBackupSource(): Promise<string> {
  return createLibraryBackupDownload().blob.text();
}

export function isLocalLibraryBridge(): boolean {
  return import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get(BRIDGE_PARAMETER) === "1";
}

export function installLocalLibraryBridge(): void {
  if (!import.meta.env.DEV || !allowedOrigin(window.location.origin)) return;

  window.addEventListener("message", async (event: MessageEvent<unknown>) => {
    if (!allowedOrigin(event.origin) || !isBridgeMessage(event.data) || !event.source) return;
    const message = event.data;
    const source = event.source as WindowProxy;

    if (message.type === "export-request") {
      try {
        source.postMessage({
          channel: CHANNEL,
          type: "export-response",
          requestId: message.requestId,
          backupSource: await libraryBackupSource()
        } satisfies BridgeMessage, event.origin);
      } catch (error) {
        source.postMessage({
          channel: CHANNEL,
          type: "export-response",
          requestId: message.requestId,
          error: error instanceof Error ? error.message : "No se pudo leer la biblioteca local."
        } satisfies BridgeMessage, event.origin);
      }
      return;
    }

    if (message.type === "import-request") {
      try {
        if (typeof message.backupSource !== "string") {
          throw new Error("La sincronización no contiene una biblioteca válida.");
        }
        source.postMessage({
          channel: CHANNEL,
          type: "import-response",
          requestId: message.requestId,
          result: importLibraryBackup(message.backupSource)
        } satisfies BridgeMessage, event.origin);
      } catch (error) {
        source.postMessage({
          channel: CHANNEL,
          type: "import-response",
          requestId: message.requestId,
          error: error instanceof Error ? error.message : "No se pudo combinar la biblioteca local."
        } satisfies BridgeMessage, event.origin);
      }
    }
  });
}

function alternateOrigins(): string[] {
  if (!LOOPBACK_ORIGINS.has(window.location.origin)) return [];
  return Array.from(LOOPBACK_ORIGINS).filter((origin) => origin !== window.location.origin);
}

function requestBridge(
  target: WindowProxy,
  targetOrigin: string,
  message: Omit<BridgeMessage, "channel" | "requestId">
): Promise<BridgeMessage> {
  const requestId = window.crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("La otra biblioteca local no respondió."));
    }, 1500);

    function handleMessage(event: MessageEvent<unknown>): void {
      if (
        event.source !== target ||
        event.origin !== targetOrigin ||
        !isBridgeMessage(event.data) ||
        event.data.requestId !== requestId
      ) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data);
    }

    window.addEventListener("message", handleMessage);
    target.postMessage({ ...message, channel: CHANNEL, requestId }, targetOrigin);
  });
}

function loadBridgeFrame(origin: string): Promise<HTMLIFrameElement> {
  const url = new URL(window.location.href);
  url.protocol = new URL(origin).protocol;
  url.host = new URL(origin).host;
  url.searchParams.set(BRIDGE_PARAMETER, "1");
  url.hash = "";

  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "Sincronización de biblioteca local de Cauce";
    const timeout = window.setTimeout(() => {
      frame.remove();
      reject(new Error("No se pudo abrir la biblioteca del origen local anterior."));
    }, 1500);
    frame.addEventListener("load", () => {
      window.clearTimeout(timeout);
      resolve(frame);
    }, { once: true });
    frame.addEventListener("error", () => {
      window.clearTimeout(timeout);
      frame.remove();
      reject(new Error("No se pudo abrir la biblioteca del origen local anterior."));
    }, { once: true });
    frame.src = url.toString();
    document.body.appendChild(frame);
  });
}

function canonicalUrl(): string | null {
  if (window.location.origin === CANONICAL_ORIGIN) return null;
  const url = new URL(window.location.href);
  url.protocol = "http:";
  url.host = "localhost:5173";
  url.searchParams.delete(BRIDGE_PARAMETER);
  return url.toString();
}

export async function syncLoopbackLibraries(): Promise<LoopbackLibrarySyncResult | null> {
  if (!import.meta.env.DEV || isLocalLibraryBridge()) return null;
  const sourceOrigins = alternateOrigins();
  if (sourceOrigins.length === 0) return null;
  try {
    if (window.sessionStorage.getItem(SESSION_KEY) === "1") return null;
  } catch {
    // La sincronización sigue funcionando aunque sessionStorage esté bloqueado.
  }

  let added = 0;
  let updated = 0;
  let total = 0;
  let colorsAdded = 0;
  let colorsUpdated = 0;
  let colorsTotal = 0;
  const connectedOrigins: string[] = [];

  for (const sourceOrigin of sourceOrigins) {
    let frame: HTMLIFrameElement | null = null;
    try {
      frame = await loadBridgeFrame(sourceOrigin);
      if (!frame.contentWindow) continue;
      const exported = await requestBridge(frame.contentWindow, sourceOrigin, {
        type: "export-request"
      });
      if (typeof exported.backupSource !== "string") continue;

      const result = importLibraryBackup(exported.backupSource);
      added += result.added;
      updated += result.updated;
      total = result.total;
      colorsAdded += result.colorsAdded;
      colorsUpdated += result.colorsUpdated;
      colorsTotal = result.colorsTotal;
      connectedOrigins.push(sourceOrigin);

      const combinedSource = await libraryBackupSource();
      await requestBridge(frame.contentWindow, sourceOrigin, {
        type: "import-request",
        backupSource: combinedSource
      });
    } catch {
      // Los puertos locales antiguos pueden no estar activos. Se prueban los demás.
    } finally {
      frame?.remove();
    }
  }

  if (connectedOrigins.length === 0) return null;
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // No es crítico: la combinación es idempotente.
  }
  return {
    added,
    updated,
    total,
    colorsAdded,
    colorsUpdated,
    colorsTotal,
    sourceOrigin: connectedOrigins.join(", "),
    canonicalUrl: canonicalUrl()
  };
}
