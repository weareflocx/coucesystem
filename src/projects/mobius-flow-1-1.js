import {
  TAU,
  appearanceParameters,
  appearanceSample,
  clamp,
  paletteGradientStops,
  parameter,
  positiveModulo,
  svgGradientDefinition
} from "./shared.js";
import { compositionMetrics } from "./composition.js";
import {
  MOBIUS_MOTION_MODES,
  mobiusShape,
  motionSample,
  oddInteger,
  writeAnimatedMobiusPoint
} from "./mobius-core.js";

const PROJECT_ID = "mobius-flow-1-1";
const SURFACE_SEGMENTS = 192;
const WIDTH_SEGMENTS = 24;
const CENTER_SAMPLES = 144;
const SIDE_SAMPLES = 288;
const MAX_SIDE_CURRENTS = 17;

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
  const colorAttribute = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
  colorAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("color", colorAttribute);
  geometry.setIndex(indices);
  return geometry;
}

function writeAppearanceColor(
  target,
  offset,
  gradientColors,
  backgroundColor,
  sample,
  colorAmount = 1
) {
  const position = sample.gradientPosition * (gradientColors.length - 1);
  const startIndex = Math.floor(position);
  const endIndex = Math.min(gradientColors.length - 1, startIndex + 1);
  const mix = position - startIndex;
  const start = gradientColors[startIndex];
  const end = gradientColors[endIndex];
  const rampRed = start.r + (end.r - start.r) * mix;
  const rampGreen = start.g + (end.g - start.g) * mix;
  const rampBlue = start.b + (end.b - start.b) * mix;
  const red = backgroundColor.r + (rampRed - backgroundColor.r) * colorAmount;
  const green = backgroundColor.g + (rampGreen - backgroundColor.g) * colorAmount;
  const blue = backgroundColor.b + (rampBlue - backgroundColor.b) * colorAmount;
  target[offset] = red + (backgroundColor.r - red) * sample.textureDim;
  target[offset + 1] = green + (backgroundColor.g - green) * sample.textureDim;
  target[offset + 2] = blue + (backgroundColor.b - blue) * sample.textureDim;
}

function updateSurfaceGeometry(geometry, frame, cycle, colors) {
  const shape = mobiusShape(frame);
  const positions = geometry.getAttribute("position").array;
  const colorValues = geometry.getAttribute("color").array;
  let offset = 0;

  for (let uIndex = 0; uIndex <= SURFACE_SEGMENTS; uIndex += 1) {
    const u = TAU * uIndex / SURFACE_SEGMENTS;
    const sample = appearanceSample(frame, uIndex / SURFACE_SEGMENTS, colors.appearance);
    const motion = motionSample(frame, u, cycle, shape);
    for (let vIndex = 0; vIndex <= WIDTH_SEGMENTS; vIndex += 1) {
      const normalizedV = -1 + 2 * vIndex / WIDTH_SEGMENTS;
      // The parametrization already maps (2π, v) onto (0, -v). Keeping
      // the same transverse coordinate makes the final strip continuous.
      writeAnimatedMobiusPoint(
        positions,
        offset,
        frame,
        u,
        normalizedV,
        cycle,
        shape,
        motion
      );
      if (colors.renderMode === 0) {
        colorValues[offset] = colors.foreground.r;
        colorValues[offset + 1] = colors.foreground.g;
        colorValues[offset + 2] = colors.foreground.b;
      } else {
        writeAppearanceColor(
          colorValues,
          offset,
          colors.gradient,
          colors.background,
          sample,
          colors.surfaceTone
        );
      }
      offset += 3;
    }
  }

  geometry.getAttribute("position").needsUpdate = true;
  geometry.getAttribute("color").needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { shape, cycle };
}

function createCurrentGeometry(THREE) {
  const maximumSegments = CENTER_SAMPLES + MAX_SIDE_CURRENTS * SIDE_SAMPLES;
  const positions = new Float32Array(maximumSegments * 2 * 3);
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  const colorAttribute = new THREE.BufferAttribute(new Float32Array(maximumSegments * 2 * 3), 3);
  colorAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("color", colorAttribute);
  geometry.setDrawRange(0, 0);
  return geometry;
}

function updateCurrentGeometry(geometry, frame, surface, colors) {
  const requestedCurrentCount = Math.round(clamp(parameter(frame, "currents", 11), 0, 35));
  const visibleCurrentCount = requestedCurrentCount < 3
    ? 0
    : clamp(oddInteger(requestedCurrentCount, 11, 35), 3, 35);
  const sideCurrentCount = (visibleCurrentCount - 1) / 2;
  const positions = geometry.getAttribute("position").array;
  const colorValues = geometry.getAttribute("color").array;
  let offset = 0;

  function addCurrent(normalizedV, revolutions, samples) {
    const end = TAU * revolutions;
    for (let step = 0; step < samples; step += 1) {
      const u0 = end * step / samples;
      const u1 = end * (step + 1) / samples;
      const motion0 = motionSample(frame, u0, surface.cycle, surface.shape);
      const motion1 = motionSample(frame, u1, surface.cycle, surface.shape);
      writeAnimatedMobiusPoint(
        positions,
        offset,
        frame,
        u0,
        normalizedV,
        surface.cycle,
        surface.shape,
        motion0
      );
      writeAnimatedMobiusPoint(
        positions,
        offset + 3,
        frame,
        u1,
        normalizedV,
        surface.cycle,
        surface.shape,
        motion1
      );
      writeAppearanceColor(
        colorValues,
        offset,
        colors.gradient,
        colors.background,
        appearanceSample(frame, step / samples, colors.appearance)
      );
      writeAppearanceColor(
        colorValues,
        offset + 3,
        colors.gradient,
        colors.background,
        appearanceSample(frame, (step + 1) / samples, colors.appearance)
      );
      offset += 6;
    }
  }

  if (visibleCurrentCount >= 3) {
    addCurrent(0, 1, CENTER_SAMPLES);
    for (let index = 1; index <= sideCurrentCount; index += 1) {
      addCurrent(index / sideCurrentCount, 2, SIDE_SAMPLES);
    }
  }

  geometry.getAttribute("position").needsUpdate = true;
  geometry.getAttribute("color").needsUpdate = true;
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
  const orthographicCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  const group = new THREE.Group();
  scene.add(group);

  const surfaceGeometry = createSurfaceGeometry(THREE);
  const surfaceMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.72,
    metalness: 0,
    clearcoat: 0.2,
    clearcoatRoughness: 0.3,
    ior: 1.45,
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
    vertexColors: true,
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
  const gradientColors = Array.from({ length: 17 }, () => new THREE.Color());
  const cameraTarget = new THREE.Vector3();
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
    orthographicCamera.updateProjectionMatrix();
  }

  function render(frame) {
    if (disposed) return;
    const cycle = positiveModulo(frame.time, 1) * TAU;
    const appearance = appearanceParameters(frame);

    backgroundColor.set(frame.palette.background);
    foregroundColor.set(frame.palette.foreground);
    const renderMode = Math.round(clamp(parameter(frame, "renderMode", 1), 0, 2));
    const ramp = paletteGradientStops(frame, appearance);
    for (let index = 0; index < gradientColors.length; index += 1) {
      gradientColors[index].set(ramp[index].color);
    }
    const surfaceTone = parameter(frame, "surfaceTone", 0.36);
    const colors = {
      appearance,
      background: backgroundColor,
      foreground: foregroundColor,
      gradient: gradientColors,
      surfaceTone,
      renderMode
    };
    const surface = updateSurfaceGeometry(surfaceGeometry, frame, cycle, colors);
    updateCurrentGeometry(currentGeometry, frame, surface, colors);

    surfaceMesh.visible = true;
    currents.visible = renderMode !== 0;

    const tilt = parameter(frame, "tilt", 57) * Math.PI / 180;
    const yaw = (
      parameter(frame, "yaw", -14) +
      parameter(frame, "precession", 3.5) * Math.sin(cycle)
    ) * Math.PI / 180;
    const rotation = parameter(frame, "rotation", -30) * Math.PI / 180;
    group.rotation.set(tilt, yaw, rotation, "XYZ");

    const view = frame.view ?? {};
    const orbitYaw = (Number.isFinite(view.orbitYaw) ? view.orbitYaw : 0) * Math.PI / 180;
    const orbitPitch = (Number.isFinite(view.orbitPitch) ? view.orbitPitch : 0) * Math.PI / 180;
    const zoom = Number.isFinite(view.zoom) ? clamp(view.zoom, 0.35, 4) : 1;
    const formatAspect = compositionMetrics(frame).aspect;
    const formatDistance = formatAspect < 1
      ? Math.pow(1 / formatAspect, 0.22)
      : Math.pow(formatAspect, -0.06);
    const distance = parameter(frame, "cameraDistance", 5.1) * formatDistance / zoom;
    const cosinePitch = Math.cos(orbitPitch);
    cameraTarget.set(
      -(Number.isFinite(view.panX) ? view.panX : 0) * 3,
      (Number.isFinite(view.panY) ? view.panY : 0) * 3,
      0
    );
    camera.fov = parameter(frame, "fov", 38);
    camera.position.set(
      cameraTarget.x + Math.sin(orbitYaw) * cosinePitch * distance,
      cameraTarget.y + Math.sin(orbitPitch) * distance,
      cameraTarget.z + Math.cos(orbitYaw) * cosinePitch * distance
    );
    camera.lookAt(cameraTarget);
    camera.updateProjectionMatrix();

    const projection = Math.round(clamp(parameter(frame, "projection", 0), 0, 1));
    const activeCamera = projection === 1 ? orthographicCamera : camera;
    if (projection === 1) {
      const aspect = Math.max(0.0001, viewport.contentWidth / viewport.contentHeight);
      const halfHeight = 2.9 / zoom;
      const halfWidth = halfHeight * aspect;
      orthographicCamera.left = -halfWidth;
      orthographicCamera.right = halfWidth;
      orthographicCamera.top = halfHeight;
      orthographicCamera.bottom = -halfHeight;
      orthographicCamera.position.copy(camera.position);
      orthographicCamera.lookAt(cameraTarget);
      orthographicCamera.updateProjectionMatrix();
    }

    surfaceMaterial.color.set(renderMode === 0 ? frame.palette.foreground : 0xffffff);
    surfaceMaterial.vertexColors = true;
    surfaceMaterial.roughness = renderMode === 2
      ? parameter(frame, "roughness", 0.72)
      : 0.94;
    surfaceMaterial.metalness = renderMode === 2
      ? parameter(frame, "metalness", 0.02)
      : 0;
    surfaceMaterial.clearcoat = renderMode === 2
      ? parameter(frame, "clearcoat", 0.28)
      : 0;
    surfaceMaterial.clearcoatRoughness = parameter(frame, "clearcoatRoughness", 0.24);
    currentMaterial.color.set(0xffffff);
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
    renderer.render(scene, activeCamera);
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

function normalizeVector(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function createVectorProjector(frame, cycle) {
  const tilt = parameter(frame, "tilt", 57) * Math.PI / 180;
  const yaw = (
    parameter(frame, "yaw", -14) +
    parameter(frame, "precession", 3.5) * Math.sin(cycle)
  ) * Math.PI / 180;
  const rotation = parameter(frame, "rotation", -30) * Math.PI / 180;
  const cosineTilt = Math.cos(tilt);
  const sineTilt = Math.sin(tilt);
  const cosineYaw = Math.cos(yaw);
  const sineYaw = Math.sin(yaw);
  const cosineRotation = Math.cos(rotation);
  const sineRotation = Math.sin(rotation);

  const view = frame.view ?? {};
  const orbitYaw = (Number.isFinite(view.orbitYaw) ? view.orbitYaw : 0) * Math.PI / 180;
  const orbitPitch = (Number.isFinite(view.orbitPitch) ? view.orbitPitch : 0) * Math.PI / 180;
  const zoom = Number.isFinite(view.zoom) ? clamp(view.zoom, 0.35, 4) : 1;
  const metrics = compositionMetrics(frame);
  const formatDistance = metrics.aspect < 1
    ? Math.pow(1 / metrics.aspect, 0.22)
    : Math.pow(metrics.aspect, -0.06);
  const distance = parameter(frame, "cameraDistance", 5.1) * formatDistance / zoom;
  const target = [
    -(Number.isFinite(view.panX) ? view.panX : 0) * 3,
    (Number.isFinite(view.panY) ? view.panY : 0) * 3,
    0
  ];
  const cosinePitch = Math.cos(orbitPitch);
  const position = [
    target[0] + Math.sin(orbitYaw) * cosinePitch * distance,
    target[1] + Math.sin(orbitPitch) * distance,
    target[2] + Math.cos(orbitYaw) * cosinePitch * distance
  ];
  const backward = normalizeVector(
    position[0] - target[0],
    position[1] - target[1],
    position[2] - target[2]
  );
  const right = normalizeVector(backward[2], 0, -backward[0]);
  const up = [
    backward[1] * right[2] - backward[2] * right[1],
    backward[2] * right[0] - backward[0] * right[2],
    backward[0] * right[1] - backward[1] * right[0]
  ];
  const perspectiveScale = 1 / Math.tan(parameter(frame, "fov", 38) * Math.PI / 360);
  const projection = Math.round(clamp(parameter(frame, "projection", 0), 0, 1));
  const orthographicHalfHeight = 2.9 / zoom;
  const orthographicHalfWidth = orthographicHalfHeight * metrics.aspect;

  return function project(point) {
    const [x, y, z] = point;
    // Matches THREE.Euler's XYZ rotation used by the preview renderer.
    const worldX = cosineYaw * cosineRotation * x - cosineYaw * sineRotation * y + sineYaw * z;
    const worldY = (
      (cosineTilt * sineRotation + sineTilt * cosineRotation * sineYaw) * x +
      (cosineTilt * cosineRotation - sineTilt * sineRotation * sineYaw) * y -
      sineTilt * cosineYaw * z
    );
    const worldZ = (
      (sineTilt * sineRotation - cosineTilt * cosineRotation * sineYaw) * x +
      (sineTilt * cosineRotation + cosineTilt * sineRotation * sineYaw) * y +
      cosineTilt * cosineYaw * z
    );
    const relativeX = worldX - position[0];
    const relativeY = worldY - position[1];
    const relativeZ = worldZ - position[2];
    const cameraX = relativeX * right[0] + relativeY * right[1] + relativeZ * right[2];
    const cameraY = relativeX * up[0] + relativeY * up[1] + relativeZ * up[2];
    const cameraZ = relativeX * backward[0] + relativeY * backward[1] + relativeZ * backward[2];
    const depth = -cameraZ;
    const projectedX = projection === 1
      ? cameraX / orthographicHalfWidth
      : perspectiveScale * cameraX / (Math.max(0.0001, depth) * metrics.aspect);
    const projectedY = projection === 1
      ? cameraY / orthographicHalfHeight
      : perspectiveScale * cameraY / Math.max(0.0001, depth);
    return {
      x: (projectedX + 1) * frame.width * 0.5,
      y: (1 - projectedY) * frame.height * 0.5,
      depth
    };
  };
}

function projectedPoint(frame, u, normalizedV, cycle, shape, motion, project) {
  const point = [0, 0, 0];
  writeAnimatedMobiusPoint(point, 0, frame, u, normalizedV, cycle, shape, motion);
  return project(point);
}

function pointCommand(point, command = "L") {
  return `${command}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}

function createVectorSurface(frame, cycle, shape, project, colorAt = null) {
  const rows = [];
  for (let uIndex = 0; uIndex <= SURFACE_SEGMENTS; uIndex += 1) {
    const u = TAU * uIndex / SURFACE_SEGMENTS;
    const motion = motionSample(frame, u, cycle, shape);
    rows.push([
      projectedPoint(
        frame,
        u,
        -1,
        cycle,
        shape,
        motion,
        project
      ),
      projectedPoint(
        frame,
        u,
        1,
        cycle,
        shape,
        motion,
        project
      )
    ]);
  }

  const cells = [];
  for (let uIndex = 0; uIndex < SURFACE_SEGMENTS; uIndex += 1) {
    const points = [
      rows[uIndex][0],
      rows[uIndex + 1][0],
      rows[uIndex + 1][1],
      rows[uIndex][1]
    ];
    cells.push({
      gradient: colorAt
        ? {
            id: `mobius-flow-1-1-band-${uIndex}`,
            startColor: colorAt(uIndex / SURFACE_SEGMENTS),
            endColor: colorAt((uIndex + 1) / SURFACE_SEGMENTS),
            x1: (points[0].x + points[3].x) * 0.5,
            y1: (points[0].y + points[3].y) * 0.5,
            x2: (points[1].x + points[2].x) * 0.5,
            y2: (points[1].y + points[2].y) * 0.5
          }
        : null,
      depth: points.reduce((sum, point) => sum + point.depth, 0) / points.length,
      path: `${pointCommand(points[0], "M")}${pointCommand(points[1])}${pointCommand(points[2])}${pointCommand(points[3])}Z`
    });
  }
  const definition = colorAt
    ? `<defs>${cells.map((cell) => {
        const gradient = cell.gradient;
        return `<linearGradient id="${gradient.id}" gradientUnits="userSpaceOnUse" color-interpolation="linearRGB" x1="${gradient.x1.toFixed(2)}" y1="${gradient.y1.toFixed(2)}" x2="${gradient.x2.toFixed(2)}" y2="${gradient.y2.toFixed(2)}"><stop offset="0" stop-color="${gradient.startColor}"/><stop offset="1" stop-color="${gradient.endColor}"/></linearGradient>`;
      }).join("")}</defs>`
    : "";
  cells.sort((a, b) => b.depth - a.depth);
  return {
    definition,
    paths: cells.map((cell) => cell.gradient
      ? `<path d="${cell.path}" fill="url(#${cell.gradient.id})" stroke="url(#${cell.gradient.id})"/>`
      : `<path d="${cell.path}"/>`).join("")
  };
}

function srgbChannelToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearChannelToSrgb(channel) {
  const value = clamp(channel, 0, 1);
  const encoded = value <= 0.0031308
    ? value * 12.92
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

function colorToLinear(value) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) return [1, 1, 1];
  return [
    srgbChannelToLinear(Number.parseInt(match[1], 16)),
    srgbChannelToLinear(Number.parseInt(match[2], 16)),
    srgbChannelToLinear(Number.parseInt(match[3], 16))
  ];
}

function linearColorToHex(color) {
  return `#${color.map((channel) => linearChannelToSrgb(channel)
    .toString(16)
    .padStart(2, "0")).join("")}`;
}

function mixLinearColor(from, to, amount) {
  const mix = clamp(amount, 0, 1);
  return from.map((channel, index) => channel + (to[index] - channel) * mix);
}

function createMeshColorSampler(frame, appearance) {
  const ramp = paletteGradientStops(frame, appearance)
    .map((stop) => colorToLinear(stop.color));
  const background = colorToLinear(frame.palette.background);
  const surfaceTone = clamp(parameter(frame, "surfaceTone", 0.36), 0, 1);
  return function colorAt(normalizedU) {
    const sample = appearanceSample(frame, normalizedU, appearance);
    const position = sample.gradientPosition * (ramp.length - 1);
    const startIndex = Math.floor(position);
    const endIndex = Math.min(ramp.length - 1, startIndex + 1);
    const rampColor = mixLinearColor(
      ramp[startIndex],
      ramp[endIndex],
      position - startIndex
    );
    const surfaceColor = mixLinearColor(background, rampColor, surfaceTone);
    return linearColorToHex(mixLinearColor(surfaceColor, background, sample.textureDim));
  };
}

function createVectorCurrents(frame, cycle, shape, project) {
  const requestedCount = Math.round(clamp(parameter(frame, "currents", 11), 0, 35));
  const visibleCount = requestedCount < 3
    ? 0
    : clamp(oddInteger(requestedCount, 11, 35), 3, 35);
  if (visibleCount < 3) return "";
  const sideCount = (visibleCount - 1) / 2;
  const paths = [];

  function addCurrent(normalizedV, revolutions, samples) {
    const end = TAU * revolutions;
    let path = "";
    for (let step = 0; step <= samples; step += 1) {
      const u = end * step / samples;
      const point = projectedPoint(
        frame,
        u,
        normalizedV,
        cycle,
        shape,
        motionSample(frame, u, cycle, shape),
        project
      );
      path += pointCommand(point, step === 0 ? "M" : "L");
    }
    paths.push(`<path d="${path}"/>`);
  }

  addCurrent(0, 1, CENTER_SAMPLES);
  for (let index = 1; index <= sideCount; index += 1) {
    addCurrent(index / sideCount, 2, SIDE_SAMPLES);
  }
  return paths.join("");
}

function createVectorSvg(frame, colorMesh) {
  const cycle = positiveModulo(frame.time, 1) * TAU;
  const shape = mobiusShape(frame);
  const project = createVectorProjector(frame, cycle);
  const renderMode = Math.round(clamp(parameter(frame, "renderMode", 1), 0, 2));
  const appearance = appearanceParameters(frame);
  const gradient = renderMode === 0
    ? { definition: "", paint: frame.palette.foreground }
    : svgGradientDefinition(frame, appearance, "mobius-flow-1-1-gradient");
  const surface = createVectorSurface(
    frame,
    cycle,
    shape,
    project,
    colorMesh ? createMeshColorSampler(frame, appearance) : null
  );
  const currents = renderMode === 0
    ? ""
    : createVectorCurrents(frame, cycle, shape, project);
  const strokeWidth = 1.1 * Math.min(frame.width, frame.height) / 500;
  const background = frame.transparent
    ? ""
    : `<rect width="${frame.width}" height="${frame.height}" fill="${frame.palette.background}"/>`;
  const title = colorMesh ? "Malla vectorial a color" : "Vector plano";
  const surfaceAttributes = colorMesh
    ? "stroke-width=\"0.35\" stroke-linejoin=\"round\""
    : `fill="${gradient.paint}" stroke="${gradient.paint}" stroke-width="0.35" stroke-linejoin="round"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><title>Cauce 05.1 — Möbius Flow 1.1 · ${title}</title>${gradient.definition}${surface.definition}${background}<g ${surfaceAttributes}>${surface.paths}</g>${currents ? `<g fill="none" stroke="${gradient.paint}" stroke-width="${strokeWidth.toFixed(3)}" stroke-linecap="round" stroke-linejoin="round">${currents}</g>` : ""}</svg>`;
}

function toSvg(frame) {
  return createVectorSvg(frame, false);
}

function toSvgColorMesh(frame) {
  return createVectorSvg(frame, true);
}

export const mobiusFlow11Project = {
  id: PROJECT_ID,
  index: "05.1",
  name: "Möbius Flow 1.1",
  label: "Cauce — Möbius Flow 1.1",
  description: "Malla Möbius tridimensional con profundidad real, iluminación de doble cara y corrientes cerradas.",
  backend: /** @type {"three"} */ ("three"),
  appearanceCapabilities: {
    paint: true,
    gradientMapping: /** @type {Array<"screen" | "surface">} */ (["surface"]),
    materials: /** @type {Array<"matte" | "satin" | "metal" | "glass">} */ (["matte", "satin", "metal", "glass"]),
    proceduralTextures: /** @type {Array<"flow" | "grain" | "mineral">} */ (["flow", "grain", "mineral"])
  },
  preferredFps: 60,
  preferredFormatKey: "square",
  preferredLoopSeconds: 7,
  viewControls: true,
  controls: [
    { key: "renderMode", label: "Representación", min: 0, max: 2, step: 1, defaultValue: 1, digits: 0, options: [
      { value: 0, label: "Marca plana", description: "Una tinta, sin corrientes ni lectura material." },
      { value: 1, label: "Sólido", description: "Superficie iluminada con volumen visual." },
      { value: 2, label: "Material", description: "Acabado plástico con clearcoat." }
    ] },
    { key: "currents", label: "Líneas de corriente", min: 0, max: 35, step: 1, defaultValue: 11, digits: 0, inspectorSection: /** @type {"essential"} */ ("essential") },
    { key: "majorRadius", label: "Radio central", min: 0.65, max: 1.5, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "width", label: "Anchura de banda", min: 0.16, max: 0.72, step: 0.01, defaultValue: 0.46, digits: 2 },
    { key: "halfTwists", label: "Medias torsiones", min: 1, max: 7, step: 2, defaultValue: 1, digits: 0 },
    { key: "handedness", label: "Lateralidad", min: -1, max: 1, step: 2, defaultValue: 1, digits: 0, options: [
      { value: 1, label: "Derecha" },
      { value: -1, label: "Izquierda" }
    ] },
    { key: "twistPhase", label: "Fase de torsión", min: -180, max: 180, step: 1, defaultValue: 0, digits: 0, suffix: "°" },
    { key: "twistPosition", label: "Posición de torsión", min: -180, max: 180, step: 1, defaultValue: 0, digits: 0, suffix: "°" },
    { key: "twistConcentration", label: "Concentración", min: 0, max: 0.82, step: 0.01, defaultValue: 0, digits: 2 },
    { key: "ellipticity", label: "Elipticidad", min: 0.72, max: 1.32, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "flattening", label: "Profundidad", min: 0.5, max: 1.35, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "widthVariation", label: "Variación de anchura", min: 0, max: 0.24, step: 0.01, defaultValue: 0, digits: 2 },
    { key: "motionMode", label: "Movimiento", min: 0, max: 3, step: 1, defaultValue: 0, digits: 0, options: MOBIUS_MOTION_MODES.map((option) => ({ ...option })) },
    { key: "motionAmount", label: "Intensidad de movimiento", min: 0, max: 1, step: 0.01, defaultValue: 0.24, digits: 2 },
    { key: "motionSpeed", label: "Velocidad de movimiento", min: 0, max: 4, step: 0.05, defaultValue: 1, digits: 2 },
    { key: "projection", label: "Proyección", min: 0, max: 1, step: 1, defaultValue: 0, digits: 0, options: [
      { value: 0, label: "Perspectiva" },
      { value: 1, label: "Ortográfica" }
    ], group: "camera" },
    { key: "tilt", label: "Orientación X", min: -85, max: 85, step: 1, defaultValue: 57, digits: 0, suffix: "°", group: "camera" },
    { key: "yaw", label: "Orientación Y", min: -90, max: 90, step: 1, defaultValue: -14, digits: 0, suffix: "°", group: "camera" },
    { key: "rotation", label: "Orientación Z", min: -180, max: 180, step: 1, defaultValue: -30, digits: 0, suffix: "°", group: "camera" },
    { key: "circulation", label: "Circulación", min: 0, max: 4, step: 1, defaultValue: 1, digits: 0 },
    { key: "breathing", label: "Respiración", min: 0, max: 0.25, step: 0.01, defaultValue: 0.06, digits: 2 },
    { key: "precession", label: "Precesión", min: 0, max: 20, step: 0.5, defaultValue: 3.5, digits: 1, suffix: "°" },
    { key: "fov", label: "Campo de visión", min: 20, max: 72, step: 1, defaultValue: 38, digits: 0, suffix: "°", group: "camera" },
    { key: "cameraDistance", label: "Distancia de cámara", min: 3.4, max: 8, step: 0.05, defaultValue: 5.1, digits: 2, group: "camera" },
    { key: "surfaceTone", label: "Tono de superficie", min: 0.08, max: 0.9, step: 0.01, defaultValue: 0.36, digits: 2, group: "appearance" },
    { key: "roughness", label: "Rugosidad", min: 0.05, max: 1, step: 0.01, defaultValue: 0.72, digits: 2, group: "appearance" },
    { key: "metalness", label: "Metalness", min: 0, max: 1, step: 0.01, defaultValue: 0.02, digits: 2, group: "appearance" },
    { key: "clearcoat", label: "Clearcoat", min: 0, max: 1, step: 0.01, defaultValue: 0.28, digits: 2, group: "appearance" },
    { key: "clearcoatRoughness", label: "Rugosidad del clearcoat", min: 0, max: 1, step: 0.01, defaultValue: 0.24, digits: 2, group: "appearance" },
    { key: "light", label: "Luz", min: 0.2, max: 2.5, step: 0.05, defaultValue: 1.25, digits: 2, group: "appearance" },
    { key: "gradientStrength", label: "Intensidad", min: 0, max: 1, step: 0.01, defaultValue: 0.7, digits: 2, group: "gradient" },
    { key: "gradientAngle", label: "Dirección", min: -180, max: 180, step: 1, defaultValue: -35, digits: 0, suffix: "°", group: "gradient" },
    { key: "gradientMidpoint", label: "Punto medio", min: 0.08, max: 0.92, step: 0.01, defaultValue: 0.46, digits: 2, group: "gradient" },
    { key: "textureMode", label: "Textura", min: 0, max: 2, step: 1, defaultValue: 0, digits: 0, group: "appearance", options: [
      { value: 0, label: "Lisa" },
      { value: 1, label: "Flujo" },
      { value: 2, label: "Grano" }
    ] },
    { key: "textureScale", label: "Escala de textura", min: 1, max: 12, step: 1, defaultValue: 4, digits: 0, group: "appearance" },
    { key: "textureStrength", label: "Intensidad de textura", min: 0, max: 1, step: 0.01, defaultValue: 0, digits: 2, group: "appearance" },
    { key: "textureMotion", label: "Movimiento de textura", min: -4, max: 4, step: 1, defaultValue: 1, digits: 0, group: "appearance" }
  ],
  defaults: {
    currents: 11,
    renderMode: 1,
    majorRadius: 1,
    width: 0.46,
    halfTwists: 1,
    handedness: 1,
    twistPhase: 0,
    twistPosition: 0,
    twistConcentration: 0,
    ellipticity: 1,
    flattening: 1,
    widthVariation: 0,
    motionMode: 0,
    motionAmount: 0.24,
    motionSpeed: 1,
    tilt: 57,
    yaw: -14,
    rotation: -30,
    circulation: 1,
    breathing: 0.06,
    precession: 3.5,
    projection: 0,
    fov: 38,
    cameraDistance: 5.1,
    surfaceTone: 0.36,
    roughness: 0.72,
    metalness: 0.02,
    clearcoat: 0.28,
    clearcoatRoughness: 0.24,
    light: 1.25,
    gradientStrength: 0.7,
    gradientAngle: -35,
    gradientMidpoint: 0.46,
    textureMode: 0,
    textureScale: 4,
    textureStrength: 0,
    textureMotion: 1
  },
  createRenderer: createMobiusRenderer,
  toSvg,
  toSvgColorMesh
};
