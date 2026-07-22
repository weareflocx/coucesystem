import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const LIBRARY_ENDPOINT = "/__cauce/library";
const LIBRARY_FILE = fileURLToPath(new URL("./.cauce/library.json", import.meta.url));
const MAX_LIBRARY_BYTES = 10 * 1024 * 1024;
const VIDEO_CAPABILITY_ENDPOINT = "/__cauce/video/capabilities";
const VIDEO_CAPCUT_ENDPOINT = "/__cauce/video/capcut-alpha";
const VIDEO_TEMP_DIRECTORY = fileURLToPath(new URL("./.cauce/tmp", import.meta.url));
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;

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
  colors?: LibraryRecord[];
  tombstones?: LibraryTombstone[];
}

interface LibraryTombstone {
  schemaVersion: 1;
  id: string;
  kind: "project" | "color";
  deletedAt: string;
}

function isLibraryRecord(record: unknown): record is LibraryRecord {
  return Boolean(record) &&
    typeof record === "object" &&
    typeof (record as Partial<LibraryRecord>).id === "string" &&
    typeof (record as Partial<LibraryRecord>).updatedAt === "string";
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

async function readLibrary(): Promise<LibraryFile | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(LIBRARY_FILE, "utf8"));
    if (!isLibraryFile(parsed)) throw new Error("El archivo de biblioteca no es válido.");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeLibrary(library: LibraryFile): Promise<void> {
  await mkdir(dirname(LIBRARY_FILE), { recursive: true });
  const temporaryFile = `${LIBRARY_FILE}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(library, null, 2)}\n`, "utf8");
  await rename(temporaryFile, LIBRARY_FILE);
}

class RequestBodyTooLargeError extends Error {}

async function readRequestBytes(
  request: NodeJS.ReadableStream,
  maximumBytes: number,
  errorMessage: string
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    length += bytes.length;
    if (length > maximumBytes) throw new RequestBodyTooLargeError(errorMessage);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function readRequestBody(request: NodeJS.ReadableStream): Promise<string> {
  return (await readRequestBytes(
    request,
    MAX_LIBRARY_BYTES,
    "La biblioteca supera el límite de 10 MB."
  )).toString("utf8");
}

function sendJson(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function mergeLibraries(current: LibraryFile | null, incoming: LibraryFile): LibraryFile {
  const records = new Map<string, LibraryRecord>();
  const colors = new Map<string, LibraryRecord>();
  const tombstones = new Map<string, LibraryTombstone>();
  for (const record of current?.records ?? []) records.set(record.id, record);
  for (const record of incoming.records) {
    const existing = records.get(record.id);
    if (!existing || record.updatedAt > existing.updatedAt) records.set(record.id, record);
  }
  for (const color of current?.colors ?? []) colors.set(color.id, color);
  for (const color of incoming.colors ?? []) {
    const existing = colors.get(color.id);
    if (!existing || color.updatedAt > existing.updatedAt) colors.set(color.id, color);
  }
  for (const tombstone of current?.tombstones ?? []) {
    tombstones.set(`${tombstone.kind}:${tombstone.id}`, tombstone);
  }
  for (const tombstone of incoming.tombstones ?? []) {
    const key = `${tombstone.kind}:${tombstone.id}`;
    const existing = tombstones.get(key);
    if (!existing || tombstone.deletedAt > existing.deletedAt) {
      tombstones.set(key, tombstone);
    }
  }
  for (const tombstone of tombstones.values()) {
    const collection = tombstone.kind === "project" ? records : colors;
    const record = collection.get(tombstone.id);
    if (record && record.updatedAt <= tombstone.deletedAt) collection.delete(tombstone.id);
  }
  return {
    kind: "cauce-library",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    records: Array.from(records.values()),
    colors: Array.from(colors.values()),
    tombstones: Array.from(tombstones.values())
  };
}

function cauceLibraryPlugin(): Plugin {
  return {
    name: "cauce-local-library",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname !== LIBRARY_ENDPOINT) {
          next();
          return;
        }

        try {
          if (request.method === "GET") {
            const library = await readLibrary();
            if (!library) {
              sendJson(response, 404, { error: "Biblioteca persistente todavía no inicializada." });
              return;
            }
            sendJson(response, 200, library);
            return;
          }

          if (request.method === "PUT") {
            const incoming: unknown = JSON.parse(await readRequestBody(request));
            if (!isLibraryFile(incoming)) {
              sendJson(response, 400, { error: "Biblioteca no válida." });
              return;
            }
            const merged = mergeLibraries(await readLibrary(), incoming);
            await writeLibrary(merged);
            sendJson(response, 200, merged);
            return;
          }

          if (request.method === "DELETE") {
            const projectId = url.searchParams.get("id");
            const colorId = url.searchParams.get("colorId");
            if ((!projectId && !colorId) || (projectId && colorId)) {
              sendJson(response, 400, { error: "Indica un único identificador de guardado." });
              return;
            }
            const current = await readLibrary();
            if (!current) {
              sendJson(response, 404, { error: "Biblioteca persistente todavía no inicializada." });
              return;
            }
            const nextLibrary = mergeLibraries(current, {
              kind: "cauce-library",
              schemaVersion: 1,
              createdAt: new Date().toISOString(),
              records: [],
              colors: [],
              tombstones: [{
                schemaVersion: 1,
                id: projectId ?? colorId!,
                kind: projectId ? "project" : "color",
                deletedAt: new Date().toISOString()
              }]
            });
            await writeLibrary(nextLibrary);
            sendJson(response, 200, nextLibrary);
            return;
          }

          response.statusCode = 405;
          response.setHeader("Allow", "GET, PUT, DELETE");
          response.end();
        } catch (error) {
          sendJson(response, 500, {
            error: error instanceof Error ? error.message : "No se pudo actualizar la biblioteca persistente."
          });
        }
      });
    }
  };
}

interface FfmpegResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface CapCutCapability {
  capCutMov: boolean;
  error?: string;
}

function runFfmpeg(args: string[], signal?: AbortSignal): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    const process = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const abort = () => process.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });

    process.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    process.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    process.once("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    process.once("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(new DOMException("Conversión cancelada.", "AbortError"));
        return;
      }
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

let capCutCapabilityPromise: Promise<CapCutCapability> | null = null;

async function detectCapCutCapability(): Promise<CapCutCapability> {
  capCutCapabilityPromise ??= (async () => {
    try {
      const [encoders, decoders] = await Promise.all([
        runFfmpeg(["-hide_banner", "-encoders"]),
        runFfmpeg(["-hide_banner", "-decoders"])
      ]);
      const hasProRes = encoders.code === 0 && encoders.stdout.includes("prores_ks");
      const hasVp9AlphaDecoder = decoders.code === 0 && decoders.stdout.includes("libvpx-vp9");
      if (hasProRes && hasVp9AlphaDecoder) return { capCutMov: true };
      return {
        capCutMov: false,
        error: "FFmpeg necesita el encoder prores_ks y el decoder libvpx-vp9."
      };
    } catch (error) {
      return {
        capCutMov: false,
        error: (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "FFmpeg no está instalado o no está disponible en PATH."
          : "No se pudo verificar la instalación local de FFmpeg."
      };
    }
  })();
  return capCutCapabilityPromise;
}

async function removeTemporaryVideoFiles(...paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => undefined)));
}

function cauceVideoPlugin(): Plugin {
  return {
    name: "cauce-local-video-export",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname !== VIDEO_CAPABILITY_ENDPOINT && url.pathname !== VIDEO_CAPCUT_ENDPOINT) {
          next();
          return;
        }

        if (url.pathname === VIDEO_CAPABILITY_ENDPOINT) {
          if (request.method !== "GET") {
            response.statusCode = 405;
            response.setHeader("Allow", "GET");
            response.end();
            return;
          }
          sendJson(response, 200, await detectCapCutCapability());
          return;
        }

        if (request.method !== "POST") {
          response.statusCode = 405;
          response.setHeader("Allow", "POST");
          response.end();
          return;
        }

        const capability = await detectCapCutCapability();
        if (!capability.capCutMov) {
          sendJson(response, 503, capability);
          return;
        }

        const declaredLength = Number(request.headers["content-length"] ?? 0);
        if (declaredLength > MAX_VIDEO_BYTES) {
          sendJson(response, 413, { error: "El WebM intermedio supera el límite local de 512 MB." });
          return;
        }

        const conversionId = randomUUID();
        const inputFile = `${VIDEO_TEMP_DIRECTORY}/${conversionId}.webm`;
        const outputFile = `${VIDEO_TEMP_DIRECTORY}/${conversionId}.mov`;
        const controller = new AbortController();
        const abortConversion = () => controller.abort();
        request.once("aborted", abortConversion);
        response.once("close", () => {
          if (!response.writableEnded) abortConversion();
        });

        try {
          const source = await readRequestBytes(
            request,
            MAX_VIDEO_BYTES,
            "El WebM intermedio supera el límite local de 512 MB."
          );
          if (source.length === 0) {
            sendJson(response, 400, { error: "No se recibió ningún vídeo WebM para convertir." });
            return;
          }

          await mkdir(VIDEO_TEMP_DIRECTORY, { recursive: true });
          await writeFile(inputFile, source);
          const conversion = await runFfmpeg([
            "-y",
            "-v", "error",
            "-c:v", "libvpx-vp9",
            "-i", inputFile,
            "-an",
            "-c:v", "prores_ks",
            "-profile:v", "4",
            "-pix_fmt", "yuva444p10le",
            "-alpha_bits", "16",
            "-vendor", "apl0",
            outputFile
          ], controller.signal);
          if (conversion.code !== 0) {
            const detail = conversion.stderr.trim().slice(-1800);
            throw new Error(detail || "FFmpeg no pudo generar el archivo MOV.");
          }

          const outputStats = await stat(outputFile);
          response.statusCode = 200;
          response.setHeader("Content-Type", "video/quicktime");
          response.setHeader("Content-Length", String(outputStats.size));
          response.setHeader("Content-Disposition", "attachment; filename=\"cauce-alpha-capcut.mov\"");
          response.setHeader("Cache-Control", "no-store");

          const output = createReadStream(outputFile);
          const cleanup = () => {
            output.destroy();
            void removeTemporaryVideoFiles(inputFile, outputFile);
          };
          output.once("error", (error) => {
            if (!response.headersSent) sendJson(response, 500, { error: error.message });
            else response.destroy(error);
          });
          response.once("finish", cleanup);
          response.once("close", cleanup);
          output.pipe(response);
        } catch (error) {
          await removeTemporaryVideoFiles(inputFile, outputFile);
          if (controller.signal.aborted) return;
          sendJson(response, error instanceof RequestBodyTooLargeError ? 413 : 500, {
            error: error instanceof Error ? error.message : "No se pudo generar el MOV alpha."
          });
        } finally {
          request.off("aborted", abortConversion);
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [cauceLibraryPlugin(), cauceVideoPlugin()],
  optimizeDeps: {
    include: [
      "three/webgpu",
      "three/tsl",
      "three/addons/loaders/OBJLoader.js",
      "three/addons/loaders/RGBELoader.js",
      "three/addons/utils/BufferGeometryUtils.js"
    ]
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true
  },
  worker: {
    format: "es"
  }
});
