import {
  BufferTarget,
  CanvasSource,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  canEncodeVideo
} from "mediabunny";

import { getOutputFormat } from "./formats";
import type { EngineState, ProjectFrame } from "./types";
import { getProject } from "../projects";

export interface AlphaVideoExportOptions {
  state: EngineState;
  fps: number;
  onProgress(progress: number): void;
  signal: AbortSignal;
}

export interface AlphaVideoResult {
  blob: Blob;
  filename: string;
  frameCount: number;
}

export async function supportsAlphaWebM(state: EngineState): Promise<boolean> {
  const format = getOutputFormat(state.formatKey);
  return canEncodeVideo("vp9", {
    width: format.width,
    height: format.height,
    bitrate: QUALITY_HIGH,
    alpha: "keep",
    latencyMode: "quality"
  });
}

export async function exportAlphaWebM(options: AlphaVideoExportOptions): Promise<AlphaVideoResult> {
  const { state, fps, onProgress, signal } = options;
  const format = getOutputFormat(state.formatKey);
  const project = getProject(state.projectId);
  const frameDuration = 1 / fps;
  const frameCount = Math.max(1, Math.round(state.playback.loopSeconds * fps));
  const canvas = new OffscreenCanvas(format.width, format.height);
  const context = project.backend === "three"
    ? null
    : canvas.getContext("2d", { alpha: true });
  const projectRenderer = project.backend === "three"
    ? await project.createRenderer?.(canvas) ?? null
    : null;
  if (project.backend === "three" && !projectRenderer) {
    throw new Error("El proyecto 3D no incluye un renderer exportable.");
  }
  if (project.backend !== "three" && (!context || !project.render)) {
    throw new Error("No se pudo crear el lienzo transparente de exportación.");
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
    format: new WebMOutputFormat(),
    target
  });
  const source = new CanvasSource(canvas, {
    codec: "vp9",
    bitrate: QUALITY_HIGH,
    alpha: "keep",
    latencyMode: "quality",
    keyFrameInterval: fps * 2
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
        seed: state.seed,
        palette: state.palette,
        view: state.view,
        parameters: state.parameters,
        transparent: true
      };
      if (projectRenderer) {
        projectRenderer.render(frame);
      } else if (context && project.render) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha = 1;
        context.clearRect(0, 0, format.width, format.height);
        project.render(context, frame);
      }
      await source.add(frameIndex * frameDuration, frameDuration, {
        keyFrame: frameIndex % (fps * 2) === 0
      });
      onProgress((frameIndex + 1) / frameCount);

      if (frameIndex % 4 === 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }

    await output.finalize();
    if (!target.buffer) throw new Error("El codificador no produjo un archivo WebM.");

    return {
      blob: new Blob([target.buffer], { type: "video/webm" }),
      filename: `cauce-${project.index}-${project.id}-${format.key}-${state.seed}-alpha.webm`,
      frameCount
    };
  } catch (error) {
    if (output.state === "started") await output.cancel();
    throw error;
  } finally {
    projectRenderer?.dispose();
  }
}
