import { getOutputFormat } from "./formats";
import type { EngineState, ImageField, ProjectFrame } from "./types";
import { getProject } from "../projects";

export interface StillExportResult {
  blob: Blob;
  filename: string;
}

export async function exportProjectPng(
  state: EngineState,
  time: number,
  transparent: boolean,
  imageField: ImageField | null = null,
  elapsedTime = time * state.playback.loopSeconds
): Promise<StillExportResult> {
  const format = getOutputFormat(state.formatKey);
  const project = getProject(state.projectId);
  if (project.exportCapabilities?.png === false) {
    throw new Error(`${project.index} · ${project.name} no ofrece exportación PNG.`);
  }

  const canvas = new OffscreenCanvas(format.width, format.height);
  const projectRenderer = project.createRenderer
    ? await project.createRenderer(canvas, {
        initialParticleCount: Number(state.parameters.particleCount) || undefined,
        initialSeed: state.seed,
        initialParameters: { ...state.parameters }
      })
    : null;
  const context = projectRenderer
    ? null
    : canvas.getContext("2d", { alpha: transparent });

  if (project.createRenderer && !projectRenderer) {
    throw new Error("El proyecto no incluye un renderer exportable.");
  }
  if (!projectRenderer && (!context || !project.render)) {
    throw new Error("No se pudo crear el lienzo de exportación PNG.");
  }

  const frame: ProjectFrame = {
    width: format.width,
    height: format.height,
    time,
    elapsedTime,
    timeMode: state.playback.mode,
    seed: state.seed,
    palette: state.palette,
    appearance: state.appearance,
    view: state.view,
    parameters: state.parameters,
    lighting: state.lighting,
    transparent,
    imageField
  };

  try {
    if (projectRenderer) {
      projectRenderer.resize({
        width: format.width,
        height: format.height,
        pixelRatio: 1,
        contentX: 0,
        contentY: 0,
        contentWidth: format.width,
        contentHeight: format.height,
        stageBackground: null
      });
      projectRenderer.render(frame);
      await projectRenderer.flush?.();
    } else if (context && project.render) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.clearRect(0, 0, format.width, format.height);
      project.render(context, frame);
    }

    const blob = await canvas.convertToBlob({ type: "image/png" });
    return {
      blob,
      filename: `cauce-${project.index}-${project.id}-${format.key}-${state.seed}.png`
    };
  } finally {
    projectRenderer?.dispose();
  }
}
