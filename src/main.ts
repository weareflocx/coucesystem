import "./styles.css";

import { OUTPUT_FORMATS, getOutputFormat } from "./core/formats";
import { UndoHistory, type HistoryEntry } from "./core/history";
import { decodeImageField } from "./core/image-field";
import {
  clearRemoteLibraryKey,
  deleteDurableColor,
  deleteDurableProject,
  hasRemoteLibraryKey,
  persistDurableLibrary,
  setRemoteLibraryKey,
  syncDurableLibrary
} from "./core/durable-library";
import {
  installLocalLibraryBridge,
  isLocalLibraryBridge,
  syncLoopbackLibraries
} from "./core/local-library-sync";
import { clamp, positiveModulo } from "./core/random";
import {
  BUILT_IN_APPEARANCE_PRESETS,
  appearanceFromLegacy,
  colorAtAppearancePosition,
  legacyParametersFromAppearance,
  normalizeAppearance,
  paletteFromAppearance
} from "./core/appearance";
import {
  cloneLightingRig,
  MAX_SPATIAL_LIGHTS,
  normalizeLightingRig,
  normalizeSpatialLight
} from "./core/lighting";
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
  AppearanceGradientStop,
  AppearanceMaterialPreset,
  AppearanceStyle,
  EngineState,
  ImageField,
  InspectorControlSection,
  LightingRigState,
  ProjectDefinition,
  ProjectFrame,
  RangeControlDefinition,
  SpatialLightState,
  SpatialLightType
} from "./core/types";
import { createDefaultView, normalizeView, viewUsesDefaults } from "./core/view";
import {
  checkVideoProfile,
  exportVideo,
  type VideoProfile
} from "./core/video-export";
import { exportProjectPng } from "./core/still-export";
import { createPresetDownload, parseSharedPreset } from "./core/preset";
import { PROJECTS, getProject } from "./projects";
import {
  deleteCameraSet,
  listCameraSets,
  saveCameraSet,
  deleteMotionSet,
  listMotionSets,
  saveMotionSet
} from "./projects/mobius-sets.js";

installLocalLibraryBridge();

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id}.`);
  return element as T;
}

function byElementId<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id}.`);
  return element as unknown as T;
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
const remoteLibraryKeyInput = byId<HTMLInputElement>("remote-library-key-input");
const connectRemoteLibraryButton = byId<HTMLButtonElement>("connect-remote-library-button");
const disconnectRemoteLibraryButton = byId<HTMLButtonElement>("disconnect-remote-library-button");
const remoteLibraryStatus = byId<HTMLParagraphElement>("remote-library-status");
const remoteLibraryError = byId<HTMLParagraphElement>("remote-library-error");
const deleteProjectDialog = byId<HTMLDialogElement>("delete-project-dialog");
const confirmDeleteProjectButton = byId<HTMLButtonElement>("confirm-delete-project-button");
const essentialControls = byId<HTMLDivElement>("essential-controls");
const motionControls = byId<HTMLDivElement>("motion-controls");
const shapeControls = byId<HTMLDivElement>("shape-controls");
const advancedControls = byId<HTMLDivElement>("advanced-controls");
const inspectorAdvanced = byId<HTMLDetailsElement>("inspector-advanced");
const advancedControlCount = byId<HTMLSpanElement>("advanced-control-count");
const inspectorSectionInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>("input[name='inspector-section']")
);
const inspectorTabLabels = Array.from(
  document.querySelectorAll<HTMLElement>("[data-inspector-tab-label]")
);
const inspectorPanels = Array.from(
  document.querySelectorAll<HTMLElement>("[data-inspector-panel]")
);
const motionSetSection = byId<HTMLElement>("motion-set-section");
const motionSetsDialog = byId<HTMLDialogElement>("motion-sets-dialog");
const openMotionSetsDialogButton = byId<HTMLButtonElement>("open-motion-sets-dialog-button");
const closeMotionSetsDialogButton = byId<HTMLButtonElement>("close-motion-sets-dialog-button");
const motionSetSelect = byId<HTMLSelectElement>("motion-set-select");
const applyMotionSetButton = byId<HTMLButtonElement>("apply-motion-set-button");
const deleteMotionSetButton = byId<HTMLButtonElement>("delete-motion-set-button");
const deleteMotionSetDialog = byId<HTMLDialogElement>("delete-motion-set-dialog");
const deleteMotionSetDescription = byId<HTMLParagraphElement>("delete-motion-set-description");
const confirmDeleteMotionSetButton = byId<HTMLButtonElement>("confirm-delete-motion-set-button");
const motionSetNameInput = byId<HTMLInputElement>("motion-set-name-input");
const saveSharedMotionSetButton = byId<HTMLButtonElement>("save-shared-motion-set-button");
const saveProjectMotionSetButton = byId<HTMLButtonElement>("save-project-motion-set-button");
const motionSetError = byId<HTMLParagraphElement>("motion-set-error");
const imageSourceSection = byId<HTMLElement>("image-source-section");
const imageUploadButton = byId<HTMLButtonElement>("image-upload-button");
const imageUploadInput = byId<HTMLInputElement>("image-upload-input");
const clearImageButton = byId<HTMLButtonElement>("clear-image-button");
const imageSourceStatus = byId<HTMLParagraphElement>("image-source-status");
const imageSourceError = byId<HTMLParagraphElement>("image-source-error");
const appearanceControls = byId<HTMLDivElement>("appearance-controls");
const openColorFromSidebarButton = byId<HTMLButtonElement>("open-color-from-sidebar-button");
const openCameraFromSidebarButton = byId<HTMLButtonElement>("open-camera-from-sidebar-button");
const openCameraDialogButton = byId<HTMLButtonElement>("open-camera-dialog-button");
const cameraDialog = byId<HTMLDialogElement>("camera-dialog");
const cameraDialogDragHandle = byId<HTMLElement>("camera-dialog-drag-handle");
const closeCameraDialogButton = byId<HTMLButtonElement>("close-camera-dialog-button");
const resetCameraDialogButton = byId<HTMLButtonElement>("reset-camera-dialog-button");
const resetCameraDialogPositionButton = byId<HTMLButtonElement>("reset-camera-dialog-position-button");
const cameraControls = byId<HTMLDivElement>("camera-controls");
const cameraSetSelect = byId<HTMLSelectElement>("camera-set-select");
const applyCameraSetButton = byId<HTMLButtonElement>("apply-camera-set-button");
const deleteCameraSetButton = byId<HTMLButtonElement>("delete-camera-set-button");
const deleteCameraSetDialog = byId<HTMLDialogElement>("delete-camera-set-dialog");
const deleteCameraSetDescription = byId<HTMLParagraphElement>("delete-camera-set-description");
const confirmDeleteCameraSetButton = byId<HTMLButtonElement>("confirm-delete-camera-set-button");
const cameraSetNameInput = byId<HTMLInputElement>("camera-set-name-input");
const saveSharedCameraSetButton = byId<HTMLButtonElement>("save-shared-camera-set-button");
const saveProjectCameraSetButton = byId<HTMLButtonElement>("save-project-camera-set-button");
const cameraSetError = byId<HTMLParagraphElement>("camera-set-error");
const gradientEditor = byId<HTMLElement>("gradient-editor");
const gradientControls = byId<HTMLDivElement>("gradient-controls");
const chromaticEditor = byId<HTMLElement>("chromatic-editor");
const chromaticControls = byId<HTMLDivElement>("chromatic-controls");
const gradientPreview = byId<HTMLDivElement>("gradient-preview");
const palettePreview = byId<HTMLDivElement>("palette-preview");
const colorError = byId<HTMLParagraphElement>("color-error");
const resetFormulaButton = byId<HTMLButtonElement>("reset-formula-button");
const undoButton = byId<HTMLButtonElement>("undo-button");
const redoButton = byId<HTMLButtonElement>("redo-button");
const backgroundColor = byId<HTMLInputElement>("background-color");
const foregroundColor = byId<HTMLInputElement>("foreground-color");
const backgroundColorValue = byId<HTMLInputElement>("background-color-value");
const foregroundColorValue = byId<HTMLInputElement>("foreground-color-value");
const appearancePaintModeInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>("input[name='appearance-paint-mode']")
);
const solidPaintEditor = byId<HTMLElement>("solid-paint-editor");
const gradientPaintEditor = byId<HTMLElement>("gradient-paint-editor");
const gradientStopList = byId<HTMLDivElement>("gradient-stop-list");
const addGradientStopButton = byId<HTMLButtonElement>("add-gradient-stop-button");
const appearanceGradientAngle = byId<HTMLInputElement>("appearance-gradient-angle");
const appearanceGradientMapping = byId<HTMLSelectElement>("appearance-gradient-mapping");
const appearanceGradientMappingControl = byId<HTMLElement>("appearance-gradient-mapping-control");
const appearanceMaterialSection = byId<HTMLElement>("appearance-material-section");
const appearanceMaterialPreset = byId<HTMLSelectElement>("appearance-material-preset");
const appearanceRoughness = byId<HTMLInputElement>("appearance-roughness");
const appearanceRoughnessValue = byId<HTMLOutputElement>("appearance-roughness-value");
const appearanceMetalness = byId<HTMLInputElement>("appearance-metalness");
const appearanceMetalnessValue = byId<HTMLOutputElement>("appearance-metalness-value");
const appearanceClearcoat = byId<HTMLInputElement>("appearance-clearcoat");
const appearanceClearcoatValue = byId<HTMLOutputElement>("appearance-clearcoat-value");
const appearanceTexturePreset = byId<HTMLSelectElement>("appearance-texture-preset");
const appearanceTextureControls = byId<HTMLDivElement>("appearance-texture-controls");
const appearanceTextureScale = byId<HTMLInputElement>("appearance-texture-scale");
const appearanceTextureScaleValue = byId<HTMLOutputElement>("appearance-texture-scale-value");
const appearanceTextureStrength = byId<HTMLInputElement>("appearance-texture-strength");
const appearanceTextureStrengthValue = byId<HTMLOutputElement>("appearance-texture-strength-value");
const appearanceTextureMotion = byId<HTMLInputElement>("appearance-texture-motion");
const appearanceTextureMotionValue = byId<HTMLOutputElement>("appearance-texture-motion-value");
const appearancePresetList = byId<HTMLDivElement>("appearance-preset-list");
const appearanceApplyScope = byId<HTMLSelectElement>("appearance-apply-scope");
const speedInput = byId<HTMLInputElement>("speed-input");
const speedDecreaseButton = byId<HTMLButtonElement>("speed-decrease-button");
const speedIncreaseButton = byId<HTMLButtonElement>("speed-increase-button");
const durationInput = byId<HTMLInputElement>("duration-input");
const durationLabel = byId<HTMLSpanElement>("duration-label");
const durationDecreaseButton = byId<HTMLButtonElement>("duration-decrease-button");
const durationIncreaseButton = byId<HTMLButtonElement>("duration-increase-button");
const timeModeControl = byId<HTMLLabelElement>("time-mode-control");
const playbackModeSelect = byId<HTMLSelectElement>("playback-mode-select");
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
const pngBackgroundSelect = byId<HTMLSelectElement>("png-background-select");
const exportPngButton = byId<HTMLButtonElement>("export-png-button");
const pngExportError = byId<HTMLParagraphElement>("png-export-error");
const pngExportStatus = byId<HTMLParagraphElement>("png-export-status");
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
const colorDialogDragHandle = byId<HTMLElement>("color-dialog-drag-handle");
const openColorDialogButton = byId<HTMLButtonElement>("open-color-dialog-button");
const closeColorDialogButton = byId<HTMLButtonElement>("close-color-dialog-button");
const resetColorDialogPositionButton = byId<HTMLButtonElement>("reset-color-dialog-position-button");
const colorSectionInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>("input[name='color-section']")
);
const colorPanels = Array.from(
  document.querySelectorAll<HTMLElement>("[data-color-panel]")
);
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
const exportColorMeshButton = byId<HTMLButtonElement>("export-color-mesh-button");
const svgExportStatus = byId<HTMLParagraphElement>("svg-export-status");
const appStatus = byId<HTMLParagraphElement>("app-status");
const canvasStage = byId<HTMLDivElement>("canvas-stage");
const canvas = byId<HTMLCanvasElement>("cauce-canvas");
const threeCanvas = byId<HTMLCanvasElement>("cauce-three-canvas");
const webgpuCanvas = byId<HTMLCanvasElement>("cauce-webgpu-canvas");
const vectorExportPreview = byId<HTMLDivElement>("vector-export-preview");
const previewModeSwitch = byId<HTMLDivElement>("preview-mode-switch");
const previewMode3dButton = byId<HTMLButtonElement>("preview-mode-3d-button");
const previewModeSvgButton = byId<HTMLButtonElement>("preview-mode-svg-button");
const canvasMessage = byId<HTMLParagraphElement>("canvas-message");
const canvasError = byId<HTMLParagraphElement>("canvas-error");
const viewportHud = byId<HTMLElement>("viewport-hud");
const viewportOrbitButton = byId<HTMLButtonElement>("viewport-orbit-button");
const viewportPanButton = byId<HTMLButtonElement>("viewport-pan-button");
const viewportLightButton = byId<HTMLButtonElement>("viewport-light-button");
const viewportZoomOutButton = byId<HTMLButtonElement>("viewport-zoom-out-button");
const viewportZoomInButton = byId<HTMLButtonElement>("viewport-zoom-in-button");
const viewportZoomInput = byId<HTMLInputElement>("viewport-zoom-input");
const viewportResetButton = byId<HTMLButtonElement>("viewport-reset-button");
const lightEditor = byId<HTMLElement>("light-editor");
const lightGizmoRay = byElementId<SVGLineElement>("light-gizmo-ray");
const lightSourceHandle = byId<HTMLButtonElement>("light-source-handle");
const lightTargetHandle = byId<HTMLButtonElement>("light-target-handle");
const lightAddType = byId<HTMLSelectElement>("light-add-type");
const lightAddButton = byId<HTMLButtonElement>("light-add-button");
const lightCountValue = byId<HTMLOutputElement>("light-count-value");
const lightList = byId<HTMLDivElement>("light-list");
const lightEmptyState = byId<HTMLParagraphElement>("light-empty-state");
const lightInspector = byId<HTMLElement>("light-inspector");
const lightSelectedType = byId<HTMLSpanElement>("light-selected-type");
const lightInspectorTitle = byId<HTMLElement>("light-inspector-title");
const lightEnabledInput = byId<HTMLInputElement>("light-enabled-input");
const lightNameInput = byId<HTMLInputElement>("light-name-input");
const lightTypeInput = byId<HTMLSelectElement>("light-type-input");
const lightColorSourceInput = byId<HTMLSelectElement>("light-color-source-input");
const lightColorInput = byId<HTMLInputElement>("light-color-input");
const lightIntensityInput = byId<HTMLInputElement>("light-intensity-input");
const lightIntensityValue = byId<HTMLOutputElement>("light-intensity-value");
const lightDistanceControl = byId<HTMLElement>("light-distance-control");
const lightDistanceInput = byId<HTMLInputElement>("light-distance-input");
const lightDistanceValue = byId<HTMLOutputElement>("light-distance-value");
const lightAngleControl = byId<HTMLElement>("light-angle-control");
const lightAngleInput = byId<HTMLInputElement>("light-angle-input");
const lightAngleValue = byId<HTMLOutputElement>("light-angle-value");
const lightPenumbraControl = byId<HTMLElement>("light-penumbra-control");
const lightPenumbraInput = byId<HTMLInputElement>("light-penumbra-input");
const lightPenumbraValue = byId<HTMLOutputElement>("light-penumbra-value");
const lightAreaControls = byId<HTMLDivElement>("light-area-controls");
const lightAreaWidthInput = byId<HTMLInputElement>("light-area-width-input");
const lightAreaWidthValue = byId<HTMLOutputElement>("light-area-width-value");
const lightAreaHeightInput = byId<HTMLInputElement>("light-area-height-input");
const lightAreaHeightValue = byId<HTMLOutputElement>("light-area-height-value");
const lightShadowsInput = byId<HTMLInputElement>("light-shadows-input");
const lightShadowCost = byId<HTMLSpanElement>("light-shadow-cost");
const lightSoloInput = byId<HTMLInputElement>("light-solo-input");
const lightPositionValue = byId<HTMLOutputElement>("light-position-value");
const lightDuplicateButton = byId<HTMLButtonElement>("light-duplicate-button");
const lightDeleteButton = byId<HTMLButtonElement>("light-delete-button");
const lightEnvironmentEnabledInput = byId<HTMLInputElement>("light-environment-enabled-input");
const lightEnvironmentIntensityInput = byId<HTMLInputElement>("light-environment-intensity-input");
const lightEnvironmentIntensityValue = byId<HTMLOutputElement>("light-environment-intensity-value");
const lightEnvironmentRotationInput = byId<HTMLInputElement>("light-environment-rotation-input");
const lightEnvironmentRotationValue = byId<HTMLOutputElement>("light-environment-rotation-value");
const lightAmbientTypeInput = byId<HTMLSelectElement>("light-ambient-type-input");
const lightAmbientIntensityControl = byId<HTMLElement>("light-ambient-intensity-control");
const lightAmbientIntensityInput = byId<HTMLInputElement>("light-ambient-intensity-input");
const lightAmbientIntensityValue = byId<HTMLOutputElement>("light-ambient-intensity-value");
const lightAmbientColors = byId<HTMLDivElement>("light-ambient-colors");
const lightAmbientColorInput = byId<HTMLInputElement>("light-ambient-color-input");
const lightGroundColorControl = byId<HTMLElement>("light-ground-color-control");
const lightGroundColorInput = byId<HTMLInputElement>("light-ground-color-input");
const lightResetButton = byId<HTMLButtonElement>("light-reset-button");
const lightPresetControl = byId<HTMLDivElement>("light-preset-control");
const lightPresetSelect = byId<HTMLSelectElement>("light-preset-select");
const lightApplyPresetButton = byId<HTMLButtonElement>("light-apply-preset-button");
const lightPresetDescription = byId<HTMLParagraphElement>("light-preset-description");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const projectParameters = new Map(
  PROJECTS.map((project) => [project.id, { ...project.defaults }])
);
const projectLighting = new Map(
  PROJECTS.map((project) => [project.id, cloneLightingRig(project.defaultLighting)])
);
const projectViews = new Map(
  PROJECTS.map((project) => [project.id, createDefaultView()])
);
const projectPlaybackModes = new Map(
  PROJECTS.map((project) => [project.id, project.preferredPlaybackMode ?? "loop"])
);

const initialPalette: EngineState["palette"] = {
  background: "#11110f",
  foreground: "#f4f3ee",
  accent: "#aeb7ff",
  secondary: "#8ecfc2"
};

let state: EngineState = {
  projectId: PROJECTS[0]!.id,
  formatKey: OUTPUT_FORMATS[0]!.key,
  seed: 6437,
  palette: initialPalette,
  appearance: appearanceFromLegacy(initialPalette, PROJECTS[0]!.defaults),
  view: createDefaultView(),
  playback: {
    playing: !reducedMotion.matches,
    speed: 1,
    loopSeconds: 8,
    mode: "loop"
  },
  parameters: { ...PROJECTS[0]!.defaults },
  lighting: cloneLightingRig(PROJECTS[0]!.defaultLighting)
};

let workerReady = false;
let scrubbing = false;
let resumeAfterScrub = false;
let stageVisible = true;
let vectorExportPreviewEnabled = false;
let queuedVectorExportPreviewFrame = 0;
let rememberedGradientPaint: Extract<AppearanceStyle["paint"], { type: "gradient" }> | null = null;
let currentTime = 0;
let currentElapsedTime = 0;
let currentImageField: ImageField | null = null;
let currentImageName = "";
let savedProjects: SavedProjectRecord[] = [];
let savedColors: SavedColorRecord[] = [];
let pendingDeleteId = "";
let pendingDeleteColorId = "";
let pendingDeleteCameraSetId = "";
let pendingDeleteMotionSetId = "";
let videoExportController: AbortController | null = null;
type ViewMode = "orbit" | "pan" | "light";

let viewMode: ViewMode = "orbit";

const WORKSPACE_LAYOUT_STORAGE_KEY = "cauce:workspace-layout:v1";
const FLOATING_PANEL_BREAKPOINT = 680;
const FLOATING_PANEL_MARGIN = 12;
const FLOATING_PANEL_EDGE_OFFSET = 18;

type FloatingPanelPosition = { x: number; y: number };
type FloatingPanelDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

let colorDialogPosition: FloatingPanelPosition | null = null;
let colorDialogDrag: FloatingPanelDrag | null = null;
let cameraDialogPosition: FloatingPanelPosition | null = null;
let cameraDialogDrag: FloatingPanelDrag | null = null;

function readColorDialogPosition(): FloatingPanelPosition | null {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      colorPanel?: { x?: unknown; y?: unknown };
    };
    const x = parsed.colorPanel?.x;
    const y = parsed.colorPanel?.y;
    return typeof x === "number" && Number.isFinite(x) &&
      typeof y === "number" && Number.isFinite(y)
      ? { x, y }
      : null;
  } catch {
    return null;
  }
}

function saveColorDialogPosition(position: FloatingPanelPosition): void {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
    const current = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    window.localStorage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify({
      ...current,
      colorPanel: position
    }));
  } catch {
    // Las preferencias de layout son opcionales; el editor sigue funcionando sin persistencia.
  }
}

function readCameraDialogPosition(): FloatingPanelPosition | null {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      cameraPanel?: { x?: unknown; y?: unknown };
    };
    const x = parsed.cameraPanel?.x;
    const y = parsed.cameraPanel?.y;
    return typeof x === "number" && Number.isFinite(x) &&
      typeof y === "number" && Number.isFinite(y)
      ? { x, y }
      : null;
  } catch {
    return null;
  }
}

function saveCameraDialogPosition(position: FloatingPanelPosition): void {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
    const current = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    window.localStorage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify({
      ...current,
      cameraPanel: position
    }));
  } catch {
    // Las preferencias de layout son opcionales; el editor sigue funcionando sin persistencia.
  }
}

function colorDialogIsFloating(): boolean {
  return window.innerWidth > FLOATING_PANEL_BREAKPOINT;
}

function defaultColorDialogPosition(): FloatingPanelPosition {
  const bounds = colorDialog.getBoundingClientRect();
  return {
    x: Math.max(
      FLOATING_PANEL_MARGIN,
      window.innerWidth - bounds.width - FLOATING_PANEL_EDGE_OFFSET
    ),
    y: Math.max(FLOATING_PANEL_MARGIN, Math.min(72, window.innerHeight - bounds.height - FLOATING_PANEL_MARGIN))
  };
}

function applyColorDialogPosition(position: FloatingPanelPosition, persist = false): void {
  if (!colorDialogIsFloating()) return;
  const bounds = colorDialog.getBoundingClientRect();
  const maximumX = Math.max(FLOATING_PANEL_MARGIN, window.innerWidth - bounds.width - FLOATING_PANEL_MARGIN);
  const maximumY = Math.max(FLOATING_PANEL_MARGIN, window.innerHeight - bounds.height - FLOATING_PANEL_MARGIN);
  colorDialogPosition = {
    x: Math.round(clamp(position.x, FLOATING_PANEL_MARGIN, maximumX)),
    y: Math.round(clamp(position.y, FLOATING_PANEL_MARGIN, maximumY))
  };
  colorDialog.style.setProperty("--floating-panel-x", `${colorDialogPosition.x}px`);
  colorDialog.style.setProperty("--floating-panel-y", `${colorDialogPosition.y}px`);
  if (persist) saveColorDialogPosition(colorDialogPosition);
}

function defaultCameraDialogPosition(): FloatingPanelPosition {
  const bounds = cameraDialog.getBoundingClientRect();
  const maximumX = Math.max(
    FLOATING_PANEL_MARGIN,
    window.innerWidth - bounds.width - FLOATING_PANEL_MARGIN
  );
  return {
    x: clamp(
      canvasStage.getBoundingClientRect().left + FLOATING_PANEL_EDGE_OFFSET,
      FLOATING_PANEL_MARGIN,
      maximumX
    ),
    y: Math.max(
      FLOATING_PANEL_MARGIN,
      Math.min(72, window.innerHeight - bounds.height - FLOATING_PANEL_MARGIN)
    )
  };
}

function applyCameraDialogPosition(position: FloatingPanelPosition, persist = false): void {
  if (!colorDialogIsFloating()) return;
  const bounds = cameraDialog.getBoundingClientRect();
  const maximumX = Math.max(FLOATING_PANEL_MARGIN, window.innerWidth - bounds.width - FLOATING_PANEL_MARGIN);
  const maximumY = Math.max(FLOATING_PANEL_MARGIN, window.innerHeight - bounds.height - FLOATING_PANEL_MARGIN);
  cameraDialogPosition = {
    x: Math.round(clamp(position.x, FLOATING_PANEL_MARGIN, maximumX)),
    y: Math.round(clamp(position.y, FLOATING_PANEL_MARGIN, maximumY))
  };
  cameraDialog.style.setProperty("--floating-panel-x", `${cameraDialogPosition.x}px`);
  cameraDialog.style.setProperty("--floating-panel-y", `${cameraDialogPosition.y}px`);
  if (persist) saveCameraDialogPosition(cameraDialogPosition);
}

type ColorSection = "editor" | "library";

function isColorSection(value: string): value is ColorSection {
  return value === "editor" || value === "library";
}

function showColorPanel(section: ColorSection): void {
  for (const input of colorSectionInputs) input.checked = input.value === section;
  for (const panel of colorPanels) panel.hidden = panel.dataset.colorPanel !== section;
}

function openColorDialog(): void {
  setColorLibraryError("");
  updateStaticUi();
  refreshSavedColors(savedColorSelect.value);
  const selectedSection = colorSectionInputs.find((input) => input.checked)?.value;
  showColorPanel(selectedSection && isColorSection(selectedSection) ? selectedSection : "editor");
  if (!colorDialog.open) colorDialog.show();
  openColorDialogButton.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    if (colorDialogIsFloating()) {
      applyColorDialogPosition(
        colorDialogPosition ?? readColorDialogPosition() ?? defaultColorDialogPosition()
      );
    }
    closeColorDialogButton.focus({ preventScroll: true });
  });
}

function closeColorDialog(): void {
  if (!colorDialog.open) return;
  colorDialog.close();
  openColorDialogButton.setAttribute("aria-expanded", "false");
  openColorDialogButton.focus({ preventScroll: true });
}

function openCameraDialog(): void {
  if (openCameraDialogButton.hidden) return;
  updateStaticUi();
  if (!cameraDialog.open) cameraDialog.show();
  openCameraDialogButton.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    if (colorDialogIsFloating()) {
      applyCameraDialogPosition(
        cameraDialogPosition ?? readCameraDialogPosition() ?? defaultCameraDialogPosition()
      );
    }
    closeCameraDialogButton.focus({ preventScroll: true });
  });
}

function closeCameraDialog(): void {
  if (!cameraDialog.open) return;
  cameraDialog.close();
  openCameraDialogButton.setAttribute("aria-expanded", "false");
  openCameraDialogButton.focus({ preventScroll: true });
}
let queuedViewFrame = 0;
const activePointers = new Map<number, { x: number; y: number }>();
let pointerAnchor: { x: number; y: number } | null = null;
let gestureAnchor: { distance: number; x: number; y: number } | null = null;
let wheelHistoryTimer = 0;
let lightWheelHistoryTimer = 0;
let lightGizmoFrame = 0;

type SpatialLightHandle = "source" | "target";
type Vector3Value = { x: number; y: number; z: number };

interface SpatialProjection {
  contentWidth: number;
  contentHeight: number;
  contentX: number;
  contentY: number;
  aspect: number;
  tangent: number;
  camera: Vector3Value;
  forward: Vector3Value;
  right: Vector3Value;
  up: Vector3Value;
}

interface SpatialLightDrag {
  pointerId: number;
  handle: SpatialLightHandle;
  startClientX: number;
  startClientY: number;
  startPoint: Vector3Value;
  depth: number;
  projection: SpatialProjection;
}

let spatialLightDrag: SpatialLightDrag | null = null;
let selectedLightId = "";

interface EditorSnapshot {
  state: EngineState;
  time: number;
  elapsedTime: number;
}

const editorHistory = new UndoHistory<EditorSnapshot>(100);
const activeHistoryInteractions = new Set<string>();
const engineDiagnosticsEnabled = new URLSearchParams(window.location.search)
  .get("debug-engine") === "1";
const fluidResetMode = new URLSearchParams(window.location.search)
  .get("fluid-reset") === "gpu-v2"
  ? "gpu-v2"
  : "legacy-cpu";

const worker = new Worker(new URL("./core/engine.worker.ts", import.meta.url), {
  type: "module"
});
const diagnosticsRequests = new Map<
  string,
  {
    resolve: (diagnostics: Record<string, unknown> | null) => void;
    timeout: number;
  }
>();

function post(message: MainToWorkerMessage, transfer?: Transferable[]): void {
  if (transfer) {
    worker.postMessage(message, transfer);
    return;
  }
  worker.postMessage(message);
}

function requestEngineDiagnostics(): Promise<Record<string, unknown> | null> {
  const requestId = window.crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      diagnosticsRequests.delete(requestId);
      reject(new Error("El motor no respondió a la solicitud de diagnóstico."));
    }, 3000);
    diagnosticsRequests.set(requestId, { resolve, timeout });
    post({ type: "request-diagnostics", requestId });
  });
}

if (engineDiagnosticsEnabled) {
  const debugWindow = window as unknown as {
    __CAUCE_DEBUG__?: {
      diagnostics(): Promise<Record<string, unknown> | null>;
      ready(): boolean;
      state(): EngineState;
      selectProject(projectId: string): void;
      setParameter(key: string, value: number): void;
      setAppearance(appearance: AppearanceStyle): void;
      setSeed(seed: number): void;
      setPlaying(playing: boolean): void;
      setEnvironmentEnabled(enabled: boolean): void;
      setLightsEnabled(enabled: boolean): void;
      setShadows(enabled: boolean): void;
    };
  };
  debugWindow.__CAUCE_DEBUG__ = {
    diagnostics: requestEngineDiagnostics,
    ready: () => workerReady && projectSelect.options.length > 0,
    state: () => structuredClone(state),
    selectProject: (projectId) => changeProject(projectId),
    setParameter: (key, value) => {
      const project = getProject(state.projectId);
      const control = project.controls.find((candidate) => candidate.key === key);
      if (!control || !Number.isFinite(value)) {
        throw new Error(
          `Parámetro de diagnóstico no válido: ${key} en ${project.id} ` +
          `(${project.controls.map((candidate) => candidate.key).join(", ")}).`
        );
      }
      const normalized = clamp(value, control.min, control.max);
      state = {
        ...state,
        parameters: { ...state.parameters, [key]: normalized }
      };
      projectParameters.set(state.projectId, { ...state.parameters });
      renderProjectControls(project);
      postState();
    },
    setAppearance: (appearance) => {
      applyAppearance(
        normalizeAppearance(appearance, state.palette, state.parameters),
        "Apariencia de diagnóstico aplicada."
      );
    },
    setSeed: (seed) => {
      if (!Number.isFinite(seed)) throw new Error("Semilla de diagnóstico no válida.");
      state = {
        ...state,
        seed: Math.max(0, Math.min(0xFFFFFFFF, Math.round(seed)))
      };
      postState();
    },
    setEnvironmentEnabled: (enabled) => {
      const lighting = cloneLightingRig(state.lighting);
      if (!lighting || typeof enabled !== "boolean") {
        throw new Error("El proyecto activo no admite un entorno configurable.");
      }
      lighting.environment.enabled = enabled;
      state = { ...state, lighting };
      projectLighting.set(state.projectId, cloneLightingRig(lighting));
      postState();
    },
    setLightsEnabled: (enabled) => {
      const lighting = cloneLightingRig(state.lighting);
      if (!lighting || typeof enabled !== "boolean") {
        throw new Error("El proyecto activo no admite luces configurables.");
      }
      lighting.lights = lighting.lights.map((light) => ({ ...light, enabled }));
      state = { ...state, lighting };
      projectLighting.set(state.projectId, cloneLightingRig(lighting));
      postState();
    },
    setShadows: (enabled) => {
      const lighting = cloneLightingRig(state.lighting);
      if (!lighting || typeof enabled !== "boolean") {
        throw new Error("El proyecto activo no admite sombras configurables.");
      }
      lighting.lights = lighting.lights.map((light) => ({
        ...light,
        castShadow: enabled
      }));
      state = { ...state, lighting };
      projectLighting.set(state.projectId, cloneLightingRig(lighting));
      postState();
    },
    setPlaying
  };
}

function postState(): void {
  post({ type: "state", state });
  updateStaticUi();
  scheduleVectorExportPreview();
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
    time: currentTime,
    elapsedTime: currentElapsedTime
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
  if (lightWheelHistoryTimer) {
    window.clearTimeout(lightWheelHistoryTimer);
    lightWheelHistoryTimer = 0;
  }
}

function applyHistoryEntry(entry: HistoryEntry<EditorSnapshot>, direction: "undo" | "redo"): void {
  const playing = state.playback.playing;
  state = structuredClone(entry.snapshot.state);
  state.playback.playing = playing;
  if (entry.restoreTime) {
    currentTime = clamp(entry.snapshot.time, 0, 0.999999);
    currentElapsedTime = Math.max(0, entry.snapshot.elapsedTime);
  }

  projectParameters.set(state.projectId, { ...state.parameters });
  projectLighting.set(state.projectId, cloneLightingRig(state.lighting));
  projectViews.set(state.projectId, { ...state.view });
  projectPlaybackModes.set(state.projectId, state.playback.mode);
  const project = getProject(state.projectId);
  renderProjectControls(project);
  videoFpsSelect.value = String(project.preferredFps);
  updateStaticUi();
  timelineInput.value = String(currentTime);
  timelineValue.value = `${Math.round(currentTime * 100)}%`;
  post({ type: "state", state });
  if (project.spatialLightControls === true) {
    renderLightList();
    syncLightEditorControls();
    scheduleLightGizmoUpdate();
  }
  if (entry.restoreTime) {
    post({ type: "seek", time: currentTime, elapsedTime: currentElapsedTime });
  }
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

function formatControlInputValue(control: RangeControlDefinition, value: number): string {
  return value.toFixed(control.digits ?? 2);
}

type InspectorPanelSection = Exclude<InspectorControlSection, "advanced">;

const INSPECTOR_SECTION_STORAGE_KEY = "cauce:inspector-sections:v1";
const ADVANCED_CONTROL_KEYS = new Set([
  "arrivalHold",
  "damping",
  "densityResponse",
  "directionResponse",
  "ellipticity",
  "fieldFrequency",
  "flattening",
  "fragmentation",
  "gamma",
  "gridResolution",
  "imageX",
  "imageY",
  "levels",
  "maximumFill",
  "minimumFill",
  "phaseOffset",
  "restDensity",
  "softness",
  "speedVariation",
  "stiffness",
  "substeps",
  "surfaceTension",
  "tangentMobility",
  "trailMemory",
  "twistConcentration",
  "twistPhase",
  "twistPosition",
  "viscosity",
  "widthVariation"
]);
const MOTION_CONTROL_KEY = /(motion|speed|drift|flow|circulation|breathing|precession|turbulence|vorticity|memory|coherence|pulse|water|travel|gravity|force|interaction|frequency)/i;

function readInspectorSections(): Record<string, InspectorPanelSection> {
  try {
    const value = JSON.parse(localStorage.getItem(INSPECTOR_SECTION_STORAGE_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, section]) => (
      section === "essential" || section === "motion" || section === "shape" || section === "appearance"
    ))) as Record<string, InspectorPanelSection>;
  } catch {
    return {};
  }
}

const inspectorSectionByProject = readInspectorSections();

function saveInspectorSections(): void {
  try {
    localStorage.setItem(INSPECTOR_SECTION_STORAGE_KEY, JSON.stringify(inspectorSectionByProject));
  } catch {
    // The inspector remains usable when storage is unavailable.
  }
}

function controlIsAdvanced(control: RangeControlDefinition): boolean {
  return control.advanced === true ||
    control.inspectorSection === "advanced" ||
    ADVANCED_CONTROL_KEYS.has(control.key);
}

function normalizeControlValue(control: RangeControlDefinition, value: number): number {
  const bounded = clamp(value, control.min, control.max);
  const step = Number.isFinite(control.step) && control.step > 0 ? control.step : 1;
  const snapped = control.min + Math.round((bounded - control.min) / step) * step;
  const stepDecimals = String(step).split(".")[1]?.length ?? 0;
  const precision = Math.min(10, Math.max(control.digits ?? 2, stepDecimals));
  return Number(clamp(snapped, control.min, control.max).toFixed(precision));
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

function setRemoteLibraryError(message: string): void {
  remoteLibraryError.textContent = message;
  remoteLibraryError.hidden = message.length === 0;
}

function updateRemoteLibraryUi(message = ""): void {
  const connected = hasRemoteLibraryKey();
  disconnectRemoteLibraryButton.disabled = !connected;
  remoteLibraryStatus.classList.toggle("is-connected", connected);
  remoteLibraryStatus.textContent = message || (connected
    ? "Netlify · clave activa durante esta sesión"
    : "Modo local · este navegador");
  remoteLibraryKeyInput.placeholder = connected
    ? "Introduce otra clave para reconectar"
    : "Configura CAUCE_LIBRARY_KEY";
}

function durableLibraryName(mode: "local-file" | "netlify"): string {
  return mode === "netlify"
    ? "biblioteca sincronizada"
    : "biblioteca local persistente";
}

function setColorLibraryError(message: string): void {
  colorLibraryError.textContent = message;
  colorLibraryError.hidden = message.length === 0;
}

function setColorError(message: string): void {
  colorError.textContent = message;
  colorError.hidden = message.length === 0;
}

function currentAppearance(): AppearanceStyle {
  return normalizeAppearance(state.appearance, state.palette, state.parameters);
}

function parametersWithAppearance(
  project: ProjectDefinition,
  current: Record<string, number>,
  appearance: AppearanceStyle
): Record<string, number> {
  const compatible = legacyParametersFromAppearance(appearance);
  return Object.fromEntries(project.controls.map((control) => {
    const supplied = compatible[control.key];
    const currentValue = current[control.key] ?? control.defaultValue;
    return [control.key, typeof supplied === "number"
      ? clamp(supplied, control.min, control.max)
      : currentValue];
  }));
}

function projectAppearanceMappings(project: ProjectDefinition): Array<"screen" | "surface"> {
  const supplied = project.appearanceCapabilities?.gradientMapping;
  if (supplied?.length) return supplied;
  return project.backend === "three" || project.backend === "webgpu"
    ? ["surface"]
    : ["screen"];
}

function appearanceForProject(
  project: ProjectDefinition,
  appearance: AppearanceStyle
): AppearanceStyle {
  if (appearance.paint.type !== "gradient") return appearance;
  const mappings = projectAppearanceMappings(project);
  return mappings.includes(appearance.paint.mapping)
    ? appearance
    : { ...appearance, paint: { ...appearance.paint, mapping: mappings[0]! } };
}

function applyAppearance(
  value: AppearanceStyle,
  status = "Apariencia actualizada.",
  includeBackground = true
): void {
  const active = currentAppearance();
  const candidate = includeBackground
    ? value
    : { ...value, background: structuredClone(active.background) };
  const project = getProject(state.projectId);
  const appearance = appearanceForProject(
    project,
    normalizeAppearance(candidate, state.palette, state.parameters)
  );
  const parameters = parametersWithAppearance(project, state.parameters, appearance);
  state = {
    ...state,
    appearance,
    palette: paletteFromAppearance(appearance),
    parameters
  };
  projectParameters.set(project.id, { ...parameters });
  setColorError("");
  appStatus.textContent = status;
  postState();
}

function appearancePreviewBackground(appearance: AppearanceStyle): string {
  if (appearance.paint.type === "solid") {
    return `linear-gradient(${appearance.paint.color}, ${appearance.paint.color})`;
  }
  const colors = Array.from({ length: 17 }, (_, index) => {
    const position = index / 16;
    return `${colorAtAppearancePosition(appearance, position)} ${(position * 100).toFixed(2)}%`;
  });
  return `linear-gradient(${appearance.paint.angle + 90}deg, ${colors.join(", ")})`;
}

function currentGradientSettings(project = getProject(state.projectId)): SavedColorGradient {
  const appearance = currentAppearance();
  if (appearance.paint.type === "gradient") {
    const middle = appearance.paint.stops.reduce((closest, stop) => (
      Math.abs(stop.position - 0.5) < Math.abs(closest.position - 0.5) ? stop : closest
    ));
    return { strength: 1, angle: appearance.paint.angle, midpoint: middle.position };
  }
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

function updateSavedColorPreview(element: HTMLElement, record: SavedColorRecord | null): void {
  if (!record) {
    element.style.backgroundColor = "var(--surface-muted)";
    element.style.backgroundImage = "none";
    element.style.backgroundSize = "auto";
    element.style.backgroundPosition = "initial";
    element.style.backgroundRepeat = "initial";
    return;
  }
  element.style.backgroundColor = record.appearance.background.color;
  element.style.backgroundImage = appearancePreviewBackground(record.appearance);
  element.style.backgroundSize = "100% 44%";
  element.style.backgroundPosition = "center";
  element.style.backgroundRepeat = "no-repeat";
}

function refreshSavedColors(selectedId = ""): void {
  savedColors = listSavedColors();
  exportLibraryButton.disabled = savedProjects.length === 0 && savedColors.length === 0;
  if (savedColors.length === 0) {
    savedColorSelect.replaceChildren(makeOption("", "Sin apariencias guardadas"));
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

function renderBuiltInAppearances(): void {
  appearancePresetList.replaceChildren(...BUILT_IN_APPEARANCE_PRESETS.map((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "appearance-preset-button";
    const swatch = document.createElement("span");
    swatch.className = "appearance-preset-swatch";
    swatch.style.backgroundColor = preset.appearance.background.color;
    swatch.style.backgroundImage = appearancePreviewBackground(preset.appearance);
    const label = document.createElement("span");
    label.textContent = preset.name;
    button.append(swatch, label);
    button.addEventListener("click", () => {
      recordHistory(`Aplicar apariencia “${preset.name}”`);
      applyAppearance(
        structuredClone(preset.appearance),
        `Apariencia “${preset.name}” aplicada.`,
        appearanceApplyScope.value !== "surface"
      );
      renderProjectControls(getProject(state.projectId));
    });
    return button;
  }));
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

function controlIsVisible(control: RangeControlDefinition): boolean {
  if (control.group === "lighting3d" || control.hidden) return false;
  if (control.timeMode && control.timeMode !== state.playback.mode) return false;
  return !control.visibleWhen || state.parameters[control.visibleWhen.key] === control.visibleWhen.equals;
}

const UNIFIED_APPEARANCE_PARAMETER_KEYS = new Set([
  "gradientStrength",
  "gradientAngle",
  "gradientMidpoint",
  "roughness",
  "metalness",
  "clearcoat",
  "materialRoughness",
  "materialMetalness",
  "textureMode",
  "textureScale",
  "textureStrength",
  "textureMotion",
  "materialMode",
  "mineralScale",
  "paletteMix",
  "colorMode"
]);

function updateProjectControl(
  project: ProjectDefinition,
  control: RangeControlDefinition,
  nextValue: number,
  statusValue = formatControlValue(control, nextValue)
): void {
  state = {
    ...state,
    parameters: { ...state.parameters, [control.key]: nextValue }
  };
  projectParameters.set(state.projectId, { ...state.parameters });
  appStatus.textContent = `${control.label}: ${statusValue}.`;
  postState();
  resetFormulaButton.disabled = formulaUsesDefaults(project);
}

function createParameterControl(
  project: ProjectDefinition,
  control: RangeControlDefinition
): HTMLElement {
  const row = document.createElement("div");
  row.className = "parameter-control";
  const inputId = `parameter-${project.id}-${control.key}`;
  const label = document.createElement("label");
  label.className = "parameter-control-label";
  label.htmlFor = inputId;
  label.textContent = control.label;
  label.title = control.label;
  const currentValue = state.parameters[control.key] ?? control.defaultValue;
  const hasDependents = project.controls.some((candidate) => candidate.visibleWhen?.key === control.key);

  if (control.options?.length) {
    row.classList.add("parameter-select-control");
    const select = document.createElement("select");
    select.id = inputId;
    select.replaceChildren(...control.options.map((option) => (
      makeOption(String(option.value), option.label)
    )));
    select.value = String(currentValue);
    const optionHint = document.createElement("small");
    optionHint.className = "control-hint";
    const updateOptionHint = () => {
      const selected = control.options?.find((option) => option.value === Number(select.value));
      optionHint.textContent = selected?.description ?? "";
      optionHint.hidden = !selected?.description;
    };
    select.addEventListener("change", () => {
      const nextValue = Number(select.value);
      if (nextValue === state.parameters[control.key]) return;
      recordHistory(`Cambiar ${control.label}`);
      updateProjectControl(
        project,
        control,
        nextValue,
        select.selectedOptions[0]?.textContent ?? String(nextValue)
      );
      updateOptionHint();
      if (hasDependents) renderProjectControls(project);
    });
    updateOptionHint();
    row.append(label, select, optionHint);
    return row;
  }

  const rangeInput = document.createElement("input");
  rangeInput.id = inputId;
  rangeInput.type = "range";
  rangeInput.min = String(control.min);
  rangeInput.max = String(control.max);
  rangeInput.step = String(control.step);
  rangeInput.value = String(currentValue);

  const valueField = document.createElement("span");
  valueField.className = "parameter-value-field";
  const valueInput = document.createElement("input");
  valueInput.type = "number";
  valueInput.inputMode = "decimal";
  valueInput.min = String(control.min);
  valueInput.max = String(control.max);
  valueInput.step = String(control.step);
  valueInput.value = formatControlInputValue(control, currentValue);
  valueInput.setAttribute("aria-label", `Valor de ${control.label}`);
  valueField.appendChild(valueInput);
  if (control.suffix) {
    const suffix = document.createElement("span");
    suffix.className = "parameter-value-suffix";
    suffix.textContent = control.suffix;
    suffix.setAttribute("aria-hidden", "true");
    valueField.appendChild(suffix);
  }

  const historyKey = `parameter:${project.id}:${control.key}`;
  rangeInput.addEventListener("input", () => {
    const nextValue = Number(rangeInput.value);
    beginHistoryInteraction(historyKey, `Cambiar ${control.label}`);
    valueInput.value = formatControlInputValue(control, nextValue);
    updateProjectControl(project, control, nextValue);
  });
  const finishRangeInteraction = () => {
    endHistoryInteraction(historyKey);
    if (hasDependents) renderProjectControls(project);
  };
  rangeInput.addEventListener("change", finishRangeInteraction);
  rangeInput.addEventListener("pointercancel", finishRangeInteraction);
  rangeInput.addEventListener("blur", () => endHistoryInteraction(historyKey));

  const commitNumericValue = () => {
    const parsedValue = Number(valueInput.value);
    if (!Number.isFinite(parsedValue)) {
      valueInput.value = formatControlInputValue(
        control,
        state.parameters[control.key] ?? control.defaultValue
      );
      return;
    }
    const nextValue = normalizeControlValue(control, parsedValue);
    const previousValue = state.parameters[control.key] ?? control.defaultValue;
    valueInput.value = formatControlInputValue(control, nextValue);
    rangeInput.value = String(nextValue);
    if (nextValue === previousValue) return;
    recordHistory(`Cambiar ${control.label}`);
    updateProjectControl(project, control, nextValue);
    if (hasDependents) renderProjectControls(project);
  };
  valueInput.addEventListener("change", commitNumericValue);
  valueInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    valueInput.blur();
  });

  row.append(label, rangeInput, valueField);
  return row;
}

function syncInspectorNavigation(
  projectId: string,
  counts: Record<InspectorPanelSection, number>
): void {
  const available = (["essential", "motion", "shape", "appearance"] as InspectorPanelSection[])
    .filter((section) => counts[section] > 0);
  const remembered = inspectorSectionByProject[projectId];
  const active = remembered && available.includes(remembered)
    ? remembered
    : available[0] ?? "essential";

  for (const input of inspectorSectionInputs) {
    const section = input.value as InspectorPanelSection;
    const enabled = counts[section] > 0;
    input.disabled = !enabled;
    input.checked = section === active;
    const tab = inspectorTabLabels.find((candidate) => candidate.dataset.inspectorTabLabel === section);
    if (tab) tab.hidden = !enabled;
  }
  for (const panel of inspectorPanels) panel.hidden = panel.dataset.inspectorPanel !== active;
  inspectorSectionByProject[projectId] = active;
  saveInspectorSections();
}

function renderProjectControls(project: ProjectDefinition): void {
  const essentialFragment = document.createDocumentFragment();
  const motionFragment = document.createDocumentFragment();
  const shapeFragment = document.createDocumentFragment();
  const advancedFragment = document.createDocumentFragment();
  const cameraFragment = document.createDocumentFragment();
  const appearanceFragment = document.createDocumentFragment();
  const gradientFragment = document.createDocumentFragment();
  const chromaticFragment = document.createDocumentFragment();
  const counts: Record<InspectorControlSection, number> = {
    essential: 0,
    motion: 0,
    shape: 0,
    appearance: 0,
    advanced: 0
  };
  let cameraCount = 0;
  let gradientCount = 0;
  let chromaticCount = 0;

  const visibleFieldControls = project.controls.filter((control) => (
    controlIsVisible(control) &&
    !["camera", "appearance", "gradient", "color3d"].includes(control.group ?? "")
  ));
  const essentialKeys = new Set(visibleFieldControls
    .filter((control) => control.inspectorSection === "essential")
    .map((control) => control.key));
  for (const control of visibleFieldControls) {
    if (essentialKeys.size >= 4) break;
    if (control.inspectorSection || controlIsAdvanced(control)) continue;
    essentialKeys.add(control.key);
  }
  const fieldSectionByKey = new Map<string, InspectorControlSection>();
  const primarySectionCounts = { motion: 0, shape: 0 };
  for (const control of visibleFieldControls) {
    let section = control.inspectorSection ?? (
      essentialKeys.has(control.key)
        ? "essential"
        : controlIsAdvanced(control)
          ? "advanced"
          : MOTION_CONTROL_KEY.test(control.key)
            ? "motion"
            : "shape"
    );
    if (
      !control.inspectorSection &&
      (section === "motion" || section === "shape") &&
      primarySectionCounts[section] >= 6
    ) {
      section = "advanced";
    }
    if (section === "motion" || section === "shape") primarySectionCounts[section] += 1;
    fieldSectionByKey.set(control.key, section);
  }

  for (const control of project.controls) {
    if (!controlIsVisible(control)) continue;
    if (
      (control.group === "gradient" || control.group === "appearance" || control.group === "color3d") &&
      UNIFIED_APPEARANCE_PARAMETER_KEYS.has(control.key)
    ) {
      if (control.group === "gradient") gradientCount += 1;
      continue;
    }
    const controlElement = createParameterControl(project, control);
    if (control.group === "camera") {
      cameraFragment.appendChild(controlElement);
      cameraCount += 1;
    } else if (control.group === "appearance") {
      appearanceFragment.appendChild(controlElement);
      counts.appearance += 1;
    } else if (control.group === "gradient") {
      gradientFragment.appendChild(controlElement);
      gradientCount += 1;
    } else if (control.group === "color3d") {
      chromaticFragment.appendChild(controlElement);
      chromaticCount += 1;
    } else {
      const section = fieldSectionByKey.get(control.key) ?? "shape";
      counts[section] += 1;
      if (section === "essential") essentialFragment.appendChild(controlElement);
      else if (section === "motion") motionFragment.appendChild(controlElement);
      else if (section === "appearance") appearanceFragment.appendChild(controlElement);
      else if (section === "advanced") advancedFragment.appendChild(controlElement);
      else shapeFragment.appendChild(controlElement);
    }
  }

  essentialControls.replaceChildren(essentialFragment);
  motionControls.replaceChildren(motionFragment);
  shapeControls.replaceChildren(shapeFragment);
  advancedControls.replaceChildren(advancedFragment);
  cameraControls.replaceChildren(cameraFragment);
  appearanceControls.replaceChildren(appearanceFragment);
  gradientControls.replaceChildren();
  chromaticControls.replaceChildren(chromaticFragment);
  advancedControlCount.textContent = String(counts.advanced);
  inspectorAdvanced.hidden = counts.advanced === 0;
  if (counts.advanced === 0) inspectorAdvanced.open = false;
  counts.appearance = Math.max(1, counts.appearance + gradientCount + chromaticCount);
  syncInspectorNavigation(project.id, counts);

  const cameraEnabled = cameraCount > 0;
  openCameraDialogButton.hidden = !cameraEnabled;
  openCameraFromSidebarButton.hidden = !cameraEnabled;
  if (!cameraEnabled) cameraDialog.close();
  gradientEditor.hidden = true;
  chromaticEditor.hidden = chromaticCount === 0;
  renderCameraSets(project);
  renderMotionSets(project);
}

function setCameraSetError(message = ""): void {
  cameraSetError.textContent = message;
  cameraSetError.hidden = !message;
}

interface MobiusCameraSet {
  id: string;
  name: string;
  scope: "system" | "shared" | "project";
  projectId?: string;
  parameters: Record<string, number>;
  view: EngineState["view"];
}

function availableCameraSets(projectId: string): MobiusCameraSet[] {
  return listCameraSets(projectId).filter(Boolean) as unknown as MobiusCameraSet[];
}

function renderCameraSets(project = getProject(state.projectId)): void {
  if (project.id !== "mobius-flow-1-1") {
    cameraSetSelect.replaceChildren(makeOption("", "No disponible"));
    cameraSetSelect.disabled = true;
    applyCameraSetButton.disabled = true;
    deleteCameraSetButton.disabled = true;
    saveSharedCameraSetButton.disabled = true;
    saveProjectCameraSetButton.disabled = true;
    return;
  }

  const groups = new Map<string, HTMLOptGroupElement>();
  const labels = { system: "Sistema", shared: "Compartidos", project: "Este proyecto" };
  const sets = availableCameraSets(project.id);
  cameraSetSelect.replaceChildren(makeOption("", "Selecciona una vista"));
  for (const set of sets) {
    const groupKey = set.scope;
    let group = groups.get(groupKey);
    if (!group) {
      group = document.createElement("optgroup");
      group.label = labels[groupKey] ?? groupKey;
      groups.set(groupKey, group);
      cameraSetSelect.appendChild(group);
    }
    const option = makeOption(set.id, set.name);
    option.dataset.scope = set.scope;
    group.appendChild(option);
  }
  cameraSetSelect.disabled = sets.length === 0;
  applyCameraSetButton.disabled = cameraSetSelect.value === "";
  const selected = sets.find((set) => set.id === cameraSetSelect.value);
  deleteCameraSetButton.disabled = !selected || selected.scope === "system";
  saveSharedCameraSetButton.disabled = false;
  saveProjectCameraSetButton.disabled = false;
}

function currentCameraSetState(project = getProject(state.projectId)) {
  const parameters = Object.fromEntries(project.controls
    .filter((control) => control.group === "camera")
    .map((control) => [control.key, state.parameters[control.key] ?? control.defaultValue]));
  return { parameters, view: structuredClone(state.view) };
}

function applyCameraSetById(setId: string): void {
  const project = getProject(state.projectId);
  const set = availableCameraSets(project.id).find((candidate) => candidate.id === setId);
  if (!set) return;
  const parameters = { ...state.parameters };
  for (const control of project.controls.filter((candidate) => candidate.group === "camera")) {
    const supplied = set.parameters[control.key];
    if (typeof supplied === "number" && Number.isFinite(supplied)) {
      parameters[control.key] = clamp(supplied, control.min, control.max);
    }
  }
  recordHistory(`Aplicar vista “${set.name}”`);
  state = {
    ...state,
    parameters,
    view: normalizeView(set.view)
  };
  projectParameters.set(project.id, { ...parameters });
  projectViews.set(project.id, { ...state.view });
  renderProjectControls(project);
  updateStaticUi();
  postState();
  appStatus.textContent = `Vista “${set.name}” aplicada.`;
}

interface MobiusMotionSet {
  id: string;
  name: string;
  scope: "system" | "shared" | "project";
  projectId?: string;
  parameters: Record<string, number>;
}

function availableMotionSets(projectId: string): MobiusMotionSet[] {
  return listMotionSets(projectId).filter(Boolean) as unknown as MobiusMotionSet[];
}

function setMotionSetError(message = ""): void {
  motionSetError.textContent = message;
  motionSetError.hidden = !message;
}

function renderMotionSets(project = getProject(state.projectId)): void {
  const enabled = project.id === "mobius-flow-1-1";
  motionSetSection.hidden = !enabled;
  openMotionSetsDialogButton.hidden = !enabled;
  if (!enabled) {
    if (motionSetsDialog.open) motionSetsDialog.close();
    return;
  }

  const labels = { system: "Sistema", shared: "Compartidos", project: "Este proyecto" };
  const groups = new Map<string, HTMLOptGroupElement>();
  const sets = availableMotionSets(project.id);
  motionSetSelect.replaceChildren(makeOption("", "Selecciona un movimiento"));
  for (const set of sets) {
    let group = groups.get(set.scope);
    if (!group) {
      group = document.createElement("optgroup");
      group.label = labels[set.scope];
      groups.set(set.scope, group);
      motionSetSelect.appendChild(group);
    }
    group.appendChild(makeOption(set.id, set.name));
  }
  motionSetSelect.disabled = sets.length === 0;
  applyMotionSetButton.disabled = !motionSetSelect.value;
  const selected = sets.find((set) => set.id === motionSetSelect.value);
  deleteMotionSetButton.disabled = !selected || selected.scope === "system";
  saveSharedMotionSetButton.disabled = false;
  saveProjectMotionSetButton.disabled = false;
}

const MOBIUS_MOTION_PARAMETER_KEYS = [
  "motionMode",
  "motionAmount",
  "motionSpeed",
  "circulation",
  "breathing",
  "precession"
];

function applyMotionSetById(setId: string): void {
  const project = getProject(state.projectId);
  const set = availableMotionSets(project.id).find((candidate) => candidate.id === setId);
  if (!set) return;
  const parameters = { ...state.parameters };
  for (const key of MOBIUS_MOTION_PARAMETER_KEYS) {
    const control = project.controls.find((candidate) => candidate.key === key);
    const supplied = set.parameters[key];
    if (control && typeof supplied === "number" && Number.isFinite(supplied)) {
      parameters[key] = clamp(supplied, control.min, control.max);
    }
  }
  recordHistory(`Aplicar movimiento “${set.name}”`);
  state = { ...state, parameters };
  projectParameters.set(project.id, { ...parameters });
  renderProjectControls(project);
  postState();
  appStatus.textContent = `Movimiento “${set.name}” aplicado.`;
}

function updatePlaybackButton(): void {
  const action = state.playback.playing ? "Pausar" : "Reproducir";
  playButton.dataset.playbackState = state.playback.playing ? "playing" : "paused";
  playButton.setAttribute("aria-label", action);
  playButton.title = action;
  playButton.setAttribute("aria-pressed", String(state.playback.playing));
}

function formulaUsesDefaults(project: ProjectDefinition): boolean {
  return project.controls.filter((control) => (
    !control.hidden &&
    (!control.timeMode || control.timeMode === state.playback.mode) &&
    (!control.visibleWhen || state.parameters[control.visibleWhen.key] === control.visibleWhen.equals) &&
    control.group !== "appearance" &&
    control.group !== "gradient" &&
    control.group !== "color3d" &&
    control.group !== "camera"
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
  currentElapsedTime = currentTime * state.playback.loopSeconds;
  timelineInput.value = String(currentTime);
  timelineValue.value = `${Math.round(currentTime * 100)}%`;
  post({ type: "seek", time: currentTime });
  scheduleVectorExportPreview();
}

function updateLoopStartControl(project: ProjectDefinition): void {
  const supported = projectSupportsLoopStart(project) && state.playback.mode === "loop";
  const phase = loopPhase();
  loopStartControl.hidden = !supported;
  timelineLoopMarker.hidden = !supported;
  timelineLoopMarker.style.left = `clamp(8px, ${phase * 100}%, calc(100% - 8px))`;
  loopStartValue.value = `${(phase * 100).toFixed(1)}%`;
  setLoopStartButton.disabled = !supported;
  resetLoopStartButton.disabled = !supported || phase < 0.0005;
}

function vectorAdd(left: Vector3Value, right: Vector3Value): Vector3Value {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function vectorSubtract(left: Vector3Value, right: Vector3Value): Vector3Value {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function vectorScale(vector: Vector3Value, scale: number): Vector3Value {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

function vectorDot(left: Vector3Value, right: Vector3Value): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function vectorCross(left: Vector3Value, right: Vector3Value): Vector3Value {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x
  };
}

function vectorNormalize(vector: Vector3Value): Vector3Value {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 0.000001
    ? vectorScale(vector, 1 / length)
    : { x: 0, y: 0, z: 0 };
}

function lightParameterValue(key: string, fallback: number): number {
  const value = state.parameters[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function currentLightingRig(): LightingRigState | null {
  return state.lighting ?? null;
}

function selectedSpatialLight(): SpatialLightState | null {
  const rig = currentLightingRig();
  if (!rig) return null;
  return rig.lights.find((light) => light.id === selectedLightId) ?? rig.lights[0] ?? null;
}

function commitLightingRig(rig: LightingRigState, refreshList = false): void {
  state = { ...state, lighting: rig };
  projectLighting.set(state.projectId, cloneLightingRig(rig));
  scheduleViewState();
  if (refreshList) renderLightList();
  scheduleLightGizmoUpdate();
}

function updateSelectedLight(
  update: Partial<SpatialLightState>,
  refreshList = false
): void {
  const rig = cloneLightingRig(currentLightingRig());
  if (!rig) return;
  const index = rig.lights.findIndex((light) => light.id === selectedLightId);
  if (index < 0) return;
  rig.lights[index] = { ...rig.lights[index]!, ...update };
  commitLightingRig(rig, refreshList);
}

function updateLightById(
  lightId: string,
  update: Partial<SpatialLightState>,
  refreshList = false
): void {
  const rig = cloneLightingRig(currentLightingRig());
  if (!rig) return;
  const index = rig.lights.findIndex((light) => light.id === lightId);
  if (index < 0) return;
  rig.lights[index] = { ...rig.lights[index]!, ...update };
  commitLightingRig(rig, refreshList);
}

function spatialLightPoint(handle: SpatialLightHandle): Vector3Value {
  const light = selectedSpatialLight();
  const point = handle === "source" ? light?.position : light?.target;
  return point ? { ...point } : { x: 0, y: 0, z: 0 };
}

function setSpatialLightPoint(handle: SpatialLightHandle, point: Vector3Value): void {
  const minimum = handle === "source" ? -4 : -3;
  const maximum = handle === "source" ? 4 : 3;
  updateSelectedLight({
    [handle === "source" ? "position" : "target"]: {
      x: clamp(point.x, minimum, maximum),
      y: clamp(point.y, minimum, maximum),
      z: clamp(point.z, minimum, maximum)
    }
  });
}

function setSpatialLightNumber(key: "intensity" | "distance" | "angle" | "penumbra" | "width" | "height", value: number): void {
  const ranges: Record<typeof key, [number, number]> = {
    intensity: [0, 24],
    distance: [0.1, 30],
    angle: [5, 89],
    penumbra: [0, 1],
    width: [0.1, 8],
    height: [0.1, 8]
  };
  const [minimum, maximum] = ranges[key];
  updateSelectedLight({ [key]: clamp(value, minimum, maximum) });
}

function createSpatialProjection(): SpatialProjection | null {
  if (getProject(state.projectId).spatialLightControls !== true) return null;
  const bounds = canvasStage.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const format = getOutputFormat(state.formatKey);
  const margin = Math.min(40, width * 0.055, height * 0.055);
  const scale = Math.max(0.0001, Math.min(
    (width - margin * 2) / format.width,
    (height - margin * 2) / format.height
  ));
  const contentWidth = format.width * scale;
  const contentHeight = format.height * scale;
  const aspect = format.width / format.height;
  const yaw = state.view.orbitYaw * Math.PI / 180;
  const pitch = state.view.orbitPitch * Math.PI / 180;
  const zoom = clamp(state.view.zoom, 0.35, 4);
  const formatDistance = aspect < 1 ? Math.pow(1 / aspect, 0.1) : Math.pow(aspect, -0.025);
  const distance = lightParameterValue("cameraDistance", 1.2) * formatDistance / zoom;
  const cameraTarget = {
    x: -state.view.panX * 0.8,
    y: 0.5 + state.view.panY * 0.8,
    z: 0.2
  };
  const cosinePitch = Math.cos(pitch);
  const camera = {
    x: cameraTarget.x + Math.sin(yaw) * cosinePitch * distance,
    y: cameraTarget.y + Math.sin(pitch) * distance,
    z: cameraTarget.z - Math.cos(yaw) * cosinePitch * distance
  };
  const forward = vectorNormalize(vectorSubtract(cameraTarget, camera));
  const right = vectorNormalize(vectorCross(forward, { x: 0, y: 1, z: 0 }));
  const up = vectorNormalize(vectorCross(right, forward));
  return {
    contentWidth,
    contentHeight,
    contentX: (width - contentWidth) * 0.5,
    contentY: (height - contentHeight) * 0.5,
    aspect,
    tangent: Math.tan(lightParameterValue("fov", 60) * Math.PI / 360),
    camera,
    forward,
    right,
    up
  };
}

function projectSpatialPoint(
  point: Vector3Value,
  projection: SpatialProjection
): { x: number; y: number; depth: number } | null {
  const delta = vectorSubtract(point, projection.camera);
  const depth = vectorDot(delta, projection.forward);
  if (depth <= 0.01) return null;
  const horizontal = depth * projection.tangent * projection.aspect;
  const vertical = depth * projection.tangent;
  if (horizontal <= 0 || vertical <= 0) return null;
  const normalizedX = vectorDot(delta, projection.right) / horizontal;
  const normalizedY = vectorDot(delta, projection.up) / vertical;
  return {
    x: projection.contentX + (normalizedX * 0.5 + 0.5) * projection.contentWidth,
    y: projection.contentY + (0.5 - normalizedY * 0.5) * projection.contentHeight,
    depth
  };
}

function lightTypeLabel(type: SpatialLightType): string {
  if (type === "point") return "Puntual";
  if (type === "directional") return "Direccional";
  if (type === "rect-area") return "Área rectangular";
  return "Focal";
}

function lightUsesDefaults(project = getProject(state.projectId)): boolean {
  return JSON.stringify(normalizeLightingRig(state.lighting, project.defaultLighting)) ===
    JSON.stringify(normalizeLightingRig(project.defaultLighting, project.defaultLighting));
}

function updateLightingPresetDescription(project = getProject(state.projectId)): void {
  const preset = project.lightingPresets?.find((candidate) => candidate.key === lightPresetSelect.value);
  lightPresetDescription.textContent = preset?.description ?? "";
  lightPresetDescription.hidden = !preset?.description;
}

function renderLightingPresets(project = getProject(state.projectId)): void {
  const presets = project.lightingPresets ?? [];
  lightPresetControl.hidden = presets.length === 0;
  lightApplyPresetButton.disabled = presets.length === 0;
  if (presets.length === 0) {
    lightPresetSelect.replaceChildren();
    lightPresetDescription.hidden = true;
    return;
  }
  const previous = lightPresetSelect.value;
  lightPresetSelect.replaceChildren(...presets.map((preset) => makeOption(preset.key, preset.label)));
  lightPresetSelect.value = presets.some((preset) => preset.key === previous)
    ? previous
    : presets[0]!.key;
  updateLightingPresetDescription(project);
}

function renderLightList(): void {
  const rig = currentLightingRig();
  const lights = rig?.lights ?? [];
  if (lights.length > 0 && !lights.some((light) => light.id === selectedLightId)) {
    selectedLightId = lights[0]!.id;
  }
  const shadowCost = lights.reduce((total, light) => (
    total + (light.enabled && light.castShadow && light.type !== "rect-area"
      ? light.type === "point" ? 6 : 1
      : 0)
  ), 0);
  lightCountValue.value = `${lights.length} / ${MAX_SPATIAL_LIGHTS} · shadow ${shadowCost}×`;
  lightAddButton.disabled = lights.length >= MAX_SPATIAL_LIGHTS;
  lightEmptyState.hidden = lights.length > 0;
  const items = lights.map((light) => {
    const item = document.createElement("div");
    item.className = "light-list-item";
    item.setAttribute("role", "listitem");
    item.classList.toggle("is-selected", light.id === selectedLightId);

    const select = document.createElement("button");
    select.type = "button";
    select.className = "light-list-select";
    select.setAttribute("aria-pressed", String(light.id === selectedLightId));
    select.setAttribute("aria-label", `Editar ${light.name}, ${lightTypeLabel(light.type)}`);
    const name = document.createElement("strong");
    name.textContent = light.name;
    const type = document.createElement("small");
    type.textContent = lightTypeLabel(light.type);
    select.append(name, type);
    select.addEventListener("click", () => {
      selectedLightId = light.id;
      renderLightList();
      syncLightEditorControls();
      scheduleLightGizmoUpdate();
    });

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "light-list-toggle";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = light.enabled;
    toggle.setAttribute("aria-label", `${light.enabled ? "Desactivar" : "Activar"} ${light.name}`);
    toggle.addEventListener("change", () => {
      recordHistory(toggle.checked ? `Activar ${light.name}` : `Desactivar ${light.name}`);
      updateLightById(light.id, { enabled: toggle.checked }, true);
      syncLightEditorControls();
    });
    const indicator = document.createElement("span");
    indicator.setAttribute("aria-hidden", "true");
    toggleLabel.append(toggle, indicator);
    item.append(select, toggleLabel);
    return item;
  });
  lightList.replaceChildren(...items);
}

function syncLightEditorControls(): void {
  const rig = currentLightingRig();
  const light = selectedSpatialLight();
  lightInspector.hidden = !light;
  lightResetButton.disabled = lightUsesDefaults();
  if (rig) {
    lightEnvironmentEnabledInput.checked = rig.environment.enabled;
    lightEnvironmentIntensityInput.value = String(rig.environment.intensity);
    lightEnvironmentIntensityValue.value = rig.environment.intensity.toFixed(2);
    lightEnvironmentRotationInput.value = String(rig.environment.rotation);
    lightEnvironmentRotationValue.value = `${rig.environment.rotation.toFixed(1)}°`;
    lightAmbientTypeInput.value = rig.ambient.enabled ? rig.ambient.type : "none";
    lightAmbientIntensityInput.value = String(rig.ambient.intensity);
    lightAmbientIntensityValue.value = rig.ambient.intensity.toFixed(2);
    lightAmbientColorInput.value = rig.ambient.color;
    lightGroundColorInput.value = rig.ambient.groundColor;
    const ambientVisible = rig.ambient.enabled && rig.ambient.type !== "none";
    lightAmbientIntensityControl.hidden = !ambientVisible;
    lightAmbientColors.hidden = !ambientVisible;
    lightGroundColorControl.hidden = rig.ambient.type !== "hemisphere";
  }
  if (!light) return;
  lightDuplicateButton.disabled = (rig?.lights.length ?? 0) >= MAX_SPATIAL_LIGHTS;
  lightInspectorTitle.textContent = light.name;
  lightSelectedType.textContent = lightTypeLabel(light.type);
  lightEnabledInput.checked = light.enabled;
  lightNameInput.value = light.name;
  lightTypeInput.value = light.type;
  lightColorSourceInput.value = light.colorSource;
  lightColorInput.value = light.color;
  lightColorInput.disabled = light.colorSource !== "custom";
  lightIntensityInput.value = String(light.intensity);
  lightIntensityValue.value = light.intensity.toFixed(1);
  lightDistanceInput.value = String(light.distance);
  lightDistanceValue.value = light.distance.toFixed(1);
  lightAngleInput.value = String(light.angle);
  lightAngleValue.value = `${light.angle.toFixed(1)}°`;
  lightPenumbraInput.value = String(light.penumbra);
  lightPenumbraValue.value = light.penumbra.toFixed(2);
  lightAreaWidthInput.value = String(light.width);
  lightAreaWidthValue.value = light.width.toFixed(1);
  lightAreaHeightInput.value = String(light.height);
  lightAreaHeightValue.value = light.height.toFixed(1);
  lightDistanceControl.hidden = light.type !== "spot" && light.type !== "point";
  lightAngleControl.hidden = light.type !== "spot";
  lightPenumbraControl.hidden = light.type !== "spot";
  lightAreaControls.hidden = light.type !== "rect-area";
  const supportsShadow = light.type !== "rect-area";
  lightShadowsInput.disabled = !supportsShadow;
  lightShadowsInput.checked = supportsShadow && light.castShadow;
  lightShadowCost.textContent = light.type === "point"
    ? "Coste 6×"
    : light.type === "rect-area"
      ? "Sin sombras"
      : "Coste 1×";
  lightSoloInput.checked = light.solo;
  lightPositionValue.value = `${light.position.x.toFixed(2)} · ${light.position.y.toFixed(2)} · ${light.position.z.toFixed(2)}`;
}

function updateLightGizmo(): void {
  if (lightEditor.hidden) return;
  syncLightEditorControls();
  const light = selectedSpatialLight();
  const projection = createSpatialProjection();
  if (!projection || !light) {
    lightSourceHandle.hidden = true;
    lightTargetHandle.hidden = true;
    lightGizmoRay.style.visibility = "hidden";
    return;
  }
  const sourcePoint = spatialLightPoint("source");
  const targetPoint = spatialLightPoint("target");
  const source = projectSpatialPoint(sourcePoint, projection);
  const usesTarget = light.type !== "point";
  const target = usesTarget ? projectSpatialPoint(targetPoint, projection) : null;
  lightSourceHandle.hidden = !source;
  lightTargetHandle.hidden = !target;
  lightGizmoRay.style.visibility = source && target ? "visible" : "hidden";
  if (source) {
    const inset = 22;
    const visibleSource = {
      x: clamp(source.x, projection.contentX + inset, projection.contentX + projection.contentWidth - inset),
      y: clamp(source.y, projection.contentY + inset, projection.contentY + projection.contentHeight - inset)
    };
    const sourceIsOffscreen = visibleSource.x !== source.x || visibleSource.y !== source.y;
    lightSourceHandle.classList.toggle("is-offscreen", sourceIsOffscreen);
    lightSourceHandle.style.setProperty("--light-handle-x", `${visibleSource.x}px`);
    lightSourceHandle.style.setProperty("--light-handle-y", `${visibleSource.y}px`);
    lightSourceHandle.setAttribute(
      "aria-label",
      `Mover ${light.name}${sourceIsOffscreen ? ", fuera del encuadre" : ""}. Posición ${sourcePoint.x.toFixed(2)}, ${sourcePoint.y.toFixed(2)}, ${sourcePoint.z.toFixed(2)}`
    );
    lightSourceHandle.title = sourceIsOffscreen
      ? "Luz fuera del encuadre · Arrastra para acercarla · Alt cambia profundidad"
      : "Arrastra para mover · Opción/Alt arrastra en profundidad";
    source.x = visibleSource.x;
    source.y = visibleSource.y;
  }
  if (target) {
    lightTargetHandle.style.setProperty("--light-handle-x", `${target.x}px`);
    lightTargetHandle.style.setProperty("--light-handle-y", `${target.y}px`);
    lightTargetHandle.setAttribute(
      "aria-label",
      `Mover objetivo de ${light.name}. Posición ${targetPoint.x.toFixed(2)}, ${targetPoint.y.toFixed(2)}, ${targetPoint.z.toFixed(2)}`
    );
  }
  if (source && target) {
    lightGizmoRay.setAttribute("x1", String(source.x));
    lightGizmoRay.setAttribute("y1", String(source.y));
    lightGizmoRay.setAttribute("x2", String(target.x));
    lightGizmoRay.setAttribute("y2", String(target.y));
  }
}

function scheduleLightGizmoUpdate(): void {
  if (lightGizmoFrame) return;
  lightGizmoFrame = window.requestAnimationFrame(() => {
    lightGizmoFrame = 0;
    updateLightGizmo();
  });
}

function updateViewportHud(project = getProject(state.projectId)): void {
  const enabled = project.viewControls === true;
  const supportsLight = project.spatialLightControls === true;
  if (!supportsLight && viewMode === "light") viewMode = "orbit";
  viewportHud.hidden = !enabled;
  viewportLightButton.hidden = !supportsLight;
  lightEditor.hidden = !enabled || !supportsLight || viewMode !== "light";
  canvasStage.classList.toggle("is-view-interactive", enabled);
  canvasStage.classList.toggle("is-light-editing", !lightEditor.hidden);
  canvasStage.tabIndex = enabled ? 0 : -1;
  canvasStage.setAttribute(
    "aria-label",
    enabled
      ? viewMode === "light"
        ? `Vista interactiva de ${project.name}. Arrastra los controles para mover la luz o su objetivo.`
        : `Vista interactiva de ${project.name}. Arrastra para orbitar, usa Mayús para mover y la rueda para zoom.`
      : `Vista de ${project.name}.`
  );
  if (!enabled) return;
  viewportOrbitButton.setAttribute("aria-pressed", String(viewMode === "orbit"));
  viewportPanButton.setAttribute("aria-pressed", String(viewMode === "pan"));
  viewportLightButton.setAttribute("aria-pressed", String(viewMode === "light"));
  viewportResetButton.disabled = viewUsesDefaults(state.view);
  viewportZoomInput.value = String(Math.round(state.view.zoom * 100));
  if (!lightEditor.hidden) {
    const lights = currentLightingRig()?.lights ?? [];
    if (!lights.some((light) => light.id === selectedLightId)) renderLightList();
    syncLightEditorControls();
    scheduleLightGizmoUpdate();
  }
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
  scheduleVectorExportPreview();
  if (status) appStatus.textContent = status;
}

function setViewMode(mode: ViewMode): void {
  if (mode === "light" && getProject(state.projectId).spatialLightControls !== true) return;
  viewMode = mode;
  updateViewportHud();
  appStatus.textContent = mode === "orbit"
    ? "Vista: arrastra para orbitar."
    : mode === "pan"
      ? "Vista: arrastra para mover el encuadre."
      : "Luz: arrastra el foco o su objetivo dentro del espacio.";
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

function updateGradientStop(
  index: number,
  patch: Partial<AppearanceGradientStop>,
  status = "Gradiente actualizado."
): void {
  const appearance = currentAppearance();
  if (appearance.paint.type !== "gradient") return;
  const stops = appearance.paint.stops.map((stop, stopIndex) => (
    stopIndex === index ? { ...stop, ...patch } : { ...stop }
  ));
  if (index > 0 && index < stops.length - 1 && patch.position !== undefined) {
    stops[index]!.position = clamp(
      patch.position,
      stops[index - 1]!.position + 0.01,
      stops[index + 1]!.position - 0.01
    );
  }
  applyAppearance({
    ...appearance,
    paint: { ...appearance.paint, stops }
  }, status);
}

function removeGradientStop(index: number): void {
  const appearance = currentAppearance();
  if (appearance.paint.type !== "gradient" || appearance.paint.stops.length <= 2) return;
  const stops = appearance.paint.stops
    .filter((_, stopIndex) => stopIndex !== index)
    .map((stop) => ({ ...stop }));
  stops[0]!.position = 0;
  stops[stops.length - 1]!.position = 1;
  recordHistory("Quitar color del gradiente");
  applyAppearance({ ...appearance, paint: { ...appearance.paint, stops } }, "Color eliminado del gradiente.");
}

function createGradientStopRow(index: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "gradient-stop-row";
  row.dataset.stopIndex = String(index);

  const swatch = document.createElement("input");
  swatch.type = "color";
  swatch.className = "gradient-stop-color";
  swatch.setAttribute("aria-label", `Color ${index + 1} del gradiente`);
  const hex = document.createElement("input");
  hex.type = "text";
  hex.className = "color-hex-input gradient-stop-hex";
  hex.maxLength = 7;
  hex.spellcheck = false;
  hex.setAttribute("aria-label", `Hexadecimal del color ${index + 1}`);
  const position = document.createElement("input");
  position.type = "range";
  position.className = "gradient-stop-position";
  position.min = "0";
  position.max = "1";
  position.step = "0.01";
  position.setAttribute("aria-label", `Posición del color ${index + 1}`);
  const output = document.createElement("output");
  output.className = "gradient-stop-output";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "button button-quiet button-compact compact-icon-button gradient-stop-remove";
  remove.setAttribute("aria-label", `Quitar color ${index + 1}`);
  remove.title = "Quitar color";
  remove.innerHTML = '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';

  const historyKey = `appearance:gradient-stop:${index}`;
  swatch.addEventListener("input", () => {
    beginHistoryInteraction(historyKey, "Cambiar color del gradiente");
    updateGradientStop(index, { color: swatch.value.toLowerCase() });
  });
  const finishColor = () => endHistoryInteraction(historyKey);
  swatch.addEventListener("change", finishColor);
  swatch.addEventListener("blur", finishColor);
  hex.addEventListener("change", () => {
    const value = hex.value.trim();
    if (!/^#[0-9a-f]{6}$/i.test(value)) {
      hex.setAttribute("aria-invalid", "true");
      setColorError("Usa un hexadecimal de seis cifras, por ejemplo #8ECFC2.");
      return;
    }
    recordHistory("Cambiar color del gradiente");
    hex.removeAttribute("aria-invalid");
    updateGradientStop(index, { color: value.toLowerCase() });
  });
  position.addEventListener("input", () => {
    beginHistoryInteraction(`${historyKey}:position`, "Mover color del gradiente");
    updateGradientStop(index, { position: position.valueAsNumber });
  });
  const finishPosition = () => endHistoryInteraction(`${historyKey}:position`);
  position.addEventListener("change", finishPosition);
  position.addEventListener("blur", finishPosition);
  remove.addEventListener("click", () => removeGradientStop(index));
  row.append(swatch, hex, position, output, remove);
  return row;
}

function syncGradientStopList(appearance: AppearanceStyle): void {
  if (appearance.paint.type !== "gradient") {
    gradientStopList.replaceChildren();
    return;
  }
  const stops = appearance.paint.stops;
  if (gradientStopList.children.length !== stops.length) {
    gradientStopList.replaceChildren(...stops.map((_, index) => createGradientStopRow(index)));
  }
  Array.from(gradientStopList.children).forEach((element, index) => {
    const row = element as HTMLElement;
    const stop = stops[index]!;
    const swatch = row.querySelector<HTMLInputElement>(".gradient-stop-color")!;
    const hex = row.querySelector<HTMLInputElement>(".gradient-stop-hex")!;
    const position = row.querySelector<HTMLInputElement>(".gradient-stop-position")!;
    const output = row.querySelector<HTMLOutputElement>(".gradient-stop-output")!;
    const remove = row.querySelector<HTMLButtonElement>(".gradient-stop-remove")!;
    swatch.value = stop.color;
    if (document.activeElement !== hex) hex.value = stop.color.toUpperCase();
    position.value = String(stop.position);
    position.disabled = index === 0 || index === stops.length - 1;
    output.value = `${Math.round(stop.position * 100)}%`;
    remove.disabled = stops.length <= 2;
  });
  addGradientStopButton.disabled = stops.length >= 4;
}

function syncAppearanceEditor(): void {
  const appearance = currentAppearance();
  const project = getProject(state.projectId);
  const mappings = projectAppearanceMappings(project);
  const mappingLabels = { screen: "Lienzo", surface: "Superficie" } as const;
  const currentOptions = Array.from(appearanceGradientMapping.options).map((option) => option.value);
  if (currentOptions.join(",") !== mappings.join(",")) {
    appearanceGradientMapping.replaceChildren(...mappings.map((mapping) => (
      makeOption(mapping, mappingLabels[mapping])
    )));
  }
  appearanceGradientMappingControl.hidden = mappings.length < 2;
  const materialCapabilities = project.appearanceCapabilities?.materials ?? (
    project.backend === "three" || project.backend === "webgpu"
      ? ["matte", "satin", "metal", "glass"]
      : []
  );
  appearanceMaterialSection.hidden = materialCapabilities.length === 0;
  const gradient = appearance.paint.type === "gradient";
  if (appearance.paint.type === "gradient") {
    rememberedGradientPaint = structuredClone(appearance.paint);
  }
  for (const input of appearancePaintModeInputs) input.checked = input.value === appearance.paint.type;
  solidPaintEditor.hidden = gradient;
  gradientPaintEditor.hidden = !gradient;
  backgroundColor.value = appearance.background.color;
  backgroundColorValue.value = appearance.background.color.toUpperCase();
  const surfaceColor = appearance.paint.type === "gradient"
    ? appearance.paint.stops[0]!.color
    : appearance.paint.color;
  foregroundColor.value = surfaceColor;
  foregroundColorValue.value = surfaceColor.toUpperCase();
  palettePreview.style.backgroundColor = appearance.background.color;
  palettePreview.style.backgroundImage = appearancePreviewBackground(appearance);
  gradientPreview.style.backgroundColor = appearance.background.color;
  gradientPreview.style.backgroundImage = appearancePreviewBackground(appearance);
  if (appearance.paint.type === "gradient") {
    appearanceGradientAngle.value = String(appearance.paint.angle);
    appearanceGradientMapping.value = appearance.paint.mapping;
  }
  syncGradientStopList(appearance);

  appearanceMaterialPreset.value = appearance.material.preset;
  appearanceRoughness.value = String(appearance.material.roughness);
  appearanceRoughnessValue.value = appearance.material.roughness.toFixed(2);
  appearanceMetalness.value = String(appearance.material.metalness);
  appearanceMetalnessValue.value = appearance.material.metalness.toFixed(2);
  appearanceClearcoat.value = String(appearance.material.clearcoat);
  appearanceClearcoatValue.value = appearance.material.clearcoat.toFixed(2);

  const textureEnabled = appearance.texture.type === "procedural";
  appearanceTexturePreset.value = appearance.texture.type === "procedural"
    ? appearance.texture.preset
    : "none";
  appearanceTextureControls.hidden = !textureEnabled;
  const texture = appearance.texture.type === "procedural"
    ? appearance.texture
    : { type: "procedural" as const, preset: "flow" as const, scale: 4, strength: 0.5, motion: 1 };
  appearanceTextureScale.value = String(texture.scale);
  appearanceTextureScaleValue.value = texture.scale.toFixed(1);
  appearanceTextureStrength.value = String(texture.strength);
  appearanceTextureStrengthValue.value = texture.strength.toFixed(2);
  appearanceTextureMotion.value = String(texture.motion);
  appearanceTextureMotionValue.value = texture.motion.toFixed(1);
}

function updateStaticUi(): void {
  const project = getProject(state.projectId);
  seedInput.value = String(state.seed);
  projectSelect.value = state.projectId;
  formatSelect.value = state.formatKey;
  syncAppearanceEditor();
  const gradient = currentGradientSettings(project);
  updateSavedColorPreview(currentColorPreview, {
    schemaVersion: 2,
    id: "current",
    name: "Actual",
    createdAt: "",
    updatedAt: "",
    palette: state.palette,
    gradient,
    appearance: state.appearance ?? appearanceFromLegacy(state.palette, state.parameters)
  });
  speedInput.value = state.playback.speed.toFixed(2);
  durationInput.value = state.playback.loopSeconds.toFixed(1);
  const supportsContinuousTime = project.supportsContinuousTime === true;
  const supportsLoopTime = project.supportsLoopTime !== false;
  const usesUnboundedPreviewTime = project.supportsUnboundedPreviewTime === true;
  timeModeControl.hidden = !(supportsContinuousTime && supportsLoopTime);
  playbackModeSelect.value = supportsLoopTime ? state.playback.mode : "continuous";
  durationLabel.textContent = usesUnboundedPreviewTime ? "Exportación" : "Duración";
  durationInput.setAttribute(
    "aria-label",
    usesUnboundedPreviewTime
      ? "Duración de exportación"
      : state.playback.mode === "continuous" ? "Duración del clip" : "Duración del bucle"
  );
  const durationAction = usesUnboundedPreviewTime ? "duración de exportación" : "duración";
  durationDecreaseButton.setAttribute("aria-label", `Reducir ${durationAction}`);
  durationDecreaseButton.title = `Reducir ${durationAction}`;
  durationIncreaseButton.setAttribute("aria-label", `Aumentar ${durationAction}`);
  durationIncreaseButton.title = `Aumentar ${durationAction}`;
  resetFormulaButton.disabled = formulaUsesDefaults(project);
  renderLightingPresets(project);
  updateImageSourceUi();
  updateLoopStartControl(project);
  const usesWebGlCanvas = project.backend === "three";
  const usesWebGpuCanvas = project.backend === "webgpu";
  const usesCanvas2d = !usesWebGlCanvas && !usesWebGpuCanvas;
  canvas.classList.toggle("is-active", usesCanvas2d);
  threeCanvas.classList.toggle("is-active", usesWebGlCanvas);
  webgpuCanvas.classList.toggle("is-active", usesWebGpuCanvas);
  canvas.setAttribute("aria-hidden", String(!usesCanvas2d || vectorExportPreviewEnabled));
  threeCanvas.setAttribute("aria-hidden", String(!usesWebGlCanvas || vectorExportPreviewEnabled));
  webgpuCanvas.setAttribute("aria-hidden", String(!usesWebGpuCanvas || vectorExportPreviewEnabled));
  previewModeSwitch.hidden = typeof project.toSvgColorMesh !== "function" ||
    project.exportCapabilities?.svg === false;
  playButton.disabled = vectorExportPreviewEnabled;
  updateViewportHud(project);
  updatePlaybackButton();
}

function changeProject(projectId: string): void {
  if (projectId === state.projectId) return;
  recordHistory("Cambiar proyecto");
  projectViews.set(state.projectId, { ...state.view });
  projectLighting.set(state.projectId, cloneLightingRig(state.lighting));
  projectPlaybackModes.set(state.projectId, state.playback.mode);
  const project = getProject(projectId);
  const appearance = appearanceForProject(project, currentAppearance());
  const parameters = parametersWithAppearance(
    project,
    projectParameters.get(project.id) ?? { ...project.defaults },
    appearance
  );
  const lighting = cloneLightingRig(
    projectLighting.get(project.id) ?? project.defaultLighting
  );
  const view = projectViews.get(project.id) ?? createDefaultView();
  const playbackMode = project.supportsLoopTime === false
    ? "continuous"
    : project.supportsContinuousTime
      ? projectPlaybackModes.get(project.id) ?? project.preferredPlaybackMode ?? "loop"
      : "loop";
  state = {
    ...state,
    projectId: project.id,
    formatKey: project.preferredFormatKey ?? state.formatKey,
    playback: {
      ...state.playback,
      loopSeconds: project.preferredLoopSeconds ?? state.playback.loopSeconds,
      mode: playbackMode
    },
    parameters: { ...parameters },
    appearance,
    palette: paletteFromAppearance(appearance),
    lighting,
    view: { ...view }
  };
  renderProjectControls(project);
  videoFpsSelect.value = String(project.preferredFps);
  appStatus.textContent = `${project.index} · ${project.name} cargado.`;
  postState();
  setTimelinePosition(0);
}

function setPlaying(playing: boolean): void {
  state = {
    ...state,
    playback: { ...state.playback, playing }
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
  currentElapsedTime = typeof record.elapsedTime === "number" && Number.isFinite(record.elapsedTime)
    ? Math.max(0, record.elapsedTime)
    : currentTime * state.playback.loopSeconds;
  projectParameters.set(state.projectId, { ...state.parameters });
  projectLighting.set(state.projectId, cloneLightingRig(state.lighting));
  projectViews.set(state.projectId, { ...state.view });
  projectPlaybackModes.set(state.projectId, state.playback.mode);
  const project = getProject(state.projectId);
  renderProjectControls(project);
  videoFpsSelect.value = String(project.preferredFps);
  updateStaticUi();
  if (project.spatialLightControls === true) {
    renderLightList();
    syncLightEditorControls();
  }
  post({ type: "state", state });
  post({ type: "seek", time: currentTime, elapsedTime: currentElapsedTime });
  timelineInput.value = String(currentTime);
  timelineValue.value = `${Math.round(currentTime * 100)}%`;
}

function applySavedColor(record: SavedColorRecord): void {
  const project = getProject(state.projectId);
  const includeBackground = appearanceApplyScope.value !== "surface";
  recordHistory(`Aplicar apariencia “${record.name}”`);
  applyAppearance(record.appearance, `Apariencia “${record.name}” aplicada.`, includeBackground);
  renderProjectControls(project);
}

function normalizeCompatibleState(candidate: EngineState): EngineState {
  const projectId = candidate.projectId === "flow-advection"
    ? "vector-currents"
    : candidate.projectId === "mobius-flow-vector"
      ? "mobius-flow"
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
    throw new Error("El preset contiene una apariencia de color no válida.");
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
  let parameters = Object.fromEntries(project.controls.map((control) => {
    const supplied = suppliedParameters[control.key];
    const value = typeof supplied === "number" && Number.isFinite(supplied)
      ? supplied
      : control.defaultValue;
    return [control.key, clamp(value, control.min, control.max)];
  }));
  const legacyPalette = {
    background: candidate.palette.background.toLowerCase(),
    foreground: candidate.palette.foreground.toLowerCase(),
    accent: accent.toLowerCase(),
    secondary: secondary.toLowerCase()
  };
  const appearance = appearanceForProject(
    project,
    normalizeAppearance(candidate.appearance, legacyPalette, parameters)
  );
  if (candidate.appearance) {
    const appearanceParameters = legacyParametersFromAppearance(appearance);
    parameters = Object.fromEntries(project.controls.map((control) => {
      const supplied = appearanceParameters[control.key];
      const current = parameters[control.key] ?? control.defaultValue;
      return [control.key, typeof supplied === "number"
        ? clamp(supplied, control.min, control.max)
        : current];
    }));
  }
  const playbackMode = project.supportsLoopTime === false
    ? "continuous"
    : candidate.playback.mode === "continuous" && project.supportsContinuousTime
      ? "continuous"
      : "loop";

  return {
    projectId: project.id,
    formatKey: candidate.formatKey,
    seed: Math.round(clamp(candidate.seed, 0, 4294967295)),
    palette: paletteFromAppearance(appearance),
    appearance,
    view: normalizeView(candidate.view),
    playback: {
      playing: candidate.playback.playing,
      speed: clamp(candidate.playback.speed, 0.25, 2),
      loopSeconds: clamp(candidate.playback.loopSeconds, 2, 20),
      mode: playbackMode
    },
    parameters,
    lighting: normalizeLightingRig(
      candidate.lighting,
      project.defaultLighting,
      candidate.parameters
    )
  };
}

worker.addEventListener("message", (event: MessageEvent<WorkerToMainMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "ready":
      workerReady = true;
      postImageField();
      canvasMessage.hidden = true;
      appStatus.textContent = "Motor listo.";
      break;
    case "frame":
      currentTime = message.time;
      currentElapsedTime = message.elapsedTime;
      if (!scrubbing) {
        timelineInput.value = String(message.time);
        timelineValue.value = `${Math.round(message.time * 100)}%`;
      }
      if (message.ended && state.playback.playing) {
        state = {
          ...state,
          playback: { ...state.playback, playing: false }
        };
        updatePlaybackButton();
        appStatus.textContent = "Reproducción continua finalizada.";
      }
      break;
    case "svg":
      downloadSvg(message.source, message.filename);
      appStatus.textContent = `${message.filename} exportado.`;
      svgExportStatus.textContent = `${message.filename} descargado.`;
      exportButton.disabled = false;
      exportColorMeshButton.disabled = false;
      break;
    case "diagnostics": {
      const request = diagnosticsRequests.get(message.requestId);
      if (!request) break;
      window.clearTimeout(request.timeout);
      diagnosticsRequests.delete(message.requestId);
      request.resolve(message.diagnostics);
      break;
    }
    case "error":
      canvasError.hidden = false;
      canvasError.textContent = message.message;
      canvasMessage.hidden = true;
      appStatus.textContent = "El motor ha encontrado un error.";
      svgExportStatus.textContent = message.message;
      exportButton.disabled = false;
      exportColorMeshButton.disabled = false;
      break;
  }
});

worker.addEventListener("error", (event) => {
  canvasError.hidden = false;
  canvasError.textContent = event.message || "No se pudo iniciar el worker gráfico.";
  canvasMessage.hidden = true;
  appStatus.textContent = "No se pudo iniciar el motor gráfico.";
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
  if (document.querySelector("dialog[open]:not(#color-dialog):not(#camera-dialog)")) return;
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

for (const input of inspectorSectionInputs) {
  input.addEventListener("change", () => {
    if (!input.checked || input.disabled) return;
    const section = input.value as InspectorPanelSection;
    for (const panel of inspectorPanels) panel.hidden = panel.dataset.inspectorPanel !== section;
    inspectorSectionByProject[state.projectId] = section;
    saveInspectorSections();
  });
}

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
  setRemoteLibraryError("");
  updateRemoteLibraryUi();
  savedDialog.showModal();
});

closeSavedDialogButton.addEventListener("click", () => {
  savedDialog.close();
});

connectRemoteLibraryButton.addEventListener("click", async () => {
  const key = remoteLibraryKeyInput.value;
  connectRemoteLibraryButton.disabled = true;
  setRemoteLibraryError("");
  try {
    setRemoteLibraryKey(key);
    updateRemoteLibraryUi("Netlify · sincronizando…");
    const result = await syncDurableLibrary();
    if (!result || result.mode !== "netlify") {
      throw new Error("La ruta de sincronización de Netlify no está disponible.");
    }
    refreshSavedProjects(savedProjectSelect.value);
    refreshSavedColors(savedColorSelect.value);
    remoteLibraryKeyInput.value = "";
    updateRemoteLibraryUi(
      `Netlify sincronizado · ${result.total} proyectos · ${result.colorsTotal} apariencias`
    );
    appStatus.textContent = "Biblioteca local y Netlify sincronizados.";
  } catch (error) {
    clearRemoteLibraryKey();
    updateRemoteLibraryUi();
    setRemoteLibraryError(error instanceof Error
      ? error.message
      : "No se pudo conectar la biblioteca de Netlify.");
  } finally {
    connectRemoteLibraryButton.disabled = false;
  }
});

disconnectRemoteLibraryButton.addEventListener("click", () => {
  clearRemoteLibraryKey();
  remoteLibraryKeyInput.value = "";
  setRemoteLibraryError("");
  updateRemoteLibraryUi();
  appStatus.textContent = "Sincronización remota desconectada; la biblioteca local se conserva.";
});

remoteLibraryKeyInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  connectRemoteLibraryButton.click();
});

openColorDialogButton.addEventListener("click", openColorDialog);
openColorFromSidebarButton.addEventListener("click", openColorDialog);

for (const input of colorSectionInputs) {
  input.addEventListener("change", () => {
    if (input.checked && isColorSection(input.value)) showColorPanel(input.value);
  });
}

openCameraDialogButton.addEventListener("click", openCameraDialog);
openCameraFromSidebarButton.addEventListener("click", openCameraDialog);

openMotionSetsDialogButton.addEventListener("click", () => {
  if (!motionSetsDialog.open) motionSetsDialog.showModal();
});

closeMotionSetsDialogButton.addEventListener("click", () => motionSetsDialog.close());

closeCameraDialogButton.addEventListener("click", closeCameraDialog);

resetCameraDialogButton.addEventListener("click", () => {
  const project = getProject(state.projectId);
  const cameraParameters = Object.fromEntries(project.controls
    .filter((control) => control.group === "camera")
    .map((control) => [control.key, control.defaultValue]));
  if (Object.keys(cameraParameters).length === 0) return;
  recordHistory("Restablecer composición 3D");
  state = {
    ...state,
    parameters: { ...state.parameters, ...cameraParameters },
    view: createDefaultView()
  };
  projectParameters.set(project.id, { ...state.parameters });
  projectViews.set(project.id, { ...state.view });
  renderProjectControls(project);
  postState();
  appStatus.textContent = "Composición 3D restablecida.";
});

cameraSetSelect.addEventListener("change", () => {
  const selected = availableCameraSets(state.projectId).find((set) => set.id === cameraSetSelect.value);
  applyCameraSetButton.disabled = !selected;
  deleteCameraSetButton.disabled = !selected || selected.scope === "system";
  setCameraSetError("");
});

applyCameraSetButton.addEventListener("click", () => {
  if (!cameraSetSelect.value) return;
  applyCameraSetById(cameraSetSelect.value);
});

function saveCurrentCameraSet(scope: "shared" | "project"): void {
  const name = cameraSetNameInput.value.trim();
  if (!name) {
    setCameraSetError("Escribe un nombre para guardar la vista.");
    cameraSetNameInput.focus();
    return;
  }
  const project = getProject(state.projectId);
  if (project.id !== "mobius-flow-1-1") return;
  const current = currentCameraSetState(project);
  const saved = saveCameraSet(name, scope, project.id, current.parameters, current.view) as MobiusCameraSet;
  cameraSetNameInput.value = "";
  renderCameraSets(project);
  cameraSetSelect.value = saved.id;
  cameraSetSelect.dispatchEvent(new Event("change"));
  setCameraSetError("");
  appStatus.textContent = `Vista “${saved.name}” guardada en ${scope === "shared" ? "Compartidos" : "Este proyecto"}.`;
}

saveSharedCameraSetButton.addEventListener("click", () => saveCurrentCameraSet("shared"));
saveProjectCameraSetButton.addEventListener("click", () => saveCurrentCameraSet("project"));

deleteCameraSetButton.addEventListener("click", () => {
  const selected = availableCameraSets(state.projectId).find((set) => set.id === cameraSetSelect.value);
  if (!selected || selected.scope === "system") return;
  pendingDeleteCameraSetId = selected.id;
  deleteCameraSetDescription.textContent = `La vista “${selected.name}” desaparecerá de la biblioteca local y no se puede deshacer.`;
  deleteCameraSetDialog.showModal();
});

confirmDeleteCameraSetButton.addEventListener("click", () => {
  const selected = availableCameraSets(state.projectId)
    .find((set) => set.id === pendingDeleteCameraSetId);
  if (!selected || selected.scope === "system") return;
  deleteCameraSet(selected.id);
  renderCameraSets(getProject(state.projectId));
  setCameraSetError("");
  appStatus.textContent = `Vista “${selected.name}” eliminada.`;
});

deleteCameraSetDialog.addEventListener("close", () => {
  pendingDeleteCameraSetId = "";
});

motionSetSelect.addEventListener("change", () => {
  const selected = availableMotionSets(state.projectId).find((set) => set.id === motionSetSelect.value);
  applyMotionSetButton.disabled = !selected;
  deleteMotionSetButton.disabled = !selected || selected.scope === "system";
  setMotionSetError("");
});

applyMotionSetButton.addEventListener("click", () => {
  if (motionSetSelect.value) applyMotionSetById(motionSetSelect.value);
});

function saveCurrentMotionSet(scope: "shared" | "project"): void {
  const name = motionSetNameInput.value.trim();
  if (!name) {
    setMotionSetError("Escribe un nombre para guardar el movimiento.");
    motionSetNameInput.focus();
    return;
  }
  const project = getProject(state.projectId);
  if (project.id !== "mobius-flow-1-1") return;
  const parameters = Object.fromEntries(MOBIUS_MOTION_PARAMETER_KEYS
    .map((key) => [key, state.parameters[key] ?? project.defaults[key] ?? 0]));
  const saved = saveMotionSet(name, scope, project.id, parameters) as MobiusMotionSet;
  motionSetNameInput.value = "";
  renderMotionSets(project);
  motionSetSelect.value = saved.id;
  motionSetSelect.dispatchEvent(new Event("change"));
  setMotionSetError("");
  appStatus.textContent = `Movimiento “${saved.name}” guardado en ${scope === "shared" ? "Compartidos" : "Este proyecto"}.`;
}

saveSharedMotionSetButton.addEventListener("click", () => saveCurrentMotionSet("shared"));
saveProjectMotionSetButton.addEventListener("click", () => saveCurrentMotionSet("project"));

deleteMotionSetButton.addEventListener("click", () => {
  const selected = availableMotionSets(state.projectId).find((set) => set.id === motionSetSelect.value);
  if (!selected || selected.scope === "system") return;
  pendingDeleteMotionSetId = selected.id;
  deleteMotionSetDescription.textContent = `El movimiento “${selected.name}” desaparecerá de la biblioteca local y no se puede deshacer.`;
  deleteMotionSetDialog.showModal();
});

confirmDeleteMotionSetButton.addEventListener("click", () => {
  const selected = availableMotionSets(state.projectId)
    .find((set) => set.id === pendingDeleteMotionSetId);
  if (!selected || selected.scope === "system") return;
  deleteMotionSet(selected.id);
  renderMotionSets(getProject(state.projectId));
  setMotionSetError("");
  appStatus.textContent = `Movimiento “${selected.name}” eliminado.`;
});

deleteMotionSetDialog.addEventListener("close", () => {
  pendingDeleteMotionSetId = "";
});

cameraDialog.addEventListener("close", () => {
  openCameraDialogButton.setAttribute("aria-expanded", "false");
  cameraDialogDrag = null;
  cameraDialog.classList.remove("is-dragging");
});

resetCameraDialogPositionButton.addEventListener("click", () => {
  applyCameraDialogPosition(defaultCameraDialogPosition(), true);
});

cameraDialogDragHandle.addEventListener("pointerdown", (event) => {
  if (!colorDialogIsFloating() || event.button !== 0) return;
  if (event.target instanceof Element && event.target.closest("button, input, select, a")) return;
  const origin = cameraDialogPosition ?? defaultCameraDialogPosition();
  cameraDialogDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: origin.x,
    originY: origin.y
  };
  cameraDialog.classList.add("is-dragging");
  cameraDialogDragHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
});

cameraDialogDragHandle.addEventListener("pointermove", (event) => {
  if (!cameraDialogDrag || cameraDialogDrag.pointerId !== event.pointerId) return;
  applyCameraDialogPosition({
    x: cameraDialogDrag.originX + event.clientX - cameraDialogDrag.startX,
    y: cameraDialogDrag.originY + event.clientY - cameraDialogDrag.startY
  });
});

function finishCameraDialogDrag(event: PointerEvent): void {
  if (!cameraDialogDrag || cameraDialogDrag.pointerId !== event.pointerId) return;
  if (cameraDialogDragHandle.hasPointerCapture(event.pointerId)) {
    cameraDialogDragHandle.releasePointerCapture(event.pointerId);
  }
  cameraDialogDrag = null;
  cameraDialog.classList.remove("is-dragging");
  if (cameraDialogPosition) saveCameraDialogPosition(cameraDialogPosition);
}

cameraDialogDragHandle.addEventListener("pointerup", finishCameraDialogDrag);
cameraDialogDragHandle.addEventListener("pointercancel", finishCameraDialogDrag);

closeColorDialogButton.addEventListener("click", closeColorDialog);

resetColorDialogPositionButton.addEventListener("click", () => {
  applyColorDialogPosition(defaultColorDialogPosition(), true);
});

colorDialogDragHandle.addEventListener("pointerdown", (event) => {
  if (!colorDialogIsFloating() || event.button !== 0) return;
  if (event.target instanceof Element && event.target.closest("button, input, select, a")) return;
  const origin = colorDialogPosition ?? defaultColorDialogPosition();
  colorDialogDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: origin.x,
    originY: origin.y
  };
  colorDialog.classList.add("is-dragging");
  colorDialogDragHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
});

colorDialogDragHandle.addEventListener("pointermove", (event) => {
  if (!colorDialogDrag || colorDialogDrag.pointerId !== event.pointerId) return;
  applyColorDialogPosition({
    x: colorDialogDrag.originX + event.clientX - colorDialogDrag.startX,
    y: colorDialogDrag.originY + event.clientY - colorDialogDrag.startY
  });
});

function finishColorDialogDrag(event: PointerEvent): void {
  if (!colorDialogDrag || colorDialogDrag.pointerId !== event.pointerId) return;
  if (colorDialogDragHandle.hasPointerCapture(event.pointerId)) {
    colorDialogDragHandle.releasePointerCapture(event.pointerId);
  }
  colorDialogDrag = null;
  colorDialog.classList.remove("is-dragging");
  if (colorDialogPosition) saveColorDialogPosition(colorDialogPosition);
}

colorDialogDragHandle.addEventListener("pointerup", finishColorDialogDrag);
colorDialogDragHandle.addEventListener("pointercancel", finishColorDialogDrag);

colorDialog.addEventListener("close", () => {
  openColorDialogButton.setAttribute("aria-expanded", "false");
  colorDialogDrag = null;
  colorDialog.classList.remove("is-dragging");
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (document.querySelector("dialog[open]:not(#color-dialog):not(#camera-dialog)")) return;
  if (cameraDialog.open) {
    event.preventDefault();
    closeCameraDialog();
    return;
  }
  if (colorDialog.open) {
    event.preventDefault();
    closeColorDialog();
  }
});

window.addEventListener("resize", () => {
  if (!colorDialogIsFloating()) return;
  if (colorDialog.open) {
    applyColorDialogPosition(
      colorDialogPosition ?? readColorDialogPosition() ?? defaultColorDialogPosition()
    );
  }
  if (cameraDialog.open) {
    applyCameraDialogPosition(
      cameraDialogPosition ?? readCameraDialogPosition() ?? defaultCameraDialogPosition()
    );
  }
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
    setColorLibraryError("Escribe un nombre antes de guardar la apariencia.");
    colorNameInput.focus();
    return;
  }

  saveColorButton.disabled = true;
  try {
    const record = saveColor(
      name,
      state.palette,
      currentGradientSettings(),
      state.appearance ?? appearanceFromLegacy(state.palette, state.parameters)
    );
    refreshSavedColors(record.id);
    colorNameInput.value = "";
    setColorLibraryError("");
    try {
      const durable = await persistDurableLibrary();
      appStatus.textContent = durable
        ? `Apariencia “${record.name}” guardada en la ${durableLibraryName(durable.mode)}.`
        : `Apariencia “${record.name}” guardada en este navegador.`;
      if (durable?.mode === "netlify") {
        updateRemoteLibraryUi(
          `Netlify sincronizado · ${durable.total} proyectos · ${durable.colorsTotal} apariencias`
        );
      }
    } catch (error) {
      setColorLibraryError(
        `La apariencia está en el navegador, pero la sincronización persistente falló: ${
          error instanceof Error ? error.message : "error desconocido"
        }`
      );
    }
  } catch (error) {
    setColorLibraryError(error instanceof Error ? error.message : "No se pudo guardar la apariencia.");
  } finally {
    saveColorButton.disabled = false;
  }
});

applyColorButton.addEventListener("click", () => {
  const record = savedColors.find((candidate) => candidate.id === savedColorSelect.value);
  if (!record) {
    setColorLibraryError("Selecciona una apariencia guardada.");
    return;
  }
  applySavedColor(record);
  setColorLibraryError("");
  appStatus.textContent = `Apariencia “${record.name}” aplicada.`;
  colorDialog.close();
});

deleteColorButton.addEventListener("click", () => {
  const record = savedColors.find((candidate) => candidate.id === savedColorSelect.value);
  if (!record) {
    setColorLibraryError("Selecciona una apariencia guardada.");
    return;
  }
  pendingDeleteColorId = record.id;
  deleteColorDialog.showModal();
});

confirmDeleteColorButton.addEventListener("click", async () => {
  if (!pendingDeleteColorId) return;
  const colorId = pendingDeleteColorId;
  const record = savedColors.find((candidate) => candidate.id === colorId);
  deleteSavedColor(colorId);
  refreshSavedColors();
  try {
    const durable = await deleteDurableColor(colorId);
    setColorLibraryError("");
    appStatus.textContent = record ? `Apariencia “${record.name}” eliminada.` : "Apariencia eliminada.";
    if (durable?.mode === "netlify") {
      updateRemoteLibraryUi(
        `Netlify sincronizado · ${durable.total} proyectos · ${durable.colorsTotal} apariencias`
      );
    }
  } catch (error) {
    setColorLibraryError(
      `La apariencia se eliminó localmente, pero falta sincronizar ese cambio: ${
        error instanceof Error ? error.message : "error desconocido"
      }`
    );
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
      control.group === "appearance" || control.group === "gradient" || control.group === "color3d" || control.group === "camera"
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
    const record = saveProject(name, state, currentTime, currentElapsedTime);
    refreshSavedProjects(record.id);
    saveNameInput.value = "";
    setStorageError("");
    try {
      const durable = await persistDurableLibrary();
      const imageNote = state.projectId === "image-currents"
        ? " La fotografía temporal no forma parte del guardado."
        : "";
      appStatus.textContent = (durable
        ? `“${record.name}” guardado en la ${durableLibraryName(durable.mode)}.`
        : `“${record.name}” guardado en este navegador.`) + imageNote;
      if (durable?.mode === "netlify") {
        updateRemoteLibraryUi(
          `Netlify sincronizado · ${durable.total} proyectos · ${durable.colorsTotal} apariencias`
        );
      }
    } catch (error) {
      setStorageError(
        `“${record.name}” está en el navegador, pero la sincronización persistente falló: ${
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
  deleteSavedProject(projectId);
  refreshSavedProjects();
  try {
    const durable = await deleteDurableProject(projectId);
    setStorageError("");
    appStatus.textContent = record ? `“${record.name}” eliminado.` : "Guardado eliminado.";
    if (durable?.mode === "netlify") {
      updateRemoteLibraryUi(
        `Netlify sincronizado · ${durable.total} proyectos · ${durable.colorsTotal} apariencias`
      );
    }
  } catch (error) {
    setStorageError(
      `El guardado se eliminó localmente, pero falta sincronizar ese cambio: ${
        error instanceof Error ? error.message : "error desconocido"
      }`
    );
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
      throw new Error("No hay proyectos ni apariencias que exportar.");
    }
    downloadBlob(backup.blob, backup.filename);
    appStatus.textContent = `Biblioteca exportada: ${backup.count} proyectos · ${backup.colorCount} apariencias.`;
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
    appStatus.textContent = `Biblioteca restaurada: ${result.total} proyectos · ${result.colorsTotal} apariencias.`;
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
    const record = saveProject(preset.name, safeState, preset.time, preset.elapsedTime);
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

function applyAppearanceHex(
  input: HTMLInputElement,
  target: "background" | "solid",
  label: string
): void {
  const value = input.value.trim();
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    setColorError(`${label}: usa un valor hexadecimal de seis cifras, por ejemplo #8ECFC2.`);
    input.setAttribute("aria-invalid", "true");
    return;
  }

  const normalized = value.toLowerCase();
  const appearance = currentAppearance();
  recordHistory(`Cambiar ${label.toLowerCase()}`);
  applyAppearance(target === "background"
    ? { ...appearance, background: { color: normalized } }
    : { ...appearance, paint: { type: "solid", color: normalized } }, `${label} actualizado.`);
  input.removeAttribute("aria-invalid");
  setColorError("");
}

backgroundColor.addEventListener("input", () => {
  beginHistoryInteraction("appearance:background", "Cambiar color de fondo");
  const appearance = currentAppearance();
  applyAppearance({ ...appearance, background: { color: backgroundColor.value.toLowerCase() } }, "Color de fondo actualizado.");
});
foregroundColor.addEventListener("input", () => {
  beginHistoryInteraction("appearance:solid", "Cambiar color de la forma");
  const appearance = currentAppearance();
  applyAppearance({ ...appearance, paint: { type: "solid", color: foregroundColor.value.toLowerCase() } }, "Color de la forma actualizado.");
});
backgroundColorValue.addEventListener("change", () => applyAppearanceHex(backgroundColorValue, "background", "Color de fondo"));
foregroundColorValue.addEventListener("change", () => applyAppearanceHex(foregroundColorValue, "solid", "Color de la forma"));

for (const input of appearancePaintModeInputs) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    const appearance = currentAppearance();
    if (input.value === appearance.paint.type) return;
    recordHistory(input.value === "gradient" ? "Usar gradiente" : "Usar color único");
    if (input.value === "gradient") {
      const paint = rememberedGradientPaint ?? {
        type: "gradient" as const,
        mapping: "screen" as const,
        angle: 0,
        stops: [
          { position: 0, color: appearance.paint.type === "solid" ? appearance.paint.color : state.palette.foreground },
          { position: 1, color: initialPalette.secondary ?? initialPalette.accent }
        ]
      };
      applyAppearance({ ...appearance, paint: structuredClone(paint) }, "Gradiente activado.");
    } else {
      if (appearance.paint.type === "gradient") rememberedGradientPaint = structuredClone(appearance.paint);
      applyAppearance({
        ...appearance,
        paint: { type: "solid", color: colorAtAppearancePosition(appearance, 0.5) }
      }, "Color único activado.");
    }
  });
}

addGradientStopButton.addEventListener("click", () => {
  const appearance = currentAppearance();
  if (appearance.paint.type !== "gradient" || appearance.paint.stops.length >= 4) return;
  let gapIndex = 0;
  let gapSize = -1;
  for (let index = 0; index < appearance.paint.stops.length - 1; index += 1) {
    const size = appearance.paint.stops[index + 1]!.position - appearance.paint.stops[index]!.position;
    if (size > gapSize) {
      gapSize = size;
      gapIndex = index;
    }
  }
  const position = appearance.paint.stops[gapIndex]!.position + gapSize * 0.5;
  const stops = appearance.paint.stops.map((stop) => ({ ...stop }));
  stops.splice(gapIndex + 1, 0, { position, color: colorAtAppearancePosition(appearance, position) });
  recordHistory("Añadir color al gradiente");
  applyAppearance({ ...appearance, paint: { ...appearance.paint, stops } }, "Color añadido al gradiente.");
});

appearanceGradientAngle.addEventListener("change", () => {
  const appearance = currentAppearance();
  if (appearance.paint.type !== "gradient") return;
  recordHistory("Cambiar dirección del gradiente");
  applyAppearance({
    ...appearance,
    paint: { ...appearance.paint, angle: clamp(appearanceGradientAngle.valueAsNumber, -180, 180) }
  }, "Dirección del gradiente actualizada.");
});
appearanceGradientMapping.addEventListener("change", () => {
  const appearance = currentAppearance();
  if (appearance.paint.type !== "gradient") return;
  recordHistory("Cambiar aplicación del gradiente");
  applyAppearance({
    ...appearance,
    paint: { ...appearance.paint, mapping: appearanceGradientMapping.value === "surface" ? "surface" : "screen" }
  }, "Aplicación del gradiente actualizada.");
});

const materialDefaults: Record<AppearanceMaterialPreset, AppearanceStyle["material"]> = {
  matte: { preset: "matte", roughness: 0.78, metalness: 0, clearcoat: 0 },
  satin: { preset: "satin", roughness: 0.38, metalness: 0, clearcoat: 0.28 },
  metal: { preset: "metal", roughness: 0.28, metalness: 0.88, clearcoat: 0.12 },
  glass: { preset: "glass", roughness: 0.12, metalness: 0, clearcoat: 0.9 }
};
appearanceMaterialPreset.addEventListener("change", () => {
  const preset = appearanceMaterialPreset.value as AppearanceMaterialPreset;
  const appearance = currentAppearance();
  recordHistory("Cambiar material");
  applyAppearance({ ...appearance, material: structuredClone(materialDefaults[preset] ?? materialDefaults.matte) }, "Material actualizado.");
});

for (const [input, key, label] of [
  [appearanceRoughness, "roughness", "rugosidad"],
  [appearanceMetalness, "metalness", "metal"],
  [appearanceClearcoat, "clearcoat", "capa superficial"]
] as const) {
  const historyKey = `appearance:material:${key}`;
  input.addEventListener("input", () => {
    beginHistoryInteraction(historyKey, `Cambiar ${label}`);
    const appearance = currentAppearance();
    applyAppearance({
      ...appearance,
      material: { ...appearance.material, [key]: clamp(input.valueAsNumber, 0, 1) }
    }, `Material: ${label} actualizado.`);
  });
  const finish = () => endHistoryInteraction(historyKey);
  input.addEventListener("change", finish);
  input.addEventListener("blur", finish);
}

appearanceTexturePreset.addEventListener("change", () => {
  const appearance = currentAppearance();
  recordHistory("Cambiar textura procedural");
  const preset = appearanceTexturePreset.value;
  applyAppearance({
    ...appearance,
    texture: preset === "none"
      ? { type: "none" }
      : {
          type: "procedural",
          preset: preset === "grain" || preset === "mineral" ? preset : "flow",
          scale: appearance.texture.type === "procedural" ? appearance.texture.scale : 4,
          strength: appearance.texture.type === "procedural" ? appearance.texture.strength : 0.5,
          motion: appearance.texture.type === "procedural" ? appearance.texture.motion : 1
        }
  }, "Textura procedural actualizada.");
});

for (const [input, key, minimum, maximum, label] of [
  [appearanceTextureScale, "scale", 0.1, 24, "escala de textura"],
  [appearanceTextureStrength, "strength", 0, 1, "fuerza de textura"],
  [appearanceTextureMotion, "motion", -4, 4, "movimiento de textura"]
] as const) {
  const historyKey = `appearance:texture:${key}`;
  input.addEventListener("input", () => {
    const appearance = currentAppearance();
    if (appearance.texture.type !== "procedural") return;
    beginHistoryInteraction(historyKey, `Cambiar ${label}`);
    applyAppearance({
      ...appearance,
      texture: { ...appearance.texture, [key]: clamp(input.valueAsNumber, minimum, maximum) }
    }, `Textura: ${label} actualizado.`);
  });
  const finish = () => endHistoryInteraction(historyKey);
  input.addEventListener("change", finish);
  input.addEventListener("blur", finish);
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
  const previousDuration = state.playback.loopSeconds;
  const nextDuration = clamp(loopSeconds, 2, 20);
  const project = getProject(state.projectId);
  const usesUnboundedPreviewTime = project.supportsUnboundedPreviewTime === true;
  beginHistoryInteraction(
    "playback:duration",
    usesUnboundedPreviewTime
      ? "Cambiar duración de exportación"
      : state.playback.mode === "continuous" ? "Cambiar duración del clip" : "Cambiar duración del bucle"
  );
  state = {
    ...state,
    playback: { ...state.playback, loopSeconds: nextDuration }
  };
  appStatus.textContent = usesUnboundedPreviewTime
    ? `Exportación configurada a ${state.playback.loopSeconds.toFixed(1)} segundos; la previsualización sigue sin límite.`
    : state.playback.mode === "continuous"
      ? `Clip continuo de ${state.playback.loopSeconds.toFixed(1)} segundos.`
      : `Bucle de ${state.playback.loopSeconds.toFixed(1)} segundos.`;
  post({ type: "state", state });
  if (state.playback.mode === "continuous" && !usesUnboundedPreviewTime) {
    setTimelinePosition(currentTime * previousDuration / nextDuration);
  }
});

playbackModeSelect.addEventListener("change", () => {
  const project = getProject(state.projectId);
  const nextMode = project.supportsLoopTime === false || (
    playbackModeSelect.value === "continuous" && project.supportsContinuousTime
  ) ? "continuous" : "loop";
  if (nextMode === state.playback.mode) return;
  recordHistory("Cambiar repetición");
  state = {
    ...state,
    playback: { ...state.playback, mode: nextMode }
  };
  projectPlaybackModes.set(project.id, nextMode);
  renderProjectControls(project);
  postState();
  appStatus.textContent = nextMode === "continuous"
    ? "Reproducción continua: el clip se detendrá al final."
    : "Reproducción en loop activada.";
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
  const project = getProject(state.projectId);
  stepPlaybackInput(
    durationInput,
    -1,
    "playback:duration",
    project.supportsUnboundedPreviewTime === true
      ? "Cambiar duración de exportación"
      : "Cambiar duración del bucle",
    state.playback.loopSeconds
  );
});
durationIncreaseButton.addEventListener("click", () => {
  const project = getProject(state.projectId);
  stepPlaybackInput(
    durationInput,
    1,
    "playback:duration",
    project.supportsUnboundedPreviewTime === true
      ? "Cambiar duración de exportación"
      : "Cambiar duración del bucle",
    state.playback.loopSeconds
  );
});

for (const [input, historyKey] of [
  [backgroundColor, "appearance:background"],
  [foregroundColor, "appearance:solid"]
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
  currentElapsedTime = currentTime * state.playback.loopSeconds;
  timelineValue.value = `${Math.round(time * 100)}%`;
  post({ type: "seek", time });
  scheduleVectorExportPreview();
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
  const project = getProject(state.projectId);
  if (
    project.supportsUnboundedPreviewTime !== true &&
    !state.playback.playing &&
    state.playback.mode === "continuous" &&
    currentTime >= 0.999
  ) {
    setTimelinePosition(0);
  }
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
  const appearance = currentAppearance();
  const surfaceColor = appearance.paint.type === "solid"
    ? appearance.paint.color
    : appearance.paint.stops[0]!.color;
  if (appearance.background.color === surfaceColor) return;
  recordHistory("Invertir fondo y superficie");
  const paint = appearance.paint.type === "solid"
    ? { type: "solid" as const, color: appearance.background.color }
    : {
        ...appearance.paint,
        stops: appearance.paint.stops.map((stop, index) => (
          index === 0 ? { ...stop, color: appearance.background.color } : { ...stop }
        ))
      };
  applyAppearance({
    ...appearance,
    background: { color: surfaceColor },
    paint
  }, "Fondo y superficie invertidos.");
});

function createCurrentProjectFrame(): ProjectFrame {
  const format = getOutputFormat(state.formatKey);
  return {
    width: format.width,
    height: format.height,
    time: currentTime,
    elapsedTime: currentElapsedTime,
    timeMode: state.playback.mode,
    seed: state.seed,
    palette: state.palette,
    appearance: state.appearance,
    view: state.view,
    parameters: state.parameters,
    lighting: state.lighting,
    imageField: currentImageField
  };
}

function updateVectorExportPreviewLayout(): void {
  if (!vectorExportPreviewEnabled) return;
  const bounds = canvasStage.getBoundingClientRect();
  const stageWidth = Math.max(1, bounds.width);
  const stageHeight = Math.max(1, bounds.height);
  const format = getOutputFormat(state.formatKey);
  const margin = Math.min(40, stageWidth * 0.055, stageHeight * 0.055);
  const scale = Math.max(0.0001, Math.min(
    (stageWidth - margin * 2) / format.width,
    (stageHeight - margin * 2) / format.height
  ));
  const width = format.width * scale;
  const height = format.height * scale;
  vectorExportPreview.style.left = `${(stageWidth - width) * 0.5}px`;
  vectorExportPreview.style.top = `${(stageHeight - height) * 0.5}px`;
  vectorExportPreview.style.width = `${width}px`;
  vectorExportPreview.style.height = `${height}px`;
}

function renderVectorExportPreview(): void {
  queuedVectorExportPreviewFrame = 0;
  if (!vectorExportPreviewEnabled) return;
  const project = getProject(state.projectId);
  if (!project.toSvgColorMesh || project.exportCapabilities?.svg === false) {
    setVectorExportPreview(false);
    return;
  }
  try {
    vectorExportPreview.innerHTML = project.toSvgColorMesh(createCurrentProjectFrame());
    vectorExportPreview.setAttribute(
      "aria-label",
      `Previsualización exacta del SVG de malla a color de ${project.name}`
    );
    updateVectorExportPreviewLayout();
  } catch (error) {
    setVectorExportPreview(false);
    const message = error instanceof Error ? error.message : String(error);
    appStatus.textContent = "No se ha podido previsualizar el SVG.";
    svgExportStatus.textContent = message;
  }
}

function scheduleVectorExportPreview(): void {
  if (!vectorExportPreviewEnabled || queuedVectorExportPreviewFrame) return;
  queuedVectorExportPreviewFrame = window.requestAnimationFrame(renderVectorExportPreview);
}

function setVectorExportPreview(enabled: boolean): void {
  const project = getProject(state.projectId);
  const supported = typeof project.toSvgColorMesh === "function" &&
    project.exportCapabilities?.svg !== false;
  vectorExportPreviewEnabled = enabled && supported;
  vectorExportPreview.hidden = !vectorExportPreviewEnabled;
  previewMode3dButton.setAttribute("aria-pressed", String(!vectorExportPreviewEnabled));
  previewModeSvgButton.setAttribute("aria-pressed", String(vectorExportPreviewEnabled));

  if (vectorExportPreviewEnabled) {
    if (state.playback.playing) setPlaying(false);
    else updateStaticUi();
    updateVectorExportPreviewLayout();
    scheduleVectorExportPreview();
    appStatus.textContent = "Vista SVG activa: la descarga será idéntica al escenario.";
    svgExportStatus.textContent = "Vista SVG activa · cámara, pose, formato y color exportables.";
    return;
  }

  if (queuedVectorExportPreviewFrame) {
    window.cancelAnimationFrame(queuedVectorExportPreviewFrame);
    queuedVectorExportPreviewFrame = 0;
  }
  vectorExportPreview.replaceChildren();
  updateStaticUi();
  appStatus.textContent = "Vista 3D restaurada.";
  svgExportStatus.textContent = "Exporta el formato y la posición actuales.";
}

function startSvgExport(variant: "flat" | "color-mesh"): void {
  const project = getProject(state.projectId);
  const exporter = variant === "color-mesh" ? project.toSvgColorMesh : project.toSvg;
  if (!exporter || project.exportCapabilities?.svg === false) {
    svgExportStatus.textContent = variant === "color-mesh"
      ? `${project.index} · ${project.name} no ofrece SVG de malla a color.`
      : `${project.index} · ${project.name} no ofrece SVG.`;
    return;
  }
  exportButton.disabled = true;
  exportColorMeshButton.disabled = true;
  appStatus.textContent = variant === "color-mesh"
    ? "Preparando SVG de malla a color…"
    : "Preparando SVG plano…";
  svgExportStatus.textContent = variant === "color-mesh"
    ? "Coloreando la malla vectorial…"
    : "Generando fotograma vectorial plano…";
  try {
    const format = getOutputFormat(state.formatKey);
    const source = exporter(createCurrentProjectFrame());
    const suffix = variant === "color-mesh" ? "-mesh-color" : "";
    const filename = `cauce-${project.index}-${project.id}-${format.key}-${state.seed}${suffix}.svg`;
    downloadSvg(source, filename);
    appStatus.textContent = `${filename} exportado.`;
    svgExportStatus.textContent = `${filename} descargado.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appStatus.textContent = "No se ha podido exportar el SVG.";
    svgExportStatus.textContent = message;
  } finally {
    exportButton.disabled = false;
    exportColorMeshButton.disabled = false;
  }
}

previewMode3dButton.addEventListener("click", () => setVectorExportPreview(false));
previewModeSvgButton.addEventListener("click", () => setVectorExportPreview(true));
exportButton.addEventListener("click", () => startSvgExport("flat"));
exportColorMeshButton.addEventListener("click", () => startSvgExport("color-mesh"));

type ExportKind = "png" | "svg" | "video" | "web" | "preset";

function isExportKind(value: string): value is ExportKind {
  return value === "png" || value === "svg" || value === "video" || value === "web" || value === "preset";
}

function showExportPanel(kind: ExportKind): void {
  for (const input of exportKindInputs) input.checked = input.value === kind;
  for (const panel of exportPanels) panel.hidden = panel.dataset.exportPanel !== kind;
}

function updateExportCapabilities(project: ProjectDefinition): ExportKind {
  const available: Record<ExportKind, boolean> = {
    png: project.exportCapabilities?.png !== false,
    svg: Boolean(project.toSvg) && project.exportCapabilities?.svg !== false,
    video: project.exportCapabilities?.video !== false,
    web: project.exportCapabilities?.web !== false,
    preset: true
  };

  for (const input of exportKindInputs) {
    if (!isExportKind(input.value)) continue;
    input.disabled = !available[input.value];
    const option = input.closest<HTMLElement>(".export-kind-option");
    if (option) option.hidden = !available[input.value];
  }

  exportColorMeshButton.hidden = typeof project.toSvgColorMesh !== "function";
  if (vectorExportPreviewEnabled && typeof project.toSvgColorMesh !== "function") {
    setVectorExportPreview(false);
  }

  const selected = exportKindInputs.find((input) => input.checked && !input.disabled)?.value;
  if (selected && isExportKind(selected)) return selected;
  return available.png ? "png" : available.video ? "video" : available.web ? "web" : "preset";
}

for (const input of exportKindInputs) {
  input.addEventListener("change", () => {
    if (input.checked && isExportKind(input.value)) showExportPanel(input.value);
  });
}

openExportDialogButton.addEventListener("click", () => {
  const project = getProject(state.projectId);
  if (!presetExportName.value.trim()) {
    presetExportName.value = `${project.name} ${state.seed}`;
  }
  showExportPanel(updateExportCapabilities(project));
  exportDialog.showModal();
});

exportPngButton.addEventListener("click", async () => {
  exportPngButton.disabled = true;
  pngExportError.hidden = true;
  pngExportError.textContent = "";
  pngExportStatus.textContent = "Renderizando el fotograma actual…";

  try {
    const result = await exportProjectPng(
      structuredClone(state),
      currentTime,
      pngBackgroundSelect.value === "transparent",
      currentImageField,
      currentElapsedTime
    );
    downloadBlob(result.blob, result.filename);
    pngExportStatus.textContent = `${result.filename} descargado.`;
    appStatus.textContent = "PNG exportado.";
  } catch (error) {
    pngExportError.textContent = error instanceof Error
      ? error.message
      : "No se pudo exportar el PNG.";
    pngExportError.hidden = false;
    pngExportStatus.textContent = "Exportación PNG interrumpida.";
  } finally {
    exportPngButton.disabled = false;
  }
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

function beginSpatialLightDrag(event: PointerEvent, handle: SpatialLightHandle): void {
  if (viewMode !== "light" || getProject(state.projectId).spatialLightControls !== true) return;
  const projection = createSpatialProjection();
  if (!projection) return;
  const startPoint = spatialLightPoint(handle);
  const projected = projectSpatialPoint(startPoint, projection);
  if (!projected) return;
  event.preventDefault();
  event.stopPropagation();
  const element = event.currentTarget as HTMLButtonElement;
  element.setPointerCapture(event.pointerId);
  element.classList.add("is-dragging");
  spatialLightDrag = {
    pointerId: event.pointerId,
    handle,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPoint,
    depth: Math.max(projected.depth, 0.65),
    projection
  };
  beginHistoryInteraction(`light:${handle}:pointer`, handle === "source" ? "Mover luz" : "Mover objetivo de luz");
}

function moveSpatialLight(event: PointerEvent): void {
  const drag = spatialLightDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  const deltaX = event.clientX - drag.startClientX;
  const deltaY = event.clientY - drag.startClientY;
  const verticalScale = 2 * drag.depth * drag.projection.tangent / drag.projection.contentHeight;
  const horizontalScale = 2 * drag.depth * drag.projection.tangent * drag.projection.aspect /
    drag.projection.contentWidth;
  const offset = event.altKey
    ? vectorScale(drag.projection.forward, -deltaY * verticalScale)
    : vectorAdd(
        vectorScale(drag.projection.right, deltaX * horizontalScale),
        vectorScale(drag.projection.up, -deltaY * verticalScale)
      );
  setSpatialLightPoint(drag.handle, vectorAdd(drag.startPoint, offset));
  const point = spatialLightPoint(drag.handle);
  appStatus.textContent = `${drag.handle === "source" ? "Luz" : "Objetivo"}: ${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}.`;
}

function finishSpatialLightDrag(event: PointerEvent): void {
  const drag = spatialLightDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  const element = event.currentTarget as HTMLButtonElement;
  if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  element.classList.remove("is-dragging");
  endHistoryInteraction(`light:${drag.handle}:pointer`);
  spatialLightDrag = null;
  syncLightEditorControls();
}

function changeSpatialLightDepth(event: WheelEvent, handle: SpatialLightHandle): void {
  if (viewMode !== "light") return;
  const projection = createSpatialProjection();
  if (!projection) return;
  const point = spatialLightPoint(handle);
  const projected = projectSpatialPoint(point, projection);
  if (!projected) return;
  event.preventDefault();
  event.stopPropagation();
  beginHistoryInteraction(`light:${handle}:wheel`, handle === "source" ? "Mover luz en profundidad" : "Mover objetivo en profundidad");
  if (lightWheelHistoryTimer) window.clearTimeout(lightWheelHistoryTimer);
  lightWheelHistoryTimer = window.setTimeout(() => {
    endHistoryInteraction(`light:${handle}:wheel`);
    lightWheelHistoryTimer = 0;
  }, 180);
  const worldPerPixel = 2 * Math.max(projected.depth, 0.65) * projection.tangent / projection.contentHeight;
  const depthDelta = clamp(event.deltaY, -120, 120) * worldPerPixel * 0.85;
  setSpatialLightPoint(handle, vectorAdd(point, vectorScale(projection.forward, depthDelta)));
}

function moveSpatialLightWithKeyboard(event: KeyboardEvent, handle: SpatialLightHandle): void {
  if (!event.key.startsWith("Arrow")) return;
  const projection = createSpatialProjection();
  if (!projection) return;
  event.preventDefault();
  event.stopPropagation();
  beginHistoryInteraction(`light:${handle}:keyboard`, handle === "source" ? "Mover luz" : "Mover objetivo de luz");
  const step = event.shiftKey ? 0.12 : 0.04;
  let direction: Vector3Value;
  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    direction = vectorScale(projection.forward, event.key === "ArrowUp" ? step : -step);
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    direction = vectorScale(projection.right, event.key === "ArrowRight" ? step : -step);
  } else {
    direction = vectorScale(projection.up, event.key === "ArrowUp" ? step : -step);
  }
  setSpatialLightPoint(handle, vectorAdd(spatialLightPoint(handle), direction));
}

function finishSpatialLightKeyboard(handle: SpatialLightHandle): void {
  endHistoryInteraction(`light:${handle}:keyboard`);
}

function bindLightRange(
  input: HTMLInputElement,
  key: "intensity" | "distance" | "angle" | "penumbra" | "width" | "height",
  label: string
): void {
  const historyKey = `light:${key}:range`;
  input.addEventListener("input", () => {
    beginHistoryInteraction(historyKey, `Cambiar ${label.toLowerCase()} de luz`);
    setSpatialLightNumber(key, input.valueAsNumber);
    syncLightEditorControls();
    appStatus.textContent = `${label} de luz: ${input.value}.`;
  });
  const finish = () => endHistoryInteraction(historyKey);
  input.addEventListener("change", finish);
  input.addEventListener("pointercancel", finish);
  input.addEventListener("blur", finish);
}

function defaultSpatialLight(type: SpatialLightType, index: number): SpatialLightState {
  const base = getProject(state.projectId).defaultLighting?.lights[0];
  if (!base) throw new Error("El proyecto no define una luz base.");
  const id = `light-${window.crypto.randomUUID()}`;
  const offset = ((index % 3) - 1) * 0.45;
  const typeDefaults: Partial<SpatialLightState> = type === "point"
    ? { name: `Puntual ${index + 1}`, intensity: 7, castShadow: false }
    : type === "directional"
      ? { name: `Direccional ${index + 1}`, intensity: 2.5, castShadow: false }
      : type === "rect-area"
        ? { name: `Área ${index + 1}`, intensity: 6, castShadow: false, width: 1.6, height: 2.2 }
        : { name: `Focal ${index + 1}`, intensity: 5, castShadow: false };
  return normalizeSpatialLight({
    ...base,
    ...typeDefaults,
    id,
    type,
    solo: false,
    position: { x: offset, y: 1.1, z: -0.55 + Math.abs(offset) * 0.25 },
    target: { x: 0, y: 0.55, z: 0.1 },
    shadowMapSize: type === "point" ? 256 : 1024
  }, base, id);
}

function mutateLightingRig(
  mutation: (rig: LightingRigState) => void,
  refreshList = false
): void {
  const rig = cloneLightingRig(currentLightingRig());
  if (!rig) return;
  mutation(rig);
  commitLightingRig(rig, refreshList);
}

lightSourceHandle.addEventListener("pointerdown", (event) => beginSpatialLightDrag(event, "source"));
lightTargetHandle.addEventListener("pointerdown", (event) => beginSpatialLightDrag(event, "target"));
lightSourceHandle.addEventListener("pointermove", moveSpatialLight);
lightTargetHandle.addEventListener("pointermove", moveSpatialLight);
lightSourceHandle.addEventListener("pointerup", finishSpatialLightDrag);
lightTargetHandle.addEventListener("pointerup", finishSpatialLightDrag);
lightSourceHandle.addEventListener("pointercancel", finishSpatialLightDrag);
lightTargetHandle.addEventListener("pointercancel", finishSpatialLightDrag);
lightSourceHandle.addEventListener("wheel", (event) => changeSpatialLightDepth(event, "source"), { passive: false });
lightTargetHandle.addEventListener("wheel", (event) => changeSpatialLightDepth(event, "target"), { passive: false });
lightSourceHandle.addEventListener("keydown", (event) => moveSpatialLightWithKeyboard(event, "source"));
lightTargetHandle.addEventListener("keydown", (event) => moveSpatialLightWithKeyboard(event, "target"));
lightSourceHandle.addEventListener("keyup", () => finishSpatialLightKeyboard("source"));
lightTargetHandle.addEventListener("keyup", () => finishSpatialLightKeyboard("target"));
lightSourceHandle.addEventListener("blur", () => finishSpatialLightKeyboard("source"));
lightTargetHandle.addEventListener("blur", () => finishSpatialLightKeyboard("target"));

bindLightRange(lightIntensityInput, "intensity", "Intensidad");
bindLightRange(lightDistanceInput, "distance", "Alcance");
bindLightRange(lightAngleInput, "angle", "Apertura");
bindLightRange(lightPenumbraInput, "penumbra", "Suavidad");
bindLightRange(lightAreaWidthInput, "width", "Anchura");
bindLightRange(lightAreaHeightInput, "height", "Altura");

lightAddButton.addEventListener("click", () => {
  const rig = currentLightingRig();
  if (!rig || rig.lights.length >= MAX_SPATIAL_LIGHTS) return;
  const type = lightAddType.value as SpatialLightType;
  const light = defaultSpatialLight(type, rig.lights.length);
  recordHistory(`Añadir ${lightTypeLabel(type).toLowerCase()}`);
  const next = cloneLightingRig(rig)!;
  next.lights.push(light);
  selectedLightId = light.id;
  commitLightingRig(next, true);
  syncLightEditorControls();
  appStatus.textContent = `${light.name} añadida.`;
});

lightEnabledInput.addEventListener("change", () => {
  const light = selectedSpatialLight();
  if (!light) return;
  recordHistory(lightEnabledInput.checked ? `Activar ${light.name}` : `Desactivar ${light.name}`);
  updateSelectedLight({ enabled: lightEnabledInput.checked }, true);
  syncLightEditorControls();
});

lightNameInput.addEventListener("change", () => {
  const light = selectedSpatialLight();
  if (!light) return;
  const name = lightNameInput.value.trim().replace(/\s+/g, " ").slice(0, 48) || light.name;
  if (name === light.name) {
    lightNameInput.value = light.name;
    return;
  }
  recordHistory(`Renombrar ${light.name}`);
  updateSelectedLight({ name }, true);
  syncLightEditorControls();
});

lightTypeInput.addEventListener("change", () => {
  const light = selectedSpatialLight();
  if (!light) return;
  const type = lightTypeInput.value as SpatialLightType;
  if (type === light.type) return;
  recordHistory(`Convertir ${light.name} en ${lightTypeLabel(type).toLowerCase()}`);
  updateSelectedLight({
    type,
    castShadow: type === "point" || type === "rect-area" ? false : light.castShadow,
    shadowMapSize: type === "point" ? 256 : light.shadowMapSize === 256 ? 1024 : light.shadowMapSize
  }, true);
  syncLightEditorControls();
});

lightColorSourceInput.addEventListener("change", () => {
  const light = selectedSpatialLight();
  if (!light) return;
  recordHistory(`Cambiar fuente de color de ${light.name}`);
  updateSelectedLight({ colorSource: lightColorSourceInput.value as SpatialLightState["colorSource"] });
  syncLightEditorControls();
});

lightColorInput.addEventListener("input", () => {
  const light = selectedSpatialLight();
  if (!light) return;
  beginHistoryInteraction("light:color", `Cambiar color de ${light.name}`);
  updateSelectedLight({ color: lightColorInput.value.toLowerCase(), colorSource: "custom" });
  syncLightEditorControls();
});
lightColorInput.addEventListener("change", () => endHistoryInteraction("light:color"));
lightColorInput.addEventListener("blur", () => endHistoryInteraction("light:color"));

lightShadowsInput.addEventListener("change", () => {
  const light = selectedSpatialLight();
  if (!light || light.type === "rect-area") return;
  recordHistory("Cambiar sombras de luz");
  updateSelectedLight({ castShadow: lightShadowsInput.checked }, true);
  syncLightEditorControls();
  appStatus.textContent = lightShadowsInput.checked ? "Sombras de luz activadas." : "Sombras de luz desactivadas.";
});

lightSoloInput.addEventListener("change", () => {
  const light = selectedSpatialLight();
  if (!light) return;
  recordHistory(lightSoloInput.checked ? `Aislar ${light.name}` : `Quitar solo de ${light.name}`);
  updateSelectedLight({ solo: lightSoloInput.checked }, true);
  syncLightEditorControls();
});

lightDuplicateButton.addEventListener("click", () => {
  const rig = currentLightingRig();
  const light = selectedSpatialLight();
  if (!rig || !light || rig.lights.length >= MAX_SPATIAL_LIGHTS) return;
  const id = `light-${window.crypto.randomUUID()}`;
  const duplicate = normalizeSpatialLight({
    ...light,
    id,
    name: `${light.name} copia`,
    solo: false,
    position: { ...light.position, x: clamp(light.position.x + 0.2, -4, 4) },
    castShadow: false
  }, light, id);
  recordHistory(`Duplicar ${light.name}`);
  const next = cloneLightingRig(rig)!;
  next.lights.push(duplicate);
  selectedLightId = duplicate.id;
  commitLightingRig(next, true);
  syncLightEditorControls();
  appStatus.textContent = `${duplicate.name} añadida.`;
});

lightDeleteButton.addEventListener("click", () => {
  const rig = currentLightingRig();
  const light = selectedSpatialLight();
  if (!rig || !light) return;
  recordHistory(`Eliminar ${light.name}`);
  const next = cloneLightingRig(rig)!;
  const index = next.lights.findIndex((candidate) => candidate.id === light.id);
  next.lights.splice(index, 1);
  selectedLightId = next.lights[Math.min(index, next.lights.length - 1)]?.id ?? "";
  commitLightingRig(next, true);
  syncLightEditorControls();
  appStatus.textContent = `${light.name} eliminada. Puedes recuperarla con Deshacer.`;
});

lightEnvironmentEnabledInput.addEventListener("change", () => {
  recordHistory(lightEnvironmentEnabledInput.checked ? "Activar HDRI" : "Desactivar HDRI");
  mutateLightingRig((rig) => {
    rig.environment.enabled = lightEnvironmentEnabledInput.checked;
  });
  syncLightEditorControls();
});

function bindGlobalLightRange(
  input: HTMLInputElement,
  key: "environmentIntensity" | "environmentRotation" | "ambientIntensity",
  label: string
): void {
  const historyKey = `lighting:${key}`;
  input.addEventListener("input", () => {
    beginHistoryInteraction(historyKey, `Cambiar ${label.toLowerCase()}`);
    mutateLightingRig((rig) => {
      if (key === "environmentIntensity") rig.environment.intensity = clamp(input.valueAsNumber, 0, 3);
      else if (key === "environmentRotation") rig.environment.rotation = clamp(input.valueAsNumber, -180, 180);
      else rig.ambient.intensity = clamp(input.valueAsNumber, 0, 5);
    });
    syncLightEditorControls();
  });
  const finish = () => endHistoryInteraction(historyKey);
  input.addEventListener("change", finish);
  input.addEventListener("pointercancel", finish);
  input.addEventListener("blur", finish);
}

bindGlobalLightRange(lightEnvironmentIntensityInput, "environmentIntensity", "intensidad HDRI");
bindGlobalLightRange(lightEnvironmentRotationInput, "environmentRotation", "rotación HDRI");
bindGlobalLightRange(lightAmbientIntensityInput, "ambientIntensity", "intensidad ambiente");

lightAmbientTypeInput.addEventListener("change", () => {
  recordHistory("Cambiar luz ambiente");
  mutateLightingRig((rig) => {
    const type = lightAmbientTypeInput.value as LightingRigState["ambient"]["type"];
    rig.ambient.type = type;
    rig.ambient.enabled = type !== "none";
  });
  syncLightEditorControls();
});

function bindAmbientColor(input: HTMLInputElement, key: "color" | "groundColor", label: string): void {
  const historyKey = `lighting:ambient:${key}`;
  input.addEventListener("input", () => {
    beginHistoryInteraction(historyKey, `Cambiar ${label}`);
    mutateLightingRig((rig) => {
      rig.ambient[key] = input.value.toLowerCase();
    });
  });
  const finish = () => endHistoryInteraction(historyKey);
  input.addEventListener("change", finish);
  input.addEventListener("blur", finish);
}

bindAmbientColor(lightAmbientColorInput, "color", "color ambiente");
bindAmbientColor(lightGroundColorInput, "groundColor", "color de suelo");

lightPresetSelect.addEventListener("change", () => {
  updateLightingPresetDescription();
});

lightApplyPresetButton.addEventListener("click", () => {
  const project = getProject(state.projectId);
  const preset = project.lightingPresets?.find((candidate) => candidate.key === lightPresetSelect.value);
  if (!preset) return;
  const rig = normalizeLightingRig(preset.lighting, project.defaultLighting);
  if (!rig) return;
  recordHistory(`Aplicar preset de luz ${preset.label}`);
  selectedLightId = rig.lights[0]?.id ?? "";
  commitLightingRig(rig, true);
  syncLightEditorControls();
  appStatus.textContent = `Preset de luz “${preset.label}” aplicado.`;
});

lightResetButton.addEventListener("click", () => {
  const project = getProject(state.projectId);
  if (lightUsesDefaults(project)) return;
  const rig = cloneLightingRig(project.defaultLighting);
  if (!rig) return;
  recordHistory("Reiniciar rig de iluminación");
  selectedLightId = rig.lights[0]?.id ?? "";
  commitLightingRig(rig, true);
  syncLightEditorControls();
  appStatus.textContent = "Rig de iluminación restablecido.";
});

canvasStage.addEventListener("pointerdown", (event) => {
  if (!currentProjectHasViewControls()) return;
  if (event.target instanceof Element && event.target.closest(".viewport-hud, .light-editor, .preview-mode-switch")) return;
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
  if (event.target instanceof Element && event.target.closest(".viewport-hud, .light-editor, .preview-mode-switch")) return;
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
  if (event.key.toLowerCase() === "l" && getProject(state.projectId).spatialLightControls === true) {
    event.preventDefault();
    setViewMode("light");
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
viewportLightButton.addEventListener("click", () => setViewMode("light"));
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
      webBackgroundSelect.value === "transparent",
      currentElapsedTime
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
    const result = createPresetDownload(
      name,
      structuredClone(state),
      currentTime,
      currentElapsedTime
    );
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
  if (
    !("transferControlToOffscreen" in canvas) ||
    !("transferControlToOffscreen" in threeCanvas) ||
    !("transferControlToOffscreen" in webgpuCanvas)
  ) {
    canvasMessage.hidden = true;
    canvasError.hidden = false;
    canvasError.textContent = "Este navegador no permite transferir Canvas a un worker.";
    appStatus.textContent = "El navegador no admite el motor gráfico requerido.";
    return;
  }

  const bounds = canvasStage.getBoundingClientRect();
  const offscreen = canvas.transferControlToOffscreen();
  const threeOffscreen = threeCanvas.transferControlToOffscreen();
  const webgpuOffscreen = webgpuCanvas.transferControlToOffscreen();
  post({
    type: "init",
    canvas: offscreen,
    threeCanvas: threeOffscreen,
    webgpuCanvas: webgpuOffscreen,
    cssWidth: Math.max(1, bounds.width),
    cssHeight: Math.max(1, bounds.height),
    pixelRatio: window.devicePixelRatio,
    diagnosticsEnabled: engineDiagnosticsEnabled,
    fluidResetMode,
    state
  }, [offscreen, threeOffscreen, webgpuOffscreen]);
}

const resizeObserver = new ResizeObserver((entries) => {
  const entry = entries[0];
  if (!entry) return;
  scheduleLightGizmoUpdate();
  updateVectorExportPreviewLayout();
  if (!workerReady) return;
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
renderBuiltInAppearances();
updateRemoteLibraryUi();
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
      appStatus.textContent = durableResult.mode === "netlify"
        ? `Netlify sincronizado: ${durableResult.total} proyectos · ${durableResult.colorsTotal} apariencias.`
        : `Biblioteca local persistente conectada: ${durableResult.total} proyectos · ${durableResult.colorsTotal} apariencias.`;
      if (durableResult.mode === "netlify") {
        updateRemoteLibraryUi(
          `Netlify sincronizado · ${durableResult.total} proyectos · ${durableResult.colorsTotal} apariencias`
        );
      }
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
        appStatus.textContent = `Biblioteca recuperada y persistida: ${persisted?.total ?? 0} proyectos · ${persisted?.colorsTotal ?? 0} apariencias.`;
      }
    }

    if (loopbackResult?.canonicalUrl) window.location.replace(loopbackResult.canonicalUrl);
  } catch (error) {
    appStatus.textContent = error instanceof Error
      ? error.message
      : "No se pudo conectar la biblioteca persistente.";
    if (hasRemoteLibraryKey()) {
      updateRemoteLibraryUi("Netlify · sincronización pendiente");
      setRemoteLibraryError(error instanceof Error
        ? error.message
        : "No se pudo sincronizar la biblioteca de Netlify.");
    }
  }
}

if (!isLocalLibraryBridge()) {
  void initializeLibraryPersistence();
}
