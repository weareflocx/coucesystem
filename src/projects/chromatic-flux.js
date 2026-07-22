import { clamp, createRandom, parameter } from "./shared.js";
import { compositionMetrics } from "./composition.js";

const PROJECT_ID = "chromatic-flux";
const MAX_PARTICLES = 120000;

const vertexShader = /* glsl */ `
  #define PI 3.141592653589793
  #define TAU 6.283185307179586

  attribute vec4 aSeed;

  uniform float uTime;
  uniform float uSpeed;
  uniform float uStructure;
  uniform float uScale;
  uniform float uTurbulence;
  uniform float uFieldFrequency;
  uniform float uPointSize;
  uniform float uVectorLength;
  uniform float uShape;
  uniform float uPixelRatio;
  uniform float uChannel;
  uniform float uRgbSplit;
  uniform float uRgbSpread;
  uniform float uPaletteMix;
  uniform float uHueShift;
  uniform float uSaturation;
  uniform float uExposure;
  uniform float uColorFrequency;
  uniform float uColorMotion;
  uniform vec3 uPalette0;
  uniform vec3 uPalette1;
  uniform vec3 uPalette2;

  varying float vAngle;
  varying float vShape;
  varying float vVectorLength;
  varying float vAlphaPulse;
  varying vec3 vColor;

  vec3 hueRotate(vec3 color, float angle) {
    vec3 axis = normalize(vec3(1.0));
    float cosine = cos(angle);
    return color * cosine + cross(axis, color) * sin(angle) + axis * dot(axis, color) * (1.0 - cosine);
  }

  vec3 structurePosition(float time) {
    vec3 q = aSeed.xyz * 2.0 - 1.0;
    float drift = time * (0.34 + aSeed.w * 0.44);
    vec3 p;

    if (uStructure < 0.5) {
      p = vec3(q.x * 1.75, q.y * 1.18, q.z * 1.28);
      p += 0.42 * vec3(
        sin(q.y * 3.7 + drift + aSeed.w * TAU),
        sin(q.z * 3.1 - drift * 0.83 + aSeed.x * TAU),
        cos(q.x * 3.5 + drift * 0.71 + aSeed.y * TAU)
      );
    } else if (uStructure < 1.5) {
      float majorAngle = TAU * aSeed.x + drift * 0.22;
      float minorAngle = TAU * aSeed.y + sin(drift * 0.37 + aSeed.z * TAU) * 0.34;
      float majorRadius = 1.4 + 0.24 * q.z;
      float minorRadius = 0.46 + 0.16 * sin(aSeed.w * TAU + drift * 0.23);
      p = vec3(
        (majorRadius + minorRadius * cos(minorAngle)) * cos(majorAngle),
        minorRadius * sin(minorAngle),
        (majorRadius + minorRadius * cos(minorAngle)) * sin(majorAngle)
      );
    } else if (uStructure < 2.5) {
      float longitude = TAU * aSeed.x + drift * 0.18;
      float latitude = acos(clamp(2.0 * aSeed.y - 1.0, -1.0, 1.0));
      float radius = 1.48 + 0.27 * q.z + 0.12 * sin(drift + aSeed.w * TAU);
      p = radius * vec3(
        sin(latitude) * cos(longitude),
        cos(latitude),
        sin(latitude) * sin(longitude)
      );
    } else {
      float turns = 3.0 + 2.0 * aSeed.z;
      float angle = TAU * (turns * aSeed.x + drift * 0.09);
      float radius = 0.6 + 0.95 * aSeed.y;
      float vertical = q.x * 2.25;
      p = vec3(
        radius * cos(angle),
        vertical + 0.18 * sin(angle * 0.5 + drift),
        radius * sin(angle)
      );
    }

    float frequency = uFieldFrequency;
    float phase = drift + aSeed.w * TAU;
    vec3 curl = vec3(
      sin(p.y * frequency + phase) - cos(p.z * frequency * 0.73 - phase * 0.81),
      sin(p.z * frequency * 0.91 - phase * 0.67) - cos(p.x * frequency + phase * 0.54),
      sin(p.x * frequency * 0.78 + phase * 0.72) - cos(p.y * frequency * 0.86 - phase)
    );
    return (p + curl * (0.19 * uTurbulence)) * uScale;
  }

  vec3 channelPrimary(float channel) {
    if (channel < 0.5) return vec3(1.0, 0.0, 0.0);
    if (channel < 1.5) return vec3(0.0, 1.0, 0.0);
    return vec3(0.0, 0.0, 1.0);
  }

  vec3 channelPalette(float channel) {
    if (channel < 0.5) return uPalette0;
    if (channel < 1.5) return uPalette1;
    return uPalette2;
  }

  void main() {
    float flowTime = uTime * uSpeed;
    vec3 current = structurePosition(flowTime);
    vec3 following = structurePosition(flowTime + 0.018);
    vec3 velocity = following - current;

    vec4 worldCurrent = modelMatrix * vec4(current, 1.0);
    vec4 worldFollowing = modelMatrix * vec4(following, 1.0);
    vec3 viewDirection = normalize(cameraPosition - worldCurrent.xyz);
    vec3 lateral = cross(normalize(velocity + vec3(0.00001)), viewDirection);
    float lateralLength = length(lateral);
    if (lateralLength < 0.0001) lateral = vec3(1.0, 0.0, 0.0);
    else lateral /= lateralLength;

    float channelOffset = uChannel - 1.0;
    float splitVariation = 0.58 + aSeed.w * 0.72;
    worldCurrent.xyz += lateral * channelOffset * uRgbSpread * uRgbSplit * splitVariation;

    vec4 viewCurrent = viewMatrix * worldCurrent;
    vec4 clipCurrent = projectionMatrix * viewCurrent;
    vec4 clipFollowing = projectionMatrix * viewMatrix * worldFollowing;
    vec2 screenCurrent = clipCurrent.xy / max(0.0001, clipCurrent.w);
    vec2 screenFollowing = clipFollowing.xy / max(0.0001, clipFollowing.w);
    vec2 screenVelocity = screenFollowing - screenCurrent;
    vAngle = atan(screenVelocity.y, screenVelocity.x);

    gl_Position = clipCurrent;
    float glyphScale = uShape > 0.5 && uShape < 1.5 ? uVectorLength : 1.0;
    float perspectiveSize = 8.0 / max(1.0, -viewCurrent.z);
    gl_PointSize = clamp(uPointSize * uPixelRatio * glyphScale * perspectiveSize, 1.0, 72.0);

    vec3 primary = hueRotate(channelPrimary(uChannel), radians(uHueShift));
    vec3 paletteColor = hueRotate(channelPalette(uChannel), radians(uHueShift));
    vec3 targetColor = mix(primary, paletteColor, uPaletteMix);
    float luminance = dot(targetColor, vec3(0.2126, 0.7152, 0.0722));
    targetColor = mix(vec3(luminance), targetColor, uSaturation);
    float wave = 0.68 + 0.34 * sin(
      aSeed.w * TAU * uColorFrequency + uTime * uColorMotion + aSeed.x * PI
    );
    vec3 neutralLayer = vec3(1.0 / 3.0);
    vColor = mix(neutralLayer, targetColor, uRgbSplit) * wave * uExposure;
    vShape = uShape;
    vVectorLength = uVectorLength;
    vAlphaPulse = 0.72 + 0.28 * sin(aSeed.y * TAU + flowTime * 0.7);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uOpacity;

  varying float vAngle;
  varying float vShape;
  varying float vVectorLength;
  varying float vAlphaPulse;
  varying vec3 vColor;

  void main() {
    vec2 point = gl_PointCoord * 2.0 - 1.0;
    float cosine = cos(-vAngle);
    float sine = sin(-vAngle);
    vec2 rotated = mat2(cosine, -sine, sine, cosine) * point;
    float mask;

    if (vShape < 0.5) {
      mask = 1.0 - smoothstep(0.72, 1.0, length(point));
    } else if (vShape < 1.5) {
      rotated.y *= vVectorLength;
      float capsule = length(vec2(max(abs(rotated.x) - 0.68, 0.0), rotated.y)) - 0.17;
      mask = 1.0 - smoothstep(0.0, 0.14, capsule);
    } else {
      float diamond = abs(point.x) + abs(point.y);
      mask = 1.0 - smoothstep(0.72, 1.0, diamond);
    }

    float alpha = mask * uOpacity * vAlphaPulse;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createParticleGeometry(THREE) {
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const seeds = new Float32Array(MAX_PARTICLES * 4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
  geometry.setDrawRange(0, 0);
  return geometry;
}

function writeSeedGeometry(geometry, seed) {
  const random = createRandom(seed);
  const positionValues = geometry.getAttribute("position").array;
  const seedValues = geometry.getAttribute("aSeed").array;
  for (let index = 0; index < MAX_PARTICLES; index += 1) {
    const positionOffset = index * 3;
    const seedOffset = index * 4;
    const x = random();
    const y = random();
    const z = random();
    const w = random();
    positionValues[positionOffset] = x * 2 - 1;
    positionValues[positionOffset + 1] = y * 2 - 1;
    positionValues[positionOffset + 2] = z * 2 - 1;
    seedValues[seedOffset] = x;
    seedValues[seedOffset + 1] = y;
    seedValues[seedOffset + 2] = z;
    seedValues[seedOffset + 3] = w;
  }
  geometry.getAttribute("position").needsUpdate = true;
  geometry.getAttribute("aSeed").needsUpdate = true;
}

function createUniforms(THREE, channel) {
  return {
    uTime: { value: 0 },
    uSpeed: { value: 1 },
    uStructure: { value: 0 },
    uScale: { value: 1 },
    uTurbulence: { value: 1 },
    uFieldFrequency: { value: 2.2 },
    uPointSize: { value: 1.35 },
    uVectorLength: { value: 7.5 },
    uShape: { value: 1 },
    uPixelRatio: { value: 1 },
    uChannel: { value: channel },
    uRgbSplit: { value: 0.88 },
    uRgbSpread: { value: 0.18 },
    uPaletteMix: { value: 0.35 },
    uHueShift: { value: 0 },
    uSaturation: { value: 1 },
    uExposure: { value: 1.15 },
    uColorFrequency: { value: 4 },
    uColorMotion: { value: 1 },
    uOpacity: { value: 0.32 },
    uPalette0: { value: new THREE.Color(1, 0, 0) },
    uPalette1: { value: new THREE.Color(0, 1, 0) },
    uPalette2: { value: new THREE.Color(0, 0, 1) }
  };
}

async function createChromaticFluxRenderer(canvas) {
  const THREE = await import("three");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    depth: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance"
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const group = new THREE.Group();
  scene.add(group);

  const geometry = createParticleGeometry(THREE);
  const materials = [];
  for (let channel = 0; channel < 3; channel += 1) {
    const material = new THREE.ShaderMaterial({
      uniforms: createUniforms(THREE, channel),
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      toneMapped: false
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = channel;
    materials.push(material);
    group.add(points);
  }

  const cameraTarget = new THREE.Vector3();
  const backgroundColor = new THREE.Color();
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
    camera.aspect = Math.max(0.0001, nextViewport.contentWidth / nextViewport.contentHeight);
    camera.updateProjectionMatrix();
  }

  function updateUniforms(frame) {
    const paletteColors = [
      frame.palette.foreground,
      frame.palette.accent,
      frame.palette.secondary ?? frame.palette.foreground
    ];
    for (const material of materials) {
      const uniforms = material.uniforms;
      uniforms.uTime.value = frame.elapsedTime;
      uniforms.uSpeed.value = parameter(frame, "motionSpeed", 1);
      uniforms.uStructure.value = Math.round(parameter(frame, "structure", 0));
      uniforms.uScale.value = parameter(frame, "scale", 1);
      uniforms.uTurbulence.value = parameter(frame, "turbulence", 1);
      uniforms.uFieldFrequency.value = parameter(frame, "fieldFrequency", 2.2);
      uniforms.uPointSize.value = parameter(frame, "pointSize", 1.35);
      uniforms.uVectorLength.value = parameter(frame, "vectorLength", 7.5);
      uniforms.uShape.value = Math.round(parameter(frame, "shape", 1));
      uniforms.uPixelRatio.value = viewport.pixelRatio;
      uniforms.uRgbSplit.value = parameter(frame, "rgbSplit", 0.88);
      uniforms.uRgbSpread.value = parameter(frame, "rgbSpread", 0.18);
      uniforms.uPaletteMix.value = parameter(frame, "paletteMix", 0.35);
      uniforms.uHueShift.value = parameter(frame, "hueShift", 0);
      uniforms.uSaturation.value = parameter(frame, "saturation", 1);
      uniforms.uExposure.value = parameter(frame, "exposure", 1.15);
      uniforms.uColorFrequency.value = parameter(frame, "colorFrequency", 4);
      uniforms.uColorMotion.value = parameter(frame, "colorMotion", 1);
      uniforms.uOpacity.value = parameter(frame, "opacity", 0.32);
      uniforms.uPalette0.value.set(paletteColors[0]);
      uniforms.uPalette1.value.set(paletteColors[1]);
      uniforms.uPalette2.value.set(paletteColors[2]);
    }
  }

  function render(frame) {
    if (disposed) return;
    if (currentSeed !== frame.seed) {
      writeSeedGeometry(geometry, frame.seed);
      currentSeed = frame.seed;
    }
    geometry.setDrawRange(0, clamp(
      Math.round(parameter(frame, "particleCount", 60000)),
      10000,
      MAX_PARTICLES
    ));
    updateUniforms(frame);

    const view = frame.view ?? {};
    const orbitYaw = (Number.isFinite(view.orbitYaw) ? view.orbitYaw : 0) * Math.PI / 180;
    const orbitPitch = (Number.isFinite(view.orbitPitch) ? view.orbitPitch : 0) * Math.PI / 180;
    const zoom = Number.isFinite(view.zoom) ? clamp(view.zoom, 0.35, 4) : 1;
    const formatAspect = compositionMetrics(frame).aspect;
    const formatDistance = formatAspect < 1
      ? Math.pow(1 / formatAspect, 0.18)
      : Math.pow(formatAspect, -0.05);
    const distance = parameter(frame, "cameraDistance", 5.2) * formatDistance / zoom;
    const cosinePitch = Math.cos(orbitPitch);
    cameraTarget.set(
      -(Number.isFinite(view.panX) ? view.panX : 0) * 3,
      (Number.isFinite(view.panY) ? view.panY : 0) * 3,
      0
    );
    camera.fov = parameter(frame, "fov", 42);
    camera.position.set(
      cameraTarget.x + Math.sin(orbitYaw) * cosinePitch * distance,
      cameraTarget.y + Math.sin(orbitPitch) * distance,
      cameraTarget.z + Math.cos(orbitYaw) * cosinePitch * distance
    );
    camera.lookAt(cameraTarget);
    camera.updateProjectionMatrix();

    group.rotation.y = frame.elapsedTime * parameter(frame, "sceneRotation", 0.04);
    group.rotation.z = parameter(frame, "tilt", -7) * Math.PI / 180;

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, viewport.width, viewport.height);
    if (viewport.stageBackground) renderer.setClearColor(viewport.stageBackground, 1);
    else renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);

    const viewportY = viewport.height - viewport.contentY - viewport.contentHeight;
    renderer.setViewport(viewport.contentX, viewportY, viewport.contentWidth, viewport.contentHeight);
    renderer.setScissor(viewport.contentX, viewportY, viewport.contentWidth, viewport.contentHeight);
    renderer.setScissorTest(true);
    backgroundColor.set(frame.palette.background);
    renderer.setClearColor(backgroundColor, frame.transparent ? 0 : 1);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    geometry.dispose();
    for (const material of materials) material.dispose();
    renderer.dispose();
  }

  return { resize, render, dispose };
}

export const chromaticFluxProject = {
  id: PROJECT_ID,
  index: "08",
  name: "Chromatic Flux",
  label: "Cauce — Chromatic Flux",
  description: "Campo espacial continuo de partículas y vectores con separación RGB calculada íntegramente en GPU.",
  backend: /** @type {"three"} */ ("three"),
  preferredFps: 60,
  preferredFormatKey: "landscape",
  preferredLoopSeconds: 10,
  preferredPlaybackMode: /** @type {"continuous"} */ ("continuous"),
  supportsContinuousTime: true,
  supportsLoopTime: false,
  viewControls: true,
  exportCapabilities: { svg: false, png: true, video: true, web: true },
  controls: [
    { key: "particleCount", label: "Partículas", min: 10000, max: 120000, step: 5000, defaultValue: 40000, digits: 0 },
    { key: "structure", label: "Forma base", min: 0, max: 3, step: 1, defaultValue: 0, digits: 0, options: [
      { value: 0, label: "Nebulosa", description: "Masa volumétrica libre que se deforma y deriva." },
      { value: 1, label: "Anillo", description: "Órbita cerrada alrededor de un vacío central." },
      { value: 2, label: "Burbuja", description: "Piel esférica con profundidad y volumen." },
      { value: 3, label: "Espiral", description: "Columna helicoidal que se abre al girar." }
    ] },
    { key: "shape", label: "Geometría", min: 0, max: 2, step: 1, defaultValue: 1, digits: 0, options: [
      { value: 0, label: "Punto", description: "Partículas circulares de luz." },
      { value: 1, label: "Vector", description: "Trazos orientados por el movimiento del campo." },
      { value: 2, label: "Diamante", description: "Partículas angulares con un borde más gráfico." }
    ] },
    { key: "scale", label: "Escala espacial", min: 0.55, max: 1.65, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "turbulence", label: "Turbulencia", min: 0, max: 2.5, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "fieldFrequency", label: "Frecuencia de campo", min: 0.5, max: 6, step: 0.05, defaultValue: 2.2, digits: 2 },
    { key: "motionSpeed", label: "Velocidad interna", min: 0.05, max: 3, step: 0.05, defaultValue: 1, digits: 2 },
    { key: "sceneRotation", label: "Rotación espacial", min: -0.5, max: 0.5, step: 0.01, defaultValue: 0.04, digits: 2 },
    { key: "tilt", label: "Inclinación", min: -90, max: 90, step: 1, defaultValue: -7, digits: 0, suffix: "°" },
    { key: "pointSize", label: "Tamaño", min: 0.5, max: 5, step: 0.05, defaultValue: 1.35, digits: 2 },
    { key: "vectorLength", label: "Longitud vector", min: 1.5, max: 12, step: 0.1, defaultValue: 7.5, digits: 1 },
    { key: "fov", label: "Campo de visión", min: 20, max: 75, step: 1, defaultValue: 42, digits: 0, suffix: "°" },
    { key: "cameraDistance", label: "Distancia de cámara", min: 3, max: 9, step: 0.05, defaultValue: 5.2, digits: 2 },
    { key: "rgbSplit", label: "Separación RGB", min: 0, max: 1, step: 0.01, defaultValue: 0.88, digits: 2, group: "color3d" },
    { key: "rgbSpread", label: "Distancia de canales", min: 0, max: 0.45, step: 0.005, defaultValue: 0.18, digits: 3, group: "color3d" },
    { key: "paletteMix", label: "Mezcla de paleta", min: 0, max: 1, step: 0.01, defaultValue: 0.35, digits: 2, group: "color3d" },
    { key: "hueShift", label: "Rotación de tono", min: -180, max: 180, step: 1, defaultValue: 0, digits: 0, suffix: "°", group: "color3d" },
    { key: "saturation", label: "Saturación", min: 0, max: 2, step: 0.01, defaultValue: 1, digits: 2, group: "color3d" },
    { key: "exposure", label: "Exposición", min: 0.2, max: 2.5, step: 0.01, defaultValue: 1.15, digits: 2, group: "color3d" },
    { key: "opacity", label: "Densidad luminosa", min: 0.02, max: 0.8, step: 0.01, defaultValue: 0.32, digits: 2, group: "color3d" },
    { key: "colorFrequency", label: "Frecuencia cromática", min: 0, max: 16, step: 0.25, defaultValue: 4, digits: 2, group: "color3d" },
    { key: "colorMotion", label: "Movimiento cromático", min: -6, max: 6, step: 0.1, defaultValue: 1, digits: 1, group: "color3d" }
  ],
  defaults: {
    particleCount: 40000,
    structure: 0,
    shape: 1,
    scale: 1,
    turbulence: 1,
    fieldFrequency: 2.2,
    motionSpeed: 1,
    sceneRotation: 0.04,
    tilt: -7,
    pointSize: 1.35,
    vectorLength: 7.5,
    fov: 42,
    cameraDistance: 5.2,
    rgbSplit: 0.88,
    rgbSpread: 0.18,
    paletteMix: 0.35,
    hueShift: 0,
    saturation: 1,
    exposure: 1.15,
    opacity: 0.32,
    colorFrequency: 4,
    colorMotion: 1
  },
  createRenderer: createChromaticFluxRenderer
};
