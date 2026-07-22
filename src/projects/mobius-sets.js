const STORAGE_KEY = "cauce.mobius-camera-sets.v1";
const MOTION_STORAGE_KEY = "cauce.mobius-motion-sets.v1";

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `mobius-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === "object") : [];
  } catch {
    return [];
  }
}

function writeAll(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function readMotionAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MOTION_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === "object") : [];
  } catch {
    return [];
  }
}

function writeMotionAll(records) {
  localStorage.setItem(MOTION_STORAGE_KEY, JSON.stringify(records));
}

export const BUILT_IN_CAMERA_SETS = Object.freeze([
  {
    id: "system-front",
    name: "Frontal",
    scope: "system",
    projectId: "mobius-flow-1-1",
    parameters: { projection: 0, tilt: 0, yaw: 0, rotation: 0, fov: 38, cameraDistance: 5.1 },
    view: { zoom: 1, panX: 0, panY: 0, orbitYaw: 0, orbitPitch: 0 }
  },
  {
    id: "system-mark",
    name: "Marca ortográfica",
    scope: "system",
    projectId: "mobius-flow-1-1",
    parameters: { projection: 1, tilt: 0, yaw: 0, rotation: 0, fov: 38, cameraDistance: 5.1 },
    view: { zoom: 1, panX: 0, panY: 0, orbitYaw: 0, orbitPitch: 0 }
  },
  {
    id: "system-isometric",
    name: "Isométrica",
    scope: "system",
    projectId: "mobius-flow-1-1",
    parameters: { projection: 0, tilt: 57, yaw: -14, rotation: -30, fov: 38, cameraDistance: 5.1 },
    view: { zoom: 1, panX: 0, panY: 0, orbitYaw: 0, orbitPitch: 0 }
  },
  {
    id: "system-top",
    name: "Superior",
    scope: "system",
    projectId: "mobius-flow-1-1",
    parameters: { projection: 0, tilt: 82, yaw: 0, rotation: 0, fov: 38, cameraDistance: 5.1 },
    view: { zoom: 1, panX: 0, panY: 0, orbitYaw: 0, orbitPitch: 0 }
  },
  {
    id: "system-side",
    name: "Lateral",
    scope: "system",
    projectId: "mobius-flow-1-1",
    parameters: { projection: 0, tilt: 0, yaw: 90, rotation: 0, fov: 38, cameraDistance: 5.1 },
    view: { zoom: 1, panX: 0, panY: 0, orbitYaw: 0, orbitPitch: 0 }
  }
]);

function normalizeSet(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.id !== "string" || typeof entry.name !== "string") return null;
  if (entry.scope !== "shared" && entry.scope !== "project") return null;
  if (entry.scope === "project" && typeof entry.projectId !== "string") return null;
  if (!entry.parameters || typeof entry.parameters !== "object") return null;
  return {
    id: entry.id,
    name: entry.name.trim().slice(0, 80) || "Composición",
    scope: entry.scope,
    projectId: entry.projectId,
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString(),
    parameters: Object.fromEntries(Object.entries(entry.parameters)
      .filter(([, value]) => typeof value === "number" && Number.isFinite(value))),
    view: {
      zoom: finite(entry.view?.zoom, 1),
      panX: finite(entry.view?.panX, 0),
      panY: finite(entry.view?.panY, 0),
      orbitYaw: finite(entry.view?.orbitYaw, 0),
      orbitPitch: finite(entry.view?.orbitPitch, 0)
    }
  };
}

export function listCameraSets(projectId) {
  const custom = readAll().map(normalizeSet).filter(Boolean);
  return [
    ...BUILT_IN_CAMERA_SETS,
    ...custom.filter((entry) => entry.scope === "shared"),
    ...custom.filter((entry) => entry.scope === "project" && entry.projectId === projectId)
  ];
}

export function saveCameraSet(name, scope, projectId, parameters, view) {
  const now = new Date().toISOString();
  const record = normalizeSet({
    id: id(),
    name,
    scope,
    projectId: scope === "project" ? projectId : undefined,
    createdAt: now,
    updatedAt: now,
    parameters,
    view
  });
  if (!record) throw new Error("No se pudo crear el set de cámara.");
  writeAll([...readAll(), record]);
  return record;
}

export function deleteCameraSet(setId) {
  const records = readAll();
  writeAll(records.filter((entry) => entry?.id !== setId));
}

export const BUILT_IN_MOTION_SETS = Object.freeze([
  {
    id: "motion-system-current",
    name: "Circulación suave",
    scope: "system",
    projectId: "mobius-flow-1-1",
    parameters: { motionMode: 0, motionAmount: 0.24, motionSpeed: 1, circulation: 1, breathing: 0.06 }
  },
  {
    id: "motion-system-wave",
    name: "Onda viajera",
    scope: "system",
    projectId: "mobius-flow-1-1",
    parameters: { motionMode: 1, motionAmount: 0.54, motionSpeed: 1.1, circulation: 1, breathing: 0.04 }
  },
  {
    id: "motion-system-pulse",
    name: "Contracción localizada",
    scope: "system",
    projectId: "mobius-flow-1-1",
    parameters: { motionMode: 2, motionAmount: 0.68, motionSpeed: 0.72, circulation: 0, breathing: 0.03 }
  },
  {
    id: "motion-system-drift",
    name: "Deriva orgánica",
    scope: "system",
    projectId: "mobius-flow-1-1",
    parameters: { motionMode: 3, motionAmount: 0.62, motionSpeed: 0.8, circulation: 1, breathing: 0.08 }
  }
]);

function normalizeMotionSet(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.id !== "string" || typeof entry.name !== "string") return null;
  if (entry.scope !== "shared" && entry.scope !== "project") return null;
  if (entry.scope === "project" && typeof entry.projectId !== "string") return null;
  if (!entry.parameters || typeof entry.parameters !== "object") return null;
  return {
    id: entry.id,
    name: entry.name.trim().slice(0, 80) || "Movimiento",
    scope: entry.scope,
    projectId: entry.projectId,
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString(),
    parameters: Object.fromEntries(Object.entries(entry.parameters)
      .filter(([, value]) => typeof value === "number" && Number.isFinite(value)))
  };
}

export function listMotionSets(projectId) {
  const custom = readMotionAll().map(normalizeMotionSet).filter(Boolean);
  return [
    ...BUILT_IN_MOTION_SETS,
    ...custom.filter((entry) => entry.scope === "shared"),
    ...custom.filter((entry) => entry.scope === "project" && entry.projectId === projectId)
  ];
}

export function saveMotionSet(name, scope, projectId, parameters) {
  const now = new Date().toISOString();
  const record = normalizeMotionSet({
    id: id(),
    name,
    scope,
    projectId: scope === "project" ? projectId : undefined,
    createdAt: now,
    updatedAt: now,
    parameters
  });
  if (!record) throw new Error("No se pudo crear el set de movimiento.");
  writeMotionAll([...readMotionAll(), record]);
  return record;
}

export function deleteMotionSet(setId) {
  writeMotionAll(readMotionAll().filter((entry) => entry?.id !== setId));
}
