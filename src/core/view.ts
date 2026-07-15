import { clamp } from "./random";
import type { ViewState } from "./types";

export const DEFAULT_VIEW: ViewState = Object.freeze({
  zoom: 1,
  panX: 0,
  panY: 0,
  orbitYaw: 0,
  orbitPitch: 0
});

export function createDefaultView(): ViewState {
  return { ...DEFAULT_VIEW };
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
}

export function normalizeView(value: Partial<ViewState> | null | undefined): ViewState {
  return {
    zoom: clamp(finiteOr(value?.zoom, DEFAULT_VIEW.zoom), 0.35, 4),
    panX: clamp(finiteOr(value?.panX, DEFAULT_VIEW.panX), -1, 1),
    panY: clamp(finiteOr(value?.panY, DEFAULT_VIEW.panY), -1, 1),
    orbitYaw: clamp(
      finiteOr(value?.orbitYaw, DEFAULT_VIEW.orbitYaw),
      -180,
      180
    ),
    orbitPitch: clamp(
      finiteOr(value?.orbitPitch, DEFAULT_VIEW.orbitPitch),
      -80,
      80
    )
  };
}

export function viewUsesDefaults(view: ViewState): boolean {
  return (
    Math.abs(view.zoom - DEFAULT_VIEW.zoom) < 0.0001 &&
    Math.abs(view.panX) < 0.0001 &&
    Math.abs(view.panY) < 0.0001 &&
    Math.abs(view.orbitYaw) < 0.0001 &&
    Math.abs(view.orbitPitch) < 0.0001
  );
}
