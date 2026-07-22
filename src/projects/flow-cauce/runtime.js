import { clamp, parameter } from "../shared.js";
import { compositionMetrics } from "../composition.js";
import {
  createCauceGpuTiming,
  createCauceWebGpuBackend,
  getCauceWebGpuCapabilities
} from "../webgpu-shared.js";
import {
  CAUCE_FLUID_GRID_SIZE as GRID_SIZE,
  CAUCE_FLUID_MAX_PARTICLES as MAX_PARTICLES,
  createCauceFluidEngine,
  getCauceFluidCapacityForCount
} from "../../engine/fluid/cauce-fluid-engine.js";
import { createFlowRoundedBoxGeometry } from "../fluid-visual-geometries.js";
import flowHdriUrl from "./assets/autumn_field_puresky_1k.hdr?url";
import concreteAoUrl from "./assets/concrete_0016_ao_1k.jpg?url";
import concreteColorUrl from "./assets/concrete_0016_color_1k.jpg?url";
import concreteNormalUrl from "./assets/concrete_0016_normal_opengl_1k.png?url";
import concreteRoughnessUrl from "./assets/concrete_0016_roughness_1k.jpg?url";
import roomObjectSource from "./assets/boxSlightlySmooth.obj?raw";

// Faithful Three.js r185 port of holtsetio/flow (MIT, 2025).
// The default physical constants, MLS-MPM passes, color field and particle
// proportions remain equivalent to the source. Cauce Fluid Engine owns the
// seeded reset and fixed clock; this runtime owns viewport, camera, materials,
// lighting and export lifecycle. The optional CSF surface model is a Cauce
// extension and is disabled in Flow original mode.

function fixedPaletteStops(frame) {
  if (frame.appearance?.paint?.type === "solid") {
    return {
      colors: Array.from({ length: 4 }, () => frame.appearance.paint.color),
      positions: [0, 1 / 3, 2 / 3, 1]
    };
  }
  if (frame.appearance?.paint?.type === "gradient") {
    const supplied = frame.appearance.paint.stops.map((stop) => ({ ...stop }));
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

async function loadTexture(THREE, url, colorSpace = THREE.NoColorSpace) {
  const loader = new THREE.ImageBitmapLoader();
  loader.setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none" });
  const imageBitmap = await loader.loadAsync(url);
  const texture = new THREE.Texture(imageBitmap);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

export async function createFlowCauceRuntime(canvas, options = {}) {
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
  const { RGBELoader } = await import("three/addons/loaders/RGBELoader.js");
  const { OBJLoader } = await import("three/addons/loaders/OBJLoader.js");
  const { RectAreaLightTexturesLib } = await import("three/addons/lights/RectAreaLightTexturesLib.js");
  const { mergeGeometries, mergeVertices } = await import("three/addons/utils/BufferGeometryUtils.js");
  const {
    Fn,
    attribute,
    float,
    instanceIndex,
    mat3,
    normalLocal,
    positionWorld,
    texture,
    uv,
    varyingProperty,
    vec3
  } = TSL;

  THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMappingExposure = 0.66;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 5);
  const cameraTarget = new THREE.Vector3(0, 0.5, 0.2);
  camera.position.set(0, 0.5, -1);
  camera.lookAt(cameraTarget);

  const hdriTexture = await new RGBELoader().loadAsync(flowHdriUrl);
  hdriTexture.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdriTexture;
  scene.environmentRotation = new THREE.Euler(0, -2.15, 0);
  scene.environmentIntensity = 0.5;

  const sceneLights = new Map();
  let ambientSceneLight = null;
  let ambientSceneType = "none";
  let environmentRotation = -2.15;

  const [normalMap, aoMap, colorMap, roughnessMap] = await Promise.all([
    loadTexture(THREE, concreteNormalUrl),
    loadTexture(THREE, concreteAoUrl),
    loadTexture(THREE, concreteColorUrl, THREE.SRGBColorSpace),
    loadTexture(THREE, concreteRoughnessUrl)
  ]);
  const roomObject = new OBJLoader().parse(roomObjectSource);
  const roomGeometry = mergeVertices(roomObject.children[0].geometry);
  for (let index = 0; index < roomGeometry.attributes.uv.array.length; index += 1) {
    roomGeometry.attributes.uv.array[index] *= 10;
  }
  const roomMaterial = new THREE.MeshStandardNodeMaterial({
    roughness: 0.9,
    metalness: 0,
    normalScale: new THREE.Vector2(1, 1),
    normalMap,
    aoMap,
    map: colorMap,
    roughnessMap
  });
  roomMaterial.aoNode = Fn(() => (
    texture(aoMap, uv()).mul(positionWorld.z.div(0.4).mul(0.95).oneMinus())
  ))();
  roomMaterial.colorNode = Fn(() => (
    texture(colorMap, uv()).mul(positionWorld.z.div(0.4).mul(0.5).oneMinus().mul(0.7))
  ))();
  const room = new THREE.Mesh(roomGeometry, roomMaterial);
  room.rotation.set(0, Math.PI, 0);
  room.position.set(0, -0.05, 0.22);
  room.castShadow = true;
  room.receiveShadow = true;
  scene.add(room);

  const initialParticleCount = Number(options.initialParticleCount) || 32768;
  const capacity = getCauceFluidCapacityForCount(initialParticleCount);
  const resetMode = options.fluidResetMode === "gpu-v2" ? options.fluidResetMode : "legacy-cpu";
  const fluid = createCauceFluidEngine({
    THREE,
    TSL,
    renderer,
    capacity,
    visualMode: "flow",
    resetMode
  });
  const { particleBuffer, visualBuffer, uniforms } = fluid;
  if (!visualBuffer) throw new Error("Flow Cauce necesita el buffer visual del motor.");

  const roundedGeometry = createFlowRoundedBoxGeometry(THREE);
  const shadowGeometry = mergeVertices(new THREE.BoxGeometry(7, 7, 30), 3);
  for (let index = 0; index < shadowGeometry.attributes.position.array.length; index += 1) {
    shadowGeometry.attributes.position.array[index] *= 0.1;
  }
  const surfaceIndexCount = roundedGeometry.index.count;
  const shadowIndexCount = shadowGeometry.index.count;
  const mergedParticleGeometry = mergeGeometries([roundedGeometry, shadowGeometry]);
  if (!mergedParticleGeometry) throw new Error("No se pudo construir la partícula fiel de Flow.");
  roundedGeometry.dispose();
  shadowGeometry.dispose();
  const particleGeometry = new THREE.InstancedBufferGeometry().copy(mergedParticleGeometry);
  mergedParticleGeometry.dispose();
  particleGeometry.setDrawRange(0, surfaceIndexCount);
  particleGeometry.instanceCount = initialParticleCount;

  const particleNormal = varyingProperty("vec3", "flowCauceNormal");
  const particleAo = varyingProperty("float", "flowCauceAo");
  const particleVisual = visualBuffer.element(instanceIndex);
  const particleMaterial = new THREE.MeshStandardNodeMaterial({
    metalness: 0.9,
    roughness: 0.5
  });
  particleMaterial.positionNode = Fn(() => {
    const particle = particleBuffer.element(instanceIndex);
    const particlePosition = particle.get("position");
    const particleDensity = particle.get("density");
    const forward = particleVisual.get("direction").add(vec3(0.00001)).normalize().toVar();
    const reference = forward.z.abs().greaterThan(0.98).select(vec3(0, 1, 0), vec3(0, 0, 1));
    const right = forward.cross(reference).add(vec3(0.00001)).normalize().negate();
    const up = right.cross(forward).add(vec3(0.00001)).normalize().negate();
    const orientation = mat3(right, up, forward);
    const flowNormal = orientation.mul(normalLocal).normalize();
    particleNormal.assign(
      uniforms.particleShape.lessThan(0.5).select(flowNormal, normalLocal.normalize())
    );
    particleAo.assign(particlePosition.z.div(GRID_SIZE));
    particleAo.assign(particleAo.mul(particleAo).oneMinus());
    const densityScale = particleDensity.mul(0.4).add(0.5).clamp(0, 1);
    const localPosition = attribute("position").xyz;
    const flowPosition = orientation.mul(localPosition.mul(vec3(1, 1, uniforms.flowLength)));
    const shapePosition = uniforms.particleShape.lessThan(0.5).select(flowPosition, localPosition);
    const worldPosition = shapePosition
      .mul(uniforms.size)
      .mul(densityScale)
      .add(particlePosition.mul(vec3(1, 1, 0.4)))
      .add(vec3(-32, 0, 0))
      .div(GRID_SIZE);
    return worldPosition;
  })();
  particleMaterial.normalNode = particleNormal;
  const particleSurfaceColor = particleVisual.get("color");
  const particleSurfaceVariation = particleSurfaceColor
    .dot(vec3(0.2126, 0.7152, 0.0722))
    .sub(0.5)
    .abs()
    .mul(2);
  particleMaterial.colorNode = particleSurfaceColor;
  particleMaterial.metalnessNode = uniforms.materialMode.lessThan(0.5).select(
    uniforms.materialMetalness,
    float(0)
  );
  particleMaterial.roughnessNode = uniforms.materialMode.lessThan(0.5).select(
    uniforms.materialRoughness,
    uniforms.materialRoughness
      .add(particleSurfaceVariation.mul(uniforms.mineralVariation))
      .clamp(0.05, 1)
  );
  particleMaterial.aoNode = particleAo;

  const particles = new THREE.Mesh(particleGeometry, particleMaterial);
  particles.frustumCulled = false;
  particles.castShadow = true;
  particles.receiveShadow = true;
  particles.onBeforeShadow = () => particleGeometry.setDrawRange(surfaceIndexCount, shadowIndexCount);
  particles.onAfterShadow = () => particleGeometry.setDrawRange(0, surfaceIndexCount);
  scene.add(particles);

  // Share coincident vertices before instancing. The indexed topology keeps
  // the same triangles, normals and silhouette while avoiding duplicated
  // vertex-stage work for every face corner.
  const sphereSurfaceGeometry = mergeVertices(
    new THREE.IcosahedronGeometry(0.42, 1).deleteAttribute("uv")
  );
  const sphereShadowGeometry = mergeVertices(
    new THREE.IcosahedronGeometry(0.42, 0).deleteAttribute("uv")
  );
  const sphereSurfaceVertexCount = sphereSurfaceGeometry.attributes.position.count;
  const sphereShadowVertexCount = sphereShadowGeometry.attributes.position.count;
  const sphereSurfaceIndexCount = sphereSurfaceGeometry.index?.count
    ?? sphereSurfaceGeometry.attributes.position.count;
  const sphereShadowIndexCount = sphereShadowGeometry.index?.count
    ?? sphereShadowGeometry.attributes.position.count;
  const mergedSphereGeometry = mergeGeometries([
    sphereSurfaceGeometry,
    sphereShadowGeometry
  ]);
  if (!mergedSphereGeometry) throw new Error("No se pudo construir el proxy de sombra esférico.");
  sphereSurfaceGeometry.dispose();
  sphereShadowGeometry.dispose();
  const sphereGeometry = new THREE.InstancedBufferGeometry().copy(mergedSphereGeometry);
  mergedSphereGeometry.dispose();
  sphereGeometry.setDrawRange(0, sphereSurfaceIndexCount);
  sphereGeometry.instanceCount = initialParticleCount;
  const sphereParticles = new THREE.Mesh(sphereGeometry, particleMaterial);
  sphereParticles.frustumCulled = false;
  sphereParticles.castShadow = true;
  sphereParticles.receiveShadow = true;
  sphereParticles.onBeforeShadow = () => (
    sphereGeometry.setDrawRange(sphereSurfaceIndexCount, sphereShadowIndexCount)
  );
  sphereParticles.onAfterShadow = () => sphereGeometry.setDrawRange(0, sphereSurfaceIndexCount);
  sphereParticles.visible = false;
  scene.add(sphereParticles);

  const raycaster = new THREE.Raycaster();
  const interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.2);
  const pointerPosition = new THREE.Vector3();
  const pointerHistory = [];
  const pointerNdc = new THREE.Vector2();
  let pointerActive = false;

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

  function updatePointerForce() {
    if (!pointerActive) {
      uniforms.mouseForce.value.multiplyScalar(0.72);
      return;
    }
    pointerHistory.push(pointerPosition.clone());
    if (pointerHistory.length > 3) pointerHistory.shift();
    if (pointerHistory.length > 1) {
      uniforms.mouseForce.value
        .copy(pointerHistory[pointerHistory.length - 1])
        .sub(pointerHistory[0])
        .divideScalar(pointerHistory.length);
    }
  }

  function handlePointerMove(event) {
    if (!(canvas instanceof HTMLCanvasElement)) return;
    const rectangle = canvas.getBoundingClientRect();
    const scaleX = viewport.width / Math.max(1, rectangle.width);
    const scaleY = viewport.height / Math.max(1, rectangle.height);
    const canvasX = (event.clientX - rectangle.left) * scaleX;
    const canvasY = (event.clientY - rectangle.top) * scaleY;
    pointerNdc.x = ((canvasX - viewport.contentX) / Math.max(1, viewport.contentWidth)) * 2 - 1;
    pointerNdc.y = -((canvasY - viewport.contentY) / Math.max(1, viewport.contentHeight)) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    if (!raycaster.ray.intersectPlane(interactionPlane, pointerPosition)) return;
    uniforms.mouseRayDirection.value.copy(raycaster.ray.direction).normalize();
    uniforms.mouseRayOrigin.value.copy(raycaster.ray.origin).multiplyScalar(GRID_SIZE);
    uniforms.mouseRayOrigin.value.add(new THREE.Vector3(32, 0, 0));
    pointerPosition.multiplyScalar(GRID_SIZE);
    pointerActive = true;
  }

  function handlePointerLeave() {
    pointerActive = false;
    pointerHistory.length = 0;
  }

  if (typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement) {
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
  }

  function resize(nextViewport) {
    viewport = { ...nextViewport };
    renderer.setPixelRatio(nextViewport.pixelRatio);
    renderer.setSize(nextViewport.width, nextViewport.height, false);
    camera.aspect = Math.max(0.0001, nextViewport.contentWidth / nextViewport.contentHeight);
    camera.updateProjectionMatrix();
  }

  function legacyLighting(frame) {
    return {
      environment: { enabled: true, intensity: 0.5, rotation: -123.2 },
      ambient: {
        enabled: false,
        type: "hemisphere",
        color: "#ffffff",
        groundColor: "#111518",
        intensity: 0.6
      },
      lights: [{
        id: "flow-key",
        name: "Key Light",
        type: "spot",
        enabled: true,
        solo: false,
        colorSource: "custom",
        color: "#ffffff",
        intensity: parameter(frame, "lightIntensity", 5),
        position: {
          x: parameter(frame, "lightX", 0),
          y: parameter(frame, "lightY", 1.2),
          z: parameter(frame, "lightZ", -0.8)
        },
        target: {
          x: parameter(frame, "lightTargetX", 0),
          y: parameter(frame, "lightTargetY", 0.7),
          z: parameter(frame, "lightTargetZ", 0)
        },
        distance: 15,
        angle: parameter(frame, "lightAngle", 32.4),
        penumbra: parameter(frame, "lightPenumbra", 1),
        width: 1.4,
        height: 1.4,
        castShadow: parameter(frame, "lightShadows", 1) >= 0.5,
        shadowMapSize: 1024
      }]
    };
  }

  function resolveLightColor(lightState, frame) {
    if (lightState.colorSource === "foreground") return frame.palette.foreground;
    if (lightState.colorSource === "accent") return frame.palette.accent;
    if (lightState.colorSource === "secondary") {
      return frame.palette.secondary ?? frame.palette.accent;
    }
    return lightState.color ?? "#ffffff";
  }

  function configureShadow(light, lightState) {
    if (!light.shadow) return;
    const requestedSize = [256, 512, 1024].includes(lightState.shadowMapSize)
      ? lightState.shadowMapSize
      : light.isPointLight ? 256 : 1024;
    if (light.shadow.mapSize.x !== requestedSize || light.shadow.mapSize.y !== requestedSize) {
      light.shadow.map?.dispose?.();
      light.shadow.map = null;
      light.shadow.mapSize.set(requestedSize, requestedSize);
    }
    light.shadow.bias = -0.005;
    light.shadow.normalBias = light.isDirectionalLight ? 0.04 : 0.01;
    light.shadow.camera.near = light.isPointLight ? 0.05 : 0.1;
    light.shadow.camera.far = Math.max(5, lightState.distance ?? 15);
    if (light.isDirectionalLight) {
      light.shadow.camera.left = -2.4;
      light.shadow.camera.right = 2.4;
      light.shadow.camera.top = 2.4;
      light.shadow.camera.bottom = -2.4;
    }
    light.shadow.camera.updateProjectionMatrix();
  }

  function removeSceneLight(entry) {
    scene.remove(entry.light);
    if (entry.target) scene.remove(entry.target);
    entry.light.shadow?.dispose?.();
  }

  function createSceneLight(lightState) {
    let light;
    let target = null;
    if (lightState.type === "point") {
      light = new THREE.PointLight(0xffffff, 1, lightState.distance ?? 15, 2);
    } else if (lightState.type === "directional") {
      light = new THREE.DirectionalLight(0xffffff, 1);
      target = new THREE.Object3D();
      light.target = target;
    } else if (lightState.type === "rect-area") {
      light = new THREE.RectAreaLight(
        0xffffff,
        1,
        lightState.width ?? 1.4,
        lightState.height ?? 1.4
      );
    } else {
      light = new THREE.SpotLight(
        0xffffff,
        1,
        lightState.distance ?? 15,
        THREE.MathUtils.degToRad(lightState.angle ?? 32.4),
        lightState.penumbra ?? 1,
        0
      );
      target = new THREE.Object3D();
      light.target = target;
    }
    light.name = lightState.name ?? "Cauce Light";
    scene.add(light);
    if (target) scene.add(target);
    return { type: lightState.type, light, target };
  }

  function syncAmbientLight(ambient) {
    const requestedType = ambient?.enabled ? ambient.type : "none";
    if (requestedType !== ambientSceneType) {
      if (ambientSceneLight) scene.remove(ambientSceneLight);
      ambientSceneLight = null;
      ambientSceneType = requestedType;
      if (requestedType === "ambient") {
        ambientSceneLight = new THREE.AmbientLight(ambient.color, ambient.intensity);
      } else if (requestedType === "hemisphere") {
        ambientSceneLight = new THREE.HemisphereLight(
          ambient.color,
          ambient.groundColor,
          ambient.intensity
        );
      }
      if (ambientSceneLight) scene.add(ambientSceneLight);
    }
    if (!ambientSceneLight) return;
    ambientSceneLight.color.set(ambient.color);
    ambientSceneLight.intensity = ambient.intensity;
    if (ambientSceneLight.isHemisphereLight) {
      ambientSceneLight.groundColor.set(ambient.groundColor);
    }
  }

  function syncLighting(frame) {
    const rig = frame.lighting ?? legacyLighting(frame);
    const environment = rig.environment ?? { enabled: true, intensity: 0.5, rotation: -123.2 };
    environmentRotation = THREE.MathUtils.degToRad(environment.rotation ?? -123.2);
    scene.environment = environment.enabled === false ? null : hdriTexture;
    scene.environmentIntensity = environment.enabled === false ? 0 : environment.intensity ?? 0.5;
    scene.environmentRotation = new THREE.Euler(0, environmentRotation, 0);
    syncAmbientLight(rig.ambient);

    const lightStates = Array.isArray(rig.lights) ? rig.lights.slice(0, 6) : [];
    const activeIds = new Set(lightStates.map((lightState) => lightState.id));
    for (const [id, entry] of sceneLights) {
      if (activeIds.has(id)) continue;
      removeSceneLight(entry);
      sceneLights.delete(id);
    }
    const hasSolo = lightStates.some((lightState) => lightState.enabled && lightState.solo);
    for (const lightState of lightStates) {
      let entry = sceneLights.get(lightState.id);
      if (!entry || entry.type !== lightState.type) {
        if (entry) removeSceneLight(entry);
        entry = createSceneLight(lightState);
        sceneLights.set(lightState.id, entry);
      }
      const light = entry.light;
      const enabled = lightState.enabled && (!hasSolo || lightState.solo);
      light.visible = enabled;
      light.name = lightState.name;
      light.color.set(resolveLightColor(lightState, frame));
      light.intensity = lightState.intensity;
      light.position.set(
        lightState.position.x,
        lightState.position.y,
        lightState.position.z
      );
      if (entry.target) {
        entry.target.position.set(
          lightState.target.x,
          lightState.target.y,
          lightState.target.z
        );
        entry.target.updateMatrixWorld();
      }
      if (light.isSpotLight) {
        light.distance = lightState.distance;
        light.angle = THREE.MathUtils.degToRad(lightState.angle);
        light.penumbra = lightState.penumbra;
      } else if (light.isPointLight) {
        light.distance = lightState.distance;
      } else if (light.isRectAreaLight) {
        light.width = lightState.width;
        light.height = lightState.height;
        light.lookAt(lightState.target.x, lightState.target.y, lightState.target.z);
      }
      const supportsShadow = light.isSpotLight || light.isPointLight || light.isDirectionalLight;
      light.castShadow = Boolean(enabled && lightState.castShadow && supportsShadow);
      if (supportsShadow) configureShadow(light, lightState);
    }
  }

  function updateParameters(frame) {
    const particleCount = clamp(
      Math.round(parameter(frame, "particleCount", 32768) / 4096) * 4096,
      4096,
      MAX_PARTICLES
    );
    const density = parameter(frame, "density", 1);
    const level = Math.max(particleCount / 8192, 1);
    uniforms.particleCount.value = particleCount;
    uniforms.noise.value = parameter(frame, "noise", 1);
    uniforms.stiffness.value = 3;
    uniforms.dynamicViscosity.value = 0.1;
    uniforms.restDensity.value = 0.25 * level * density;
    uniforms.gravityMode.value = clamp(Math.round(parameter(frame, "gravityMode", 0)), 0, 2);
    if (uniforms.gravityMode.value === 0) uniforms.gravity.value.set(0, 0, 0.2);
    else if (uniforms.gravityMode.value === 1) uniforms.gravity.value.set(0, -0.2, 0);
    else uniforms.gravity.value.set(0, 0, 0);
    uniforms.interactionStrength.value = parameter(frame, "interactionStrength", 1);
    uniforms.surfaceModel.value = clamp(Math.round(parameter(frame, "surfaceModel", 0)), 0, 1);
    uniforms.cohesion.value = parameter(frame, "cohesion", 0.35);
    uniforms.surfaceTension.value = parameter(frame, "surfaceTension", 0.65);
    uniforms.size.value = 1.6 / Math.cbrt(level) * parameter(frame, "particleSize", 1);
    const particleShape = clamp(Math.round(parameter(frame, "particleShape", 1)), 0, 1);
    uniforms.particleShape.value = particleShape;
    uniforms.flowLength.value = parameter(frame, "flowLength", 1);
    uniforms.colorMode.value = clamp(Math.round(parameter(frame, "colorMode", 0)), 0, 1);
    const appearanceTexture = frame.appearance?.texture;
    const proceduralTexture = appearanceTexture?.type === "procedural";
    const textureMode = proceduralTexture
      ? appearanceTexture.preset === "flow" ? 1 : appearanceTexture.preset === "grain" ? 2 : 3
      : 0;
    const materialMode = proceduralTexture
      ? 1
      : clamp(Math.round(parameter(frame, "materialMode", 0)), 0, 1);
    uniforms.materialMode.value = materialMode;
    uniforms.textureMode.value = textureMode;
    uniforms.textureStrength.value = proceduralTexture ? appearanceTexture.strength : materialMode;
    uniforms.textureMotion.value = proceduralTexture ? appearanceTexture.motion : 0;
    uniforms.mineralScale.value = proceduralTexture
      ? 0.01 + clamp(appearanceTexture.scale / 24, 0, 1) * 0.29
      : parameter(frame, "mineralScale", 0.075);
    uniforms.mineralWarp.value = parameter(frame, "mineralWarp", 0.65);
    uniforms.mineralContrast.value = parameter(frame, "mineralContrast", 1.35);
    uniforms.mineralVariation.value = parameter(frame, "mineralVariation", 0.22);
    uniforms.paletteMix.value = parameter(frame, "paletteMix", 1);
    uniforms.hueSpeed.value = parameter(frame, "hueSpeed", 0.05);
    const paletteStops = fixedPaletteStops(frame);
    uniforms.foreground.value.set(paletteStops.colors[0]);
    uniforms.background.value.set(frame.palette.background);
    uniforms.accent.value.set(paletteStops.colors[1]);
    uniforms.paletteMiddle.value.set(paletteStops.colors[2]);
    uniforms.secondary.value.set(paletteStops.colors[3]);
    uniforms.paletteStop1.value = paletteStops.positions[1];
    uniforms.paletteStop2.value = paletteStops.positions[2];
    particleGeometry.instanceCount = particleCount;
    sphereGeometry.instanceCount = particleCount;
    particles.visible = particleShape === 0;
    sphereParticles.visible = particleShape === 1;
    fluid.setParticleCount(particleCount);
    uniforms.materialMetalness.value = parameter(frame, "metalness", 0.9);
    uniforms.materialRoughness.value = parameter(frame, "roughness", 0.5);
    syncLighting(frame);
    renderer.toneMapping = materialMode === 1
      ? THREE.ACESFilmicToneMapping
      : THREE.NoToneMapping;
    renderer.toneMappingExposure = parameter(frame, "exposure", 0.66);
    return { speed: parameter(frame, "simulationSpeed", 1) };
  }

  function updateCamera(frame) {
    const view = frame.view ?? {};
    const yaw = (Number.isFinite(view.orbitYaw) ? view.orbitYaw : 0) * Math.PI / 180;
    const pitch = (Number.isFinite(view.orbitPitch) ? view.orbitPitch : 0) * Math.PI / 180;
    const zoom = Number.isFinite(view.zoom) ? clamp(view.zoom, 0.35, 4) : 1;
    const aspect = compositionMetrics(frame).aspect;
    const formatDistance = aspect < 1 ? Math.pow(1 / aspect, 0.1) : Math.pow(aspect, -0.025);
    const distance = parameter(frame, "cameraDistance", 1.2) * formatDistance / zoom;
    cameraTarget.set(
      -(Number.isFinite(view.panX) ? view.panX : 0) * 0.8,
      0.5 + (Number.isFinite(view.panY) ? view.panY : 0) * 0.8,
      0.2
    );
    const cosinePitch = Math.cos(pitch);
    camera.position.set(
      cameraTarget.x + Math.sin(yaw) * cosinePitch * distance,
      cameraTarget.y + Math.sin(pitch) * distance,
      cameraTarget.z - Math.cos(yaw) * cosinePitch * distance
    );
    camera.fov = parameter(frame, "fov", 60);
    camera.lookAt(cameraTarget);
    camera.updateProjectionMatrix();
  }

  function render(frame) {
    if (disposed) return;
    const settings = updateParameters(frame);
    updateCamera(frame);
    fluid.advance({
      seed: frame.seed,
      elapsedTime: frame.elapsedTime,
      speed: settings.speed,
      beforeStep: updatePointerForce,
      onReset: () => pointerHistory.length = 0
    });

    room.visible = !frame.transparent && parameter(frame, "roomVisible", 0) >= 0.5;
    const hdriBackground = !frame.transparent && parameter(frame, "backgroundMode", 0) >= 0.5;
    scene.background = hdriBackground ? hdriTexture : null;
    scene.backgroundRotation = new THREE.Euler(0, -environmentRotation, 0);

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, viewport.width, viewport.height);
    if (viewport.stageBackground) renderer.setClearColor(viewport.stageBackground, 1);
    else renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);

    const viewportY = viewport.height - viewport.contentY - viewport.contentHeight;
    renderer.setViewport(viewport.contentX, viewportY, viewport.contentWidth, viewport.contentHeight);
    renderer.setScissor(viewport.contentX, viewportY, viewport.contentWidth, viewport.contentHeight);
    renderer.setScissorTest(true);
    renderer.setClearColor(frame.palette.background, frame.transparent ? 0 : 1);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
    gpuTiming.tick();
  }

  function getDiagnostics() {
    return {
      ...fluid.getDiagnostics(),
      gpu: gpuTiming.getDiagnostics(),
      renderer: {
        drawCalls: renderer.info.render.drawCalls,
        renderCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        sphereSurfaceVertexCount,
        sphereSurfaceIndexCount,
        sphereShadowVertexCount,
        sphereShadowIndexCount,
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
    if (typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement) {
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
    }
    gpuTiming.dispose();
    fluid.dispose();
    particleGeometry.dispose();
    sphereGeometry.dispose();
    particleMaterial.dispose();
    roomGeometry.dispose();
    roomMaterial.dispose();
    normalMap.dispose();
    aoMap.dispose();
    colorMap.dispose();
    roughnessMap.dispose();
    normalMap.image?.close?.();
    aoMap.image?.close?.();
    colorMap.image?.close?.();
    roughnessMap.image?.close?.();
    for (const entry of sceneLights.values()) removeSceneLight(entry);
    sceneLights.clear();
    if (ambientSceneLight) scene.remove(ambientSceneLight);
    hdriTexture.dispose();
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
