export type CauceContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type CauceCanvas = HTMLCanvasElement | OffscreenCanvas;
export type ProjectBackend = "canvas2d" | "three" | "webgpu";
export type CauceFluidResetMode = "legacy-cpu" | "gpu-v2";

export interface ProjectRendererViewport {
  width: number;
  height: number;
  pixelRatio: number;
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
  stageBackground: string | null;
}

export interface ProjectRendererOptions {
  diagnosticsEnabled?: boolean;
  fluidResetMode?: CauceFluidResetMode;
  initialParticleCount?: number;
  initialSeed?: number;
  initialParameters?: Record<string, number>;
}

export interface ProjectRenderer {
  resize(viewport: ProjectRendererViewport): void;
  render(frame: ProjectFrame): void;
  flush?(): Promise<void>;
  getDiagnostics?(): Record<string, unknown>;
  dispose(): void;
}

export interface OutputFormat {
  key: string;
  label: string;
  width: number;
  height: number;
}

export interface Palette {
  background: string;
  foreground: string;
  accent: string;
  secondary?: string;
}

export interface AppearanceGradientStop {
  color: string;
  position: number;
}

export type AppearancePaint =
  | {
      type: "solid";
      color: string;
    }
  | {
      type: "gradient";
      stops: AppearanceGradientStop[];
      mapping: "screen" | "surface";
      angle: number;
    };

export type AppearanceMaterialPreset = "matte" | "satin" | "metal" | "glass";

export interface AppearanceMaterial {
  preset: AppearanceMaterialPreset;
  roughness: number;
  metalness: number;
  clearcoat: number;
}

export type AppearanceTexture =
  | { type: "none" }
  | {
      type: "procedural";
      preset: "flow" | "grain" | "mineral";
      scale: number;
      strength: number;
      motion: number;
    };

export interface AppearanceStyle {
  schemaVersion: 1;
  background: {
    color: string;
  };
  paint: AppearancePaint;
  material: AppearanceMaterial;
  texture: AppearanceTexture;
}

export interface AppearanceCapabilities {
  paint?: boolean;
  gradientMapping?: Array<"screen" | "surface">;
  materials?: AppearanceMaterialPreset[];
  proceduralTextures?: Array<"flow" | "grain" | "mineral">;
}

export type SpatialLightType = "spot" | "point" | "directional" | "rect-area";
export type LightColorSource = "custom" | "foreground" | "accent" | "secondary";
export type AmbientLightType = "none" | "ambient" | "hemisphere";

export interface Vector3State {
  x: number;
  y: number;
  z: number;
}

export interface SpatialLightState {
  id: string;
  name: string;
  type: SpatialLightType;
  enabled: boolean;
  solo: boolean;
  colorSource: LightColorSource;
  color: string;
  intensity: number;
  position: Vector3State;
  target: Vector3State;
  distance: number;
  angle: number;
  penumbra: number;
  width: number;
  height: number;
  castShadow: boolean;
  shadowMapSize: 256 | 512 | 1024;
}

export interface LightingRigState {
  environment: {
    enabled: boolean;
    intensity: number;
    rotation: number;
  };
  ambient: {
    enabled: boolean;
    type: AmbientLightType;
    color: string;
    groundColor: string;
    intensity: number;
  };
  lights: SpatialLightState[];
}

export interface LightingPresetDefinition {
  key: string;
  label: string;
  description?: string;
  lighting: LightingRigState;
}

export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  orbitYaw: number;
  orbitPitch: number;
}

export type PlaybackMode = "loop" | "continuous";
export type InspectorControlSection = "essential" | "motion" | "shape" | "appearance" | "advanced";

export interface PlaybackState {
  playing: boolean;
  speed: number;
  loopSeconds: number;
  mode: PlaybackMode;
}

export interface EngineState {
  projectId: string;
  formatKey: string;
  seed: number;
  palette: Palette;
  appearance?: AppearanceStyle;
  view: ViewState;
  playback: PlaybackState;
  parameters: Record<string, number>;
  lighting?: LightingRigState | null;
}

export interface ImageField {
  width: number;
  height: number;
  luminance: Uint8ClampedArray;
}

export interface RangeControlDefinition {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  digits?: number;
  suffix?: string;
  group?: string;
  hidden?: boolean;
  timeMode?: PlaybackMode;
  inspectorSection?: InspectorControlSection;
  advanced?: boolean;
  visibleWhen?: { key: string; equals: number };
  options?: Array<{ value: number; label: string; description?: string }>;
}

export interface ProjectFrame {
  width: number;
  height: number;
  time: number;
  elapsedTime: number;
  timeMode: PlaybackMode;
  seed: number;
  palette: Palette;
  appearance?: AppearanceStyle;
  view: ViewState;
  parameters: Record<string, number>;
  lighting?: LightingRigState | null;
  transparent?: boolean;
  imageField?: ImageField | null;
}

export interface ProjectExportCapabilities {
  svg?: boolean;
  png?: boolean;
  video?: boolean;
  web?: boolean;
}

export interface ProjectDefinition {
  id: string;
  index: string;
  name: string;
  description: string;
  backend?: ProjectBackend;
  preferredFps: number;
  preferredFormatKey?: string;
  preferredLoopSeconds?: number;
  preferredPlaybackMode?: PlaybackMode;
  supportsContinuousTime?: boolean;
  supportsLoopTime?: boolean;
  supportsUnboundedPreviewTime?: boolean;
  viewControls?: boolean;
  spatialLightControls?: boolean;
  defaultLighting?: LightingRigState;
  lightingPresets?: LightingPresetDefinition[];
  exportCapabilities?: ProjectExportCapabilities;
  appearanceCapabilities?: AppearanceCapabilities;
  controls: RangeControlDefinition[];
  defaults: Record<string, number>;
  render?(context: CauceContext, frame: ProjectFrame): void;
  createRenderer?(
    canvas: CauceCanvas,
    options?: ProjectRendererOptions
  ): ProjectRenderer | Promise<ProjectRenderer>;
  toSvg?(frame: ProjectFrame): string;
  toSvgColorMesh?(frame: ProjectFrame): string;
}
