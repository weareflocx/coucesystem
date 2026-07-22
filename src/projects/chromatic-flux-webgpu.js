import { clamp, createRandom, parameter } from "./shared.js";
import { compositionMetrics } from "./composition.js";
import { createCauceWebGpuBackend } from "./webgpu-shared.js";

const PROJECT_ID = "chromatic-flux-webgpu";
const MAX_PARTICLES = 160000;
const TAU = Math.PI * 2;

function createSeedAttribute(THREE) {
  const attribute = new THREE.InstancedBufferAttribute(
    new Float32Array(MAX_PARTICLES * 4),
    4
  );
  attribute.setUsage(THREE.DynamicDrawUsage);
  return attribute;
}

function writeSeeds(attribute, seed) {
  const random = createRandom(seed);
  const values = attribute.array;
  for (let index = 0; index < MAX_PARTICLES; index += 1) {
    const offset = index * 4;
    values[offset] = random();
    values[offset + 1] = random();
    values[offset + 2] = random();
    values[offset + 3] = random();
  }
  attribute.needsUpdate = true;
}

function setDisplayColor(THREE, target, primary, palette, mixAmount, hueShift, saturation) {
  target.set(primary).lerp(new THREE.Color(palette), mixAmount);
  target.offsetHSL(hueShift / 360, 0, 0);
  const luminance = target.r * 0.2126 + target.g * 0.7152 + target.b * 0.0722;
  target.setRGB(
    luminance + (target.r - luminance) * saturation,
    luminance + (target.g - luminance) * saturation,
    luminance + (target.b - luminance) * saturation
  );
}

async function createChromaticFluxWebGpuRenderer(canvas) {
  const { THREE, renderer, backendName, flush } = await createCauceWebGpuBackend(canvas, {
    antialias: false,
    depth: true
  });
  const {
    acos,
    clamp: tslClamp,
    cos,
    float,
    instancedBufferAttribute,
    max: tslMax,
    mix: tslMix,
    sin,
    smoothstep,
    sqrt,
    uniform,
    uv,
    vec3
  } = await import("three/tsl");

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const group = new THREE.Group();
  scene.add(group);

  const seedAttribute = createSeedAttribute(THREE);
  const uniforms = {
    time: uniform(0),
    speed: uniform(1),
    structure: uniform(0),
    scale: uniform(1),
    turbulence: uniform(1),
    fieldFrequency: uniform(2.2),
    pointSize: uniform(1.35),
    organicDrift: uniform(0.72),
    rgbSplit: uniform(0.82),
    rgbSpread: uniform(0.15),
    exposure: uniform(1.08),
    opacity: uniform(0.68),
    colorFrequency: uniform(4),
    colorMotion: uniform(1),
    sphereDepth: uniform(0.92),
    specular: uniform(0.34)
  };

  function structurePosition(seedNode, timeNode) {
    const q = seedNode.xyz.mul(2).sub(1);
    const organicPhase = sin(
      timeNode.mul(seedNode.w.mul(0.021).add(0.031)).add(seedNode.y.mul(TAU))
    ).mul(uniforms.organicDrift);
    const drift = timeNode
      .mul(seedNode.w.mul(0.44).add(0.34))
      .add(organicPhase.mul(1.2));

    const cloud = vec3(
      q.x.mul(1.75).add(
        sin(q.y.mul(3.7).add(drift).add(seedNode.w.mul(TAU))).mul(0.42)
      ),
      q.y.mul(1.18).add(
        sin(q.z.mul(3.1).sub(drift.mul(0.83)).add(seedNode.x.mul(TAU))).mul(0.42)
      ),
      q.z.mul(1.28).add(
        cos(q.x.mul(3.5).add(drift.mul(0.71)).add(seedNode.y.mul(TAU))).mul(0.42)
      )
    );

    const majorAngle = seedNode.x.mul(TAU).add(drift.mul(0.22));
    const minorAngle = seedNode.y.mul(TAU).add(
      sin(drift.mul(0.37).add(seedNode.z.mul(TAU))).mul(0.34)
    );
    const majorRadius = q.z.mul(0.24).add(1.4);
    const minorRadius = sin(seedNode.w.mul(TAU).add(drift.mul(0.23))).mul(0.16).add(0.46);
    const torusRadius = majorRadius.add(minorRadius.mul(cos(minorAngle)));
    const torus = vec3(
      torusRadius.mul(cos(majorAngle)),
      minorRadius.mul(sin(minorAngle)),
      torusRadius.mul(sin(majorAngle))
    );

    const longitude = seedNode.x.mul(TAU).add(drift.mul(0.18));
    const latitude = acos(tslClamp(seedNode.y.mul(2).sub(1), -1, 1));
    const radius = q.z.mul(0.27).add(
      sin(drift.add(seedNode.w.mul(TAU))).mul(0.12)
    ).add(1.48);
    const sphere = vec3(
      sin(latitude).mul(cos(longitude)),
      cos(latitude),
      sin(latitude).mul(sin(longitude))
    ).mul(radius);

    const turns = seedNode.z.mul(2).add(3);
    const spiralAngle = seedNode.x.mul(turns).mul(TAU).add(drift.mul(TAU * 0.09));
    const spiralRadius = seedNode.y.mul(0.95).add(0.6);
    const spiral = vec3(
      spiralRadius.mul(cos(spiralAngle)),
      q.x.mul(2.25).add(sin(spiralAngle.mul(0.5).add(drift)).mul(0.18)),
      spiralRadius.mul(sin(spiralAngle))
    );

    const selected = uniforms.structure.lessThan(0.5).select(
      cloud,
      uniforms.structure.lessThan(1.5).select(
        torus,
        uniforms.structure.lessThan(2.5).select(sphere, spiral)
      )
    );
    const phase = drift.add(seedNode.w.mul(TAU));
    const frequency = uniforms.fieldFrequency;
    const curl = vec3(
      sin(selected.y.mul(frequency).add(phase)).sub(
        cos(selected.z.mul(frequency.mul(0.73)).sub(phase.mul(0.81)))
      ),
      sin(selected.z.mul(frequency.mul(0.91)).sub(phase.mul(0.67))).sub(
        cos(selected.x.mul(frequency).add(phase.mul(0.54)))
      ),
      sin(selected.x.mul(frequency.mul(0.78)).add(phase.mul(0.72))).sub(
        cos(selected.y.mul(frequency.mul(0.86)).sub(phase))
      )
    );
    return selected.add(curl.mul(uniforms.turbulence.mul(0.19))).mul(uniforms.scale);
  }

  const paletteColors = [
    uniform(new THREE.Color("#ff334f")),
    uniform(new THREE.Color("#4ee878")),
    uniform(new THREE.Color("#4176ff"))
  ];
  const primaryColors = [
    new THREE.Color("#ff334f"),
    new THREE.Color("#4ee878"),
    new THREE.Color("#4176ff")
  ];
  const sprites = [];
  const materials = [];

  for (let channel = 0; channel < 3; channel += 1) {
    const seedNode = instancedBufferAttribute(seedAttribute);
    const flowTime = uniforms.time.mul(uniforms.speed);
    const current = structurePosition(seedNode, flowTime);
    const following = structurePosition(seedNode, flowTime.add(0.018));
    const velocity = following.sub(current);
    const lateral = vec3(
      velocity.y.negate(),
      velocity.x,
      velocity.z.mul(0.25)
    ).add(vec3(0.00001)).normalize();
    const channelOffset = channel - 1;
    const splitVariation = seedNode.w.mul(0.72).add(0.58);
    const positionNode = current.add(
      lateral.mul(
        uniforms.rgbSpread
          .mul(uniforms.rgbSplit)
          .mul(splitVariation)
          .mul(channelOffset)
      )
    );

    const point = uv().mul(2).sub(1);
    const radiusSquared = point.dot(point);
    const circleMask = float(1).sub(smoothstep(0.68, 1, radiusSquared));
    const sphereZ = sqrt(tslMax(0, float(1).sub(radiusSquared)));
    const sphereNormal = vec3(point.x, point.y.negate(), sphereZ).normalize();
    const diffuse = sphereNormal.dot(vec3(-0.34, 0.48, 0.81).normalize()).max(0);
    const highlight = sphereNormal.dot(vec3(-0.18, 0.28, 1).normalize())
      .max(0)
      .pow(14)
      .mul(uniforms.specular);
    const sphereLight = diffuse.mul(0.78).add(0.28).add(highlight);
    const shading = tslMix(float(1), sphereLight, uniforms.sphereDepth);
    const colorWave = sin(
      seedNode.w.mul(TAU).mul(uniforms.colorFrequency)
        .add(uniforms.time.mul(uniforms.colorMotion))
        .add(seedNode.x.mul(Math.PI))
    ).mul(0.34).add(0.68);
    const neutral = vec3(1 / 3);
    const channelColor = tslMix(neutral, paletteColors[channel], uniforms.rgbSplit);
    const alphaPulse = sin(seedNode.y.mul(TAU).add(flowTime.mul(0.7))).mul(0.14).add(0.86);

    const material = new THREE.PointsNodeMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
      sizeAttenuation: true
    });
    material.positionNode = positionNode;
    material.sizeNode = uniforms.pointSize.mul(0.038).mul(seedNode.w.mul(0.36).add(0.82));
    material.colorNode = channelColor.mul(shading).mul(colorWave).mul(uniforms.exposure);
    material.opacityNode = circleMask.mul(uniforms.opacity).mul(alphaPulse);
    material.alphaTestNode = float(0.002);
    material.alphaToCoverage = true;

    const sprite = new THREE.Sprite(material);
    sprite.count = MAX_PARTICLES;
    sprite.frustumCulled = false;
    sprite.renderOrder = channel;
    materials.push(material);
    sprites.push(sprite);
    group.add(sprite);
  }

  const backgroundColor = new THREE.Color();
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
    camera.aspect = Math.max(0.0001, nextViewport.contentWidth / nextViewport.contentHeight);
    camera.updateProjectionMatrix();
  }

  function updateUniforms(frame) {
    uniforms.time.value = frame.elapsedTime;
    uniforms.speed.value = parameter(frame, "motionSpeed", 1);
    uniforms.structure.value = Math.round(parameter(frame, "structure", 0));
    uniforms.scale.value = parameter(frame, "scale", 1);
    uniforms.turbulence.value = parameter(frame, "turbulence", 1);
    uniforms.fieldFrequency.value = parameter(frame, "fieldFrequency", 2.2);
    uniforms.pointSize.value = parameter(frame, "pointSize", 1.35);
    uniforms.organicDrift.value = parameter(frame, "organicDrift", 0.72);
    uniforms.rgbSplit.value = parameter(frame, "rgbSplit", 0.82);
    uniforms.rgbSpread.value = parameter(frame, "rgbSpread", 0.15);
    uniforms.exposure.value = parameter(frame, "exposure", 1.08);
    uniforms.opacity.value = parameter(frame, "opacity", 0.68);
    uniforms.colorFrequency.value = parameter(frame, "colorFrequency", 4);
    uniforms.colorMotion.value = parameter(frame, "colorMotion", 1);
    uniforms.sphereDepth.value = parameter(frame, "sphereDepth", 0.92);
    uniforms.specular.value = parameter(frame, "specular", 0.34);

    const paletteMix = parameter(frame, "paletteMix", 0.42);
    const hueShift = parameter(frame, "hueShift", 0);
    const saturation = parameter(frame, "saturation", 1);
    const paletteTargets = [
      frame.palette.foreground,
      frame.palette.accent,
      frame.palette.secondary ?? frame.palette.accent
    ];
    for (let index = 0; index < paletteColors.length; index += 1) {
      setDisplayColor(
        THREE,
        paletteColors[index].value,
        primaryColors[index],
        paletteTargets[index],
        paletteMix,
        hueShift,
        saturation
      );
    }
  }

  function render(frame) {
    if (disposed) return;
    if (currentSeed !== frame.seed) {
      writeSeeds(seedAttribute, frame.seed);
      currentSeed = frame.seed;
    }
    updateUniforms(frame);
    const particleCount = clamp(
      Math.round(parameter(frame, "particleCount", 60000)),
      10000,
      MAX_PARTICLES
    );
    for (const sprite of sprites) sprite.count = particleCount;

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

    const organicDrift = parameter(frame, "organicDrift", 0.72);
    const seedPhase = (frame.seed % 997) / 997 * TAU;
    group.rotation.x = Math.sin(frame.elapsedTime * 0.061 + seedPhase) * organicDrift * 0.055;
    group.rotation.y = frame.elapsedTime * parameter(frame, "sceneRotation", 0.04) +
      Math.sin(frame.elapsedTime * 0.037 + seedPhase * 1.7) * organicDrift * 0.16;
    group.rotation.z = parameter(frame, "tilt", -7) * Math.PI / 180 +
      Math.sin(frame.elapsedTime * 0.049 + seedPhase * 0.73) * organicDrift * 0.045;

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
    for (const material of materials) material.dispose();
    renderer.dispose();
  }

  return { resize, render, flush, dispose, backendName };
}

export const chromaticFluxWebGpuProject = {
  id: PROJECT_ID,
  index: "08.2",
  name: "Chromatic Flux WebGPU",
  label: "Cauce — Chromatic Flux WebGPU",
  description: "Partículas esféricas calculadas con TSL y renderizadas mediante WebGPU, con fallback WebGL2 y evolución orgánica sin límite de previsualización.",
  backend: /** @type {"webgpu"} */ ("webgpu"),
  preferredFps: 60,
  preferredFormatKey: "landscape",
  preferredLoopSeconds: 10,
  preferredPlaybackMode: /** @type {"continuous"} */ ("continuous"),
  supportsContinuousTime: true,
  supportsLoopTime: false,
  supportsUnboundedPreviewTime: true,
  viewControls: true,
  exportCapabilities: { svg: false, png: true, video: true, web: true },
  controls: [
    { key: "particleCount", label: "Partículas por canal", min: 10000, max: 160000, step: 5000, defaultValue: 60000, digits: 0 },
    { key: "structure", label: "Forma base", min: 0, max: 3, step: 1, defaultValue: 0, digits: 0, options: [
      { value: 0, label: "Nebulosa", description: "Masa volumétrica libre deformada por un campo tridimensional." },
      { value: 1, label: "Anillo", description: "Corriente cerrada alrededor de un vacío central." },
      { value: 2, label: "Burbuja", description: "Envolvente esférica granular." },
      { value: 3, label: "Espiral", description: "Columna helicoidal con profundidad." }
    ] },
    { key: "scale", label: "Escala espacial", min: 0.55, max: 1.65, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "turbulence", label: "Turbulencia", min: 0, max: 2.5, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "fieldFrequency", label: "Frecuencia de campo", min: 0.5, max: 6, step: 0.05, defaultValue: 2.2, digits: 2 },
    { key: "motionSpeed", label: "Velocidad interna", min: 0.05, max: 3, step: 0.05, defaultValue: 1, digits: 2 },
    { key: "organicDrift", label: "Deriva orgánica", min: 0, max: 1.5, step: 0.01, defaultValue: 0.72, digits: 2 },
    { key: "sceneRotation", label: "Rotación espacial", min: -0.5, max: 0.5, step: 0.01, defaultValue: 0.04, digits: 2 },
    { key: "tilt", label: "Inclinación", min: -90, max: 90, step: 1, defaultValue: -7, digits: 0, suffix: "°" },
    { key: "pointSize", label: "Radio de partícula", min: 0.3, max: 5, step: 0.05, defaultValue: 1.35, digits: 2 },
    { key: "fov", label: "Campo de visión", min: 20, max: 75, step: 1, defaultValue: 42, digits: 0, suffix: "°" },
    { key: "cameraDistance", label: "Distancia de cámara", min: 3, max: 9, step: 0.05, defaultValue: 5.2, digits: 2 },
    { key: "rgbSplit", label: "Separación RGB", min: 0, max: 1, step: 0.01, defaultValue: 0.82, digits: 2, group: "color3d" },
    { key: "rgbSpread", label: "Distancia de canales", min: 0, max: 0.45, step: 0.005, defaultValue: 0.15, digits: 3, group: "color3d" },
    { key: "paletteMix", label: "Mezcla de paleta", min: 0, max: 1, step: 0.01, defaultValue: 0.42, digits: 2, group: "color3d" },
    { key: "hueShift", label: "Rotación de tono", min: -180, max: 180, step: 1, defaultValue: 0, digits: 0, suffix: "°", group: "color3d" },
    { key: "saturation", label: "Saturación", min: 0, max: 2, step: 0.01, defaultValue: 1, digits: 2, group: "color3d" },
    { key: "exposure", label: "Exposición", min: 0.2, max: 2.5, step: 0.01, defaultValue: 1.08, digits: 2, group: "color3d" },
    { key: "opacity", label: "Densidad", min: 0.02, max: 1, step: 0.01, defaultValue: 0.68, digits: 2, group: "color3d" },
    { key: "sphereDepth", label: "Relieve esférico", min: 0, max: 1, step: 0.01, defaultValue: 0.92, digits: 2, group: "color3d" },
    { key: "specular", label: "Brillo de partícula", min: 0, max: 1.5, step: 0.01, defaultValue: 0.34, digits: 2, group: "color3d" },
    { key: "colorFrequency", label: "Frecuencia cromática", min: 0, max: 16, step: 0.25, defaultValue: 4, digits: 2, group: "color3d" },
    { key: "colorMotion", label: "Movimiento cromático", min: -6, max: 6, step: 0.1, defaultValue: 1, digits: 1, group: "color3d" }
  ],
  defaults: {
    particleCount: 60000,
    structure: 0,
    scale: 1,
    turbulence: 1,
    fieldFrequency: 2.2,
    motionSpeed: 1,
    organicDrift: 0.72,
    sceneRotation: 0.04,
    tilt: -7,
    pointSize: 1.35,
    fov: 42,
    cameraDistance: 5.2,
    rgbSplit: 0.82,
    rgbSpread: 0.15,
    paletteMix: 0.42,
    hueShift: 0,
    saturation: 1,
    exposure: 1.08,
    opacity: 0.68,
    sphereDepth: 0.92,
    specular: 0.34,
    colorFrequency: 4,
    colorMotion: 1
  },
  createRenderer: createChromaticFluxWebGpuRenderer
};
