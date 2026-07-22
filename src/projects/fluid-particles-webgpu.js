import { clamp, parameter } from "./shared.js";
import { compositionMetrics } from "./composition.js";
import { createCauceWebGpuBackend } from "./webgpu-shared.js";

// MLS-MPM compute sequence adapted from the Three.js r185
// webgpu_compute_particles_fluid example and holtsetio/flow (MIT).
// Cauce owns the deterministic clock, emitter, force fields and rendering layer.

const PROJECT_ID = "fluid-particles-webgpu";
const MAX_PARTICLES = 262144;
const MAX_GRID_SIZE = 96;
const MAX_GRID_CELLS = MAX_GRID_SIZE ** 3;
const PARTICLE_STRIDE = 28;
const WORKGROUP_SIZE = 64;
const FIXED_POINT_MULTIPLIER = 1e7;
const FIXED_FRAME_SECONDS = 1 / 60;
const MAX_CATCH_UP_STEPS = 4;

function nearestGridSize(value) {
  const requested = Number.isFinite(value) ? value : 64;
  return [48, 64, 96].reduce((best, candidate) => (
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best
  ), 64);
}

function setPaletteColor(THREE, target, value, saturation) {
  target.set(value);
  const luminance = target.r * 0.2126 + target.g * 0.7152 + target.b * 0.0722;
  target.setRGB(
    luminance + (target.r - luminance) * saturation,
    luminance + (target.g - luminance) * saturation,
    luminance + (target.b - luminance) * saturation
  );
}

// Low-poly rounded prism adapted from holtsetio/flow. It keeps the long
// silhouette readable with tens of thousands of instances and a cheap shadow pass.
function createFlowRoundedBox(THREE, width, height, depth, radius) {
  const geometry = new THREE.BoxGeometry(
    width - radius * 2,
    height - radius * 2,
    depth - radius * 2
  );
  const epsilon = Math.min(width, height, depth) * 0.01;
  const positions = geometry.attributes.position.array;
  const normals = geometry.attributes.normal.array;
  const indices = [...geometry.getIndex().array];
  const vertices = [];
  const positionMap = {};
  const edgeMap = {};

  for (let index = 0; index < positions.length / 3; index += 1) {
    const offset = index * 3;
    const original = new THREE.Vector3(
      positions[offset],
      positions[offset + 1],
      positions[offset + 2]
    );
    positions[offset] += normals[offset] * radius;
    positions[offset + 1] += normals[offset + 1] * radius;
    positions[offset + 2] += normals[offset + 2] * radius;
    const vertex = new THREE.Vector3(
      positions[offset],
      positions[offset + 1],
      positions[offset + 2]
    );
    vertex.flowNormal = new THREE.Vector3(normals[offset], normals[offset + 1], normals[offset + 2]);
    vertex.flowId = index;
    vertex.flowFaces = [];
    vertex.flowHash = original.toArray().map((value) => Math.round(value / epsilon)).join("_");
    positionMap[vertex.flowHash] = [...(positionMap[vertex.flowHash] ?? []), vertex];
    vertices.push(vertex);
  }

  for (const vertex of vertices) {
    const face = vertex.flowNormal.toArray().map((value) => Math.round(value)).join("_");
    vertex.flowFace = face;
    for (const sibling of positionMap[vertex.flowHash]) sibling.flowFaces.push(face);
  }

  for (const vertex of vertices) {
    const addToEdge = (entry) => {
      edgeMap[entry] = [...(edgeMap[entry] ?? []), vertex];
    };
    vertex.flowFaces.sort();
    const [face0, face1, face2] = vertex.flowFaces;
    if (face0 === vertex.flowFace || face1 === vertex.flowFace) addToEdge(`${face0}_${face1}`);
    if (face0 === vertex.flowFace || face2 === vertex.flowFace) addToEdge(`${face0}_${face2}`);
    if (face1 === vertex.flowFace || face2 === vertex.flowFace) addToEdge(`${face1}_${face2}`);
  }

  const addFace = (vertex0, vertex1, vertex2) => {
    const sideA = vertex1.clone().sub(vertex0);
    const sideB = vertex2.clone().sub(vertex0);
    if (sideA.cross(sideB).dot(vertex0) > 0) {
      indices.push(vertex0.flowId, vertex1.flowId, vertex2.flowId);
    } else {
      indices.push(vertex0.flowId, vertex2.flowId, vertex1.flowId);
    }
  };

  for (const siblings of Object.values(positionMap)) addFace(...siblings);
  for (const edgeVertices of Object.values(edgeMap)) {
    const first = edgeVertices[0];
    edgeVertices.sort((left, right) => left.distanceTo(first) - right.distanceTo(first));
    addFace(...edgeVertices.slice(0, 3));
    addFace(...edgeVertices.slice(1, 4));
  }

  geometry.setIndex(indices);
  return geometry;
}

async function createFluidParticlesWebGpuRenderer(canvas) {
  const { THREE, renderer, backendName, flush } = await createCauceWebGpuBackend(canvas, {
    antialias: false,
    depth: true,
    requireWebGpu: true,
    requiredLimits: { maxStorageBuffersInVertexStage: 1 }
  });
  const {
    Fn,
    If,
    Loop,
    Return,
    array,
    atomicAdd,
    atomicLoad,
    atomicStore,
    attribute,
    clamp: tslClamp,
    cos,
    float,
    instanceIndex,
    instancedArray,
    int,
    ivec3,
    mat3,
    max: tslMax,
    mix,
    normalLocal,
    pow,
    sin,
    smoothstep,
    step,
    struct,
    uniform,
    uv,
    varying,
    varyingProperty,
    vec3,
    vec4
  } = await import("three/tsl");
  const { mergeGeometries } = await import("three/addons/utils/BufferGeometryUtils.js");

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const ambientLight = new THREE.HemisphereLight(0xffffff, 0x090b12, 0);
  const spotLight = new THREE.SpotLight(0xffffff, 0, 12, Math.PI * 0.2, 1, 0);
  const spotTarget = new THREE.Object3D();
  spotLight.position.set(-1.5, 2.2, 2.4);
  spotTarget.position.set(0, 0.25, 0);
  spotLight.target = spotTarget;
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.set(1024, 1024);
  spotLight.shadow.bias = -0.002;
  spotLight.shadow.camera.near = 0.5;
  spotLight.shadow.camera.far = 8;
  scene.add(ambientLight, spotLight, spotTarget);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  const cameraTarget = new THREE.Vector3();
  const backgroundColor = new THREE.Color();

  const particleStruct = struct({
    position: { type: "vec3" },
    velocity: { type: "vec3" },
    C: { type: "mat3" },
    density: { type: "float" },
    mass: { type: "float" },
    direction: { type: "vec3" }
  });
  const particleBuffer = instancedArray(
    new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE),
    particleStruct
  );

  const cellStruct = struct({
    x: { type: "int", atomic: true },
    y: { type: "int", atomic: true },
    z: { type: "int", atomic: true },
    mass: { type: "int", atomic: true }
  });
  const cellBuffer = instancedArray(MAX_GRID_CELLS, cellStruct);
  const cellBufferFloat = instancedArray(MAX_GRID_CELLS, "vec4");

  const uniforms = {
    gridSize: uniform(new THREE.Vector3(64, 64, 64)),
    particleCount: uniform(65536, "uint"),
    stiffness: uniform(42),
    restDensity: uniform(1.5),
    viscosity: uniform(0.12),
    dt: uniform(FIXED_FRAME_SECONDS),
    simulationTime: uniform(0),
    seed: uniform(1),
    emitterShape: uniform(0),
    containerShape: uniform(0),
    forceMode: uniform(0),
    forceStrength: uniform(1.15),
    turbulence: uniform(0.62),
    fieldFrequency: uniform(5.4),
    damping: uniform(0.025),
    densityResponse: uniform(0.05),
    directionResponse: uniform(0.1),
    domainScale: uniform(2.25),
    particleSize: uniform(1),
    flowLength: uniform(4.6),
    flowAutoScale: uniform(1),
    colorMode: uniform(0),
    rgbSplit: uniform(0.72),
    paletteMix: uniform(1),
    exposure: uniform(1.05),
    opacity: uniform(0.82),
    foreground: uniform(new THREE.Color("#f4f3ee")),
    accent: uniform(new THREE.Color("#50d7ff")),
    secondary: uniform(new THREE.Color("#ff4867"))
  };

  const encodeFixedPoint = (value) => int(value.mul(FIXED_POINT_MULTIPLIER));
  const decodeFixedPoint = (value) => float(value).div(FIXED_POINT_MULTIPLIER);
  const gridInteger = () => int(uniforms.gridSize.x);
  const cellPointer = (cell) => {
    const size = gridInteger();
    return cell.x.mul(size.mul(size)).add(cell.y.mul(size)).add(cell.z);
  };

  const clampToRoundedBox = (position, box, radius) => {
    const result = position.sub(0.5).toVar();
    const protrusion = step(box, result.abs()).mul(result.add(box.negate().mul(result.sign())));
    const distance = protrusion.length().sub(radius);
    If(distance.greaterThan(0), () => {
      result.subAssign(protrusion.add(vec3(0.00001)).normalize().mul(distance).mul(1.3));
    });
    return result.add(0.5);
  };

  const clampToSphere = (position, suppliedRadius) => {
    const result = position.sub(0.5).toVar();
    const radius = float(suppliedRadius);
    const distance = result.length().toConst();
    If(distance.greaterThan(radius), () => {
      result.mulAssign(radius.div(distance));
    });
    return result.add(0.5);
  };

  const clampToPyramid = (position) => {
    const y = tslClamp(position.y, 0.165, 0.835).toVar();
    const heightMix = y.sub(0.165).div(0.67);
    const halfWidth = mix(float(0.375), float(0.04), heightMix);
    const centered = position.sub(0.5);
    return vec3(
      tslClamp(centered.x, halfWidth.negate(), halfWidth).add(0.5),
      y,
      tslClamp(centered.z, halfWidth.negate(), halfWidth).add(0.5)
    );
  };

  const clampToContainer = (position) => {
    // The physical surface is inset from the optional guide by roughly one
    // rendered particle radius, mirroring Flow's 2–3 cell wall margin.
    const cube = clampToRoundedBox(position, vec3(0.365), float(0.06));
    const thinRectangle = clampToRoundedBox(position, vec3(0.37, 0.055, 0.33), float(0.035));
    const pyramid = clampToPyramid(position);
    const sphere = clampToSphere(position, 0.405);
    return uniforms.containerShape.lessThan(0.5).select(
      cube,
      uniforms.containerShape.lessThan(1.5).select(
        thinRectangle,
        uniforms.containerShape.lessThan(2.5).select(pyramid, sphere)
      )
    );
  };

  const hash = (offset) => sin(
    float(instanceIndex)
      .mul(12.9898 + offset * 17.131)
      .add(uniforms.seed.mul(78.233 + offset * 11.73))
  ).mul(43758.5453 + offset * 913.17).fract();

  const resetKernel = Fn(() => {
    const randomX = hash(0).toConst("randomX");
    const randomY = hash(1).toConst("randomY");
    const randomZ = hash(2).toConst("randomZ");
    const randomRadius = hash(3).toConst("randomRadius");
    const centered = vec3(randomX, randomY, randomZ).sub(0.5);
    const direction = centered.add(vec3(0.00001)).normalize();
    const radius = pow(randomRadius, 1 / 3).mul(0.285);

    const blob = vec3(0.5, 0.56, 0.5).add(
      direction.mul(radius).mul(vec3(1, 0.78, 1))
    );
    const column = vec3(
      randomX.mul(0.34).add(0.33),
      randomY.mul(0.63).add(0.19),
      randomZ.mul(0.34).add(0.33)
    );
    const sheet = vec3(
      randomX.mul(0.68).add(0.16),
      randomY.mul(0.24).add(0.5),
      randomZ.mul(0.18).add(0.41)
    );
    const position = uniforms.emitterShape.lessThan(0.5).select(
      blob,
      uniforms.emitterShape.lessThan(1.5).select(column, sheet)
    );

    particleBuffer.element(instanceIndex).get("position").assign(clampToContainer(position));
    particleBuffer.element(instanceIndex).get("velocity").assign(vec3(0));
    particleBuffer.element(instanceIndex).get("C").assign(mat3(0));
    particleBuffer.element(instanceIndex).get("density").assign(0);
    particleBuffer.element(instanceIndex).get("mass").assign(float(1).sub(hash(4).mul(0.002)));
    particleBuffer.element(instanceIndex).get("direction").assign(vec3(0, 0, 1));
  })().compute(65536, [WORKGROUP_SIZE, 1, 1]).setName("cauceFluidReset");

  const clearGridKernel = Fn(() => {
    const cell = cellBuffer.element(instanceIndex);
    atomicStore(cell.get("x"), 0);
    atomicStore(cell.get("y"), 0);
    atomicStore(cell.get("z"), 0);
    atomicStore(cell.get("mass"), 0);
    cellBufferFloat.element(instanceIndex).assign(vec4(0));
  })().compute(64 ** 3, [WORKGROUP_SIZE, 1, 1]).setName("cauceFluidClearGrid");

  const p2g1Kernel = Fn(() => {
    const particlePosition = particleBuffer.element(instanceIndex).get("position").toConst("particlePosition");
    const particleVelocity = particleBuffer.element(instanceIndex).get("velocity").toConst("particleVelocity");
    const affineVelocity = particleBuffer.element(instanceIndex).get("C").toConst("affineVelocity");
    const gridPosition = particlePosition.mul(uniforms.gridSize).toVar();
    const cellIndex = ivec3(gridPosition).sub(1).toConst("cellIndex");
    const cellDiff = gridPosition.fract().sub(0.5).toConst("cellDiff");
    const weight0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
    const weight1 = float(0.75).sub(cellDiff.mul(cellDiff));
    const weight2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
    const weights = array([weight0, weight1, weight2]).toConst("weights");

    Loop({ start: 0, end: 3, type: "int", name: "gx", condition: "<" }, ({ gx }) => {
      Loop({ start: 0, end: 3, type: "int", name: "gy", condition: "<" }, ({ gy }) => {
        Loop({ start: 0, end: 3, type: "int", name: "gz", condition: "<" }, ({ gz }) => {
          const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
          const cellPosition = cellIndex.add(ivec3(gx, gy, gz)).toConst();
          const cellDistance = vec3(cellPosition).add(0.5).sub(gridPosition).toConst();
          const affine = affineVelocity.mul(cellDistance);
          const massContribution = weight;
          const velocityContribution = massContribution.mul(particleVelocity.add(affine)).toConst();
          const cell = cellBuffer.element(cellPointer(cellPosition));
          atomicAdd(cell.get("x"), encodeFixedPoint(velocityContribution.x));
          atomicAdd(cell.get("y"), encodeFixedPoint(velocityContribution.y));
          atomicAdd(cell.get("z"), encodeFixedPoint(velocityContribution.z));
          atomicAdd(cell.get("mass"), encodeFixedPoint(massContribution));
        });
      });
    });
  })().compute(65536, [WORKGROUP_SIZE, 1, 1]).setName("cauceFluidP2G1");

  const p2g2Kernel = Fn(() => {
    const particlePosition = particleBuffer.element(instanceIndex).get("position").toConst("particlePosition");
    const gridPosition = particlePosition.mul(uniforms.gridSize).toVar();
    const cellIndex = ivec3(gridPosition).sub(1).toConst("cellIndex");
    const cellDiff = gridPosition.fract().sub(0.5).toConst("cellDiff");
    const weight0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
    const weight1 = float(0.75).sub(cellDiff.mul(cellDiff));
    const weight2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
    const weights = array([weight0, weight1, weight2]).toConst("weights");
    const density = float(0).toVar("density");

    Loop({ start: 0, end: 3, type: "int", name: "gx", condition: "<" }, ({ gx }) => {
      Loop({ start: 0, end: 3, type: "int", name: "gy", condition: "<" }, ({ gy }) => {
        Loop({ start: 0, end: 3, type: "int", name: "gz", condition: "<" }, ({ gz }) => {
          const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
          const cellPosition = cellIndex.add(ivec3(gx, gy, gz)).toConst();
          const mass = decodeFixedPoint(atomicLoad(cellBuffer.element(cellPointer(cellPosition)).get("mass")));
          density.addAssign(mass.mul(weight));
        });
      });
    });

    const safeDensity = tslMax(density, 0.00001);
    const storedDensity = particleBuffer.element(instanceIndex).get("density");
    storedDensity.assign(mix(storedDensity, safeDensity, uniforms.densityResponse));
    const volume = float(1).div(safeDensity);
    const pressure = tslMax(
      0,
      pow(safeDensity.div(uniforms.restDensity), 5).sub(1).mul(uniforms.stiffness)
    ).toConst("pressure");
    const stress = mat3(
      pressure.negate(), 0, 0,
      0, pressure.negate(), 0,
      0, 0, pressure.negate()
    ).toVar("stress");
    const velocityGradient = particleBuffer.element(instanceIndex).get("C").toConst();
    stress.addAssign(velocityGradient.add(velocityGradient.transpose()).mul(uniforms.viscosity));
    const stressImpulse = volume.mul(-4).mul(stress).mul(uniforms.dt);

    Loop({ start: 0, end: 3, type: "int", name: "gx", condition: "<" }, ({ gx }) => {
      Loop({ start: 0, end: 3, type: "int", name: "gy", condition: "<" }, ({ gy }) => {
        Loop({ start: 0, end: 3, type: "int", name: "gz", condition: "<" }, ({ gz }) => {
          const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
          const cellPosition = cellIndex.add(ivec3(gx, gy, gz)).toConst();
          const cellDistance = vec3(cellPosition).add(0.5).sub(gridPosition).toConst();
          const momentum = stressImpulse.mul(weight).mul(cellDistance).toConst();
          const cell = cellBuffer.element(cellPointer(cellPosition));
          atomicAdd(cell.get("x"), encodeFixedPoint(momentum.x));
          atomicAdd(cell.get("y"), encodeFixedPoint(momentum.y));
          atomicAdd(cell.get("z"), encodeFixedPoint(momentum.z));
        });
      });
    });
  })().compute(65536, [WORKGROUP_SIZE, 1, 1]).setName("cauceFluidP2G2");

  const updateGridKernel = Fn(() => {
    const cell = cellBuffer.element(instanceIndex);
    const mass = decodeFixedPoint(atomicLoad(cell.get("mass"))).toConst();
    If(mass.lessThanEqual(0), () => {
      cellBufferFloat.element(instanceIndex).assign(vec4(0));
      Return();
    });

    const velocityX = decodeFixedPoint(atomicLoad(cell.get("x"))).div(mass).toVar();
    const velocityY = decodeFixedPoint(atomicLoad(cell.get("y"))).div(mass).toVar();
    const velocityZ = decodeFixedPoint(atomicLoad(cell.get("z"))).div(mass).toVar();
    const size = gridInteger();
    const plane = size.mul(size);
    const x = int(instanceIndex).div(plane);
    const y = int(instanceIndex).div(size).mod(size);
    const z = int(instanceIndex).mod(size);
    If(x.lessThan(1).or(x.greaterThan(size.sub(2))), () => velocityX.assign(0));
    If(y.lessThan(1).or(y.greaterThan(size.sub(2))), () => velocityY.assign(0));
    If(z.lessThan(1).or(z.greaterThan(size.sub(2))), () => velocityZ.assign(0));
    cellBufferFloat.element(instanceIndex).assign(vec4(velocityX, velocityY, velocityZ, mass));
  })().compute(64 ** 3, [WORKGROUP_SIZE, 1, 1]).setName("cauceFluidUpdateGrid");

  const g2pKernel = Fn(() => {
    const particlePosition = particleBuffer.element(instanceIndex).get("position").toVar("particlePosition");
    const gridPosition = particlePosition.mul(uniforms.gridSize).toVar();
    const particleVelocity = vec3(0).toVar("particleVelocity");
    const cellIndex = ivec3(gridPosition).sub(1).toConst("cellIndex");
    const cellDiff = gridPosition.fract().sub(0.5).toConst("cellDiff");
    const weight0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
    const weight1 = float(0.75).sub(cellDiff.mul(cellDiff));
    const weight2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
    const weights = array([weight0, weight1, weight2]).toConst("weights");
    const affine = mat3(0).toVar("affine");

    Loop({ start: 0, end: 3, type: "int", name: "gx", condition: "<" }, ({ gx }) => {
      Loop({ start: 0, end: 3, type: "int", name: "gy", condition: "<" }, ({ gy }) => {
        Loop({ start: 0, end: 3, type: "int", name: "gz", condition: "<" }, ({ gz }) => {
          const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
          const cellPosition = cellIndex.add(ivec3(gx, gy, gz)).toConst();
          const cellDistance = vec3(cellPosition).add(0.5).sub(gridPosition).toConst();
          const weightedVelocity = cellBufferFloat.element(cellPointer(cellPosition)).xyz.mul(weight).toConst();
          affine.addAssign(mat3(
            weightedVelocity.mul(cellDistance.x),
            weightedVelocity.mul(cellDistance.y),
            weightedVelocity.mul(cellDistance.z)
          ));
          particleVelocity.addAssign(weightedVelocity);
        });
      });
    });

    particleBuffer.element(instanceIndex).get("C").assign(affine.mul(4));
    particleVelocity.divAssign(uniforms.gridSize);

    const centered = particlePosition.sub(0.5);
    const phase = uniforms.simulationTime;
    const frequency = uniforms.fieldFrequency;
    const curl = vec3(
      sin(centered.y.mul(frequency).add(phase)).sub(cos(centered.z.mul(frequency.mul(0.83)).sub(phase.mul(0.71)))),
      sin(centered.z.mul(frequency.mul(0.91)).sub(phase.mul(0.67))).sub(cos(centered.x.mul(frequency).add(phase.mul(0.53)))),
      sin(centered.x.mul(frequency.mul(0.79)).add(phase.mul(0.73))).sub(cos(centered.y.mul(frequency.mul(0.87)).sub(phase)))
    );
    const detail = vec3(
      sin(centered.z.mul(frequency.mul(2.7)).add(phase.mul(1.7))),
      cos(centered.x.mul(frequency.mul(2.3)).sub(phase.mul(1.3))),
      sin(centered.y.mul(frequency.mul(2.5)).add(phase.mul(1.5)))
    ).mul(uniforms.turbulence);
    const flowForce = curl.add(detail).add(vec3(0, 0.08, 0));
    const gravityForce = vec3(0, -1, 0);
    const centerForce = centered.negate().add(vec3(0.00001)).normalize();
    const orbitForce = vec3(
      centered.z.negate(),
      sin(centered.x.mul(8).add(phase)).mul(0.24),
      centered.x
    ).add(vec3(0.00001)).normalize();
    const selectedForce = uniforms.forceMode.lessThan(0.5).select(
      flowForce,
      uniforms.forceMode.lessThan(1.5).select(
        gravityForce,
        uniforms.forceMode.lessThan(2.5).select(centerForce, orbitForce)
      )
    );
    particleVelocity.addAssign(selectedForce.mul(uniforms.forceStrength).mul(uniforms.dt));
    particleVelocity.mulAssign(tslMax(0, float(1).sub(uniforms.damping.mul(uniforms.dt))));
    particleVelocity.mulAssign(particleBuffer.element(instanceIndex).get("mass"));
    particlePosition.addAssign(particleVelocity.mul(uniforms.dt));

    particlePosition.assign(tslClamp(
      particlePosition,
      vec3(1).div(uniforms.gridSize),
      uniforms.gridSize.sub(1).div(uniforms.gridSize)
    ));

    // Flow first stores a hard-clamped position, then anticipates the next
    // collision to bend velocity before the following P2G pass. Applying the
    // same two-stage rule to every Cauce shape prevents visual and numerical leaks.
    particlePosition.assign(clampToContainer(particlePosition));
    const nextPosition = particlePosition.add(particleVelocity.mul(uniforms.dt).mul(3));
    const boundedPosition = clampToContainer(nextPosition);
    particleVelocity.addAssign(boundedPosition.sub(nextPosition).mul(0.3));
    particleVelocity.mulAssign(uniforms.gridSize);

    const storedDirection = particleBuffer.element(instanceIndex).get("direction");
    storedDirection.assign(mix(storedDirection, particleVelocity, uniforms.directionResponse));

    particleBuffer.element(instanceIndex).get("position").assign(particlePosition);
    particleBuffer.element(instanceIndex).get("velocity").assign(particleVelocity);
  })().compute(65536, [WORKGROUP_SIZE, 1, 1]).setName("cauceFluidG2P");

  const particlePositionNode = particleBuffer.element(instanceIndex).get("position");
  const particleVelocityNode = particleBuffer.element(instanceIndex).get("velocity");
  const worldPositionNode = particlePositionNode.sub(0.5).mul(uniforms.domainScale);
  const normalizedVelocity = particleVelocityNode.abs().add(vec3(0.0001)).normalize();
  const verticalMix = smoothstep(0.08, 0.92, particlePositionNode.y);
  const paletteColor = mix(uniforms.foreground, uniforms.accent, verticalMix);
  const chromaticColor = mix(paletteColor, uniforms.secondary, normalizedVelocity.z.mul(0.72));
  const whiteToRgb = mix(vec3(1), normalizedVelocity, uniforms.rgbSplit);
  const velocityColor = normalizedVelocity.mul(0.8).add(vec3(0.2));
  const selectedColor = uniforms.colorMode.lessThan(0.5).select(
    mix(vec3(1), chromaticColor, uniforms.paletteMix),
    uniforms.colorMode.lessThan(1.5).select(whiteToRgb, velocityColor)
  ).mul(uniforms.exposure);
  const particleColor = varying(selectedColor, "cauceFluidParticleColor");

  const pointCoordinates = uv().mul(2).sub(1);
  const radiusSquared = pointCoordinates.dot(pointCoordinates);
  const circleMask = float(1).sub(smoothstep(0.72, 1, radiusSquared));
  const pointLight = float(1).sub(radiusSquared.mul(0.55)).max(0.28);
  const pointMaterial = new THREE.PointsNodeMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
    sizeAttenuation: true
  });
  pointMaterial.positionNode = worldPositionNode;
  pointMaterial.sizeNode = uniforms.particleSize.mul(0.025);
  pointMaterial.colorNode = particleColor.mul(pointLight);
  pointMaterial.opacityNode = circleMask.mul(uniforms.opacity);
  pointMaterial.alphaTestNode = float(0.002);
  pointMaterial.alphaToCoverage = true;
  const pointParticles = new THREE.Sprite(pointMaterial);
  pointParticles.count = 65536;
  pointParticles.frustumCulled = false;
  root.add(pointParticles);

  function createParticleMesh(geometry, sizeMultiplier) {
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: true,
      toneMapped: false
    });
    material.positionNode = attribute("position")
      .mul(uniforms.particleSize.mul(sizeMultiplier))
      .add(worldPositionNode);
    material.colorNode = particleColor;
    material.opacityNode = uniforms.opacity;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.count = 65536;
    mesh.frustumCulled = false;
    mesh.visible = false;
    root.add(mesh);
    return { mesh, material, geometry };
  }

  const sphereParticles = createParticleMesh(new THREE.IcosahedronGeometry(1, 0), 0.0095);
  const cubeParticles = createParticleMesh(new THREE.BoxGeometry(1, 1, 1), 0.014);

  const roundedFlowSource = createFlowRoundedBox(THREE, 1, 1, 1, 0.24);
  const flowShadowSource = new THREE.BoxGeometry(1, 1, 1);
  const flowSurfaceIndexCount = roundedFlowSource.index.count;
  const mergedFlowGeometry = mergeGeometries([roundedFlowSource, flowShadowSource]);
  if (!mergedFlowGeometry) throw new Error("No se pudo construir la geometría Flow orgánica.");
  roundedFlowSource.dispose();
  flowShadowSource.dispose();
  const organicGeometry = new THREE.InstancedBufferGeometry().copy(mergedFlowGeometry);
  mergedFlowGeometry.dispose();
  organicGeometry.setDrawRange(0, flowSurfaceIndexCount);
  organicGeometry.instanceCount = 65536;

  const organicNormal = varyingProperty("vec3", "cauceFlowOrganicNormal");
  const organicMaterial = new THREE.MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 0.82,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    toneMapped: false
  });
  organicMaterial.positionNode = Fn(() => {
    const particle = particleBuffer.element(instanceIndex);
    const direction = particle.get("direction").add(vec3(0.00001));
    const forward = direction.normalize().toVar();
    const reference = forward.z.abs().greaterThan(0.98).select(
      vec3(0, 1, 0),
      vec3(0, 0, 1)
    );
    const right = forward.cross(reference).add(vec3(0.00001)).normalize().negate();
    const up = right.cross(forward).add(vec3(0.00001)).normalize().negate();
    const orientation = mat3(right, up, forward);
    const densityScale = particle.get("density").mul(0.4).add(0.5).clamp(0.35, 1.15);
    const radius = uniforms.particleSize.mul(uniforms.flowAutoScale).mul(0.014);
    const shapeScale = vec3(radius, radius, radius.mul(uniforms.flowLength));
    organicNormal.assign(orientation.mul(normalLocal).normalize());
    return orientation
      .mul(attribute("position").mul(shapeScale).mul(densityScale))
      .add(worldPositionNode);
  })();
  organicMaterial.normalNode = organicNormal;
  organicMaterial.colorNode = particleColor;
  organicMaterial.opacityNode = uniforms.opacity;

  const organicParticles = new THREE.Mesh(organicGeometry, organicMaterial);
  organicParticles.frustumCulled = false;
  organicParticles.visible = false;
  organicParticles.castShadow = true;
  organicParticles.receiveShadow = true;
  organicParticles.onBeforeShadow = () => {
    organicGeometry.setDrawRange(flowSurfaceIndexCount, Infinity);
  };
  organicParticles.onAfterShadow = () => {
    organicGeometry.setDrawRange(0, flowSurfaceIndexCount);
  };
  root.add(organicParticles);

  const particleViews = [
    pointParticles,
    sphereParticles.mesh,
    cubeParticles.mesh,
    organicParticles
  ];

  const boundaryMaterial = new THREE.LineBasicMaterial({
    color: "#f4f3ee",
    transparent: true,
    opacity: 0.24,
    depthWrite: false
  });

  function createBoundary(sourceGeometry, wireframe = false) {
    const geometry = wireframe
      ? new THREE.WireframeGeometry(sourceGeometry)
      : new THREE.EdgesGeometry(sourceGeometry);
    sourceGeometry.dispose();
    const lines = new THREE.LineSegments(geometry, boundaryMaterial);
    lines.visible = false;
    root.add(lines);
    return { lines, geometry };
  }

  const pyramidGeometry = new THREE.ConeGeometry(Math.SQRT2 * 0.4, 0.72, 4, 1, false);
  pyramidGeometry.rotateY(Math.PI / 4);
  const boundaries = [
    createBoundary(new THREE.BoxGeometry(0.9, 0.9, 0.9)),
    createBoundary(new THREE.BoxGeometry(0.86, 0.23, 0.78)),
    createBoundary(pyramidGeometry),
    createBoundary(new THREE.IcosahedronGeometry(0.43, 2), true)
  ];

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
  let resetSignature = "";
  let lastElapsedTime = null;
  let accumulator = 0;
  let simulationTime = 0;

  function resize(nextViewport) {
    viewport = { ...nextViewport };
    renderer.setPixelRatio(nextViewport.pixelRatio);
    renderer.setSize(nextViewport.width, nextViewport.height, false);
    camera.aspect = Math.max(0.0001, nextViewport.contentWidth / nextViewport.contentHeight);
    camera.updateProjectionMatrix();
  }

  function updateParameters(frame) {
    const particleCount = clamp(
      Math.round(parameter(frame, "particleCount", 65536)),
      4096,
      MAX_PARTICLES
    );
    const gridSize = nearestGridSize(parameter(frame, "gridResolution", 64));
    const gridCells = gridSize ** 3;
    const emitterShape = clamp(Math.round(parameter(frame, "emitterShape", 0)), 0, 2);
    const containerShape = clamp(Math.round(parameter(frame, "containerShape", 0)), 0, 3);
    const representation = clamp(Math.round(parameter(frame, "representation", 0)), 0, 3);

    uniforms.gridSize.value.set(gridSize, gridSize, gridSize);
    uniforms.particleCount.value = particleCount;
    uniforms.stiffness.value = parameter(frame, "stiffness", 42);
    uniforms.restDensity.value = parameter(frame, "restDensity", 1.5);
    uniforms.viscosity.value = parameter(frame, "viscosity", 0.12);
    uniforms.seed.value = frame.seed;
    uniforms.emitterShape.value = emitterShape;
    uniforms.containerShape.value = containerShape;
    uniforms.forceMode.value = clamp(Math.round(parameter(frame, "forceMode", 0)), 0, 3);
    uniforms.forceStrength.value = parameter(frame, "forceStrength", 1.15);
    uniforms.turbulence.value = parameter(frame, "turbulence", 0.62);
    uniforms.fieldFrequency.value = parameter(frame, "fieldFrequency", 5.4);
    uniforms.damping.value = parameter(frame, "damping", 0.025);
    uniforms.densityResponse.value = parameter(frame, "densityResponse", 0.05);
    uniforms.directionResponse.value = parameter(frame, "directionResponse", 0.1);
    uniforms.domainScale.value = parameter(frame, "domainScale", 2.25);
    uniforms.particleSize.value = parameter(frame, "particleSize", 1);
    uniforms.flowLength.value = parameter(frame, "flowLength", 4.6);
    uniforms.flowAutoScale.value = 1.6 / Math.cbrt(Math.max(particleCount / 8192, 1));
    uniforms.colorMode.value = clamp(Math.round(parameter(frame, "colorMode", 0)), 0, 2);
    uniforms.rgbSplit.value = parameter(frame, "rgbSplit", 0.72);
    uniforms.paletteMix.value = parameter(frame, "paletteMix", 1);
    uniforms.exposure.value = parameter(frame, "exposure", 1.05);
    uniforms.opacity.value = parameter(frame, "opacity", 0.82);

    const saturation = parameter(frame, "saturation", 1);
    setPaletteColor(THREE, uniforms.foreground.value, frame.palette.foreground, saturation);
    setPaletteColor(THREE, uniforms.accent.value, frame.palette.accent, saturation);
    setPaletteColor(
      THREE,
      uniforms.secondary.value,
      frame.palette.secondary ?? frame.palette.accent,
      saturation
    );
    boundaryMaterial.color.set(frame.palette.foreground);

    resetKernel.count = particleCount;
    p2g1Kernel.count = particleCount;
    p2g2Kernel.count = particleCount;
    g2pKernel.count = particleCount;
    clearGridKernel.count = gridCells;
    updateGridKernel.count = gridCells;
    for (let index = 0; index < particleViews.length; index += 1) {
      particleViews[index].count = particleCount;
      particleViews[index].visible = index === representation;
    }
    organicGeometry.instanceCount = particleCount;
    const shadowStrength = parameter(frame, "shadowStrength", 1);
    ambientLight.intensity = representation === 3 ? 0.65 * shadowStrength : 0;
    spotLight.intensity = representation === 3 ? 4.2 * shadowStrength : 0;
    const containerVisible = parameter(frame, "containerVisible", 0) >= 0.5;
    for (let index = 0; index < boundaries.length; index += 1) {
      boundaries[index].lines.visible = containerVisible && index === containerShape;
      boundaries[index].lines.scale.setScalar(uniforms.domainScale.value);
    }

    return {
      particleCount,
      gridSize,
      substeps: clamp(Math.round(parameter(frame, "substeps", 1)), 1, 2),
      simulationSpeed: parameter(frame, "simulationSpeed", 1),
      resetSignature: `${frame.seed}:${particleCount}:${gridSize}:${emitterShape}:${containerShape}`
    };
  }

  function resetSimulation(frame, settings) {
    renderer.compute(resetKernel);
    resetSignature = settings.resetSignature;
    lastElapsedTime = frame.elapsedTime;
    accumulator = 0;
    simulationTime = frame.elapsedTime;
    uniforms.simulationTime.value = simulationTime;
  }

  function simulateFixedFrame(settings) {
    const dt = FIXED_FRAME_SECONDS * settings.simulationSpeed / settings.substeps;
    uniforms.dt.value = dt;
    for (let substep = 0; substep < settings.substeps; substep += 1) {
      simulationTime += dt;
      uniforms.simulationTime.value = simulationTime;
      renderer.compute(clearGridKernel);
      renderer.compute(p2g1Kernel);
      renderer.compute(p2g2Kernel);
      renderer.compute(updateGridKernel);
      renderer.compute(g2pKernel);
    }
  }

  function advanceSimulation(frame, settings) {
    if (settings.resetSignature !== resetSignature || lastElapsedTime === null) {
      resetSimulation(frame, settings);
      return;
    }
    const delta = frame.elapsedTime - lastElapsedTime;
    lastElapsedTime = frame.elapsedTime;
    if (delta < -0.000001 || delta > 0.5) {
      resetSimulation(frame, settings);
      return;
    }
    accumulator += Math.max(0, delta);
    let fixedSteps = 0;
    while (accumulator + 1e-7 >= FIXED_FRAME_SECONDS && fixedSteps < MAX_CATCH_UP_STEPS) {
      simulateFixedFrame(settings);
      accumulator -= FIXED_FRAME_SECONDS;
      fixedSteps += 1;
    }
    if (fixedSteps === MAX_CATCH_UP_STEPS) {
      accumulator = Math.min(accumulator, FIXED_FRAME_SECONDS);
    }
  }

  function updateCamera(frame) {
    const view = frame.view ?? {};
    const orbitYaw = (Number.isFinite(view.orbitYaw) ? view.orbitYaw : 0) * Math.PI / 180;
    const orbitPitch = (Number.isFinite(view.orbitPitch) ? view.orbitPitch : 0) * Math.PI / 180;
    const zoom = Number.isFinite(view.zoom) ? clamp(view.zoom, 0.35, 4) : 1;
    const aspect = compositionMetrics(frame).aspect;
    const formatDistance = aspect < 1 ? Math.pow(1 / aspect, 0.16) : Math.pow(aspect, -0.04);
    const distance = parameter(frame, "cameraDistance", 4.1) * formatDistance / zoom;
    const cosinePitch = Math.cos(orbitPitch);
    cameraTarget.set(
      -(Number.isFinite(view.panX) ? view.panX : 0) * 2.5,
      (Number.isFinite(view.panY) ? view.panY : 0) * 2.5,
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
    root.rotation.y = frame.elapsedTime * parameter(frame, "sceneRotation", 0.035);
    root.rotation.x = parameter(frame, "tilt", -8) * Math.PI / 180;
  }

  function render(frame) {
    if (disposed) return;
    const settings = updateParameters(frame);
    advanceSimulation(frame, settings);
    updateCamera(frame);

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
    resetKernel.dispose();
    clearGridKernel.dispose();
    p2g1Kernel.dispose();
    p2g2Kernel.dispose();
    updateGridKernel.dispose();
    g2pKernel.dispose();
    pointMaterial.dispose();
    sphereParticles.material.dispose();
    sphereParticles.geometry.dispose();
    cubeParticles.material.dispose();
    cubeParticles.geometry.dispose();
    organicMaterial.dispose();
    organicGeometry.dispose();
    for (const boundary of boundaries) boundary.geometry.dispose();
    boundaryMaterial.dispose();
    renderer.dispose();
  }

  return { resize, render, flush, dispose, backendName };
}

export const fluidParticlesWebGpuProject = {
  id: PROJECT_ID,
  index: "08.3",
  name: "Fluid Particles WebGPU",
  label: "Cauce — Fluid Particles WebGPU",
  description: "Líquido tridimensional de partículas resuelto en GPU mediante MLS-MPM, con contenedores físicos intercambiables y límite visual opcional.",
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
    { key: "particleCount", label: "Partículas", min: 4096, max: MAX_PARTICLES, step: 4096, defaultValue: 65536, digits: 0 },
    { key: "gridResolution", label: "Grid físico", min: 48, max: 96, step: 16, defaultValue: 64, digits: 0, options: [
      { value: 48, label: "48³ · Rápido", description: "Menor coste y líquido más blando." },
      { value: 64, label: "64³ · Equilibrado", description: "Resolución base recomendada para edición." },
      { value: 96, label: "96³ · Alto", description: "Más detalle espacial y mayor coste de cómputo." }
    ] },
    { key: "substeps", label: "Subpasos", min: 1, max: 2, step: 1, defaultValue: 1, digits: 0, options: [
      { value: 1, label: "1 · Tiempo real", description: "Un ciclo físico por paso de 60 Hz." },
      { value: 2, label: "2 · Estable", description: "Duplica el cómputo y mejora la estabilidad." }
    ] },
    { key: "emitterShape", label: "Volumen inicial", min: 0, max: 2, step: 1, defaultValue: 0, digits: 0, options: [
      { value: 0, label: "Gota", description: "Masa compacta y redondeada." },
      { value: 1, label: "Columna", description: "Volumen vertical para caídas y torsión." },
      { value: 2, label: "Lámina", description: "Plano estrecho que el campo convierte en pliegue." }
    ] },
    { key: "forceMode", label: "Campo de fuerza", min: 0, max: 3, step: 1, defaultValue: 0, digits: 0, options: [
      { value: 0, label: "Flujo", description: "Campo curl orgánico sin dirección única." },
      { value: 1, label: "Gravedad", description: "Caída vertical dentro del contenedor." },
      { value: 2, label: "Cohesión", description: "Atracción hacia el centro del volumen." },
      { value: 3, label: "Órbita", description: "Circulación espacial alrededor del eje." }
    ] },
    { key: "forceStrength", label: "Fuerza", min: 0, max: 4, step: 0.01, defaultValue: 1.15, digits: 2 },
    { key: "turbulence", label: "Turbulencia", min: 0, max: 2.5, step: 0.01, defaultValue: 0.62, digits: 2 },
    { key: "fieldFrequency", label: "Escala del campo", min: 1, max: 14, step: 0.1, defaultValue: 5.4, digits: 1 },
    { key: "simulationSpeed", label: "Velocidad física", min: 0.1, max: 2, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "stiffness", label: "Rigidez", min: 8, max: 80, step: 1, defaultValue: 42, digits: 0 },
    { key: "viscosity", label: "Viscosidad", min: 0.01, max: 2, step: 0.01, defaultValue: 0.12, digits: 2 },
    { key: "restDensity", label: "Densidad objetivo", min: 1, max: 2.2, step: 0.05, defaultValue: 1.5, digits: 2 },
    { key: "damping", label: "Amortiguación", min: 0, max: 0.25, step: 0.005, defaultValue: 0.025, digits: 3 },
    { key: "representation", label: "Representación", min: 0, max: 3, step: 1, defaultValue: 0, digits: 0, options: [
      { value: 0, label: "Redonda", description: "Sprites circulares: máxima densidad y velocidad." },
      { value: 1, label: "Esfera", description: "Geometría 3D de bajo poligonaje." },
      { value: 2, label: "Cubo", description: "Partícula geométrica con arista visible." },
      { value: 3, label: "Flow orgánica", description: "Prismas redondeados largos que crecen con la densidad y se alinean como una bandada." }
    ] },
    { key: "particleSize", label: "Tamaño de partícula", min: 0.25, max: 3, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "flowLength", label: "Longitud orgánica", min: 2, max: 8, step: 0.05, defaultValue: 4.6, digits: 2 },
    { key: "densityResponse", label: "Crecimiento por densidad", min: 0.01, max: 0.2, step: 0.005, defaultValue: 0.05, digits: 3 },
    { key: "directionResponse", label: "Alineación de bandada", min: 0.02, max: 0.4, step: 0.01, defaultValue: 0.1, digits: 2 },
    { key: "containerShape", label: "Forma del contenedor", min: 0, max: 3, step: 1, defaultValue: 0, digits: 0, options: [
      { value: 0, label: "Cubo", description: "Volumen equilibrado con esquinas suavizadas." },
      { value: 1, label: "Rectángulo fino", description: "Volumen 0,86 × 0,23 × 0,78: una cámara claramente comprimida." },
      { value: 2, label: "Pirámide", description: "Base cuadrada que converge hacia un ápice superior." },
      { value: 3, label: "Esfera", description: "Límite radial continuo sin esquinas." }
    ] },
    { key: "containerVisible", label: "Mostrar contenedor", min: 0, max: 1, step: 1, defaultValue: 0, digits: 0, options: [
      { value: 0, label: "Invisible", description: "El límite físico actúa sin dibujarse." },
      { value: 1, label: "Visible", description: "Muestra el volumen de simulación." }
    ] },
    { key: "domainScale", label: "Escala espacial", min: 1, max: 3.5, step: 0.01, defaultValue: 2.25, digits: 2 },
    { key: "sceneRotation", label: "Rotación espacial", min: -0.3, max: 0.3, step: 0.005, defaultValue: 0.035, digits: 3 },
    { key: "tilt", label: "Inclinación", min: -90, max: 90, step: 1, defaultValue: -8, digits: 0, suffix: "°" },
    { key: "fov", label: "Campo de visión", min: 20, max: 75, step: 1, defaultValue: 42, digits: 0, suffix: "°" },
    { key: "cameraDistance", label: "Distancia de cámara", min: 2.5, max: 8, step: 0.05, defaultValue: 4.1, digits: 2 },
    { key: "colorMode", label: "Modelo de color", min: 0, max: 2, step: 1, defaultValue: 0, digits: 0, group: "color3d", options: [
      { value: 0, label: "Paleta", description: "Interpola los colores persistentes de Cauce." },
      { value: 1, label: "Blanco → RGB", description: "Divide el blanco según la dirección de velocidad." },
      { value: 2, label: "Velocidad RGB", description: "Mapea los tres ejes del movimiento a RGB." }
    ] },
    { key: "rgbSplit", label: "División RGB", min: 0, max: 1, step: 0.01, defaultValue: 0.72, digits: 2, group: "color3d" },
    { key: "paletteMix", label: "Intensidad de paleta", min: 0, max: 1, step: 0.01, defaultValue: 1, digits: 2, group: "color3d" },
    { key: "saturation", label: "Saturación", min: 0, max: 2, step: 0.01, defaultValue: 1, digits: 2, group: "color3d" },
    { key: "exposure", label: "Exposición", min: 0.2, max: 2.5, step: 0.01, defaultValue: 1.05, digits: 2, group: "color3d" },
    { key: "opacity", label: "Alpha de partícula", min: 0.05, max: 1, step: 0.01, defaultValue: 0.82, digits: 2, group: "color3d" },
    { key: "shadowStrength", label: "Sombras orgánicas", min: 0, max: 2, step: 0.01, defaultValue: 1, digits: 2, group: "color3d" }
  ],
  defaults: {
    particleCount: 65536,
    gridResolution: 64,
    substeps: 1,
    emitterShape: 0,
    forceMode: 0,
    forceStrength: 1.15,
    turbulence: 0.62,
    fieldFrequency: 5.4,
    simulationSpeed: 1,
    stiffness: 42,
    viscosity: 0.12,
    restDensity: 1.5,
    damping: 0.025,
    representation: 0,
    particleSize: 1,
    flowLength: 4.6,
    densityResponse: 0.05,
    directionResponse: 0.1,
    containerShape: 0,
    containerVisible: 0,
    domainScale: 2.25,
    sceneRotation: 0.035,
    tilt: -8,
    fov: 42,
    cameraDistance: 4.1,
    colorMode: 0,
    rgbSplit: 0.72,
    paletteMix: 1,
    saturation: 1,
    exposure: 1.05,
    opacity: 0.82,
    shadowStrength: 1
  },
  createRenderer: createFluidParticlesWebGpuRenderer
};
