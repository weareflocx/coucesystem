import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  canEncodeVideo
} from "mediabunny";

import { getOutputFormat } from "./formats";
import type { EngineState, ImageField, Palette, ProjectFrame } from "./types";
import { getProject } from "../projects";

export type VideoProfile =
  | "mp4-background"
  | "mov-alpha-capcut"
  | "webm-alpha"
  | "mp4-chroma";

export type VideoRenderSource = "project" | "svg-flat";

export interface VideoExportOptions {
  state: EngineState;
  fps: number;
  profile: VideoProfile;
  renderSource: VideoRenderSource;
  imageField?: ImageField | null;
  onProgress(progress: number, phase: string): void;
  signal: AbortSignal;
}

export interface VideoExportResult {
  blob: Blob;
  filename: string;
  frameCount: number;
}

export interface VideoCapability {
  supported: boolean;
  reason?: string;
}

interface EncodedVideo {
  blob: Blob;
  frameCount: number;
}

interface CapCutCapabilityResponse {
  capCutMov?: boolean;
  error?: string;
}

const CAPCUT_CAPABILITY_ENDPOINT = "/__cauce/video/capabilities";
const CAPCUT_EXPORT_ENDPOINT = "/__cauce/video/capcut-alpha";
const CHROMA_GREEN = "#00ff00";

function isTransparentProfile(profile: VideoProfile): boolean {
  return profile === "webm-alpha" || profile === "mov-alpha-capcut";
}

function profilePalette(profile: VideoProfile, palette: Palette): Palette {
  if (profile !== "mp4-chroma") return palette;
  return { ...palette, background: CHROMA_GREEN };
}

async function supportsBrowserEncoding(
  state: EngineState,
  profile: VideoProfile
): Promise<boolean> {
  const format = getOutputFormat(state.formatKey);
  const alpha = isTransparentProfile(profile);
  return canEncodeVideo(alpha ? "vp9" : "avc", {
    width: format.width,
    height: format.height,
    bitrate: QUALITY_HIGH,
    alpha: alpha ? "keep" : "discard",
    latencyMode: "quality"
  });
}

async function checkCapCutConverter(signal?: AbortSignal): Promise<VideoCapability> {
  try {
    const response = await fetch(CAPCUT_CAPABILITY_ENDPOINT, {
      cache: "no-store",
      signal
    });
    if (!response.ok) {
      return {
        supported: false,
        reason: "El MOV alpha para CapCut requiere Cauce en modo local y FFmpeg disponible."
      };
    }
    const capability = await response.json() as CapCutCapabilityResponse;
    return capability.capCutMov
      ? { supported: true }
      : {
          supported: false,
          reason: capability.error ?? "FFmpeg no incluye los codecs necesarios para generar ProRes 4444."
        };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return {
      supported: false,
      reason: "No se pudo conectar con el conversor local de MOV alpha."
    };
  }
}

export async function checkVideoProfile(
  profile: VideoProfile,
  state: EngineState,
  signal?: AbortSignal
): Promise<VideoCapability> {
  const browserSupported = await supportsBrowserEncoding(state, profile);
  if (!browserSupported) {
    return {
      supported: false,
      reason: isTransparentProfile(profile)
        ? "Este navegador no puede codificar VP9 conservando transparencia."
        : "Este navegador no puede codificar vídeo H.264 en el formato actual."
    };
  }

  if (profile === "mov-alpha-capcut") return checkCapCutConverter(signal);
  return { supported: true };
}

async function drawSvgFrame(
  context: OffscreenCanvasRenderingContext2D,
  source: string,
  width: number,
  height: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) throw new DOMException("Exportación cancelada.", "AbortError");
  if (typeof Image === "undefined") {
    throw new Error("Este navegador no puede rasterizar fotogramas SVG.");
  }

  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
  const image = new Image();
  image.decoding = "sync";

  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        image.removeEventListener("load", handleLoad);
        image.removeEventListener("error", handleError);
        signal.removeEventListener("abort", handleAbort);
      };
      const handleLoad = (): void => {
        cleanup();
        resolve();
      };
      const handleError = (): void => {
        cleanup();
        reject(new Error("El navegador no pudo rasterizar el fotograma SVG plano."));
      };
      const handleAbort = (): void => {
        cleanup();
        image.src = "";
        reject(new DOMException("Exportación cancelada.", "AbortError"));
      };

      image.addEventListener("load", handleLoad, { once: true });
      image.addEventListener("error", handleError, { once: true });
      signal.addEventListener("abort", handleAbort, { once: true });
      image.src = url;
    });
    context.drawImage(image, 0, 0, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function encodeFrames(options: VideoExportOptions): Promise<EncodedVideo> {
  const {
    state,
    fps,
    profile,
    renderSource,
    imageField = null,
    onProgress,
    signal
  } = options;
  const format = getOutputFormat(state.formatKey);
  const project = getProject(state.projectId);
  const transparent = isTransparentProfile(profile);
  const svgFlat = renderSource === "svg-flat";
  const palette = profilePalette(profile, state.palette);
  const frameDuration = 1 / fps;
  const frameCount = Math.max(1, Math.round(state.playback.loopSeconds * fps));
  const canvas = new OffscreenCanvas(format.width, format.height);
  if (svgFlat && (!project.toSvg || project.exportCapabilities?.svg === false)) {
    throw new Error(`${project.index} · ${project.name} no ofrece vídeo SVG plano.`);
  }

  const projectRenderer = !svgFlat && project.createRenderer
    ? await project.createRenderer(canvas, {
        initialParticleCount: Number(state.parameters.particleCount) || undefined,
        initialSeed: state.seed,
        initialParameters: { ...state.parameters }
      })
    : null;
  const context = projectRenderer
    ? null
    : canvas.getContext("2d", { alpha: transparent });

  if (!svgFlat && project.createRenderer && !projectRenderer) {
    throw new Error("El proyecto no incluye un renderer exportable.");
  }
  if (svgFlat && !context) {
    throw new Error("No se pudo crear el lienzo para rasterizar el SVG plano.");
  }
  if (!svgFlat && !projectRenderer && (!context || !project.render)) {
    throw new Error("No se pudo crear el lienzo de exportación.");
  }

  projectRenderer?.resize({
    width: format.width,
    height: format.height,
    pixelRatio: 1,
    contentX: 0,
    contentY: 0,
    contentWidth: format.width,
    contentHeight: format.height,
    stageBackground: null
  });

  const target = new BufferTarget();
  const output = new Output({
    format: transparent
      ? new WebMOutputFormat()
      : new Mp4OutputFormat({ fastStart: "in-memory" }),
    target
  });
  const source = new CanvasSource(canvas, {
    codec: transparent ? "vp9" : "avc",
    bitrate: QUALITY_HIGH,
    alpha: transparent ? "keep" : "discard",
    latencyMode: "quality",
    keyFrameInterval: 2
  });
  output.addVideoTrack(source);

  try {
    await output.start();

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      if (signal.aborted) {
        await output.cancel();
        throw new DOMException("Exportación cancelada.", "AbortError");
      }

      const frame: ProjectFrame = {
        width: format.width,
        height: format.height,
        time: frameIndex / frameCount,
        elapsedTime: frameIndex / fps,
        timeMode: state.playback.mode,
        seed: state.seed,
        palette,
        appearance: state.appearance
          ? {
              ...state.appearance,
              background: {
                ...state.appearance.background,
                color: palette.background
              }
            }
          : undefined,
        view: state.view,
        parameters: state.parameters,
        lighting: state.lighting,
        transparent,
        imageField
      };
      if (svgFlat && context && project.toSvg) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha = 1;
        context.clearRect(0, 0, format.width, format.height);
        await drawSvgFrame(
          context,
          project.toSvg(frame),
          format.width,
          format.height,
          signal
        );
      } else if (projectRenderer) {
        projectRenderer.render(frame);
        await projectRenderer.flush?.();
      } else if (context && project.render) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha = 1;
        context.clearRect(0, 0, format.width, format.height);
        project.render(context, frame);
      }
      await source.add(frameIndex * frameDuration, frameDuration, {
        keyFrame: frameIndex % (fps * 2) === 0
      });

      const renderProgress = (frameIndex + 1) / frameCount;
      const totalProgress = profile === "mov-alpha-capcut"
        ? renderProgress * 0.75
        : renderProgress;
      onProgress(totalProgress, svgFlat
        ? transparent
          ? "Codificando SVG plano con alpha"
          : "Codificando SVG plano"
        : transparent
          ? "Codificando fotogramas con alpha"
          : "Codificando fotogramas");

      if (frameIndex % 4 === 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }

    await output.finalize();
    if (!target.buffer) throw new Error("El codificador no produjo un archivo de vídeo.");

    return {
      blob: new Blob([target.buffer], {
        type: transparent ? "video/webm" : "video/mp4"
      }),
      frameCount
    };
  } catch (error) {
    if (output.state === "started") await output.cancel();
    throw error;
  } finally {
    projectRenderer?.dispose();
  }
}

async function convertToCapCutMov(
  source: Blob,
  filename: string,
  signal: AbortSignal,
  onProgress: VideoExportOptions["onProgress"]
): Promise<Blob> {
  onProgress(0.8, "Convirtiendo a ProRes 4444");
  const response = await fetch(CAPCUT_EXPORT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "video/webm",
      "X-Cauce-Filename": filename
    },
    body: source,
    signal
  });
  if (!response.ok) {
    let message = "No se pudo convertir el vídeo a MOV ProRes 4444.";
    try {
      const payload = await response.json() as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // The generic message is more useful than a malformed server response.
    }
    throw new Error(message);
  }
  onProgress(0.95, "Preparando MOV para descarga");
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("FFmpeg produjo un archivo MOV vacío.");
  onProgress(1, "MOV ProRes 4444 completado");
  return blob;
}

export async function exportVideo(options: VideoExportOptions): Promise<VideoExportResult> {
  const { state, profile, renderSource, signal, onProgress } = options;
  const format = getOutputFormat(state.formatKey);
  const project = getProject(state.projectId);
  const baseFilename = `cauce-${project.index}-${project.id}-${format.key}-${state.seed}`;
  const renderSuffix = renderSource === "svg-flat" ? "-svg-flat" : "";
  const encoded = await encodeFrames(options);

  if (profile === "mov-alpha-capcut") {
    const filename = `${baseFilename}${renderSuffix}-alpha-capcut.mov`;
    const blob = await convertToCapCutMov(
      encoded.blob,
      filename,
      signal,
      onProgress
    );
    return { blob, filename, frameCount: encoded.frameCount };
  }

  const suffixes: Record<Exclude<VideoProfile, "mov-alpha-capcut">, string> = {
    "mp4-background": "-background.mp4",
    "webm-alpha": "-alpha.webm",
    "mp4-chroma": "-chroma-green.mp4"
  };
  return {
    blob: encoded.blob,
    filename: `${baseFilename}${renderSuffix}${suffixes[profile]}`,
    frameCount: encoded.frameCount
  };
}
