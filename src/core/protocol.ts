import type { EngineState, ImageField } from "./types";

export type MainToWorkerMessage =
  | {
      type: "init";
      canvas: OffscreenCanvas;
      threeCanvas: OffscreenCanvas;
      cssWidth: number;
      cssHeight: number;
      pixelRatio: number;
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
    }
  | {
      type: "visibility";
      visible: boolean;
    }
  | {
      type: "export-svg";
      requestId: string;
    };

export type WorkerToMainMessage =
  | { type: "ready" }
  | { type: "frame"; time: number }
  | { type: "svg"; requestId: string; source: string; filename: string }
  | { type: "error"; message: string };
