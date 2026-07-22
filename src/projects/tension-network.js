import { clamp, createRandom, parameter, positiveModulo } from "./shared.js";
import { compositionMetrics } from "./composition.js";

const PROJECT_ID = "tension-network";
const MAX_PATHS = 1200;
const MAX_SEGMENTS = 40;

function mixNumber(from, to, amount) {
  return from + (to - from) * amount;
}

function cubicBezier(a, b, c, d, time) {
  const inverse = 1 - time;
  return inverse * inverse * inverse * a +
    3 * inverse * inverse * time * b +
    3 * inverse * time * time * c +
    time * time * time * d;
}

function cubicBezierDerivative(a, b, c, d, time) {
  const inverse = 1 - time;
  return 3 * inverse * inverse * (b - a) +
    6 * inverse * time * (c - b) +
    3 * time * time * (d - c);
}

function smoothstep01(value) {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function ellipsoidRadiusAtHeight(normalizedHeight) {
  return Math.sqrt(Math.max(0.015, 1 - normalizedHeight * normalizedHeight));
}

function perceptualDepth(aperture, depth) {
  return aperture * 1.55 * (1 - Math.exp(-2.2 * Math.max(0, depth)));
}

function createNetworkGeometry(THREE) {
  const vertexCount = MAX_PATHS * MAX_SEGMENTS * 2;
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
  const colors = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  colors.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  geometry.setAttribute("color", colors);
  geometry.setDrawRange(0, 0);
  return geometry;
}

function createTerminalGeometry(THREE) {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(MAX_PATHS * 2 * 3), 3);
  const colors = new THREE.BufferAttribute(new Float32Array(MAX_PATHS * 2 * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  colors.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  geometry.setAttribute("color", colors);
  geometry.setDrawRange(0, 0);
  return geometry;
}

function createVectorHeadGeometry(THREE) {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(MAX_PATHS * 3), 3);
  const tangents = new THREE.BufferAttribute(new Float32Array(MAX_PATHS * 3), 3);
  const colors = new THREE.BufferAttribute(new Float32Array(MAX_PATHS * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  tangents.setUsage(THREE.DynamicDrawUsage);
  colors.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  geometry.setAttribute("aTangent", tangents);
  geometry.setAttribute("color", colors);
  geometry.setDrawRange(0, 0);
  return geometry;
}

function writePathSeeds(target, seed) {
  const random = createRandom(seed);
  for (let index = 0; index < MAX_PATHS; index += 1) {
    const offset = index * 8;
    target[offset] = random();
    target[offset + 1] = random();
    target[offset + 2] = random();
    target[offset + 3] = random();
    target[offset + 4] = random();
    target[offset + 5] = random();
    target[offset + 6] = random();
    target[offset + 7] = random();
  }
}

function setColor(target, offset, color, luminance) {
  target[offset] = color.r * luminance;
  target[offset + 1] = color.g * luminance;
  target[offset + 2] = color.b * luminance;
}

const terminalVertexShader = /* glsl */ `
  attribute vec3 color;

  uniform float uPixelRatio;
  uniform float uSize;

  varying vec3 vColor;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(uSize * uPixelRatio * (7.0 / max(1.0, -viewPosition.z)), 1.0, 18.0);
    vColor = color;
  }
`;

const terminalFragmentShader = /* glsl */ `
  uniform float uOpacity;

  varying vec3 vColor;

  void main() {
    vec2 point = gl_PointCoord * 2.0 - 1.0;
    float distanceFromCenter = length(point);
    float mask = 1.0 - smoothstep(0.62, 1.0, distanceFromCenter);
    if (mask < 0.01) discard;
    gl_FragColor = vec4(vColor, mask * uOpacity);
    #include <colorspace_fragment>
  }
`;

const vectorHeadVertexShader = /* glsl */ `
  attribute vec3 aTangent;
  attribute vec3 color;

  uniform float uPixelRatio;
  uniform float uSize;

  varying float vAngle;
  varying vec3 vColor;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vec4 clipPosition = projectionMatrix * viewPosition;
    vec3 safeTangent = length(aTangent) > 0.00001
      ? normalize(aTangent)
      : vec3(1.0, 0.0, 0.0);
    vec4 nextViewPosition = modelViewMatrix * vec4(position + safeTangent * 0.08, 1.0);
    vec4 nextClipPosition = projectionMatrix * nextViewPosition;
    vec2 screenPosition = clipPosition.xy / max(0.0001, clipPosition.w);
    vec2 nextScreenPosition = nextClipPosition.xy / max(0.0001, nextClipPosition.w);
    vec2 screenDirection = nextScreenPosition - screenPosition;
    vAngle = atan(screenDirection.y, screenDirection.x);
    vColor = color;
    gl_Position = clipPosition;
    gl_PointSize = clamp(uSize * uPixelRatio * (7.0 / max(1.0, -viewPosition.z)), 3.0, 30.0);
  }
`;

const vectorHeadFragmentShader = /* glsl */ `
  uniform float uOpacity;

  varying float vAngle;
  varying vec3 vColor;

  void main() {
    vec2 point = gl_PointCoord * 2.0 - 1.0;
    float cosine = cos(-vAngle);
    float sine = sin(-vAngle);
    vec2 rotated = mat2(cosine, -sine, sine, cosine) * point;
    float shaftX = max(-0.76 - rotated.x, rotated.x - 0.22);
    float shaftDistance = max(shaftX, abs(rotated.y) - 0.12);
    float shaft = 1.0 - smoothstep(0.0, 0.1, shaftDistance);
    float headWidth = max(0.0, (0.88 - rotated.x) * 0.62);
    float headX = max(0.14 - rotated.x, rotated.x - 0.88);
    float headDistance = max(headX, abs(rotated.y) - headWidth);
    float arrowHead = 1.0 - smoothstep(0.0, 0.1, headDistance);
    float mask = max(shaft, arrowHead);
    if (mask < 0.01) discard;
    gl_FragColor = vec4(vColor, mask * uOpacity);
    #include <colorspace_fragment>
  }
`;

async function createTensionNetworkRenderer(canvas) {
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
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const group = new THREE.Group();
  scene.add(group);

  const networkGeometry = createNetworkGeometry(THREE);
  const networkMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0.26,
    blending: THREE.NormalBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false
  });
  const network = new THREE.LineSegments(networkGeometry, networkMaterial);
  network.frustumCulled = false;
  group.add(network);

  const terminalGeometry = createTerminalGeometry(THREE);
  const terminalMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0.92 },
      uPixelRatio: { value: 1 },
      uSize: { value: 3.2 }
    },
    vertexShader: terminalVertexShader,
    fragmentShader: terminalFragmentShader,
    vertexColors: true,
    transparent: true,
    blending: THREE.NormalBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false
  });
  const terminals = new THREE.Points(terminalGeometry, terminalMaterial);
  terminals.frustumCulled = false;
  terminals.renderOrder = 1;
  group.add(terminals);

  const vectorHeadGeometry = createVectorHeadGeometry(THREE);
  const vectorHeadMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0.96 },
      uPixelRatio: { value: 1 },
      uSize: { value: 10 }
    },
    vertexShader: vectorHeadVertexShader,
    fragmentShader: vectorHeadFragmentShader,
    vertexColors: true,
    transparent: true,
    blending: THREE.NormalBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false
  });
  const vectorHeads = new THREE.Points(vectorHeadGeometry, vectorHeadMaterial);
  vectorHeads.frustumCulled = false;
  vectorHeads.renderOrder = 2;
  group.add(vectorHeads);

  const pathSeeds = new Float32Array(MAX_PATHS * 8);
  const referenceColors = [
    new THREE.Color("#e43b97"),
    new THREE.Color("#32d9eb"),
    new THREE.Color("#6e8fe8"),
    new THREE.Color("#b65fb9")
  ];
  const mixedColors = referenceColors.map(() => new THREE.Color());
  const terminalColor = new THREE.Color();
  const paletteAccentColor = new THREE.Color();
  const paletteSecondaryColor = new THREE.Color();
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
    terminalMaterial.uniforms.uPixelRatio.value = nextViewport.pixelRatio;
    vectorHeadMaterial.uniforms.uPixelRatio.value = nextViewport.pixelRatio;
    camera.aspect = Math.max(0.0001, nextViewport.contentWidth / nextViewport.contentHeight);
    camera.updateProjectionMatrix();
  }

  function updateGeometry(frame) {
    const pathCount = clamp(Math.round(parameter(frame, "paths", 760)), 40, MAX_PATHS);
    const segmentCount = clamp(Math.round(parameter(frame, "segments", 30)), 8, MAX_SEGMENTS);
    const aperture = parameter(frame, "aperture", 2);
    const height = parameter(frame, "height", 6.4);
    const core = parameter(frame, "waist", 0.3);
    const tension = parameter(frame, "tension", 0.86);
    const curvature = parameter(frame, "curvature", 1);
    const depth = parameter(frame, "depth", 0.28);
    const depthRadius = perceptualDepth(aperture, depth);
    const water = parameter(frame, "water", 0.1);
    const speed = parameter(frame, "flowSpeed", 0.35);
    const motionMode = Math.round(parameter(frame, "motionMode", 1));
    const travelSpeed = parameter(frame, "travelSpeed", 0.1);
    const speedVariation = parameter(frame, "speedVariation", 0.48);
    const trailMemory = parameter(frame, "trailMemory", 1);
    const arrivalHold = parameter(frame, "arrivalHold", 0.18);
    const paletteMix = parameter(frame, "paletteMix", 0);
    const pathOpacity = parameter(frame, "pathOpacity", 0.26);
    const terminalCount = clamp(Math.round(parameter(frame, "terminals", 1520)), 0, pathCount * 2);
    const terminalSize = parameter(frame, "terminalSize", 4.2);
    const vectorHeadSize = parameter(frame, "vectorHeadSize", 10);
    const time = frame.elapsedTime * speed;
    const halfHeight = height * 0.5;
    const positions = networkGeometry.getAttribute("position").array;
    const colors = networkGeometry.getAttribute("color").array;
    const terminalPositions = terminalGeometry.getAttribute("position").array;
    const terminalColors = terminalGeometry.getAttribute("color").array;
    const vectorHeadPositions = vectorHeadGeometry.getAttribute("position").array;
    const vectorHeadTangents = vectorHeadGeometry.getAttribute("aTangent").array;
    const vectorHeadColors = vectorHeadGeometry.getAttribute("color").array;
    paletteAccentColor.set(frame.palette.accent);
    paletteSecondaryColor.set(frame.palette.secondary ?? frame.palette.accent);
    const paletteTargets = [
      paletteAccentColor,
      paletteSecondaryColor,
      paletteSecondaryColor,
      paletteAccentColor
    ];
    for (let index = 0; index < mixedColors.length; index += 1) {
      mixedColors[index].copy(referenceColors[index]).lerp(paletteTargets[index], paletteMix);
    }
    terminalColor.copy(referenceColors[1]).lerp(paletteSecondaryColor, paletteMix);
    networkMaterial.opacity = pathOpacity;
    terminalMaterial.uniforms.uOpacity.value = Math.min(1, pathOpacity + 0.56);
    terminalMaterial.uniforms.uSize.value = terminalSize;
    vectorHeadMaterial.uniforms.uOpacity.value = Math.min(1, pathOpacity + 0.7);
    vectorHeadMaterial.uniforms.uSize.value = vectorHeadSize;

    let positionOffset = 0;
    let terminalOffset = 0;
    let vectorHeadOffset = 0;
    const terminalStride = terminalCount === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(1, Math.floor(pathCount * 2 / terminalCount));
    let terminalCursor = 0;

    for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
      const seedOffset = pathIndex * 8;
      const startPhase = pathSeeds[seedOffset + 1] * Math.PI * 2;
      const endPhase = startPhase + Math.PI * (0.62 + pathSeeds[seedOffset + 4] * 0.76);
      const phase = pathSeeds[seedOffset + 3] * Math.PI * 2;
      const bendSign = pathSeeds[seedOffset + 4] * 2 - 1;
      const depthSeed = pathSeeds[seedOffset + 5] * 2 - 1;
      const colorSeed = pathSeeds[seedOffset + 6];
      const driftSeed = pathSeeds[seedOffset + 7] * 2 - 1;
      const startDrift = time * (0.012 + colorSeed * 0.012) * driftSeed;
      const endDrift = time * (0.01 + pathSeeds[seedOffset + 2] * 0.012) * -driftSeed;
      const thetaStart = startPhase + startDrift;
      const thetaEnd = endPhase + endDrift;
      const startHeight = pathSeeds[seedOffset] * 2 - 1;
      const endHeight = clamp(
        -startHeight * (0.34 + pathSeeds[seedOffset + 6] * 0.42) +
          (pathSeeds[seedOffset + 2] * 2 - 1) * 0.72,
        -1,
        1
      );
      const startSurfaceRadius = ellipsoidRadiusAtHeight(startHeight);
      const endSurfaceRadius = ellipsoidRadiusAtHeight(endHeight);
      const startRadius = 0.88 + pathSeeds[seedOffset + 2] * 0.18;
      const endRadius = 0.88 + pathSeeds[seedOffset + 4] * 0.18;
      const startContour = 0.9 + 0.1 * Math.cos(thetaStart * 4 + phase);
      const endContour = 0.9 + 0.1 * Math.cos(thetaEnd * 4 + phase);
      const startX = Math.cos(thetaStart) * aperture * startSurfaceRadius * startRadius * startContour;
      const yStart = startHeight * halfHeight * startRadius;
      const startZ = Math.sin(thetaStart) * depthRadius * startSurfaceRadius * startRadius;
      const endX = Math.cos(thetaEnd) * aperture * endSurfaceRadius * endRadius * endContour;
      const yEnd = endHeight * halfHeight * endRadius;
      const endZ = Math.sin(thetaEnd) * depthRadius * endSurfaceRadius * endRadius;
      const attractorPhase = phase + time * (0.12 + colorSeed * 0.08);
      const coreRadiusX = curvature * (0.18 + core * 0.54);
      const coreRadiusY = curvature * (0.08 + core * 0.3);
      const coreRadiusZ = depthRadius * (0.12 + core * 0.42) * curvature;
      const centerStartX = Math.cos(attractorPhase) * coreRadiusX + bendSign * core * 0.12;
      const centerStartY = Math.sin(attractorPhase * 1.35) * coreRadiusY + driftSeed * core * 0.22;
      const centerEndX = Math.cos(attractorPhase + Math.PI * (0.72 + colorSeed * 0.34)) * coreRadiusX;
      const centerEndY = Math.sin(attractorPhase * 1.35 + Math.PI * 0.8) * coreRadiusY - driftSeed * core * 0.22;
      const centerStartZ = Math.sin(attractorPhase + phase) * coreRadiusZ + depthSeed * coreRadiusZ * 0.28;
      const centerEndZ = Math.cos(attractorPhase - phase) * coreRadiusZ - depthSeed * coreRadiusZ * 0.28;
      const controlStartX = mixNumber(startX, centerStartX, tension);
      const controlStartY = mixNumber(yStart, centerStartY, tension);
      const controlStartZ = mixNumber(startZ, centerStartZ, tension);
      const controlEndX = mixNumber(endX, centerEndX, tension);
      const controlEndY = mixNumber(yEnd, centerEndY, tension);
      const controlEndZ = mixNumber(endZ, centerEndZ, tension);
      const pathColor = mixedColors[Math.min(mixedColors.length - 1, Math.floor(colorSeed * mixedColors.length))];
      const lineLight = 0.56 + pathSeeds[seedOffset + 5] * 0.44;
      const waveFrequency = 2 + pathSeeds[seedOffset + 4] * 3;
      let headProgress = 1;
      let tailProgress = 0;
      let showVectorHead = false;

      if (motionMode === 1) {
        const individualSpeed = 1 - speedVariation + pathSeeds[seedOffset + 2] * speedVariation * 2;
        const cyclePosition = positiveModulo(
          frame.elapsedTime * travelSpeed * Math.max(0.08, individualSpeed) + pathSeeds[seedOffset + 1],
          1
        );
        const fadeShare = 0.14;
        const holdShare = clamp(arrivalHold, 0, 0.6);
        const growthShare = Math.max(0.2, 1 - holdShare - fadeShare);

        if (cyclePosition < growthShare) {
          headProgress = smoothstep01(cyclePosition / growthShare);
          tailProgress = Math.max(0, headProgress - trailMemory);
          showVectorHead = headProgress > 0.008;
        } else if (cyclePosition < growthShare + holdShare) {
          headProgress = 1;
          tailProgress = Math.max(0, 1 - trailMemory);
          showVectorHead = true;
        } else {
          const fadeProgress = smoothstep01(
            (cyclePosition - growthShare - holdShare) / fadeShare
          );
          headProgress = 1;
          tailProgress = mixNumber(Math.max(0, 1 - trailMemory), 1, fadeProgress);
          showVectorHead = fadeProgress < 0.82;
        }
      }

      for (let segment = 0; segment < segmentCount; segment += 1) {
        const segmentStart = segment / segmentCount;
        const segmentEnd = (segment + 1) / segmentCount;
        if (segmentEnd <= tailProgress || segmentStart >= headProgress) continue;
        const t0 = Math.max(segmentStart, tailProgress);
        const t1 = Math.min(segmentEnd, headProgress);
        if (t1 - t0 < 0.0001) continue;
        const wave0 = Math.sin(t0 * Math.PI * waveFrequency + time * 0.9 + phase) *
          water * Math.sin(t0 * Math.PI);
        const wave1 = Math.sin(t1 * Math.PI * waveFrequency + time * 0.9 + phase) *
          water * Math.sin(t1 * Math.PI);
        const x0 = cubicBezier(startX, controlStartX, controlEndX, endX, t0) + wave0 * bendSign;
        const y0 = cubicBezier(yStart, controlStartY, controlEndY, yEnd, t0) + wave0 * 0.42;
        const z0 = cubicBezier(startZ, controlStartZ, controlEndZ, endZ, t0) + wave0 * depthRadius * 0.32;
        const x1 = cubicBezier(startX, controlStartX, controlEndX, endX, t1) + wave1 * bendSign;
        const y1 = cubicBezier(yStart, controlStartY, controlEndY, yEnd, t1) + wave1 * 0.42;
        const z1 = cubicBezier(startZ, controlStartZ, controlEndZ, endZ, t1) + wave1 * depthRadius * 0.32;
        const depthLight0 = depthRadius > 0.0001
          ? mixNumber(0.52, 1.18, clamp(z0 / (depthRadius * 1.2) * 0.5 + 0.5, 0, 1))
          : 1;
        const depthLight1 = depthRadius > 0.0001
          ? mixNumber(0.52, 1.18, clamp(z1 / (depthRadius * 1.2) * 0.5 + 0.5, 0, 1))
          : 1;
        const vertexOffset = positionOffset * 3;

        positions[vertexOffset] = x0;
        positions[vertexOffset + 1] = y0;
        positions[vertexOffset + 2] = z0;
        setColor(colors, vertexOffset, pathColor, lineLight * depthLight0);
        positions[vertexOffset + 3] = x1;
        positions[vertexOffset + 4] = y1;
        positions[vertexOffset + 5] = z1;
        setColor(colors, vertexOffset + 3, pathColor, lineLight * depthLight1);
        positionOffset += 2;
      }

      if (showVectorHead && vectorHeadOffset < pathCount) {
        const headWavePhase = headProgress * Math.PI * waveFrequency + time * 0.9 + phase;
        const headWave = Math.sin(headWavePhase) * water * Math.sin(headProgress * Math.PI);
        const headWaveDerivative = water * Math.PI * (
          waveFrequency * Math.cos(headWavePhase) * Math.sin(headProgress * Math.PI) +
          Math.sin(headWavePhase) * Math.cos(headProgress * Math.PI)
        );
        const offset = vectorHeadOffset * 3;
        vectorHeadPositions[offset] = cubicBezier(
          startX,
          controlStartX,
          controlEndX,
          endX,
          headProgress
        ) + headWave * bendSign;
        vectorHeadPositions[offset + 1] = cubicBezier(
          yStart,
          controlStartY,
          controlEndY,
          yEnd,
          headProgress
        ) + headWave * 0.42;
        vectorHeadPositions[offset + 2] = cubicBezier(
          startZ,
          controlStartZ,
          controlEndZ,
          endZ,
          headProgress
        ) + headWave * depthRadius * 0.32;
        vectorHeadTangents[offset] = cubicBezierDerivative(
          startX,
          controlStartX,
          controlEndX,
          endX,
          headProgress
        ) + headWaveDerivative * bendSign;
        vectorHeadTangents[offset + 1] = cubicBezierDerivative(
          yStart,
          controlStartY,
          controlEndY,
          yEnd,
          headProgress
        ) + headWaveDerivative * 0.42;
        vectorHeadTangents[offset + 2] = cubicBezierDerivative(
          startZ,
          controlStartZ,
          controlEndZ,
          endZ,
          headProgress
        ) + headWaveDerivative * depthRadius * 0.32;
        const headDepthLight = depthRadius > 0.0001
          ? mixNumber(
              0.58,
              1.2,
              clamp(vectorHeadPositions[offset + 2] / (depthRadius * 1.2) * 0.5 + 0.5, 0, 1)
            )
          : 1;
        setColor(
          vectorHeadColors,
          offset,
          pathColor,
          Math.min(1.25, (lineLight + 0.18) * headDepthLight)
        );
        vectorHeadOffset += 1;
      }

      if (terminalCursor % terminalStride === 0 && terminalOffset < terminalCount) {
        const offset = terminalOffset * 3;
        terminalPositions[offset] = startX;
        terminalPositions[offset + 1] = yStart;
        terminalPositions[offset + 2] = startZ;
        const startDepthLight = depthRadius > 0.0001
          ? mixNumber(0.52, 1.2, clamp(startZ / (depthRadius * 1.2) * 0.5 + 0.5, 0, 1))
          : 1;
        setColor(terminalColors, offset, terminalColor, (0.78 + colorSeed * 0.22) * startDepthLight);
        terminalOffset += 1;
      }
      terminalCursor += 1;
      if (terminalCursor % terminalStride === 0 && terminalOffset < terminalCount) {
        const offset = terminalOffset * 3;
        terminalPositions[offset] = endX;
        terminalPositions[offset + 1] = yEnd;
        terminalPositions[offset + 2] = endZ;
        const endDepthLight = depthRadius > 0.0001
          ? mixNumber(0.52, 1.2, clamp(endZ / (depthRadius * 1.2) * 0.5 + 0.5, 0, 1))
          : 1;
        setColor(terminalColors, offset, terminalColor, (0.78 + (1 - colorSeed) * 0.22) * endDepthLight);
        terminalOffset += 1;
      }
      terminalCursor += 1;
    }

    networkGeometry.getAttribute("position").needsUpdate = true;
    networkGeometry.getAttribute("color").needsUpdate = true;
    terminalGeometry.getAttribute("position").needsUpdate = true;
    terminalGeometry.getAttribute("color").needsUpdate = true;
    vectorHeadGeometry.getAttribute("position").needsUpdate = true;
    vectorHeadGeometry.getAttribute("aTangent").needsUpdate = true;
    vectorHeadGeometry.getAttribute("color").needsUpdate = true;
    networkGeometry.setDrawRange(0, positionOffset);
    terminalGeometry.setDrawRange(0, terminalOffset);
    vectorHeadGeometry.setDrawRange(0, vectorHeadOffset);
  }

  function render(frame) {
    if (disposed) return;
    if (currentSeed !== frame.seed) {
      writePathSeeds(pathSeeds, frame.seed);
      currentSeed = frame.seed;
    }
    updateGeometry(frame);

    const view = frame.view ?? {};
    const orbitYaw = (Number.isFinite(view.orbitYaw) ? view.orbitYaw : 0) * Math.PI / 180;
    const orbitPitch = (Number.isFinite(view.orbitPitch) ? view.orbitPitch : 0) * Math.PI / 180;
    const zoom = Number.isFinite(view.zoom) ? clamp(view.zoom, 0.35, 4) : 1;
    const formatAspect = compositionMetrics(frame).aspect;
    const formatDistance = formatAspect < 1
      ? Math.pow(1 / formatAspect, 0.14)
      : Math.pow(formatAspect, -0.05);
    const distance = parameter(frame, "cameraDistance", 8.8) * formatDistance / zoom;
    const cosinePitch = Math.cos(orbitPitch);
    cameraTarget.set(
      -(Number.isFinite(view.panX) ? view.panX : 0) * 3,
      (Number.isFinite(view.panY) ? view.panY : 0) * 3,
      0
    );
    camera.fov = parameter(frame, "fov", 44);
    camera.position.set(
      cameraTarget.x + Math.sin(orbitYaw) * cosinePitch * distance,
      cameraTarget.y + Math.sin(orbitPitch) * distance,
      cameraTarget.z + Math.cos(orbitYaw) * cosinePitch * distance
    );
    camera.lookAt(cameraTarget);
    camera.updateProjectionMatrix();

    group.rotation.x = parameter(frame, "basePitch", -9) * Math.PI / 180;
    group.rotation.y = parameter(frame, "baseYaw", 28) * Math.PI / 180 +
      parameter(frame, "sceneRotation", 0.028) * frame.elapsedTime;
    group.rotation.z = parameter(frame, "tilt", 0) * Math.PI / 180;

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
    networkGeometry.dispose();
    terminalGeometry.dispose();
    vectorHeadGeometry.dispose();
    networkMaterial.dispose();
    terminalMaterial.dispose();
    vectorHeadMaterial.dispose();
    renderer.dispose();
  }

  return { resize, render, dispose };
}

export const tensionNetworkProject = {
  id: PROJECT_ID,
  index: "08.1",
  name: "Tension Network",
  label: "Cauce — Tension Network",
  description: "Vectores que recorren una envolvente elipsoidal tridimensional, atraviesan un núcleo volumétrico y alcanzan otro terminal espacial.",
  backend: /** @type {"three"} */ ("three"),
  preferredFps: 60,
  preferredFormatKey: "portrait",
  preferredLoopSeconds: 10,
  preferredPlaybackMode: /** @type {"continuous"} */ ("continuous"),
  supportsContinuousTime: true,
  supportsLoopTime: false,
  viewControls: true,
  exportCapabilities: { svg: false, png: true, video: true, web: true },
  controls: [
    { key: "paths", label: "Filamentos", min: 40, max: 1200, step: 20, defaultValue: 760, digits: 0 },
    { key: "segments", label: "Suavidad de curva", min: 8, max: 40, step: 1, defaultValue: 30, digits: 0 },
    { key: "aperture", label: "Apertura", min: 0.6, max: 2.6, step: 0.01, defaultValue: 2, digits: 2 },
    { key: "height", label: "Altura de red", min: 3, max: 8, step: 0.05, defaultValue: 6.4, digits: 2 },
    { key: "waist", label: "Dispersión del núcleo", min: 0, max: 1, step: 0.01, defaultValue: 0.3, digits: 2 },
    { key: "tension", label: "Tensión", min: 0, max: 1, step: 0.01, defaultValue: 0.86, digits: 2 },
    { key: "curvature", label: "Curvatura", min: 0, max: 3, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "depth", label: "Volumen Z", min: 0, max: 1.4, step: 0.01, defaultValue: 0.28, digits: 2 },
    { key: "water", label: "Deriva de agua", min: 0, max: 0.8, step: 0.01, defaultValue: 0.1, digits: 2 },
    { key: "flowSpeed", label: "Velocidad de deriva", min: 0, max: 2, step: 0.01, defaultValue: 0.35, digits: 2 },
    { key: "motionMode", label: "Recorrido", min: 0, max: 1, step: 1, defaultValue: 1, digits: 0, options: [
      { value: 0, label: "Estático", description: "Muestra todos los filamentos completos." },
      { value: 1, label: "Nacer → Llegar", description: "Cada vector crece desde su origen y se disuelve al alcanzar el destino." }
    ] },
    { key: "travelSpeed", label: "Velocidad de recorrido", min: 0.02, max: 0.5, step: 0.01, defaultValue: 0.1, digits: 2 },
    { key: "speedVariation", label: "Variación de velocidad", min: 0, max: 0.9, step: 0.01, defaultValue: 0.48, digits: 2 },
    { key: "trailMemory", label: "Memoria del recorrido", min: 0.05, max: 1, step: 0.01, defaultValue: 1, digits: 2 },
    { key: "arrivalHold", label: "Permanencia al llegar", min: 0, max: 0.6, step: 0.01, defaultValue: 0.18, digits: 2 },
    { key: "baseYaw", label: "Orientación horizontal", min: -180, max: 180, step: 1, defaultValue: 28, digits: 0, suffix: "°" },
    { key: "basePitch", label: "Orientación vertical", min: -60, max: 60, step: 1, defaultValue: -9, digits: 0, suffix: "°" },
    { key: "sceneRotation", label: "Rotación espacial", min: -0.2, max: 0.2, step: 0.005, defaultValue: 0.028, digits: 3 },
    { key: "tilt", label: "Inclinación", min: -35, max: 35, step: 1, defaultValue: 0, digits: 0, suffix: "°" },
    { key: "fov", label: "Campo de visión", min: 20, max: 72, step: 1, defaultValue: 44, digits: 0, suffix: "°" },
    { key: "cameraDistance", label: "Distancia de cámara", min: 4, max: 12, step: 0.05, defaultValue: 8.8, digits: 2 },
    { key: "pathOpacity", label: "Intensidad de trazo", min: 0.08, max: 1, step: 0.01, defaultValue: 0.26, digits: 2, group: "color3d" },
    { key: "terminals", label: "Terminales", min: 0, max: 2400, step: 20, defaultValue: 1520, digits: 0, group: "color3d" },
    { key: "terminalSize", label: "Tamaño de terminal", min: 1, max: 9, step: 0.1, defaultValue: 4.2, digits: 1, group: "color3d" },
    { key: "vectorHeadSize", label: "Tamaño de cabeza vectorial", min: 4, max: 20, step: 0.5, defaultValue: 10, digits: 1, group: "color3d" },
    { key: "paletteMix", label: "Mezcla con paleta", min: 0, max: 1, step: 0.01, defaultValue: 0, digits: 2, group: "color3d" }
  ],
  defaults: {
    paths: 760,
    segments: 30,
    aperture: 2,
    height: 6.4,
    waist: 0.3,
    tension: 0.86,
    curvature: 1,
    depth: 0.28,
    water: 0.1,
    flowSpeed: 0.35,
    motionMode: 1,
    travelSpeed: 0.1,
    speedVariation: 0.48,
    trailMemory: 1,
    arrivalHold: 0.18,
    baseYaw: 28,
    basePitch: -9,
    sceneRotation: 0.028,
    tilt: 0,
    fov: 44,
    cameraDistance: 8.8,
    pathOpacity: 0.26,
    terminals: 1520,
    terminalSize: 4.2,
    vectorHeadSize: 10,
    paletteMix: 0
  },
  createRenderer: createTensionNetworkRenderer
};
