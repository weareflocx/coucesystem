/// <reference lib="webworker" />

import { getOutputFormat } from "./formats";
import { clamp, positiveModulo } from "./random";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./protocol";
import type { EngineState, ProjectDefinition, ProjectFrame, ProjectRenderer } from "./types";
import { getProject } from "../projects";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

let canvas: OffscreenCanvas | null = null;
let threeCanvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let projectRenderer: ProjectRenderer | null = null;
let projectRendererPromise: Promise<void> | null = null;
let rendererProjectId = "";
let rendererLoadToken = 0;
let state: EngineState | null = null;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let playhead = 0;
let visible = true;
let dirty = true;
let frameToken: number | null = null;
let lastTick = 0;
let lastDraw = 0;
let lastNotification = 0;

function post(message: WorkerToMainMessage): void {
  workerScope.postMessage(message);
}

function scheduleFrame(callback: (timestamp: number) => void): number {
  if (typeof workerScope.requestAnimationFrame === "function") {
    return workerScope.requestAnimationFrame(callback);
  }
  return workerScope.setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(token: number): void {
  if (typeof workerScope.cancelAnimationFrame === "function") {
    workerScope.cancelAnimationFrame(token);
    return;
  }
  workerScope.clearTimeout(token);
}

function resizeCanvas(): void {
  if (!canvas) return;
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  dirty = true;
}

function disposeProjectRenderer(): void {
  if (!projectRenderer && !projectRendererPromise && !rendererProjectId) return;
  rendererLoadToken += 1;
  projectRenderer?.dispose();
  projectRenderer = null;
  projectRendererPromise = null;
  rendererProjectId = "";
}

function ensureProjectRenderer(project: ProjectDefinition): ProjectRenderer | null {
  if (!threeCanvas || !project.createRenderer) {
    throw new Error(`El proyecto ${project.id} no incluye un renderer Three.js.`);
  }
  if (projectRenderer && rendererProjectId === project.id) return projectRenderer;
  if (projectRendererPromise && rendererProjectId === project.id) return null;
  if (projectRenderer || projectRendererPromise || rendererProjectId) {
    disposeProjectRenderer();
  }
  rendererProjectId = project.id;
  const loadToken = rendererLoadToken;
  projectRendererPromise = Promise.resolve(project.createRenderer(threeCanvas))
    .then((renderer) => {
      if (loadToken !== rendererLoadToken || rendererProjectId !== project.id) {
        renderer.dispose();
        return;
      }
      projectRenderer = renderer;
      projectRendererPromise = null;
      markDirty();
    })
    .catch((error) => {
      if (loadToken !== rendererLoadToken) return;
      projectRendererPromise = null;
      post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    });
  return null;
}

function createProjectFrame(): ProjectFrame {
  if (!state) throw new Error("El motor no tiene estado.");
  const format = getOutputFormat(state.formatKey);
  return {
    width: format.width,
    height: format.height,
    time: playhead,
    seed: state.seed,
    palette: state.palette,
    parameters: state.parameters
  };
}

function draw(): void {
  if (!canvas || !context || !state) return;
  const format = getOutputFormat(state.formatKey);
  const project = getProject(state.projectId);
  const frame = createProjectFrame();
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const margin = Math.min(40 * pixelRatio, canvasWidth * 0.055, canvasHeight * 0.055);
  const scale = Math.max(0.0001, Math.min(
    (canvasWidth - margin * 2) / format.width,
    (canvasHeight - margin * 2) / format.height
  ));
  const offsetX = (canvasWidth - format.width * scale) / 2;
  const offsetY = (canvasHeight - format.height * scale) / 2;

  if (project.backend === "three") {
    const renderer = ensureProjectRenderer(project);
    if (!renderer) return;
    const cssMargin = Math.min(40, cssWidth * 0.055, cssHeight * 0.055);
    const cssScale = Math.max(0.0001, Math.min(
      (cssWidth - cssMargin * 2) / format.width,
      (cssHeight - cssMargin * 2) / format.height
    ));
    const contentWidth = format.width * cssScale;
    const contentHeight = format.height * cssScale;
    renderer.resize({
      width: cssWidth,
      height: cssHeight,
      pixelRatio,
      contentX: (cssWidth - contentWidth) * 0.5,
      contentY: (cssHeight - contentHeight) * 0.5,
      contentWidth,
      contentHeight,
      stageBackground: "#080a0b"
    });
    renderer.render(frame);
    return;
  }

  disposeProjectRenderer();
  if (!project.render) throw new Error(`El proyecto ${project.id} no incluye renderer Canvas 2D.`);

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.fillStyle = "#080a0b";
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  context.save();
  context.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  project.render(context, frame);
  context.restore();
}

function ensureLoop(): void {
  if (frameToken !== null || !canvas || !context || !state || !visible) return;
  if (!state.playback.playing && !dirty) return;
  frameToken = scheduleFrame(tick);
}

function tick(timestamp: number): void {
  frameToken = null;
  if (!state || !visible) return;

  const project = getProject(state.projectId);
  const delta = lastTick === 0 ? 0 : clamp(timestamp - lastTick, 0, 100);
  lastTick = timestamp;

  if (state.playback.playing) {
    playhead = positiveModulo(
      playhead + (delta / 1000) * state.playback.speed / state.playback.loopSeconds,
      1
    );
  }

  const frameInterval = 1000 / project.preferredFps;
  if (dirty || timestamp - lastDraw >= frameInterval) {
    try {
      draw();
      dirty = false;
      lastDraw = timestamp;
    } catch (error) {
      post({ type: "error", message: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  if (timestamp - lastNotification >= 100) {
    post({ type: "frame", time: playhead });
    lastNotification = timestamp;
  }

  if (state.playback.playing) {
    ensureLoop();
  } else {
    lastTick = 0;
  }
}

function markDirty(): void {
  dirty = true;
  ensureLoop();
}

function exportSvg(requestId: string): void {
  if (!state) throw new Error("No hay proyecto para exportar.");
  const project = getProject(state.projectId);
  const format = getOutputFormat(state.formatKey);
  const source = project.toSvg(createProjectFrame());
  post({
    type: "svg",
    requestId,
    source,
    filename: `cauce-${project.index}-${project.id}-${format.key}-${state.seed}.svg`
  });
}

workerScope.addEventListener("message", (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case "init": {
        canvas = message.canvas;
        threeCanvas = message.threeCanvas;
        cssWidth = message.cssWidth;
        cssHeight = message.cssHeight;
        pixelRatio = clamp(message.pixelRatio, 1, 2.5);
        state = message.state;
        context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas 2D no está disponible en el worker.");
        resizeCanvas();
        post({ type: "ready" });
        ensureLoop();
        break;
      }
      case "resize": {
        cssWidth = message.cssWidth;
        cssHeight = message.cssHeight;
        pixelRatio = clamp(message.pixelRatio, 1, 2.5);
        resizeCanvas();
        ensureLoop();
        break;
      }
      case "state": {
        state = message.state;
        markDirty();
        break;
      }
      case "seek": {
        playhead = clamp(message.time, 0, 0.999999);
        markDirty();
        post({ type: "frame", time: playhead });
        break;
      }
      case "visibility": {
        visible = message.visible;
        lastTick = 0;
        if (!visible && frameToken !== null) {
          cancelFrame(frameToken);
          frameToken = null;
        }
        if (visible) markDirty();
        break;
      }
      case "export-svg": {
        exportSvg(message.requestId);
        break;
      }
    }
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});
