import "./styles.css";

import { OUTPUT_FORMATS, getOutputFormat } from "./core/formats";
import { UndoHistory, type HistoryEntry } from "./core/history";
import { decodeImageField } from "./core/image-field";
import {
  deleteDurableColor,
  deleteDurableProject,
  persistDurableLibrary,
  syncDurableLibrary
} from "./core/durable-library";
import {
  installLocalLibraryBridge,
  isLocalLibraryBridge,
  syncLoopbackLibraries
} from "./core/local-library-sync";
import { clamp, positiveModulo } from "./core/random";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./core/protocol";
import {
  createLibraryBackupDownload,
  deleteColor as deleteSavedColor,
  deleteProject as deleteSavedProject,
  importLibraryBackup,
  isLibraryStorageKey,
  listSavedColors,
  listSavedProjects,
  saveColor,
  saveProject,
  type SavedColorGradient,
  type SavedColorRecord,
  type SavedProjectRecord
} from "./core/storage";
import type {
  EngineState,
  ImageField,
  ProjectDefinition,
  RangeControlDefinition
} from "./core/types";
import { createDefaultView, normalizeView, viewUsesDefaults } from "./core/view";
import {
  checkVideoProfile,
  exportVideo,
  type VideoProfile
} from "./core/video-export";
import { createPresetDownload, parseSharedPreset } from "./core/preset";
import { PROJECTS, getProject } from "./projects";
import { paletteGradientStops } from "./projects/shared.js";

installLocalLibraryBridge();

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
const exportLibraryButton = byId<HTMLButtonElement>("export-library-button");
const importLibraryButton = byId<HTMLButtonElement>("import-library-button");
const importLibraryInput = byId<HTMLInputElement>("import-library-input");
const importPresetButton = byId<HTMLButtonElement>("import-preset-button");
const importPresetInput = byId<HTMLInputElement>("import-preset-input");
const storageError = byId<HTMLParagraphElement>("storage-error");
const deleteProjectDialog = byId<HTMLDialogElement>("delete-project-dialog");
const confirmDeleteProjectButton = byId<HTMLButtonElement>("confirm-delete-project-button");
const projectControls = byId<HTMLDivElement>("project-controls");
const imageSourceSection = byId<HTMLElement>("image-source-section");
const imageUploadButton = byId<HTMLButtonElement>("image-upload-button");
const imageUploadInput = byId<HTMLInputElement>("image-upload-input");
const clearImageButton = byId<HTMLButtonElement>("clear-image-button");
const imageSourceStatus = byId<HTMLParagraphElement>("image-source-status");
const imageSourceError = byId<HTMLParagraphElement>("image-source-error");
const appearanceSection = byId<HTMLElement>("appearance-section");
const appearanceControls = byId<HTMLDivElement>("appearance-controls");
const gradientEditor = byId<HTMLElement>("gradient-editor");
const gradientControls = byId<HTMLDivElement>("gradient-controls");
const gradientPreview = byId<HTMLDivElement>("gradient-preview");
const palettePreview = byId<HTMLDivElement>("palette-preview");
const colorError = byId<HTMLParagraphElement>("color-error");
const resetFormulaButton = byId<HTMLButtonElement>("reset-formula-button");
const undoButton = byId<HTMLButtonElement>("undo-button");
const redoButton = byId<HTMLButtonElement>("redo-button");
const backgroundColor = byId<HTMLInputElement>("background-color");
const foregroundColor = byId<HTMLInputElement>("foreground-color");
const accentColor = byId<HTMLInputElement>("accent-color");
const secondaryColor = byId<HTMLInputElement>("secondary-color");
const backgroundColorValue = byId<HTMLInputElement>("background-color-value");
const foregroundColorValue = byId<HTMLInputElement>("foreground-color-value");
const accentColorValue = byId<HTMLInputElement>("accent-color-value");
const secondaryColorValue = byId<HTMLInputElement>("secondary-color-value");
const speedInput = byId<HTMLInputElement>("speed-input");
const speedDecreaseButton = byId<HTMLButtonElement>("speed-decrease-button");
const speedIncreaseButton = byId<HTMLButtonElement>("speed-increase-button");
const durationInput = byId<HTMLInputElement>("duration-input");
const durationDecreaseButton = byId<HTMLButtonElement>("duration-decrease-button");
const durationIncreaseButton = byId<HTMLButtonElement>("duration-increase-button");
const timelineInput = byId<HTMLInputElement>("timeline-input");
const timelineValue = byId<HTMLOutputElement>("timeline-value");
const timelineLoopMarker = byId<HTMLSpanElement>("timeline-loop-marker");
const loopStartControl = byId<HTMLDivElement>("loop-start-control");
const loopStartValue = byId<HTMLOutputElement>("loop-start-value");
const setLoopStartButton = byId<HTMLButtonElement>("set-loop-start-button");
const resetLoopStartButton = byId<HTMLButtonElement>("reset-loop-start-button");
const videoProfileSelect = byId<HTMLSelectElement>("video-profile-select");
const videoFpsSelect = byId<HTMLSelectElement>("video-fps-select");
const exportVideoButton = byId<HTMLButtonElement>("export-video-button");
const cancelVideoButton = byId<HTMLButtonElement>("cancel-video-button");
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
const colorDialog = byId<HTMLDialogElement>("color-dialog");
const openColorDialogButton = byId<HTMLButtonElement>("open-color-dialog-button");
const closeColorDialogButton = byId<HTMLButtonElement>("close-color-dialog-button");
const colorNameInput = byId<HTMLInputElement>("color-name-input");
const saveColorButton = byId<HTMLButtonElement>("save-color-button");
const savedColorSelect = byId<HTMLSelectElement>("saved-color-select");
const applyColorButton = byId<HTMLButtonElement>("apply-color-button");
const deleteColorButton = byId<HTMLButtonElement>("delete-color-button");
const colorLibraryError = byId<HTMLParagraphElement>("color-library-error");
const currentColorPreview = byId<HTMLDivElement>("current-color-preview");
const selectedColorPreview = byId<HTMLDivElement>("selected-color-preview");
const deleteColorDialog = byId<HTMLDialogElement>("delete-color-dialog");
const confirmDeleteColorButton = byId<HTMLButtonElement>("confirm-delete-color-button");
const exportDialog = byId<HTMLDialogElement>("export-dialog");
const openExportDialogButton = byId<HTMLButtonElement>("open-export-dialog-button");
const closeExportDialogButton = byId<HTMLButtonElement>("close-export-dialog-button");
const exportKindInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>("input[name='export-kind']")
);
const exportPanels = Array.from(
  document.querySelectorAll<HTMLElement>("[data-export-panel]")
);
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
const threeCanvas = byId<HTMLCanvasElement>("cauce-three-canvas");
const canvasMessage = byId<HTMLParagraphElement>("canvas-message");
const canvasError = byId<HTMLParagraphElement>("canvas-error");
const viewportHud = byId<HTMLElement>("viewport-hud");
const viewportValue = byId<HTMLOutputElement>("viewport-value");
const viewportOrbitButton = byId<HTMLButtonElement>("viewport-orbit-button");
const viewportPanButton = byId<HTMLButtonElement>("viewport-pan-button");
const viewportZoomOutButton = byId<HTMLButtonElement>("viewport-zoom-out-button");
const viewportZoomInButton = byId<HTMLButtonElement>("viewport-zoom-in-button");
const viewportZoomInput = byId<HTMLInputElement>("viewport-zoom-input");
const viewportResetButton = byId<HTMLButtonElement>("viewport-reset-button");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const projectParameters = new Map(
  PROJECTS.map((project) => [project.id, { ...project.defaults }])
);
const projectViews = new Map(
  PROJECTS.map((project) => [project.id, createDefaultView()])
);

let state: EngineState = {
  projectId: PROJECTS[0]!.id,
  formatKey: OUTPUT_FORMATS[0]!.key,
  seed: 6437,
  palette: {
    background: "#11110f",
    foreground: "#f4f3ee",
    accent: "#aeb7ff",
    secondary: "#8ecfc2"
  },
  view: createDefaultView(),
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
let currentImageField: ImageField | null = null;
let currentImageName = "";
let savedProjects: SavedProjectRecord[] = [];
let savedColors: SavedColorRecord[] = [];
let pendingDeleteId = "";
let pendingDeleteColorId = "";
let videoExportController: AbortController | null = null;
let viewMode: "orbit" | "pan" = "orbit";
let queuedViewFrame = 0;
const activePointers = new Map<number, { x: number; y: number }>();
let pointerAnchor: { x: number; y: number } | null = null;
let gestureAnchor: { distance: number; x: number; y: number } | null = null;
let wheelHistoryTimer = 0;

interface EditorSnapshot {
  state: EngineState;
  time: number;
}

const editorHistory = new UndoHistory<EditorSnapshot>(100);
const activeHistoryInteractions = new Set<string>();

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

function postImageField(): void {
  post({ type: "image-field", field: currentImageField });
}

function setImageSourceError(message: string): void {
  imageSourceError.textContent = message;
  imageSourceError.hidden = message.length === 0;
}

function updateImageSourceUi(): void {
  const active = state.projectId === "image-currents";
  imageSourceSection.hidden = !active;
  if (!active) return;

  clearImageButton.disabled = currentImageField === null;
  imageUploadButton.textContent = currentImageField
    ? "Cambiar fotografía"
    : "Seleccionar fotografía";
  imageSourceStatus.textContent = currentImageField
    ? `${currentImageName} · ${currentImageField.width} × ${currentImageField.height} · solo esta sesión.`
    : "Sin fotografía · se muestra el retrato de prueba. JPG, PNG, WebP o AVIF; máximo 20 MB.";
}

function captureEditorSnapshot(): EditorSnapshot {
  return {
    state: structuredClone(state),
    time: currentTime
  };
}

function updateHistoryButtons(): void {
  undoButton.disabled = !editorHistory.canUndo;
  redoButton.disabled = !editorHistory.canRedo;
  undoButton.title = editorHistory.canUndo
    ? `Deshacer: ${editorHistory.undoLabel} (⌘Z / Ctrl+Z)`
    : "Nada que deshacer";
  redoButton.title = editorHistory.canRedo
    ? `Rehacer: ${editorHistory.redoLabel} (⇧⌘Z / Ctrl+Y)`
    : "Nada que rehacer";
}

function recordHistory(label: string, restoreTime = false): void {
  editorHistory.record(captureEditorSnapshot(), label, restoreTime);
  updateHistoryButtons();
}

function beginHistoryInteraction(key: string, label: string, restoreTime = false): void {
  if (activeHistoryInteractions.has(key)) return;
  activeHistoryInteractions.add(key);
  recordHistory(label, restoreTime);
}

function endHistoryInteraction(key: string): void {
  activeHistoryInteractions.delete(key);
}

function endAllHistoryInteractions(): void {
  activeHistoryInteractions.clear();
  if (wheelHistoryTimer) {
    window.clearTimeout(wheelHistoryTimer);
    wheelHistoryTimer = 0;
  }
}

function applyHistoryEntry(entry: HistoryEntry<EditorSnapshot>, direction: "undo" | "redo"): void {
  const playing = state.playback.playing;
  state = structuredClone(entry.snapshot.state);
  state.playback.playing = playing;
  if (entry.restoreTime) currentTime = clamp(entry.snapshot.time, 0, 0.999999);

  projectParameters.set(state.projectId, { ...state.parameters });
  projectViews.set(state.projectId, { ...state.view });
  const project = getProject(state.projectId);
  renderProjectControls(project);
  videoFpsSelect.value = String(project.preferredFps);
  updateStaticUi();
  timelineInput.value = String(currentTime);
  timelineValue.value = `${Math.round(currentTime * 100)}%`;
  post({ type: "state", state });
  if (entry.restoreTime) post({ type: "seek", time: currentTime });
  appStatus.textContent = direction === "undo"
    ? `Deshecho: ${entry.label}.`
    : `Rehecho: ${entry.label}.`;
  updateHistoryButtons();
}

function undo(): void {
  endAllHistoryInteractions();
  const entry = editorHistory.undo(captureEditorSnapshot());
  if (entry) applyHistoryEntry(entry, "undo");
}

function redo(): void {
  endAllHistoryInteractions();
  const entry = editorHistory.redo(captureEditorSnapshot());
  if (entry) applyHistoryEntry(entry, "redo");
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

function setColorLibraryError(message: string): void {
  colorLibraryError.textContent = message;
  colorLibraryError.hidden = message.length === 0;
}

function setColorError(message: string): void {
  colorError.textContent = message;
  colorError.hidden = message.length === 0;
}

function currentGradientSettings(project = getProject(state.projectId)): SavedColorGradient {
  const defaults = project.defaults;
  return {
    strength: clamp(
      state.parameters.gradientStrength ?? defaults.gradientStrength ?? 0,
      0,
      1
    ),
    angle: clamp(
      state.parameters.gradientAngle ?? defaults.gradientAngle ?? 0,
      -180,
      180
    ),
    midpoint: clamp(
      state.parameters.gradientMidpoint ?? defaults.gradientMidpoint ?? 0.46,
      0.08,
      0.92
    )
  };
}

function colorPreviewBackground(
  palette: EngineState["palette"],
  gradient: SavedColorGradient
): string {
  const stops = paletteGradientStops(
    { palette },
    {
      gradientStrength: gradient.strength,
      gradientAngle: gradient.angle * Math.PI / 180,
      gradientMidpoint: gradient.midpoint
    }
  ).map((stop: { offset: number; color: string }) => (
    `${stop.color} ${(stop.offset * 100).toFixed(2)}%`
  ));
  return `linear-gradient(${gradient.angle + 90}deg, ${stops.join(", ")})`;
}

function updateSavedColorPreview(element: HTMLElement, record: SavedColorRecord | null): void {
  if (!record) {
    element.style.backgroundColor = "var(--surface-muted)";
    element.style.backgroundImage = "none";
    element.style.backgroundSize = "auto";
    element.style.backgroundPosition = "initial";
    element.style.backgroundRepeat = "initial";
    return;
  }
  element.style.backgroundColor = record.palette.background;
  element.style.backgroundImage = colorPreviewBackground(record.palette, record.gradient);
  element.style.backgroundSize = "100% 44%";
  element.style.backgroundPosition = "center";
  element.style.backgroundRepeat = "no-repeat";
}

function refreshSavedColors(selectedId = ""): void {
  savedColors = listSavedColors();
  exportLibraryButton.disabled = savedProjects.length === 0 && savedColors.length === 0;
  if (savedColors.length === 0) {
    savedColorSelect.replaceChildren(makeOption("", "Sin paletas guardadas"));
    savedColorSelect.disabled = true;
    applyColorButton.disabled = true;
    deleteColorButton.disabled = true;
    updateSavedColorPreview(selectedColorPreview, null);
    return;
  }

  savedColorSelect.replaceChildren(...savedColors.map((record) => (
    makeOption(record.id, record.name)
  )));
  savedColorSelect.disabled = false;
  applyColorButton.disabled = false;
  deleteColorButton.disabled = false;
  savedColorSelect.value = selectedId && savedColors.some((record) => record.id === selectedId)
    ? selectedId
    : savedColors[0]!.id;
  updateSavedColorPreview(
    selectedColorPreview,
    savedColors.find((record) => record.id === savedColorSelect.value) ?? null
  );
}

function refreshSavedProjects(selectedId = ""): void {
  savedProjects = listSavedProjects();
  if (savedProjects.length === 0) {
    savedProjectSelect.replaceChildren(makeOption("", "Sin guardados"));
    savedProjectSelect.disabled = true;
    loadProjectButton.disabled = true;
    deleteProjectButton.disabled = true;
    exportLibraryButton.disabled = savedColors.length === 0;
    return;
  }

  savedProjectSelect.replaceChildren(...savedProjects.map((record) => {
    const project = getProject(record.state.projectId);
    return makeOption(record.id, `${record.name} · ${project.index}`);
  }));
  savedProjectSelect.disabled = false;
  loadProjectButton.disabled = false;
  deleteProjectButton.disabled = false;
  exportLibraryButton.disabled = false;
  savedProjectSelect.value = selectedId && savedProjects.some((record) => record.id === selectedId)
    ? selectedId
    : savedProjects[0]!.id;
}

function renderProjectControls(project: ProjectDefinition): void {
  const fieldFragment = document.createDocumentFragment();
  const appearanceFragment = document.createDocumentFragment();
  const gradientFragment = document.createDocumentFragment();
  let appearanceCount = 0;
  let gradientCount = 0;

  for (const control of project.controls) {
    if (control.hidden) continue;
    const label = document.createElement("label");
    const inputId = `parameter-${project.id}-${control.key}`;
    label.className = "control-label";
    label.htmlFor = inputId;
    const currentValue = state.parameters[control.key] ?? control.defaultValue;

    if (control.options?.length) {
      const labelText = document.createElement("span");
      labelText.textContent = control.label;
      const select = document.createElement("select");
      select.id = inputId;
      select.replaceChildren(...control.options.map((option) => (
        makeOption(String(option.value), option.label)
      )));
      select.value = String(currentValue);
      select.addEventListener("change", () => {
        const nextValue = Number(select.value);
        if (nextValue === state.parameters[control.key]) return;
        recordHistory(`Cambiar ${control.label}`);
        state = {
          ...state,
          parameters: { ...state.parameters, [control.key]: nextValue }
        };
        projectParameters.set(state.projectId, { ...state.parameters });
        appStatus.textContent = `${control.label}: ${select.selectedOptions[0]?.textContent ?? nextValue}.`;
        postState();
      });
      label.append(labelText, select);
    } else {
      const outputId = `${inputId}-value`;
      const labelRow = document.createElement("span");
      labelRow.className = "label-row";
      const labelText = document.createElement("span");
      labelText.textContent = control.label;
      const output = document.createElement("output");
      output.id = outputId;
      output.htmlFor = inputId;
      output.value = formatControlValue(control, currentValue);
      labelRow.append(labelText, output);

      const input = document.createElement("input");
      input.id = inputId;
      input.type = "range";
      input.min = String(control.min);
      input.max = String(control.max);
      input.step = String(control.step);
      input.value = String(currentValue);
      const historyKey = `parameter:${project.id}:${control.key}`;
      input.addEventListener("input", () => {
        const nextValue = Number(input.value);
        beginHistoryInteraction(historyKey, `Cambiar ${control.label}`);
        output.value = formatControlValue(control, nextValue);
        state = {
          ...state,
          parameters: { ...state.parameters, [control.key]: nextValue }
        };
        projectParameters.set(state.projectId, { ...state.parameters });
        appStatus.textContent = `${control.label}: ${output.value}.`;
        postState();
      });
      const finishInteraction = () => endHistoryInteraction(historyKey);
      input.addEventListener("change", finishInteraction);
      input.addEventListener("pointercancel", finishInteraction);
      input.addEventListener("blur", finishInteraction);

      label.append(labelRow, input);
    }

    if (control.group === "appearance") {
      appearanceFragment.appendChild(label);
      appearanceCount += 1;
    } else if (control.group === "gradient") {
      gradientFragment.appendChild(label);
      gradientCount += 1;
    } else {
      fieldFragment.appendChild(label);
    }
  }

  projectControls.replaceChildren(fieldFragment);
  appearanceControls.replaceChildren(appearanceFragment);
  gradientControls.replaceChildren(gradientFragment);
  appearanceSection.hidden = appearanceCount === 0;
  gradientEditor.hidden = gradientCount === 0;
}

function updatePlaybackButton(): void {
  const action = state.playback.playing ? "Pausar" : "Reproducir";
  playButton.dataset.playbackState = state.playback.playing ? "playing" : "paused";
  playButton.setAttribute("aria-label", action);
  playButton.title = action;
  playButton.setAttribute("aria-pressed", String(state.playback.playing));
  engineState.textContent = state.playback.playing ? "ENGINE / RUNNING" : "ENGINE / PAUSED";
}

function formulaUsesDefaults(project: ProjectDefinition): boolean {
  return project.controls.filter((control) => (
    !control.hidden && control.group !== "appearance" && control.group !== "gradient"
  )).every((control) => (
    state.parameters[control.key] === project.defaults[control.key]
  ));
}

function projectSupportsLoopStart(project: ProjectDefinition): boolean {
  return project.controls.some((control) => control.key === "loopPhase" && control.hidden);
}

function loopPhase(): number {
  const value = state.parameters.loopPhase;
  return typeof value === "number" && Number.isFinite(value)
    ? positiveModulo(value, 1)
    : 0;
}

function setTimelinePosition(time: number): void {
  currentTime = clamp(time, 0, 0.999999);
  timelineInput.value = String(currentTime);
  timelineValue.value = `${Math.round(currentTime * 100)}%`;
  post({ type: "seek", time: currentTime });
}

function updateLoopStartControl(project: ProjectDefinition): void {
  const supported = projectSupportsLoopStart(project);
  const phase = loopPhase();
  loopStartControl.hidden = !supported;
  timelineLoopMarker.hidden = !supported;
  timelineLoopMarker.style.left = `clamp(8px, ${phase * 100}%, calc(100% - 8px))`;
  loopStartValue.value = `${(phase * 100).toFixed(1)}%`;
  setLoopStartButton.disabled = !supported;
  resetLoopStartButton.disabled = !supported || phase < 0.0005;
}

function updateViewportHud(project = getProject(state.projectId)): void {
  const enabled = project.viewControls === true;
  viewportHud.hidden = !enabled;
  canvasStage.classList.toggle("is-view-interactive", enabled);
  canvasStage.tabIndex = enabled ? 0 : -1;
  canvasStage.setAttribute(
    "aria-label",
    enabled
      ? `Vista interactiva de ${project.name}. Arrastra para orbitar, usa Mayús para mover y la rueda para zoom.`
      : `Vista de ${project.name}.`
  );
  if (!enabled) return;
  viewportOrbitButton.setAttribute("aria-pressed", String(viewMode === "orbit"));
  viewportPanButton.setAttribute("aria-pressed", String(viewMode === "pan"));
  viewportResetButton.disabled = viewUsesDefaults(state.view);
  viewportZoomInput.value = String(Math.round(state.view.zoom * 100));
  const panX = Math.round(state.view.panX * 100);
  const panY = Math.round(state.view.panY * 100);
  viewportValue.value = `${Math.round(state.view.orbitYaw)}° / ${Math.round(state.view.orbitPitch)}° · ${panX}, ${panY}`;
}

function scheduleViewState(): void {
  if (queuedViewFrame) return;
  queuedViewFrame = window.requestAnimationFrame(() => {
    queuedViewFrame = 0;
    post({ type: "state", state });
  });
}

function setView(nextView: Partial<EngineState["view"]>, status = ""): void {
  state = {
    ...state,
    view: normalizeView({ ...state.view, ...nextView })
  };
  projectViews.set(state.projectId, { ...state.view });
  updateViewportHud();
  scheduleViewState();
  if (status) appStatus.textContent = status;
}

function setViewMode(mode: "orbit" | "pan"): void {
  viewMode = mode;
  updateViewportHud();
  appStatus.textContent = mode === "orbit"
    ? "Vista: arrastra para orbitar."
    : "Vista: arrastra para mover el encuadre.";
}

function zoomView(factor: number, addToHistory = true): void {
  const nextZoom = normalizeView({ ...state.view, zoom: state.view.zoom * factor }).zoom;
  if (nextZoom === state.view.zoom) return;
  if (addToHistory) recordHistory("Cambiar zoom");
  setView(
    { zoom: nextZoom },
    `Zoom ${Math.round(nextZoom * 100)}%.`
  );
}

function setZoomPercent(percent: number, addToHistory = true): void {
  if (!Number.isFinite(percent)) {
    viewportZoomInput.value = String(Math.round(state.view.zoom * 100));
    return;
  }
  const nextZoom = normalizeView({ ...state.view, zoom: percent / 100 }).zoom;
  if (nextZoom === state.view.zoom) {
    viewportZoomInput.value = String(Math.round(state.view.zoom * 100));
    return;
  }
  if (addToHistory) recordHistory("Cambiar zoom");
  setView({ zoom: nextZoom }, `Zoom ${Math.round(nextZoom * 100)}%.`);
}

function resetView(): void {
  if (viewUsesDefaults(state.view)) return;
  recordHistory("Reencuadrar vista");
  state = { ...state, view: createDefaultView() };
  projectViews.set(state.projectId, { ...state.view });
  updateViewportHud();
  scheduleViewState();
  appStatus.textContent = "Encuadre restablecido.";
}

function updateStaticUi(): void {
  const project = getProject(state.projectId);
  const format = getOutputFormat(state.formatKey);
  const backendLabel = project.backend === "three" ? "THREE / WEBGL" : "CANVAS 2D";
  canvasMeta.textContent = `${backendLabel} · ${format.label} · ${format.width} × ${format.height} · ${project.preferredFps} fps`;
  seedInput.value = String(state.seed);
  projectSelect.value = state.projectId;
  formatSelect.value = state.formatKey;
  backgroundColor.value = state.palette.background;
  foregroundColor.value = state.palette.foreground;
  accentColor.value = state.palette.accent;
  secondaryColor.value = state.palette.secondary ?? state.palette.accent;
  backgroundColorValue.value = state.palette.background.toUpperCase();
  foregroundColorValue.value = state.palette.foreground.toUpperCase();
  accentColorValue.value = state.palette.accent.toUpperCase();
  secondaryColorValue.value = (state.palette.secondary ?? state.palette.accent).toUpperCase();
  palettePreview.style.setProperty("--palette-background", state.palette.background);
  palettePreview.style.setProperty("--palette-foreground", state.palette.foreground);
  palettePreview.style.setProperty("--palette-accent", state.palette.accent);
  palettePreview.style.setProperty("--palette-secondary", state.palette.secondary ?? state.palette.accent);
  const gradient = currentGradientSettings(project);
  gradientPreview.style.backgroundColor = state.palette.background;
  gradientPreview.style.backgroundImage = colorPreviewBackground(state.palette, gradient);
  updateSavedColorPreview(currentColorPreview, {
    schemaVersion: 1,
    id: "current",
    name: "Actual",
    createdAt: "",
    updatedAt: "",
    palette: state.palette,
    gradient
  });
  speedInput.value = state.playback.speed.toFixed(2);
  durationInput.value = state.playback.loopSeconds.toFixed(1);
  resetFormulaButton.disabled = formulaUsesDefaults(project);
  updateImageSourceUi();
  updateLoopStartControl(project);
  const usesThree = project.backend === "three";
  canvas.classList.toggle("is-active", !usesThree);
  threeCanvas.classList.toggle("is-active", usesThree);
  canvas.setAttribute("aria-hidden", String(usesThree));
  threeCanvas.setAttribute("aria-hidden", String(!usesThree));
  updateViewportHud(project);
  updatePlaybackButton();
}

function changeProject(projectId: string): void {
  if (projectId === state.projectId) return;
  recordHistory("Cambiar proyecto");
  projectViews.set(state.projectId, { ...state.view });
  const project = getProject(projectId);
  const parameters = projectParameters.get(project.id) ?? { ...project.defaults };
  const view = projectViews.get(project.id) ?? createDefaultView();
  state = {
    ...state,
    projectId: project.id,
    formatKey: project.preferredFormatKey ?? state.formatKey,
    playback: {
      ...state.playback,
      loopSeconds: project.preferredLoopSeconds ?? state.playback.loopSeconds
    },
    parameters: { ...parameters },
    view: { ...view }
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

function setPalette(
  background: string,
  foreground: string,
  accent = state.palette.accent,
  secondary = state.palette.secondary ?? accent
): void {
  state = {
    ...state,
    palette: { background, foreground, accent, secondary }
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
  const nextState = normalizeCompatibleState(record.state);
  recordHistory(`Cargar “${record.name}”`, true);
  state = nextState;
  currentTime = clamp(record.time, 0, 0.999999);
  projectParameters.set(state.projectId, { ...state.parameters });
  projectViews.set(state.projectId, { ...state.view });
  const project = getProject(state.projectId);
  renderProjectControls(project);
  videoFpsSelect.value = String(project.preferredFps);
  updateStaticUi();
  post({ type: "state", state });
  post({ type: "seek", time: currentTime });
  timelineInput.value = String(currentTime);
  timelineValue.value = `${Math.round(currentTime * 100)}%`;
}

function applySavedColor(record: SavedColorRecord): void {
  const project = getProject(state.projectId);
  const parameters = { ...state.parameters };
  for (const [key, value] of Object.entries({
    gradientStrength: record.gradient.strength,
    gradientAngle: record.gradient.angle,
    gradientMidpoint: record.gradient.midpoint
  })) {
    const control = project.controls.find((candidate) => candidate.key === key);
    if (control) parameters[key] = clamp(value, control.min, control.max);
  }

  recordHistory(`Aplicar paleta “${record.name}”`);
  state = {
    ...state,
    palette: {
      background: record.palette.background.toLowerCase(),
      foreground: record.palette.foreground.toLowerCase(),
      accent: record.palette.accent.toLowerCase(),
      secondary: (record.palette.secondary ?? record.palette.accent).toLowerCase()
    },
    parameters
  };
  projectParameters.set(project.id, { ...parameters });
  renderProjectControls(project);
  setColorError("");
  postState();
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
  const accent = candidate.palette.accent ?? candidate.palette.foreground;
  const secondary = candidate.palette.secondary ?? accent;
  if (
    !colorPattern.test(candidate.palette.background) ||
    !colorPattern.test(candidate.palette.foreground) ||
    !colorPattern.test(accent) ||
    !colorPattern.test(secondary)
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
      foreground: candidate.palette.foreground.toLowerCase(),
      accent: accent.toLowerCase(),
      secondary: secondary.toLowerCase()
    },
    view: normalizeView(candidate.view),
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
      postImageField();
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

undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);

function targetUsesNativeUndo(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return ["email", "number", "password", "search", "tel", "text", "url"].includes(target.type);
  }
  return target instanceof Element && target.closest("[contenteditable='true']") !== null;
}

window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.altKey || targetUsesNativeUndo(event.target)) return;
  if (document.querySelector("dialog[open]")) return;
  const modifier = event.metaKey || event.ctrlKey;
  if (!modifier) return;

  const key = event.key.toLowerCase();
  const wantsUndo = key === "z" && !event.shiftKey;
  const wantsRedo = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.metaKey);
  if (!wantsUndo && !wantsRedo) return;

  event.preventDefault();
  if (wantsRedo) redo();
  else undo();
});

projectSelect.addEventListener("change", () => changeProject(projectSelect.value));

imageUploadButton.addEventListener("click", () => {
  setImageSourceError("");
  imageUploadInput.value = "";
  imageUploadInput.click();
});

imageUploadInput.addEventListener("change", async () => {
  const file = imageUploadInput.files?.[0];
  if (!file) return;

  imageUploadButton.disabled = true;
  imageSourceStatus.textContent = "Analizando luminancia…";
  setImageSourceError("");
  try {
    currentImageField = await decodeImageField(file);
    currentImageName = file.name;
    postImageField();
    updateImageSourceUi();
    appStatus.textContent = `“${file.name}” convertida en campo vectorial temporal.`;
  } catch (error) {
    setImageSourceError(error instanceof Error
      ? error.message
      : "No se pudo preparar la imagen.");
    imageUploadInput.value = "";
    updateImageSourceUi();
  } finally {
    imageUploadButton.disabled = false;
  }
});

clearImageButton.addEventListener("click", () => {
  currentImageField = null;
  currentImageName = "";
  imageUploadInput.value = "";
  setImageSourceError("");
  postImageField();
  updateImageSourceUi();
  appStatus.textContent = "Fotografía retirada; vuelve el retrato de prueba.";
});

openSavedDialogButton.addEventListener("click", () => {
  setStorageError("");
  savedDialog.showModal();
});

closeSavedDialogButton.addEventListener("click", () => {
  savedDialog.close();
});

openColorDialogButton.addEventListener("click", () => {
  setColorLibraryError("");
  updateStaticUi();
  refreshSavedColors(savedColorSelect.value);
  colorDialog.showModal();
});

closeColorDialogButton.addEventListener("click", () => {
  colorDialog.close();
});

savedColorSelect.addEventListener("change", () => {
  updateSavedColorPreview(
    selectedColorPreview,
    savedColors.find((record) => record.id === savedColorSelect.value) ?? null
  );
});

saveColorButton.addEventListener("click", async () => {
  const name = colorNameInput.value.trim();
  if (!name) {
    setColorLibraryError("Escribe un nombre antes de guardar la paleta.");
    colorNameInput.focus();
    return;
  }

  saveColorButton.disabled = true;
  try {
    const record = saveColor(name, state.palette, currentGradientSettings());
    refreshSavedColors(record.id);
    colorNameInput.value = "";
    setColorLibraryError("");
    try {
      const durable = await persistDurableLibrary();
      appStatus.textContent = durable
        ? `Paleta “${record.name}” guardada en la biblioteca persistente.`
        : `Paleta “${record.name}” guardada en este navegador.`;
    } catch (error) {
      setColorLibraryError(
        `La paleta está en el navegador, pero el archivo persistente falló: ${
          error instanceof Error ? error.message : "error desconocido"
        }`
      );
    }
  } catch (error) {
    setColorLibraryError(error instanceof Error ? error.message : "No se pudo guardar la paleta.");
  } finally {
    saveColorButton.disabled = false;
  }
});

applyColorButton.addEventListener("click", () => {
  const record = savedColors.find((candidate) => candidate.id === savedColorSelect.value);
  if (!record) {
    setColorLibraryError("Selecciona una paleta guardada.");
    return;
  }
  applySavedColor(record);
  setColorLibraryError("");
  appStatus.textContent = `Paleta “${record.name}” aplicada.`;
  colorDialog.close();
});

deleteColorButton.addEventListener("click", () => {
  const record = savedColors.find((candidate) => candidate.id === savedColorSelect.value);
  if (!record) {
    setColorLibraryError("Selecciona una paleta guardada.");
    return;
  }
  pendingDeleteColorId = record.id;
  deleteColorDialog.showModal();
});

confirmDeleteColorButton.addEventListener("click", async () => {
  if (!pendingDeleteColorId) return;
  const colorId = pendingDeleteColorId;
  const record = savedColors.find((candidate) => candidate.id === colorId);
  try {
    await deleteDurableColor(colorId);
    deleteSavedColor(colorId);
    refreshSavedColors();
    setColorLibraryError("");
    appStatus.textContent = record ? `Paleta “${record.name}” eliminada.` : "Paleta eliminada.";
  } catch (error) {
    setColorLibraryError(error instanceof Error ? error.message : "No se pudo eliminar la paleta.");
  } finally {
    pendingDeleteColorId = "";
  }
});

deleteColorDialog.addEventListener("close", () => {
  pendingDeleteColorId = "";
});

resetFormulaButton.addEventListener("click", () => {
  const project = getProject(state.projectId);
  const parameters = Object.fromEntries(project.controls.map((control) => [
    control.key,
    control.group === "appearance" || control.group === "gradient"
      ? state.parameters[control.key] ?? control.defaultValue
      : control.defaultValue
  ]));
  if (projectSupportsLoopStart(project)) parameters.loopPhase = loopPhase();
  recordHistory("Reiniciar fórmula");
  state = {
    ...state,
    parameters
  };
  projectParameters.set(project.id, { ...state.parameters });
  renderProjectControls(project);
  appStatus.textContent = `${project.index} · ${project.name}: fórmula reiniciada.`;
  postState();
});

saveProjectButton.addEventListener("click", async () => {
  const name = saveNameInput.value.trim();
  if (!name) {
    setStorageError("Escribe un nombre antes de guardar.");
    saveNameInput.focus();
    return;
  }

  saveProjectButton.disabled = true;
  try {
    const record = saveProject(name, state, currentTime);
    refreshSavedProjects(record.id);
    saveNameInput.value = "";
    setStorageError("");
    try {
      const durable = await persistDurableLibrary();
      const imageNote = state.projectId === "image-currents"
        ? " La fotografía temporal no forma parte del guardado."
        : "";
      appStatus.textContent = (durable
        ? `“${record.name}” guardado en la biblioteca local persistente.`
        : `“${record.name}” guardado en este navegador.`) + imageNote;
    } catch (error) {
      setStorageError(
        `“${record.name}” está en el navegador, pero el archivo persistente falló: ${
          error instanceof Error ? error.message : "error desconocido"
        }`
      );
    }
  } catch (error) {
    setStorageError(error instanceof Error ? error.message : "No se pudo guardar el proyecto.");
  } finally {
    saveProjectButton.disabled = false;
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

confirmDeleteProjectButton.addEventListener("click", async () => {
  if (!pendingDeleteId) return;
  const projectId = pendingDeleteId;
  const record = savedProjects.find((candidate) => candidate.id === projectId);
  try {
    await deleteDurableProject(projectId);
    deleteSavedProject(projectId);
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

exportLibraryButton.addEventListener("click", () => {
  setStorageError("");
  try {
    const backup = createLibraryBackupDownload();
    if (backup.count === 0 && backup.colorCount === 0) {
      throw new Error("No hay proyectos ni paletas que exportar.");
    }
    downloadBlob(backup.blob, backup.filename);
    appStatus.textContent = `Biblioteca exportada: ${backup.count} proyectos · ${backup.colorCount} paletas.`;
  } catch (error) {
    setStorageError(error instanceof Error ? error.message : "No se pudo exportar la biblioteca.");
  }
});

importLibraryButton.addEventListener("click", () => {
  importLibraryInput.click();
});

importLibraryInput.addEventListener("change", async () => {
  const file = importLibraryInput.files?.[0];
  if (!file) return;
  importLibraryButton.disabled = true;
  setStorageError("");
  try {
    const result = importLibraryBackup(await file.text());
    await persistDurableLibrary();
    refreshSavedProjects();
    refreshSavedColors();
    appStatus.textContent = `Biblioteca restaurada: ${result.total} proyectos · ${result.colorsTotal} paletas.`;
  } catch (error) {
    setStorageError(error instanceof Error ? error.message : "No se pudo importar la biblioteca.");
  } finally {
    importLibraryButton.disabled = false;
    importLibraryInput.value = "";
  }
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
    await persistDurableLibrary();
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
  if (formatSelect.value === state.formatKey) return;
  recordHistory("Cambiar formato");
  state = { ...state, formatKey: formatSelect.value };
  const format = getOutputFormat(state.formatKey);
  appStatus.textContent = `Formato ${format.label} seleccionado.`;
  postState();
});

seedInput.addEventListener("change", () => {
  const parsed = Number(seedInput.value);
  const nextSeed = Number.isFinite(parsed)
    ? Math.round(clamp(parsed, 0, 4294967295))
    : state.seed;
  if (nextSeed === state.seed) {
    updateStaticUi();
    return;
  }
  recordHistory("Cambiar semilla");
  state = {
    ...state,
    seed: nextSeed
  };
  appStatus.textContent = `Semilla ${state.seed} aplicada.`;
  postState();
});

backgroundColor.addEventListener("input", () => {
  beginHistoryInteraction("palette:background", "Cambiar color de fondo");
  setPalette(backgroundColor.value, state.palette.foreground, state.palette.accent);
  setColorError("");
  appStatus.textContent = "Color de fondo actualizado.";
});

foregroundColor.addEventListener("input", () => {
  beginHistoryInteraction("palette:foreground", "Cambiar color de trazo");
  setPalette(state.palette.background, foregroundColor.value, state.palette.accent);
  setColorError("");
  appStatus.textContent = "Color de trazo actualizado.";
});

accentColor.addEventListener("input", () => {
  beginHistoryInteraction("palette:accent", "Cambiar color de acento");
  setPalette(state.palette.background, state.palette.foreground, accentColor.value);
  setColorError("");
  appStatus.textContent = "Color de acento actualizado.";
});

secondaryColor.addEventListener("input", () => {
  beginHistoryInteraction("palette:secondary", "Cambiar color final");
  setPalette(
    state.palette.background,
    state.palette.foreground,
    state.palette.accent,
    secondaryColor.value
  );
  setColorError("");
  appStatus.textContent = "Color final del gradiente actualizado.";
});

type PaletteRole = "background" | "foreground" | "accent" | "secondary";

function applyHexColor(input: HTMLInputElement, role: PaletteRole, label: string): void {
  const value = input.value.trim();
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    setColorError(`${label}: usa un valor hexadecimal de seis cifras, por ejemplo #8ECFC2.`);
    input.setAttribute("aria-invalid", "true");
    return;
  }

  const normalized = value.toLowerCase();
  if ((state.palette[role] ?? state.palette.accent).toLowerCase() === normalized) {
    input.value = normalized.toUpperCase();
    input.removeAttribute("aria-invalid");
    setColorError("");
    return;
  }
  recordHistory(`Cambiar ${label.toLowerCase()}`);
  const palette = { ...state.palette, [role]: normalized };
  setPalette(
    palette.background,
    palette.foreground,
    palette.accent,
    palette.secondary
  );
  input.removeAttribute("aria-invalid");
  setColorError("");
  appStatus.textContent = `${label} actualizado.`;
}

for (const [input, role, label] of [
  [backgroundColorValue, "background", "Color de fondo"],
  [foregroundColorValue, "foreground", "Color de trazo"],
  [accentColorValue, "accent", "Color de acento"],
  [secondaryColorValue, "secondary", "Color final"]
] as const) {
  input.addEventListener("change", () => applyHexColor(input, role, label));
}

speedInput.addEventListener("input", () => {
  const speed = speedInput.valueAsNumber;
  if (!Number.isFinite(speed)) return;
  beginHistoryInteraction("playback:speed", "Cambiar velocidad");
  state = {
    ...state,
    playback: { ...state.playback, speed: clamp(speed, 0.25, 2) }
  };
  appStatus.textContent = `Velocidad ${state.playback.speed.toFixed(2)}×.`;
  post({ type: "state", state });
});

durationInput.addEventListener("input", () => {
  const loopSeconds = durationInput.valueAsNumber;
  if (!Number.isFinite(loopSeconds)) return;
  beginHistoryInteraction("playback:duration", "Cambiar duración del bucle");
  state = {
    ...state,
    playback: { ...state.playback, loopSeconds: clamp(loopSeconds, 2, 20) }
  };
  appStatus.textContent = `Bucle de ${state.playback.loopSeconds.toFixed(1)} segundos.`;
  post({ type: "state", state });
});

function stepPlaybackInput(
  input: HTMLInputElement,
  direction: -1 | 1,
  historyKey: string,
  historyLabel: string,
  fallback: number
): void {
  const current = input.valueAsNumber;
  const step = Number(input.step);
  const stepDigits = input.step.split(".")[1]?.length ?? 0;
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const next = Number(clamp(
    (Number.isFinite(current) ? current : fallback) + direction * step,
    minimum,
    maximum
  ).toFixed(stepDigits));
  if (next === fallback) return;
  beginHistoryInteraction(historyKey, historyLabel);
  input.value = String(next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  endHistoryInteraction(historyKey);
  updateStaticUi();
}

speedDecreaseButton.addEventListener("click", () => {
  stepPlaybackInput(speedInput, -1, "playback:speed", "Cambiar velocidad", state.playback.speed);
});
speedIncreaseButton.addEventListener("click", () => {
  stepPlaybackInput(speedInput, 1, "playback:speed", "Cambiar velocidad", state.playback.speed);
});
durationDecreaseButton.addEventListener("click", () => {
  stepPlaybackInput(durationInput, -1, "playback:duration", "Cambiar duración del bucle", state.playback.loopSeconds);
});
durationIncreaseButton.addEventListener("click", () => {
  stepPlaybackInput(durationInput, 1, "playback:duration", "Cambiar duración del bucle", state.playback.loopSeconds);
});

for (const [input, historyKey] of [
  [backgroundColor, "palette:background"],
  [foregroundColor, "palette:foreground"],
  [accentColor, "palette:accent"],
  [secondaryColor, "palette:secondary"]
] as const) {
  const finishInteraction = () => endHistoryInteraction(historyKey);
  input.addEventListener("change", finishInteraction);
  input.addEventListener("pointercancel", finishInteraction);
  input.addEventListener("blur", finishInteraction);
}

for (const [input, historyKey] of [
  [speedInput, "playback:speed"],
  [durationInput, "playback:duration"]
] as const) {
  const finishInteraction = () => {
    endHistoryInteraction(historyKey);
    updateStaticUi();
  };
  input.addEventListener("change", finishInteraction);
  input.addEventListener("blur", finishInteraction);
}

timelineInput.addEventListener("pointerdown", () => {
  scrubbing = true;
  resumeAfterScrub = state.playback.playing;
  if (resumeAfterScrub) setPlaying(false);
});

timelineInput.addEventListener("input", () => {
  beginHistoryInteraction("playback:timeline", "Mover posición temporal", true);
  const time = Number(timelineInput.value);
  currentTime = time;
  timelineValue.value = `${Math.round(time * 100)}%`;
  post({ type: "seek", time });
});

setLoopStartButton.addEventListener("click", () => {
  const project = getProject(state.projectId);
  if (!projectSupportsLoopStart(project)) return;
  const nextPhase = positiveModulo(loopPhase() + currentTime, 1);
  recordHistory("Fijar inicio del bucle", true);
  state = {
    ...state,
    playback: { ...state.playback, playing: false },
    parameters: { ...state.parameters, loopPhase: nextPhase }
  };
  projectParameters.set(project.id, { ...state.parameters });
  postState();
  setTimelinePosition(0);
  appStatus.textContent = `Inicio del bucle fijado en ${(nextPhase * 100).toFixed(1)}%.`;
});

resetLoopStartButton.addEventListener("click", () => {
  const project = getProject(state.projectId);
  if (!projectSupportsLoopStart(project)) return;
  recordHistory("Restablecer inicio del bucle", true);
  state = {
    ...state,
    playback: { ...state.playback, playing: false },
    parameters: { ...state.parameters, loopPhase: 0 }
  };
  projectParameters.set(project.id, { ...state.parameters });
  postState();
  setTimelinePosition(0);
  appStatus.textContent = "Inicio original del bucle restablecido.";
});

function finishScrubbing(): void {
  endHistoryInteraction("playback:timeline");
  if (!scrubbing) return;
  scrubbing = false;
  if (resumeAfterScrub) setPlaying(true);
  resumeAfterScrub = false;
}

timelineInput.addEventListener("pointerup", finishScrubbing);
timelineInput.addEventListener("pointercancel", finishScrubbing);
timelineInput.addEventListener("change", finishScrubbing);
timelineInput.addEventListener("blur", finishScrubbing);

playButton.addEventListener("click", () => {
  setPlaying(!state.playback.playing);
  appStatus.textContent = state.playback.playing ? "Reproducción iniciada." : "Reproducción pausada.";
});

newSeedButton.addEventListener("click", () => {
  let seed = createSeed();
  while (seed === state.seed) seed = createSeed();
  recordHistory("Generar nueva semilla");
  state = { ...state, seed };
  appStatus.textContent = `Nueva semilla ${state.seed}.`;
  postState();
});

invertButton.addEventListener("click", () => {
  if (state.palette.background === state.palette.foreground) return;
  recordHistory("Invertir paleta");
  setPalette(state.palette.foreground, state.palette.background, state.palette.accent);
  appStatus.textContent = "Paleta invertida.";
});

exportButton.addEventListener("click", () => {
  exportButton.disabled = true;
  appStatus.textContent = "Preparando SVG…";
  svgExportStatus.textContent = "Generando fotograma vectorial…";
  post({ type: "export-svg", requestId: window.crypto.randomUUID() });
});

type ExportKind = "svg" | "video" | "web" | "preset";

function isExportKind(value: string): value is ExportKind {
  return value === "svg" || value === "video" || value === "web" || value === "preset";
}

function showExportPanel(kind: ExportKind): void {
  for (const input of exportKindInputs) input.checked = input.value === kind;
  for (const panel of exportPanels) panel.hidden = panel.dataset.exportPanel !== kind;
}

for (const input of exportKindInputs) {
  input.addEventListener("change", () => {
    if (input.checked && isExportKind(input.value)) showExportPanel(input.value);
  });
}

openExportDialogButton.addEventListener("click", () => {
  if (!presetExportName.value.trim()) {
    const project = getProject(state.projectId);
    presetExportName.value = `${project.name} ${state.seed}`;
  }
  const selectedKind = exportKindInputs.find((input) => input.checked)?.value ?? "video";
  showExportPanel(isExportKind(selectedKind) ? selectedKind : "video");
  exportDialog.showModal();
});

closeExportDialogButton.addEventListener("click", () => {
  exportDialog.close();
});

const videoProfileDescriptions: Record<VideoProfile, string> = {
  "mov-alpha-capcut": "ProRes 4444 conserva el canal alpha para importarlo en CapCut.",
  "mp4-background": "H.264 con el color de fondo actual, listo para edición y reproducción.",
  "webm-alpha": "VP9 con canal alpha, optimizado para navegador y composición web.",
  "mp4-chroma": "H.264 con fondo verde puro para eliminarlo mediante clave de color."
};

function selectedVideoProfile(): VideoProfile {
  const value = videoProfileSelect.value;
  if (
    value === "mov-alpha-capcut" ||
    value === "mp4-background" ||
    value === "webm-alpha" ||
    value === "mp4-chroma"
  ) return value;
  return "mp4-background";
}

videoProfileSelect.addEventListener("change", () => {
  videoExportStatus.textContent = videoProfileDescriptions[selectedVideoProfile()];
});

exportVideoButton.addEventListener("click", async () => {
  if (videoExportController) return;

  const exportState = structuredClone(state);
  const profile = selectedVideoProfile();
  const fps = Number(videoFpsSelect.value);
  const wasPlaying = state.playback.playing;
  if (wasPlaying) setPlaying(false);
  videoExportController = new AbortController();
  exportVideoButton.disabled = true;
  cancelVideoButton.disabled = false;
  videoProfileSelect.disabled = true;
  videoFpsSelect.disabled = true;
  videoExportProgress.hidden = false;
  videoExportProgress.value = 0;
  videoExportStatus.textContent = "Comprobando el perfil de exportación…";

  try {
    const capability = await checkVideoProfile(
      profile,
      exportState,
      videoExportController.signal
    );
    if (!capability.supported) throw new Error(capability.reason ?? "Perfil no disponible.");

    videoExportStatus.textContent = "Preparando fotogramas…";
    const result = await exportVideo({
      state: exportState,
      fps,
      profile,
      imageField: currentImageField,
      signal: videoExportController.signal,
      onProgress(progress, phase) {
        videoExportProgress.value = progress;
        videoExportStatus.textContent = `${phase} · ${Math.round(progress * 100)}%`;
      }
    });
    downloadBlob(result.blob, result.filename);
    videoExportStatus.textContent = `${result.filename} · ${result.frameCount} fotogramas.`;
    appStatus.textContent = "Vídeo exportado.";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      videoExportStatus.textContent = "Exportación de vídeo cancelada.";
    } else {
      videoExportStatus.textContent = error instanceof Error
        ? error.message
        : "No se pudo exportar el vídeo.";
    }
  } finally {
    videoExportController = null;
    exportVideoButton.disabled = false;
    cancelVideoButton.disabled = true;
    videoProfileSelect.disabled = false;
    videoFpsSelect.disabled = false;
    if (wasPlaying) setPlaying(true);
  }
});

cancelVideoButton.addEventListener("click", () => {
  videoExportController?.abort();
  cancelVideoButton.disabled = true;
  videoExportStatus.textContent = "Cancelando exportación…";
});

function currentProjectHasViewControls(): boolean {
  return getProject(state.projectId).viewControls === true;
}

function pointerPair(): Array<{ x: number; y: number }> {
  return Array.from(activePointers.values()).slice(0, 2);
}

function createGestureAnchor(): typeof gestureAnchor {
  const pointers = pointerPair();
  if (pointers.length < 2) return null;
  const first = pointers[0]!;
  const second = pointers[1]!;
  return {
    distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
    x: (first.x + second.x) * 0.5,
    y: (first.y + second.y) * 0.5
  };
}

canvasStage.addEventListener("pointerdown", (event) => {
  if (!currentProjectHasViewControls()) return;
  if (event.target instanceof Element && event.target.closest(".viewport-hud")) return;
  if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 2) return;
  event.preventDefault();
  canvasStage.focus({ preventScroll: true });
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  canvasStage.setPointerCapture(event.pointerId);
  canvasStage.classList.add("is-dragging");
  if (activePointers.size >= 2) {
    gestureAnchor = createGestureAnchor();
    pointerAnchor = null;
  } else {
    pointerAnchor = { x: event.clientX, y: event.clientY };
  }
});

canvasStage.addEventListener("pointermove", (event) => {
  if (!activePointers.has(event.pointerId) || !currentProjectHasViewControls()) return;
  event.preventDefault();
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const bounds = canvasStage.getBoundingClientRect();

  if (activePointers.size >= 2) {
    const nextGesture = createGestureAnchor();
    if (gestureAnchor && nextGesture) {
      beginHistoryInteraction("view:pointer", "Ajustar vista");
      setView({
        zoom: state.view.zoom * nextGesture.distance / gestureAnchor.distance,
        panX: state.view.panX + (nextGesture.x - gestureAnchor.x) / Math.max(1, bounds.width),
        panY: state.view.panY + (nextGesture.y - gestureAnchor.y) / Math.max(1, bounds.height)
      });
    }
    gestureAnchor = nextGesture;
    return;
  }

  if (!pointerAnchor) {
    pointerAnchor = { x: event.clientX, y: event.clientY };
    return;
  }
  const deltaX = event.clientX - pointerAnchor.x;
  const deltaY = event.clientY - pointerAnchor.y;
  const shouldPan = (
    viewMode === "pan" ||
    event.shiftKey ||
    event.ctrlKey ||
    event.metaKey ||
    (event.buttons & 2) === 2
  );
  beginHistoryInteraction("view:pointer", "Ajustar vista");
  if (shouldPan) {
    setView({
      panX: state.view.panX + deltaX / Math.max(1, bounds.width),
      panY: state.view.panY + deltaY / Math.max(1, bounds.height)
    });
  } else {
    setView({
      orbitYaw: state.view.orbitYaw + deltaX * 0.35,
      orbitPitch: state.view.orbitPitch - deltaY * 0.3
    });
  }
  pointerAnchor = { x: event.clientX, y: event.clientY };
});

function finishViewPointer(event: PointerEvent): void {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.delete(event.pointerId);
  if (canvasStage.hasPointerCapture(event.pointerId)) {
    canvasStage.releasePointerCapture(event.pointerId);
  }
  gestureAnchor = activePointers.size >= 2 ? createGestureAnchor() : null;
  const remaining = activePointers.values().next().value as { x: number; y: number } | undefined;
  pointerAnchor = remaining ? { ...remaining } : null;
  if (activePointers.size === 0) {
    canvasStage.classList.remove("is-dragging");
    endHistoryInteraction("view:pointer");
  }
}

canvasStage.addEventListener("pointerup", finishViewPointer);
canvasStage.addEventListener("pointercancel", finishViewPointer);

canvasStage.addEventListener("wheel", (event) => {
  if (!currentProjectHasViewControls()) return;
  if (event.target instanceof Element && event.target.closest(".viewport-hud")) return;
  event.preventDefault();
  beginHistoryInteraction("view:wheel", "Cambiar zoom");
  if (wheelHistoryTimer) window.clearTimeout(wheelHistoryTimer);
  wheelHistoryTimer = window.setTimeout(() => {
    endHistoryInteraction("view:wheel");
    wheelHistoryTimer = 0;
  }, 180);
  zoomView(Math.exp(-event.deltaY * 0.0012), false);
}, { passive: false });

canvasStage.addEventListener("contextmenu", (event) => {
  if (currentProjectHasViewControls()) event.preventDefault();
});

canvasStage.addEventListener("keydown", (event) => {
  if (!currentProjectHasViewControls() || event.target !== canvasStage) return;
  const pan = viewMode === "pan" || event.shiftKey;
  if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") {
    event.preventDefault();
    beginHistoryInteraction("view:keyboard", "Cambiar zoom");
    setZoomPercent(Math.round(state.view.zoom * 100) + 5, false);
    return;
  }
  if (event.key === "-" || event.code === "NumpadSubtract") {
    event.preventDefault();
    beginHistoryInteraction("view:keyboard", "Cambiar zoom");
    setZoomPercent(Math.round(state.view.zoom * 100) - 5, false);
    return;
  }
  if (event.key === "0") {
    event.preventDefault();
    resetView();
    return;
  }
  if (event.key.toLowerCase() === "o") {
    event.preventDefault();
    setViewMode("orbit");
    return;
  }
  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    setViewMode("pan");
    return;
  }
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
  };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  beginHistoryInteraction("view:keyboard", pan ? "Mover vista" : "Orbitar vista");
  if (pan) {
    setView({
      panX: state.view.panX + direction[0] * 0.02,
      panY: state.view.panY + direction[1] * 0.02
    });
  } else {
    setView({
      orbitYaw: state.view.orbitYaw + direction[0] * 3,
      orbitPitch: state.view.orbitPitch - direction[1] * 3
    });
  }
});

canvasStage.addEventListener("keyup", () => endHistoryInteraction("view:keyboard"));
canvasStage.addEventListener("blur", () => endHistoryInteraction("view:keyboard"));

viewportOrbitButton.addEventListener("click", () => setViewMode("orbit"));
viewportPanButton.addEventListener("click", () => setViewMode("pan"));
viewportZoomOutButton.addEventListener("click", () => {
  setZoomPercent(Math.round(state.view.zoom * 100) - 5);
});
viewportZoomInButton.addEventListener("click", () => {
  setZoomPercent(Math.round(state.view.zoom * 100) + 5);
});
viewportZoomInput.addEventListener("change", () => {
  setZoomPercent(viewportZoomInput.valueAsNumber);
});
viewportResetButton.addEventListener("click", resetView);

exportWebButton.addEventListener("click", async () => {
  if (state.projectId === "image-currents") {
    webExportError.textContent = "Image Currents todavía usa una fotografía temporal. El paquete web llegará con el sistema de assets compartibles.";
    webExportError.hidden = false;
    webExportStatus.textContent = "La fórmula sí puede exportarse ahora como SVG o vídeo.";
    return;
  }
  exportWebButton.disabled = true;
  webExportError.hidden = true;
  webExportError.textContent = "";
  webExportStatus.textContent = "Construyendo paquete autónomo…";

  try {
    const { createWebPackage } = await import("./core/web-export");
    const result = await createWebPackage(
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
    presetExportStatus.textContent = state.projectId === "image-currents"
      ? `${result.filename} descargado · la fotografía temporal no se incluye.`
      : `${result.filename} descargado.`;
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
  if (!("transferControlToOffscreen" in canvas) || !("transferControlToOffscreen" in threeCanvas)) {
    canvasMessage.hidden = true;
    canvasError.hidden = false;
    canvasError.textContent = "Este navegador no permite transferir Canvas a un worker.";
    engineState.textContent = "ENGINE / UNSUPPORTED";
    return;
  }

  const bounds = canvasStage.getBoundingClientRect();
  const offscreen = canvas.transferControlToOffscreen();
  const threeOffscreen = threeCanvas.transferControlToOffscreen();
  post({
    type: "init",
    canvas: offscreen,
    threeCanvas: threeOffscreen,
    cssWidth: Math.max(1, bounds.width),
    cssHeight: Math.max(1, bounds.height),
    pixelRatio: window.devicePixelRatio,
    state
  }, [offscreen, threeOffscreen]);
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
refreshSavedColors();
renderProjectControls(getProject(state.projectId));
updateStaticUi();
updateHistoryButtons();
initializeWorker();

window.addEventListener("storage", (event) => {
  if (event.storageArea !== window.localStorage || !isLibraryStorageKey(event.key)) return;
  const selectedId = savedProjectSelect.value;
  const selectedColorId = savedColorSelect.value;
  refreshSavedProjects(selectedId);
  refreshSavedColors(selectedColorId);
  appStatus.textContent = "Biblioteca local actualizada desde otra pestaña.";
});

async function initializeLibraryPersistence(): Promise<void> {
  const legacyOrigin = window.location.port === "5174";
  let loopbackResult: Awaited<ReturnType<typeof syncLoopbackLibraries>> = null;

  try {
    if (legacyOrigin) {
      loopbackResult = await syncLoopbackLibraries();
      if (listSavedProjects().length > 0 || listSavedColors().length > 0) {
        await persistDurableLibrary();
      }
    }

    const durableResult = await syncDurableLibrary();
    refreshSavedProjects();
    refreshSavedColors();
    if (durableResult?.initialized) {
      appStatus.textContent = `Biblioteca persistente conectada: ${durableResult.total} proyectos · ${durableResult.colorsTotal} paletas.`;
    }

    if (!legacyOrigin) {
      loopbackResult = await syncLoopbackLibraries();
      if (loopbackResult && (
        loopbackResult.added > 0 ||
        loopbackResult.updated > 0 ||
        loopbackResult.colorsAdded > 0 ||
        loopbackResult.colorsUpdated > 0
      )) {
        const persisted = await persistDurableLibrary();
        refreshSavedProjects();
        refreshSavedColors();
        appStatus.textContent = `Biblioteca recuperada y persistida: ${persisted?.total ?? 0} proyectos · ${persisted?.colorsTotal ?? 0} paletas.`;
      }
    }

    if (loopbackResult?.canonicalUrl) window.location.replace(loopbackResult.canonicalUrl);
  } catch (error) {
    appStatus.textContent = error instanceof Error
      ? error.message
      : "No se pudo conectar la biblioteca persistente.";
  }
}

if (!isLocalLibraryBridge()) {
  void initializeLibraryPersistence();
}
