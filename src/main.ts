import "./styles.css";

import { OUTPUT_FORMATS, getOutputFormat } from "./core/formats";
import { clamp } from "./core/random";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./core/protocol";
import {
  deleteProject as deleteSavedProject,
  listSavedProjects,
  saveProject,
  type SavedProjectRecord
} from "./core/storage";
import type { EngineState, ProjectDefinition, RangeControlDefinition } from "./core/types";
import { exportAlphaWebM, supportsAlphaWebM } from "./core/video-export";
import { createWebPackage } from "./core/web-export";
import { createPresetDownload, parseSharedPreset } from "./core/preset";
import { PROJECTS, getProject } from "./projects";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id}.`);
  return element as T;
}

const projectSelect = byId<HTMLSelectElement>("project-select");
const formatSelect = byId<HTMLSelectElement>("format-select");
const seedInput = byId<HTMLInputElement>("seed-input");
const saveNameInput = byId<HTMLInputElement>("save-name-input");
const savedProjectSelect = byId<HTMLSelectElement>("saved-project-select");
const saveProjectButton = byId<HTMLButtonElement>("save-project-button");
const loadProjectButton = byId<HTMLButtonElement>("load-project-button");
const deleteProjectButton = byId<HTMLButtonElement>("delete-project-button");
const importPresetButton = byId<HTMLButtonElement>("import-preset-button");
const importPresetInput = byId<HTMLInputElement>("import-preset-input");
const storageError = byId<HTMLParagraphElement>("storage-error");
const deleteProjectDialog = byId<HTMLDialogElement>("delete-project-dialog");
const confirmDeleteProjectButton = byId<HTMLButtonElement>("confirm-delete-project-button");
const projectControls = byId<HTMLDivElement>("project-controls");
const resetFormulaButton = byId<HTMLButtonElement>("reset-formula-button");
const backgroundColor = byId<HTMLInputElement>("background-color");
const foregroundColor = byId<HTMLInputElement>("foreground-color");
const backgroundColorValue = byId<HTMLOutputElement>("background-color-value");
const foregroundColorValue = byId<HTMLOutputElement>("foreground-color-value");
const speedInput = byId<HTMLInputElement>("speed-input");
const speedValue = byId<HTMLOutputElement>("speed-value");
const durationInput = byId<HTMLInputElement>("duration-input");
const durationValue = byId<HTMLOutputElement>("duration-value");
const timelineInput = byId<HTMLInputElement>("timeline-input");
const timelineValue = byId<HTMLOutputElement>("timeline-value");
const videoFpsSelect = byId<HTMLSelectElement>("video-fps-select");
const exportAlphaVideoButton = byId<HTMLButtonElement>("export-alpha-video-button");
const cancelAlphaVideoButton = byId<HTMLButtonElement>("cancel-alpha-video-button");
const videoExportProgress = byId<HTMLProgressElement>("video-export-progress");
const videoExportStatus = byId<HTMLParagraphElement>("video-export-status");
const webBackgroundSelect = byId<HTMLSelectElement>("web-background-select");
const exportWebButton = byId<HTMLButtonElement>("export-web-button");
const webExportError = byId<HTMLParagraphElement>("web-export-error");
const webExportStatus = byId<HTMLParagraphElement>("web-export-status");
const presetExportName = byId<HTMLInputElement>("preset-export-name");
const exportPresetButton = byId<HTMLButtonElement>("export-preset-button");
const presetExportError = byId<HTMLParagraphElement>("preset-export-error");
const presetExportStatus = byId<HTMLParagraphElement>("preset-export-status");
const savedDialog = byId<HTMLDialogElement>("saved-dialog");
const openSavedDialogButton = byId<HTMLButtonElement>("open-saved-dialog-button");
const closeSavedDialogButton = byId<HTMLButtonElement>("close-saved-dialog-button");
const exportDialog = byId<HTMLDialogElement>("export-dialog");
const openExportDialogButton = byId<HTMLButtonElement>("open-export-dialog-button");
const closeExportDialogButton = byId<HTMLButtonElement>("close-export-dialog-button");
const playButton = byId<HTMLButtonElement>("play-button");
const newSeedButton = byId<HTMLButtonElement>("new-seed-button");
const invertButton = byId<HTMLButtonElement>("invert-button");
const exportButton = byId<HTMLButtonElement>("export-button");
const svgExportStatus = byId<HTMLParagraphElement>("svg-export-status");
const appStatus = byId<HTMLParagraphElement>("app-status");
const canvasMeta = byId<HTMLSpanElement>("canvas-meta");
const engineState = byId<HTMLSpanElement>("engine-state");
const canvasStage = byId<HTMLDivElement>("canvas-stage");
const canvas = byId<HTMLCanvasElement>("cauce-canvas");
const canvasMessage = byId<HTMLParagraphElement>("canvas-message");
const canvasError = byId<HTMLParagraphElement>("canvas-error");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const projectParameters = new Map(
  PROJECTS.map((project) => [project.id, { ...project.defaults }])
);

let state: EngineState = {
  projectId: PROJECTS[0]!.id,
  formatKey: OUTPUT_FORMATS[0]!.key,
  seed: 6437,
  palette: {
    background: "#11110f",
    foreground: "#f4f3ee"
  },
  playback: {
    playing: !reducedMotion.matches,
    speed: 1,
    loopSeconds: 8
  },
  parameters: { ...PROJECTS[0]!.defaults }
};

let workerReady = false;
let scrubbing = false;
let resumeAfterScrub = false;
let stageVisible = true;
let currentTime = 0;
let savedProjects: SavedProjectRecord[] = [];
let pendingDeleteId = "";
let videoExportController: AbortController | null = null;

const worker = new Worker(new URL("./core/engine.worker.ts", import.meta.url), {
  type: "module"
});

function post(message: MainToWorkerMessage, transfer?: Transferable[]): void {
  if (transfer) {
    worker.postMessage(message, transfer);
    return;
  }
  worker.postMessage(message);
}

function postState(): void {
  post({ type: "state", state });
  updateStaticUi();
}

function formatControlValue(control: RangeControlDefinition, value: number): string {
  const digits = control.digits ?? 2;
  return value.toFixed(digits) + (control.suffix ?? "");
}

function makeOption(value: string, label: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function populateStaticSelects(): void {
  projectSelect.replaceChildren(...PROJECTS.map((project) => (
    makeOption(project.id, `${project.index} · ${project.name}`)
  )));
  formatSelect.replaceChildren(...OUTPUT_FORMATS.map((format) => (
    makeOption(format.key, `${format.label} · ${format.width} × ${format.height}`)
  )));
  projectSelect.value = state.projectId;
  formatSelect.value = state.formatKey;
}

function setStorageError(message: string): void {
  storageError.textContent = message;
  storageError.hidden = message.length === 0;
}

function refreshSavedProjects(selectedId = ""): void {
  savedProjects = listSavedProjects();
  if (savedProjects.length === 0) {
    savedProjectSelect.replaceChildren(makeOption("", "Sin guardados"));
    savedProjectSelect.disabled = true;
    loadProjectButton.disabled = true;
    deleteProjectButton.disabled = true;
    return;
  }

  savedProjectSelect.replaceChildren(...savedProjects.map((record) => {
    const project = getProject(record.state.projectId);
    return makeOption(record.id, `${record.name} · ${project.index}`);
  }));
  savedProjectSelect.disabled = false;
  loadProjectButton.disabled = false;
  deleteProjectButton.disabled = false;
  savedProjectSelect.value = selectedId && savedProjects.some((record) => record.id === selectedId)
    ? selectedId
    : savedProjects[0]!.id;
}

function renderProjectControls(project: ProjectDefinition): void {
  const fragment = document.createDocumentFragment();

  for (const control of project.controls) {
    const label = document.createElement("label");
    const inputId = `parameter-${project.id}-${control.key}`;
    const outputId = `${inputId}-value`;
    label.className = "control-label";
    label.htmlFor = inputId;

    const labelRow = document.createElement("span");
    labelRow.className = "label-row";
    const labelText = document.createElement("span");
    labelText.textContent = control.label;
    const output = document.createElement("output");
    output.id = outputId;
    output.htmlFor = inputId;
    output.value = formatControlValue(control, state.parameters[control.key] ?? control.defaultValue);
    labelRow.append(labelText, output);

    const input = document.createElement("input");
    input.id = inputId;
    input.type = "range";
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step);
    input.value = String(state.parameters[control.key] ?? control.defaultValue);
    input.addEventListener("input", () => {
      const nextValue = Number(input.value);
      output.value = formatControlValue(control, nextValue);
      state = {
        ...state,
        parameters: { ...state.parameters, [control.key]: nextValue }
      };
      projectParameters.set(state.projectId, { ...state.parameters });
      appStatus.textContent = `${control.label}: ${output.value}.`;
      postState();
    });

    label.append(labelRow, input);
    fragment.appendChild(label);
  }

  projectControls.replaceChildren(fragment);
}

function updatePlaybackButton(): void {
  playButton.textContent = state.playback.playing ? "Pausar" : "Reproducir";
  playButton.setAttribute("aria-pressed", String(state.playback.playing));
  engineState.textContent = state.playback.playing ? "ENGINE / RUNNING" : "ENGINE / PAUSED";
}

function formulaUsesDefaults(project: ProjectDefinition): boolean {
  return project.controls.every((control) => (
    state.parameters[control.key] === project.defaults[control.key]
  ));
}

function updateStaticUi(): void {
  const project = getProject(state.projectId);
  const format = getOutputFormat(state.formatKey);
  canvasMeta.textContent = `${format.label} · ${format.width} × ${format.height} · ${project.preferredFps} fps`;
  seedInput.value = String(state.seed);
  projectSelect.value = state.projectId;
  formatSelect.value = state.formatKey;
  backgroundColor.value = state.palette.background;
  foregroundColor.value = state.palette.foreground;
  backgroundColorValue.value = state.palette.background.toUpperCase();
  foregroundColorValue.value = state.palette.foreground.toUpperCase();
  speedInput.value = String(state.playback.speed);
  speedValue.value = `${state.playback.speed.toFixed(2)}×`;
  durationInput.value = String(state.playback.loopSeconds);
  durationValue.value = `${state.playback.loopSeconds.toFixed(1)} s`;
  resetFormulaButton.disabled = formulaUsesDefaults(project);
  updatePlaybackButton();
}

function changeProject(projectId: string): void {
  const project = getProject(projectId);
  const parameters = projectParameters.get(project.id) ?? { ...project.defaults };
  state = {
    ...state,
    projectId: project.id,
    formatKey: project.preferredFormatKey ?? state.formatKey,
    playback: {
      ...state.playback,
      loopSeconds: project.preferredLoopSeconds ?? state.playback.loopSeconds
    },
    parameters: { ...parameters }
  };
  renderProjectControls(project);
  videoFpsSelect.value = String(project.preferredFps);
  appStatus.textContent = `${project.index} · ${project.name} cargado.`;
  postState();
}

function setPlaying(playing: boolean): void {
  state = {
    ...state,
    playback: { ...state.playback, playing }
  };
  postState();
}

function setPalette(background: string, foreground: string): void {
  state = {
    ...state,
    palette: { background, foreground }
  };
  postState();
}

function createSeed(): number {
  const values = new Uint32Array(1);
  window.crypto.getRandomValues(values);
  return values[0]!;
}

function downloadSvg(source: string, filename: string): void {
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function applySavedProject(record: SavedProjectRecord): void {
  state = normalizeCompatibleState(record.state);
  currentTime = clamp(record.time, 0, 0.999999);
  projectParameters.set(state.projectId, { ...state.parameters });
  const project = getProject(state.projectId);
  renderProjectControls(project);
  videoFpsSelect.value = String(project.preferredFps);
  updateStaticUi();
  post({ type: "state", state });
  post({ type: "seek", time: currentTime });
  timelineInput.value = String(currentTime);
  timelineValue.value = `${Math.round(currentTime * 100)}%`;
}

function normalizeCompatibleState(candidate: EngineState): EngineState {
  const projectId = candidate.projectId === "flow-advection"
    ? "vector-currents"
    : candidate.projectId;
  const project = PROJECTS.find((entry) => entry.id === projectId);
  const formatExists = OUTPUT_FORMATS.some((format) => format.key === candidate.formatKey);
  if (!project || !formatExists) {
    throw new Error("El preset usa un proyecto o formato que esta versión de Cauce no incluye.");
  }

  const colorPattern = /^#[0-9a-f]{6}$/i;
  if (
    !colorPattern.test(candidate.palette.background) ||
    !colorPattern.test(candidate.palette.foreground)
  ) {
    throw new Error("El preset contiene una paleta de color no válida.");
  }

  const usesLegacyVectorField = project.id === "vector-currents" &&
    typeof candidate.parameters.bend !== "number";
  const suppliedParameters = usesLegacyVectorField
    ? {
        ...candidate.parameters,
        scale: 1,
        bend: (candidate.parameters.turbulence ?? 0.75) * 1.6,
        drift: 1,
        coverage: (candidate.parameters.current ?? 0.62) * 1.37,
        contrast: 1.35
      }
    : candidate.parameters;
  const parameters = Object.fromEntries(project.controls.map((control) => {
    const supplied = suppliedParameters[control.key];
    const value = typeof supplied === "number" && Number.isFinite(supplied)
      ? supplied
      : control.defaultValue;
    return [control.key, clamp(value, control.min, control.max)];
  }));

  return {
    projectId: project.id,
    formatKey: candidate.formatKey,
    seed: Math.round(clamp(candidate.seed, 0, 4294967295)),
    palette: {
      background: candidate.palette.background.toLowerCase(),
      foreground: candidate.palette.foreground.toLowerCase()
    },
    playback: {
      playing: candidate.playback.playing,
      speed: clamp(candidate.playback.speed, 0.25, 2),
      loopSeconds: clamp(candidate.playback.loopSeconds, 2, 20)
    },
    parameters
  };
}

worker.addEventListener("message", (event: MessageEvent<WorkerToMainMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "ready":
      workerReady = true;
      canvasMessage.hidden = true;
      engineState.textContent = state.playback.playing ? "ENGINE / RUNNING" : "ENGINE / PAUSED";
      appStatus.textContent = "Motor listo.";
      break;
    case "frame":
      currentTime = message.time;
      if (!scrubbing) {
        timelineInput.value = String(message.time);
        timelineValue.value = `${Math.round(message.time * 100)}%`;
      }
      break;
    case "svg":
      downloadSvg(message.source, message.filename);
      appStatus.textContent = `${message.filename} exportado.`;
      svgExportStatus.textContent = `${message.filename} descargado.`;
      exportButton.disabled = false;
      break;
    case "error":
      canvasError.hidden = false;
      canvasError.textContent = message.message;
      canvasMessage.hidden = true;
      engineState.textContent = "Error del motor";
      appStatus.textContent = "El motor ha encontrado un error.";
      svgExportStatus.textContent = message.message;
      exportButton.disabled = false;
      break;
  }
});

worker.addEventListener("error", (event) => {
  canvasError.hidden = false;
  canvasError.textContent = event.message || "No se pudo iniciar el worker gráfico.";
  canvasMessage.hidden = true;
  engineState.textContent = "Worker no disponible";
});

projectSelect.addEventListener("change", () => changeProject(projectSelect.value));

openSavedDialogButton.addEventListener("click", () => {
  setStorageError("");
  savedDialog.showModal();
});

closeSavedDialogButton.addEventListener("click", () => {
  savedDialog.close();
});

resetFormulaButton.addEventListener("click", () => {
  const project = getProject(state.projectId);
  state = {
    ...state,
    parameters: { ...project.defaults }
  };
  projectParameters.set(project.id, { ...project.defaults });
  renderProjectControls(project);
  appStatus.textContent = `${project.index} · ${project.name}: fórmula reiniciada.`;
  postState();
});

saveProjectButton.addEventListener("click", () => {
  const name = saveNameInput.value.trim();
  if (!name) {
    setStorageError("Escribe un nombre antes de guardar.");
    saveNameInput.focus();
    return;
  }

  try {
    const record = saveProject(name, state, currentTime);
    refreshSavedProjects(record.id);
    saveNameInput.value = "";
    setStorageError("");
    appStatus.textContent = `“${record.name}” guardado en este navegador.`;
  } catch (error) {
    setStorageError(error instanceof Error ? error.message : "No se pudo guardar el proyecto.");
  }
});

loadProjectButton.addEventListener("click", () => {
  const record = savedProjects.find((candidate) => candidate.id === savedProjectSelect.value);
  if (!record) {
    setStorageError("Selecciona un proyecto guardado.");
    return;
  }

  try {
    applySavedProject(record);
    setStorageError("");
    appStatus.textContent = `“${record.name}” cargado.`;
    savedDialog.close();
  } catch (error) {
    setStorageError(error instanceof Error ? error.message : "No se pudo cargar el proyecto.");
  }
});

deleteProjectButton.addEventListener("click", () => {
  const record = savedProjects.find((candidate) => candidate.id === savedProjectSelect.value);
  if (!record) {
    setStorageError("Selecciona un proyecto guardado.");
    return;
  }
  pendingDeleteId = record.id;
  deleteProjectDialog.showModal();
});

confirmDeleteProjectButton.addEventListener("click", () => {
  if (!pendingDeleteId) return;
  const record = savedProjects.find((candidate) => candidate.id === pendingDeleteId);
  try {
    deleteSavedProject(pendingDeleteId);
    refreshSavedProjects();
    setStorageError("");
    appStatus.textContent = record ? `“${record.name}” eliminado.` : "Guardado eliminado.";
  } catch (error) {
    setStorageError(error instanceof Error ? error.message : "No se pudo eliminar el guardado.");
  } finally {
    pendingDeleteId = "";
  }
});

deleteProjectDialog.addEventListener("close", () => {
  pendingDeleteId = "";
});

importPresetButton.addEventListener("click", () => {
  importPresetInput.click();
});

importPresetInput.addEventListener("change", async () => {
  const file = importPresetInput.files?.[0];
  if (!file) return;
  importPresetButton.disabled = true;
  setStorageError("");

  try {
    const preset = parseSharedPreset(await file.text());
    const safeState = normalizeCompatibleState(preset.state);
    const record = saveProject(preset.name, safeState, preset.time);
    refreshSavedProjects(record.id);
    applySavedProject(record);
    appStatus.textContent = `“${record.name}” importado y cargado.`;
    savedDialog.close();
  } catch (error) {
    setStorageError(error instanceof Error ? error.message : "No se pudo importar el preset.");
  } finally {
    importPresetButton.disabled = false;
    importPresetInput.value = "";
  }
});

formatSelect.addEventListener("change", () => {
  state = { ...state, formatKey: formatSelect.value };
  const format = getOutputFormat(state.formatKey);
  appStatus.textContent = `Formato ${format.label} seleccionado.`;
  postState();
});

seedInput.addEventListener("change", () => {
  const parsed = Number(seedInput.value);
  state = {
    ...state,
    seed: Number.isFinite(parsed) ? Math.round(clamp(parsed, 0, 4294967295)) : state.seed
  };
  appStatus.textContent = `Semilla ${state.seed} aplicada.`;
  postState();
});

backgroundColor.addEventListener("input", () => {
  setPalette(backgroundColor.value, state.palette.foreground);
  appStatus.textContent = "Color de fondo actualizado.";
});

foregroundColor.addEventListener("input", () => {
  setPalette(state.palette.background, foregroundColor.value);
  appStatus.textContent = "Color de trazo actualizado.";
});

speedInput.addEventListener("input", () => {
  state = {
    ...state,
    playback: { ...state.playback, speed: Number(speedInput.value) }
  };
  appStatus.textContent = `Velocidad ${state.playback.speed.toFixed(2)}×.`;
  postState();
});

durationInput.addEventListener("input", () => {
  state = {
    ...state,
    playback: { ...state.playback, loopSeconds: Number(durationInput.value) }
  };
  appStatus.textContent = `Bucle de ${state.playback.loopSeconds.toFixed(1)} segundos.`;
  postState();
});

timelineInput.addEventListener("pointerdown", () => {
  scrubbing = true;
  resumeAfterScrub = state.playback.playing;
  if (resumeAfterScrub) setPlaying(false);
});

timelineInput.addEventListener("input", () => {
  const time = Number(timelineInput.value);
  timelineValue.value = `${Math.round(time * 100)}%`;
  post({ type: "seek", time });
});

function finishScrubbing(): void {
  if (!scrubbing) return;
  scrubbing = false;
  if (resumeAfterScrub) setPlaying(true);
  resumeAfterScrub = false;
}

timelineInput.addEventListener("pointerup", finishScrubbing);
timelineInput.addEventListener("change", finishScrubbing);

playButton.addEventListener("click", () => {
  setPlaying(!state.playback.playing);
  appStatus.textContent = state.playback.playing ? "Reproducción iniciada." : "Reproducción pausada.";
});

newSeedButton.addEventListener("click", () => {
  state = { ...state, seed: createSeed() };
  appStatus.textContent = `Nueva semilla ${state.seed}.`;
  postState();
});

invertButton.addEventListener("click", () => {
  setPalette(state.palette.foreground, state.palette.background);
  appStatus.textContent = "Paleta invertida.";
});

exportButton.addEventListener("click", () => {
  exportButton.disabled = true;
  appStatus.textContent = "Preparando SVG…";
  svgExportStatus.textContent = "Generando fotograma vectorial…";
  post({ type: "export-svg", requestId: window.crypto.randomUUID() });
});

openExportDialogButton.addEventListener("click", () => {
  if (!presetExportName.value.trim()) {
    const project = getProject(state.projectId);
    presetExportName.value = `${project.name} ${state.seed}`;
  }
  exportDialog.showModal();
});

closeExportDialogButton.addEventListener("click", () => {
  exportDialog.close();
});

exportAlphaVideoButton.addEventListener("click", async () => {
  if (videoExportController) return;

  const exportState = structuredClone(state);
  const fps = Number(videoFpsSelect.value);
  const wasPlaying = state.playback.playing;
  if (wasPlaying) setPlaying(false);
  videoExportController = new AbortController();
  exportAlphaVideoButton.disabled = true;
  cancelAlphaVideoButton.disabled = false;
  videoExportProgress.hidden = false;
  videoExportProgress.value = 0;
  videoExportStatus.textContent = "Comprobando codificador VP9 con alpha…";

  try {
    const supported = await supportsAlphaWebM(exportState);
    if (!supported) {
      throw new Error("Este navegador no puede codificar VP9 conservando transparencia.");
    }

    videoExportStatus.textContent = "Renderizando fotogramas transparentes…";
    const result = await exportAlphaWebM({
      state: exportState,
      fps,
      signal: videoExportController.signal,
      onProgress(progress) {
        videoExportProgress.value = progress;
        videoExportStatus.textContent = `Codificando WebM alpha · ${Math.round(progress * 100)}%`;
      }
    });
    downloadBlob(result.blob, result.filename);
    videoExportStatus.textContent = `${result.filename} · ${result.frameCount} fotogramas.`;
    appStatus.textContent = "Vídeo transparente exportado.";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      videoExportStatus.textContent = "Exportación de vídeo cancelada.";
    } else {
      videoExportStatus.textContent = error instanceof Error
        ? error.message
        : "No se pudo exportar el vídeo transparente.";
    }
  } finally {
    videoExportController = null;
    exportAlphaVideoButton.disabled = false;
    cancelAlphaVideoButton.disabled = true;
    if (wasPlaying) setPlaying(true);
  }
});

cancelAlphaVideoButton.addEventListener("click", () => {
  videoExportController?.abort();
  cancelAlphaVideoButton.disabled = true;
  videoExportStatus.textContent = "Cancelando exportación…";
});

exportWebButton.addEventListener("click", () => {
  exportWebButton.disabled = true;
  webExportError.hidden = true;
  webExportError.textContent = "";
  webExportStatus.textContent = "Construyendo paquete autónomo…";

  try {
    const result = createWebPackage(
      structuredClone(state),
      currentTime,
      webBackgroundSelect.value === "transparent"
    );
    downloadBlob(result.blob, result.filename);
    webExportStatus.textContent = `${result.filename} · módulo, configuración, ejemplo y documentación.`;
    appStatus.textContent = "Paquete web exportado.";
  } catch (error) {
    webExportError.textContent = error instanceof Error
      ? error.message
      : "No se pudo construir el paquete web.";
    webExportError.hidden = false;
    webExportStatus.textContent = "Exportación web interrumpida.";
  } finally {
    exportWebButton.disabled = false;
  }
});

exportPresetButton.addEventListener("click", () => {
  presetExportError.hidden = true;
  presetExportError.textContent = "";
  const name = presetExportName.value.trim();
  if (!name) {
    presetExportError.textContent = "Escribe un nombre para el preset.";
    presetExportError.hidden = false;
    presetExportName.focus();
    return;
  }

  try {
    const result = createPresetDownload(name, structuredClone(state), currentTime);
    downloadBlob(result.blob, result.filename);
    presetExportStatus.textContent = `${result.filename} descargado.`;
    appStatus.textContent = "Preset compartible exportado.";
  } catch (error) {
    presetExportError.textContent = error instanceof Error
      ? error.message
      : "No se pudo exportar el preset.";
    presetExportError.hidden = false;
  }
});

reducedMotion.addEventListener("change", (event) => {
  if (event.matches && state.playback.playing) {
    setPlaying(false);
    appStatus.textContent = "Animación pausada por la preferencia de movimiento reducido.";
  }
});

const visibilityObserver = new IntersectionObserver((entries) => {
  stageVisible = entries.some((entry) => entry.isIntersecting) && !document.hidden;
  post({ type: "visibility", visible: stageVisible });
}, { threshold: 0.01 });
visibilityObserver.observe(canvasStage);

document.addEventListener("visibilitychange", () => {
  post({ type: "visibility", visible: stageVisible && !document.hidden });
});

function initializeWorker(): void {
  if (!("transferControlToOffscreen" in canvas)) {
    canvasMessage.hidden = true;
    canvasError.hidden = false;
    canvasError.textContent = "Este navegador no permite transferir Canvas a un worker.";
    engineState.textContent = "ENGINE / UNSUPPORTED";
    return;
  }

  const bounds = canvasStage.getBoundingClientRect();
  const offscreen = canvas.transferControlToOffscreen();
  post({
    type: "init",
    canvas: offscreen,
    cssWidth: Math.max(1, bounds.width),
    cssHeight: Math.max(1, bounds.height),
    pixelRatio: window.devicePixelRatio,
    state
  }, [offscreen]);
}

const resizeObserver = new ResizeObserver((entries) => {
  if (!workerReady) return;
  const entry = entries[0];
  if (!entry) return;
  post({
    type: "resize",
    cssWidth: Math.max(1, entry.contentRect.width),
    cssHeight: Math.max(1, entry.contentRect.height),
    pixelRatio: window.devicePixelRatio
  });
});
resizeObserver.observe(canvasStage);

populateStaticSelects();
refreshSavedProjects();
renderProjectControls(getProject(state.projectId));
updateStaticUi();
initializeWorker();
