#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_CHROME_PATH = process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "google-chrome";
const chromePath = process.env.CHROME_PATH ?? DEFAULT_CHROME_PATH;
const commandArguments = process.argv.slice(2);
const requestedSuite = commandArguments.find((argument) => !argument.startsWith("http")) ?? "all";
const targetUrl = commandArguments.find((argument) => argument.startsWith("http"))
  ?? "http://localhost:5173/?debug-engine=1";
const sampleMilliseconds = Number(process.env.CAUCE_BENCHMARK_MS ?? 3000);
const warmupMilliseconds = Number(process.env.CAUCE_BENCHMARK_WARMUP_MS ?? 1500);
const chromaticRepetitions = Math.max(
  1,
  Math.min(7, Math.round(Number(process.env.CAUCE_BENCHMARK_REPETITIONS ?? 3)))
);
const requestedRemotePort = Number(process.env.CAUCE_BENCHMARK_PORT);
const remotePort = Number.isInteger(requestedRemotePort) && requestedRemotePort > 0
  ? requestedRemotePort
  : 9300 + Math.floor(Math.random() * 500);
const userDataDirectory = await mkdtemp(join(tmpdir(), "cauce-fluid-benchmark-"));

if (process.platform === "darwin" || chromePath.includes("/")) await access(chromePath);

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${userDataDirectory}`,
  "--headless=new",
  "--enable-unsafe-webgpu",
  "--use-angle=metal",
  "--disable-gpu-sandbox",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-extensions",
  "--disable-component-update",
  "--disable-crash-reporter",
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1440,1000",
  targetUrl
], {
  stdio: ["ignore", "ignore", "pipe"]
});

let chromeErrors = "";
chrome.stderr.on("data", (chunk) => {
  chromeErrors += String(chunk);
  if (chromeErrors.length > 12000) chromeErrors = chromeErrors.slice(-12000);
});
chrome.on("error", (error) => {
  chromeErrors += `\nspawn error: ${error.message}`;
});
chrome.on("exit", (code, signal) => {
  chromeErrors += `\nchrome exited before DevTools (code=${code}, signal=${signal})`;
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForTarget(timeoutMilliseconds = 15000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${remotePort}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome has not opened its DevTools endpoint yet.
    }
    await delay(100);
  }
  throw new Error(`Chrome no abrió DevTools. ${chromeErrors.trim()}`);
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = false) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? "Error evaluando la página.");
    }
    return response.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function waitForDebugApi(client, timeoutMilliseconds = 30000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await client.evaluate("Boolean(window.__CAUCE_DEBUG__?.ready())")) return;
    await delay(100);
  }
  const visibleError = await client.evaluate(
    "document.querySelector('#canvas-error')?.textContent || document.body.innerText.slice(0, 500)"
  );
  throw new Error(`La API de diagnóstico no está disponible. ${visibleError}`);
}

function numberFrom(record, key) {
  const value = record?.[key];
  return typeof value === "number" ? value : 0;
}

const physicsCases = [
  { label: "32k · original", particles: 32768, surface: 0 },
  { label: "32k · CSF", particles: 32768, surface: 1 },
  { label: "64k · original", particles: 65536, surface: 0 },
  { label: "64k · CSF", particles: 65536, surface: 1 },
  { label: "128k · original", particles: 131072, surface: 0 },
  { label: "128k · CSF", particles: 131072, surface: 1 }
];

const renderProfiles = [
  { label: "esfera · raster base", shape: 1, material: 0, environment: false, lights: false, shadows: false },
  { label: "esfera · luz directa", shape: 1, material: 0, environment: false, lights: true, shadows: false },
  { label: "esfera · HDRI + luz", shape: 1, material: 0, environment: true, lights: true, shadows: false },
  { label: "esfera · PBR completo", shape: 1, material: 0, environment: true, lights: true, shadows: true },
  { label: "esfera mineral · sin sombras", shape: 1, material: 1, environment: true, lights: true, shadows: false },
  { label: "esfera mineral · completo", shape: 1, material: 1, environment: true, lights: true, shadows: true },
  { label: "vector · HDRI + luz", shape: 0, material: 0, environment: true, lights: true, shadows: false },
  { label: "vector · PBR completo", shape: 0, material: 0, environment: true, lights: true, shadows: true }
];

const resetCases = [
  { label: "32k", particles: 32768 },
  { label: "64k", particles: 65536 },
  { label: "128k", particles: 131072 }
];

const chromaticProfiles = [
  { label: "Flow original", shape: 0 },
  { label: "Esfera", shape: 1 }
];

if (!["all", "chromatic", "physics", "render", "reset", "reuse", "switch"].includes(requestedSuite)) {
  throw new Error(
    `Suite desconocida: ${requestedSuite}. ` +
    "Usa all, chromatic, physics, render, reset, reuse o switch."
  );
}

function roundedGpuMetric(gpu, key) {
  return typeof gpu?.[key] === "number" ? Number(gpu[key].toFixed(3)) : null;
}

async function sampleCase(client, benchmarkCase) {
  await delay(warmupMilliseconds);
  const before = await client.evaluate("window.__CAUCE_DEBUG__.diagnostics()", true);
  const startedAt = performance.now();
  await delay(sampleMilliseconds);
  const elapsedMilliseconds = performance.now() - startedAt;
  const after = await client.evaluate("window.__CAUCE_DEBUG__.diagnostics()", true);
  const simulatedSteps = numberFrom(after, "totalSteps") - numberFrom(before, "totalSteps");
  const gpu = after?.gpu ?? {};
  const gpuTotal = roundedGpuMetric(gpu, "totalFrameMs");
  return {
    case: benchmarkCase.label,
    particles: benchmarkCase.particles,
    capacity: numberFrom(after, "capacity"),
    geometry: after?.renderer?.activeGeometry ?? null,
    passes: numberFrom(after, "lastDispatchCount"),
    "reset mode": after?.resetMode ?? "unknown",
    "physical bytes": numberFrom(after?.memory, "physicalParticles"),
    "visual bytes": numberFrom(after?.memory, "visualParticles"),
    "sphere surface vertices": numberFrom(after?.renderer, "sphereSurfaceVertexCount"),
    "sphere surface indices": numberFrom(after?.renderer, "sphereSurfaceIndexCount"),
    "sphere shadow vertices": numberFrom(after?.renderer, "sphereShadowVertexCount"),
    "sphere shadow indices": numberFrom(after?.renderer, "sphereShadowIndexCount"),
    "geometry vertices": numberFrom(after?.renderer, "geometryVertices"),
    "geometry indices": numberFrom(after?.renderer, "geometryIndices"),
    "steps/s": Number((simulatedSteps / (elapsedMilliseconds / 1000)).toFixed(1)),
    "GPU compute ms": roundedGpuMetric(gpu, "computeFrameMs"),
    "GPU render ms": roundedGpuMetric(gpu, "renderFrameMs"),
    "GPU total ms": gpuTotal,
    "GPU fps max": gpuTotal && gpuTotal > 0 ? Number((1000 / gpuTotal).toFixed(1)) : null,
    "CPU submit ms": Number(numberFrom(after, "averageSubmissionCpuMs").toFixed(3)),
    dropped: numberFrom(after, "droppedCatchUpFrames") - numberFrom(before, "droppedCatchUpFrames"),
    timestamps: gpu.supported === true ? "GPU" : gpu.reason ?? "unavailable"
  };
}

async function sampleValidCase(client, benchmarkCase) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await sampleCase(client, benchmarkCase);
    if (result["steps/s"] >= 30) return result;
    await client.evaluate("window.__CAUCE_DEBUG__.setPlaying(true)");
    await delay(warmupMilliseconds);
  }
  throw new Error(`No se obtuvo una muestra GPU válida para ${benchmarkCase.label}.`);
}

async function sampleResetCase(client, benchmarkCase) {
  await client.evaluate(
    `window.__CAUCE_DEBUG__.setParameter("particleCount", ${benchmarkCase.particles});` +
    "window.__CAUCE_DEBUG__.setPlaying(false);"
  );
  await delay(warmupMilliseconds);
  const before = await client.evaluate("window.__CAUCE_DEBUG__.diagnostics()", true);
  for (const seed of [6437, 7121, 8849]) {
    await client.evaluate(`window.__CAUCE_DEBUG__.setSeed(${seed});`);
    await delay(150);
  }
  const after = await client.evaluate("window.__CAUCE_DEBUG__.diagnostics()", true);
  return {
    case: `reset · ${benchmarkCase.label}`,
    particles: benchmarkCase.particles,
    capacity: numberFrom(after, "capacity"),
    "reset mode": after?.resetMode ?? "unknown",
    resets: numberFrom(after, "resetCount") - numberFrom(before, "resetCount"),
    "reset CPU ms": roundedGpuMetric(after, "lastResetCpuMs"),
    "reset upload bytes": numberFrom(after, "lastResetUploadBytes"),
    "physical bytes": numberFrom(after?.memory, "physicalParticles"),
    "visual bytes": numberFrom(after?.memory, "visualParticles")
  };
}

function median(values) {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) return null;
  numbers.sort((left, right) => left - right);
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 === 0
    ? (numbers[middle - 1] + numbers[middle]) * 0.5
    : numbers[middle];
}

function summarizeSamples(samples) {
  const groups = new Map();
  for (const sample of samples) {
    const key = `${sample.case}:${sample.particles}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  const metrics = [
    "passes",
    "steps/s",
    "GPU compute ms",
    "GPU render ms",
    "GPU total ms",
    "GPU fps max",
    "CPU submit ms",
    "dropped",
    "sphere surface vertices",
    "sphere surface indices",
    "sphere shadow vertices",
    "sphere shadow indices",
    "geometry vertices",
    "geometry indices",
    "capacity",
    "physical bytes",
    "visual bytes",
    "reset CPU ms",
    "reset upload bytes"
  ];
  return [...groups.values()].map((group) => {
    const first = group[0];
    const summary = {
      case: first.case,
      particles: first.particles,
      samples: group.length,
      geometry: first.geometry ?? null
    };
    for (const metric of metrics) {
      const value = median(group.map((sample) => sample[metric]));
      summary[metric] = typeof value === "number" ? Number(value.toFixed(3)) : null;
    }
    summary.timestamps = group.every((sample) => sample.timestamps === "GPU")
      ? "GPU"
      : "fallback";
    summary["reset mode"] = first["reset mode"] ?? "unknown";
    return summary;
  });
}

let client;
try {
  client = new CdpClient(await waitForTarget());
  await client.connect();
  await client.send("Runtime.enable");
  await waitForDebugApi(client);
  await client.evaluate(`window.__CAUCE_DEBUG__.selectProject("flow-cauce")`);
  const projectDeadline = Date.now() + 10000;
  while (Date.now() < projectDeadline) {
    if (await client.evaluate("window.__CAUCE_DEBUG__.state().projectId === 'flow-cauce'")) break;
    await delay(100);
  }
  if (!await client.evaluate("window.__CAUCE_DEBUG__.state().projectId === 'flow-cauce'")) {
    throw new Error("La aplicación no cambió a Flow Cauce.");
  }
  await client.evaluate("window.__CAUCE_DEBUG__.setPlaying(true)");
  await delay(5000);
  const initialDiagnostics = await client.evaluate(
    "window.__CAUCE_DEBUG__.diagnostics()",
    true
  );
  if (!initialDiagnostics?.version) {
    const visibleError = await client.evaluate(
      "document.querySelector('#canvas-error')?.textContent || 'diagnóstico vacío'"
    );
    throw new Error(`Flow Cauce no llegó a iniciar: ${visibleError}`);
  }

  const results = [];
  if (requestedSuite === "reuse") {
    const reuseCases = [
      { projectId: "flow-cauce", particles: 32768 },
      { projectId: "chromatic-fluid", particles: 32768, shape: 0, color: 0, geometry: "flow-original" },
      { projectId: "chromatic-fluid", particles: 65536, shape: 1, color: 1, geometry: "sphere" },
      { projectId: "chromatic-fluid", particles: 131072, shape: 1, color: 3, geometry: "sphere" },
      { projectId: "flow-cauce", particles: 32768 }
    ];
    for (const reuseCase of reuseCases) {
      const { projectId, particles } = reuseCase;
      await client.evaluate(`window.__CAUCE_DEBUG__.selectProject(${JSON.stringify(projectId)})`);
      const reuseDeadline = Date.now() + 10000;
      while (Date.now() < reuseDeadline) {
        if (await client.evaluate(
          `window.__CAUCE_DEBUG__.state().projectId === ${JSON.stringify(projectId)}`
        )) break;
        await delay(100);
      }
      if (!await client.evaluate(
        `window.__CAUCE_DEBUG__.state().projectId === ${JSON.stringify(projectId)}`
      )) {
        throw new Error(`La aplicación no cambió a ${projectId}.`);
      }
      await client.evaluate(
        `window.__CAUCE_DEBUG__.setParameter("particleCount", ${particles});` +
        "window.__CAUCE_DEBUG__.setParameter(\"surfaceModel\", 0);" +
        (projectId === "chromatic-fluid"
          ? `window.__CAUCE_DEBUG__.setParameter("particleShape", ${reuseCase.shape});` +
            `window.__CAUCE_DEBUG__.setParameter("colorBehavior", ${reuseCase.color});`
          : "") +
        "window.__CAUCE_DEBUG__.setPlaying(true);"
      );
      await delay(particles === 131072 ? 5000 : 3000);
      const error = await client.evaluate(
        "document.querySelector('#canvas-error:not([hidden])')?.textContent || null"
      );
      if (error) throw new Error(`${projectId}: ${error}`);
      const diagnostics = await client.evaluate("window.__CAUCE_DEBUG__.diagnostics()", true);
      if (diagnostics?.version !== "0.2") {
        throw new Error(`${projectId}: no usa Cauce Fluid Engine 0.2.`);
      }
      if (diagnostics?.basePassCount !== 5 || diagnostics?.lastDispatchCount !== 5) {
        throw new Error(`${projectId}: el solver base no conserva sus cinco dispatches.`);
      }
      if (!(diagnostics?.renderer?.renderCalls > 0)) {
        throw new Error(`${projectId}: el renderer no produjo ningún fotograma.`);
      }
      if (
        diagnostics?.activeParticleCount !== particles ||
        diagnostics?.capacity < particles
      ) {
        throw new Error(
          `${projectId}: solicitó ${particles} partículas pero activó ` +
          `${diagnostics?.activeParticleCount ?? 0}/${diagnostics?.capacity ?? 0}.`
        );
      }
      if (projectId === "chromatic-fluid") {
        const consumer = diagnostics?.consumer;
        if (
          diagnostics?.visualMode !== "none" ||
          diagnostics?.memory?.visualParticles !== 0 ||
          consumer?.engineInstances !== 1 ||
          consumer?.physicalBuffers !== 1 ||
          consumer?.visualBuffers !== 0 ||
          consumer?.renderLayers !== 1 ||
          !(consumer?.renderedFrames > 0) ||
          consumer?.sharesParticleBuffer !== true ||
          consumer?.transparentParticles !== false ||
          diagnostics?.renderer?.activeGeometry !== reuseCase.geometry
        ) {
          throw new Error(
            "Chromatic Fluid duplicó física/representación, activó transparencia o reservó estado visual de Flow."
          );
        }
      } else if (
        diagnostics?.visualMode !== "flow" ||
        !(diagnostics?.memory?.visualParticles > 0)
      ) {
        throw new Error("Flow Cauce perdió su extensión visual compatible.");
      }
      results.push({
        case: `reuse → ${projectId} · ${Math.round(particles / 1024)}k`,
        engine: diagnostics.version,
        passes: diagnostics.lastDispatchCount,
        particles,
        capacity: diagnostics.capacity,
        physicalBuffers: diagnostics.consumer?.physicalBuffers ?? 1,
        visualBuffers: diagnostics.consumer?.visualBuffers ?? 1,
        renderLayers: diagnostics.consumer?.renderLayers ?? 1,
        renderedFrames: diagnostics.consumer?.renderedFrames ?? null,
        renderCalls: diagnostics.renderer?.renderCalls ?? 0,
        geometry: diagnostics.renderer?.activeGeometry ?? null,
        physicalBytes: diagnostics.memory?.physicalParticles ?? 0,
        visualBytes: diagnostics.memory?.visualParticles ?? 0
      });
    }
  }
  if (requestedSuite === "switch") {
    await client.evaluate(`window.__CAUCE_DEBUG__.setAppearance({
      schemaVersion: 1,
      background: { color: "#101418" },
      paint: {
        type: "gradient",
        mapping: "surface",
        angle: -32,
        stops: [
          { position: 0, color: "#ef476f" },
          { position: 0.28, color: "#ffd166" },
          { position: 0.67, color: "#06d6a0" },
          { position: 1, color: "#118ab2" }
        ]
      },
      material: { preset: "satin", roughness: 0.38, metalness: 0.08, clearcoat: 0.4 },
      texture: { type: "procedural", preset: "grain", scale: 5, strength: 0.42, motion: 0.6 }
    })`);
    await delay(1000);
    for (const projectId of [
      "mobius-flow-1-1",
      "flow-cauce",
      "chromatic-fluid",
      "flow-cauce",
      "mobius-flow-1-1"
    ]) {
      await client.evaluate(`window.__CAUCE_DEBUG__.selectProject(${JSON.stringify(projectId)})`);
      const switchDeadline = Date.now() + 10000;
      while (Date.now() < switchDeadline) {
        if (await client.evaluate(
          `window.__CAUCE_DEBUG__.state().projectId === ${JSON.stringify(projectId)}`
        )) break;
        await delay(100);
      }
      await delay(2500);
      const state = await client.evaluate(`({
        projectId: window.__CAUCE_DEBUG__.state().projectId,
        error: document.querySelector('#canvas-error:not([hidden])')?.textContent || null,
        status: document.querySelector('#app-status')?.textContent || '',
        appearanceStops: window.__CAUCE_DEBUG__.state().appearance?.paint?.stops?.length ?? 0,
        appearanceTexture: window.__CAUCE_DEBUG__.state().appearance?.texture?.preset ?? 'none',
        webglActive: document.querySelector('#cauce-three-canvas')?.classList.contains('is-active'),
        webgpuActive: document.querySelector('#cauce-webgpu-canvas')?.classList.contains('is-active')
      })`);
      if (state.error) throw new Error(`${projectId}: ${state.error}`);
      if (state.appearanceStops !== 4 || state.appearanceTexture !== "grain") {
        throw new Error(`${projectId}: la apariencia no sobrevivió al cambio de backend.`);
      }
      results.push({ case: `switch → ${projectId}`, ...state });
    }
  }
  if (requestedSuite === "chromatic") {
    await client.evaluate(`window.__CAUCE_DEBUG__.selectProject("chromatic-fluid")`);
    const chromaticDeadline = Date.now() + 10000;
    while (Date.now() < chromaticDeadline) {
      if (await client.evaluate(
        "window.__CAUCE_DEBUG__.state().projectId === 'chromatic-fluid'"
      )) break;
      await delay(100);
    }
    if (!await client.evaluate(
      "window.__CAUCE_DEBUG__.state().projectId === 'chromatic-fluid'"
    )) {
      throw new Error("La aplicación no cambió a Chromatic Fluid.");
    }
    await client.evaluate("window.__CAUCE_DEBUG__.setPlaying(true)");
    const chromaticCases = Array.from({ length: chromaticRepetitions }, (_, repetition) => {
      const profiles = repetition % 2 === 0
        ? chromaticProfiles
        : [...chromaticProfiles].reverse();
      const particleCounts = repetition % 2 === 0
        ? [32768, 65536, 131072]
        : [131072, 65536, 32768];
      return profiles.flatMap((profile) => particleCounts.map((particles) => ({
        ...profile,
        particles,
        label: `${profile.label} · ${Math.round(particles / 1024)}k`
      })));
    }).flat();
    for (const benchmarkCase of chromaticCases) {
      await client.evaluate(
        `window.__CAUCE_DEBUG__.setParameter("particleCount", ${benchmarkCase.particles});` +
        `window.__CAUCE_DEBUG__.setParameter("particleShape", ${benchmarkCase.shape});` +
        "window.__CAUCE_DEBUG__.setParameter(\"surfaceModel\", 0);" +
        "window.__CAUCE_DEBUG__.setParameter(\"colorBehavior\", 0);" +
        "window.__CAUCE_DEBUG__.setPlaying(true);"
      );
      results.push(await sampleValidCase(client, benchmarkCase));
    }
  }
  if (requestedSuite === "all" || requestedSuite === "physics") {
    for (const benchmarkCase of physicsCases) {
      await client.evaluate(
        `window.__CAUCE_DEBUG__.setParameter("particleCount", ${benchmarkCase.particles});` +
        `window.__CAUCE_DEBUG__.setParameter("surfaceModel", ${benchmarkCase.surface});` +
        `window.__CAUCE_DEBUG__.setParameter("particleShape", 1);` +
        `window.__CAUCE_DEBUG__.setParameter("materialMode", 0);` +
        "window.__CAUCE_DEBUG__.setEnvironmentEnabled(true);" +
        "window.__CAUCE_DEBUG__.setLightsEnabled(true);" +
        "window.__CAUCE_DEBUG__.setShadows(true);"
      );
      results.push(await sampleValidCase(client, benchmarkCase));
    }
  }

  if (requestedSuite === "all" || requestedSuite === "render") {
    const renderCases = [
      ...renderProfiles,
      ...[...renderProfiles].reverse()
    ];
    for (const benchmarkCase of renderCases) {
      const particles = 131072;
      await client.evaluate(
        `window.__CAUCE_DEBUG__.setParameter("particleCount", ${particles});` +
        "window.__CAUCE_DEBUG__.setParameter(\"surfaceModel\", 0);" +
        `window.__CAUCE_DEBUG__.setParameter("particleShape", ${benchmarkCase.shape});` +
        `window.__CAUCE_DEBUG__.setParameter("materialMode", ${benchmarkCase.material});` +
        `window.__CAUCE_DEBUG__.setEnvironmentEnabled(${benchmarkCase.environment});` +
        `window.__CAUCE_DEBUG__.setLightsEnabled(${benchmarkCase.lights});` +
        `window.__CAUCE_DEBUG__.setShadows(${benchmarkCase.shadows});`
      );
      results.push(await sampleValidCase(client, { ...benchmarkCase, particles }));
    }
  }

  if (requestedSuite === "all" || requestedSuite === "reset") {
    for (const benchmarkCase of resetCases) {
      results.push(await sampleResetCase(client, benchmarkCase));
    }
  }

  const diagnostics = await client.evaluate("window.__CAUCE_DEBUG__.diagnostics()", true);
  const summary = requestedSuite === "switch" || requestedSuite === "reuse"
    ? results
    : summarizeSamples(results);
  console.table(summary);
  console.log(JSON.stringify({
    url: targetUrl,
    suite: requestedSuite,
    sampleMilliseconds,
    warmupMilliseconds,
    chromaticRepetitions,
    engine: {
      version: diagnostics?.version,
      gridSize: diagnostics?.gridSize,
      capacity: diagnostics?.capacity,
      resetMode: diagnostics?.resetMode,
      memory: diagnostics?.memory,
      webgpu: diagnostics?.webgpu
    },
    results: summary,
    samples: results
  }, null, 2));
} finally {
  client?.close();
  const chromeExited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill("SIGTERM");
  await Promise.race([chromeExited, delay(2000)]);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(userDataDirectory, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await delay(200);
    }
  }
}
