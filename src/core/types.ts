export type CauceContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface OutputFormat {
  key: string;
  label: string;
  width: number;
  height: number;
}

export interface Palette {
  background: string;
  foreground: string;
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
}

export interface ProjectFrame {
  width: number;
  height: number;
  time: number;
  seed: number;
  palette: Palette;
  parameters: Record<string, number>;
  transparent?: boolean;
}

export interface ProjectDefinition {
  id: string;
  index: string;
  name: string;
  description: string;
  preferredFps: number;
  preferredFormatKey?: string;
  preferredLoopSeconds?: number;
  controls: RangeControlDefinition[];
  defaults: Record<string, number>;
  render(context: CauceContext, frame: ProjectFrame): void;
  toSvg(frame: ProjectFrame): string;
}
