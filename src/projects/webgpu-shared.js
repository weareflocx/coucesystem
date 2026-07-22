export async function createCauceWebGpuBackend(canvas, options = {}) {
  const THREE = await import("three/webgpu");
  const renderer = new THREE.WebGPURenderer({
    canvas,
    alpha: true,
    antialias: options.antialias ?? false,
    depth: options.depth ?? true,
    powerPreference: "high-performance",
    trackTimestamp: options.trackTimestamp === true,
    outputBufferType: THREE.UnsignedByteType,
    ...(options.requiredLimits ? { requiredLimits: options.requiredLimits } : {})
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = false;
  await renderer.init();

  const backendName = renderer.backend?.isWebGPUBackend === true
    ? "webgpu"
    : "webgl2";

  if (options.requireWebGpu === true && backendName !== "webgpu") {
    renderer.dispose();
    throw new Error(
      "Este proyecto necesita WebGPU real: el fallback WebGL2 no puede ejecutar su solver de cómputo."
    );
  }

  async function flush() {
    const queue = renderer.backend?.device?.queue;
    if (queue?.onSubmittedWorkDone) await queue.onSubmittedWorkDone();
  }

  return { THREE, renderer, backendName, flush };
}

function readLimit(limits, key) {
  const value = limits?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Return a clone-safe capability snapshot for diagnostics and future feature
 * gates. Optional WebGPU features must never be assumed by a renderer.
 */
export function getCauceWebGpuCapabilities(renderer) {
  const device = renderer?.backend?.device;
  const featureSet = device?.features;
  const features = featureSet && typeof featureSet[Symbol.iterator] === "function"
    ? [...featureSet].sort()
    : [];
  const limits = device?.limits;
  const has = (feature) => features.includes(feature);
  return {
    backend: renderer?.backend?.isWebGPUBackend === true ? "webgpu" : "webgl2",
    features,
    optional: {
      timestampQuery: has("timestamp-query"),
      shaderF16: has("shader-f16"),
      subgroups: has("subgroups"),
      subgroupSizeControl: has("subgroup-size-control"),
      indirectFirstInstance: has("indirect-first-instance")
    },
    limits: {
      maxStorageBuffersInVertexStage: readLimit(limits, "maxStorageBuffersInVertexStage"),
      maxStorageBufferBindingSize: readLimit(limits, "maxStorageBufferBindingSize"),
      maxBufferSize: readLimit(limits, "maxBufferSize"),
      maxComputeWorkgroupsPerDimension: readLimit(limits, "maxComputeWorkgroupsPerDimension"),
      maxComputeInvocationsPerWorkgroup: readLimit(limits, "maxComputeInvocationsPerWorkgroup"),
      maxUniformBufferBindingSize: readLimit(limits, "maxUniformBufferBindingSize")
    }
  };
}

function median(values) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) * 0.5
    : ordered[middle];
}

export function createCauceGpuTiming(THREE, renderer, options = {}) {
  const requested = options.enabled === true;
  const intervalFrames = Math.max(1, Math.round(options.intervalFrames ?? 30));
  const recentLimit = Math.max(1, Math.round(options.recentLimit ?? 5));
  const supported = requested && renderer.backend?.trackTimestamp === true;
  const recentCompute = [];
  const recentRender = [];
  let frameCount = 0;
  let sampleCount = 0;
  let pending = false;
  let disposed = false;
  let lastError = null;
  let lastComputeFrameMs = null;
  let lastRenderFrameMs = null;

  function appendRecent(target, value) {
    target.push(value);
    if (target.length > recentLimit) target.shift();
  }

  async function resolve() {
    if (!supported || pending || disposed) return;
    pending = true;
    try {
      const [compute, render] = await Promise.all([
        renderer.resolveTimestampsAsync(THREE.TimestampQuery.COMPUTE),
        renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER)
      ]);
      let sampled = false;
      if (typeof compute === "number" && Number.isFinite(compute)) {
        lastComputeFrameMs = compute;
        appendRecent(recentCompute, compute);
        sampled = true;
      }
      if (typeof render === "number" && Number.isFinite(render)) {
        lastRenderFrameMs = render;
        appendRecent(recentRender, render);
        sampled = true;
      }
      if (sampled) sampleCount += 1;
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      pending = false;
    }
  }

  function tick() {
    if (!supported || disposed) return;
    frameCount += 1;
    if (frameCount % intervalFrames === 0) void resolve();
  }

  function getDiagnostics() {
    const computeFrameMs = median(recentCompute);
    const renderFrameMs = median(recentRender);
    return {
      requested,
      supported,
      reason: supported
        ? null
        : requested
          ? "timestamp-query-unavailable"
          : "disabled",
      intervalFrames,
      sampleCount,
      pending,
      computeFrameMs,
      renderFrameMs,
      totalFrameMs: computeFrameMs === null || renderFrameMs === null
        ? null
        : computeFrameMs + renderFrameMs,
      lastComputeFrameMs,
      lastRenderFrameMs,
      lastError
    };
  }

  function dispose() {
    disposed = true;
    recentCompute.length = 0;
    recentRender.length = 0;
  }

  return { tick, resolve, getDiagnostics, dispose };
}
