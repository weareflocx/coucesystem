import { createRandom } from "../../projects/shared.js";

// Cauce Fluid Engine 0.2
//
// The engine owns the stateful MLS-MPM/APIC compute graph, its fixed-step
// scheduler and GPU buffers. Projects own cameras, geometry, materials,
// lighting and post-processing. Physical and visual state use separate storage
// buffers. The legacy CPU reset remains the default so existing seeds keep
// their exact initialization.

export const CAUCE_FLUID_MAX_PARTICLES = 8192 * 16;
export const CAUCE_FLUID_CAPACITY_PROFILES = [8192 * 4, 8192 * 8, 8192 * 16];
export const CAUCE_FLUID_GRID_SIZE = 64;
export const CAUCE_FLUID_GRID_CELLS = CAUCE_FLUID_GRID_SIZE ** 3;

const PHYSICAL_PARTICLE_STRIDE_FLOATS = 20;
const VISUAL_PARTICLE_STRIDE_FLOATS = 8;
const FIXED_FRAME_SECONDS = 1 / 60;
const MAX_CATCH_UP_STEPS = 4;
const FIXED_POINT_MULTIPLIER = 1e7;
const BASE_PASS_COUNT = 5;
const SURFACE_PASS_COUNT = 3;

export function getCauceFluidCapacityForCount(particleCount) {
  const requested = Math.max(1, Math.round(Number(particleCount) || 1));
  return CAUCE_FLUID_CAPACITY_PROFILES.find((capacity) => requested <= capacity)
    ?? CAUCE_FLUID_MAX_PARTICLES;
}

function fillInitialParticles(values, seed, capacity) {
  values.fill(0);
  const random = createRandom(seed);
  for (let index = 0; index < capacity; index += 1) {
    let x = 0;
    let y = 0;
    let z = 0;
    let distance = 2;
    while (distance > 1) {
      x = random() * 2 - 1;
      y = random() * 2 - 1;
      z = random() * 2 - 1;
      distance = Math.hypot(x, y, z);
    }
    const offset = index * PHYSICAL_PARTICLE_STRIDE_FLOATS;
    values[offset] = ((x * 0.8 + 1) / 2) * CAUCE_FLUID_GRID_SIZE;
    values[offset + 1] = ((y * 0.8 + 1) / 2) * CAUCE_FLUID_GRID_SIZE;
    values[offset + 2] = ((z * 0.8 + 1) / 2) * CAUCE_FLUID_GRID_SIZE;
    values[offset + 7] = 1 - random() * 0.002;
  }
}

function createMemoryReport(capacity, visualEnabled) {
  const physicalParticles = capacity * PHYSICAL_PARTICLE_STRIDE_FLOATS * 4;
  const visualParticles = visualEnabled ? capacity * VISUAL_PARTICLE_STRIDE_FLOATS * 4 : 0;
  const particles = physicalParticles + visualParticles;
  const gridAtomic = CAUCE_FLUID_GRID_CELLS * 4 * 4;
  const gridFloat = CAUCE_FLUID_GRID_CELLS * 4 * 4;
  const surfaceMass = CAUCE_FLUID_GRID_CELLS * 4;
  const surfaceNormal = CAUCE_FLUID_GRID_CELLS * 4 * 4;
  return {
    particles,
    physicalParticles,
    visualParticles,
    gridAtomic,
    gridFloat,
    surfaceMass,
    surfaceNormal,
    baseTotal: particles + gridAtomic + gridFloat,
    surfaceTotal: surfaceMass + surfaceNormal,
    maximumTotal: particles + gridAtomic + gridFloat + surfaceMass + surfaceNormal
  };
}

export function createCauceFluidEngine({
  THREE,
  TSL,
  renderer,
  capacity = CAUCE_FLUID_MAX_PARTICLES,
  visualMode = "flow",
  resetMode = "legacy-cpu"
}) {
  const normalizedCapacity = getCauceFluidCapacityForCount(capacity);
  const visualEnabled = visualMode !== "none";
  const {
    Fn,
    If,
    Loop,
    Return,
    array,
    atomicAdd,
    atomicLoad,
    atomicStore,
    float,
    floor,
    instanceIndex,
    instancedArray,
    int,
    ivec3,
    mat3,
    max: tslMax,
    mix,
    mx_noise_float,
    pow,
    smoothstep,
    struct,
    uint,
    uniform,
    vec3,
    vec4
  } = TSL;

  const tri = Fn(([value]) => value.fract().sub(0.5).abs())
    .setLayout({ name: "cauceFluidTri", type: "float", inputs: [{ name: "value", type: "float" }] });
  const triVector = Fn(([value]) => value.fract().sub(0.5).abs())
    .setLayout({ name: "cauceFluidTriVector", type: "vec3", inputs: [{ name: "value", type: "vec3" }] });
  const tri3 = Fn(([position]) => vec3(
    tri(position.z.add(tri(position.y))),
    tri(position.z.add(tri(position.x))),
    tri(position.y.add(tri(position.x)))
  )).setLayout({ name: "cauceFluidTri3", type: "vec3", inputs: [{ name: "position", type: "vec3" }] });
  const triNoise3DVector = Fn(([position, speed, timeNode]) => {
    const p = vec3(position).toVar();
    const scale = float(1.4).toVar();
    const result = vec3(0).toVar();
    const basePosition = vec3(p).toVar();
    Loop({ start: 0, end: 4, type: "int", condition: "<" }, () => {
      const derivative = tri3(basePosition.mul(2)).toVar();
      p.addAssign(derivative.add(timeNode.mul(float(0.1).mul(speed))));
      basePosition.mulAssign(1.8);
      scale.mulAssign(1.5);
      p.mulAssign(1.2);
      const triangle = triVector(p.zxy.add(triVector(p.xyz.add(triVector(p.yzx))))).toVar();
      result.addAssign(triangle.div(scale));
      basePosition.addAssign(0.14);
    });
    return result;
  }).setLayout({
    name: "cauceFluidTriNoise3DVector",
    type: "vec3",
    inputs: [
      { name: "position", type: "vec3" },
      { name: "speed", type: "float" },
      { name: "time", type: "float" }
    ]
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
  }).setLayout({ name: "cauceFluidHsvToRgb", type: "vec3", inputs: [{ name: "hsv", type: "vec3" }] });

  const particleLayout = struct({
    position: { type: "vec3" },
    density: { type: "float" },
    velocity: { type: "vec3" },
    mass: { type: "float" },
    C: { type: "mat3" }
  });
  const particleValues = new Float32Array(
    normalizedCapacity * PHYSICAL_PARTICLE_STRIDE_FLOATS
  );
  const visualLayout = struct({
    direction: { type: "vec3" },
    color: { type: "vec3" }
  });
  const visualValues = visualEnabled
    ? new Float32Array(normalizedCapacity * VISUAL_PARTICLE_STRIDE_FLOATS)
    : null;
  fillInitialParticles(particleValues, 1, normalizedCapacity);
  const particleBuffer = instancedArray(particleValues, particleLayout).label("cauceFluidParticles");
  const visualBuffer = visualEnabled
    ? instancedArray(visualValues, visualLayout).label("cauceFluidVisuals")
    : null;

  const cellLayout = struct({
    x: { type: "int", atomic: true },
    y: { type: "int", atomic: true },
    z: { type: "int", atomic: true },
    mass: { type: "int", atomic: true }
  });
  const cellBuffer = instancedArray(CAUCE_FLUID_GRID_CELLS, cellLayout).label("cauceFluidGridAtomic");
  const cellBufferFloat = instancedArray(CAUCE_FLUID_GRID_CELLS, "vec4").label("cauceFluidGridFloat");

  const uniforms = {
    particleCount: uniform(32768, "uint"),
    dt: uniform(0.1),
    simulationTime: uniform(0),
    noise: uniform(1),
    stiffness: uniform(3),
    restDensity: uniform(1),
    dynamicViscosity: uniform(0.1),
    gravityMode: uniform(0, "uint"),
    gravity: uniform(new THREE.Vector3(0, 0, 0.2)),
    mouseRayDirection: uniform(new THREE.Vector3()),
    mouseRayOrigin: uniform(new THREE.Vector3()),
    mouseForce: uniform(new THREE.Vector3()),
    interactionStrength: uniform(1),
    surfaceModel: uniform(0),
    cohesion: uniform(0.35),
    surfaceTension: uniform(0.65),
    size: uniform(1),
    particleShape: uniform(1),
    flowLength: uniform(1),
    colorMode: uniform(0),
    materialMode: uniform(0),
    textureMode: uniform(0),
    textureStrength: uniform(0),
    textureMotion: uniform(1),
    mineralScale: uniform(0.075),
    mineralWarp: uniform(0.65),
    mineralContrast: uniform(1.35),
    mineralVariation: uniform(0.22),
    paletteMix: uniform(1),
    hueSpeed: uniform(0.05),
    foreground: uniform(new THREE.Color("#f4f3ee")),
    background: uniform(new THREE.Color("#11110f")),
    accent: uniform(new THREE.Color("#50d7ff")),
    paletteMiddle: uniform(new THREE.Color("#50d7ff")),
    secondary: uniform(new THREE.Color("#ff4867")),
    paletteStop1: uniform(0.46),
    paletteStop2: uniform(0.74),
    materialMetalness: uniform(0.9),
    materialRoughness: uniform(0.5)
  };
  uniforms.resetSeed = uniform(1, "uint");

  const samplePalette = Fn(([position]) => {
    const value = position.clamp(0, 1);
    const stop1 = uniforms.paletteStop1.clamp(0.0001, 0.9998);
    const stop2 = uniforms.paletteStop2.clamp(stop1.add(0.0001), 0.9999);
    const low = mix(
      uniforms.foreground,
      uniforms.accent,
      value.div(tslMax(stop1, 0.0001)).clamp(0, 1)
    );
    const middle = mix(
      uniforms.accent,
      uniforms.paletteMiddle,
      value.sub(stop1).div(tslMax(stop2.sub(stop1), 0.0001)).clamp(0, 1)
    );
    const high = mix(
      uniforms.paletteMiddle,
      uniforms.secondary,
      value.sub(stop2).div(tslMax(float(1).sub(stop2), 0.0001)).clamp(0, 1)
    );
    return value.lessThan(stop1).select(
      low,
      value.lessThan(stop2).select(middle, high)
    );
  }).setLayout({
    name: "cauceFluidSamplePalette",
    type: "vec3",
    inputs: [{ name: "position", type: "float" }]
  });

  const encodeFixedPoint = (value) => int(value.mul(FIXED_POINT_MULTIPLIER));
  const decodeFixedPoint = (value) => float(value).div(FIXED_POINT_MULTIPLIER);
  const getCellPointer = (cell) => cell.x.mul(CAUCE_FLUID_GRID_SIZE * CAUCE_FLUID_GRID_SIZE)
    .add(cell.y.mul(CAUCE_FLUID_GRID_SIZE))
    .add(cell.z);

  const resetKernel = resetMode === "gpu-v2"
    ? Fn(() => {
      const particleIndex = float(instanceIndex);
      const seed = float(uniforms.resetSeed);
      const hash = (salt) => particleIndex
        .mul(12.9898)
        .add(seed.mul(salt))
        .sin()
        .mul(43758.5453)
        .fract()
        .abs();
      const radial = hash(1.17).pow(1 / 3);
      const z = hash(2.31).mul(2).sub(1);
      const angle = hash(3.73).mul(Math.PI * 2);
      const planar = float(1).sub(z.mul(z)).max(0).sqrt().mul(radial);
      const spherePosition = vec3(
        planar.mul(angle.cos()),
        planar.mul(angle.sin()),
        z.mul(radial)
      );
      const particle = particleBuffer.element(instanceIndex);
      particle.get("position").assign(
        spherePosition.mul(CAUCE_FLUID_GRID_SIZE * 0.4)
          .add(CAUCE_FLUID_GRID_SIZE * 0.5)
      );
      particle.get("density").assign(0);
      particle.get("velocity").assign(vec3(0));
      particle.get("mass").assign(float(1).sub(hash(4.91).mul(0.002)));
      particle.get("C").assign(mat3(0));
      if (visualBuffer) {
        const visual = visualBuffer.element(instanceIndex);
        visual.get("direction").assign(vec3(0, 0, 1));
        visual.get("color").assign(vec3(1));
      }
    })().compute(normalizedCapacity).setName("cauceFluidResetGpuV2")
    : null;

  const clearGridKernel = Fn(() => {
    const cell = cellBuffer.element(instanceIndex);
    atomicStore(cell.get("x"), 0);
    atomicStore(cell.get("y"), 0);
    atomicStore(cell.get("z"), 0);
    atomicStore(cell.get("mass"), 0);
    cellBufferFloat.element(instanceIndex).assign(vec4(0));
  })().compute(CAUCE_FLUID_GRID_CELLS).setName("cauceFluidClearGrid");

  const p2g1Kernel = Fn(() => {
    const particle = particleBuffer.element(instanceIndex);
    const particlePosition = particle.get("position").toConst("particlePosition");
    const particleVelocity = particle.get("velocity").toConst("particleVelocity");
    const cellIndex = ivec3(particlePosition).sub(1).toConst("cellIndex");
    const cellDifference = particlePosition.fract().sub(0.5).toConst("cellDifference");
    const weight0 = float(0.5).mul(float(0.5).sub(cellDifference)).mul(float(0.5).sub(cellDifference));
    const weight1 = float(0.75).sub(cellDifference.mul(cellDifference));
    const weight2 = float(0.5).mul(float(0.5).add(cellDifference)).mul(float(0.5).add(cellDifference));
    const weights = array([weight0, weight1, weight2]).toConst("weights");
    const affineVelocity = particle.get("C").toConst("affineVelocity");
    Loop({ start: 0, end: 3, type: "int", name: "gx", condition: "<" }, ({ gx }) => {
      Loop({ start: 0, end: 3, type: "int", name: "gy", condition: "<" }, ({ gy }) => {
        Loop({ start: 0, end: 3, type: "int", name: "gz", condition: "<" }, ({ gz }) => {
          const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
          const cellPosition = cellIndex.add(ivec3(gx, gy, gz)).toConst();
          const cellDistance = vec3(cellPosition).add(0.5).sub(particlePosition).toConst();
          const affine = affineVelocity.mul(cellDistance);
          const velocityContribution = weight.mul(particleVelocity.add(affine)).toConst();
          const cell = cellBuffer.element(getCellPointer(cellPosition));
          atomicAdd(cell.get("x"), encodeFixedPoint(velocityContribution.x));
          atomicAdd(cell.get("y"), encodeFixedPoint(velocityContribution.y));
          atomicAdd(cell.get("z"), encodeFixedPoint(velocityContribution.z));
          atomicAdd(cell.get("mass"), encodeFixedPoint(weight));
        });
      });
    });
  })().compute(normalizedCapacity).setName("cauceFluidP2G1");

  const p2g2Kernel = Fn(() => {
    const particle = particleBuffer.element(instanceIndex);
    const particlePosition = particle.get("position").toConst("particlePosition");
    const cellIndex = ivec3(particlePosition).sub(1).toConst("cellIndex");
    const cellDifference = particlePosition.fract().sub(0.5).toConst("cellDifference");
    const weight0 = float(0.5).mul(float(0.5).sub(cellDifference)).mul(float(0.5).sub(cellDifference));
    const weight1 = float(0.75).sub(cellDifference.mul(cellDifference));
    const weight2 = float(0.5).mul(float(0.5).add(cellDifference)).mul(float(0.5).add(cellDifference));
    const weights = array([weight0, weight1, weight2]).toConst("weights");
    const density = float(0).toVar("density");
    Loop({ start: 0, end: 3, type: "int", name: "gx", condition: "<" }, ({ gx }) => {
      Loop({ start: 0, end: 3, type: "int", name: "gy", condition: "<" }, ({ gy }) => {
        Loop({ start: 0, end: 3, type: "int", name: "gz", condition: "<" }, ({ gz }) => {
          const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
          const cellPosition = cellIndex.add(ivec3(gx, gy, gz)).toConst();
          const mass = decodeFixedPoint(atomicLoad(cellBuffer.element(getCellPointer(cellPosition)).get("mass")));
          density.addAssign(mass.mul(weight));
        });
      });
    });
    const safeDensity = tslMax(density, 0.00001);
    const densityStore = particle.get("density");
    densityStore.assign(mix(densityStore, safeDensity, 0.05));
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
    const velocityGradient = particle.get("C").toConst("velocityGradient");
    stress.addAssign(velocityGradient.add(velocityGradient.transpose()).mul(uniforms.dynamicViscosity));
    const stressImpulse = volume.mul(-4).mul(stress).mul(uniforms.dt);
    Loop({ start: 0, end: 3, type: "int", name: "gx", condition: "<" }, ({ gx }) => {
      Loop({ start: 0, end: 3, type: "int", name: "gy", condition: "<" }, ({ gy }) => {
        Loop({ start: 0, end: 3, type: "int", name: "gz", condition: "<" }, ({ gz }) => {
          const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
          const cellPosition = cellIndex.add(ivec3(gx, gy, gz)).toConst();
          const cellDistance = vec3(cellPosition).add(0.5).sub(particlePosition).toConst();
          const momentum = stressImpulse.mul(weight).mul(cellDistance).toConst();
          const cell = cellBuffer.element(getCellPointer(cellPosition));
          atomicAdd(cell.get("x"), encodeFixedPoint(momentum.x));
          atomicAdd(cell.get("y"), encodeFixedPoint(momentum.y));
          atomicAdd(cell.get("z"), encodeFixedPoint(momentum.z));
        });
      });
    });
  })().compute(normalizedCapacity).setName("cauceFluidP2G2");

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
    const x = int(instanceIndex).div(CAUCE_FLUID_GRID_SIZE * CAUCE_FLUID_GRID_SIZE);
    const y = int(instanceIndex).div(CAUCE_FLUID_GRID_SIZE).mod(CAUCE_FLUID_GRID_SIZE);
    const z = int(instanceIndex).mod(CAUCE_FLUID_GRID_SIZE);
    If(x.lessThan(2).or(x.greaterThan(CAUCE_FLUID_GRID_SIZE - 2)), () => velocityX.assign(0));
    If(y.lessThan(2).or(y.greaterThan(CAUCE_FLUID_GRID_SIZE - 2)), () => velocityY.assign(0));
    If(z.lessThan(2).or(z.greaterThan(CAUCE_FLUID_GRID_SIZE - 2)), () => velocityZ.assign(0));
    cellBufferFloat.element(instanceIndex).assign(vec4(velocityX, velocityY, velocityZ, mass));
  })().compute(CAUCE_FLUID_GRID_CELLS).setName("cauceFluidUpdateGrid");

  const surfaceMassBuffer = instancedArray(CAUCE_FLUID_GRID_CELLS, "float").label("cauceFluidSurfaceMass");
  const surfaceNormalBuffer = instancedArray(CAUCE_FLUID_GRID_CELLS, "vec4").label("cauceFluidSurfaceNormal");

  const surfaceMassKernel = Fn(() => {
    const x = int(instanceIndex).div(CAUCE_FLUID_GRID_SIZE * CAUCE_FLUID_GRID_SIZE);
    const y = int(instanceIndex).div(CAUCE_FLUID_GRID_SIZE).mod(CAUCE_FLUID_GRID_SIZE);
    const z = int(instanceIndex).mod(CAUCE_FLUID_GRID_SIZE);
    const isBoundary = x.lessThan(1)
      .or(x.greaterThanEqual(CAUCE_FLUID_GRID_SIZE - 1))
      .or(y.lessThan(1))
      .or(y.greaterThanEqual(CAUCE_FLUID_GRID_SIZE - 1))
      .or(z.lessThan(1))
      .or(z.greaterThanEqual(CAUCE_FLUID_GRID_SIZE - 1));
    If(isBoundary, () => {
      surfaceMassBuffer.element(instanceIndex).assign(0);
      Return();
    });
    const massAt = (offsetX, offsetY, offsetZ) => cellBufferFloat
      .element(getCellPointer(ivec3(x.add(offsetX), y.add(offsetY), z.add(offsetZ))))
      .w;
    const smoothedMass = massAt(0, 0, 0).mul(0.4)
      .add(massAt(1, 0, 0).mul(0.1))
      .add(massAt(-1, 0, 0).mul(0.1))
      .add(massAt(0, 1, 0).mul(0.1))
      .add(massAt(0, -1, 0).mul(0.1))
      .add(massAt(0, 0, 1).mul(0.1))
      .add(massAt(0, 0, -1).mul(0.1));
    surfaceMassBuffer.element(instanceIndex).assign(smoothedMass);
  })().compute(CAUCE_FLUID_GRID_CELLS).setName("cauceFluidSurfaceMass");

  const surfaceNormalKernel = Fn(() => {
    const x = int(instanceIndex).div(CAUCE_FLUID_GRID_SIZE * CAUCE_FLUID_GRID_SIZE);
    const y = int(instanceIndex).div(CAUCE_FLUID_GRID_SIZE).mod(CAUCE_FLUID_GRID_SIZE);
    const z = int(instanceIndex).mod(CAUCE_FLUID_GRID_SIZE);
    const isBoundary = x.lessThan(2)
      .or(x.greaterThanEqual(CAUCE_FLUID_GRID_SIZE - 2))
      .or(y.lessThan(2))
      .or(y.greaterThanEqual(CAUCE_FLUID_GRID_SIZE - 2))
      .or(z.lessThan(2))
      .or(z.greaterThanEqual(CAUCE_FLUID_GRID_SIZE - 2));
    If(isBoundary, () => {
      surfaceNormalBuffer.element(instanceIndex).assign(vec4(0));
      Return();
    });
    const massAt = (offsetX, offsetY, offsetZ) => surfaceMassBuffer
      .element(getCellPointer(ivec3(x.add(offsetX), y.add(offsetY), z.add(offsetZ))));
    const inverseRestDensity = float(1).div(tslMax(uniforms.restDensity, 0.0001));
    const gradient = vec3(
      massAt(1, 0, 0).sub(massAt(-1, 0, 0)),
      massAt(0, 1, 0).sub(massAt(0, -1, 0)),
      massAt(0, 0, 1).sub(massAt(0, 0, -1))
    ).mul(0.5).mul(inverseRestDensity).toVar();
    const gradientMagnitude = gradient.length();
    const normal = gradient.div(tslMax(gradientMagnitude, 0.00001));
    surfaceNormalBuffer.element(instanceIndex).assign(vec4(normal, gradientMagnitude));
  })().compute(CAUCE_FLUID_GRID_CELLS).setName("cauceFluidSurfaceNormal");

  const surfaceForceKernel = Fn(() => {
    const x = int(instanceIndex).div(CAUCE_FLUID_GRID_SIZE * CAUCE_FLUID_GRID_SIZE);
    const y = int(instanceIndex).div(CAUCE_FLUID_GRID_SIZE).mod(CAUCE_FLUID_GRID_SIZE);
    const z = int(instanceIndex).mod(CAUCE_FLUID_GRID_SIZE);
    const isBoundary = x.lessThan(3)
      .or(x.greaterThanEqual(CAUCE_FLUID_GRID_SIZE - 3))
      .or(y.lessThan(3))
      .or(y.greaterThanEqual(CAUCE_FLUID_GRID_SIZE - 3))
      .or(z.lessThan(3))
      .or(z.greaterThanEqual(CAUCE_FLUID_GRID_SIZE - 3));
    If(isBoundary, () => Return());
    const normalAt = (offsetX, offsetY, offsetZ) => surfaceNormalBuffer
      .element(getCellPointer(ivec3(x.add(offsetX), y.add(offsetY), z.add(offsetZ))));
    const surface = normalAt(0, 0, 0).toConst();
    const divergence = normalAt(1, 0, 0).x.sub(normalAt(-1, 0, 0).x)
      .add(normalAt(0, 1, 0).y.sub(normalAt(0, -1, 0).y))
      .add(normalAt(0, 0, 1).z.sub(normalAt(0, 0, -1).z))
      .mul(0.5);
    const curvature = divergence.negate().clamp(-1.5, 1.5);
    const normalizedMass = surfaceMassBuffer
      .element(instanceIndex)
      .div(tslMax(uniforms.restDensity, 0.0001));
    const gradientWeight = smoothstep(0.015, 0.18, surface.w);
    const interiorWeight = smoothstep(0.75, 1.35, normalizedMass).oneMinus();
    const surfaceWeight = gradientWeight.mul(interiorWeight).clamp(0, 1);
    const cohesionAcceleration = surface.xyz
      .mul(uniforms.cohesion)
      .mul(surfaceWeight);
    const tensionAcceleration = surface.xyz
      .mul(curvature)
      .mul(uniforms.surfaceTension)
      .mul(surfaceWeight)
      .mul(4);
    const acceleration = cohesionAcceleration
      .add(tensionAcceleration)
      .clamp(vec3(-2), vec3(2));
    const gridCell = cellBufferFloat.element(instanceIndex);
    gridCell.assign(vec4(gridCell.xyz.add(acceleration.mul(uniforms.dt)), gridCell.w));
  })().compute(CAUCE_FLUID_GRID_CELLS).setName("cauceFluidSurfaceForce");

  const g2pKernel = Fn(() => {
    const particle = particleBuffer.element(instanceIndex);
    const particleMass = particle.get("mass").toConst("particleMass");
    const particlePosition = particle.get("position").toVar("particlePosition");
    const particleVelocity = vec3(0).toVar("particleVelocity");
    If(uniforms.gravityMode.equal(uint(2)), () => {
      const radialNormal = particlePosition
        .div(CAUCE_FLUID_GRID_SIZE - 1)
        .sub(0.5)
        .normalize()
        .toConst();
      particleVelocity.subAssign(radialNormal.mul(0.3).mul(uniforms.dt));
    }).Else(() => {
      particleVelocity.addAssign(uniforms.gravity.mul(uniforms.dt));
    });

    const noise = triNoise3DVector(
      particlePosition.mul(0.015),
      uniforms.simulationTime,
      float(0.11)
    ).sub(0.285).normalize().mul(0.28).toVar();
    particleVelocity.subAssign(noise.mul(uniforms.noise).mul(uniforms.dt));

    const cellIndex = ivec3(particlePosition).sub(1).toConst("cellIndex");
    const cellDifference = particlePosition.fract().sub(0.5).toConst("cellDifference");
    const weight0 = float(0.5).mul(float(0.5).sub(cellDifference)).mul(float(0.5).sub(cellDifference));
    const weight1 = float(0.75).sub(cellDifference.mul(cellDifference));
    const weight2 = float(0.5).mul(float(0.5).add(cellDifference)).mul(float(0.5).add(cellDifference));
    const weights = array([weight0, weight1, weight2]).toConst("weights");
    const affine = mat3(0).toVar("affine");
    Loop({ start: 0, end: 3, type: "int", name: "gx", condition: "<" }, ({ gx }) => {
      Loop({ start: 0, end: 3, type: "int", name: "gy", condition: "<" }, ({ gy }) => {
        Loop({ start: 0, end: 3, type: "int", name: "gz", condition: "<" }, ({ gz }) => {
          const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
          const cellPosition = cellIndex.add(ivec3(gx, gy, gz)).toConst();
          const cellDistance = vec3(cellPosition).add(0.5).sub(particlePosition).toConst();
          const weightedVelocity = cellBufferFloat
            .element(getCellPointer(cellPosition))
            .xyz
            .mul(weight)
            .toConst();
          affine.addAssign(mat3(
            weightedVelocity.mul(cellDistance.x),
            weightedVelocity.mul(cellDistance.y),
            weightedVelocity.mul(cellDistance.z)
          ));
          particleVelocity.addAssign(weightedVelocity);
        });
      });
    });

    const pointerDistance = uniforms.mouseRayDirection
      .cross(particlePosition.mul(vec3(1, 1, 0.4)).sub(uniforms.mouseRayOrigin))
      .length();
    const pointerForce = pointerDistance.mul(0.1).oneMinus().max(0).pow(2);
    particleVelocity.addAssign(
      uniforms.mouseForce.mul(uniforms.interactionStrength).mul(pointerForce)
    );
    particleVelocity.mulAssign(particleMass);
    particle.get("C").assign(affine.mul(4));
    particlePosition.addAssign(particleVelocity.mul(uniforms.dt));
    particlePosition.assign(particlePosition.clamp(vec3(2), vec3(CAUCE_FLUID_GRID_SIZE - 2)));

    const futurePosition = particlePosition.add(particleVelocity.mul(uniforms.dt).mul(3)).toConst();
    const wallMinimum = vec3(3).toConst();
    const wallMaximum = vec3(CAUCE_FLUID_GRID_SIZE - 3).toConst();
    If(futurePosition.x.lessThan(wallMinimum.x), () => {
      particleVelocity.x.addAssign(wallMinimum.x.sub(futurePosition.x).mul(0.3));
    });
    If(futurePosition.x.greaterThan(wallMaximum.x), () => {
      particleVelocity.x.addAssign(wallMaximum.x.sub(futurePosition.x).mul(0.3));
    });
    If(futurePosition.y.lessThan(wallMinimum.y), () => {
      particleVelocity.y.addAssign(wallMinimum.y.sub(futurePosition.y).mul(0.3));
    });
    If(futurePosition.y.greaterThan(wallMaximum.y), () => {
      particleVelocity.y.addAssign(wallMaximum.y.sub(futurePosition.y).mul(0.3));
    });
    If(futurePosition.z.lessThan(wallMinimum.z), () => {
      particleVelocity.z.addAssign(wallMinimum.z.sub(futurePosition.z).mul(0.3));
    });
    If(futurePosition.z.greaterThan(wallMaximum.z), () => {
      particleVelocity.z.addAssign(wallMaximum.z.sub(futurePosition.z).mul(0.3));
    });

    particle.get("position").assign(particlePosition);
    particle.get("velocity").assign(particleVelocity);
    if (visualBuffer) {
      const visual = visualBuffer.element(instanceIndex);
      const direction = visual.get("direction");
      direction.assign(mix(direction, particleVelocity, 0.1));
    }

    // Compatibility appearance extension. This remains fused with G2P in 0.2
    // so Flow Cauce keeps the same five-pass base graph and visual evolution.
    const densityRatio = particle.get("density").div(uniforms.restDensity);
    const originalColor = hsvToRgb(vec3(
      densityRatio.mul(0.25).add(uniforms.simulationTime.mul(uniforms.hueSpeed)),
      particleVelocity.length().mul(0.5).clamp(0, 1).mul(0.3).add(0.7),
      pointerForce.mul(0.3).add(0.7)
    ));
    const palettePosition = densityRatio.mul(0.34).clamp(0, 1);
    const paletteColor = samplePalette(
      palettePosition.add(particleVelocity.length().mul(0.08)).clamp(0, 1)
    );
    const selectedColor = uniforms.colorMode.lessThan(0.5).select(
      originalColor,
      mix(originalColor, paletteColor, uniforms.paletteMix)
    );

    const mineralPosition = particlePosition.mul(uniforms.mineralScale).toVar();
    const mineralWarp = mx_noise_float(
      mineralPosition.mul(0.55).add(vec3(11, 29, 47)),
      1,
      0
    );
    mineralPosition.addAssign(mineralWarp.mul(uniforms.mineralWarp));
    const mineralMacro = mx_noise_float(mineralPosition, 1, 0).mul(0.5).add(0.5);
    const mineralDetail = mx_noise_float(
      mineralPosition.mul(2.7).add(vec3(19, 53, 7)),
      1,
      0
    ).mul(0.5).add(0.5);
    const mineralHeight = particlePosition.y.div(CAUCE_FLUID_GRID_SIZE).clamp(0, 1);
    const mineralSignal = mineralMacro
      .mul(0.62)
      .add(mineralDetail.mul(0.25))
      .add(mineralHeight.mul(0.13))
      .sub(0.5)
      .mul(uniforms.mineralContrast)
      .add(0.5)
      .clamp(0, 1);
    const flowMovement = uniforms.simulationTime.mul(uniforms.textureMotion).mul(0.08);
    const flowSignal = mx_noise_float(
      mineralPosition.add(vec3(flowMovement, flowMovement.mul(0.37), flowMovement.mul(-0.61))),
      1,
      0
    ).mul(0.5).add(0.5).clamp(0, 1);
    const grainSignal = mineralDetail
      .mul(0.72)
      .add(mx_noise_float(mineralPosition.mul(7.3), 1, 0).mul(0.14))
      .add(0.14)
      .clamp(0, 1);
    const proceduralSignal = uniforms.textureMode.lessThan(1.5).select(
      flowSignal,
      uniforms.textureMode.lessThan(2.5).select(grainSignal, mineralSignal)
    );
    const mineralDark = mix(uniforms.background, uniforms.foreground, 0.28);
    const mineralLow = mix(
      mineralDark,
      uniforms.foreground,
      smoothstep(0.12, 0.46, proceduralSignal)
    );
    const mineralHigh = samplePalette(smoothstep(0.25, 0.95, proceduralSignal));
    const mineralColor = mix(
      mineralLow,
      mineralHigh,
      smoothstep(0.42, 0.76, proceduralSignal)
    );
    const texturedColor = mix(
      selectedColor,
      mineralColor,
      uniforms.paletteMix.mul(uniforms.textureStrength)
    );
    if (visualBuffer) {
      visualBuffer.element(instanceIndex).get("color").assign(
        uniforms.materialMode.lessThan(0.5).select(selectedColor, texturedColor)
      );
    }
  })().compute(normalizedCapacity).setName("cauceFluidG2P");

  const memory = createMemoryReport(normalizedCapacity, visualEnabled);
  let currentSeed = null;
  let lastElapsedTime = null;
  let accumulator = 0;
  let simulationTime = 0;
  let activeParticleCount = 32768;
  let totalSteps = 0;
  let totalResets = 0;
  let droppedCatchUpFrames = 0;
  let lastSubmissionCpuMs = 0;
  let averageSubmissionCpuMs = 0;
  let lastDispatchCount = BASE_PASS_COUNT;
  let lastAdvanceSteps = 0;
  let resetCount = 0;
  let lastResetCpuMs = 0;
  let lastResetUploadBytes = 0;

  function setParticleCount(particleCount) {
    const normalized = Math.max(1, Math.min(normalizedCapacity, Math.round(particleCount)));
    activeParticleCount = normalized;
    uniforms.particleCount.value = normalized;
    p2g1Kernel.count = normalized;
    p2g2Kernel.count = normalized;
    g2pKernel.count = normalized;
  }

  function reset(seed, elapsedTime = 0) {
    const resetStart = performance.now();
    if (resetKernel) {
      uniforms.resetSeed.value = seed >>> 0;
      renderer.compute(resetKernel);
      lastResetUploadBytes = 0;
    } else {
      fillInitialParticles(particleValues, seed, normalizedCapacity);
      particleBuffer.value.needsUpdate = true;
      if (visualBuffer) visualBuffer.value.needsUpdate = true;
      lastResetUploadBytes = particleValues.byteLength + (visualValues?.byteLength ?? 0);
    }
    resetCount += 1;
    lastResetCpuMs = performance.now() - resetStart;
    currentSeed = seed;
    simulationTime = elapsedTime;
    uniforms.simulationTime.value = simulationTime;
    lastElapsedTime = elapsedTime;
    accumulator = 0;
    totalResets += 1;
  }

  function simulateFixedFrame(speed, beforeStep) {
    beforeStep?.();
    uniforms.dt.value = FIXED_FRAME_SECONDS * 6 * speed;
    simulationTime += FIXED_FRAME_SECONDS;
    uniforms.simulationTime.value = simulationTime;
    const submissionStart = performance.now();
    renderer.compute(clearGridKernel);
    renderer.compute(p2g1Kernel);
    renderer.compute(p2g2Kernel);
    renderer.compute(updateGridKernel);
    const surfaceEnabled = uniforms.surfaceModel.value >= 0.5 && (
      uniforms.cohesion.value > 0 || uniforms.surfaceTension.value > 0
    );
    if (surfaceEnabled) {
      renderer.compute(surfaceMassKernel);
      renderer.compute(surfaceNormalKernel);
      renderer.compute(surfaceForceKernel);
    }
    renderer.compute(g2pKernel);
    lastSubmissionCpuMs = performance.now() - submissionStart;
    averageSubmissionCpuMs = totalSteps === 0
      ? lastSubmissionCpuMs
      : averageSubmissionCpuMs * 0.9 + lastSubmissionCpuMs * 0.1;
    lastDispatchCount = BASE_PASS_COUNT + (surfaceEnabled ? SURFACE_PASS_COUNT : 0);
    totalSteps += 1;
  }

  function advance({ seed, elapsedTime, speed = 1, beforeStep, onReset }) {
    if (currentSeed !== seed || lastElapsedTime === null) {
      reset(seed, elapsedTime);
      onReset?.();
      simulateFixedFrame(speed, beforeStep);
      lastAdvanceSteps = 1;
      return;
    }
    const delta = elapsedTime - lastElapsedTime;
    lastElapsedTime = elapsedTime;
    if (delta < -0.000001 || delta > 0.5) {
      reset(seed, elapsedTime);
      onReset?.();
      simulateFixedFrame(speed, beforeStep);
      lastAdvanceSteps = 1;
      return;
    }
    accumulator += Math.max(0, delta);
    let fixedSteps = 0;
    while (accumulator + 1e-7 >= FIXED_FRAME_SECONDS && fixedSteps < MAX_CATCH_UP_STEPS) {
      simulateFixedFrame(speed, beforeStep);
      accumulator -= FIXED_FRAME_SECONDS;
      fixedSteps += 1;
    }
    if (fixedSteps === MAX_CATCH_UP_STEPS) {
      if (accumulator >= FIXED_FRAME_SECONDS) droppedCatchUpFrames += 1;
      accumulator = Math.min(accumulator, FIXED_FRAME_SECONDS);
    }
    lastAdvanceSteps = fixedSteps;
  }

  function getDiagnostics() {
    return {
      version: "0.2",
      gridSize: CAUCE_FLUID_GRID_SIZE,
      gridCells: CAUCE_FLUID_GRID_CELLS,
      capacity: normalizedCapacity,
      capacityProfile: normalizedCapacity,
      resetMode,
      visualMode: visualEnabled ? visualMode : "none",
      activeParticleCount,
      basePassCount: BASE_PASS_COUNT,
      surfacePassCount: SURFACE_PASS_COUNT,
      lastDispatchCount,
      lastAdvanceSteps,
      totalSteps,
      totalResets,
      resetCount,
      lastResetCpuMs,
      lastResetUploadBytes,
      droppedCatchUpFrames,
      lastSubmissionCpuMs,
      averageSubmissionCpuMs,
      memory: { ...memory }
    };
  }

  function dispose() {
    clearGridKernel.dispose();
    p2g1Kernel.dispose();
    p2g2Kernel.dispose();
    updateGridKernel.dispose();
    surfaceMassKernel.dispose();
    surfaceNormalKernel.dispose();
    surfaceForceKernel.dispose();
    g2pKernel.dispose();
    resetKernel?.dispose();
  }

  return {
    particleBuffer,
    visualBuffer,
    uniforms,
    setParticleCount,
    advance,
    reset,
    getDiagnostics,
    dispose
  };
}
