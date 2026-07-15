import type { EngineState } from "./types";

export type MainToWorkerMessage =
  | {
      type: "init";
      canvas: OffscreenCanvas;
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
