import { clamp, createRandom, parameter } from "./shared.js";
import { compositionMetrics } from "./composition.js";

const PROJECT_ID = "mobius-flow-dynamics";
const TAU = Math.PI * 2;
const SURFACE_SEGMENTS = 192;
const WIDTH_SEGMENTS = 24;
const MAX_PARTICLES = 24000;
const TRAIL_SAMPLES = 8;

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
  const row = WIDTH_SEGMENTS + 1;
  const vertexCount = (SURFACE_SEGMENTS + 1) * row;
  const indices = [];

  for (let uIndex = 0; uIndex < SURFACE_SEGMENTS; uIndex += 1) {
    for (let vIndex = 0; vIndex < WIDTH_SEGMENTS; vIndex += 1) {
      const topLeft = uIndex * row + vIndex;
      const topRight = topLeft + 1;
      const bottomLeft = (uIndex + 1) * row + vIndex;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, bottomLeft, topRight, bottomLeft, bottomRight, topRight);
    }
  }

  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
  const colors = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  colors.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  geometry.setAttribute("color", colors);
  geometry.setIndex(indices);
  return geometry;
}

function mixColorChannels(target, offset, first, second, amount, background, tone) {
  const red = first.r + (second.r - first.r) * amount;
  const green = first.g + (second.g - first.g) * amount;
  const blue = first.b + (second.b - first.b) * amount;
  target[offset] = background.r + (red - background.r) * tone;
  target[offset + 1] = background.g + (green - background.g) * tone;
  target[offset + 2] = background.b + (blue - background.b) * tone;
}

function updateSurfaceGeometry(geometry, frame, colors) {
  const halfTwists = oddInteger(parameter(frame, "halfTwists", 1), 1);
  const baseWidth = parameter(frame, "width", 0.46);
  const pulse = parameter(frame, "surfacePulse", 0.025);
  const width = baseWidth * (1 + pulse * Math.sin(frame.elapsedTime * 0.72));
  const phase = frame.elapsedTime * parameter(frame, "surfaceMotion", 0.025);
  const tone = parameter(frame, "surfaceTone", 0.28);
  const colorMotion = frame.elapsedTime * parameter(frame, "surfaceColorMotion", 0.16);
  const positions = geometry.getAttribute("position").array;
  const colorValues = geometry.getAttribute("color").array;
  let offset = 0;

  for (let uIndex = 0; uIndex <= SURFACE_SEGMENTS; uIndex += 1) {
    const uRatio = uIndex / SURFACE_SEGMENTS;
    const u = TAU * uRatio;
    const longitudinal = 0.5 + 0.5 * Math.sin(u * 1.7 + colorMotion);
    for (let vIndex = 0; vIndex <= WIDTH_SEGMENTS; vIndex += 1) {
      const vRatio = vIndex / WIDTH_SEGMENTS;
      const v = -width + 2 * width * vRatio;
      writeMobiusPoint(positions, offset, u, v, halfTwists, phase);
      const crossBand = 0.5 + 0.5 * Math.sin(
        u * 0.72 - colorMotion * 0.6 + (vRatio - 0.5) * Math.PI
      );
      if (longitudinal < 0.5) {
        mixColorChannels(
          colorValues,
          offset,
          colors.foreground,
          colors.accent,
          longitudinal * 2,
          colors.background,
          tone * (0.8 + 0.2 * crossBand)
        );
      } else {
        mixColorChannels(
          colorValues,
          offset,
          colors.accent,
          colors.secondary,
          (longitudinal - 0.5) * 2,
          colors.background,
          tone * (0.8 + 0.2 * crossBand)
        );
      }
      offset += 3;
    }
  }

  geometry.getAttribute("position").needsUpdate = true;
  geometry.getAttribute("color").needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { halfTwists, width, phase };
}

const particleVertexShader = /* glsl */ `
  #define PI 3.141592653589793
  #define TAU 6.283185307179586

  attribute vec4 aSeed;
  attribute float aTrail;

  uniform float uTime;
  uniform float uSpeed;
  uniform float uSpeedVariation;
  uniform float uWidth;
  uniform float uHalfTwists;
  uniform float uSurfacePhase;
  uniform float uLanes;
  uniform float uReverseRatio;
  uniform float uTurbulence;
  uniform float uFieldFrequency;
  uniform float uTrailLength;
  uniform float uPointSize;
  uniform float uPixelRatio;
  uniform float uLift;
  uniform float uColorMotion;
  uniform float uExposure;
  uniform vec3 uForeground;
  uniform vec3 uAccent;
  uniform vec3 uSecondary;

  varying float vAlpha;
  varying vec3 vColor;

  vec3 mobiusPoint(float u, float v) {
    float crossSection = uHalfTwists * u * 0.5 + uSurfacePhase;
    float distanceFromCenter = 1.0 + v * cos(crossSection);
    return vec3(
      distanceFromCenter * cos(u),
      distanceFromCenter * sin(u),
      v * sin(crossSection)
    );
  }

  vec3 mobiusNormal(float u, float v) {
    float epsilon = 0.004;
    vec3 center = mobiusPoint(u, v);
    vec3 tangentU = mobiusPoint(u + epsilon, v) - center;
    vec3 tangentV = mobiusPoint(u, v + epsilon) - center;
    return normalize(cross(tangentU, tangentV));
  }

  void main() {
    float laneCount = max(3.0, floor(uLanes + 0.5));
    float lane = ((floor(aSeed.y * laneCount) + 0.5) / laneCount) * 2.0 - 1.0;
    float direction = aSeed.w < uReverseRatio ? -1.0 : 1.0;
    float speedFactor = mix(
      max(0.08, 1.0 - uSpeedVariation),
      1.0 + uSpeedVariation,
      aSeed.z
    );
    float headU = aSeed.x * TAU * 2.0 + uTime * uSpeed * speedFactor * direction;
    float u = headU - direction * aTrail * uTrailLength * (0.72 + speedFactor * 0.38);
    float wave = sin(
      u * uFieldFrequency + aSeed.x * TAU + uTime * uSpeed * 0.37 * direction
    );
    wave += 0.48 * sin(
      u * (uFieldFrequency * 0.57 + 0.8) - aSeed.z * TAU - uTime * uSpeed * 0.21
    );
    float normalizedV = clamp(lane + wave * uTurbulence * 0.22, -0.96, 0.96);
    float v = normalizedV * uWidth;
    vec3 point = mobiusPoint(u, v);
    vec3 normal = mobiusNormal(u, v);
    point += normal * uLift * mix(0.42, 1.0, 1.0 - aTrail);

    vec4 viewPosition = modelViewMatrix * vec4(point, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    float perspectiveSize = 8.0 / max(1.0, -viewPosition.z);
    float trailScale = mix(0.28, 1.0, pow(1.0 - aTrail, 0.62));
    gl_PointSize = clamp(
      uPointSize * uPixelRatio * perspectiveSize * trailScale,
      1.0,
      28.0
    );

    float speedColor = clamp(
      (speedFactor - max(0.08, 1.0 - uSpeedVariation)) /
      max(0.001, uSpeedVariation * 2.0),
      0.0,
      1.0
    );
    vec3 velocityColor = mix(uForeground, uAccent, smoothstep(0.0, 0.68, speedColor));
    velocityColor = mix(velocityColor, uSecondary, smoothstep(0.55, 1.0, speedColor));
    float chromaticWave = 0.5 + 0.5 * sin(
      u * 0.74 + normalizedV * PI + uTime * uColorMotion + aSeed.y * TAU
    );
    vColor = mix(velocityColor, mix(uAccent, uSecondary, chromaticWave), 0.34) * uExposure;
    vAlpha = pow(max(0.0, 1.0 - aTrail), 1.32) * (0.68 + 0.32 * aSeed.z);
  }
`;

const particleFragmentShader = /* glsl */ `
  uniform float uOpacity;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 point = gl_PointCoord * 2.0 - 1.0;
    float radius = length(point);
    float mask = 1.0 - smoothstep(0.58, 1.0, radius);
    float core = 1.0 - smoothstep(0.0, 0.54, radius);
    float alpha = mask * vAlpha * uOpacity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vColor * (0.86 + core * 0.24), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createParticleGeometry(THREE) {
  const vertexCount = MAX_PARTICLES * TRAIL_SAMPLES;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(vertexCount * 4), 4));
  geometry.setAttribute("aTrail", new THREE.BufferAttribute(new Float32Array(vertexCount), 1));
  geometry.setDrawRange(0, 0);
  return geometry;
}

function writeParticleSeeds(geometry, seed) {
  const random = createRandom(seed);
  const seedValues = geometry.getAttribute("aSeed").array;
  const trailValues = geometry.getAttribute("aTrail").array;

  for (let particleIndex = 0; particleIndex < MAX_PARTICLES; particleIndex += 1) {
    const seedA = random();
    const seedB = random();
    const seedC = random();
    const seedD = random();
    for (let trailIndex = 0; trailIndex < TRAIL_SAMPLES; trailIndex += 1) {
      const vertexIndex = particleIndex * TRAIL_SAMPLES + trailIndex;
      const offset = vertexIndex * 4;
      seedValues[offset] = seedA;
      seedValues[offset + 1] = seedB;
      seedValues[offset + 2] = seedC;
      seedValues[offset + 3] = seedD;
      trailValues[vertexIndex] = trailIndex / (TRAIL_SAMPLES - 1);
    }
  }

  geometry.getAttribute("aSeed").needsUpdate = true;
  geometry.getAttribute("aTrail").needsUpdate = true;
}

function createParticleUniforms(THREE) {
  return {
    uTime: { value: 0 },
    uSpeed: { value: 0.9 },
    uSpeedVariation: { value: 0.62 },
    uWidth: { value: 0.46 },
    uHalfTwists: { value: 1 },
    uSurfacePhase: { value: 0 },
    uLanes: { value: 11 },
    uReverseRatio: { value: 0.16 },
    uTurbulence: { value: 0.18 },
    uFieldFrequency: { value: 3.2 },
    uTrailLength: { value: 0.48 },
    uPointSize: { value: 1.65 },
    uPixelRatio: { value: 1 },
    uLift: { value: 0.012 },
    uColorMotion: { value: 0.34 },
    uExposure: { value: 1.08 },
    uOpacity: { value: 0.82 },
    uForeground: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() },
    uSecondary: { value: new THREE.Color() }
  };
}

async function createMobiusDynamicsRenderer(canvas) {
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
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const group = new THREE.Group();
  scene.add(group);

  const surfaceGeometry = createSurfaceGeometry(THREE);
  const surfaceMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.68,
    metalness: 0.08,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  });
  const surfaceMesh = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
  surfaceMesh.frustumCulled = false;
  surfaceMesh.renderOrder = 0;
  group.add(surfaceMesh);

  const particleGeometry = createParticleGeometry(THREE);
  const particleUniforms = createParticleUniforms(THREE);
  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: particleUniforms,
    vertexShader: particleVertexShader,
    fragmentShader: particleFragmentShader,
    transparent: true,
    blending: THREE.NormalBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.frustumCulled = false;
  particles.renderOrder = 1;
  group.add(particles);

  const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x12121a, 0.9);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
  keyLight.position.set(-2.8, -3.6, 5.2);
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.82);
  rimLight.position.set(3.2, 2.4, -4.4);
  scene.add(hemisphereLight, keyLight, rimLight);

  const backgroundColor = new THREE.Color();
  const foregroundColor = new THREE.Color();
  const accentColor = new THREE.Color();
  const secondaryColor = new THREE.Color();
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
  let currentSeed = null;
  let disposed = false;

  function resize(nextViewport) {
    viewport = { ...nextViewport };
    renderer.setPixelRatio(nextViewport.pixelRatio);
    renderer.setSize(nextViewport.width, nextViewport.height, false);
    particleUniforms.uPixelRatio.value = nextViewport.pixelRatio;
    camera.aspect = Math.max(0.0001, nextViewport.contentWidth / nextViewport.contentHeight);
    camera.updateProjectionMatrix();
  }

  function updateParticles(frame, surface) {
    const particleCount = clamp(
      Math.round(parameter(frame, "particleCount", 8000)),
      1000,
      MAX_PARTICLES
    );
    particleGeometry.setDrawRange(0, particleCount * TRAIL_SAMPLES);
    particleUniforms.uTime.value = frame.elapsedTime;
    particleUniforms.uSpeed.value = parameter(frame, "flowSpeed", 0.9);
    particleUniforms.uSpeedVariation.value = parameter(frame, "speedVariation", 0.62);
    particleUniforms.uWidth.value = surface.width;
    particleUniforms.uHalfTwists.value = surface.halfTwists;
    particleUniforms.uSurfacePhase.value = surface.phase;
    particleUniforms.uLanes.value = oddInteger(parameter(frame, "currents", 11), 11);
    particleUniforms.uReverseRatio.value = parameter(frame, "reverseFlow", 0.16);
    particleUniforms.uTurbulence.value = parameter(frame, "turbulence", 0.18);
    particleUniforms.uFieldFrequency.value = parameter(frame, "fieldFrequency", 3.2);
    particleUniforms.uTrailLength.value = parameter(frame, "trailLength", 0.48);
    particleUniforms.uPointSize.value = parameter(frame, "pointSize", 1.65);
    particleUniforms.uLift.value = parameter(frame, "flowLift", 0.012);
    particleUniforms.uColorMotion.value = parameter(frame, "colorMotion", 0.34);
    particleUniforms.uExposure.value = parameter(frame, "flowExposure", 1.08);
    particleUniforms.uOpacity.value = parameter(frame, "flowOpacity", 0.82);
    particleUniforms.uForeground.value.copy(foregroundColor);
    particleUniforms.uAccent.value.copy(accentColor);
    particleUniforms.uSecondary.value.copy(secondaryColor);
  }

  function render(frame) {
    if (disposed) return;
    if (currentSeed !== frame.seed) {
      writeParticleSeeds(particleGeometry, frame.seed);
      currentSeed = frame.seed;
    }

    backgroundColor.set(frame.palette.background);
    foregroundColor.set(frame.palette.foreground);
    accentColor.set(frame.palette.accent);
    secondaryColor.set(frame.palette.secondary ?? frame.palette.accent);
    const colors = {
      background: backgroundColor,
      foreground: foregroundColor,
      accent: accentColor,
      secondary: secondaryColor
    };
    const surface = updateSurfaceGeometry(surfaceGeometry, frame, colors);
    updateParticles(frame, surface);

    surfaceMaterial.opacity = parameter(frame, "surfaceOpacity", 0.92);
    surfaceMaterial.roughness = parameter(frame, "roughness", 0.68);
    surfaceMaterial.metalness = parameter(frame, "metalness", 0.08);
    const light = parameter(frame, "light", 1.2);
    hemisphereLight.intensity = 0.68 * light;
    keyLight.intensity = 1.55 * light;
    rimLight.intensity = 0.72 * light;

    const tilt = parameter(frame, "tilt", 57) * Math.PI / 180;
    const yaw = parameter(frame, "yaw", -14) * Math.PI / 180;
    const rotation = parameter(frame, "rotation", -30) * Math.PI / 180;
    group.rotation.set(tilt, yaw, rotation, "XYZ");
    group.rotation.y += frame.elapsedTime * parameter(frame, "sceneRotation", 0);

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

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, viewport.width, viewport.height);
    if (viewport.stageBackground) renderer.setClearColor(viewport.stageBackground, 1);
    else renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);

    const viewportY = viewport.height - viewport.contentY - viewport.contentHeight;
    renderer.setViewport(viewport.contentX, viewportY, viewport.contentWidth, viewport.contentHeight);
    renderer.setScissor(viewport.contentX, viewportY, viewport.contentWidth, viewport.contentHeight);
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
    particleGeometry.dispose();
    surfaceMaterial.dispose();
    particleMaterial.dispose();
    renderer.dispose();
  }

  return { resize, render, dispose };
}

export const mobiusFlowDynamicsProject = {
  id: PROJECT_ID,
  index: "05.2",
  name: "Möbius Flow Dynamics",
  label: "Cauce — Möbius Flow Dynamics",
  description: "Flujo continuo de partículas y estelas GPU sobre una banda de Möbius tridimensional.",
  backend: /** @type {"three"} */ ("three"),
  preferredFps: 60,
  preferredFormatKey: "square",
  preferredLoopSeconds: 10,
  preferredPlaybackMode: /** @type {"continuous"} */ ("continuous"),
  supportsContinuousTime: true,
  supportsLoopTime: false,
  viewControls: true,
  exportCapabilities: { svg: false, png: true, video: true, web: true },
  controls: [
    { key: "particleCount", label: "Partículas", min: 1000, max: 24000, step: 1000, defaultValue: 8000, digits: 0 },
    { key: "currents", label: "Cauces", min: 3, max: 35, step: 2, defaultValue: 11, digits: 0 },
    { key: "width", label: "Anchura de banda", min: 0.16, max: 0.72, step: 0.01, defaultValue: 0.46, digits: 2 },
    { key: "halfTwists", label: "Medias torsiones", min: 1, max: 5, step: 2, defaultValue: 1, digits: 0 },
    { key: "flowSpeed", label: "Velocidad de flujo", min: 0.05, max: 3, step: 0.05, defaultValue: 0.9, digits: 2 },
    { key: "speedVariation", label: "Variación de velocidad", min: 0, max: 0.92, step: 0.01, defaultValue: 0.62, digits: 2 },
    { key: "reverseFlow", label: "Flujo inverso", min: 0, max: 1, step: 0.01, defaultValue: 0.16, digits: 2 },
    { key: "turbulence", label: "Turbulencia superficial", min: 0, max: 0.9, step: 0.01, defaultValue: 0.18, digits: 2 },
    { key: "fieldFrequency", label: "Frecuencia del campo", min: 0.5, max: 9, step: 0.1, defaultValue: 3.2, digits: 1 },
    { key: "trailLength", label: "Longitud de estela", min: 0.04, max: 1.8, step: 0.01, defaultValue: 0.48, digits: 2 },
    { key: "pointSize", label: "Grosor del flujo", min: 0.5, max: 6, step: 0.05, defaultValue: 1.65, digits: 2 },
    { key: "flowLift", label: "Separación de superficie", min: 0, max: 0.05, step: 0.001, defaultValue: 0.012, digits: 3 },
    { key: "surfacePulse", label: "Pulso de superficie", min: 0, max: 0.2, step: 0.005, defaultValue: 0.025, digits: 3 },
    { key: "surfaceMotion", label: "Deriva de torsión", min: -0.3, max: 0.3, step: 0.005, defaultValue: 0.025, digits: 3 },
    { key: "sceneRotation", label: "Rotación espacial", min: -0.2, max: 0.2, step: 0.005, defaultValue: 0, digits: 3 },
    { key: "tilt", label: "Inclinación", min: -85, max: 85, step: 1, defaultValue: 57, digits: 0, suffix: "°" },
    { key: "yaw", label: "Giro 3D", min: -90, max: 90, step: 1, defaultValue: -14, digits: 0, suffix: "°" },
    { key: "rotation", label: "Rotación", min: -180, max: 180, step: 1, defaultValue: -30, digits: 0, suffix: "°" },
    { key: "fov", label: "Campo de visión", min: 20, max: 72, step: 1, defaultValue: 38, digits: 0, suffix: "°" },
    { key: "cameraDistance", label: "Distancia de cámara", min: 3.4, max: 8, step: 0.05, defaultValue: 5.1, digits: 2 },
    { key: "surfaceTone", label: "Tono de superficie", min: 0.05, max: 1, step: 0.01, defaultValue: 0.28, digits: 2, group: "color3d" },
    { key: "surfaceOpacity", label: "Opacidad de superficie", min: 0.08, max: 1, step: 0.01, defaultValue: 0.92, digits: 2, group: "color3d" },
    { key: "surfaceColorMotion", label: "Movimiento cromático superficie", min: -2, max: 2, step: 0.05, defaultValue: 0.16, digits: 2, group: "color3d" },
    { key: "roughness", label: "Rugosidad", min: 0.05, max: 1, step: 0.01, defaultValue: 0.68, digits: 2, group: "color3d" },
    { key: "metalness", label: "Metal", min: 0, max: 1, step: 0.01, defaultValue: 0.08, digits: 2, group: "color3d" },
    { key: "light", label: "Luz", min: 0.2, max: 2.5, step: 0.05, defaultValue: 1.2, digits: 2, group: "color3d" },
    { key: "flowOpacity", label: "Opacidad del flujo", min: 0.05, max: 1, step: 0.01, defaultValue: 0.82, digits: 2, group: "color3d" },
    { key: "flowExposure", label: "Exposición del flujo", min: 0.2, max: 2.5, step: 0.01, defaultValue: 1.08, digits: 2, group: "color3d" },
    { key: "colorMotion", label: "Movimiento cromático flujo", min: -3, max: 3, step: 0.05, defaultValue: 0.34, digits: 2, group: "color3d" }
  ],
  defaults: {
    particleCount: 8000,
    currents: 11,
    width: 0.46,
    halfTwists: 1,
    flowSpeed: 0.9,
    speedVariation: 0.62,
    reverseFlow: 0.16,
    turbulence: 0.18,
    fieldFrequency: 3.2,
    trailLength: 0.48,
    pointSize: 1.65,
    flowLift: 0.012,
    surfacePulse: 0.025,
    surfaceMotion: 0.025,
    sceneRotation: 0,
    tilt: 57,
    yaw: -14,
    rotation: -30,
    fov: 38,
    cameraDistance: 5.1,
    surfaceTone: 0.28,
    surfaceOpacity: 0.92,
    surfaceColorMotion: 0.16,
    roughness: 0.68,
    metalness: 0.08,
    light: 1.2,
    flowOpacity: 0.82,
    flowExposure: 1.08,
    colorMotion: 0.34
  },
  createRenderer: createMobiusDynamicsRenderer
};
