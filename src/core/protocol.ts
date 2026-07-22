import type { CauceFluidResetMode, EngineState, ImageField } from "./types";

export type MainToWorkerMessage =
  | {
      type: "init";
      canvas: OffscreenCanvas;
      threeCanvas: OffscreenCanvas;
      webgpuCanvas: OffscreenCanvas;
      cssWidth: number;
      cssHeight: number;
      pixelRatio: number;
      diagnosticsEnabled: boolean;
      fluidResetMode: CauceFluidResetMode;
      state: EngineState;
    }
  | {
      type: "resize";
      cssWidth: number;
      cssHeight: number;
      pixelRatio: number;
    }
  | {
      type: "state";
      state: EngineState;
    }
  | {
      type: "image-field";
      field: ImageField | null;
    }
  | {
      type: "seek";
      time: number;
      elapsedTime?: number;
    }
  | {
      type: "visibility";
      visible: boolean;
    }
  | {
      type: "export-svg";
      requestId: string;
      variant?: "flat" | "color-mesh";
    }
  | {
      type: "request-diagnostics";
      requestId: string;
    };

export type WorkerToMainMessage =
  | { type: "ready" }
  | { type: "frame"; time: number; elapsedTime: number; ended?: boolean }
  | { type: "svg"; requestId: string; source: string; filename: string }
  | { type: "diagnostics"; requestId: string; diagnostics: Record<string, unknown> | null }
  | { type: "error"; message: string };
