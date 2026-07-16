export type CauceContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type CauceCanvas = HTMLCanvasElement | OffscreenCanvas;
export type ProjectBackend = "canvas2d" | "two" | "three";

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

export interface ProjectRenderer {
  resize(viewport: ProjectRendererViewport): void;
  render(frame: ProjectFrame): void;
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
}

export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  orbitYaw: number;
  orbitPitch: number;
}

export interface PlaybackState {
  playing: boolean;
  speed: number;
  loopSeconds: number;
}

export interface EngineState {
  projectId: string;
  formatKey: string;
  seed: number;
  palette: Palette;
  view: ViewState;
  playback: PlaybackState;
  parameters: Record<string, number>;
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
  options?: Array<{ value: number; label: string }>;
}

export interface ProjectFrame {
  width: number;
  height: number;
  time: number;
  seed: number;
  palette: Palette;
  view: ViewState;
  parameters: Record<string, number>;
  transparent?: boolean;
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
  viewControls?: boolean;
  controls: RangeControlDefinition[];
  defaults: Record<string, number>;
  render?(context: CauceContext, frame: ProjectFrame): void;
  createRenderer?(canvas: CauceCanvas): ProjectRenderer | Promise<ProjectRenderer>;
  toSvg(frame: ProjectFrame): string;
}
