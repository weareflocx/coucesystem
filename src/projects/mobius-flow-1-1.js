import { mobiusFlowProject } from "./mobius-flow.js";
import { TAU, clamp, parameter, positiveModulo } from "./shared.js";

const PROJECT_ID = "mobius-flow-1-1";
const SURFACE_SEGMENTS = 192;
const WIDTH_SEGMENTS = 24;
const CENTER_SAMPLES = 144;
const SIDE_SAMPLES = 288;
const MAX_SIDE_CURRENTS = 17;

function oddInteger(value, fallback) {
  const safeValue = Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.round((safeValue - 1) / 2) * 2 + 1);
}

function writeMobiusPoint(target, offset, u, v, halfTwists, phase) {
  const crossSection = halfTwists * u * 0.5 + phase;
  const distance = 1 + v * Math.cos(crossSection);
  target[offset] = distance * Math.cos(u);
  target[offset + 1] = distance * Math.sin(u);
  target[offset + 2] = v * Math.sin(crossSection);
}

function createSurfaceGeometry(THREE) {
  const vertexCount = (SURFACE_SEGMENTS + 1) * (WIDTH_SEGMENTS + 1);
  const positions = new Float32Array(vertexCount * 3);
  const indices = [];

  for (let uIndex = 0; uIndex < SURFACE_SEGMENTS; uIndex += 1) {
    for (let vIndex = 0; vIndex < WIDTH_SEGMENTS; vIndex += 1) {
      const row = WIDTH_SEGMENTS + 1;
      const topLeft = uIndex * row + vIndex;
      const topRight = topLeft + 1;
      const bottomLeft = (uIndex + 1) * row + vIndex;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, bottomLeft, topRight, bottomLeft, bottomRight, topRight);
    }
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setIndex(indices);
  return geometry;
}

function updateSurfaceGeometry(geometry, frame, cycle) {
  const halfTwists = oddInteger(parameter(frame, "halfTwists", 1), 1);
  const breathing = parameter(frame, "breathing", 0.06);
  const width = parameter(frame, "width", 0.46) * (1 + breathing * Math.sin(cycle));
  const circulation = Math.round(parameter(frame, "circulation", 1));
  const phase = circulation * cycle * 0.5;
  const positions = geometry.getAttribute("position").array;
  let offset = 0;

  for (let uIndex = 0; uIndex <= SURFACE_SEGMENTS; uIndex += 1) {
    const u = TAU * uIndex / SURFACE_SEGMENTS;
    for (let vIndex = 0; vIndex <= WIDTH_SEGMENTS; vIndex += 1) {
      const v = -width + 2 * width * vIndex / WIDTH_SEGMENTS;
      writeMobiusPoint(positions, offset, u, v, halfTwists, phase);
      offset += 3;
    }
  }

  geometry.getAttribute("position").needsUpdate = true;
  geometry.computeVertexNormals();
  return { width, halfTwists, phase };
}

function createCurrentGeometry(THREE) {
  const maximumSegments = CENTER_SAMPLES + MAX_SIDE_CURRENTS * SIDE_SAMPLES;
  const positions = new Float32Array(maximumSegments * 2 * 3);
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setDrawRange(0, 0);
  return geometry;
}

function updateCurrentGeometry(geometry, frame, surface) {
  const visibleCurrentCount = clamp(oddInteger(parameter(frame, "currents", 11), 11), 3, 35);
  const sideCurrentCount = (visibleCurrentCount - 1) / 2;
  const positions = geometry.getAttribute("position").array;
  let offset = 0;

  function addCurrent(v, revolutions, samples) {
    const end = TAU * revolutions;
    for (let step = 0; step < samples; step += 1) {
      const u0 = end * step / samples;
      const u1 = end * (step + 1) / samples;
      writeMobiusPoint(positions, offset, u0, v, surface.halfTwists, surface.phase);
      writeMobiusPoint(positions, offset + 3, u1, v, surface.halfTwists, surface.phase);
      offset += 6;
    }
  }

  addCurrent(0, 1, CENTER_SAMPLES);
  for (let index = 1; index <= sideCurrentCount; index += 1) {
    addCurrent(surface.width * index / sideCurrentCount, 2, SIDE_SAMPLES);
  }

  geometry.getAttribute("position").needsUpdate = true;
  geometry.setDrawRange(0, offset / 3);
}

async function createMobiusRenderer(canvas) {
  const THREE = await import("three");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    depth: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance"
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const group = new THREE.Group();
  scene.add(group);

  const surfaceGeometry = createSurfaceGeometry(THREE);
  const surfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  });
  const surfaceMesh = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
  surfaceMesh.frustumCulled = false;
  group.add(surfaceMesh);

  const currentGeometry = createCurrentGeometry(THREE);
  const currentMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    toneMapped: false
  });
  const currents = new THREE.LineSegments(currentGeometry, currentMaterial);
  currents.frustumCulled = false;
  currents.renderOrder = 1;
  group.add(currents);

  const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x101417, 0.9);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
  keyLight.position.set(-2.5, -3.5, 5);
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.75);
  rimLight.position.set(3, 2, -4);
  scene.add(hemisphereLight, keyLight, rimLight);

  const backgroundColor = new THREE.Color();
  const foregroundColor = new THREE.Color();
  const surfaceColor = new THREE.Color();
  let viewport = {
    width: 1,
    height: 1,
    pixelRatio: 1,
    contentX: 0,
    contentY: 0,
    contentWidth: 1,
    contentHeight: 1,
    stageBackground: null
  };
  let disposed = false;

  function resize(nextViewport) {
    viewport = { ...nextViewport };
    renderer.setPixelRatio(nextViewport.pixelRatio);
    renderer.setSize(nextViewport.width, nextViewport.height, false);
    camera.aspect = Math.max(0.0001, nextViewport.contentWidth / nextViewport.contentHeight);
    camera.updateProjectionMatrix();
  }

  function render(frame) {
    if (disposed) return;
    const cycle = positiveModulo(frame.time, 1) * TAU;
    const surface = updateSurfaceGeometry(surfaceGeometry, frame, cycle);
    updateCurrentGeometry(currentGeometry, frame, surface);

    const tilt = parameter(frame, "tilt", 57) * Math.PI / 180;
    const yaw = (
      parameter(frame, "yaw", -14) +
      parameter(frame, "precession", 3.5) * Math.sin(cycle)
    ) * Math.PI / 180;
    const rotation = parameter(frame, "rotation", -30) * Math.PI / 180;
    group.rotation.set(tilt, yaw, rotation, "XYZ");

    camera.fov = parameter(frame, "fov", 38);
    camera.position.set(0, 0, parameter(frame, "cameraDistance", 5.1));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    backgroundColor.set(frame.palette.background);
    foregroundColor.set(frame.palette.foreground);
    surfaceColor.copy(backgroundColor).lerp(
      foregroundColor,
      parameter(frame, "surfaceTone", 0.36)
    );
    surfaceMaterial.color.copy(surfaceColor);
    surfaceMaterial.roughness = parameter(frame, "roughness", 0.72);
    currentMaterial.color.copy(foregroundColor);
    const light = parameter(frame, "light", 1.25);
    hemisphereLight.intensity = 0.72 * light;
    keyLight.intensity = 1.7 * light;
    rimLight.intensity = 0.58 * light;

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, viewport.width, viewport.height);
    if (viewport.stageBackground) {
      renderer.setClearColor(viewport.stageBackground, 1);
    } else {
      renderer.setClearColor(0x000000, 0);
    }
    renderer.clear(true, true, true);

    const viewportY = viewport.height - viewport.contentY - viewport.contentHeight;
    renderer.setViewport(
      viewport.contentX,
      viewportY,
      viewport.contentWidth,
      viewport.contentHeight
    );
    renderer.setScissor(
      viewport.contentX,
      viewportY,
      viewport.contentWidth,
      viewport.contentHeight
    );
    renderer.setScissorTest(true);
    renderer.setClearColor(backgroundColor, frame.transparent ? 0 : 1);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    surfaceGeometry.dispose();
    currentGeometry.dispose();
    surfaceMaterial.dispose();
    currentMaterial.dispose();
    renderer.dispose();
  }

  return { resize, render, dispose };
}

function toSvg(frame) {
  const source = mobiusFlowProject.toSvg({
    ...frame,
    parameters: {
      currents: parameter(frame, "currents", 11),
      width: parameter(frame, "width", 0.46),
      halfTwists: parameter(frame, "halfTwists", 1),
      tilt: parameter(frame, "tilt", 57),
      yaw: parameter(frame, "yaw", -14),
      rotation: parameter(frame, "rotation", -30),
      circulation: parameter(frame, "circulation", 1),
      breathing: parameter(frame, "breathing", 0.06),
      precession: parameter(frame, "precession", 3.5),
      perspective: 0.5,
      depthFade: 0.34,
      stroke: 1.1
    }
  });
  return source
    .replace("Cauce 05 — Möbius Flow", "Cauce 05.1 — Möbius Flow 1.1");
}

export const mobiusFlow11Project = {
  id: PROJECT_ID,
  index: "05.1",
  name: "Möbius Flow 1.1",
  label: "Cauce — Möbius Flow 1.1",
  description: "Malla Möbius tridimensional con profundidad real, iluminación de doble cara y corrientes cerradas.",
  backend: /** @type {"three"} */ ("three"),
  preferredFps: 60,
  preferredFormatKey: "square",
  preferredLoopSeconds: 7,
  controls: [
    { key: "currents", label: "Corrientes", min: 3, max: 35, step: 2, defaultValue: 11, digits: 0 },
    { key: "width", label: "Anchura de banda", min: 0.16, max: 0.72, step: 0.01, defaultValue: 0.46, digits: 2 },
    { key: "halfTwists", label: "Medias torsiones", min: 1, max: 5, step: 2, defaultValue: 1, digits: 0 },
    { key: "tilt", label: "Inclinación", min: -85, max: 85, step: 1, defaultValue: 57, digits: 0, suffix: "°" },
    { key: "yaw", label: "Giro 3D", min: -90, max: 90, step: 1, defaultValue: -14, digits: 0, suffix: "°" },
    { key: "rotation", label: "Rotación", min: -180, max: 180, step: 1, defaultValue: -30, digits: 0, suffix: "°" },
    { key: "circulation", label: "Circulación", min: 0, max: 4, step: 1, defaultValue: 1, digits: 0 },
    { key: "breathing", label: "Respiración", min: 0, max: 0.25, step: 0.01, defaultValue: 0.06, digits: 2 },
    { key: "precession", label: "Precesión", min: 0, max: 20, step: 0.5, defaultValue: 3.5, digits: 1, suffix: "°" },
    { key: "fov", label: "Campo de visión", min: 20, max: 72, step: 1, defaultValue: 38, digits: 0, suffix: "°" },
    { key: "cameraDistance", label: "Distancia de cámara", min: 3.4, max: 8, step: 0.05, defaultValue: 5.1, digits: 2 },
    { key: "surfaceTone", label: "Tono de superficie", min: 0.08, max: 0.9, step: 0.01, defaultValue: 0.36, digits: 2 },
    { key: "roughness", label: "Rugosidad", min: 0.05, max: 1, step: 0.01, defaultValue: 0.72, digits: 2 },
    { key: "light", label: "Luz", min: 0.2, max: 2.5, step: 0.05, defaultValue: 1.25, digits: 2 }
  ],
  defaults: {
    currents: 11,
    width: 0.46,
    halfTwists: 1,
    tilt: 57,
    yaw: -14,
    rotation: -30,
    circulation: 1,
    breathing: 0.06,
    precession: 3.5,
    fov: 38,
    cameraDistance: 5.1,
    surfaceTone: 0.36,
    roughness: 0.72,
    light: 1.25
  },
  createRenderer: createMobiusRenderer,
  toSvg
};
