import { clamp, parameter } from "../shared.js";
import { compositionMetrics } from "../composition.js";
import { createFlowRoundedBoxGeometry } from "../fluid-visual-geometries.js";
import {
  createCauceGpuTiming,
  createCauceWebGpuBackend,
  getCauceWebGpuCapabilities
} from "../webgpu-shared.js";
import {
  CAUCE_FLUID_GRID_SIZE as GRID_SIZE,
  createCauceFluidEngine,
  getCauceFluidCapacityForCount
} from "../../engine/fluid/cauce-fluid-engine.js";

function fixedAppearanceStops(frame) {
  const paint = frame.appearance?.paint;
  if (paint?.type === "solid") {
    return {
      colors: Array.from({ length: 4 }, () => paint.color),
      positions: [0, 1 / 3, 2 / 3, 1]
    };
  }
  if (paint?.type === "gradient" && paint.stops.length > 0) {
    const supplied = paint.stops
      .map((stop) => ({ position: clamp(stop.position, 0, 1), color: stop.color }))
      .sort((left, right) => left.position - right.position);
    while (supplied.length < 4) supplied.push({ ...supplied[supplied.length - 1] });
    return {
      colors: supplied.slice(0, 4).map((stop) => stop.color),
      positions: supplied.slice(0, 4).map((stop) => stop.position)
    };
  }
  return {
    colors: [
      frame.palette.foreground,
      frame.palette.accent,
      frame.palette.secondary ?? frame.palette.accent,
      frame.palette.secondary ?? frame.palette.accent
    ],
    positions: [0, 0.46, 1, 1]
  };
}

export async function createChromaticFluidRuntime(canvas, options = {}) {
  const { THREE, renderer, backendName, flush } = await createCauceWebGpuBackend(canvas, {
    antialias: false,
    depth: true,
    requireWebGpu: true,
    trackTimestamp: options.diagnosticsEnabled === true,
    requiredLimits: { maxStorageBuffersInVertexStage: 1 }
  });
  const gpuTiming = createCauceGpuTiming(THREE, renderer, {
    enabled: options.diagnosticsEnabled === true,
    intervalFrames: 30,
    recentLimit: 5
  });
  const TSL = await import("three/tsl");
  const { mergeVertices } = await import("three/addons/utils/BufferGeometryUtils.js");
  const {
    Fn,
    If,
    attribute,
    float,
    floor,
    instanceIndex,
    int,
    mat3,
    max: tslMax,
    mix,
    normalLocal,
    uniform,
    varyingProperty,
    vec3
  } = TSL;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 8);
  const cameraTarget = new THREE.Vector3(0, 0.5, 0.18);
  camera.position.set(0, 0.5, -1.45);
  camera.lookAt(cameraTarget);

  const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x080b14, 0.9);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(-1.8, 2.6, -2.4);
  scene.add(hemisphereLight, keyLight);

  const initialParticleCount = Number(options.initialParticleCount) || 32768;
  const capacity = getCauceFluidCapacityForCount(initialParticleCount);
  const resetMode = options.fluidResetMode === "gpu-v2" ? options.fluidResetMode : "legacy-cpu";
  const fluid = createCauceFluidEngine({
    THREE,
    TSL,
    renderer,
    capacity,
    visualMode: "none",
    resetMode
  });
  const { particleBuffer, uniforms: physicsUniforms } = fluid;
  if (fluid.visualBuffer !== null) {
    throw new Error("Chromatic Fluid no debe reservar el buffer visual de Flow Cauce.");
  }

  const renderUniforms = {
    size: uniform(1),
    shapeMode: uniform(0),
    flowLength: uniform(1),
    simulationTime: uniform(0),
    colorBehavior: uniform(0),
    colorDrift: uniform(0.045),
    solidPaint: uniform(0),
    foreground: uniform(new THREE.Color("#f4f3ee")),
    accent: uniform(new THREE.Color("#aeb7ff")),
    middle: uniform(new THREE.Color("#8ecfc2")),
    secondary: uniform(new THREE.Color("#8ecfc2")),
    stop1: uniform(0.46),
    stop2: uniform(0.74),
    metalness: uniform(0.08),
    roughness: uniform(0.38),
    clearcoat: uniform(0.4)
  };

  const samplePalette = Fn(([position]) => {
    const value = position.clamp(0, 1);
    const stop1 = renderUniforms.stop1.clamp(0.0001, 0.9998);
    const stop2 = renderUniforms.stop2.clamp(stop1.add(0.0001), 0.9999);
    const low = mix(
      renderUniforms.foreground,
      renderUniforms.accent,
      value.div(tslMax(stop1, 0.0001)).clamp(0, 1)
    );
    const middle = mix(
      renderUniforms.accent,
      renderUniforms.middle,
      value.sub(stop1).div(tslMax(stop2.sub(stop1), 0.0001)).clamp(0, 1)
    );
    const high = mix(
      renderUniforms.middle,
      renderUniforms.secondary,
      value.sub(stop2).div(tslMax(float(1).sub(stop2), 0.0001)).clamp(0, 1)
    );
    return value.lessThan(stop1).select(
      low,
      value.lessThan(stop2).select(middle, high)
    );
  }).setLayout({
    name: "chromaticFluidSamplePalette",
    type: "vec3",
    inputs: [{ name: "position", type: "float" }]
  });

  const hsvToRgb = Fn(([hsv]) => {
    const saturation = hsv.y;
    const value = hsv.z;
    const result = vec3().toVar();
    const hue = hsv.x.sub(floor(hsv.x)).mul(6).toConst();
    const hueIndex = int(hue).toConst();
    const fraction = hue.sub(float(hueIndex)).toConst();
    const p = value.mul(saturation.oneMinus()).toConst();
    const q = value.mul(saturation.mul(fraction).oneMinus()).toConst();
    const t = value.mul(saturation.mul(fraction.oneMinus()).oneMinus()).toConst();
    If(saturation.lessThan(0.0001), () => result.assign(vec3(value)))
      .ElseIf(hueIndex.equal(int(0)), () => result.assign(vec3(value, t, p)))
      .ElseIf(hueIndex.equal(int(1)), () => result.assign(vec3(q, value, p)))
      .ElseIf(hueIndex.equal(int(2)), () => result.assign(vec3(p, value, t)))
      .ElseIf(hueIndex.equal(int(3)), () => result.assign(vec3(p, q, value)))
      .ElseIf(hueIndex.equal(int(4)), () => result.assign(vec3(t, p, value)))
      .Else(() => result.assign(vec3(value, p, q)));
    return result;
  }).setLayout({
    name: "chromaticFluidHsvToRgb",
    type: "vec3",
    inputs: [{ name: "hsv", type: "vec3" }]
  });

  const flowSourceGeometry = createFlowRoundedBoxGeometry(THREE);
  const rawSphereGeometry = new THREE.IcosahedronGeometry(0.42, 1);
  rawSphereGeometry.deleteAttribute("uv");
  const sphereSourceGeometry = mergeVertices(rawSphereGeometry);
  rawSphereGeometry.dispose();
  const particleGeometries = [flowSourceGeometry, sphereSourceGeometry].map((source) => {
    const geometry = new THREE.InstancedBufferGeometry().copy(source);
    geometry.instanceCount = initialParticleCount;
    source.dispose();
    return geometry;
  });
  let activeGeometryIndex = 0;

  const particleNormal = varyingProperty("vec3", "chromaticFluidNormal");
  const colorPosition = varyingProperty("float", "chromaticFluidColorPosition");
  const hsvColor = varyingProperty("vec3", "chromaticFluidHsvColor");
  const surfaceLight = varyingProperty("float", "chromaticFluidSurfaceLight");
  const particleMaterial = new THREE.MeshPhysicalNodeMaterial();
  particleMaterial.transparent = false;
  particleMaterial.depthWrite = true;
  particleMaterial.depthTest = true;
  particleMaterial.blending = THREE.NormalBlending;
  particleMaterial.positionNode = Fn(() => {
    const particle = particleBuffer.element(instanceIndex);
    const particlePosition = particle.get("position");
    const particleVelocity = particle.get("velocity");
    const densityRatio = particle.get("density")
      .div(physicsUniforms.restDensity)
      .clamp(0, 2);
    const velocityMagnitude = particleVelocity.length().clamp(0, 1.5);
    const forward = particleVelocity.add(vec3(0.00001)).normalize().toVar();
    const reference = forward.z.abs().greaterThan(0.98).select(vec3(0, 1, 0), vec3(0, 0, 1));
    const right = forward.cross(reference).add(vec3(0.00001)).normalize().negate();
    const up = right.cross(forward).add(vec3(0.00001)).normalize().negate();
    const orientation = mat3(right, up, forward);
    const localPosition = attribute("position").xyz;
    const flowPosition = orientation.mul(
      localPosition.mul(vec3(1, 1, renderUniforms.flowLength))
    );
    const shapePosition = renderUniforms.shapeMode.lessThan(0.5).select(
      flowPosition,
      localPosition
    );
    particleNormal.assign(
      renderUniforms.shapeMode.lessThan(0.5)
        .select(orientation.mul(normalLocal).normalize(), normalLocal.normalize())
    );
    const densityScale = densityRatio.mul(0.22).add(0.58).clamp(0.45, 1.08);
    const worldPosition = particlePosition
      .mul(vec3(1, 1, 0.4))
      .add(vec3(-32, 0, 0))
      .div(GRID_SIZE);

    const spatialSignal = particlePosition.y
      .div(GRID_SIZE)
      .mul(0.68)
      .add(particlePosition.z.div(GRID_SIZE).mul(0.32));
    const particleVariation = float(instanceIndex).mul(0.61803398875).fract().mul(0.09);
    const continuousSignal = densityRatio
      .mul(0.26)
      .add(velocityMagnitude.mul(0.2))
      .add(spatialSignal.mul(0.25))
      .add(particleVariation)
      .add(renderUniforms.simulationTime.mul(renderUniforms.colorDrift))
      .fract();
    const densitySignal = densityRatio.mul(0.46).clamp(0, 1);
    const velocitySignal = velocityMagnitude.mul(0.62).clamp(0, 1);
    colorPosition.assign(
      renderUniforms.colorBehavior.lessThan(0.5).select(
        continuousSignal,
        renderUniforms.colorBehavior.lessThan(1.5).select(densitySignal, velocitySignal)
      )
    );
    hsvColor.assign(hsvToRgb(vec3(
      densityRatio.mul(0.25).add(
        renderUniforms.simulationTime.mul(renderUniforms.colorDrift)
      ),
      velocityMagnitude.mul(0.3).add(0.7).clamp(0, 1),
      velocityMagnitude.mul(0.12).add(0.82).clamp(0, 1)
    )));
    surfaceLight.assign(densityRatio.mul(0.12).add(0.88).clamp(0.78, 1.08));
    return shapePosition
      .mul(renderUniforms.size)
      .mul(densityScale)
      .div(GRID_SIZE)
      .add(worldPosition);
  })();
  particleMaterial.normalNode = particleNormal;
  const evolvingColor = renderUniforms.colorBehavior.greaterThan(2.5)
    .select(hsvColor, samplePalette(colorPosition));
  particleMaterial.colorNode = renderUniforms.solidPaint.greaterThan(0.5)
    .select(renderUniforms.foreground, evolvingColor)
    .mul(surfaceLight);
  particleMaterial.metalnessNode = renderUniforms.metalness;
  particleMaterial.roughnessNode = renderUniforms.roughness;
  particleMaterial.clearcoatNode = renderUniforms.clearcoat;

  const particles = new THREE.Mesh(particleGeometries[activeGeometryIndex], particleMaterial);
  particles.frustumCulled = false;
  scene.add(particles);

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
  let renderedFrames = 0;

  function resize(nextViewport) {
    viewport = { ...nextViewport };
    renderer.setPixelRatio(nextViewport.pixelRatio);
    renderer.setSize(nextViewport.width, nextViewport.height, false);
    camera.aspect = Math.max(0.0001, nextViewport.contentWidth / nextViewport.contentHeight);
    camera.updateProjectionMatrix();
  }

  function updateAppearance(frame) {
    const palette = fixedAppearanceStops(frame);
    renderUniforms.solidPaint.value = frame.appearance?.paint?.type === "solid" ? 1 : 0;
    renderUniforms.foreground.value.set(palette.colors[0]);
    renderUniforms.accent.value.set(palette.colors[1]);
    renderUniforms.middle.value.set(palette.colors[2]);
    renderUniforms.secondary.value.set(palette.colors[3]);
    renderUniforms.stop1.value = palette.positions[1];
    renderUniforms.stop2.value = palette.positions[2];
    const material = frame.appearance?.material;
    renderUniforms.roughness.value = clamp(material?.roughness ?? 0.38, 0.05, 1);
    renderUniforms.metalness.value = clamp(material?.metalness ?? 0.08, 0, 1);
    renderUniforms.clearcoat.value = clamp(material?.clearcoat ?? 0.4, 0, 1);
  }

  function updatePhysics(frame) {
    const particleCount = clamp(
      Math.round(parameter(frame, "particleCount", 32768) / 4096) * 4096,
      4096,
      capacity
    );
    const level = Math.max(particleCount / 8192, 1);
    const density = parameter(frame, "density", 0.9);
    physicsUniforms.noise.value = parameter(frame, "noise", 0.85);
    physicsUniforms.stiffness.value = 3;
    physicsUniforms.dynamicViscosity.value = 0.1;
    physicsUniforms.restDensity.value = 0.25 * level * density;
    physicsUniforms.gravityMode.value = clamp(Math.round(parameter(frame, "gravityMode", 2)), 0, 2);
    if (physicsUniforms.gravityMode.value === 0) physicsUniforms.gravity.value.set(0, 0, 0.2);
    else if (physicsUniforms.gravityMode.value === 1) physicsUniforms.gravity.value.set(0, -0.2, 0);
    else physicsUniforms.gravity.value.set(0, 0, 0);
    physicsUniforms.surfaceModel.value = clamp(
      Math.round(parameter(frame, "surfaceModel", 0)),
      0,
      1
    );
    physicsUniforms.cohesion.value = parameter(frame, "cohesion", 0.35);
    physicsUniforms.surfaceTension.value = parameter(frame, "surfaceTension", 0.65);
    fluid.setParticleCount(particleCount);
    for (const geometry of particleGeometries) geometry.instanceCount = particleCount;
    renderUniforms.size.value = 1.6 / Math.cbrt(level) * parameter(frame, "particleSize", 1);
    renderUniforms.flowLength.value = parameter(frame, "flowLength", 1);
    renderUniforms.simulationTime.value = frame.elapsedTime;
    renderUniforms.colorBehavior.value = clamp(
      Math.round(parameter(frame, "colorBehavior", 0)),
      0,
      3
    );
    renderUniforms.colorDrift.value = parameter(frame, "colorDrift", 0.045);
    const requestedShape = clamp(Math.round(parameter(frame, "particleShape", 0)), 0, 1);
    renderUniforms.shapeMode.value = requestedShape;
    const requestedGeometryIndex = requestedShape === 0 ? 0 : 1;
    if (requestedGeometryIndex !== activeGeometryIndex) {
      activeGeometryIndex = requestedGeometryIndex;
      particles.geometry = particleGeometries[activeGeometryIndex];
    }
    return { speed: parameter(frame, "simulationSpeed", 1) };
  }

  function updateCamera(frame) {
    const view = frame.view ?? {};
    const yaw = (Number.isFinite(view.orbitYaw) ? view.orbitYaw : 0) * Math.PI / 180;
    const pitch = (Number.isFinite(view.orbitPitch) ? view.orbitPitch : 0) * Math.PI / 180;
    const zoom = Number.isFinite(view.zoom) ? clamp(view.zoom, 0.35, 4) : 1;
    const aspect = compositionMetrics(frame).aspect;
    const formatDistance = aspect < 1 ? Math.pow(1 / aspect, 0.1) : Math.pow(aspect, -0.025);
    const distance = parameter(frame, "cameraDistance", 1.45) * formatDistance / zoom;
    cameraTarget.set(
      -(Number.isFinite(view.panX) ? view.panX : 0) * 0.8,
      0.5 + (Number.isFinite(view.panY) ? view.panY : 0) * 0.8,
      0.18
    );
    const cosinePitch = Math.cos(pitch);
    camera.position.set(
      cameraTarget.x + Math.sin(yaw) * cosinePitch * distance,
      cameraTarget.y + Math.sin(pitch) * distance,
      cameraTarget.z - Math.cos(yaw) * cosinePitch * distance
    );
    camera.fov = parameter(frame, "fov", 48);
    camera.lookAt(cameraTarget);
    camera.updateProjectionMatrix();
  }

  function render(frame) {
    if (disposed) return;
    const settings = updatePhysics(frame);
    updateAppearance(frame);
    updateCamera(frame);
    fluid.advance({
      seed: frame.seed,
      elapsedTime: frame.elapsedTime,
      speed: settings.speed
    });

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, viewport.width, viewport.height);
    if (viewport.stageBackground) renderer.setClearColor(viewport.stageBackground, 1);
    else renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);

    const viewportY = viewport.height - viewport.contentY - viewport.contentHeight;
    renderer.setViewport(viewport.contentX, viewportY, viewport.contentWidth, viewport.contentHeight);
    renderer.setScissor(viewport.contentX, viewportY, viewport.contentWidth, viewport.contentHeight);
    renderer.setScissorTest(true);
    renderer.setClearColor(
      frame.appearance?.background?.color ?? frame.palette.background,
      frame.transparent ? 0 : 1
    );
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderedFrames += 1;
    renderer.setScissorTest(false);
    gpuTiming.tick();
  }

  function getDiagnostics() {
    const activeShape = renderUniforms.shapeMode.value === 0 ? "flow-original" : "sphere";
    return {
      ...fluid.getDiagnostics(),
      consumer: {
        projectId: "chromatic-fluid",
        engineInstances: 1,
        physicalBuffers: 1,
        visualBuffers: 0,
        renderLayers: 1,
        renderedFrames,
        sharesParticleBuffer: particleBuffer === fluid.particleBuffer,
        transparentParticles: particleMaterial.transparent
      },
      gpu: gpuTiming.getDiagnostics(),
      renderer: {
        drawCalls: renderer.info.render.drawCalls,
        renderCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        activeGeometry: activeShape,
        geometryVertices: particleGeometries[activeGeometryIndex].attributes.position.count,
        geometryIndices: particleGeometries[activeGeometryIndex].index?.count ?? 0,
        storageAttributes: renderer.info.memory.storageAttributes,
        storageAttributesSize: renderer.info.memory.storageAttributesSize,
        textures: renderer.info.memory.textures,
        texturesSize: renderer.info.memory.texturesSize,
        totalTrackedMemory: renderer.info.memory.total
      },
      webgpu: getCauceWebGpuCapabilities(renderer)
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    gpuTiming.dispose();
    fluid.dispose();
    scene.remove(particles);
    particleMaterial.dispose();
    for (const geometry of particleGeometries) geometry.dispose();
    renderer.dispose();
  }

  return {
    resize,
    render,
    flush,
    dispose,
    backendName,
    getDiagnostics
  };
}
